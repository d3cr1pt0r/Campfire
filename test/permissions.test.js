import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
import { migrate } from '../server/database.js';
import { permissionIds } from '../shared/permissions.js';
async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-permissions-'));
    let service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const api = async (account, endpoint, method = 'GET', body, expected = 200) => {
        const response = await request(service.app, endpoint, account?.token, method, body);
        assert.equal(
            response.status,
            expected,
            `${method} ${endpoint}: ${JSON.stringify(response.data)}`,
        );
        return response.data;
    };
    const signup = (username) =>
        api(null, '/auth/register', 'POST', {
            username,
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        });
    const owner = await signup('Owner'),
        member = await signup('Member');
    const flags = (permissions) =>
        api(owner, '/roles/member', 'PATCH', { name: 'Member', color: '#abcdef', permissions });
    return {
        api,
        owner,
        member,
        flags,
        get service() {
            return service;
        },
        restart: async () => {
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}
test('legacy roles expand once, preserve channel overrides, and new API rejects legacy/unknown permissions', async (t) => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.prepare('INSERT INTO roles VALUES(?,?,?,?)').run(
            'member',
            'Member',
            '#ffffff',
            JSON.stringify(['send', 'voice', 'manage']),
        );
        migrate(db);
        assert.deepEqual(
            JSON.parse(
                db.prepare("SELECT permissions FROM roles WHERE id='member'").get().permissions,
            ).sort(),
            [...permissionIds].sort(),
        );
        db.prepare("UPDATE roles SET permissions='[]' WHERE id='member'").run();
        migrate(db);
        assert.equal(
            db.prepare("SELECT permissions FROM roles WHERE id='member'").get().permissions,
            '[]',
        );
    } finally {
        db.close();
    }
    const f = await fixture(t);
    for (const permissions of [
        ['send'],
        ['voice'],
        ['manage'],
        ['administrator'],
        ['calls.join', 'typo'],
    ])
        await f.api(
            f.owner,
            '/roles',
            'POST',
            { name: 'Invalid', color: '#abcdef', permissions },
            400,
        );
    await f.api(f.owner, '/roles/member/access', 'PUT', {
        channelAccess: [{ channel: 'general', mode: 'read-only' }],
    });
    await f.flags(['reactions.add']);
    await f.restart();
    const state = await f.api(f.owner, '/state');
    assert.deepEqual(state.roles.find((r) => r.id === 'member').permissions, ['reactions.add']);
    assert.equal(
        state.channelPermissions.find((p) => p.role === 'member' && p.channel === 'general').mode,
        'read-only',
    );
});
test('messages, attachments, reactions, own edits and deletion have independent checks', async (t) => {
    const f = await fixture(t),
        { api, owner, member, flags } = f;
    await flags(['messages.send']);
    const message = await api(member, '/messages', 'POST', { room: 'general', body: 'Hello' });
    await api(
        member,
        '/messages',
        'POST',
        { room: 'general', body: 'File', attachment: { name: 'a.txt', data: 'aGk=' } },
        403,
    );
    await api(member, `/messages/${message.id}/reaction`, 'POST', { emoji: '👍' }, 403);
    await api(member, `/messages/${message.id}`, 'PATCH', { body: 'Edit' }, 403);
    await api(member, `/messages/${message.id}`, 'DELETE', undefined, 403);
    await flags(['reactions.add']);
    await api(member, `/messages/${message.id}/reaction`, 'POST', { emoji: '👍' });
    await api(member, '/messages', 'POST', { room: 'general', body: 'No sending' }, 403);
    await flags(['messages.editOwn']);
    await api(member, `/messages/${message.id}`, 'PATCH', { body: 'Edit without sending' });
    const other = await api(owner, '/messages', 'POST', { room: 'general', body: 'Owner message' });
    await api(member, `/messages/${other.id}`, 'PATCH', { body: 'Not mine' }, 403);
    await flags(['messages.send', 'files.attach']);
    await api(member, '/messages', 'POST', {
        room: 'general',
        attachment: { name: 'a.txt', data: 'aGk=' },
    });
    await flags(['files.attach']);
    await api(
        member,
        '/messages',
        'POST',
        { room: 'general', attachment: { name: 'a.txt', data: 'aGk=' } },
        403,
    );
    await flags(['messages.deleteOwn']);
    await api(owner, '/roles/member/access', 'PUT', {
        channelAccess: [{ channel: 'general', mode: 'read-only' }],
    });
    await api(member, `/messages/${message.id}`, 'DELETE');
    await api(member, `/messages/${other.id}`, 'DELETE', undefined, 403);
});
test('thread creation and existing-thread replies require their own permissions', async (t) => {
    const f = await fixture(t),
        { api, owner, member, flags } = f;
    const root = await api(owner, '/messages', 'POST', { room: 'general', body: 'Start here' });
    const body = { room: 'general', body: 'Reply', thread: root.id };
    await flags(['messages.send', 'threads.reply']);
    await api(member, '/messages', 'POST', body, 403);
    await flags(['messages.send', 'threads.create']);
    await api(member, '/messages', 'POST', body, 403);
    await flags(['messages.send', 'threads.create', 'threads.reply']);
    await api(member, '/messages', 'POST', body);
    await flags(['messages.send', 'threads.reply']);
    await api(member, '/messages', 'POST', body);
    await flags(['messages.send', 'threads.create']);
    await api(member, '/messages', 'POST', body, 403);
});
test('pinning and moderation do not grant posting, editing, private-message deletion or hidden-channel access', async (t) => {
    const f = await fixture(t),
        { api, owner, member, flags } = f;
    const message = await api(owner, '/messages', 'POST', { room: 'general', body: 'Moderate me' });
    await flags(['messages.pin']);
    await api(member, `/messages/${message.id}`, 'PATCH', { pinned: true });
    await api(member, `/messages/${message.id}`, 'DELETE', undefined, 403);
    await api(member, `/messages/${message.id}`, 'PATCH', { pinned: false, body: 'Bypass' }, 403);
    assert.equal((await api(owner, `/messages/${message.id}`)).pinned, 1);
    await flags(['messages.deleteOthers']);
    await api(member, `/messages/${message.id}`, 'PATCH', { pinned: false }, 403);
    const dm = await api(owner, '/messages', 'POST', {
        room: `dm:${owner.user.id}:${member.user.id}`,
        body: 'Private',
    });
    await api(member, `/messages/${dm.id}`, 'DELETE', undefined, 403);
    await api(member, `/messages/${message.id}`, 'DELETE');
    const secret = await api(owner, '/messages', 'POST', { room: 'general', body: 'Hidden' });
    await api(owner, '/roles/member/access', 'PUT', {
        channelAccess: [{ channel: 'general', mode: 'hidden' }],
    });
    await api(member, `/messages/${secret.id}`, 'DELETE', undefined, 404);
});
test('channel creation, editing, deletion, ordering and general server editing are separate', async (t) => {
    const f = await fixture(t),
        { api, owner, member, flags } = f;
    await flags(['channels.edit']);
    await api(member, '/channels/general', 'PATCH', { description: 'Editor only' });
    await api(member, '/channels', 'POST', { name: 'nope', kind: 'text' }, 403);
    await api(member, '/channels/general/move', 'POST', { direction: 'down' }, 403);
    await api(member, '/channels/introductions', 'DELETE', undefined, 403);
    await api(member, '/settings', 'PATCH', { name: 'Nope' }, 403);
    await flags(['channels.create']);
    const added = await api(member, '/channels', 'POST', { name: 'created', kind: 'text' });
    await api(member, `/channels/${added.id}`, 'PATCH', { name: 'nope' }, 403);
    await flags(['channels.reorder']);
    await api(member, `/channels/${added.id}/move`, 'POST', { direction: 'up' });
    await flags(['channels.delete']);
    await api(member, `/channels/${added.id}`, 'DELETE');
    await flags(['server.edit']);
    await api(member, '/settings', 'PATCH', { name: 'New name' });
    await api(member, '/registration', 'PATCH', { mode: 'open' }, 403);
    await api(
        member,
        '/roles',
        'POST',
        { name: 'Nope', color: '#abcdef', permissions: permissionIds },
        403,
    );
    await api(
        member,
        '/roles/member',
        'PATCH',
        { name: 'Nope', color: '#abcdef', permissions: permissionIds },
        403,
    );
    await api(member, `/users/${member.user.id}/role`, 'PATCH', { role: 'owner' }, 403);
});
test('role-first access validates atomically and cannot expose channels hidden from the editor', async (t) => {
    const f = await fixture(t),
        { api, owner, member, flags } = f;
    await flags(['channels.access']);
    const role = await api(owner, '/roles', 'POST', {
        name: 'Guest',
        color: '#abcdef',
        permissions: [],
        channelAccess: [
            { channel: 'general', mode: 'read-only' },
            { channel: 'lounge', mode: 'hidden' },
        ],
    });
    await api(member, `/roles/${role.id}/access`, 'PUT', {
        channelAccess: [{ channel: 'introductions', mode: 'hidden' }],
    });
    await api(owner, '/roles/member/access', 'PUT', {
        channelAccess: [{ channel: 'general', mode: 'hidden' }],
    });
    await api(
        member,
        `/roles/${role.id}/access`,
        'PUT',
        {
            channelAccess: [
                { channel: 'introductions', mode: 'full' },
                { channel: 'general', mode: 'full' },
            ],
        },
        404,
    );
    assert.equal(
        (await api(owner, '/state')).channelPermissions.find(
            (p) => p.role === role.id && p.channel === 'introductions',
        ).mode,
        'hidden',
    );
    await api(member, '/roles/owner/access', 'PUT', { channelAccess: [] }, 400);
    await api(
        owner,
        `/roles/${role.id}/access`,
        'PUT',
        { channelAccess: [{ channel: 'lounge', mode: 'read-only' }] },
        400,
    );
    await api(
        owner,
        `/roles/${role.id}/access`,
        'PUT',
        {
            channelAccess: [
                { channel: 'lounge', mode: 'full' },
                { channel: 'lounge', mode: 'hidden' },
            ],
        },
        400,
    );
    await api(
        owner,
        `/roles/${role.id}`,
        'PATCH',
        {
            name: 'Should rollback',
            color: '#abcdef',
            permissions: ['messages.send'],
            channelAccess: [{ channel: 'missing', mode: 'full' }],
        },
        404,
    );
    assert.equal((await api(owner, '/state')).roles.find((r) => r.id === role.id).name, 'Guest');
    await flags([]);
    await api(member, `/roles/${role.id}/access`, 'PUT', { channelAccess: [] }, 403);
});

test('custom emoji upload and removal of other authors have separate permissions', async (t) => {
    const { default: sharp } = await import('sharp');
    const data = (
        await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } })
            .png()
            .toBuffer()
    ).toString('base64');
    const f = await fixture(t),
        { api, owner, member, flags } = f;
    const emoji = await api(owner, '/emojis', 'POST', { name: 'owner_emoji', data });
    await flags(['messages.send']);
    await api(member, '/emojis', 'POST', { name: 'member_emoji', data }, 403);
    await api(member, `/emojis/${emoji.id}`, 'DELETE', undefined, 403);
    await flags(['emojis.upload']);
    const mine = await api(member, '/emojis', 'POST', { name: 'member_emoji', data });
    await api(member, `/emojis/${mine.id}`, 'DELETE');
    await api(member, `/emojis/${emoji.id}`, 'DELETE', undefined, 403);
    await flags(['emojis.deleteOthers']);
    await api(member, `/emojis/${emoji.id}`, 'DELETE');
    await api(member, '/emojis', 'POST', { name: 'denied_emoji', data }, 403);
});
