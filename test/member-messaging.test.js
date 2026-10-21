import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
import { canonicalRoom, dmParticipant } from '../shared/rooms.js';
import { roleFixture } from '../test-support/role-fixture.js';

test('member DMs, attachments and sessions survive a restart without relationship endpoints', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-member-restart-'));
    let service = createApp({ dataDir });
    try {
        const signup = async (username) => {
            const result = await request(service.app, '/auth/register', null, 'POST', {
                username,
                password: 'member-test-password',
                setupCode: 'test-owner-setup',
            });
            assert.equal(result.status, 200);
            return result.data;
        };
        const alice = await signup('Alice'),
            bob = await signup('Bob'),
            other = await signup('Other');
        const room = canonicalRoom(`dm:${alice.user.id}:${bob.user.id}`);
        const sent = await request(service.app, '/messages', alice.token, 'POST', {
            room,
            body: 'A direct conversation',
            attachments: [
                { name: 'note.txt', data: Buffer.from('saved attachment').toString('base64') },
            ],
        });
        assert.equal(sent.status, 200);
        await service.close();
        service = createApp({ dataDir });
        assert.equal(service.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
        const state = await request(service.app, '/state', alice.token);
        assert.equal(state.status, 200);
        assert.equal('friends' in state.data, false);
        assert.equal(state.data.users.length, 3);
        assert.deepEqual(state.data.directMessages, [
            { room, updated: sent.data.created, received: 0 },
        ]);
        assert.deepEqual(
            (await request(service.app, '/state', other.token)).data.directMessages,
            [],
        );
        assert.deepEqual((await request(service.app, '/state', bob.token)).data.directMessages, [
            { room, updated: sent.data.created, received: sent.data.created },
        ]);
        const history = await request(
            service.app,
            `/messages?room=${encodeURIComponent(room)}`,
            bob.token,
        );
        assert.equal(history.status, 200);
        assert.equal(history.data[0].body, 'A direct conversation');
        const file = await request(
            service.app,
            `/attachments/${history.data[0].attachments[0].id}`,
            bob.token,
        );
        assert.equal(file.status, 200);
        assert.equal(file.data.toString(), 'saved attachment');
        assert.equal(
            (await request(service.app, `/messages?room=${encodeURIComponent(room)}`, other.token))
                .status,
            403,
        );
        assert.equal(
            (await request(service.app, '/friends', alice.token, 'POST', { username: 'Bob' }))
                .status,
            404,
        );
        assert.equal(
            (await request(service.app, `/friends/${bob.user.id}`, alice.token, 'DELETE')).status,
            404,
        );
        await service.close();
        service = createApp({ dataDir });
        assert.equal(
            service.db.prepare("SELECT name FROM sqlite_master WHERE name='friends'").get(),
            undefined,
        );
        assert.equal(
            (await request(service.app, `/messages?room=${encodeURIComponent(room)}`, bob.token))
                .data.length,
            1,
        );
    } finally {
        await service.close();
        rmSync(dataDir, { recursive: true, force: true });
    }
});

test('DM activity distinguishes incoming messages from outgoing messages after reconnect', async (t) => {
    const f = await roleFixture(t);
    const room = canonicalRoom(`dm:${f.owner.user.id}:${f.member.user.id}`);
    const incoming = await f.api(f.member, '/messages', 'POST', { room, body: 'Incoming' });
    const outgoing = await f.api(f.owner, '/messages', 'POST', { room, body: 'Outgoing' });
    assert.deepEqual((await f.api(f.owner, '/state')).directMessages, [
        { room, updated: outgoing.created, received: incoming.created },
    ]);
    assert.deepEqual((await f.api(f.other, '/state')).directMessages, []);
    await f.restart();
    assert.equal((await f.api(f.owner, '/state')).directMessages[0].received, incoming.created);
    const next = await f.api(f.member, '/messages', 'POST', { room, body: 'New incoming' });
    assert.equal((await f.api(f.owner, '/state')).directMessages[0].received, next.created);
});

test('personal DMs persist notes and files privately, support normal actions, and cannot start self calls', async (t) => {
    const f = await roleFixture(t);
    const room = canonicalRoom(`dm:${f.member.user.id}:${f.member.user.id}`);
    assert.equal(dmParticipant(room, f.member.user.id), f.member.user.id);
    assert.equal(dmParticipant(room, f.owner.user.id), null);
    assert.equal(
        dmParticipant(`dm:${f.owner.user.id}:${f.member.user.id}`, f.owner.user.id),
        f.member.user.id,
    );
    const sent = await f.api(f.member, '/messages', 'POST', {
        room,
        body: 'A private note to myself',
        attachments: [
            { name: 'private.txt', data: Buffer.from('private file').toString('base64') },
        ],
    });
    const thread = await f.api(f.member, '/messages', 'POST', {
        room,
        thread: sent.id,
        body: 'A private reply',
    });
    await f.api(f.member, `/messages/${sent.id}`, 'PATCH', {
        body: 'An edited personal note',
        pinned: true,
    });
    await f.api(f.member, `/messages/${sent.id}/reaction`, 'POST', { emoji: '👍' });
    for (const account of [f.owner, f.other]) {
        await f.api(account, `/messages?room=${encodeURIComponent(room)}`, 'GET', undefined, 403);
        await f.api(account, `/messages/${sent.id}`, 'GET', undefined, 404);
        await f.api(account, `/attachments/${sent.attachments[0].id}`, 'GET', undefined, 404);
        await f.api(account, '/messages', 'POST', { room, body: 'Intrusion' }, 403);
        assert.ok(
            !(await f.api(account, '/state')).directMessages.some((entry) => entry.room === room),
        );
    }
    await f.api(f.member, '/calls', 'POST', { user: f.member.user.id }, 403);
    await f.restart();
    assert.deepEqual((await f.api(f.member, '/state')).directMessages, [
        { room, updated: thread.created, received: 0 },
    ]);
    const history = await f.api(
        f.member,
        `/messages?room=${encodeURIComponent(room)}&search=personal`,
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].pinned, 1);
    assert.equal(history[0].reactions.length, 1);
    assert.equal(
        (await f.api(f.member, `/attachments/${sent.attachments[0].id}`)).toString(),
        'private file',
    );
    await f.api(f.member, `/messages/${thread.id}`, 'DELETE');
    await f.api(f.member, `/messages/${sent.id}`, 'DELETE');
    assert.deepEqual(await f.api(f.member, `/messages?room=${encodeURIComponent(room)}`), []);
});
