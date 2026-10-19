import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fingerprint as serverFingerprint, issueCertificate } from '../server/identity.js';
import { createApp } from '../test-support/open-server.js';
const require = createRequire(import.meta.url);
const pins = require('../electron/pins.cjs');
const { createClientState } = require('../electron/client-state.cjs');

const memoryStore = (initial = '{}') => {
    let saved = initial;
    return {
        store: pins.createPinStore(
            () => saved,
            (value) => (saved = value),
        ),
        saved: () => JSON.parse(saved),
    };
};

test('desktop and server compute the same fingerprint for a certificate', () => {
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
    });
    const certificate = issueCertificate(key, ['localhost']);
    assert.equal(pins.fingerprint(certificate), serverFingerprint(key));
    assert.equal(pins.normalizeFingerprint(' wmcf-b4xo '), null);
    const value = serverFingerprint(key);
    assert.equal(
        pins.normalizeFingerprint(
            value
                .toLowerCase()
                .match(/.{1,4}/g)
                .join('-'),
        ),
        value,
    );
    assert.equal(pins.normalizeFingerprint(42), null);
});

test('only bare https origins can be pinned', () => {
    assert.deepEqual(pins.parseOrigin('https://Chat.Example.com:3001'), {
        origin: 'https://chat.example.com:3001',
        host: 'chat.example.com',
        port: 3001,
    });
    assert.deepEqual(pins.parseOrigin('https://[::1]:3001/'), {
        origin: 'https://[::1]:3001',
        host: '::1',
        port: 3001,
    });
    assert.equal(pins.parseOrigin('https://chat.example.com').port, 443);
    for (const invalid of [
        'http://chat.example.com',
        'https://user@chat.example.com',
        'https://chat.example.com/path',
        'https://chat.example.com/#pin=x',
        'not a url',
    ])
        assert.throws(() => pins.parseOrigin(invalid));
});

test('pins are kept per origin and certificate checks follow the decision table', () => {
    const a = 'A'.repeat(52),
        b = 'B'.repeat(52);
    const { store, saved } = memoryStore('not json');
    assert.equal(store.get('https://chat.example.com:3001'), null);
    store.set('https://chat.example.com:3001', a);
    store.set('https://chat.example.com:4001', b);
    assert.deepEqual(saved(), {
        'chat.example.com': {
            'https://chat.example.com:3001': a,
            'https://chat.example.com:4001': b,
        },
    });
    // Chromium sees no port, so a pinned host accepts only its pinned keys.
    assert.equal(pins.verifyDecision(store, 'CHAT.example.com', a, -202), 0);
    assert.equal(pins.verifyDecision(store, 'chat.example.com', b, 0), 0);
    assert.equal(pins.verifyDecision(store, 'chat.example.com', 'C'.repeat(52), 0), -2);
    assert.equal(pins.verifyDecision(store, 'chat.example.com', null, 0), -2);
    assert.equal(pins.verifyDecision(store, 'other.example', null, 0), -3);
    assert.equal(pins.verifyDecision(store, 'other.example', a, -202), -2);
    assert.equal(pins.checkState(store, 'https://chat.example.com:3001', a, false), 'pinned');
    assert.equal(pins.checkState(store, 'https://chat.example.com:3001', b, true), 'changed');
    assert.equal(pins.checkState(store, 'https://new.example', a, true), 'trusted');
    assert.equal(pins.checkState(store, 'https://new.example', a, false), 'unknown');
    store.remove('https://chat.example.com:3001');
    store.remove('https://chat.example.com:4001');
    assert.deepEqual(saved(), {});
});

test('pins live in main-process-only client state the renderer bridge cannot write', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-pins-'));
    try {
        const plain = { isEncryptionAvailable: () => false };
        const state = createClientState(directory, plain);
        assert.equal(state.set('pins', '{}'), false);
        assert.equal(state.get('pins'), null);
        assert.equal(state.setInternal('connection', '{}'), false);
        assert.equal(state.setInternal('pins', JSON.stringify({ host: { origin: 'x' } })), true);
        const reopened = createClientState(directory, plain);
        assert.equal(reopened.get('pins'), null);
        assert.deepEqual(JSON.parse(reopened.getInternal('pins')), { host: { origin: 'x' } });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('the desktop pre-flight reads a live server identity without trusting it', async (t) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-inspect-'));
    const service = createApp({ dataDir, tls: { directory: path.join(dataDir, 'identity') } });
    t.after(async () => {
        await service.close();
        rmSync(dataDir, { recursive: true, force: true });
    });
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    const result = await pins.inspectServer({
        host: '127.0.0.1',
        port: service.http.address().port,
    });
    assert.deepEqual(result, { fingerprint: service.identity.fingerprint, authorized: false });
    await assert.rejects(pins.inspectServer({ host: '127.0.0.1', port: 1 }, 2000));
});
