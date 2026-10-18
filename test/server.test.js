import { migratePermissions } from '../shared/permissions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { io as client } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';
test(
    'an idle authenticated transport disconnects when its session expires',
    { timeout: 5000 },
    async (t) => {
        const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-expiry-'));
        const service = createApp({ dataDir, sessionLifetimeMs: 250 });
        let socket;
        t.after(async () => {
            socket?.disconnect();
            await service.close();
            rmSync(dataDir, { recursive: true, force: true });
        });
        await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${service.http.address().port}`;
        const response = await fetch(`${base}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'Expiry',
                password: 'test-password-123',
                setupCode: 'test-owner-setup',
            }),
        });
        const { token } = await response.json();
        socket = client(base, { auth: { token }, forceNew: true, reconnection: false });
        await once(socket, 'connect');
        const [reason] = await once(socket, 'disconnect');
        assert.equal(reason, 'io server disconnect');
        assert.equal(
            (await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } }))
                .status,
            401,
        );
    },
);
test(
    'self-hosted communication, authorization, persistence and signaling',
    { timeout: 30000 },
    async (t) => {
        const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-test-'));
        let service = createApp({ dataDir });
        await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
        let base = `http://127.0.0.1:${service.http.address().port}`;
        const sockets = [];
        t.after(async () => {
            sockets.forEach((s) => s.disconnect());
            await service.close();
            rmSync(dataDir, { recursive: true, force: true });
        });
        const request = async (endpoint, { token, method = 'GET', body, status = 200 } = {}) => {
            const res = await fetch(base + '/api' + endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const data = await res.json();
            assert.equal(res.status, status, JSON.stringify(data));
            return data;
        };
        const signup = (username) =>
            request('/auth/register', {
                method: 'POST',
                body: { username, password: 'test-password-123', setupCode: 'test-owner-setup' },
            });
        const alice = await signup('Alice');
        const bob = await signup('Bob');
        const eve = await signup('Eve');
        const api = (u, endpoint, method = 'GET', body, status = 200) =>
            request(endpoint, { token: u.token, method, body, status });
        const socketFor = async (u) => {
            const s = client(base, {
                auth: { token: u.token },
                forceNew: true,
                reconnection: false,
            });
            sockets.push(s);
            await once(s, 'connect');
            return s;
        };
        let textMessage, dmMessage, readonly, channel;
        await t.test(
            'first user is owner, passwords are hashed, sessions require authentication',
            async () => {
                assert.equal(alice.user.role, 'owner');
                assert.equal(bob.user.role, 'member');
                assert.notEqual(
                    service.db.prepare('SELECT password FROM users WHERE id=?').get(alice.user.id)
                        .password,
                    'test-password-123',
                );
                await request('/state', { status: 401 });
                await request('/auth/register', {
                    method: 'POST',
                    body: {
                        username: 'Alice',
                        password: 'test-password-123',
                        setupCode: 'test-owner-setup',
                    },
                    status: 409,
                });
                await request('/auth/login', {
                    method: 'POST',
                    body: {
                        username: 'Alice',
                        password: 'wrong-password',
                        setupCode: 'test-owner-setup',
                    },
                    status: 401,
                });
                const login = await request('/auth/login', {
                    method: 'POST',
                    body: {
                        username: 'Alice',
                        password: 'test-password-123',
                        setupCode: 'test-owner-setup',
                    },
                });
                await api(login, '/logout', 'POST');
                await api(login, '/state', 'GET', undefined, 401);
            },
        );
        const as = await socketFor(alice),
            bs = await socketFor(bob),
            es = await socketFor(eve);
        await t.test('public messages persist and broadcast', async () => {
            const received = once(bs, 'message');
            textMessage = await api(alice, '/messages', 'POST', {
                room: 'general',
                body: 'Hello everyone',
            });
            assert.equal((await received)[0].id, textMessage.id);
            assert.equal((await api(bob, '/messages?room=general'))[0].body, 'Hello everyone');
        });
        await t.test('DMs are visible only to the two participants', async () => {
            const room = `dm:${[alice.user.id, bob.user.id].sort().join(':')}`;
            let leaked = false;
            const listener = () => {
                leaked = true;
            };
            es.on('message', listener);
            const received = once(bs, 'message');
            dmMessage = await api(alice, '/messages', 'POST', { room, body: 'Private hello' });
            assert.equal((await received)[0].id, dmMessage.id);
            await api(eve, `/messages?room=${encodeURIComponent(room)}`, 'GET', undefined, 403);
            await api(eve, `/messages/${dmMessage.id}`, 'PATCH', { body: 'Hijacked' }, 404);
            es.off('message', listener);
            assert.equal(leaked, false);
        });
        await t.test('friend requests require acceptance by the recipient', async () => {
            await api(alice, '/friends', 'POST', { username: 'Bob' });
            let state = await api(bob, '/state');
            assert.equal(state.friends[0].accepted, 0);
            await api(bob, '/friends', 'POST', { username: 'Alice' });
            state = await api(alice, '/state');
            assert.equal(state.friends[0].accepted, 1);
            assert.equal((await api(eve, '/state')).friends.length, 0);
        });
        await t.test('message ownership, editing, reactions, pinning, and search', async () => {
            await api(bob, `/messages/${textMessage.id}`, 'PATCH', { body: 'No' }, 403);
            await api(bob, `/messages/${textMessage.id}`, 'DELETE', undefined, 403);
            await api(alice, `/messages/${textMessage.id}`, 'PATCH', { body: 'Edited hello' });
            await api(bob, `/messages/${textMessage.id}/reaction`, 'POST', { emoji: '👍' });
            await api(bob, `/messages/${textMessage.id}`, 'PATCH', { pinned: true }, 403);
            await api(alice, `/messages/${textMessage.id}`, 'PATCH', { pinned: true });
            const result = await api(bob, '/messages?room=general&search=Edited');
            assert.equal(result.length, 1);
            assert.ok(result[0].edited);
            assert.equal(result[0].pinned, 1);
            assert.equal(result[0].reactions.length, 1);
            await api(bob, `/messages/${textMessage.id}/reaction`, 'POST', { emoji: '👍' });
            assert.equal((await api(bob, '/messages?room=general'))[0].reactions.length, 0);
        });
        await t.test('thread replies and parent counts reach live Socket.IO clients', async () => {
            const received = once(bs, 'message');
            const updated = once(bs, 'message:update');
            const reply = await api(alice, '/messages', 'POST', {
                room: textMessage.room,
                thread: textMessage.id,
                body: 'A threaded reply',
            });
            assert.equal((await received)[0].thread, textMessage.id);
            const parent = (await updated)[0];
            assert.equal(parent.id, textMessage.id);
            assert.equal(parent.replyCount, 1);
            assert.equal((await api(bob, '/messages?room=general')).length, 1);
            const typing = once(bs, 'typing');
            as.emit('typing', textMessage.room, textMessage.id);
            assert.equal((await typing)[0].thread, textMessage.id);
            const removed = once(bs, 'message:delete');
            const recounted = once(bs, 'message:update');
            await api(alice, `/messages/${reply.id}`, 'DELETE');
            assert.equal((await removed)[0].id, reply.id);
            assert.equal((await recounted)[0].replyCount, 0);
        });
        await t.test('attachments enforce conversation access and a size limit', async () => {
            const message = await api(alice, '/messages', 'POST', {
                room: dmMessage.room,
                body: '',
                attachment: { name: 'hello.txt', data: Buffer.from('hello').toString('base64') },
            });
            const res = await fetch(base + `/api/attachments/${message.attachments[0].id}`, {
                headers: { Authorization: `Bearer ${bob.token}` },
            });
            assert.equal(await res.text(), 'hello');
            assert.match(res.headers.get('content-disposition'), /^attachment/);
            await api(eve, `/attachments/${message.attachments[0].id}`, 'GET', undefined, 404);
            await api(
                alice,
                '/messages',
                'POST',
                {
                    room: 'general',
                    body: '',
                    attachment: { name: 'large', data: 'A'.repeat(7000004) },
                },
                400,
            );
        });
        await t.test('management and role permissions are enforced on the server', async () => {
            await api(bob, '/channels', 'POST', { name: 'test', kind: 'text' }, 403);
            channel = await api(alice, '/channels', 'POST', { name: 'testing', kind: 'text' });
            assert.ok(channel.id);
            readonly = await api(alice, '/roles', 'POST', {
                name: 'Read only',
                color: '#aa88ff',
                permissions: [],
            });
            await api(alice, `/users/${bob.user.id}/role`, 'PATCH', { role: readonly.id });
            await api(bob, '/messages', 'POST', { room: 'general', body: 'No permission' }, 403);
            await api(bob, `/users/${alice.user.id}/role`, 'PATCH', { role: 'member' }, 403);
            await api(alice, `/users/${alice.user.id}/role`, 'PATCH', { role: 'member' }, 400);
            await api(alice, `/roles/${readonly.id}`, 'PATCH', {
                name: 'Listener',
                color: '#112233',
                permissions: migratePermissions(['voice']),
            });
            assert.equal(
                (await api(bob, '/state')).roles.find((r) => r.id === readonly.id).color,
                '#112233',
            );
        });
        await t.test('voice signaling requires membership in the same voice channel', async () => {
            const join = (s, room) => new Promise((resolve) => s.emit('call:join', room, resolve));
            assert.ok((await join(bs, 'general')).error);
            await api(alice, `/roles/${readonly.id}`, 'PATCH', {
                name: 'No calls',
                color: '#112233',
                permissions: [],
            });
            assert.ok((await join(bs, 'lounge')).error);
            await api(alice, `/users/${bob.user.id}/role`, 'PATCH', { role: 'member' });
            assert.equal((await join(as, 'lounge')).peers.length, 0);
            assert.equal((await join(bs, 'lounge')).peers.length, 1);
            const signal = once(bs, 'signal');
            as.emit('signal', { to: bs.id, data: { candidate: { candidate: 'test' } } });
            assert.equal((await signal)[0].from, as.id);
            assert.equal((await api(alice, '/state')).calls.length, 2);
            bs.emit('call:leave');
        });
        await t.test(
            'logout invalidates the token and terminates authenticated socket',
            async () => {
                const disconnected = once(es, 'disconnect');
                await api(eve, '/logout', 'POST');
                await disconnected;
                await api(eve, '/state', 'GET', undefined, 401);
            },
        );
        await t.test('data survives restarting the server', async () => {
            sockets.forEach((s) => s.disconnect());
            await service.close();
            service = createApp({ dataDir });
            await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
            base = `http://127.0.0.1:${service.http.address().port}`;
            assert.equal((await api(alice, '/messages?room=general'))[0].body, 'Edited hello');
            assert.equal((await api(alice, '/state')).friends[0].accepted, 1);
            await api(alice, `/messages/${textMessage.id}`, 'DELETE');
            assert.equal((await api(alice, '/messages?room=general')).length, 0);
        });
    },
);
