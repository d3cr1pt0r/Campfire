import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';

test('thread events broadcast reply counts and typing only to authorized room participants', async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-thread-events-'));
    const service = createApp({ dataDir: directory });
    const sockets = [];
    t.after(async () => {
        for (const socket of sockets) {
            service.io.sockets.sockets.delete(socket.id);
            service.io.sockets.adapter.delAll(socket.id);
        }
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const api = async (account, endpoint, method = 'GET', body) => {
        const result = await request(service.app, endpoint, account?.token, method, body);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        return result.data;
    };
    const signup = (username) =>
        api(null, '/auth/register', 'POST', {
            username,
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        });
    const alice = await signup('Alice'),
        bob = await signup('Bob'),
        eve = await signup('Eve');
    const attach = (account) => {
        const socket = new EventEmitter();
        const id = account.user.id;
        Object.assign(socket, {
            id,
            data: { user: account.user, token: account.token },
            join(room) {
                service.io.sockets.adapter.addAll(id, new Set([room]));
            },
            use() {},
            client: { writeToEngine() {} },
            notifyOutgoingListeners() {},
        });
        service.io.sockets.sockets.set(id, socket);
        sockets.push(socket);
        EventEmitter.prototype.emit.call(service.io.sockets, 'connection', socket);
        return socket;
    };
    const a = attach(alice),
        b = attach(bob),
        e = attach(eve);
    const room = `dm:${[alice.user.id, bob.user.id].sort().join(':')}`;
    const root = await api(alice, '/messages', 'POST', { room, body: 'Private parent' });
    const received = [],
        counts = [],
        leaked = [],
        typing = [];
    b.on('message', (message) => received.push(message));
    b.on('message:update', (message) => counts.push(message.replyCount));
    b.on('typing', (event) => typing.push(event));
    for (const event of ['message', 'message:update', 'message:delete', 'typing'])
        e.on(event, (payload) => {
            if (typeof payload === 'object') leaked.push(payload);
        });
    const reply = await api(alice, '/messages', 'POST', {
        room,
        thread: root.id,
        body: 'Private reply',
    });
    assert.equal(received[0].thread, root.id);
    assert.deepEqual(counts, [1]);
    a.emit('typing', room, root.id);
    assert.deepEqual(typing, [{ room, user: alice.user.id, thread: root.id }]);
    a.emit('typing', room, reply.id);
    a.emit('typing', room, {});
    a.emit('typing', 'general', root.id);
    e.emit('typing', room, root.id);
    assert.equal(typing.length, 1);
    a.emit('typing', room);
    assert.equal(typing[1].thread, undefined);
    const deleted = [];
    b.on('message:delete', (event) => deleted.push(event));
    await api(alice, `/messages/${reply.id}`, 'DELETE');
    assert.deepEqual(counts, [1, 0]);
    assert.equal(deleted[0].id, reply.id);
    assert.deepEqual(leaked, []);
    b.emit('call:status', { muted: true, deafened: true, camera: true });
    assert.equal((await api(alice, '/state')).calls.length, 0);
    b.emit('call:join', 'lounge', () => {});
    b.emit('call:status', { muted: false, deafened: true, camera: true });
    let member = (await api(alice, '/state')).calls.find((c) => c.user === bob.user.id);
    assert.equal(member.muted, true);
    assert.equal(member.deafened, true);
    assert.equal(member.camera, true);
    b.emit('call:status', { muted: 'no', deafened: false, camera: false });
    assert.equal((await api(alice, '/state')).calls[0].camera, true);
    const role = await api(alice, '/roles', 'POST', {
        name: 'No camera',
        color: '#aabbcc',
        permissions: ['channels.view', 'calls.join', 'calls.speak'],
    });
    await api(alice, `/users/${bob.user.id}/roles`, 'PATCH', { roles: [role.id] });
    assert.equal((await api(alice, '/state')).calls[0].camera, false);
    // Real Socket.IO middleware refreshes the user on every incoming packet.
    b.data.user.roles = [role.id];
    b.emit('call:status', { muted: true, deafened: false, camera: true });
    assert.equal((await api(alice, '/state')).calls[0].camera, false);
});
