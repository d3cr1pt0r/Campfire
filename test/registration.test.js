import { migratePermissions } from '../shared/permissions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { request } from '../test-support/http.js';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'driskord-registration-'));
    let service = createApp({ dataDir: directory, setupCode: 'owner-secret' });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const api = (token, endpoint, method = 'GET', body) =>
        request(service.app, endpoint, token, method, body);
    const signup = (username, extra = {}) =>
        api(null, '/auth/register', 'POST', {
            username,
            password: 'secure-password-123',
            ...extra,
        });
    const owner = async () => {
        const response = await signup('Owner', { setupCode: 'owner-secret' });
        assert.equal(response.status, 200);
        return response.data.token;
    };
    const invite = async (token, label = 'Friend') => {
        const result = await api(token, '/invitations', 'POST', { label });
        assert.equal(result.status, 200);
        return result.data;
    };
    return {
        api,
        signup,
        owner,
        invite,
        get service() {
            return service;
        },
        restart: async () => {
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}
test('fresh servers require a setup code and default to invite only', async (t) => {
    const f = await fixture(t);
    assert.deepEqual((await f.api(null, '/info')).data, {
        name: 'My Campfire server',
        registration: false,
        registrationMode: 'invite',
        setupRequired: true,
    });
    assert.equal((await f.signup('Intruder')).status, 403);
    assert.equal((await f.signup('Intruder', { setupCode: 'wrong' })).status, 403);
    const results = await Promise.all(
        ['Owner', 'Other'].map((username) => f.signup(username, { setupCode: 'owner-secret' })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
    assert.equal(results.find((r) => r.status === 200).data.user.role, 'owner');
    assert.equal((await f.signup('Later', { setupCode: 'owner-secret' })).status, 403);
    assert.equal((await f.api(null, '/info')).data.setupRequired, false);
});
test('only the owner controls registration and invitations, including managers', async (t) => {
    const f = await fixture(t),
        owner = await f.owner();
    const invitation = await f.invite(owner);
    const member = (await f.signup('Member', { inviteCode: invitation.code })).data;
    f.service.db
        .prepare('INSERT INTO roles VALUES(?,?,?,?)')
        .run('manager', 'Manager', '#ffffff', JSON.stringify(migratePermissions(['manage'])));
    for (const role of ['member', 'manager']) {
        f.service.db.prepare('UPDATE users SET role=? WHERE id=?').run(role, member.user.id);
        for (const [endpoint, method, body] of [
            ['/registration', 'GET'],
            ['/registration', 'PATCH', { mode: 'open' }],
            ['/invitations', 'POST', {}],
            [`/invitations/${invitation.id}`, 'DELETE'],
        ])
            assert.equal((await f.api(member.token, endpoint, method, body)).status, 403);
    }
    assert.equal((await f.api(null, '/registration')).status, 401);
    assert.equal((await f.api(owner, '/registration', 'PATCH', { mode: 'invalid' })).status, 400);
});
test('invitations are hashed, single use, revocable, expiring, and survive restart', async (t) => {
    const f = await fixture(t),
        owner = await f.owner();
    const a = await f.invite(owner);
    const row = f.service.db.prepare('SELECT * FROM invitations WHERE id=?').get(a.id);
    assert.notEqual(row.tokenHash, a.code);
    assert.ok(!JSON.stringify((await f.api(owner, '/registration')).data).includes(a.code));
    // A failed username validation must not consume the invitation.
    assert.equal((await f.signup('!', { inviteCode: a.code })).status, 400);
    assert.equal((await f.signup('Owner', { inviteCode: a.code })).status, 409);
    await f.restart();
    assert.equal(f.service.setupCode, null);
    assert.equal((await f.signup('NewMember', { inviteCode: a.code })).data.user.role, 'member');
    assert.equal((await f.signup('Reuse', { inviteCode: a.code })).status, 403);
    const b = await f.invite(owner);
    await f.api(owner, `/invitations/${b.id}`, 'DELETE');
    assert.equal((await f.signup('Revoked', { inviteCode: b.code })).status, 403);
    const c = await f.invite(owner);
    f.service.db.prepare('UPDATE invitations SET expires=? WHERE id=?').run(Date.now() - 1, c.id);
    assert.equal((await f.signup('Expired', { inviteCode: c.code })).status, 403);
    assert.equal((await f.signup('Unknown', { inviteCode: 'a'.repeat(64) })).status, 403);
});
test('simultaneous redemptions create exactly one member', async (t) => {
    const f = await fixture(t),
        owner = await f.owner(),
        invitation = await f.invite(owner);
    const responses = await Promise.all(
        ['First', 'Second'].map((name) => f.signup(name, { inviteCode: invitation.code })),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 403]);
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
});
test('mode switches persist, revoke old invitations, and never block existing logins', async (t) => {
    const f = await fixture(t),
        owner = await f.owner(),
        invitation = await f.invite(owner);
    assert.equal((await f.api(owner, '/registration', 'PATCH', { mode: 'open' })).status, 200);
    assert.equal((await f.signup('Public')).status, 200);
    assert.equal((await f.api(owner, '/invitations', 'POST', {})).status, 409);
    await f.restart();
    assert.equal((await f.api(null, '/info')).data.registrationMode, 'open');
    await f.api(owner, '/registration', 'PATCH', { mode: 'invite' });
    assert.equal((await f.signup('Closed')).status, 403);
    assert.equal((await f.signup('OldInvite', { inviteCode: invitation.code })).status, 403);
    assert.equal(
        (
            await f.api(null, '/auth/login', 'POST', {
                username: 'Public',
                password: 'secure-password-123',
            })
        ).status,
        200,
    );
});
test('registration rechecks the mode after asynchronous password hashing', async (t) => {
    const f = await fixture(t),
        owner = await f.owner();
    await f.api(owner, '/registration', 'PATCH', { mode: 'open' });
    const pending = f.signup('Racing');
    await f.api(owner, '/registration', 'PATCH', { mode: 'invite' });
    assert.equal((await pending).status, 403);
    assert.equal(
        f.service.db.prepare("SELECT id FROM users WHERE username='Racing'").get(),
        undefined,
    );
});
test('legacy servers with accounts migrate to open registration', async (t) => {
    const f = await fixture(t);
    await f.owner();
    f.service.db.exec(
        "DROP TABLE invitations; DELETE FROM settings WHERE key='registrationMode'; DELETE FROM migrations WHERE version=7;",
    );
    await f.restart();
    assert.equal((await f.api(null, '/info')).data.registrationMode, 'open');
    assert.equal((await f.signup('LegacyMember')).status, 200);
});

test('revoking an invitation during password hashing prevents account creation', async (t) => {
    const f = await fixture(t);
    const owner = await f.owner();
    const invitation = await f.invite(owner);
    const pending = f.signup('RevocationRace', { inviteCode: invitation.code });
    await f.api(owner, `/invitations/${invitation.id}`, 'DELETE');
    assert.equal((await pending).status, 403);
    assert.equal(
        f.service.db.prepare("SELECT id FROM users WHERE username='RevocationRace'").get(),
        undefined,
    );
});

test('setup secrets rotate on restart before ownership is established and never appear in public info', async (t) => {
    const f = await fixture(t);
    assert.equal(JSON.stringify((await f.api(null, '/info')).data).includes('owner-secret'), false);
    await f.restart();
    assert.match(f.service.setupCode, /^[a-f0-9]{64}$/);
    assert.equal((await f.signup('OldSetup', { setupCode: 'owner-secret' })).status, 403);
    assert.equal((await f.signup('Owner', { setupCode: f.service.setupCode })).status, 200);
});

test('invalid invitation attempts are throttled without creating users', async (t) => {
    const f = await fixture(t);
    await f.owner();
    let response;
    for (let i = 0; i < 20; i++)
        response = await f.signup('Guesser', { inviteCode: 'a'.repeat(64) });
    assert.equal(response.status, 429);
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
});
