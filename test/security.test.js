import { hasPermission } from '../shared/permissions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassword, verifyPassword, tokenHash, canReadRoom } from '../server/security.js';
test('password hashes are salted and never accept a missing account', async () => {
    const a = await createPassword('a strong test password'),
        b = await createPassword('a strong test password');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('a strong test password', a), true);
    assert.equal(await verifyPassword('wrong password', a), false);
    assert.equal(await verifyPassword('anything', undefined), false);
});
test('session tokens have a deterministic one-way storage key', () => {
    assert.equal(tokenHash('sample-token').length, 64);
    assert.equal(tokenHash('sample-token'), tokenHash('sample-token'));
    assert.notEqual(tokenHash('sample-token'), tokenHash('other-token'));
});

test('password work has a bounded queue and reports overload without losing accepted jobs', async () => {
    const results = await Promise.allSettled(
        Array.from({ length: 37 }, () => createPassword('a strong test password')),
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 36);
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 503);
    assert.equal(
        await verifyPassword(
            'a strong test password',
            results.find((result) => result.status === 'fulfilled').value,
        ),
        true,
    );
});
test('server owners retain control while other roles combine their granted permissions', () => {
    const roles = [
        { id: 'everyone', permissions: ['channels.view'] },
        { id: 'member', permissions: ['calls.join'] },
    ];
    assert.equal(hasPermission({ owner: true, roles: [] }, roles, 'server.edit'), true);
    assert.equal(hasPermission({ owner: false, roles: ['member'] }, roles, 'server.edit'), false);
    assert.equal(hasPermission({ owner: false, roles: ['member'] }, roles, 'calls.join'), true);
});
test('DM access requires exactly two existing distinct participants and membership', () => {
    const channelExists = (r) => r === 'general';
    const userExists = (id) => ['alice', 'bob', 'eve'].includes(id);
    const can = (id, room) => canReadRoom(id, room, channelExists, userExists);
    assert.equal(can('eve', 'general'), true);
    assert.equal(can('alice', 'dm:alice:bob'), true);
    assert.equal(can('bob', 'dm:alice:bob'), true);
    assert.equal(can('eve', 'dm:alice:bob'), false);
    assert.equal(can('alice', 'dm:alice:missing'), false);
    assert.equal(can('alice', 'dm:alice:bob:eve'), false);
    assert.equal(can('alice', 'dm:alice:alice'), false);
    assert.equal(can('alice', 'unknown-channel'), false);
});
