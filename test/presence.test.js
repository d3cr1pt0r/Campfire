import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { request } from '../test-support/http.js';
import { shouldIdle, idleDelay, userStatus } from '../src/presence.ts';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'driskord-presence-'));
    let service = createApp({ dataDir: directory });
    const attached = [];
    const detach = (socket) => {
        service.io.sockets.sockets.delete(socket.id);
        service.io.sockets.adapter.delAll(socket.id);
        socket.emit('disconnect');
    };
    t.after(async () => {
        attached.forEach(detach);
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const account = (
        await request(service.app, '/auth/register', null, 'POST', {
            username: 'Presence',
            password: 'test-password-123',
        })
    ).data;
    const api = (endpoint, method = 'GET', body) =>
        request(service.app, endpoint, account.token, method, body);
    const attach = (id) => {
        const socket = new EventEmitter();
        Object.assign(socket, {
            id,
            data: { user: account.user, token: account.token },
            join(room) {
                service.io.sockets.adapter.addAll(id, new Set([room]));
            },
            use() {},
            client: { writeToEngine() {} },
            notifyOutgoingListeners() {},
        });
        service.io.sockets.sockets.set(id, socket);
        attached.push(socket);
        EventEmitter.prototype.emit.call(service.io.sockets, 'connection', socket);
        return socket;
    };
    return {
        account,
        api,
        attach,
        detach,
        service,
        async restart() {
            attached.forEach(detach);
            attached.length = 0;
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}

test('manual presence is authenticated, validated, account scoped, and survives restart without appearing online', async (t) => {
    const f = await fixture(t);
    assert.equal(
        (await request(f.service.app, '/presence', null, 'PATCH', { status: 'dnd' })).status,
        401,
    );
    for (const status of ['offline', 'busy', null, {}, ['online']])
        assert.equal((await f.api('/presence', 'PATCH', { status })).status, 400);
    assert.equal((await f.api('/presence', 'PATCH', { status: 'dnd' })).status, 200);
    await f.restart();
    const state = (await f.api('/state')).data;
    assert.equal(state.me.status, 'dnd');
    assert.deepEqual(state.presence, {});
    assert.deepEqual(state.online, []);
});

test('connected devices aggregate idle; manual Idle and DND override activity; final disconnect removes presence', async (t) => {
    const f = await fixture(t);
    const first = f.attach('first'),
        second = f.attach('second');
    const status = async () => (await f.api('/state')).data.presence[f.account.user.id];
    assert.equal(await status(), 'online');
    first.emit('presence:idle', true);
    assert.equal(await status(), 'online');
    second.emit('presence:idle', true);
    assert.equal(await status(), 'idle');
    second.emit('presence:idle', { user: 'another', idle: false });
    assert.equal(await status(), 'idle');
    second.emit('presence:idle', false);
    assert.equal(await status(), 'online');
    for (const manual of ['idle', 'dnd']) {
        await f.api('/presence', 'PATCH', { status: manual });
        second.emit('presence:idle', false);
        assert.equal(await status(), manual);
    }
    await f.api('/presence', 'PATCH', { status: 'online' });
    f.detach(second);
    assert.equal(await status(), 'idle');
    f.detach(first);
    assert.equal(await status(), undefined);
});

test('idle delay handles disabled detection, threshold, return activity, lock state, and invalid preferences', () => {
    assert.equal(shouldIdle(false, 5, 900, true), false);
    assert.equal(shouldIdle(true, 5, 299), false);
    assert.equal(shouldIdle(true, 5, 300), true);
    assert.equal(shouldIdle(true, 5, 0), false);
    assert.equal(shouldIdle(true, 5, 0, true), true);
    for (const value of [undefined, -5, 0, 500, NaN]) assert.equal(idleDelay(value), 5);
    assert.equal(idleDelay(15), 15);
    const state = { online: ['a'], presence: { a: 'dnd', b: 'idle' } };
    assert.equal(userStatus(state, 'a'), 'dnd');
    assert.equal(userStatus(state, 'b'), 'offline');
});
