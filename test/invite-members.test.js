import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteMembers } from '../src/inviteMembers.ts';

test('invite lists order by presence then display name and search nicknames and usernames', () => {
    const users = [
        { id: 'offline', username: 'Aaron', nickname: 'Offline' },
        { id: 'dnd', username: 'Busy' },
        { id: 'idle', username: 'Idle' },
        { id: 'z', username: 'Zed' },
        { id: 'a', username: 'Alice', nickname: 'Able' },
    ];
    const state = {
        online: ['dnd', 'idle', 'z', 'a'],
        presence: { dnd: 'dnd', idle: 'idle', offline: 'online' },
    };
    assert.deepEqual(
        inviteMembers(state, users, '').map((user) => user.id),
        ['a', 'z', 'idle', 'dnd', 'offline'],
    );
    assert.deepEqual(
        inviteMembers(state, users, ' aLiCe ').map((user) => user.id),
        ['a'],
    );
    assert.deepEqual(
        inviteMembers(state, users, 'abl').map((user) => user.id),
        ['a'],
    );
    assert.equal(users[0].id, 'offline', 'sorting does not mutate the source directory');
});
