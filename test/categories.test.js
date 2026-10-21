import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-categories-'));
    const service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const api = async (account, endpoint, method = 'GET', body, status = 200) => {
        const response = await request(service.app, endpoint, account?.token, method, body);
        assert.equal(response.status, status, JSON.stringify(response.data));
        return response.data;
    };
    const owner = await api(null, '/auth/register', 'POST', {
        username: 'Owner',
        password: 'test-password-123',
        setupCode: 'test-owner-setup',
    });
    const member = await api(null, '/auth/register', 'POST', {
        username: 'Member',
        password: 'test-password-123',
    });
    const category = await api(owner, '/categories', 'POST', { name: 'Community' });
    const move = (id, synced = true, target = category.id) =>
        api(owner, `/channels/${id}/category`, 'PUT', { category: target, synced });
    const override = (role, permission, effect) =>
        api(owner, `/categories/${category.id}/access`, 'PUT', {
            role,
            overrides: [{ permission, effect }],
        });
    return { service, api, owner, member, category, move, override };
}

test('category inheritance applies across text and voice and preserves access on detach and delete', async (t) => {
    const { service, api, owner, member, category, move, override } = await fixture(t);
    await move('general');
    await move('lounge');
    await override('everyone', 'messages.send', 'deny');
    await override('everyone', 'calls.speak', 'deny');
    let state = await api(member, '/state');
    assert.equal(state.channels.find((c) => c.id === 'general').synced, true);
    assert.equal(
        state.channels.find((c) => c.id === 'general').permissions.includes('messages.send'),
        false,
    );
    assert.equal(
        state.channels.find((c) => c.id === 'lounge').permissions.includes('calls.speak'),
        false,
    );
    assert.equal(
        state.channels.find((c) => c.id === 'introductions').permissions.includes('messages.send'),
        true,
    );
    await api(member, '/messages', 'POST', { room: 'general', body: 'Blocked by category' }, 403);
    await api(owner, '/channels/general/privacy', 'PATCH', { private: true }, 409);
    await api(
        owner,
        '/roles/everyone/access',
        'PUT',
        { overrides: [{ channel: 'general', permission: 'messages.send', effect: 'allow' }] },
        409,
    );
    const inspector = await api(owner, `/users/${member.user.id}/permissions?channel=general`);
    assert.match(
        inspector.details.find((d) => d.permission === 'messages.send').reason,
        /category community/i,
    );
    // Unsync materializes the category policy, then ignores subsequent category changes.
    await move('general', false);
    await override('everyone', 'messages.send', 'allow');
    state = await api(member, '/state');
    assert.equal(
        state.channels.find((c) => c.id === 'general').permissions.includes('messages.send'),
        false,
    );
    await move('general');
    assert.equal(
        (await api(member, '/state')).channels
            .find((c) => c.id === 'general')
            .permissions.includes('messages.send'),
        true,
    );
    // Private category visibility is inherited and deletion preserves it.
    await api(owner, `/categories/${category.id}`, 'PATCH', { private: true });
    state = await api(member, '/state');
    assert.equal(
        state.channels.some((c) => c.id === 'general'),
        false,
    );
    assert.equal(
        state.categories.some((c) => c.id === category.id),
        false,
    );
    await api(owner, `/categories/${category.id}`, 'DELETE');
    assert.equal(
        (await api(member, '/state')).channels.some((c) => c.id === 'general'),
        false,
    );
    const ownerState = await api(owner, '/state');
    assert.equal(ownerState.channels.find((c) => c.id === 'general').category, null);
    assert.equal(ownerState.channels.find((c) => c.id === 'general').private, true);
    assert.equal(service.db.prepare('SELECT COUNT(*) n FROM category_overrides').get().n, 0);
    assert.equal(ownerState.channels.filter((c) => c.protected).length, 2);
});

test('category permissions combine assigned roles, custom exceptions and private visibility', async (t) => {
    const { api, owner, member, category, move, override } = await fixture(t);
    const role = await api(owner, '/roles', 'POST', {
        name: 'Readers',
        color: null,
        permissions: ['channels.view', 'messages.send', 'calls.join'],
    });
    await api(owner, `/users/${member.user.id}/roles`, 'PATCH', { roles: [role.id] });
    await move('general');
    await move('introductions', false);
    await api(owner, `/categories/${category.id}`, 'PATCH', { private: true });
    assert.equal(
        (await api(member, '/state')).channels.some((c) => c.id === 'general'),
        false,
    );
    assert.equal(
        (await api(member, '/state')).channels.some((c) => c.id === 'introductions'),
        true,
    );
    await override(role.id, 'channels.view', 'allow');
    await override(role.id, 'messages.send', 'deny');
    let state = await api(member, '/state');
    assert.equal(
        state.channels.find((c) => c.id === 'general').permissions.includes('messages.send'),
        false,
    );
    // Default does not apply once a member has an assigned role.
    await override('everyone', 'messages.send', 'allow');
    state = await api(member, '/state');
    assert.equal(
        state.channels.find((c) => c.id === 'general').permissions.includes('messages.send'),
        false,
    );
    const second = await api(owner, '/roles', 'POST', {
        name: 'Writers',
        color: null,
        permissions: [],
    });
    await override(second.id, 'messages.send', 'allow');
    await api(owner, `/users/${member.user.id}/roles`, 'PATCH', { roles: [role.id, second.id] });
    assert.equal(
        (await api(member, '/state')).channels
            .find((c) => c.id === 'general')
            .permissions.includes('messages.send'),
        true,
    );
});

test('category endpoints enforce hierarchy, visibility, validation and delegated grant limits', async (t) => {
    const { api, service, owner, member, category, move } = await fixture(t);
    await api(member, '/categories', 'POST', { name: 'Nope' }, 403);
    await api(owner, '/categories', 'POST', { name: '\n' }, 400);
    await api(
        owner,
        `/categories/${category.id}/access`,
        'PUT',
        { role: 'everyone', overrides: [{ permission: 'roles.manage', effect: 'allow' }] },
        400,
    );
    await api(owner, '/channels/general/category', 'PUT', { category: null, synced: true }, 400);
    await api(
        owner,
        '/channels/general/category',
        'PUT',
        { category: 'missing', synced: true },
        404,
    );
    const delegate = await api(owner, '/roles', 'POST', {
        name: 'Delegate',
        color: null,
        permissions: [
            'channels.view',
            'channels.access',
            'channels.edit',
            'channels.delete',
            'channels.reorder',
        ],
    });
    await api(owner, `/users/${member.user.id}/roles`, 'PATCH', { roles: [delegate.id] });
    await move('general');
    await api(
        member,
        `/categories/${category.id}/access`,
        'PUT',
        { role: 'everyone', overrides: [{ permission: 'channels.view', effect: 'deny' }] },
        403,
    );
    const lower = await api(owner, '/roles', 'POST', {
        name: 'Lower',
        color: null,
        permissions: ['channels.view'],
    });
    service.db.prepare('UPDATE roles SET position=100 WHERE id=?').run(delegate.id);
    await api(
        member,
        `/categories/${category.id}/access`,
        'PUT',
        { role: lower.id, overrides: [{ permission: 'messages.send', effect: 'allow' }] },
        403,
    );
    await api(owner, `/categories/${category.id}/access`, 'PUT', {
        role: lower.id,
        overrides: [{ permission: 'messages.send', effect: 'allow' }],
    });
    // Moving into a policy that would grant a permission the delegate lacks is atomic and denied.
    await api(owner, `/users/${owner.user.id}/roles`, 'PATCH', { roles: [lower.id] });
    const another = await api(null, '/auth/register', 'POST', {
        username: 'Other',
        password: 'test-password-123',
    });
    await api(owner, `/users/${another.user.id}/roles`, 'PATCH', { roles: [lower.id] });
    await api(
        member,
        '/channels/introductions/category',
        'PUT',
        { category: category.id, synced: true },
        403,
    );
    assert.equal(
        (await api(owner, '/state')).channels.find((c) => c.id === 'introductions').category,
        null,
    );
    // A hidden custom child prevents delegated category-wide edits.
    await move('introductions', false);
    await api(owner, '/roles/' + delegate.id + '/access', 'PUT', {
        overrides: [{ channel: 'introductions', permission: 'channels.view', effect: 'deny' }],
    });
    await api(
        member,
        `/categories/${category.id}`,
        'PATCH',
        { name: 'Cannot edit hidden children' },
        403,
    );
});

test('category names and order update without changing membership or channel order', async (t) => {
    const { api, owner, category, move } = await fixture(t);
    await move('general');
    const second = await api(owner, '/categories', 'POST', { name: 'Games' });
    await api(owner, `/categories/${category.id}`, 'PATCH', { name: 'Community hub' });
    await api(owner, `/categories/${second.id}/move`, 'POST', { direction: 'up' });
    let state = await api(owner, '/state');
    assert.deepEqual(
        state.categories.map((entry) => entry.name),
        ['Games', 'Community hub'],
    );
    assert.equal(state.channels.find((channel) => channel.id === 'general').category, category.id);
    await api(owner, `/categories/${second.id}/move`, 'POST', { direction: 'down' });
    state = await api(owner, '/state');
    assert.deepEqual(
        state.categories.map((entry) => entry.id),
        [category.id, second.id],
    );
    await api(owner, `/categories/${second.id}`, 'PATCH', { name: 'Bad\nName' }, 400);
    await api(owner, `/categories/${second.id}`, 'PATCH', { private: 'yes' }, 400);
});

test('drag placement moves and orders mixed channel kinds atomically with an explicit permission choice', async (t) => {
    const { api, owner, member, category, override } = await fixture(t);
    await override('everyone', 'messages.send', 'deny');
    const place = (id, body, actor = owner, status = 200) =>
        api(actor, `/channels/${id}/place`, 'POST', { placement: 'after', ...body }, status);
    await place('general', { category: category.id, synced: true });
    await place('lounge', {
        category: category.id,
        synced: true,
        target: 'general',
        placement: 'before',
    });
    let state = await api(member, '/state');
    assert.deepEqual(
        state.channels
            .filter((channel) => channel.category === category.id)
            .map((channel) => channel.id),
        ['lounge', 'general'],
    );
    assert.equal(
        state.channels
            .find((channel) => channel.id === 'general')
            .permissions.includes('messages.send'),
        false,
    );
    await place('introductions', {
        category: category.id,
        synced: false,
        target: 'general',
        placement: 'before',
    });
    state = await api(member, '/state');
    assert.deepEqual(
        state.channels
            .filter((channel) => channel.category === category.id)
            .map((channel) => channel.id),
        ['lounge', 'introductions', 'general'],
    );
    assert.equal(
        state.channels
            .find((channel) => channel.id === 'introductions')
            .permissions.includes('messages.send'),
        true,
    );
    // Moving out preserves the inherited policy, including denials.
    await place('general', { category: null, synced: false });
    assert.equal(
        (await api(member, '/state')).channels
            .find((channel) => channel.id === 'general')
            .permissions.includes('messages.send'),
        false,
    );
    await place('lounge', { category: null, synced: false, target: 'introductions' }, owner, 400);
    assert.equal(
        (await api(owner, '/state')).channels.find((channel) => channel.id === 'lounge').category,
        category.id,
    );
    await place('lounge', { category: null, synced: false }, member, 403);
    const direct = await api(owner, '/channels', 'POST', {
        name: 'new-child',
        kind: 'text',
        category: category.id,
    });
    const child = (await api(member, '/state')).channels.find(
        (channel) => channel.id === direct.id,
    );
    assert.equal(child.category, category.id);
    assert.equal(child.synced, true);
    assert.equal(child.permissions.includes('messages.send'), false);
    const second = await api(owner, '/categories', 'POST', { name: 'Second' });
    await api(owner, `/categories/${second.id}/drop`, 'POST', {
        target: category.id,
        placement: 'before',
    });
    assert.deepEqual(
        (await api(owner, '/state')).categories.map((entry) => entry.id),
        [second.id, category.id],
    );
});
