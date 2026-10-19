import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './open-server.js';
import { request } from './http.js';
import { memberPermissions } from '../shared/permissions.js';
export async function roleFixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-roles-'));
    let service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const api = async (account, endpoint, method = 'GET', body, status = 200) => {
        const response = await request(service.app, endpoint, account?.token, method, body);
        assert.equal(
            response.status,
            status,
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
        member = await signup('Member'),
        other = await signup('Other');
    const role = (name, permissions = [], color = null) =>
        api(owner, '/roles', 'POST', {
            name,
            permissions: [...new Set(['channels.view', ...permissions])],
            color,
        });
    const assign = (account, roles, actor = owner, status = 200) =>
        api(actor, `/users/${account.user.id}/roles`, 'PATCH', { roles }, status);
    const override = (id, overrides, actor = owner, status = 200) =>
        api(actor, `/roles/${id}/access`, 'PUT', { overrides }, status);
    // Feature tests use an ordinary custom role; production signups use Default alone.
    const participantRole = (await role('Participant', memberPermissions)).id;
    await assign(member, [participantRole]);
    await assign(other, [participantRole]);
    return {
        api,
        owner,
        member,
        other,
        role,
        assign,
        override,
        signup,
        participantRole,
        flags: (permissions) =>
            api(owner, `/roles/${participantRole}`, 'PATCH', {
                name: 'Participant',
                color: null,
                permissions: [...new Set(['channels.view', ...permissions])],
            }),
        get service() {
            return service;
        },
        get db() {
            return service.db;
        },
        async restart() {
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}
