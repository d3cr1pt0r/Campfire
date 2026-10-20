import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFixture } from '../test-support/role-fixture.js';
import { memberPermissions, permissionIds } from '../shared/permissions.js';

test('assigned grants combine without Default, and role allows win over role denies regardless of order', async (t) => {
    const f = await roleFixture(t),
        deny = await f.role('Deny'),
        allow = await f.role('Allow');
    await f.assign(f.member, [deny.id, allow.id]);
    await f.override('everyone', [
        { channel: 'general', permission: 'messages.send', effect: 'deny' },
    ]);
    await f.override(deny.id, [
        { channel: 'general', permission: 'messages.send', effect: 'deny' },
    ]);
    await f.override(allow.id, [
        { channel: 'general', permission: 'messages.send', effect: 'allow' },
    ]);
    await f.api(f.member, '/messages', 'POST', { room: 'general', body: 'Allowed' });
    await f.api(f.owner, `/roles/${deny.id}/move`, 'POST', { direction: 'up' });
    await f.api(f.member, '/messages', 'POST', { room: 'general', body: 'Still allowed' });
    await f.assign(f.member, [deny.id]);
    await f.api(f.member, '/messages', 'POST', { room: 'general', body: 'Denied' }, 403);
    await f.override(deny.id, [
        { channel: 'general', permission: 'messages.send', effect: 'inherit' },
    ]);
    await f.api(
        f.member,
        '/messages',
        'POST',
        { room: 'general', body: 'Baseline deny still applies' },
        403,
    );
});
test('announcement channels allow reactions, threads and moderation independently of posting', async (t) => {
    const f = await roleFixture(t),
        moderator = await f.role('Mod', [
            'messages.pin',
            'messages.deleteOthers',
            'threads.create',
            'threads.reply',
            'reactions.add',
            'files.attach',
        ]);
    await f.assign(f.member, [moderator.id]);
    const message = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        body: 'Announcement',
    });
    await f.override('everyone', [
        { channel: 'general', permission: 'messages.send', effect: 'deny' },
    ]);
    await f.api(f.member, '/messages', 'POST', { room: 'general', body: 'Cannot post' }, 403);
    await f.api(f.member, `/messages/${message.id}/reaction`, 'POST', { emoji: '👍' });
    await f.api(f.member, `/messages/${message.id}`, 'PATCH', { pinned: true });
    const reply = await f.api(f.member, '/messages', 'POST', {
        room: 'general',
        thread: message.id,
        body: 'Reply',
        attachments: [{ name: 'note.txt', data: 'aGk=' }],
    });
    await f.api(f.member, `/messages/${reply.id}`, 'PATCH', { body: 'Edit my reply' });
    await f.api(f.member, `/messages/${message.id}`, 'DELETE');
});
test('own edits/deletes and DMs remain available when channel sending is denied', async (t) => {
    const f = await roleFixture(t);
    const own = await f.api(f.member, '/messages', 'POST', { room: 'general', body: 'Mine' });
    await f.api(f.owner, `/roles/${f.participantRole}`, 'PATCH', {
        name: 'Member',
        color: null,
        permissions: ['channels.view'],
    });
    await f.api(
        f.member,
        '/messages',
        'POST',
        { room: 'general', body: 'No channel posting' },
        403,
    );
    await f.api(f.member, `/messages/${own.id}`, 'PATCH', { body: 'Still mine' });
    const room = 'dm:' + [f.member.user.id, f.owner.user.id].sort().join(':');
    const dm = await f.api(f.member, '/messages', 'POST', { room, body: 'Direct message' });
    await f.api(f.member, `/messages/${dm.id}`, 'PATCH', { pinned: true });
    await f.api(f.owner, `/messages/${dm.id}`, 'DELETE', undefined, 403);
    await f.api(f.member, `/messages/${own.id}`, 'DELETE');
    await f.api(f.member, `/messages/${dm.id}`, 'DELETE');
});
test('private channels require explicit visibility and new roles do not gain access', async (t) => {
    const f = await roleFixture(t);
    const channel = await f.api(f.owner, '/channels', 'POST', {
        name: 'staff-room',
        kind: 'text',
        private: true,
    });
    const msg = await f.api(f.owner, '/messages', 'POST', {
        room: channel.id,
        body: 'Secret',
        attachments: [{ name: 'private.txt', data: 'aGk=' }],
    });
    const role = await f.role('New role', memberPermissions);
    await f.assign(f.member, [role.id]);
    assert.equal(
        (await f.api(f.member, '/state')).channels.some((c) => c.id === channel.id),
        false,
    );
    await f.api(f.member, `/messages?room=${channel.id}`, 'GET', undefined, 403);
    await f.api(f.member, `/attachments/${msg.attachments[0].id}`, 'GET', undefined, 404);
    await f.override(role.id, [
        { channel: channel.id, permission: 'channels.view', effect: 'allow' },
    ]);
    assert.equal(
        (await f.api(f.member, '/state')).channels.some((c) => c.id === channel.id),
        true,
    );
    await f.restart();
    assert.equal(
        (await f.api(f.member, '/state')).channels.some((c) => c.id === channel.id),
        true,
    );
    await f.api(f.owner, `/channels/${channel.id}/privacy`, 'PATCH', { private: false });
    assert.equal(
        (await f.api(f.other, '/state')).channels.some((c) => c.id === channel.id),
        true,
    );
});
test('override edits validate atomically and cannot grant hidden or unavailable permissions', async (t) => {
    const f = await roleFixture(t),
        lower = await f.role('Lower'),
        manager = await f.role('Access manager', ['channels.access']);
    await f.assign(f.member, [manager.id]);
    await f.override(
        lower.id,
        [{ channel: 'general', permission: 'reactions.add', effect: 'allow' }],
        f.member,
        403,
    );
    await f.override(
        lower.id,
        [
            { channel: 'general', permission: 'channels.view', effect: 'allow' },
            { channel: 'missing', permission: 'channels.view', effect: 'allow' },
        ],
        f.owner,
        404,
    );
    assert.equal(
        f.db.prepare('SELECT COUNT(*) n FROM channel_overrides WHERE role=?').get(lower.id).n,
        0,
    );
    await f.override(
        lower.id,
        [{ channel: 'general', permission: 'calls.speak', effect: 'allow' }],
        f.owner,
        400,
    );
    await f.override(
        lower.id,
        [
            { channel: 'general', permission: 'messages.send', effect: 'allow' },
            { channel: 'general', permission: 'messages.send', effect: 'deny' },
        ],
        f.owner,
        400,
    );
    await f.override(manager.id, [
        { channel: 'general', permission: 'channels.view', effect: 'deny' },
    ]);
    await f.override(
        lower.id,
        [{ channel: 'general', permission: 'channels.view', effect: 'allow' }],
        f.member,
        404,
    );
    await f.override('everyone', [], f.member, 403);
});
test('removing a restrictive role cannot indirectly grant access the assigning actor lacks', async (t) => {
    const f = await roleFixture(t),
        blocked = await f.role('Blocked'),
        manager = await f.role('Manager', ['roles.assign', 'channels.view']);
    await f.assign(f.member, [f.participantRole, blocked.id]);
    await f.assign(f.other, [manager.id]);
    await f.override(blocked.id, [
        { channel: 'general', permission: 'channels.view', effect: 'deny' },
    ]);
    await f.override(manager.id, [
        { channel: 'general', permission: 'channels.view', effect: 'deny' },
    ]);
    await f.assign(f.member, [f.participantRole], f.other, 403);
    assert.equal((await f.api(f.member, '/state')).me.roles.includes(blocked.id), true);
});
test('invitation creation and management are separate from owner-only registration', async (t) => {
    const f = await roleFixture(t),
        creator = await f.role('Invite creator', ['invitations.create']),
        manager = await f.role('Invite manager', ['invitations.manage']);
    await f.api(f.owner, '/registration', 'PATCH', { mode: 'invite' });
    await f.assign(f.member, [creator.id]);
    await f.assign(f.other, [manager.id]);
    const invitation = await f.api(f.member, '/invitations', 'POST', {});
    assert.deepEqual((await f.api(f.member, '/registration')).invitations, []);
    assert.equal((await f.api(f.other, '/registration')).invitations[0].id, invitation.id);
    await f.api(f.other, '/invitations', 'POST', {}, 403);
    await f.api(f.member, `/invitations/${invitation.id}`, 'DELETE', undefined, 403);
    await f.api(f.other, `/invitations/${invitation.id}`, 'DELETE');
    await f.api(f.member, '/registration', 'PATCH', { mode: 'open' }, 403);
    await f.api(f.other, '/registration', 'PATCH', { mode: 'open' }, 403);
});
test('role APIs reject obsolete and unknown permissions and invalid colors', async (t) => {
    const f = await roleFixture(t);
    for (const permissions of [
        ['messages.editOwn'],
        ['messages.deleteOwn'],
        ['send'],
        ['administrator'],
        ['typo'],
    ])
        await f.api(f.owner, '/roles', 'POST', { name: 'Invalid', color: null, permissions }, 400);
    await f.api(f.owner, '/roles', 'POST', { name: 'Invalid', color: 'bad', permissions: [] }, 400);
    assert.equal(permissionIds.includes('roles.manage'), true);
});
test('channel creation, editing, deletion, ordering and general server editing are separate', async (t) => {
    const f = await roleFixture(t),
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
        `/roles/${f.participantRole}`,
        'PATCH',
        { name: 'Nope', color: '#abcdef', permissions: permissionIds },
        403,
    );
    await api(member, `/users/${member.user.id}/roles`, 'PATCH', { roles: ['owner'] }, 403);
});
test('custom emoji upload and removal of other authors have separate permissions', async (t) => {
    const { default: sharp } = await import('sharp');
    const data = (
        await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } })
            .png()
            .toBuffer()
    ).toString('base64');
    const f = await roleFixture(t),
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

test('effective-permission inspection reports sources without exposing inaccessible channels', async (t) => {
    const f = await roleFixture(t),
        staff = await f.role('Staff', ['channels.access']);
    await f.assign(f.other, [staff.id]);
    await f.override(f.participantRole, [
        { channel: 'general', permission: 'messages.send', effect: 'deny' },
    ]);
    const result = await f.api(f.other, `/users/${f.member.user.id}/permissions?channel=general`);
    const decision = result.details.find((entry) => entry.permission === 'messages.send');
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /Participant/);
    await f.api(
        f.member,
        `/users/${f.other.user.id}/permissions?channel=general`,
        'GET',
        undefined,
        403,
    );
    await f.override(staff.id, [
        { channel: 'general', permission: 'channels.view', effect: 'deny' },
    ]);
    await f.api(
        f.other,
        `/users/${f.member.user.id}/permissions?channel=general`,
        'GET',
        undefined,
        404,
    );
});
