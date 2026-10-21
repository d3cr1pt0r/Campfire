import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClientState } = require('../electron/client-state.cjs');
const { createRendererServer, listenRendererServer } = require('../electron/renderer-server.cjs');
const build = require('../electron-builder.cjs');
const plain = { isEncryptionAvailable: () => false };

test('desktop client state survives renderer-port changes and supports sign-out', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-client-'));
    try {
        const first = createClientState(directory, plain);
        assert.equal(first.get('connection'), null);
        assert.equal(
            first.set(
                'connection',
                JSON.stringify({ url: 'https://chat.example.com', token: 'test-session' }),
            ),
            true,
        );
        assert.equal(first.set('preferences', JSON.stringify({ quality: '720' })), true);
        const second = createClientState(directory, plain);
        assert.equal(JSON.parse(second.get('connection')).token, 'test-session');
        second.set('connection', null);
        const third = createClientState(directory, plain);
        assert.equal(third.get('connection'), null);
        assert.equal(JSON.parse(third.get('preferences')).quality, '720');
        assert.equal(third.set('../arbitrary-file', '{}'), false);
        assert.equal(third.set('http-origins', JSON.stringify(['http://example.com'])), false);
        assert.equal(third.set('preferences', 'not-json'), false);
        assert.equal(third.set('preferences', 'x'.repeat(16385)), false);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('client state uses supplied OS encryption and recovers from unreadable files', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-client-'));
    // Stub the OS service; this tests storage integration, not Windows DPAPI itself.
    const encryption = {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s).reverse(),
        decryptString: (b) => Buffer.from(b).reverse().toString(),
    };
    try {
        const state = createClientState(directory, encryption);
        state.set('connection', JSON.stringify({ token: 'private-token' }));
        const saved = readFileSync(path.join(directory, 'client-state.dat'));
        assert.equal(saved[0], 69);
        assert.equal(saved.includes('private-token'), false);
        assert.equal(
            JSON.parse(createClientState(directory, encryption).get('connection')).token,
            'private-token',
        );
        writeFileSync(path.join(directory, 'client-state.dat'), 'corrupt');
        assert.equal(createClientState(directory, encryption).get('connection'), null);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('desktop saves DM navigation separately for each server and account', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-dm-state-'));
    try {
        const first = createClientState(directory, plain);
        const key = 'direct-messages:https://chat.example.com:alice';
        const saved = JSON.stringify({
            opened: { 'dm:alice:bob': 123 },
            pinned: ['dm:alice:bob'],
            collapsed: true,
        });
        assert.equal(first.set(key, saved), true);
        const reopened = createClientState(directory, plain);
        assert.equal(reopened.get(key), saved);
        assert.equal(reopened.get('direct-messages:https://chat.example.com:bob'), null);
        assert.equal(reopened.get('direct-messages:https://other.example.com:alice'), null);
        assert.equal(reopened.set('direct-messages:', '{}'), false);
        assert.equal(reopened.set('unrecognized-key', '{}'), false);
        assert.equal(reopened.set(key, 'invalid-json'), false);
        assert.equal(reopened.set(key, 'x'.repeat(16385)), false);
        assert.equal(reopened.set(key, null), true);
        assert.equal(createClientState(directory, plain).get(key), null);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('desktop asset host serves UI with CSP and has no community API', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-assets-'));
    writeFileSync(path.join(directory, 'index.html'), '<h1>Campfire</h1>');
    const server = createRendererServer(directory);
    server.address = () => ({ port: 40509 });
    const request = (url, host = '127.0.0.1:40509', method = 'GET') =>
        new Promise((resolve) => {
            const headers = {};
            const response = {
                status: 200,
                body: undefined,
                setHeader(k, v) {
                    headers[k] = v;
                },
                writeHead(status, more = {}) {
                    this.status = status;
                    Object.assign(headers, more);
                    return this;
                },
                end(body) {
                    this.body = body;
                    resolve({ ...this, headers });
                },
            };
            server.emit('request', { url, method, headers: { host } }, response);
        });
    try {
        const page = await request('/');
        assert.equal(page.status, 200);
        assert.match(page.body.toString(), /Campfire/);
        assert.match(page.headers['Content-Security-Policy'], /script-src 'self'/);
        // Desktop HTTP is gated by the main-process per-origin policy, rather than CSP.
        const connect = page.headers['Content-Security-Policy']
            .match(/connect-src ([^;]+)/)[1]
            .split(' ');
        assert.ok(connect.includes('https:') && connect.includes('wss:'));
        assert.ok(connect.includes('http:') && connect.includes('ws:'));
        assert.equal((await request('/api/state')).status, 404);
        assert.equal((await request('/', 'attacker.example')).status, 403);
        assert.equal((await request('/', '127.0.0.1:40509', 'POST')).status, 405);
        assert.equal((await request('/..%2F..%2Fsecret.html')).status, 404);
        assert.equal((await request('/bad%encoding')).status, 404);
        assert.equal((await request('/', '127.0.0.1:40509', 'HEAD')).body, undefined);
    } finally {
        server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
test('Windows portable build is x64 and includes UI and desktop runtime', () => {
    assert.equal(build.appId, 'org.campfire.desktop');
    assert.equal(build.win.target[0].target, 'portable');
    assert.deepEqual(build.win.target[0].arch, ['x64']);
    assert.equal(build.nsis, undefined);
    assert.match(build.win.artifactName, /-Portable\.\$\{ext\}$/);
    assert.ok(build.files.includes('dist/**/*'));
    assert.ok(build.files.includes('electron/**/*'));
    assert.equal(
        build.files.some((f) => f.startsWith('data/')),
        false,
    );
});

test('desktop persists selected audio IDs, labels and renderer origin across launches', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-devices-'));
    try {
        const state = createClientState(directory, plain);
        const preferences = {
            input: 'mic',
            inputLabel: 'USB Mic',
            output: 'headset',
            outputLabel: 'Headset',
        };
        state.set('preferences', JSON.stringify(preferences));
        state.set('rendererPort', '40509');
        const next = createClientState(directory, plain);
        assert.deepEqual(JSON.parse(next.get('preferences')), preferences);
        assert.equal(Number(next.get('rendererPort')), 40509);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('renderer origin reuses its saved port and falls back only for an occupied port', async () => {
    function server(fail) {
        const s = new EventEmitter();
        s.attempts = [];
        s.address = () => ({ port: s.bound });
        s.listen = (port) => {
            s.attempts.push(port);
            queueMicrotask(() => {
                if (port === fail)
                    s.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' }));
                else {
                    s.bound = port || 45678;
                    s.emit('listening');
                }
            });
            return s;
        };
        return s;
    }
    const stable = server();
    assert.equal(await listenRendererServer(stable, 40509), 40509);
    assert.deepEqual(stable.attempts, [40509]);
    const occupied = server(40509);
    assert.equal(await listenRendererServer(occupied, 40509), 45678);
    assert.deepEqual(occupied.attempts, [40509, 0]);
    const invalid = server();
    await listenRendererServer(invalid, -1);
    assert.deepEqual(invalid.attempts, [0]);
});

test('clipboard file formats decode multiple Windows paths and local Linux file URLs', () => {
    const { pathsFromFormat } = require('../electron/clipboard-files.cjs');
    assert.deepEqual(
        pathsFromFormat('FileNameW', Buffer.from('C:\\one.txt\0C:\\two.png\0\0', 'utf16le')),
        ['C:\\one.txt', 'C:\\two.png'],
    );
    const header = Buffer.alloc(20);
    header.writeUInt32LE(20, 0);
    header.writeUInt32LE(1, 16);
    assert.deepEqual(
        pathsFromFormat(
            'CF_HDROP',
            Buffer.concat([header, Buffer.from('C:\\one.txt\0C:\\two.png\0\0', 'utf16le')]),
        ),
        ['C:\\one.txt', 'C:\\two.png'],
    );
    const filename = path.join(tmpdir(), 'my file.txt');
    const { pathToFileURL } = require('node:url');
    assert.deepEqual(
        pathsFromFormat(
            'text/uri-list',
            Buffer.from(`# comment\n${pathToFileURL(filename)}\r\nhttps://example.com\n`),
        ),
        [filename],
    );
});

test('clipboard attachment reads are bounded, copy-only, and ignore ordinary path text', async () => {
    const { clipboardAttachments } = require('../electron/clipboard-files.cjs');
    const { pathToFileURL } = await import('node:url');
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-clipboard-'));
    const filename = path.join(directory, 'hello.txt');
    writeFileSync(filename, 'clipboard file');
    const raw = 'electron application/osclipboard;format="x-special/gnome-copied-files"';
    const clipboard = (text) => ({
        read: async () => [{ types: [raw], getType: async () => new Blob([text]) }],
        readText: async () => '',
    });
    try {
        const result = await clipboardAttachments(clipboard(`cut\n${pathToFileURL(filename)}\n`));
        assert.equal(result.files[0].name, 'hello.txt');
        assert.equal(Buffer.from(result.files[0].data).toString(), 'clipboard file');
        assert.equal(readFileSync(filename, 'utf8'), 'clipboard file');
        await assert.rejects(
            clipboardAttachments(clipboard(`copy\n${pathToFileURL(directory)}\n`)),
            /Folders/,
        );
        writeFileSync(filename, Buffer.alloc(5 * 1024 * 1024 + 1));
        await assert.rejects(
            clipboardAttachments(clipboard(`copy\n${pathToFileURL(filename)}\n`)),
            /5 MB/,
        );
        // The renderer passes the server's limit; values beyond the ceiling fall back to 5 MB.
        const copied = clipboard(`copy\n${pathToFileURL(filename)}\n`);
        const raised = await clipboardAttachments(copied, 6 * 1024 * 1024);
        assert.equal(raised.files[0].data.length, 5 * 1024 * 1024 + 1);
        await assert.rejects(clipboardAttachments(copied, 1024 * 1024), /1 MB/);
        await assert.rejects(clipboardAttachments(copied, 1024 * 1024 * 1024), /5 MB/);
        const plain = await clipboardAttachments({
            read: async () => [],
            readText: async () => filename,
        });
        assert.equal(plain.files.length, 0);
        assert.equal(plain.text, filename);
        const image = await clipboardAttachments({
            read: async () => [{ types: ['image/png'], getType: async () => new Blob(['png']) }],
        });
        assert.equal(image.files[0].type, 'image/png');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
