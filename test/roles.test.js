import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFixture } from '../test-support/role-fixture.js';
import { roleColor, rolePermissions, highestPosition } from '../shared/permissions.js';

test('ownership is separate, protected and never assignable as a role', async (t) => {
    const f = await roleFixture(t);
    const state = await f.api(f.owner, '/state');
    assert.equal(state.me.owner, true);
    assert.equal(
        state.roles.some((r) => r.id === 'owner'),
        false,
    );
    assert.equal('role' in state.me, false);
    await f.assign(f.member, ['owner'], f.owner, 400);
    await f.api(
        f.owner,
        '/roles/owner',
        'PATCH',
        { name: 'Owner', color: null, permissions: [] },
        404,
    );
    await f.api(f.member, `/users/${f.owner.user.id}/access`, 'POST', { enabled: false }, 403);
    await f.api(f.owner, `/users/${f.owner.user.id}/access`, 'POST', { enabled: false }, 403);
    assert.throws(
        () => f.db.prepare('UPDATE users SET owner=0 WHERE id=?').run(f.owner.user.id),
        /protected/,
    );
    assert.throws(
        () => f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner.user.id),
        /protected/,
    );
    const custom = await f.role('Host', [], '#aabbcc');
    await f.assign(f.owner, [custom.id]);
    await f.restart();
    const after = await f.api(f.owner, '/state');
    assert.equal(after.me.owner, true);
    assert.deepEqual(after.me.roles, [custom.id]);
    await f.role('Still authorized');
});
test('Default is the protected fallback; removing a role preserves other memberships', async (t) => {
    const f = await roleFixture(t),
        a = await f.role('One'),
        b = await f.role('Two');
    await f.assign(f.member, [a.id, b.id]);
    await f.override(a.id, [{ channel: 'general', permission: 'reactions.add', effect: 'deny' }]);
    await f.api(f.owner, `/roles/${a.id}`, 'DELETE');
    assert.deepEqual((await f.api(f.member, '/state')).me.roles, [b.id]);
    assert.equal(
        f.db.prepare('SELECT COUNT(*) n FROM channel_overrides WHERE role=?').get(a.id).n,
        0,
    );
    await f.assign(f.member, []);
    assert.equal(
        (await f.api(f.member, '/state')).channels.some((c) => c.id === 'general'),
        true,
    );
    await f.api(f.owner, '/roles/everyone', 'DELETE', undefined, 409);
    await f.assign(f.member, ['everyone'], f.owner, 400);
    await f.api(f.owner, '/roles/everyone', 'PATCH', {
        name: 'All members',
        color: null,
        permissions: ['channels.view', 'reactions.add'],
    });
    await f.restart();
    assert.equal(
        (await f.api(f.member, '/state')).roles.find((r) => r.id === 'everyone').name,
        'All members',
    );
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
test('role order persists and highest colored role wins without controlling permission priority', async (t) => {
    const f = await roleFixture(t),
        low = await f.role('Green', ['messages.send'], '#00ff00'),
        high = await f.role('Blue', ['reactions.add'], '#0000ff'),
        plain = await f.role('No color');
    await f.assign(f.member, [low.id, high.id, plain.id]);
    let state = await f.api(f.member, '/state');
    assert.equal(roleColor(state.me, state.roles), '#0000ff');
    assert.equal(rolePermissions(state.me, state.roles).includes('messages.send'), true);
    await f.api(f.owner, `/roles/${low.id}/move`, 'POST', { direction: 'up' });
    await f.restart();
    state = await f.api(f.member, '/state');
    assert.equal(roleColor(state.me, state.roles), '#00ff00');
    assert.equal(highestPosition(state.me, state.roles) > 0, true);
    await f.api(f.owner, '/roles/everyone/move', 'POST', { direction: 'up' }, 400);
    await f.api(f.owner, `/roles/${low.id}/move`, 'POST', { direction: 'sideways' }, 400);
});
test('delegated role management and assignments cannot reach peers, self or higher grants', async (t) => {
    const f = await roleFixture(t);
    const low = await f.role('Low', ['messages.send']);
    const privileged = await f.role('Power', ['server.edit']);
    const manager = await f.role('Manager', ['roles.manage', 'roles.assign', 'messages.send']);
    await f.assign(f.other, [manager.id]);
    await f.assign(f.member, [low.id], f.other);
    await f.assign(f.member, [privileged.id], f.other, 403);
    await f.assign(f.other, [low.id], f.other, 403);
    await f.assign(f.owner, [low.id], f.other, 403);
    await f.api(
        f.other,
        `/roles/${manager.id}`,
        'PATCH',
        { name: 'Self', color: null, permissions: [] },
        403,
    );
    await f.api(
        f.other,
        '/roles/everyone',
        'PATCH',
        { name: 'All', color: null, permissions: [] },
        403,
    );
    const delegated = await f.api(f.other, '/roles', 'POST', {
        name: 'Helper',
        color: null,
        permissions: ['messages.send'],
    });
    const state = await f.api(f.owner, '/state');
    assert.ok(
        state.roles.find((r) => r.id === delegated.id).position <
            state.roles.find((r) => r.id === manager.id).position,
    );
    await f.api(
        f.other,
        '/roles',
        'POST',
        { name: 'Escalate', color: null, permissions: ['members.ban'] },
        403,
    );
    await f.api(f.other, `/roles/${delegated.id}/move`, 'POST', { direction: 'up' }, 403);
    await f.api(f.other, '/roles', 'POST', {
        name: 'Another helper',
        color: null,
        permissions: [],
    });
    const ordered = (await f.api(f.owner, '/state')).roles;
    assert.equal(new Set(ordered.map((role) => role.position)).size, ordered.length);
    await f.api(f.other, `/roles/${low.id}`, 'DELETE', undefined, 403);
    await f.api(f.owner, `/roles/${low.id}`, 'DELETE');
    assert.deepEqual((await f.api(f.member, '/state')).me.roles, []);
});
test('banning and restoring are delegated separately and respect hierarchy', async (t) => {
    const f = await roleFixture(t),
        moderator = await f.role('Mod', ['members.ban']);
    await f.assign(f.other, [moderator.id]);
    await f.api(f.other, `/users/${f.member.user.id}/access`, 'POST', { enabled: false });
    await f.api(f.member, '/state', 'GET', undefined, 401);
    await f.api(f.other, `/users/${f.member.user.id}/access`, 'POST', { enabled: true }, 403);
    await f.api(f.owner, `/users/${f.member.user.id}/access`, 'POST', { enabled: true });
    await f.api(f.other, `/users/${f.other.user.id}/access`, 'POST', { enabled: false }, 403);
    await f.api(f.other, `/users/${f.owner.user.id}/access`, 'POST', { enabled: false }, 403);
});
