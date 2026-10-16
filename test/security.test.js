import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassword, verifyPassword, tokenHash, hasPermission, canReadRoom } from '../server/security.js';
test('password hashes are salted and never accept a missing account', () => {
    const a = createPassword('a strong test password'), b = createPassword('a strong test password');
    assert.notEqual(a, b);
    assert.equal(verifyPassword('a strong test password', a), true);
    assert.equal(verifyPassword('wrong password', a), false);
    assert.equal(verifyPassword('anything', undefined), false);
});
test('session tokens have a deterministic one-way storage key', () => {
    assert.equal(tokenHash('sample-token').length, 64);
    assert.equal(tokenHash('sample-token'), tokenHash('sample-token'));
    assert.notEqual(tokenHash('sample-token'), tokenHash('other-token'));
});
test('server owners retain control while other roles get only their permissions', () => {
    assert.equal(hasPermission({ role: 'owner' }, [], 'manage'), true);
    assert.equal(hasPermission({ role: 'member' }, ['send', 'voice'], 'manage'), false);
    assert.equal(hasPermission({ role: 'member' }, ['voice'], 'voice'), true);
});
test('DM access requires exactly two existing distinct participants and membership', () => {
    const channelExists = r => r === 'general';
    const userExists = id => ['alice', 'bob', 'eve'].includes(id);
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
