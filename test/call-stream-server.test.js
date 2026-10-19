import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { io as client } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';

test(
    'stream roster reaches viewers outside the call, respects channel access, and clears stale shares',
    { timeout: 15000 },
    async (t) => {
        const directory = mkdtempSync(path.join(tmpdir(), 'campfire-stream-roster-'));
        const service = createApp({ dataDir: directory }),
            sockets = [];
        t.after(async () => {
            sockets.forEach((s) => s.disconnect());
            await service.close();
            rmSync(directory, { recursive: true, force: true });
        });
        await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${service.http.address().port}`;
        const api = async (account, endpoint, method = 'GET', body) => {
            const response = await fetch(base + '/api' + endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(account ? { Authorization: 'Bearer ' + account.token } : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            assert.equal(response.status, 200);
            return response.json();
        };
        const owner = await api(null, '/auth/register', 'POST', {
            username: 'Owner',
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        });
        const viewer = await api(null, '/auth/register', 'POST', {
            username: 'Viewer',
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        });
        const connect = async (account) => {
            const s = client(base, {
                auth: { token: account.token },
                forceNew: true,
                reconnection: false,
            });
            sockets.push(s);
            await once(s, 'connect');
            return s;
        };
        const sender = await connect(owner),
            observer = await connect(viewer);
        const join = (s, channel) =>
            new Promise((resolve, reject) =>
                s
                    .timeout(2000)
                    .emit('call:join', channel, (error, result) =>
                        error ? reject(error) : resolve(result),
                    ),
            );
        const state = () => api(viewer, '/state');
        const wait = async (predicate) => {
            for (let i = 0; i < 100; i++) {
                if (await predicate()) return;
                await delay(10);
            }
            throw Error('Roster update timed out');
        };
        sender.emit('call:media', 'outside-call');
        assert.deepEqual((await state()).calls, []);
        await join(sender, 'lounge');
        const broadcast = new Promise((resolve) => {
            const receive = (calls) => {
                if (calls.some((call) => call.shareId === 'share-one')) {
                    observer.off('calls', receive);
                    resolve(calls);
                }
            };
            observer.on('calls', receive);
        });
        sender.emit('call:media', 'share-one');
        assert.equal((await broadcast)[0].shareId, 'share-one');
        assert.equal((await state()).calls[0].shareId, 'share-one');
        for (const invalid of ['', 'x'.repeat(81), {}, true]) sender.emit('call:media', invalid);
        await delay(30);
        assert.equal((await state()).calls[0].shareId, 'share-one');
        sender.emit('call:media', null);
        await wait(async () => (await state()).calls[0]?.shareId === null);
        sender.emit('call:media', 'share-two');
        await wait(async () => (await state()).calls[0]?.shareId === 'share-two');
        sender.emit('call:leave');
        await wait(async () => (await state()).calls.length === 0);
        await join(sender, 'lounge');
        assert.equal((await state()).calls[0].shareId, null);
        const secret = await api(owner, '/channels', 'POST', {
            name: 'Hidden voice',
            kind: 'voice',
        });
        await api(owner, '/roles/everyone/access', 'PUT', {
            overrides: [{ channel: secret.id, permission: 'channels.view', effect: 'deny' }],
        });
        await join(sender, secret.id);
        sender.emit('call:media', 'secret-share');
        await delay(30);
        assert.deepEqual((await state()).calls, []);
        assert.equal((await api(owner, '/state')).calls[0].shareId, 'secret-share');
        sender.disconnect();
        await wait(async () => (await api(owner, '/state')).calls.length === 0);
    },
);
