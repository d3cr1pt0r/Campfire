import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { roleFixture } from '../test-support/role-fixture.js';
import { messageForm } from '../test-support/http.js';

const day = 86400000;
const post = (f, account, body, extra = {}) =>
    f.api(account, '/messages', 'POST', { room: 'general', body, ...extra });
const upload = (f, account, room, name, bytes, extra = {}) =>
    f.api(
        account,
        '/messages',
        'POST',
        messageForm({ room, body: name, ...extra }, [{ name, data: Buffer.alloc(bytes, 1) }]),
    );
// Moves a message's posting and clock back by some days.
const age = (f, id, days) =>
    f.db
        .prepare('UPDATE messages SET created=created-?1,since=since-?1 WHERE id=?2')
        .run(days * day, id);
const exists = (f, id) => !!f.db.prepare('SELECT 1 FROM messages WHERE id=?').get(id);
const since = (f, id) => f.db.prepare('SELECT since FROM messages WHERE id=?').get(id).since;
const keep = (f, scope, retention, applyNow) =>
    f.api(f.owner, `/retention/${scope}`, 'PATCH', {
        retention,
        ...(applyNow === undefined ? {} : { applyNow }),
    });
const keepChannel = (f, channel, retention, applyNow) =>
    f.api(f.owner, `/retention/channels/${channel}`, 'PATCH', {
        retention,
        ...(applyNow === undefined ? {} : { applyNow }),
    });
const sweep = (f, days = 0) => f.service.retention.sweep(Date.now() + days * day);
const dm = (a, b) => `dm:${[a.user.id, b.user.id].sort().join(':')}`;
// A fake socket that records what the server sends one member.
const listen = (f, account, t) => {
    const socket = new EventEmitter();
    const id = `${account.user.id}-socket`;
    const events = [];
    Object.assign(socket, {
        id,
        data: { user: account.user, token: account.token },
        join(room) {
            f.service.io.sockets.adapter.addAll(id, new Set([room]));
        },
        use() {},
        client: { writeToEngine() {} },
        notifyOutgoingListeners() {},
    });
    f.service.io.sockets.sockets.set(id, socket);
    EventEmitter.prototype.emit.call(f.service.io.sockets, 'connection', socket);
    for (const event of ['messages:expired', 'messages:files-removed', 'message:update'])
        socket.on(event, (payload) => events.push({ event, ...payload }));
    t.after(() => {
        f.service.io.sockets.sockets.delete(id);
        f.service.io.sockets.adapter.delAll(id);
    });
    return events;
};

test('messages are kept forever by default and carry their thread’s clock', async (t) => {
    const f = await roleFixture(t);
    const state = await f.api(f.member, '/state');
    const forever = { retention: 0, retentionNext: null, retentionAt: null };
    assert.deepEqual(state.retention, {
        server: forever,
        dm: forever,
        keepText: false,
        keepTextUntil: null,
    });
    assert.equal(state.channels.find((channel) => channel.id === 'general').retention, null);
    const root = await post(f, f.member, 'Ancient');
    age(f, root.id, 10000);
    const reply = await post(f, f.other, 'Reply', { thread: root.id });
    assert.equal(await sweep(f, 100), 0);
    assert.ok(exists(f, root.id));
    // A thread is deleted as a unit, so its clock is its newest message's.
    const view = await f.api(f.member, `/messages/${root.id}`);
    assert.deepEqual(view.retention, { since: reply.since, kept: false, pollEnds: null });
    assert.equal(view.replyCount, 1);
    assert.deepEqual((await f.api(f.member, `/messages/${reply.id}`)).retention, view.retention);
    await f.api(f.owner, `/messages/${reply.id}`, 'PATCH', { pinned: true });
    assert.equal((await f.api(f.member, `/messages/${root.id}`)).retention.kept, true);
    assert.equal(f.db.prepare('PRAGMA auto_vacuum').get().auto_vacuum, 2);
});

test('only server editors change retention, with whole days up to ten years', async (t) => {
    const f = await roleFixture(t);
    const editors = await f.role('Channel editors', ['channels.edit']);
    await f.assign(f.member, [editors.id]);
    for (const [endpoint, method, body] of [
        ['/retention/server', 'PATCH', { retention: 30 }],
        ['/retention/dm', 'PATCH', { retention: 30 }],
        ['/retention/channels/general', 'PATCH', { retention: 30 }],
        ['/retention/preview?scope=server&retention=30', 'GET'],
        ['/storage', 'GET'],
    ])
        await f.api(f.member, endpoint, method, body, 403);
    for (const retention of [-1, 3651, 1.5, '30', null])
        await f.api(f.owner, '/retention/server', 'PATCH', { retention }, 400);
    await f.api(f.owner, '/retention/dm', 'PATCH', { retention: null }, 400);
    await f.api(f.owner, '/retention/server', 'PATCH', { retention: 30, applyNow: 'yes' }, 400);
    await f.api(f.owner, '/retention/everything', 'PATCH', { retention: 30 }, 404);
    await keepChannel(f, 'general', null);
    await f.api(f.owner, '/retention/channels/lounge', 'PATCH', { retention: 30 }, 400);
    await f.api(f.owner, '/retention/channels/missing', 'PATCH', { retention: 30 }, 404);
    // A server editor who can't see a private channel can't find it here either.
    const admins = await f.role('Server editors', ['server.edit']);
    await f.assign(f.other, [admins.id]);
    const hidden = await f.api(f.owner, '/channels', 'POST', {
        name: 'staff',
        kind: 'text',
        private: true,
    });
    await f.api(f.other, `/retention/channels/${hidden.id}`, 'PATCH', { retention: 30 }, 404);
    await f.api(f.other, '/retention/server', 'PATCH', { retention: 365 });
});

test('a shorter period waits a week; longer ones, and apply now, take effect at once', async (t) => {
    const f = await roleFixture(t);
    const old = await post(f, f.member, 'Forty days old');
    const recent = await post(f, f.member, 'Ten days old');
    age(f, old.id, 40);
    age(f, recent.id, 10);
    const { policy } = await keep(f, 'server', 30);
    assert.equal(policy.retention, 0);
    assert.equal(policy.retentionNext, 30);
    assert.ok(Math.abs(policy.retentionAt - (Date.now() + 7 * day)) < 5000);
    assert.equal(await sweep(f), 0);
    assert.ok(exists(f, old.id));
    // After the notice week the period applies and becomes the one in force.
    assert.equal(await sweep(f, 8), 1);
    assert.ok(!exists(f, old.id) && exists(f, recent.id));
    assert.deepEqual((await f.api(f.member, '/state')).retention.server, {
        retention: 30,
        retentionNext: null,
        retentionAt: null,
    });
    assert.equal((await keep(f, 'server', 0)).policy.retentionAt, null);
    // A milder change keeps the announced date; a stricter one restarts the notice.
    await keep(f, 'server', 14);
    f.db
        .prepare("UPDATE retention_policies SET retentionAt=retentionAt-? WHERE scope='server'")
        .run(day);
    const announced = f.db
        .prepare("SELECT retentionAt FROM retention_policies WHERE scope='server'")
        .get().retentionAt;
    assert.equal((await keep(f, 'server', 30)).policy.retentionAt, announced);
    assert.ok((await keep(f, 'server', 7)).policy.retentionAt > announced);
    // Saving the period in force cancels the change.
    assert.deepEqual((await keep(f, 'server', 0)).policy, {
        retention: 0,
        retentionNext: null,
        retentionAt: null,
    });
    age(f, recent.id, 30);
    assert.equal((await keep(f, 'server', 30, true)).policy.retention, 30);
    await sweep(f);
    assert.ok(!exists(f, recent.id));
});

test('a thread is deleted as a unit, with its replies, files and reactions', async (t) => {
    const f = await roleFixture(t);
    const active = await post(f, f.member, 'Old start, new reply');
    age(f, active.id, 40);
    const fresh = await post(f, f.other, 'Fresh reply', { thread: active.id });
    age(f, fresh.id, 5);
    const done = await post(f, f.member, 'Finished thread');
    await f.api(f.other, `/messages/${done.id}/reaction`, 'POST', { emoji: '👍' });
    const file = await upload(f, f.other, 'general', 'old.txt', 7, { thread: done.id });
    age(f, done.id, 40);
    age(f, file.id, 35);
    assert.equal(f.db.prepare('SELECT bytes FROM storage_usage').get().bytes, 7);
    await keep(f, 'server', 30, true);
    await sweep(f);
    assert.ok(exists(f, active.id) && exists(f, fresh.id));
    assert.ok(!exists(f, done.id) && !exists(f, file.id));
    for (const table of ['attachments', 'reactions'])
        assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
    assert.equal(f.db.prepare('SELECT bytes FROM storage_usage').get().bytes, 0);
});

test('pins keep a whole thread, and unpinning or deleting a pin restarts its clock', async (t) => {
    const f = await roleFixture(t);
    const events = listen(f, f.member, t);
    const pinnedRoot = await post(f, f.member, 'Pinned start');
    const root = await post(f, f.member, 'Thread with a pinned reply');
    const reply = await post(f, f.other, 'Pinned reply', { thread: root.id });
    const other = await post(f, f.member, 'Thread losing its pin');
    const lost = await post(f, f.other, 'Pinned, then deleted', { thread: other.id });
    const plain = await post(f, f.member, 'Never pinned');
    for (const message of [pinnedRoot, reply, lost])
        await f.api(f.owner, `/messages/${message.id}`, 'PATCH', { pinned: true });
    for (const message of [pinnedRoot, root, reply, other, lost, plain]) age(f, message.id, 40);
    await keep(f, 'server', 30, true);
    await sweep(f);
    for (const message of [pinnedRoot, root, reply, other, lost])
        assert.ok(exists(f, message.id), message.body);
    assert.ok(!exists(f, plain.id));
    // Unpinning the reply restarts the thread's clock and updates both messages.
    events.length = 0;
    const unpinned = await f.api(f.owner, `/messages/${reply.id}`, 'PATCH', { pinned: false });
    assert.ok(Math.abs(unpinned.retention.since - Date.now()) < 5000);
    assert.equal(unpinned.retention.kept, false);
    assert.deepEqual(
        events.filter((e) => e.event === 'message:update').map((e) => e.id),
        [reply.id, root.id],
    );
    // Unpinning something that isn't pinned leaves its clock alone.
    const before = since(f, root.id);
    await f.api(f.owner, `/messages/${root.id}`, 'PATCH', { pinned: false });
    assert.equal(since(f, root.id), before);
    // Deleting a pinned reply counts as unpinning it.
    await f.api(f.other, `/messages/${lost.id}`, 'DELETE');
    assert.ok(Math.abs(since(f, other.id) - Date.now()) < 5000);
    await sweep(f);
    assert.ok(exists(f, root.id) && exists(f, other.id));
    await sweep(f, 31);
    assert.ok(!exists(f, root.id) && !exists(f, other.id) && exists(f, pinnedRoot.id));
    // Members pin in their own direct messages, not in channels by default.
    await f.api(f.member, `/messages/${pinnedRoot.id}`, 'PATCH', { pinned: false }, 403);
    const direct = await f.api(f.member, '/messages', 'POST', {
        room: dm(f.member, f.owner),
        body: 'Pin me',
    });
    await f.api(f.member, `/messages/${direct.id}`, 'PATCH', { pinned: true });
});

test('running polls keep their thread until voting ends', async (t) => {
    const f = await roleFixture(t);
    const poll = { question: 'When?', answers: ['Now', 'Later'], hours: 24 };
    const standalone = await post(f, f.member, '', { poll });
    const root = await post(f, f.member, 'Thread with a poll');
    const inThread = await post(f, f.member, '', { thread: root.id, poll });
    for (const message of [standalone, root, inThread]) age(f, message.id, 40);
    const view = await f.api(f.member, `/messages/${root.id}`);
    assert.ok(view.retention.pollEnds > Date.now());
    await keep(f, 'server', 30, true);
    await sweep(f);
    for (const message of [standalone, root, inThread]) assert.ok(exists(f, message.id));
    f.db.prepare('UPDATE polls SET ends=?').run(Date.now() - 1);
    await sweep(f);
    for (const message of [standalone, root, inThread]) assert.ok(!exists(f, message.id));
});

test('channels override the server default and can return to it with notice', async (t) => {
    const f = await roleFixture(t);
    const general = await post(f, f.member, 'General');
    const intro = await post(f, f.member, 'Introductions', { room: 'introductions' });
    for (const message of [general, intro]) age(f, message.id, 40);
    // Forever is longer than the default, so it applies at once.
    assert.equal((await keepChannel(f, 'introductions', 0)).policy.retention, 0);
    await keep(f, 'server', 30, true);
    await sweep(f);
    assert.ok(!exists(f, general.id) && exists(f, intro.id));
    // Following the 30-day default again is shorter than forever, so it waits a week.
    const { policy } = await keepChannel(f, 'introductions', null);
    assert.equal(policy.retention, 0);
    assert.equal(policy.retentionNext, null);
    assert.ok(policy.retentionAt > Date.now());
    await sweep(f);
    assert.ok(exists(f, intro.id));
    await sweep(f, 8);
    assert.ok(!exists(f, intro.id));
    assert.equal(
        (await f.api(f.member, '/state')).channels.find((c) => c.id === 'introductions').retention,
        null,
    );
    // A coming server change reaches every channel that follows the default.
    await keep(f, 'server', 0);
    const later = await post(f, f.member, 'Later', { room: 'introductions' });
    age(f, later.id, 40);
    await keep(f, 'server', 30);
    await sweep(f);
    assert.ok(exists(f, later.id));
    await sweep(f, 8);
    assert.ok(!exists(f, later.id));
});

test('the direct message period covers every DM, personal notes included', async (t) => {
    const f = await roleFixture(t);
    const direct = await f.api(f.member, '/messages', 'POST', {
        room: dm(f.member, f.owner),
        body: 'Between two',
    });
    const note = await f.api(f.member, '/messages', 'POST', {
        room: dm(f.member, f.member),
        body: 'To myself',
    });
    const channel = await post(f, f.member, 'In a channel');
    for (const message of [direct, note, channel]) age(f, message.id, 40);
    await keep(f, 'dm', 30, true);
    await sweep(f);
    assert.ok(!exists(f, direct.id) && !exists(f, note.id) && exists(f, channel.id));
});

test('expired threads reach open apps in batches, only where members may read', async (t) => {
    const f = await roleFixture(t);
    const owner = listen(f, f.owner, t),
        member = listen(f, f.member, t),
        other = listen(f, f.other, t);
    const insert = f.db.prepare(
        'INSERT INTO messages(id,room,author,body,created,since) VALUES(?,?,?,?,?,?)',
    );
    const old = Date.now() - 40 * day;
    for (let i = 0; i < 250; i++)
        insert.run(`old-${i}`, 'general', f.member.user.id, `Old ${i}`, old, old);
    insert.run('old-direct', dm(f.owner, f.member), f.owner.user.id, 'Old DM', old, old);
    await keep(f, 'server', 30, true);
    await keep(f, 'dm', 30, true);
    await sweep(f);
    const expired = (events, room) =>
        events.filter((e) => e.event === 'messages:expired' && e.room === room);
    assert.deepEqual(
        expired(member, 'general').map((e) => e.ids.length),
        [100, 100, 50],
    );
    assert.equal(new Set(expired(other, 'general').flatMap((e) => e.ids)).size, 250);
    for (const events of [owner, member])
        assert.deepEqual(
            expired(events, dm(f.owner, f.member)).map((e) => e.ids),
            [['old-direct']],
        );
    assert.equal(expired(other, dm(f.owner, f.member)).length, 0);
});

test('a preview counts what a shorter period would delete, beyond today’s periods', async (t) => {
    const f = await roleFixture(t);
    const old = await upload(f, f.member, 'general', 'old.bin', 5);
    const pinned = await upload(f, f.member, 'general', 'pinned.bin', 9);
    const recent = await post(f, f.member, 'Three days old');
    await f.api(f.owner, `/messages/${pinned.id}`, 'PATCH', { pinned: true });
    age(f, old.id, 40);
    age(f, pinned.id, 40);
    age(f, recent.id, 3);
    const preview = (query) => f.api(f.owner, `/retention/preview?${query}`);
    const month = await preview('scope=server&retention=30');
    assert.ok(Math.abs(month.at - (Date.now() + 7 * day)) < 5000);
    assert.deepEqual(month.scheduled, { messages: 1, files: 1, bytes: 5 });
    assert.deepEqual(month.immediate, { messages: 1, files: 1, bytes: 5 });
    const week = await preview('scope=server&retention=7');
    assert.deepEqual(week.scheduled, { messages: 2, files: 1, bytes: 5 });
    assert.deepEqual(week.immediate, { messages: 1, files: 1, bytes: 5 });
    // Longer periods delete nothing more.
    assert.deepEqual(await preview('scope=server&retention=0'), {
        at: null,
        scheduled: { messages: 0, files: 0, bytes: 0 },
        immediate: { messages: 0, files: 0, bytes: 0 },
    });
    // A channel returning to a shorter default, and the direct message period.
    await keepChannel(f, 'general', 0);
    await keep(f, 'server', 30, true);
    await sweep(f);
    assert.ok(exists(f, old.id));
    assert.deepEqual((await preview('scope=channel&channel=general&retention=default')).scheduled, {
        messages: 1,
        files: 1,
        bytes: 5,
    });
    const direct = await f.api(f.member, '/messages', 'POST', {
        room: dm(f.member, f.owner),
        body: 'Old DM',
    });
    age(f, direct.id, 40);
    assert.deepEqual((await preview('scope=dm&retention=30')).immediate, {
        messages: 1,
        files: 0,
        bytes: 0,
    });
    await f.api(f.owner, '/retention/preview?scope=server&retention=soon', 'GET', undefined, 400);
    await f.api(f.owner, '/retention/preview?scope=channel&retention=30', 'GET', undefined, 404);
});

test('the storage overview totals attachments by conversation without naming DMs', async (t) => {
    const f = await roleFixture(t);
    const admins = await f.role('Server editors', ['server.edit']);
    await f.assign(f.other, [admins.id]);
    const hidden = await f.api(f.owner, '/channels', 'POST', {
        name: 'staff',
        kind: 'text',
        private: true,
    });
    const kept = await upload(f, f.member, 'general', 'kept.bin', 300);
    await upload(f, f.member, 'introductions', 'intro.bin', 20);
    await upload(f, f.owner, hidden.id, 'staff.bin', 40);
    await upload(f, f.member, dm(f.member, f.owner), 'direct.bin', 9);
    await f.api(f.owner, `/messages/${kept.id}`, 'PATCH', { pinned: true });
    const overview = await f.api(f.other, '/storage');
    assert.deepEqual(overview.attachments, {
        bytes: f.db.prepare('SELECT bytes FROM storage_usage').get().bytes,
        quota: 1024 ** 3,
    });
    assert.equal(overview.attachments.bytes, 369);
    const pages = (name) => f.db.prepare(`PRAGMA ${name}`).get()[name];
    assert.equal(overview.database.bytes, pages('page_count') * pages('page_size'));
    assert.deepEqual(overview.kept, { bytes: 300, files: 1 });
    assert.deepEqual(overview.channels, [
        { id: 'general', name: 'general', bytes: 300, files: 1 },
        { id: 'introductions', name: 'introductions', bytes: 20, files: 1 },
    ]);
    assert.deepEqual(overview.otherChannels, { bytes: 40, files: 1 });
    assert.deepEqual(overview.directMessages, { bytes: 9, files: 1 });
    assert.ok(!JSON.stringify(overview).includes('dm:'));
});

test('expired files give their space back to the disk, and closing waits for a sweep', async (t) => {
    const f = await roleFixture(t);
    const large = await upload(f, f.member, 'general', 'large.bin', 2 * 1024 * 1024);
    age(f, large.id, 40);
    const pages = (name) => f.db.prepare(`PRAGMA ${name}`).get()[name];
    const before = pages('page_count');
    await keep(f, 'server', 30, true);
    await sweep(f);
    assert.ok(!exists(f, large.id));
    assert.equal(pages('freelist_count'), 0);
    assert.ok(pages('page_count') < before - 400, `${pages('page_count')} of ${before}`);
    const running = sweep(f);
    await f.service.close();
    assert.equal(await running, 0);
});

const keepText = (f, value, applyNow) =>
    f.api(f.owner, '/retention/keep-text', 'PATCH', {
        keepText: value,
        ...(applyNow === undefined ? {} : { applyNow }),
    });
const files = (f, message) =>
    f.db
        .prepare('SELECT name,bytes,removed IS NOT NULL removed FROM attachments WHERE message=?')
        .all(message.id)
        .map((row) => ({ ...row }));
const card = (f, message) => {
    f.db
        .prepare(
            "INSERT OR IGNORE INTO link_previews(id,url,title,fetched) VALUES('card','https://example.com','Example',?)",
        )
        .run(Date.now());
    f.db
        .prepare("INSERT INTO message_link_previews(message,position,preview) VALUES(?,0,'card')")
        .run(message.id);
};

test('with text kept, a period removes only files and link cards, leaving placeholders', async (t) => {
    const f = await roleFixture(t);
    const events = listen(f, f.member, t);
    const old = await upload(f, f.member, 'general', 'old.png', 6);
    const text = await post(f, f.member, 'Old words with a link');
    card(f, text);
    const root = await post(f, f.member, 'Old thread');
    const reply = await upload(f, f.other, 'general', 'reply.txt', 4, { thread: root.id });
    const pinned = await upload(f, f.member, 'general', 'pinned.txt', 3);
    const recent = await upload(f, f.member, 'general', 'recent.txt', 2);
    await f.api(f.owner, `/messages/${pinned.id}`, 'PATCH', { pinned: true });
    for (const message of [old, text, root, reply, pinned]) age(f, message.id, 40);
    age(f, recent.id, 5);
    assert.deepEqual((await keepText(f, true)).mode, { keepText: true, keepTextUntil: null });
    await keep(f, 'server', 30, true);
    await sweep(f);
    for (const message of [old, text, root, reply, pinned, recent])
        assert.ok(exists(f, message.id), message.body);
    assert.deepEqual(files(f, old), [{ name: 'old.png', bytes: 0, removed: 1 }]);
    assert.deepEqual(files(f, reply), [{ name: 'reply.txt', bytes: 0, removed: 1 }]);
    assert.deepEqual(files(f, pinned), [{ name: 'pinned.txt', bytes: 3, removed: 0 }]);
    assert.deepEqual(files(f, recent), [{ name: 'recent.txt', bytes: 2, removed: 0 }]);
    assert.equal(f.db.prepare('SELECT bytes FROM storage_usage').get().bytes, 5);
    assert.equal(
        f.db.prepare("SELECT length(data) bytes FROM attachments WHERE name='old.png'").get().bytes,
        0,
    );
    // The link card is gone and stays gone if the text is edited.
    assert.equal((await f.api(f.member, `/messages/${text.id}`)).previews, undefined);
    assert.ok(f.db.prepare('SELECT 1 FROM hidden_link_previews WHERE message=?').get(text.id));
    // Placeholders keep the name and type; the files themselves are gone.
    const view = await f.api(f.member, `/messages/${old.id}`);
    assert.deepEqual(view.attachments, [
        {
            id: old.attachments[0].id,
            name: 'old.png',
            mime: 'application/octet-stream',
            removed: true,
        },
    ]);
    for (const endpoint of [
        `/attachments/${old.attachments[0].id}`,
        `/attachments/${old.attachments[0].id}/preview`,
    ])
        assert.match(
            (await f.api(f.member, endpoint, 'GET', undefined, 410)).error,
            /removed after the retention period/,
        );
    const removed = events.filter((e) => e.event === 'messages:files-removed');
    assert.equal(removed.length, 1);
    assert.deepEqual(new Set(removed[0].ids), new Set([old.id, text.id, root.id]));
    // A later pass finds nothing left to remove.
    await sweep(f);
    assert.equal(events.filter((e) => e.event === 'messages:files-removed').length, 1);
    // Removed files no longer count in the overview.
    const overview = await f.api(f.owner, '/storage');
    assert.deepEqual(overview.channels, [{ id: 'general', name: 'general', bytes: 5, files: 2 }]);
    assert.deepEqual(overview.kept, { bytes: 3, files: 1 });
});

test('no longer keeping text waits a week, then deletes the old messages', async (t) => {
    const f = await roleFixture(t);
    const editors = await f.role('Channel editors', ['channels.edit']);
    await f.assign(f.other, [editors.id]);
    await f.api(f.other, '/retention/keep-text', 'PATCH', { keepText: true }, 403);
    await f.api(f.owner, '/retention/keep-text', 'PATCH', { keepText: 'yes' }, 400);
    await f.api(
        f.owner,
        '/retention/preview?scope=keep-text&keepText=maybe',
        'GET',
        undefined,
        400,
    );
    const old = await upload(f, f.member, 'general', 'old.txt', 4);
    age(f, old.id, 40);
    await keepText(f, true);
    await keep(f, 'server', 30, true);
    await sweep(f);
    assert.ok(exists(f, old.id));
    // Turning text keeping on again would delete nothing more.
    assert.deepEqual(
        (await f.api(f.owner, '/retention/preview?scope=keep-text&keepText=true')).at,
        null,
    );
    const preview = await f.api(f.owner, '/retention/preview?scope=keep-text&keepText=false');
    assert.ok(Math.abs(preview.at - (Date.now() + 7 * day)) < 5000);
    assert.deepEqual(preview.scheduled, { messages: 1, files: 0, bytes: 0 });
    assert.deepEqual(preview.immediate, { messages: 1, files: 0, bytes: 0 });
    const { mode } = await keepText(f, false);
    assert.equal(mode.keepText, true);
    assert.ok(Math.abs(mode.keepTextUntil - (Date.now() + 7 * day)) < 5000);
    assert.equal((await f.api(f.member, '/state')).retention.keepTextUntil, mode.keepTextUntil);
    await sweep(f);
    assert.ok(exists(f, old.id));
    // Keeping text again cancels the change.
    assert.equal((await keepText(f, true)).mode.keepTextUntil, null);
    await keepText(f, false);
    await sweep(f, 8);
    assert.ok(!exists(f, old.id));
    assert.deepEqual(
        {
            keepText: (await f.api(f.member, '/state')).retention.keepText,
            keepTextUntil: (await f.api(f.member, '/state')).retention.keepTextUntil,
        },
        { keepText: false, keepTextUntil: null },
    );
    // Applying it now deletes at once.
    const another = await post(f, f.member, 'Another old message');
    age(f, another.id, 40);
    await keepText(f, true);
    await sweep(f);
    assert.ok(exists(f, another.id));
    assert.deepEqual((await keepText(f, false, true)).mode, {
        keepText: false,
        keepTextUntil: null,
    });
    await sweep(f);
    assert.ok(!exists(f, another.id));
});

test('with text kept, a preview counts the files a shorter period removes', async (t) => {
    const f = await roleFixture(t);
    const old = await upload(f, f.member, 'general', 'old.bin', 7);
    age(f, old.id, 40);
    await keepText(f, true);
    const preview = await f.api(f.owner, '/retention/preview?scope=server&retention=30');
    assert.deepEqual(preview.scheduled, { messages: 0, files: 1, bytes: 7 });
    assert.deepEqual(preview.immediate, { messages: 0, files: 1, bytes: 7 });
});
