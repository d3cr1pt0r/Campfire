import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { io as client } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';
import { fingerprint, loadIdentity } from '../server/identity.js';

async function secureServer(t, tlsOptions) {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-tls-'));
    const service = createApp({
        dataDir,
        tls: tlsOptions?.(dataDir) ?? { directory: path.join(dataDir, 'identity') },
    });
    const sockets = [];
    t.after(async () => {
        sockets.forEach((socket) => socket.disconnect());
        await service.close();
        rmSync(dataDir, { recursive: true, force: true });
    });
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    const port = service.http.address().port;
    const ca = service.identity
        ? readFileSync(
              tlsOptions
                  ? path.join(dataDir, 'files', 'tls-cert.pem')
                  : path.join(dataDir, 'identity', 'tls-cert.pem'),
          )
        : null;
    const request = (endpoint, { method = 'GET', body, token } = {}) =>
        new Promise((resolve, reject) => {
            const req = https.request(
                {
                    host: '127.0.0.1',
                    port,
                    path: `/api${endpoint}`,
                    method,
                    ca,
                    headers: {
                        ...(body ? { 'Content-Type': 'application/json' } : {}),
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () =>
                        resolve({ status: res.statusCode, data: JSON.parse(data) }),
                    );
                },
            );
            req.on('error', reject);
            req.end(body ? JSON.stringify(body) : undefined);
        });
    return { service, port, ca, request, sockets };
}

test('the API and realtime socket run over TLS 1.3 with the pinned server identity', async (t) => {
    const { service, port, ca, request, sockets } = await secureServer(t);
    const owner = await request('/auth/register', {
        method: 'POST',
        body: { username: 'Owner', password: 'secure-password-123', setupCode: 'test-owner-setup' },
    });
    assert.equal(owner.status, 200);
    const state = await request('/state', { token: owner.data.token });
    assert.equal(state.data.identity.fingerprint, service.identity.fingerprint);
    assert.equal(state.data.identity.certificateSha256, service.identity.certificateSha256);
    const socket = client(`https://127.0.0.1:${port}`, {
        auth: { token: owner.data.token },
        ca,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
    });
    sockets.push(socket);
    await once(socket, 'connect');
    const peer = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false });
    await once(peer, 'secureConnect');
    assert.equal(peer.getProtocol(), 'TLSv1.3');
    assert.equal(fingerprint(peer.getPeerX509Certificate()), service.identity.fingerprint);
    peer.destroy();
});

test('TLS 1.2, unverified certificates and plain HTTP are refused', async (t) => {
    const { port, ca } = await secureServer(t);
    const legacy = tls.connect({ host: '127.0.0.1', port, ca, maxVersion: 'TLSv1.2' });
    const [legacyError] = await once(legacy, 'error');
    assert.match(legacyError.code, /PROTOCOL_VERSION|UNSUPPORTED_PROTOCOL/);
    const unpinned = https.get({ host: '127.0.0.1', port, path: '/api/info' });
    const [untrusted] = await once(unpinned, 'error');
    assert.match(untrusted.code, /SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/);
    const otherDirectory = mkdtempSync(path.join(tmpdir(), 'campfire-other-'));
    t.after(() => rmSync(otherDirectory, { recursive: true, force: true }));
    const other = loadIdentity({ directory: otherDirectory });
    const peer = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false });
    await once(peer, 'secureConnect');
    assert.notEqual(fingerprint(peer.getPeerX509Certificate()), other.fingerprint);
    peer.destroy();
    const plain = http.get({ host: '127.0.0.1', port, path: '/api/info' });
    const outcome = await Promise.race([
        once(plain, 'error').then(() => 'error'),
        once(plain, 'response').then(([res]) => res.statusCode),
    ]);
    assert.notEqual(outcome, 200);
    plain.destroy();
});

test('host-provided certificate files are served without publishing a pin', async (t) => {
    const { service, request } = await secureServer(t, (dataDir) => {
        const directory = path.join(dataDir, 'files');
        loadIdentity({ directory });
        return {
            certFile: path.join(directory, 'tls-cert.pem'),
            keyFile: path.join(directory, 'tls-key.pem'),
        };
    });
    assert.equal(service.identity.fingerprint, undefined);
    assert.equal((await request('/info')).status, 200);
    const owner = await request('/auth/register', {
        method: 'POST',
        body: { username: 'Owner', password: 'secure-password-123', setupCode: 'test-owner-setup' },
    });
    const state = await request('/state', { token: owner.data.token });
    assert.deepEqual(Object.keys(state.data.identity), ['certificateSha256']);
});
