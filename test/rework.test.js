import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { migrate, messageViews } from '../server/database.js';
import { createSessions } from '../server/sessions.js';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRateLimit, originPolicy } from '../server/policies.js';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';

test('overlapping and repeated shutdown calls close SQLite only once', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'driskord-shutdown-'));
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

test('legacy migration merges DM histories and accounts for attachment bytes once', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.exec(
            "INSERT INTO roles VALUES('member','Member','#112233','[]'); INSERT INTO users(id,username,password,role) VALUES('a','Alice','hash','member');",
        );
        db.exec(
            "INSERT INTO messages(id,room,author,body,created) VALUES('first','dm:b:a','a','old',1),('second','dm:a:b','a','new',2)",
        );
        db.exec(
            "INSERT INTO attachments VALUES('file','first','hello','text/plain','aGVsbG8='); INSERT INTO reactions VALUES('first','a','👍');",
        );
        db.exec("INSERT INTO attachments VALUES('unpadded','first','hi','text/plain','aGk')");
        migrate(db);
        migrate(db);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM migrations').get().n, 10);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE room='dm:a:b'").get().n, 2);
        assert.equal(db.prepare('SELECT bytes FROM storage_usage').get().bytes, 7);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM reactions').get().n, 1);
        db.prepare("DELETE FROM messages WHERE id='first'").run();
        assert.equal(db.prepare('SELECT bytes FROM storage_usage').get().bytes, 0);
    } finally {
        db.close();
    }
});

test('failed migrations roll back schema changes and can resume after the cause is fixed', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.exec('CREATE TABLE storage_usage(conflict INTEGER)');
        assert.throws(() => migrate(db), /already exists/);
        assert.equal(
            db
                .prepare("SELECT name FROM pragma_table_info('attachments') WHERE name='bytes'")
                .get(),
            undefined,
        );
        assert.equal(db.prepare('SELECT MAX(version) version FROM migrations').get().version, 1);
        db.exec('DROP TABLE storage_usage');
        migrate(db);
        assert.equal(db.prepare('SELECT MAX(version) version FROM migrations').get().version, 10);
    } finally {
        db.close();
    }
});

test('history enrichment uses three queries regardless of message count', () => {
    let queries = 0;
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: String(i) }));
    const result = messageViews(() => {
        queries++;
        return [];
    }, rows);
    assert.equal(queries, 3);
    assert.equal(result.length, 500);
    assert.deepEqual(result[0], { id: '0', replyCount: 0, attachments: [], reactions: [] });
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
        const dir = mkdtempSync(path.join(tmpdir(), 'driskord-proxy-'));
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
    const dir = mkdtempSync(path.join(tmpdir(), 'driskord-rework-'));
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
        (await api(`/messages?room=${canonical}`, 'GET', undefined, bob.token))[0].id,
        direct.id,
    );
    const insert = service.db.prepare(
        'INSERT INTO messages(id,room,author,body,created,pinned) VALUES(?,?,?,?,?,?)',
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
            `/messages?room=general&page=1&limit=100${before ? `&before=${before}` : ''}`,
        );
        seen.push(...page.messages.map((m) => m.id));
        before = page.next;
    } while (before);
    assert.equal(seen.length, 505);
    assert.equal(new Set(seen).size, 505);
    assert.equal((await api('/messages?room=general&search=ältest'))[0].id, 'page0000');
    assert.equal((await api('/messages?room=general&pinned=1'))[0].id, 'page0000');
    await api('/messages?room=general&before=invalid', 'GET', undefined, alice.token, 400);
    const role = await api('/roles', 'POST', {
        name: 'Read only',
        color: '#112233',
        permissions: [],
    });
    await api(`/users/${bob.user.id}/role`, 'PATCH', { role: role.id });
    await api('/messages/page0000', 'PATCH', { body: 'forbidden' }, bob.token, 403);
    const file = { name: 'hello', data: Buffer.from('hello').toString('base64') };
    const uploaded = await api('/messages', 'POST', { room: 'general', attachment: file });
    await api('/messages', 'POST', { room: 'general', attachment: file }, alice.token, 413);
    await api('/messages', 'POST', { room: 'general', body: 'text still works' });
    await api(`/messages/${uploaded.id}`, 'DELETE');
    await api('/messages', 'POST', { room: 'general', attachment: file });
});

test('concurrent first registrations produce one owner and duplicate registration returns conflict', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'driskord-registration-'));
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
    assert.equal(accounts.filter((account) => account.data.user.role === 'owner').length, 1);
    const duplicate = await Promise.all([signup('SameName'), signup('SameName')]);
    assert.deepEqual(duplicate.map((account) => account.status).sort(), [200, 409]);
});
