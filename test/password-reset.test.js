import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFixture } from '../test-support/role-fixture.js';
import { request } from '../test-support/http.js';
import { tokenHash } from '../server/security.js';

const endpoint = (account) => `/users/${account.user.id}/password-reset`;
const redeem = (f, token, extra = {}, status = 200) =>
    f.api(
        null,
        '/auth/reset',
        'POST',
        {
            username: 'Member',
            resetToken: token,
            password: 'new-pass',
            ...extra,
        },
        status,
    );

test('reset generation requires its own permission and respects member hierarchy', async (t) => {
    const f = await roleFixture(t);
    await f.api(null, endpoint(f.member), 'POST', undefined, 401);
    await f.api(f.other, endpoint(f.member), 'POST', undefined, 403);
    const helper = await f.role('Helper', ['members.resetPassword']);
    await f.assign(f.other, [helper.id]);
    await f.api(f.other, endpoint(f.member), 'POST');
    for (const target of [f.other, f.owner])
        await f.api(f.other, endpoint(target), 'POST', undefined, 403);
    await f.assign(f.member, [helper.id]);
    await f.api(f.other, endpoint(f.member), 'POST', undefined, 403);
    await f.assign(f.member, []);
    await f.api(f.other, endpoint(f.member), 'POST');
    await f.api(f.owner, endpoint(f.owner), 'POST', undefined, 403);
    await f.api(f.owner, `/users/${f.member.user.id}/access`, 'POST', { enabled: false });
    await f.api(f.owner, endpoint(f.member), 'POST', undefined, 403);
});

test('tokens persist hashed, replace previous tokens, and reset signs in while revoking old sessions', async (t) => {
    const f = await roleFixture(t);
    const first = await f.api(f.owner, endpoint(f.member), 'POST');
    const second = await f.api(f.owner, endpoint(f.member), 'POST');
    assert.notEqual(first.token, second.token);
    const row = f.db.prepare('SELECT * FROM password_resets WHERE user=?').get(f.member.user.id);
    assert.equal(row.tokenHash, tokenHash(second.token));
    assert.equal(row.expires, second.expires);
    assert.ok(second.expires > Date.now() && second.expires <= Date.now() + 3600000);
    assert.ok(!JSON.stringify(await f.api(f.owner, '/state')).includes(second.token));
    await f.restart();
    await redeem(f, first.token, {}, 401);
    await redeem(f, second.token, { username: 'Other' }, 401);
    await redeem(f, second.token, { username: 'Missing' }, 401);
    await redeem(f, second.token, { password: '1234567' }, 400);
    await redeem(f, second.token, { password: 'x'.repeat(129) }, 400);
    const signedIn = await redeem(f, second.token, { username: 'member' });
    assert.equal(signedIn.user.id, f.member.user.id);
    assert.equal((await f.api(signedIn, '/state')).me.id, f.member.user.id);
    await f.api(f.member, '/state', 'GET', undefined, 401);
    await redeem(f, second.token, {}, 401);
    await f.api(
        null,
        '/auth/login',
        'POST',
        { username: 'Member', password: 'test-password-123' },
        401,
    );
    await f.api(null, '/auth/login', 'POST', { username: 'Member', password: 'new-pass' });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 0);
});

test('expired tokens, password changes and member removal invalidate recovery', async (t) => {
    const f = await roleFixture(t);
    const expired = await f.api(f.owner, endpoint(f.member), 'POST');
    f.db.prepare('UPDATE password_resets SET expires=0').run();
    await redeem(f, expired.token, {}, 401);
    const changed = await f.api(f.owner, endpoint(f.member), 'POST');
    await f.api(f.member, '/account/password', 'POST', {
        current: 'test-password-123',
        password: '12345678',
    });
    await redeem(f, changed.token, {}, 401);
    const removed = await f.api(f.owner, endpoint(f.member), 'POST');
    await f.api(f.owner, `/users/${f.member.user.id}/access`, 'POST', { enabled: false });
    await redeem(f, removed.token, {}, 401);
    await f.api(f.owner, `/users/${f.member.user.id}/access`, 'POST', { enabled: true });
    await redeem(f, removed.token, {}, 401);
});

test('concurrent redemption succeeds exactly once and reset attempts are rate limited', async (t) => {
    const f = await roleFixture(t);
    const reset = await f.api(f.owner, endpoint(f.member), 'POST');
    const results = await Promise.all(
        [1, 2].map(() =>
            request(f.service.app, '/auth/reset', null, 'POST', {
                username: 'Member',
                resetToken: reset.token,
                password: '12345678',
            }),
        ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
    for (let i = 0; i < 25; i++) {
        const result = await request(f.service.app, '/auth/reset', null, 'POST', {
            username: 'Member',
            resetToken: 'a'.repeat(64),
            password: '12345678',
        });
        if (result.status === 429) return;
        assert.equal(result.status, 401);
    }
    assert.fail('Expected reset rate limit');
});

test('generation is rate limited and eight-character registration and login work', async (t) => {
    const f = await roleFixture(t);
    for (let i = 0; i < 5; i++) await f.api(f.owner, endpoint(f.member), 'POST');
    await f.api(f.owner, endpoint(f.member), 'POST', undefined, 429);
    await f.api(null, '/auth/register', 'POST', { username: 'Short', password: '1234567' }, 400);
    await f.api(null, '/auth/register', 'POST', { username: 'Eight', password: '12345678' });
    await f.api(null, '/auth/login', 'POST', { username: 'Eight', password: '12345678' });
});
