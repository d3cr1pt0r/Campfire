import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { io as client } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
test(
    'call joining, initiation, media announcements and live revocation enforce distinct permissions',
    { timeout: 10000 },
    async (t) => {
        const directory = mkdtempSync(path.join(tmpdir(), 'campfire-call-permissions-'));
        const service = createApp({ dataDir: directory }),
            sockets = [];
        t.after(async () => {
            sockets.forEach((s) => s.disconnect());
            await service.close();
            rmSync(directory, { recursive: true, force: true });
        });
        await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${service.http.address().port}`;
        const api = async (account, endpoint, method = 'GET', body, status = 200) => {
            const response = await request(service.app, endpoint, account?.token, method, body);
            assert.equal(response.status, status, JSON.stringify(response.data));
            return response.data;
        };
        const signup = (username) =>
            api(null, '/auth/register', 'POST', {
                username,
                password: 'test-password-123',
                setupCode: 'test-owner-setup',
            });
        const owner = await signup('Owner'),
            member = await signup('Member');
        const flags = (permissions) =>
            api(owner, '/roles/member', 'PATCH', { name: 'Member', color: '#abcdef', permissions });
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
        const a = await connect(owner),
            b = await connect(member);
        const join = (s, channel = 'lounge') =>
            new Promise((resolve) => s.emit('call:join', channel, resolve));
        assert.ok((await join(a)).peers);
        await flags([]);
        assert.ok((await join(b)).error);
        await flags(['calls.join']);
        assert.ok((await join(b)).peers);
        let signals = 0,
            speaking = 0;
        a.on('signal', () => signals++);
        a.on('call:speaking', () => speaking++);
        const signal = (media) => b.emit('signal', { to: a.id, data: { version: 2, media } });
        signal({ camera: true, sharing: false, shareId: null });
        b.emit('call:media', 'blocked-share');
        b.emit('call:speaking', true);
        await delay(50);
        assert.equal(signals, 0);
        assert.equal(speaking, 0);
        assert.equal(
            (await api(owner, '/state')).calls.find((c) => c.user === member.user.id).shareId,
            null,
        );
        await flags(['calls.join', 'calls.camera']);
        signal({ camera: true, sharing: false, shareId: null });
        await delay(40);
        assert.equal(signals, 1);
        signal({ camera: false, sharing: true, shareId: 'blocked' });
        await delay(40);
        assert.equal(signals, 1);
        await flags(['calls.join', 'calls.share', 'calls.speak']);
        signal({ camera: false, sharing: true, shareId: 'allowed' });
        b.emit('call:media', 'allowed');
        b.emit('call:speaking', true);
        await delay(50);
        assert.equal(signals, 2);
        assert.equal(speaking, 1);
        assert.equal(
            (await api(owner, '/state')).calls.find((c) => c.user === member.user.id).shareId,
            'allowed',
        );
        await flags(['calls.join']);
        assert.equal(
            (await api(owner, '/state')).calls.find((c) => c.user === member.user.id).shareId,
            null,
        );
        const revoked = once(b, 'call:revoked');
        await flags([]);
        await revoked;
        assert.equal(
            (await api(owner, '/state')).calls.some((c) => c.user === member.user.id),
            false,
        );
        // Calling another member requires both Join and Start permissions.
        await flags(['calls.join']);
        await api(member, '/calls', 'POST', { user: owner.user.id }, 403);
        await flags(['calls.start']);
        await api(member, '/calls', 'POST', { user: owner.user.id }, 403);
        await flags(['calls.join', 'calls.start']);
        const direct = await api(member, '/calls', 'POST', { user: owner.user.id });
        assert.ok(direct.id.startsWith('private:'));
    },
);
