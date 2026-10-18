import { migratePermissions } from '../shared/permissions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { io as client } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';

test(
    'live channel access filters events and rosters, revokes calls, and handles deletion',
    { timeout: 15000 },
    async (t) => {
        const directory = mkdtempSync(path.join(tmpdir(), 'campfire-channel-sockets-'));
        const service = createApp({ dataDir: directory }),
            sockets = [];
        t.after(async () => {
            sockets.forEach((socket) => socket.disconnect());
            await service.close();
            rmSync(directory, { recursive: true, force: true });
        });
        await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${service.http.address().port}`;
        const api = async (account, endpoint, method = 'GET', body, status = 200) => {
            const response = await fetch(`${base}/api${endpoint}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const data = await response.json();
            assert.equal(response.status, status, JSON.stringify(data));
            return data;
        };
        const signup = (username) =>
            api(null, '/auth/register', 'POST', {
                username,
                password: 'test-password-123',
                setupCode: 'test-owner-setup',
            });
        const owner = await signup('Owner'),
            bob = await signup('Bob'),
            eve = await signup('Eve');
        const role = await api(owner, '/roles', 'POST', {
            name: 'Bob role',
            color: '#abcdef',
            permissions: migratePermissions(['send', 'voice']),
        });
        await api(owner, `/users/${bob.user.id}/role`, 'PATCH', { role: role.id });
        const text = await api(owner, '/channels', 'POST', { name: 'Secret chat', kind: 'text' });
        const voice = await api(owner, '/channels', 'POST', {
            name: 'Secret voice',
            kind: 'voice',
        });
        const access = (channel, mode) =>
            api(owner, `/channels/${channel}/access`, 'PUT', {
                permissions: [
                    { role: 'member', mode: 'hidden' },
                    { role: role.id, mode },
                ],
            });
        await access(text.id, 'full');
        await access(voice.id, 'full');
        const connect = async (account) => {
            const socket = client(base, {
                auth: { token: account.token },
                forceNew: true,
                reconnection: false,
            });
            sockets.push(socket);
            await once(socket, 'connect');
            return socket;
        };
        const os = await connect(owner),
            bs = await connect(bob),
            es = await connect(eve);
        const join = (socket, channel) =>
            new Promise((resolve, reject) =>
                socket
                    .timeout(2000)
                    .emit('call:join', channel, (error, result) =>
                        error ? reject(error) : resolve(result),
                    ),
            );
        const eventLog = (socket) => {
            const values = [];
            for (const event of ['message', 'message:update', 'message:delete', 'typing'])
                socket.on(event, (data) => {
                    if (data.room === text.id) values.push(event);
                });
            return values;
        };
        const bobEvents = eventLog(bs),
            eveEvents = eventLog(es);
        const eveRosters = [];
        es.on('calls', (calls) => eveRosters.push(calls));
        let incoming = once(bs, 'message');
        const msg = await api(owner, '/messages', 'POST', { room: text.id, body: 'Secret' });
        await incoming;
        assert.deepEqual(bobEvents, ['message']);
        const typing = once(os, 'typing');
        bs.emit('typing', text.id);
        await typing;
        const changes = once(bs, 'message:update');
        await api(owner, `/messages/${msg.id}`, 'PATCH', { pinned: true });
        await changes;
        await join(es, 'lounge');
        assert.deepEqual(eveEvents, []);

        let channels = once(bs, 'channels');
        await access(text.id, 'read-only');
        assert.equal(
            (await channels)[0].find((channel) => channel.id === text.id).access,
            'read-only',
        );
        incoming = once(bs, 'message');
        await api(owner, '/messages', 'POST', { room: text.id, body: 'Readable while read-only' });
        await incoming;
        let leakedTyping = false;
        const listener = (data) => {
            if (data.room === text.id) leakedTyping = true;
        };
        os.on('typing', listener);
        bs.emit('typing', text.id);
        await join(bs, 'lounge');
        await delay(40);
        assert.equal(leakedTyping, false);
        os.off('typing', listener);
        await api(bob, `/messages/${msg.id}/reaction`, 'POST', { emoji: '👍' }, 403);

        channels = once(bs, 'channels');
        await access(text.id, 'hidden');
        assert.equal(
            (await channels)[0].some((channel) => channel.id === text.id),
            false,
        );
        await join(bs, 'lounge');
        bobEvents.length = 0;
        await api(owner, '/messages', 'POST', { room: text.id, body: 'Hidden from Bob too' });
        await api(owner, `/messages/${msg.id}`, 'PATCH', { body: 'Hidden edit' });
        await api(owner, `/messages/${msg.id}`, 'DELETE');
        await join(bs, 'lounge');
        await join(es, 'lounge');
        assert.deepEqual(bobEvents, []);
        assert.deepEqual(eveEvents, []);
        await api(bob, `/messages?room=${text.id}`, 'GET', undefined, 403);

        assert.ok(!(await join(os, voice.id)).error);
        assert.ok(!(await join(bs, voice.id)).error);
        assert.ok((await join(es, voice.id)).error);
        await join(es, 'lounge');
        assert.equal(
            eveRosters.some((calls) => calls.some((call) => call.channel === voice.id)),
            false,
        );
        assert.equal(
            (await api(eve, '/state')).calls.some((call) => call.channel === voice.id),
            false,
        );
        const signal = once(bs, 'signal');
        os.emit('signal', { to: bs.id, data: { version: 2 } });
        await signal;
        const revoked = once(bs, 'call:revoked');
        await access(voice.id, 'hidden');
        await revoked;
        assert.equal(service.io.sockets.sockets.get(bs.id).data.call, null);
        assert.equal(
            (await api(bob, '/state')).calls.some((call) => call.channel === voice.id),
            false,
        );
        let leakedSignal = false;
        bs.on('signal', () => {
            leakedSignal = true;
        });
        os.emit('signal', { to: bs.id, data: { version: 2 } });
        await join(os, voice.id);
        await delay(40);
        assert.equal(leakedSignal, false);
        await access(voice.id, 'full');
        await join(bs, voice.id);
        const ownerRevoked = once(os, 'call:revoked'),
            bobRevoked = once(bs, 'call:revoked');
        await api(owner, `/channels/${voice.id}`, 'DELETE');
        await Promise.all([ownerRevoked, bobRevoked]);
        assert.equal(service.io.sockets.sockets.get(os.id).data.call, null);
        assert.equal(service.io.sockets.sockets.get(bs.id).data.call, null);
        assert.ok((await join(os, voice.id)).error);
    },
);
