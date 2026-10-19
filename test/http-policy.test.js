import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createHttpPolicy, installHttpPolicy } = require('../electron/http-policy.cjs');

const origin = 'http://192.168.1.5:3001';
const state = () => {
    let saved = null;
    return {
        getInternal: () => saved,
        setInternal: (_key, value) => {
            saved = value;
            return true;
        },
    };
};

test('HTTP approval persists for an exact origin, covers WebSockets, and can be revoked', () => {
    const storage = state();
    let policy = createHttpPolicy(storage);
    assert.equal(policy.allowsRequest(`${origin}/api/info`), false);
    assert.equal(policy.allowsRequest(origin.replace('http:', 'ws:')), false);
    assert.equal(policy.allowsRequest('https://example.com/api/info'), true);
    assert.equal(policy.allowsRequest('wss://example.com/socket.io/'), true);
    assert.equal(policy.allowsRequest('http://127.0.0.1:3001'), true);
    assert.equal(policy.setAllowed(origin, true), true);
    policy = createHttpPolicy(storage);
    assert.equal(policy.isAllowed(origin), true);
    assert.equal(policy.allowsRequest(`${origin}/api/info`), true);
    assert.equal(policy.allowsRequest(`${origin.replace('http:', 'ws:')}/socket.io/`), true);
    assert.equal(policy.allowsRequest('http://192.168.1.5:3002/api/info'), false);
    assert.equal(policy.allowsRequest('http://192.168.1.6:3001/api/info'), false);
    assert.equal(policy.setAllowed(origin, false), true);
    assert.equal(createHttpPolicy(storage).allowsRequest(`${origin}/api/info`), false);
    for (const invalid of [
        null,
        'bad',
        'https://example.com',
        `${origin}/path`,
        `${origin}/#pin=abc`,
        'http://user:pass@example.com',
    ])
        assert.equal(policy.setAllowed(invalid, true), false);
});

test('HTTP IPC requires the trusted renderer and a confirmed opt-in before opening network access', async () => {
    const ipcMain = new EventEmitter();
    const handlers = new Map();
    ipcMain.handle = (name, fn) => handlers.set(name, fn);
    let requestHandler;
    const session = {
        webRequest: {
            onBeforeRequest: (fn) => {
                requestHandler = fn;
            },
        },
    };
    let answer = false,
        confirmations = 0;
    const policy = installHttpPolicy({
        session,
        ipcMain,
        clientState: state(),
        trusted: (url) => url === 'app',
        confirm: async () => {
            confirmations++;
            return answer;
        },
    });
    const renderer = { senderFrame: { url: 'app' } };
    const stranger = { senderFrame: { url: origin } };
    const setAllowed = handlers.get('http:set-allowed');
    await assert.rejects(() => setAllowed(stranger, origin, true), /Untrusted/);
    assert.equal(await setAllowed(renderer, origin, true), false);
    requestHandler({ url: `${origin}/api/info` }, (result) => assert.equal(result.cancel, true));
    answer = true;
    assert.equal(await setAllowed(renderer, origin, true), true);
    assert.equal(await setAllowed(renderer, origin, true), true);
    assert.equal(confirmations, 2);
    requestHandler({ url: `${origin}/api/info` }, (result) => assert.equal(result.cancel, false));
    ipcMain.emit('http:is-allowed', stranger, origin);
    assert.equal(stranger.returnValue, false);
    ipcMain.emit('http:is-allowed', renderer, origin);
    assert.equal(renderer.returnValue, true);
    assert.equal(await setAllowed(renderer, origin, false), true);
    assert.equal(policy.isAllowed(origin), false);
});
