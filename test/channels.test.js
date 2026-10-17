import { migratePermissions } from '../shared/permissions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createApp } from '../test-support/open-server.js';
import { migrate } from '../server/database.js';
import { request } from '../test-support/http.js';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'driskord-channels-'));
    let service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const signup = async (username) => {
        const response = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        });
        assert.equal(response.status, 200);
        return response.data;
    };
    const owner = await signup('Owner'),
        member = await signup('Member');
    const api = async (account, endpoint, method = 'GET', body, status = 200) => {
        const response = await request(service.app, endpoint, account.token, method, body);
        assert.equal(response.status, status, JSON.stringify(response.data));
        return response.data;
    };
    const access = (channel, mode, role = 'member') =>
        api(owner, `/channels/${channel}/access`, 'PUT', { permissions: [{ role, mode }] });
    return {
        owner,
        member,
        api,
        access,
        get service() {
            return service;
        },
        async restart() {
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}

test('protected channels can be renamed; additional channel deletion cascades and survives restart', async (t) => {
    const f = await fixture(t),
        { owner, member, api } = f;
    let state = await api(owner, '/state');
    assert.deepEqual(
        state.channels
            .filter((c) => c.protected)
            .map((c) => c.kind)
            .sort(),
        ['text', 'voice'],
    );
    await api(owner, '/channels/general', 'PATCH', { name: 'New General' });
    await api(owner, '/channels/lounge', 'PATCH', { name: 'The Voice Room' });
    await api(owner, '/channels/general', 'DELETE', undefined, 409);
    await api(owner, '/channels/lounge', 'DELETE', undefined, 409);
    assert.throws(
        () => f.service.db.prepare('DELETE FROM channels WHERE id=?').run('general'),
        /protected/,
    );
    assert.throws(
        () => f.service.db.prepare("UPDATE channels SET protected=0 WHERE id='lounge'").run(),
        /cannot change/,
    );
    assert.throws(
        () => f.service.db.prepare("UPDATE channels SET kind=NULL WHERE id='general'").run(),
        /cannot change/,
    );
    const text = await api(owner, '/channels', 'POST', { name: 'Temporary', kind: 'text' });
    const voice = await api(owner, '/channels', 'POST', { name: 'Temporary Voice', kind: 'voice' });
    const msg = await api(member, '/messages', 'POST', {
        room: text.id,
        body: 'temporary',
        attachment: { name: 'file', data: 'aGVsbG8=' },
    });
    await api(member, `/messages/${msg.id}/reaction`, 'POST', { emoji: '👍' });
    await api(member, `/channels/${voice.id}`, 'DELETE', undefined, 403);
    await api(owner, `/channels/${text.id}`, 'DELETE');
    await api(owner, `/channels/${voice.id}`, 'DELETE');
    await api(owner, '/channels/introductions', 'DELETE');
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachments').get().n, 0);
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM reactions').get().n, 0);
    assert.equal(f.service.db.prepare('SELECT bytes FROM storage_usage').get().bytes, 0);
    await f.restart();
    state = await api(owner, '/state');
    assert.equal(state.channels.length, 2);
    assert.equal(state.channels.find((c) => c.id === 'general').name, 'new-general');
    assert.equal(state.channels.find((c) => c.id === 'lounge').name, 'The Voice Room');
    await api(owner, `/messages?room=${text.id}`, 'GET', undefined, 403);
    await api(member, `/attachments/${msg.attachments[0].id}`, 'GET', undefined, 404);
});

test('read-only channels block posting, editing and moderation; hidden denies history and files', async (t) => {
    const f = await fixture(t);
    const { owner, member, api, access } = f;
    const managerRole = await api(owner, '/roles', 'POST', {
        name: 'Managers',
        color: '#abcdef',
        permissions: migratePermissions(['send', 'voice', 'manage']),
    });
    await api(owner, `/users/${member.user.id}/role`, 'PATCH', { role: managerRole.id });
    const msg = await api(member, '/messages', 'POST', {
        room: 'general',
        body: 'Original',
        attachment: { name: 'file', data: 'aGVsbG8=' },
    });
    await access('general', 'read-only', managerRole.id);
    assert.equal(
        (await api(member, '/state')).channels.find((c) => c.id === 'general').access,
        'read-only',
    );
    assert.equal((await api(member, '/messages?room=general'))[0].id, msg.id);
    assert.equal((await api(member, `/attachments/${msg.attachments[0].id}`)).toString(), 'hello');
    for (const [endpoint, method, body] of [
        ['/messages', 'POST', { room: 'general', body: 'blocked' }],
        [`/messages/${msg.id}/reaction`, 'POST', { emoji: '👍' }],
        [`/messages/${msg.id}`, 'PATCH', { body: 'blocked' }],
        [`/messages/${msg.id}`, 'PATCH', { pinned: true }],
    ])
        await api(member, endpoint, method, body, 403);
    await api(owner, `/messages/${msg.id}`, 'PATCH', { pinned: true });
    await access('general', 'hidden', managerRole.id);
    const hidden = await api(member, '/state');
    assert.equal(
        hidden.channels.some((c) => c.id === 'general'),
        false,
    );
    assert.equal(
        hidden.channelPermissions.some((c) => c.channel === 'general'),
        false,
    );
    await api(member, '/messages?room=general', 'GET', undefined, 403);
    await api(member, `/attachments/${msg.attachments[0].id}`, 'GET', undefined, 404);
    await api(member, '/channels/general', 'PATCH', { name: 'discovered' }, 404);
    const dm = `dm:${[owner.user.id, member.user.id].sort().join(':')}`;
    await api(member, '/messages', 'POST', { room: dm, body: 'DM unaffected' });
    await access('general', 'full', managerRole.id);
    await api(member, `/messages/${msg.id}`, 'PATCH', { body: 'Restored' });
    await access('general', 'read-only', managerRole.id);
    await f.restart();
    assert.equal(
        (await api(member, '/state')).channels.find((channel) => channel.id === 'general').access,
        'read-only',
    );
    await api(member, `/messages/${msg.id}`, 'PATCH', { body: 'Still denied after restart' }, 403);
    // Deleting your own content is independent of posting permission and read-only mode.
    await api(member, `/messages/${msg.id}`, 'DELETE');
});

test('channel permissions validate roles/modes atomically and do not override global permissions', async (t) => {
    const { owner, member, api, access } = await fixture(t);
    await access('lounge', 'hidden');
    assert.equal(
        (await api(member, '/state')).channels.some((c) => c.id === 'lounge'),
        false,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        { permissions: [{ role: 'member', mode: 'read-only' }] },
        400,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        { permissions: [{ role: 'owner', mode: 'hidden' }] },
        400,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        { permissions: [{ role: 'missing', mode: 'full' }] },
        400,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        {
            permissions: [
                { role: 'member', mode: 'full' },
                { role: 'member', mode: 'hidden' },
            ],
        },
        400,
    );
    assert.equal(
        (await api(member, '/state')).channels.some((c) => c.id === 'lounge'),
        false,
    );
    await api(member, '/channels/general/access', 'PUT', { permissions: [] }, 403);
    const role = await api(owner, '/roles', 'POST', {
        name: 'No writing',
        color: '#abcdef',
        permissions: [],
    });
    await api(owner, `/users/${member.user.id}/role`, 'PATCH', { role: role.id });
    const state = await api(member, '/state');
    assert.equal(
        state.channels.some((c) => c.kind === 'voice'),
        true,
    );
    assert.equal(state.channels.find((c) => c.id === 'general').access, 'full');
    await api(member, '/messages', 'POST', { room: 'general', body: 'denied' }, 403);
});

test('legacy custom channel names are retained and one channel of each type becomes permanent', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.exec(
            "INSERT INTO channels VALUES('custom-text','Our Chat','text'),('custom-voice','Our Voice','voice')",
        );
        migrate(db);
        migrate(db);
        const channels = db.prepare('SELECT * FROM channels').all();
        assert.equal(channels.length, 2);
        assert.equal(
            channels.every((c) => c.protected === 1),
            true,
        );
        assert.deepEqual(
            channels.map((c) => c.name),
            ['Our Chat', 'Our Voice'],
        );
    } finally {
        db.close();
    }
});

test('channel ordering is type-specific, manager-only, persistent and preserves hidden channels', async (t) => {
    const f = await fixture(t),
        { owner, member, api } = f;
    const text = await api(owner, '/channels', 'POST', { name: 'another-text', kind: 'text' });
    const voice = await api(owner, '/channels', 'POST', { name: 'Another voice', kind: 'voice' });
    await api(member, `/channels/${text.id}/move`, 'POST', { direction: 'up' }, 403);
    await api(owner, `/channels/${text.id}/move`, 'POST', { direction: 'sideways' }, 400);
    await api(owner, `/channels/${text.id}/move`, 'POST', { direction: 'up' });
    let state = await api(owner, '/state');
    assert.deepEqual(
        state.channels.filter((c) => c.kind === 'text').map((c) => c.id),
        ['general', text.id, 'introductions'],
    );
    assert.deepEqual(
        state.channels.filter((c) => c.kind === 'voice').map((c) => c.id),
        ['lounge', voice.id],
    );
    assert.deepEqual(
        state.channels.map((c) => c.kind),
        ['text', 'text', 'text', 'voice', 'voice'],
    );
    await api(owner, '/channels/general/move', 'POST', { direction: 'down' });
    await api(owner, `/channels/${voice.id}/move`, 'POST', { direction: 'up' });
    await f.restart();
    state = await api(owner, '/state');
    assert.deepEqual(
        state.channels.filter((c) => c.kind === 'text').map((c) => c.id),
        [text.id, 'general', 'introductions'],
    );
    assert.deepEqual(
        state.channels.filter((c) => c.kind === 'voice').map((c) => c.id),
        [voice.id, 'lounge'],
    );
    // An edge move is a successful no-op.
    await api(owner, `/channels/${voice.id}/move`, 'POST', { direction: 'up' });
    const role = await api(owner, '/roles', 'POST', {
        name: 'Manager',
        color: '#123456',
        permissions: migratePermissions(['manage', 'send', 'voice']),
    });
    await api(owner, `/users/${member.user.id}/role`, 'PATCH', { role: role.id });
    await api(owner, `/channels/general/access`, 'PUT', {
        permissions: [{ role: role.id, mode: 'hidden' }],
    });
    await api(member, '/channels/general/move', 'POST', { direction: 'up' }, 404);
    const before = (await api(owner, '/state')).channels.find((c) => c.id === 'general').position;
    await api(member, '/channels/introductions/move', 'POST', { direction: 'up' });
    state = await api(owner, '/state');
    assert.equal(state.channels.find((c) => c.id === 'general').position, before);
    assert.deepEqual(
        state.channels.filter((c) => c.kind === 'text').map((c) => c.id),
        ['introductions', 'general', text.id],
    );
    // New channels append after existing channels of their type.
    const last = await api(owner, '/channels', 'POST', { name: 'last', kind: 'text' });
    assert.equal(
        (await api(owner, '/state')).channels.filter((c) => c.kind === 'text').at(-1).id,
        last.id,
    );
});

test('channel descriptions are owner/manager editable, persisted, and independent of renames', async (t) => {
    const f = await fixture(t);
    const { owner, member, api } = f;
    const description = async () =>
        (await api(owner, '/state')).channels.find((c) => c.id === 'general').description;
    assert.equal(await description(), 'A place for everyday conversations.');
    await api(member, '/channels/general', 'PATCH', { description: 'Not permitted' }, 403);
    await api(owner, '/channels/general', 'PATCH', { description: '  News and daily updates  ' });
    assert.equal(await description(), 'News and daily updates');
    await api(owner, '/channels/general', 'PATCH', { name: 'Community' });
    assert.equal(await description(), 'News and daily updates');
    const moderator = await api(owner, '/roles', 'POST', {
        name: 'Moderator',
        color: '#abcdef',
        permissions: migratePermissions(['manage', 'send', 'voice']),
    });
    await api(owner, `/users/${member.user.id}/role`, 'PATCH', { role: moderator.id });
    await api(member, '/channels/general', 'PATCH', { description: 'Moderator update' });
    await f.restart();
    assert.equal(await description(), 'Moderator update');
    for (const bad of [null, 12, 'x'.repeat(201), 'two\nlines', 'control\u0000'])
        await api(
            owner,
            '/channels/general',
            'PATCH',
            { name: 'Should not change', description: bad },
            400,
        );
    const channel = (await api(owner, '/state')).channels.find((c) => c.id === 'general');
    assert.equal(channel.name, 'community');
    assert.equal(channel.description, 'Moderator update');
    await api(owner, '/channels/lounge', 'PATCH', { description: 'Voice description' }, 400);
    await api(owner, '/channels/general', 'PATCH', {}, 400);
    await api(member, '/channels/general', 'PATCH', { description: '   ' });
    assert.equal(await description(), '');
    const added = await api(owner, '/channels', 'POST', { name: 'new-topic', kind: 'text' });
    assert.equal(
        (await api(owner, '/state')).channels.find((c) => c.id === added.id).description,
        'A place for everyday conversations.',
    );
});

test('upgrading existing channels supplies descriptions once without overwriting edits', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.exec(
            "INSERT INTO channels(id,name,kind) VALUES('text','Text','text'),('voice','Voice','voice')",
        );
        migrate(db);
        assert.equal(
            db.prepare("SELECT description FROM channels WHERE id='text'").get().description,
            'A place for everyday conversations.',
        );
        assert.equal(
            db.prepare("SELECT description FROM channels WHERE id='voice'").get().description,
            '',
        );
        db.prepare("UPDATE channels SET description='Edited' WHERE id='text'").run();
        migrate(db);
        assert.equal(
            db.prepare("SELECT description FROM channels WHERE id='text'").get().description,
            'Edited',
        );
    } finally {
        db.close();
    }
});

test('drop reordering preserves channel types, denies hidden targets and persists', async (t) => {
    const f = await fixture(t),
        { api, owner, member } = f;
    const last = await api(owner, '/channels', 'POST', { name: 'last', kind: 'text' });
    await api(member, `/channels/${last.id}/drop`, 'POST', { target: 'general' }, 403);
    await api(owner, `/channels/${last.id}/drop`, 'POST', { target: 'lounge' }, 400);
    await api(owner, `/channels/${last.id}/drop`, 'POST', { target: 'missing' }, 400);
    await api(owner, `/channels/${last.id}/drop`, 'POST', { target: 'general' });
    assert.equal((await api(owner, '/state')).channels[0].id, last.id);
    await f.restart();
    assert.equal((await api(owner, '/state')).channels[0].id, last.id);
    await api(owner, `/channels/${last.id}/drop`, 'POST', { target: last.id });
    assert.equal((await api(owner, '/state')).channels[0].id, last.id);
    const role = await api(owner, '/roles', 'POST', {
        name: 'Sorter',
        color: '#aabbcc',
        permissions: ['channels.reorder'],
    });
    await api(owner, `/users/${member.user.id}/role`, 'PATCH', { role: role.id });
    await f.access('general', 'hidden', role.id);
    await api(member, `/channels/${last.id}/drop`, 'POST', { target: 'general' }, 400);
    await api(member, '/channels/general/drop', 'POST', { target: last.id }, 404);
});

test('server icon and server/channel reaction display settings validate permissions and persist', async (t) => {
    const f = await fixture(t),
        { api, owner, member } = f;
    const { default: sharp } = await import('sharp');
    const icon = (
        await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff8844' } })
            .png()
            .toBuffer()
    ).toString('base64');
    await api(member, '/settings', 'PATCH', { icon }, 403);
    await api(owner, '/settings', 'PATCH', { name: 'Should not save', icon: 'not-png' }, 400);
    assert.notEqual((await api(owner, '/state')).name, 'Should not save');
    await api(owner, '/settings', 'PATCH', { icon, reactionAuthors: false });
    await api(member, '/channels/general', 'PATCH', { reactionAuthors: false }, 403);
    await api(owner, '/channels/general', 'PATCH', { reactionAuthors: false });
    await api(owner, '/channels/lounge', 'PATCH', { reactionAuthors: false }, 400);
    await api(
        owner,
        '/channels/general',
        'PATCH',
        { name: 'should-not-save', reactionAuthors: 'false' },
        400,
    );
    await f.restart();
    const state = await api(member, '/state');
    assert.equal(state.icon, icon);
    assert.equal(state.reactionAuthors, false);
    assert.equal(state.channels.find((c) => c.id === 'general').reactionAuthors, 0);
    assert.equal(state.channels.find((c) => c.id === 'general').name, 'general');
    await api(owner, '/settings', 'PATCH', { icon: null, reactionAuthors: true });
    assert.equal((await api(member, '/state')).icon, null);
});

test('owner can remove and restore members while retaining history and revoking every session', async (t) => {
    const f = await fixture(t),
        { api, owner, member } = f;
    const message = await api(member, '/messages', 'POST', {
        room: 'general',
        body: 'Keep history',
    });
    const login = () =>
        request(f.service.app, '/auth/login', null, 'POST', {
            username: 'Member',
            password: 'test-password-123',
        });
    const other = (await login()).data;
    await api(member, `/users/${owner.user.id}/access`, 'POST', { enabled: false }, 403);
    await api(owner, `/users/${owner.user.id}/access`, 'POST', { enabled: false }, 409);
    await api(owner, `/users/${member.user.id}/access`, 'POST', { enabled: false });
    await api(member, '/state', 'GET', undefined, 401);
    await api(other, '/state', 'GET', undefined, 401);
    assert.equal((await login()).status, 401);
    const state = await api(owner, '/state');
    assert.equal(
        state.users.some((u) => u.id === member.user.id),
        false,
    );
    assert.equal(state.removedUsers[0].id, member.user.id);
    assert.equal(
        f.service.db.prepare('SELECT body FROM messages WHERE id=?').get(message.id).body,
        'Keep history',
    );
    await f.restart();
    assert.equal((await login()).status, 401);
    await api(owner, `/users/${member.user.id}/access`, 'POST', { enabled: true });
    assert.equal((await login()).status, 200);
    await api(member, '/state', 'GET', undefined, 401);
});

test('channel drops move in both directions, reach either end, and reject invalid placements atomically', async (t) => {
    const { owner, api } = await fixture(t);
    const last = await api(owner, '/channels', 'POST', { name: 'last', kind: 'text' });
    const order = async () =>
        (await api(owner, '/state')).channels.filter((c) => c.kind === 'text').map((c) => c.id);
    await api(owner, '/channels/general/drop', 'POST', { target: last.id, placement: 'after' });
    assert.deepEqual(await order(), ['introductions', last.id, 'general']);
    await api(owner, '/channels/general/drop', 'POST', {
        target: 'introductions',
        placement: 'before',
    });
    assert.deepEqual(await order(), ['general', 'introductions', last.id]);
    await api(owner, '/channels/general/drop', 'POST', {
        target: 'introductions',
        placement: 'after',
    });
    assert.deepEqual(await order(), ['introductions', 'general', last.id]);
    await api(owner, `/channels/${last.id}/drop`, 'POST', {
        target: 'general',
        placement: 'before',
    });
    assert.deepEqual(await order(), ['introductions', last.id, 'general']);
    await api(
        owner,
        '/channels/general/drop',
        'POST',
        { target: last.id, placement: 'sideways' },
        400,
    );
    assert.deepEqual(await order(), ['introductions', last.id, 'general']);
});
