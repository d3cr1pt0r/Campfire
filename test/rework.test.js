import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { messageViews } from '../server/database.js';
import { createSessions } from '../server/sessions.js';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRateLimit, originPolicy } from '../server/policies.js';
import { createApp } from '../test-support/open-server.js';
import { messageForm, request } from '../test-support/http.js';

test('overlapping and repeated shutdown calls close SQLite only once', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'campfire-shutdown-'));
    const service = createApp({ dataDir: dir });
    t.after(async () => {
        await service.close();
        rmSync(dir, { recursive: true, force: true });
    });
    const closeDatabase = service.db.close.bind(service.db);
    let databaseCloses = 0;
    service.db.close = () => {
        databaseCloses++;
        closeDatabase();
    };
    const first = service.close();
    const second = service.close();
    assert.equal(first, second);
    await Promise.all([first, second, service.close()]);
    await service.close();
    assert.equal(databaseCloses, 1);
    assert.equal(service.db.isOpen, false);
});

test('history enrichment uses six queries regardless of message count', () => {
    let queries = 0;
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: String(i) }));
    const result = messageViews(() => {
        queries++;
        return [];
    }, rows);
    assert.equal(queries, 6);
    assert.equal(result.length, 500);
    assert.deepEqual(result[0], {
        id: '0',
        replyCount: 0,
        attachments: [],
        reactions: [],
        retention: { since: undefined, kept: false, pollEnds: null },
    });
});

test('authentication limiter expires entries and fails closed at capacity', () => {
    let time = 0;
    const limit = createRateLimit({ maximum: 2, capacity: 1, windowMs: 100, now: () => time });
    limit('a');
    limit('a');
    assert.throws(
        () => limit('a'),
        (error) => error.status === 429,
    );
    assert.throws(
        () => limit('b'),
        (error) => error.status === 429,
    );
    time = 100;
    limit('b');
});

test('one origin policy supports configured, local and same-origin transports', () => {
    const allowed = originPolicy(['https://client.example.com']);
    assert.equal(allowed('https://client.example.com', 'server.example.com'), true);
    assert.equal(allowed('https://server.example.com', 'server.example.com'), true);
    assert.equal(allowed('http://127.0.0.1:5151', 'server.example.com'), true);
    assert.equal(allowed('https://evil.example.com', 'server.example.com'), false);
});

test('forwarded client addresses affect rate limiting only behind a trusted proxy', async (t) => {
    for (const trustProxy of [false, ['loopback']]) {
        const dir = mkdtempSync(path.join(tmpdir(), 'campfire-proxy-'));
        const service = createApp({ dataDir: dir, trustProxy });
        try {
            const attempt = (ip) =>
                request(
                    service.app,
                    '/auth/login',
                    null,
                    'POST',
                    { username: '', password: '', setupCode: 'test-owner-setup' },
                    { 'x-forwarded-for': ip },
                );
            for (let i = 0; i < 20; i++) assert.equal((await attempt('192.0.2.1')).status, 400);
            assert.equal((await attempt('192.0.2.1')).status, 429);
            assert.equal((await attempt('192.0.2.2')).status, trustProxy ? 400 : 429);
        } finally {
            await service.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('idle sockets expire without sending another packet and revocation cancels timers', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const token = 'a'.repeat(64),
        sockets = new Map();
    const sessions = createSessions({
        get: (sql) => (sql.startsWith('SELECT expires') ? { expires: 1100 } : { id: 'alice' }),
        all: () => [],
        run: () => {},
        io: { sockets: { sockets } },
    });
    const socket = new EventEmitter();
    Object.assign(socket, {
        id: 'one',
        data: { token },
        use() {},
        disconnect() {
            this.disconnected = true;
            this.emit('disconnect');
        },
    });
    sockets.set(socket.id, socket);
    sessions.attach(socket);
    t.mock.timers.tick(99);
    assert.equal(socket.disconnected, undefined);
    t.mock.timers.tick(1);
    assert.equal(socket.disconnected, true);
    socket.disconnected = false;
    sessions.revoke(token);
    assert.equal(socket.disconnected, true);
    sessions.close();
});

test('canonical conversations, stable pagination, full search, permissions and storage quotas', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'campfire-rework-'));
    const service = createApp({ dataDir: dir, maxStoredUploadBytes: 5 });
    t.after(async () => {
        await service.close();
        rmSync(dir, { recursive: true, force: true });
    });
    const signup = async (username) =>
        (
            await request(service.app, '/auth/register', null, 'POST', {
                username,
                password: 'test-password-123',
                setupCode: 'test-owner-setup',
            })
        ).data;
    const alice = await signup('Alice'),
        bob = await signup('Bob');
    const api = async (endpoint, method = 'GET', body, token = alice.token, status = 200) => {
        const response = await request(service.app, endpoint, token, method, body);
        assert.equal(response.status, status, JSON.stringify(response.data));
        return response.data;
    };
    const ids = [alice.user.id, bob.user.id].sort();
    const reversed = `dm:${[...ids].reverse().join(':')}`,
        canonical = `dm:${ids.join(':')}`;
    const direct = await api('/messages', 'POST', { room: reversed, body: 'one history' });
    assert.equal(direct.room, canonical);
    assert.equal(
        (await api(`/messages?room=${canonical}`, 'GET', undefined, bob.token)).messages[0].id,
        direct.id,
    );
    const insert = service.db.prepare(
        'INSERT INTO messages(id,room,author,body,created,pinned,since) VALUES(?,?,?,?,?,?,1)',
    );
    for (let i = 0; i < 505; i++)
        insert.run(
            `page${String(i).padStart(4, '0')}`,
            'general',
            bob.user.id,
            i === 0 ? 'Ältest MESSAGE' : `body ${i}`,
            1,
            i === 0 ? 1 : 0,
        );
    let before = '',
        seen = [];
    do {
        const page = await api(
            `/messages?room=general&limit=100${before ? `&before=${before}` : ''}`,
        );
        seen.push(...page.messages.map((m) => m.id));
        before = page.next;
    } while (before);
    assert.equal(seen.length, 505);
    assert.equal(new Set(seen).size, 505);
    assert.equal((await api('/messages?room=general&search=ältest')).messages[0].id, 'page0000');
    assert.equal((await api('/messages?room=general&pinned=1')).messages[0].id, 'page0000');
    await api('/messages?room=general&before=invalid', 'GET', undefined, alice.token, 400);
    const role = await api('/roles', 'POST', {
        name: 'Read only',
        color: '#112233',
        permissions: ['channels.view'],
    });
    await api(`/users/${bob.user.id}/roles`, 'PATCH', { roles: [role.id] });
    await api('/messages/page0000', 'PATCH', { body: 'Author can still edit' }, bob.token);
    const file = () =>
        messageForm({ room: 'general' }, [{ name: 'hello', data: Buffer.from('hello') }]);
    const uploaded = await api('/messages', 'POST', file());
    await api('/messages', 'POST', file(), alice.token, 413);
    await api('/messages', 'POST', { room: 'general', body: 'text still works' });
    await api(`/messages/${uploaded.id}`, 'DELETE');
    await api('/messages', 'POST', file());
    // A quota the owner saves replaces the one the server was started with.
    await api('/settings', 'PATCH', { maxStoredUploadBytes: 1024 ** 3 });
    await api('/messages', 'POST', file());
});

test('concurrent first registrations produce one owner and duplicate registration returns conflict', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'campfire-registration-'));
    const service = createApp({ dataDir: dir });
    t.after(async () => {
        await service.close();
        rmSync(dir, { recursive: true, force: true });
    });
    const signup = (username) =>
        request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        });
    const accounts = await Promise.all([signup('Alice'), signup('Bob')]);
    assert.deepEqual(
        accounts.map((account) => account.status),
        [200, 200],
    );
    assert.equal(accounts.filter((account) => account.data.user.owner).length, 1);
    const duplicate = await Promise.all([signup('SameName'), signup('SameName')]);
    assert.deepEqual(duplicate.map((account) => account.status).sort(), [200, 409]);
});
