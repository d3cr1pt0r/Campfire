import { request } from '../test-support/http.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../test-support/open-server.js';

// Run the real Express middleware/routes without a listening socket. Socket.IO
// transport/NAT are covered separately by the existing live integration suite.
test('profiles, previews, custom reactions, channel names, and private-call authorization', async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-features-'));
    const service = createApp({ dataDir: directory });
    const attached = [];
    t.after(async () => {
        for (const s of attached) {
            service.io.sockets.sockets.delete(s.id);
            service.io.sockets.adapter.delAll(s.id);
        }
        await service.close();
        rmSync(directory, { recursive: true, force: true });
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
        bob = await signup('Bob'),
        eve = await signup('Eve');
    const api = async (u, endpoint, method = 'GET', body, status = 200) => {
        const result = await request(service.app, endpoint, u?.token, method, body);
        assert.equal(result.status, status, JSON.stringify(result.data));
        return result;
    };
    const pixel =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
    await t.test(
        'nicknames default to usernames, update only the caller, and do not rename accounts',
        async () => {
            assert.equal(alice.user.nickname, 'Alice');
            assert.equal((await api(bob, '/state')).data.me.nickname, 'Bob');
            const changed = await api(alice, '/profile', 'PATCH', { nickname: ' Alice Display ' });
            assert.equal(changed.data.user.nickname, 'Alice Display');
            assert.equal(changed.data.user.username, 'Alice');
            assert.equal(
                (await api(bob, '/state')).data.users.find((u) => u.id === alice.user.id).nickname,
                'Alice Display',
            );
            assert.equal((await api(bob, '/state')).data.me.nickname, 'Bob');
            await api(alice, '/profile', 'PATCH', { nickname: '', username: 'Renamed' }, 400);
            for (const nickname of ['', '  ', 'x'.repeat(33), 'bad\nname'])
                await api(alice, '/profile', 'PATCH', { nickname }, 400);
            await api(null, '/profile', 'PATCH', { nickname: 'Anonymous' }, 401);
            assert.throws(
                () =>
                    service.db
                        .prepare('UPDATE users SET username=? WHERE id=?')
                        .run('Renamed', alice.user.id),
                /cannot be changed/,
            );
            const login = await request(service.app, '/auth/login', null, 'POST', {
                username: 'Alice',
                password: 'test-password-123',
                setupCode: 'test-owner-setup',
            });
            assert.equal(login.status, 200);
            assert.equal(login.data.user.nickname, 'Alice Display');
            assert.equal(
                (
                    await request(service.app, '/auth/login', null, 'POST', {
                        username: 'Alice Display',
                        password: 'test-password-123',
                        setupCode: 'test-owner-setup',
                    })
                ).status,
                401,
            );
        },
    );
    await t.test('profile frames are validated, visible to others, and removable', async () => {
        assert.equal(alice.user.frame, null);
        const framed = await api(alice, '/profile', 'PATCH', { frame: 'ember' });
        assert.equal(framed.data.user.frame, 'ember');
        assert.equal(framed.data.user.nickname, 'Alice Display');
        assert.equal(
            (await api(bob, '/state')).data.users.find((u) => u.id === alice.user.id).frame,
            'ember',
        );
        for (const frame of ['sparkles', '', 1, { id: 'ember' }])
            await api(alice, '/profile', 'PATCH', { frame }, 400);
        await api(alice, '/profile', 'PATCH', {}, 400);
        await api(null, '/profile', 'PATCH', { frame: 'aurora' }, 401);
        assert.throws(
            () =>
                service.db
                    .prepare('UPDATE profiles SET frame=? WHERE user=?')
                    .run('sparkles', alice.user.id),
            /CHECK constraint/,
        );
        const removed = await api(alice, '/profile', 'PATCH', { frame: null });
        assert.equal(removed.data.user.frame, null);
        assert.equal((await api(bob, '/state')).data.me.frame, null);
    });
    await t.test(
        'avatars are authenticated, bounded, replaceable and visible in state',
        async () => {
            await api(null, '/profile/avatar', 'POST', { data: pixel }, 401);
            const uploaded = (await api(alice, '/profile/avatar', 'POST', { data: pixel })).data;
            assert.equal(
                (await api(bob, '/state')).data.users.find((u) => u.id === alice.user.id).avatar,
                uploaded.id,
            );
            assert.equal(
                (await api(bob, `/avatars/${uploaded.id}`)).headers['content-type'],
                'image/png',
            );
            assert.equal((await api(bob, '/state')).data.me.avatar, null);
            const oversized = Buffer.from(pixel, 'base64');
            oversized.writeUInt32BE(513, 16);
            await api(
                alice,
                '/profile/avatar',
                'POST',
                { data: oversized.toString('base64') },
                400,
            );
            await api(
                alice,
                '/profile/avatar',
                'POST',
                { data: Buffer.from('<svg/>').toString('base64') },
                400,
            );
            const replacement = (await api(alice, '/profile/avatar', 'POST', { data: pixel })).data;
            assert.notEqual(replacement.id, uploaded.id);
            await api(alice, `/avatars/${uploaded.id}`, 'GET', undefined, 404);
            await api(alice, '/profile/avatar', 'DELETE');
            assert.equal((await api(alice, '/state')).data.me.avatar, null);
        },
    );
    await t.test(
        'inline image and GIF previews retain DM access controls and download behavior',
        async () => {
            const room = `dm:${[alice.user.id, bob.user.id].sort().join(':')}`;
            for (const [name, data, mime] of [
                ['photo.png', pixel, 'image/png'],
                ['fun.gif', Buffer.from('GIF89a\x01\x00\x01\x00').toString('base64'), 'image/gif'],
            ]) {
                const msg = (
                    await api(alice, '/messages', 'POST', { room, attachment: { name, data } })
                ).data;
                const id = msg.attachments[0].id;
                assert.equal(msg.attachments[0].mime, mime);
                const preview = await api(bob, `/attachments/${id}?inline=1`);
                assert.equal(preview.headers['content-type'], mime);
                assert.equal(preview.headers['content-disposition'], 'inline');
                assert.match(
                    (await api(bob, `/attachments/${id}`)).headers['content-disposition'],
                    /^attachment/,
                );
                await api(eve, `/attachments/${id}?inline=1`, 'GET', undefined, 404);
            }
            const svg = (
                await api(alice, '/messages', 'POST', {
                    room,
                    attachment: {
                        name: 'attack.svg',
                        data: Buffer.from('<svg onload="evil()"/>').toString('base64'),
                    },
                })
            ).data;
            assert.equal(
                (await api(bob, `/attachments/${svg.attachments[0].id}?inline=1`)).headers[
                    'content-type'
                ],
                'application/octet-stream',
            );
        },
    );
    await t.test(
        'multi-file messages validate count and total size before inserting anything',
        async () => {
            const files = [
                { name: 'one.png', data: pixel },
                { name: 'two.txt', data: Buffer.from('Hello').toString('base64') },
            ];
            const message = (
                await api(alice, '/messages', 'POST', { room: 'general', attachments: files })
            ).data;
            assert.equal(message.attachments.length, 2);
            assert.equal(message.attachments[0].mime, 'image/png');
            const before = service.db.prepare('SELECT COUNT(*) n FROM messages').get().n;
            await api(
                alice,
                '/messages',
                'POST',
                { room: 'general', attachments: Array.from({ length: 11 }, () => files[0]) },
                400,
            );
            await api(alice, '/messages', 'POST', { room: 'general', attachments: [] }, 400);
            await api(
                alice,
                '/messages',
                'POST',
                { room: 'general', attachments: [files[0], { name: 'invalid', data: 1 }] },
                400,
            );
            const tooLarge = Buffer.alloc(Math.ceil(2.6 * 1024 * 1024)).toString('base64');
            await api(
                alice,
                '/messages',
                'POST',
                {
                    room: 'general',
                    attachments: [
                        { name: 'one', data: tooLarge },
                        { name: 'two', data: tooLarge },
                    ],
                },
                400,
            );
            assert.equal(service.db.prepare('SELECT COUNT(*) n FROM messages').get().n, before);
            await api(alice, `/messages/${message.id}`, 'DELETE');
            assert.equal(
                service.db
                    .prepare('SELECT COUNT(*) n FROM attachments WHERE message=?')
                    .get(message.id).n,
                0,
            );
        },
    );
    await t.test(
        'custom emojis and expanded reactions toggle, count users, and enforce ownership',
        async () => {
            const emoji = (await api(bob, '/emojis', 'POST', { name: 'party_cat', data: pixel }))
                .data;
            await api(alice, '/emojis', 'POST', { name: 'party_cat', data: pixel }, 409);
            const msg = (
                await api(alice, '/messages', 'POST', {
                    room: 'general',
                    body: 'Hello :party_cat:',
                })
            ).data;
            for (const who of [alice, bob])
                await api(who, `/messages/${msg.id}/reaction`, 'POST', { emoji: ':party_cat:' });
            await api(bob, `/messages/${msg.id}/reaction`, 'POST', { emoji: '🚀' });
            assert.equal(
                (await api(bob, '/messages?room=general')).data.find((m) => m.id === msg.id)
                    .reactions.length,
                3,
            );
            await api(alice, `/messages/${msg.id}/reaction`, 'POST', { emoji: ':party_cat:' });
            await api(eve, `/emojis/${emoji.id}`, 'DELETE', undefined, 403);
            await api(alice, `/messages/${msg.id}/reaction`, 'POST', { emoji: '<script>' }, 400);
            await api(bob, `/emojis/${emoji.id}`, 'DELETE');
            assert.equal(
                (await api(bob, '/messages?room=general')).data
                    .find((m) => m.id === msg.id)
                    .reactions.filter((r) => r.emoji.startsWith(':')).length,
                0,
            );
        },
    );
    await t.test('voice names preserve capitals and spaces; text names normalize', async () => {
        const voice = (
            await api(alice, '/channels', 'POST', { name: ' Test Room ', kind: 'voice' })
        ).data;
        const text = (await api(alice, '/channels', 'POST', { name: 'Test Room', kind: 'text' }))
            .data;
        const state = (await api(alice, '/state')).data;
        assert.equal(state.channels.find((c) => c.id === voice.id).name, 'Test Room');
        assert.equal(state.channels.find((c) => c.id === text.id).name, 'test-room');
        await api(alice, '/channels', 'POST', { name: 'x'.repeat(33), kind: 'voice' }, 400);
        await api(bob, '/channels', 'POST', { name: 'Test', kind: 'voice' }, 403);
    });
    function attach(account, id) {
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
    }
    await t.test(
        'members can call without relationships; invitations protect private calls and group invites',
        async () => {
            const as = attach(alice, 'alice-socket'),
                bs = attach(bob, 'bob-socket'),
                es = attach(eve, 'eve-socket');
            const join = (s, id) => new Promise((resolve) => s.emit('call:join', id, resolve));
            await api(alice, '/calls', 'POST', { user: alice.user.id }, 403);
            await api(alice, '/calls', 'POST', { user: 'unknown-member' }, 403);
            const room = (await api(alice, '/calls', 'POST', { user: bob.user.id })).data.id;
            assert.equal((await api(eve, '/state')).data.directCalls.length, 0);
            assert.ok((await join(es, room)).error);
            assert.equal((await join(as, room)).peers.length, 0);
            assert.equal((await api(bob, '/state')).data.directCalls[0].invited[0], bob.user.id);
            assert.equal((await join(bs, room)).peers.length, 1);
            let activity, outsiderActivity;
            bs.on('call:speaking', (event) => {
                if (typeof event === 'object') activity = event;
            });
            es.on('call:speaking', (event) => {
                if (typeof event === 'object') outsiderActivity = event;
            });
            as.emit('call:speaking', true);
            assert.deepEqual(activity, { user: alice.user.id, active: true });
            assert.equal(outsiderActivity, undefined);
            assert.equal((await api(eve, '/state')).data.calls.length, 0);
            let receivedWatch, leakedWatch;
            bs.on('signal', (value) => {
                receivedWatch = value;
            });
            es.on('signal', (value) => {
                leakedWatch = value;
            });
            const watch = {
                version: 2,
                watch: { shareId: 'current-share', enabled: false, revision: 2 },
            };
            as.emit('signal', { to: bs.id, data: watch });
            assert.deepEqual(receivedWatch.data, watch);
            as.emit('signal', { to: es.id, data: watch });
            assert.equal(leakedWatch, undefined);
            await api(eve, `/calls/${room}/invite`, 'POST', { user: alice.user.id }, 403);
            await api(alice, `/calls/${room}/invite`, 'POST', { user: eve.user.id });
            await api(eve, `/calls/${room}/decline`, 'POST');
            assert.ok((await join(es, room)).error);
            await api(alice, `/calls/${room}/invite`, 'POST', { user: eve.user.id });
            assert.equal((await join(es, room)).peers.length, 2);
            as.emit('call:leave');
            bs.emit('call:leave');
            es.emit('call:leave');
            assert.equal((await api(alice, '/state')).data.directCalls.length, 0);
            assert.ok((await join(bs, room)).error);
        },
    );
});
