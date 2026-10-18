import { migratePermissions } from '../shared/permissions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-roles-'));
    let service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const api = async (account, endpoint, method = 'GET', body, status = 200) => {
        const response = await request(service.app, endpoint, account?.token, method, body);
        assert.equal(response.status, status, JSON.stringify(response.data));
        return response.data;
    };
    const signup = (username) =>
        api(null, '/auth/register', 'POST', {
            username,
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        });
    return {
        owner: await signup('Owner'),
        member: await signup('Member'),
        manager: await signup('Manager'),
        api,
        get db() {
            return service.db;
        },
        async restart() {
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}

test('default roles remain editable and permanent even after renaming and restart', async (t) => {
    const f = await fixture(t);
    for (const id of ['owner', 'member']) {
        await f.api(f.owner, `/roles/${id}`, 'PATCH', {
            name: `Renamed ${id}`,
            color: '#123456',
            permissions: [],
        });
        await f.api(f.owner, `/roles/${id}`, 'DELETE', undefined, 409);
        assert.throws(
            () => f.db.prepare('DELETE FROM roles WHERE id=?').run(id),
            /cannot be deleted/,
        );
        assert.throws(
            () => f.db.prepare('UPDATE roles SET id=? WHERE id=?').run(`other-${id}`, id),
            /cannot change/,
        );
    }
    await f.restart();
    const state = await f.api(f.owner, '/state');
    assert.equal(state.roles.length, 2);
    assert.equal(state.roles.find((r) => r.id === 'owner').name, 'Renamed owner');
    assert.equal(state.roles.find((r) => r.id === 'member').name, 'Renamed member');
    assert.equal(state.me.role, 'owner');
    // The owner's implicit authority survives editing all displayed permission flags.
    await f.api(f.owner, '/roles', 'POST', { name: 'New', color: '#abcdef', permissions: [] });
});

test('custom role deletion moves users to Member, cascades access, and survives restart', async (t) => {
    const f = await fixture(t);
    const role = await f.api(f.owner, '/roles', 'POST', {
        name: 'Custom',
        color: '#abcdef',
        permissions: migratePermissions(['send', 'voice']),
    });
    for (const account of [f.member, f.manager])
        await f.api(f.owner, `/users/${account.user.id}/role`, 'PATCH', { role: role.id });
    await f.api(f.owner, '/channels/general/access', 'PUT', {
        permissions: [
            { role: role.id, mode: 'hidden' },
            { role: 'member', mode: 'read-only' },
        ],
    });
    await f.api(f.owner, `/roles/${role.id}`, 'DELETE');
    assert.equal(
        f.db.prepare('SELECT COUNT(*) n FROM channel_access WHERE role=?').get(role.id).n,
        0,
    );
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0);
    await f.api(f.owner, `/roles/${role.id}`, 'DELETE', undefined, 404);
    await f.restart();
    for (const account of [f.member, f.manager]) {
        const state = await f.api(account, '/state');
        assert.equal(state.me.role, 'member');
        assert.equal(
            state.roles.some((r) => r.id === role.id),
            false,
        );
        assert.equal(state.channels.find((c) => c.id === 'general').access, 'read-only');
        await f.api(account, '/messages', 'POST', { room: 'general', body: 'Denied' }, 403);
    }
});

test('deletion enforces management and assignment authority without partial changes', async (t) => {
    const f = await fixture(t);
    const management = await f.api(f.owner, '/roles', 'POST', {
        name: 'Manager',
        color: '#abcdef',
        permissions: migratePermissions(['manage']),
    });
    const custom = await f.api(f.owner, '/roles', 'POST', {
        name: 'Custom',
        color: '#abcdef',
        permissions: [],
    });
    await f.api(null, `/roles/${custom.id}`, 'DELETE', undefined, 401);
    await f.api(f.member, `/roles/${custom.id}`, 'DELETE', undefined, 403);
    await f.api(f.owner, `/users/${f.manager.user.id}/role`, 'PATCH', { role: management.id });
    await f.api(f.manager, `/roles/${management.id}`, 'DELETE', undefined, 403);
    await f.api(
        f.manager,
        '/roles/owner',
        'PATCH',
        {
            name: 'Changed',
            color: '#abcdef',
            permissions: [],
        },
        403,
    );
    await f.api(f.owner, `/users/${f.member.user.id}/role`, 'PATCH', { role: custom.id });
    await f.api(f.manager, `/roles/${custom.id}`, 'DELETE', undefined, 403);
    assert.equal((await f.api(f.member, '/state')).me.role, custom.id);
    await f.api(f.owner, `/users/${f.member.user.id}/role`, 'PATCH', { role: 'member' });
    await f.api(f.manager, `/roles/${custom.id}`, 'DELETE', undefined, 403);
    await f.api(f.owner, `/roles/${custom.id}`, 'DELETE');
    await f.api(f.owner, `/roles/${management.id}`, 'DELETE');
    await f.api(
        f.manager,
        '/roles',
        'POST',
        {
            name: 'Denied',
            color: '#abcdef',
            permissions: [],
        },
        403,
    );
});
