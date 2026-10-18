import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';

test('threads isolate history, share chat features, enforce permissions, and persist', async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-threads-'));
    let service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
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
        member = await signup('Member'),
        outsider = await signup('Outsider');
    const root = await api(owner, '/messages', 'POST', { room: 'general', body: 'Parent' });
    const other = await api(owner, '/messages', 'POST', { room: 'general', body: 'Other parent' });
    const send = (account, thread, body = 'Reply', room = 'general', extra = {}) =>
        api(account, '/messages', 'POST', { room, thread, body, ...extra });
    const first = await send(member, root.id, 'Reply :smile:', 'general', {
        attachments: [{ name: 'reply.txt', data: Buffer.from('thread file').toString('base64') }],
    });
    const second = await send(owner, root.id, 'Second');
    await send(owner, other.id, 'Other thread');
    for (const [index, message] of [root, other, first, second].entries())
        service.db.prepare('UPDATE messages SET created=? WHERE id=?').run(index + 1, message.id);
    assert.equal(first.thread, root.id);
    assert.equal((await api(member, `/messages/${root.id}`)).replyCount, 2);
    assert.deepEqual(
        (await api(member, '/messages?room=general')).map((m) => m.id),
        [root.id, other.id],
    );
    const history = `/messages?room=general&thread=${root.id}`;
    assert.deepEqual(
        (await api(member, history)).map((m) => m.id),
        [first.id, second.id],
    );
    const page = await api(member, history + '&page=1&limit=1');
    assert.equal(page.messages[0].id, second.id);
    assert.ok(page.next);
    assert.equal(
        (await api(member, history + '&page=1&limit=1&before=' + page.next)).messages[0].id,
        first.id,
    );
    await api(
        owner,
        '/messages',
        'POST',
        { room: 'general', thread: first.id, body: 'Nested' },
        400,
    );
    await api(
        owner,
        '/messages',
        'POST',
        { room: 'introductions', thread: root.id, body: 'Wrong room' },
        404,
    );
    await api(owner, '/messages', 'POST', { room: 'general', thread: {}, body: 'Malformed' }, 400);
    await api(owner, '/messages?room=general&thread=missing', 'GET', undefined, 404);
    await api(member, `/messages/${first.id}`, 'PATCH', { body: 'Edited reply' });
    await api(owner, `/messages/${first.id}`, 'PATCH', { body: 'Not mine' }, 403);
    await api(member, `/messages/${first.id}/reaction`, 'POST', { emoji: '👍' });
    await api(owner, `/messages/${first.id}`, 'PATCH', { pinned: true });
    const pinned = await api(member, history + '&pinned=1&search=Edited');
    assert.equal(pinned.length, 1);
    assert.equal(pinned[0].body, 'Edited reply');
    assert.equal(pinned[0].reactions[0].emoji, '👍');
    assert.equal(pinned[0].attachments[0].id, first.attachments[0].id);
    assert.equal((await api(member, '/messages?room=general&search=Edited')).length, 0);

    const room = `dm:${[owner.user.id, member.user.id].sort().join(':')}`;
    const dmRoot = await api(owner, '/messages', 'POST', { room, body: 'Private parent' });
    const dmReply = await send(member, dmRoot.id, '', room, {
        attachments: [{ name: 'private.txt', data: 'aGk=' }],
    });
    await api(
        outsider,
        `/messages?room=${encodeURIComponent(room)}&thread=${dmRoot.id}`,
        'GET',
        undefined,
        403,
    );
    await api(outsider, `/messages/${dmRoot.id}`, 'GET', undefined, 404);
    await api(outsider, `/messages/${dmReply.id}/reaction`, 'POST', { emoji: '👍' }, 404);
    await api(outsider, `/attachments/${dmReply.attachments[0].id}`, 'GET', undefined, 404);
    await api(
        outsider,
        '/messages',
        'POST',
        { room: 'general', thread: dmRoot.id, body: 'Leak' },
        404,
    );
    await api(owner, '/channels/general/access', 'PUT', {
        permissions: [{ role: 'member', mode: 'read-only' }],
    });
    await api(
        member,
        '/messages',
        'POST',
        { room: 'general', thread: root.id, body: 'Read only' },
        403,
    );
    await api(member, `/messages/${first.id}`, 'PATCH', { body: 'Read only' }, 403);
    await api(member, `/messages/${first.id}/reaction`, 'POST', { emoji: '👍' }, 403);
    assert.equal((await api(member, history)).length, 2);
    await api(owner, '/channels/general/access', 'PUT', {
        permissions: [{ role: 'member', mode: 'hidden' }],
    });
    await api(member, history, 'GET', undefined, 403);
    await api(member, `/messages/${first.id}`, 'GET', undefined, 404);
    await api(owner, '/channels/general/access', 'PUT', { permissions: [] });

    // Database invariants also reject attempts outside the API.
    assert.throws(
        () =>
            service.db
                .prepare(
                    'INSERT INTO messages(id,room,author,body,created,thread) VALUES(?,?,?,?,?,?)',
                )
                .run('nested', 'general', owner.user.id, '', 1, first.id),
        /Invalid thread parent/,
    );
    await service.close();
    service = createApp({ dataDir: directory });
    assert.equal((await api(member, history)).length, 2);
    assert.equal((await api(member, `/messages/${root.id}`)).replyCount, 2);
    await api(member, `/messages/${first.id}`, 'DELETE');
    assert.equal((await api(member, `/messages/${root.id}`)).replyCount, 1);
    await send(member, root.id, 'Replacement', 'general', {
        attachments: [{ name: 'cleanup.txt', data: 'aGk=' }],
    });
    await api(owner, `/messages/${root.id}`, 'DELETE');
    await api(owner, history, 'GET', undefined, 404);
    assert.equal(
        service.db.prepare('SELECT count(*) n FROM messages WHERE thread=?').get(root.id).n,
        0,
    );
    assert.equal(
        service.db.prepare('SELECT count(*) n FROM attachments WHERE message=?').get(first.id).n,
        0,
    );
    assert.equal(
        service.db.prepare('SELECT count(*) n FROM reactions WHERE message=?').get(first.id).n,
        0,
    );
    assert.equal(service.db.prepare('SELECT bytes FROM storage_usage WHERE id=1').get().bytes, 2);
    await api(owner, `/messages/${dmRoot.id}`, 'DELETE');
    assert.equal(service.db.prepare('SELECT bytes FROM storage_usage WHERE id=1').get().bytes, 0);
});
