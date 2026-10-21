import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { io as client } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';

test(
    'category changes revoke live calls and hide channel events without leaking category metadata',
    { timeout: 10000 },
    async (t) => {
        const directory = mkdtempSync(path.join(tmpdir(), 'campfire-category-sockets-'));
        const service = createApp({ dataDir: directory });
        const sockets = [];
        t.after(async () => {
            sockets.forEach((socket) => socket.disconnect());
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
                    ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const data = await response.json();
            assert.equal(response.status, 200, JSON.stringify(data));
            return data;
        };
        const accounts = [];
        for (const username of ['Owner', 'Member'])
            accounts.push(
                await api(null, '/auth/register', 'POST', {
                    username,
                    password: 'test-password-123',
                    setupCode: 'test-owner-setup',
                }),
            );
        const [owner, member] = accounts;
        const { id } = await api(owner, '/categories', 'POST', { name: 'Secret area' });
        for (const channel of ['general', 'lounge'])
            await api(owner, `/channels/${channel}/category`, 'PUT', {
                category: id,
                synced: true,
            });
        const socket = client(base, {
            auth: { token: member.token },
            forceNew: true,
            reconnection: false,
        });
        sockets.push(socket);
        await once(socket, 'connect');
        const join = () =>
            new Promise((resolve, reject) =>
                socket
                    .timeout(2000)
                    .emit('call:join', 'lounge', (error, result) =>
                        error ? reject(error) : resolve(result),
                    ),
            );
        assert.equal((await join()).error, undefined);
        const revoked = once(socket, 'call:revoked');
        await api(owner, `/categories/${id}/access`, 'PUT', {
            role: 'everyone',
            overrides: [{ permission: 'calls.join', effect: 'deny' }],
        });
        await revoked;
        assert.equal(service.io.sockets.sockets.get(socket.id).data.call, null);
        assert.ok((await join()).error);
        const channelUpdate = new Promise((resolve) =>
            socket.on('channels', (channels) => {
                if (!channels.some((c) => c.id === 'general')) resolve(channels);
            }),
        );
        await api(owner, `/categories/${id}`, 'PATCH', { private: true });
        const channels = await channelUpdate;
        assert.equal(
            channels.some((channel) => ['general', 'lounge'].includes(channel.id)),
            false,
        );
        const state = await api(member, '/state');
        assert.equal(
            state.categories.some((category) => category.id === id),
            false,
        );
        let leaked = false;
        socket.on('message', (message) => {
            if (message.room === 'general') leaked = true;
        });
        await api(owner, '/messages', 'POST', {
            room: 'general',
            body: 'Private category message',
        });
        // An acknowledged event fences preceding server events on this connection.
        await join();
        assert.equal(leaked, false);
    },
);
