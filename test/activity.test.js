import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFixture } from '../test-support/role-fixture.js';
import { canonicalRoom } from '../shared/rooms.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../server/database.js';

test('existing databases start with history read and initialization never advances saved baselines', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-activity-install-'));
    let db = new DatabaseSync(path.join(directory, 'campfire.sqlite'));
    try {
        // The immediately preceding schema has no activity tables or triggers.
        const legacy = readFileSync(
            new URL('../server/schema.sql', import.meta.url),
            'utf8',
        ).replace(/-- Stable activity order[\s\S]*?(?=-- The server default)/, '');
        db.exec(legacy);
        db.prepare(
            "INSERT INTO users(id,username,password) VALUES('old-user','Existing','unused')",
        ).run();
        db.prepare(
            "INSERT INTO messages(id,room,author,body,created,since) VALUES('old-message','general','old-user','History',1,1)",
        ).run();
        db.close();
        ({ db } = openDatabase(directory, 'Activity install'));
        const baseline = db
            .prepare("SELECT sequence FROM activity_baselines WHERE user='old-user'")
            .get().sequence;
        assert.equal(
            baseline,
            db.prepare('SELECT MAX(sequence) sequence FROM message_activity').get().sequence,
        );
        db.prepare(
            "INSERT INTO messages(id,room,author,body,created,since) VALUES('new-message','general','old-user','After install',1,1)",
        ).run();
        const next = db
            .prepare("SELECT sequence FROM message_activity WHERE message='new-message'")
            .get().sequence;
        assert.ok(next > baseline, 'equal message timestamps still have distinct positions');
        db.prepare(
            "INSERT INTO users(id,username,password) VALUES('new-user','New','unused')",
        ).run();
        assert.equal(
            db.prepare("SELECT sequence FROM activity_baselines WHERE user='new-user'").get()
                .sequence,
            next,
        );
        db.close();
        ({ db } = openDatabase(directory, 'Activity restart'));
        assert.equal(
            db.prepare("SELECT sequence FROM activity_baselines WHERE user='old-user'").get()
                .sequence,
            baseline,
        );
        assert.equal(db.prepare('SELECT COUNT(*) n FROM message_activity').get().n, 2);
    } finally {
        db.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('offline unread activity and read positions survive restarts without clearing newer messages', async (t) => {
    const f = await roleFixture(t);
    const room = canonicalRoom(`dm:${f.owner.user.id}:${f.member.user.id}`);
    const send = (body, destination = room) =>
        f.api(f.owner, '/messages', 'POST', { room: destination, body });
    const first = await send('Missed DM');
    const second = await send('Another missed DM');
    await send('Missed channel message', 'general');
    await f.api(f.member, '/messages', 'POST', { room, body: 'My own message' });
    await f.api(f.member, '/presence', 'PATCH', { status: 'dnd' });
    await f.restart();
    let activity = (await f.api(f.member, '/state')).activity;
    assert.deepEqual(activity.unread, { [room]: 2, general: 1 });
    assert.equal((await f.api(f.owner, '/activity')).unread[room], 1);
    const latest = await send('Arrived after the snapshot');
    activity = await f.api(f.member, '/activity/read', 'POST', { room, through: second.sequence });
    assert.equal(activity.unread[room], 1);
    await f.api(f.member, '/activity/read', 'POST', { room, through: first.sequence });
    assert.equal(
        (await f.api(f.member, '/activity')).unread[room],
        1,
        'older acknowledgments cannot move backwards',
    );
    await f.restart();
    assert.equal((await f.api(f.member, '/state')).activity.unread[room], 1);
    await f.api(f.member, '/activity/read', 'POST', { room, through: latest.sequence });
    assert.equal((await f.api(f.member, '/activity')).unread[room], undefined);
    assert.equal((await f.api(f.member, '/activity')).unread.general, 1);
    const history = await f.api(f.member, `/messages?room=${encodeURIComponent(room)}`);
    assert.ok(history.messages.every((message) => Number.isSafeInteger(message.sequence)));
});

test('read scopes preserve unopened threads and enforce conversation membership and valid positions', async (t) => {
    const f = await roleFixture(t);
    const root = await f.api(f.owner, '/messages', 'POST', { room: 'general', body: 'Root' });
    const reply = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        thread: root.id,
        body: 'Unopened reply',
    });
    const top = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        body: 'Newer top-level message',
    });
    let activity = await f.api(f.member, '/activity/read', 'POST', {
        room: 'general',
        through: top.sequence,
    });
    assert.equal(activity.unread.general, 1);
    activity = await f.api(f.member, '/activity/read', 'POST', {
        room: 'general',
        thread: root.id,
        through: reply.sequence,
    });
    assert.equal(activity.unread.general, undefined);
    const another = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        thread: root.id,
        body: 'Another reply',
    });
    await f.api(
        f.member,
        '/activity/read',
        'POST',
        { room: 'general', through: another.sequence },
        404,
    );
    await f.api(
        f.member,
        '/activity/read',
        'POST',
        { room: 'general', through: another.sequence + 999 },
        404,
    );
    await f.api(f.member, '/activity/read', 'POST', { room: 'general', through: -1 }, 400);
    await f.api(f.member, '/activity/read', 'POST', { room: 'general', through: '100' }, 400);
    const room = canonicalRoom(`dm:${f.owner.user.id}:${f.member.user.id}`);
    const dm = await f.api(f.owner, '/messages', 'POST', { room, body: 'Private' });
    await f.api(f.other, '/activity/read', 'POST', { room, through: dm.sequence }, 403);
    await f.api(
        f.member,
        '/activity/read',
        'POST',
        { room: 'general', through: dm.sequence, all: true },
        404,
    );
    assert.equal((await f.api(f.other, '/activity')).latest[room], undefined);
    activity = await f.api(f.member, '/activity/read', 'POST', {
        room: 'general',
        through: another.sequence,
        all: true,
    });
    assert.equal(
        activity.unread.general,
        undefined,
        'explicit clearing includes threads through its snapshot',
    );
    const channel = await f.api(f.owner, '/channels', 'POST', {
        name: 'private-activity',
        kind: 'text',
    });
    await f.api(f.owner, '/messages', 'POST', { room: channel.id, body: 'Permission protected' });
    await f.override('everyone', [
        { channel: channel.id, permission: 'channels.view', effect: 'deny' },
    ]);
    await f.override(f.participantRole, [
        { channel: channel.id, permission: 'channels.view', effect: 'deny' },
    ]);
    assert.equal((await f.api(f.member, '/activity')).latest[channel.id], undefined);
    await f.api(
        f.member,
        '/activity/read',
        'POST',
        { room: channel.id, through: dm.sequence },
        403,
    );
});

test('deleted messages stop counting and sequence positions are never reused', async (t) => {
    const f = await roleFixture(t);
    const first = await f.api(f.owner, '/messages', 'POST', { room: 'general', body: 'Delete me' });
    await f.api(f.member, '/activity/read', 'POST', { room: 'general', through: first.sequence });
    await f.api(f.owner, `/messages/${first.id}`, 'DELETE');
    const second = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        body: 'Still unread',
    });
    assert.ok(second.sequence > first.sequence);
    assert.equal((await f.api(f.member, '/activity')).unread.general, 1);
    await f.api(f.owner, `/messages/${second.id}`, 'DELETE');
    assert.deepEqual((await f.api(f.member, '/activity')).unread, {});
    await f.api(
        f.member,
        '/activity/read',
        'POST',
        { room: 'general', through: second.sequence },
        404,
    );
});

test('notification rules persist per account and first-client import cannot overwrite saved rules', async (t) => {
    const f = await roleFixture(t);
    const settings = {
        muted: true,
        directMessages: false,
        defaultMode: 'all',
        channels: { general: 'muted' },
        categories: { community: 'mentions' },
    };
    assert.equal((await f.api(f.member, '/state')).notificationPreferences, null);
    assert.deepEqual(
        await f.api(f.member, '/notification-preferences/import', 'POST', settings),
        settings,
    );
    const defaults = {
        muted: false,
        directMessages: true,
        defaultMode: 'mentions',
        channels: {},
        categories: {},
    };
    assert.deepEqual(
        await f.api(f.member, '/notification-preferences/import', 'POST', defaults),
        settings,
    );
    await f.restart();
    assert.deepEqual((await f.api(f.member, '/state')).notificationPreferences, settings);
    assert.equal((await f.api(f.other, '/state')).notificationPreferences, null);
    await f.api(
        f.member,
        '/notification-preferences',
        'PUT',
        { ...settings, channels: { general: 'invalid' } },
        400,
    );
    await f.api(f.member, '/notification-preferences', 'PUT', defaults);
    assert.deepEqual(await f.api(f.member, '/notification-preferences'), defaults);
});

test('activity and clearing sync to the same account without leaking DMs to other accounts', async (t) => {
    t.after(() => {
        for (const id of ['desktop', 'mobile', 'outsider']) f.service.io.sockets.sockets.delete(id);
    });
    const f = await roleFixture(t);
    const attach = (id, account) => {
        const events = [];
        f.service.io.sockets.sockets.set(id, {
            data: { user: account.user, token: account.token },
            emit: (event, data) => events.push({ event, data }),
        });
        return events;
    };
    const desktop = attach('desktop', f.member),
        mobile = attach('mobile', f.member),
        outsider = attach('outsider', f.other);
    const room = canonicalRoom(`dm:${f.owner.user.id}:${f.member.user.id}`);
    const message = await f.api(f.owner, '/messages', 'POST', { room, body: 'Both devices' });
    for (const events of [desktop, mobile])
        assert.equal(events.findLast((event) => event.event === 'activity').data.unread[room], 1);
    assert.equal(
        outsider.some((event) => event.event === 'activity'),
        false,
    );
    await f.api(f.member, '/activity/read', 'POST', { room, through: message.sequence });
    for (const events of [desktop, mobile])
        assert.equal(
            events.findLast((event) => event.event === 'activity').data.unread[room],
            undefined,
        );
    assert.equal(
        outsider.some((event) => event.event === 'activity'),
        false,
    );
});
