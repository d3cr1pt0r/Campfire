import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFixture } from '../test-support/role-fixture.js';
import { hasPermission, roleColor } from '../shared/permissions.js';

test('new members use Default alone; assigning roles replaces its grants, overrides and color', async (t) => {
    const f = await roleFixture(t),
        newcomer = await f.signup('Newcomer');
    assert.deepEqual(newcomer.user.roles, []);
    await f.api(f.owner, '/roles/everyone', 'PATCH', {
        name: 'Default',
        color: '#22aa88',
        permissions: ['channels.view', 'messages.send', 'emojis.upload'],
    });
    const privateChannel = await f.api(f.owner, '/channels', 'POST', {
        name: 'default-space',
        kind: 'text',
        private: true,
    });
    await f.override('everyone', [
        { channel: 'general', permission: 'reactions.add', effect: 'allow' },
        { channel: privateChannel.id, permission: 'channels.view', effect: 'allow' },
    ]);
    const root = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        body: 'An announcement',
    });
    let state = await f.api(newcomer, '/state');
    assert.equal(state.roles.find((role) => role.id === 'everyone').name, 'Default');
    assert.equal(roleColor(state.me, state.roles), '#22aa88');
    assert.equal(
        state.channels.some((channel) => channel.id === privateChannel.id),
        true,
    );
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Default can send' });
    await f.api(newcomer, `/messages/${root.id}/reaction`, 'POST', { emoji: '👍' });
    const restricted = await f.role('Restricted', ['channels.view']);
    await f.assign(newcomer, [restricted.id]);
    state = await f.api(newcomer, '/state');
    assert.equal(roleColor(state.me, state.roles), undefined);
    assert.equal(hasPermission(state.me, state.roles, 'messages.send'), false);
    assert.equal(hasPermission(state.me, state.roles, 'emojis.upload'), false);
    assert.equal(
        state.channels.some((channel) => channel.id === privateChannel.id),
        false,
    );
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Blocked' }, 403);
    await f.api(newcomer, `/messages/${root.id}/reaction`, 'POST', { emoji: '👍' }, 403);
    const sender = await f.role('Sender', ['messages.send']);
    await f.assign(newcomer, [restricted.id, sender.id]);
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Explicit roles combine' });
    state = await f.api(newcomer, '/state');
    assert.equal(hasPermission(state.me, state.roles, 'emojis.upload'), false);
    await f.assign(newcomer, []);
    await f.restart();
    state = await f.api(newcomer, '/state');
    assert.deepEqual(state.me.roles, []);
    assert.equal(hasPermission(state.me, state.roles, 'emojis.upload'), true);
    assert.equal(roleColor(state.me, state.roles), '#22aa88');
    assert.equal(
        state.channels.some((channel) => channel.id === privateChannel.id),
        true,
    );
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Fallback restored' });
});
test('Default channel denies do not affect members with explicit roles', async (t) => {
    const f = await roleFixture(t),
        account = await f.signup('FallbackUser');
    await f.override('everyone', [
        { channel: 'general', permission: 'messages.send', effect: 'deny' },
    ]);
    await f.api(account, '/messages', 'POST', { room: 'general', body: 'Default deny' }, 403);
    const sender = await f.role('Sender', ['messages.send']);
    await f.assign(account, [sender.id]);
    await f.api(account, '/messages', 'POST', { room: 'general', body: 'Explicit sender' });
    await f.api(f.owner, `/roles/${sender.id}`, 'DELETE');
    await f.api(
        account,
        '/messages',
        'POST',
        { room: 'general', body: 'Default deny restored' },
        403,
    );
});
test('delegation cannot activate stronger Default privileges by clearing or deleting the last role', async (t) => {
    const f = await roleFixture(t),
        low = await f.role('Limited'),
        manager = await f.role('Manager', ['roles.assign', 'roles.manage']);
    await f.api(f.owner, '/roles/everyone', 'PATCH', {
        name: 'Default',
        color: null,
        permissions: ['server.edit'],
    });
    await f.assign(f.member, [low.id]);
    await f.assign(f.other, [manager.id]);
    await f.assign(f.member, [], f.other, 403);
    await f.api(f.other, `/roles/${low.id}`, 'DELETE', undefined, 403);
    assert.deepEqual((await f.api(f.member, '/state')).me.roles, [low.id]);
    await f.api(f.owner, `/roles/${low.id}`, 'DELETE');
    const state = await f.api(f.member, '/state');
    assert.deepEqual(state.me.roles, []);
    assert.equal(hasPermission(state.me, state.roles, 'server.edit'), true);
});
