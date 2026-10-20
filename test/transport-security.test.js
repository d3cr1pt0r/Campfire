import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { io as client } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';

test('the server CSP allows plain HTTP connections only to this machine', async (t) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-csp-'));
    const service = createApp({ dataDir });
    t.after(async () => {
        await service.close();
        rmSync(dataDir, { recursive: true, force: true });
    });
    const policy = (await request(service.app, '/info')).headers['content-security-policy'];
    const connect = policy.match(/connect-src ([^;]+)/)[1].split(' ');
    assert.ok(connect.includes('https:') && connect.includes('wss:'));
    assert.equal(connect.includes('http:'), false);
    assert.equal(connect.includes('ws:'), false);
    assert.ok(
        connect.every((source) => !/^(http|ws):\/\/(?!localhost:|127\.0\.0\.1:)/.test(source)),
    );
});

test('changing a password requires the current one and signs out every other device', async (t) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-password-'));
    const service = createApp({ dataDir });
    let socket;
    t.after(async () => {
        socket?.disconnect();
        await service.close();
        rmSync(dataDir, { recursive: true, force: true });
    });
    const api = (token, endpoint, method = 'GET', body) =>
        request(service.app, endpoint, token, method, body);
    const credentials = { username: 'Owner', password: 'original-password-1' };
    const current = (
        await api(null, '/auth/register', 'POST', { ...credentials, setupCode: 'test-owner-setup' })
    ).data.token;
    const other = (await api(null, '/auth/login', 'POST', credentials)).data.token;
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    socket = client(`http://127.0.0.1:${service.http.address().port}`, {
        auth: { token: other },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
    });
    await once(socket, 'connect');
    const change = (token, body) => api(token, '/account/password', 'POST', body);
    assert.equal((await change(null, { current: 'x', password: 'y' })).status, 401);
    const wrong = await change(current, {
        current: 'not-my-password',
        password: 'brand-new-password',
    });
    assert.equal(wrong.status, 403);
    assert.equal(
        (await change(current, { current: credentials.password, password: 'short' })).status,
        400,
    );
    assert.equal((await change(current, { password: 'brand-new-password' })).status, 400);
    const disconnected = once(socket, 'disconnect');
    const changed = await change(current, {
        current: credentials.password,
        password: 'brand-new-password',
    });
    assert.equal(changed.status, 200);
    assert.equal((await disconnected)[0], 'io server disconnect');
    assert.equal((await api(other, '/state')).status, 401);
    assert.equal((await api(current, '/state')).status, 200);
    assert.equal((await api(null, '/auth/login', 'POST', credentials)).status, 401);
    const renewed = await api(null, '/auth/login', 'POST', {
        username: 'Owner',
        password: 'brand-new-password',
    });
    assert.equal(renewed.status, 200);
    const guesser = (
        await api(null, '/auth/register', 'POST', {
            username: 'Guesser',
            password: 'guesser-password-1',
        })
    ).data.token;
    const guess = () =>
        change(guesser, { current: 'wrong-password-x', password: 'another-password' });
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await guess()).status, 403);
    assert.equal((await guess()).status, 429);
});
