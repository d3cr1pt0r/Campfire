import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFixture } from '../test-support/role-fixture.js';
import { canonicalRoom } from '../shared/rooms.js';

test('new reactions notify only the message author, on every authorized session', async (t) => {
    const f = await roleFixture(t);
    const sockets = [];
    t.after(() => sockets.forEach((id) => f.service.io.sockets.sockets.delete(id)));
    const attach = (id, account) => {
        const events = [];
        sockets.push(id);
        f.service.io.sockets.sockets.set(id, {
            data: { user: account.user, token: account.token },
            emit: (event, data) => events.push({ event, data }),
        });
        return events;
    };
    const desktop = attach('reaction-desktop', f.owner);
    const mobile = attach('reaction-mobile', f.owner);
    const reactor = attach('reaction-reactor', f.member);
    const bystander = attach('reaction-bystander', f.other);
    const notices = (events) => events.filter((event) => event.event === 'reaction:notification');
    const post = (room = 'general', thread) =>
        f.api(f.owner, '/messages', 'POST', { room, thread, body: 'My message' });
    const react = (message, account = f.member, status = 200, emoji = '👍') =>
        f.api(account, `/messages/${message.id}/reaction`, 'POST', { emoji }, status);
    const message = await post();
    await react(message);
    for (const events of [desktop, mobile]) {
        assert.deepEqual(
            notices(events).map((entry) => entry.data),
            [
                {
                    message: {
                        id: message.id,
                        room: 'general',
                        thread: null,
                        author: f.owner.user.id,
                    },
                    user: f.member.user.id,
                    emoji: '👍',
                    sequence: notices(events)[0].data.sequence,
                },
            ],
        );
    }
    assert.equal(notices(reactor).length, 0);
    assert.equal(notices(bystander).length, 0);
    await react(message); // Removal.
    await react(message, f.owner); // Self reaction.
    await react(message, f.member, 400, '<invalid>');
    assert.equal(notices(desktop).length, 1);
    await react(message); // Adding again is a new reaction.
    assert.equal(notices(desktop).length, 2);
    const reply = await post('general', message.id);
    await react(reply);
    assert.equal(notices(desktop).at(-1).data.message.thread, message.id);
    const room = canonicalRoom(`dm:${f.owner.user.id}:${f.member.user.id}`);
    const dm = await post(room);
    await react(dm);
    assert.equal(notices(desktop).at(-1).data.message.room, room);
    assert.equal(notices(bystander).length, 0);
    await react(dm, f.other, 404);
    assert.equal(notices(desktop).length, 4);
    // A valid session must still have channel access at delivery time.
    const memberMessage = await f.api(f.member, '/messages', 'POST', {
        room: 'general',
        body: 'Before access revocation',
    });
    await f.assign(f.member, []);
    await f.override('everyone', [
        { channel: 'general', permission: 'channels.view', effect: 'deny' },
    ]);
    await react(memberMessage, f.owner, 200, '🔥');
    assert.equal(
        notices(reactor).length,
        0,
        'inaccessible author sessions receive no notification',
    );
});

test('reaction badges persist and jump newest-first to your message, including thread replies', async (t) => {
    const f = await roleFixture(t);
    const post = (account, body, thread) =>
        f.api(account, '/messages', 'POST', { room: 'general', body, thread });
    const react = (message, emoji = '👍') =>
        f.api(f.member, `/messages/${message.id}/reaction`, 'POST', { emoji });
    const root = await post(f.owner, 'My root');
    const reply = await post(f.owner, 'My reply', root.id);
    await react(root);
    const ordinary = await post(f.other, 'Ordinary incoming message');
    await react(reply);
    assert.equal((await f.api(f.owner, '/activity')).unread.general, 3);
    assert.equal(
        (await f.api(f.other, '/activity')).unread.general,
        2,
        'bystanders only count messages',
    );
    await f.restart();
    let target = await f.api(f.owner, '/activity/next?room=general');
    assert.equal(target.message.id, reply.id);
    assert.equal(target.parent.id, root.id);
    assert.ok(target.reactionsThrough > 0);
    assert.deepEqual(target.reactions, [{ message: reply.id, emoji: '👍' }]);
    await f.api(f.owner, '/activity/acknowledge', 'POST', {
        room: 'general',
        message: target.message.id,
        reactionsThrough: target.reactionsThrough,
    });
    target = await f.api(f.owner, '/activity/next?room=general');
    assert.equal(
        target.message.id,
        ordinary.id,
        'new messages and reactions share chronological traversal',
    );
    await f.api(f.owner, '/activity/acknowledge', 'POST', {
        room: 'general',
        message: ordinary.id,
    });
    target = await f.api(f.owner, '/activity/next?room=general');
    assert.equal(target.message.id, root.id);
    // A later reaction to an already visited message must become pending again.
    const firstCutoff = target.reactionsThrough;
    await react(root, '🔥');
    await f.api(f.owner, '/activity/acknowledge', 'POST', {
        room: 'general',
        message: root.id,
        reactionsThrough: firstCutoff,
    });
    assert.equal((await f.api(f.owner, '/activity')).unread.general, 1);
    target = await f.api(f.owner, '/activity/next?room=general');
    assert.equal(target.message.id, root.id);
    assert.ok(target.reactionsThrough > firstCutoff);
    await f.api(f.owner, '/activity/acknowledge', 'POST', {
        room: 'general',
        message: root.id,
        reactionsThrough: target.reactionsThrough,
    });
    assert.equal(await f.api(f.owner, '/activity/next?room=general'), null);
    await react(root, '🎉');
    assert.equal((await f.api(f.owner, '/activity')).unread.general, 1);
    await react(root, '🎉');
    assert.equal(
        (await f.api(f.owner, '/activity')).unread.general,
        undefined,
        'unreacting removes the pending activity',
    );
});

test('reaction clearing uses captured cutoffs and visible IDs, without clearing other accounts or rooms', async (t) => {
    const f = await roleFixture(t);
    const post = (body, room = 'general') => f.api(f.owner, '/messages', 'POST', { room, body });
    const react = (message, emoji = '👍') =>
        f.api(f.member, `/messages/${message.id}/reaction`, 'POST', { emoji });
    const visible = await post('Visible');
    const offscreen = await post('Offscreen');
    const dmRoom = canonicalRoom(`dm:${f.owner.user.id}:${f.member.user.id}`);
    const privateMessage = await post('DM', dmRoom);
    await react(visible);
    await react(offscreen);
    await react(privateMessage);
    const captured = await f.api(f.owner, '/activity');
    await react(visible, '🔥');
    let result = await f.api(f.owner, '/activity/acknowledge-visible', 'POST', {
        room: 'general',
        messages: [visible.id, visible.id, privateMessage.id, 'missing'],
        reactionsThrough: captured.latestReactions.general,
    });
    assert.deepEqual(result.messages, [visible.id]);
    assert.deepEqual(
        result.reactions,
        [{ message: visible.id, emoji: '👍' }],
        'only queued reactions through the captured cutoff are highlighted',
    );
    assert.equal(result.unread.general, 2, 'offscreen and later reactions remain pending');
    assert.equal(result.unread[dmRoom], 1);
    // Another account cannot acknowledge the owner's reactions.
    await f.api(f.other, '/activity/acknowledge-visible', 'POST', {
        room: 'general',
        messages: [visible.id],
        reactionsThrough: result.latestReactions.general,
    });
    assert.equal((await f.api(f.owner, '/activity')).unread.general, 2);
    result = await f.api(f.owner, '/activity/read', 'POST', {
        room: 'general',
        through: captured.latest.general,
        reactionsThrough: captured.latestReactions.general,
        all: true,
    });
    assert.equal(result.unread.general, 1, 'a later reaction survives clearing the captured menu');
    assert.equal(result.unread[dmRoom], 1);
    const latest = await f.api(f.owner, '/activity');
    result = await f.api(f.owner, '/activity/read', 'POST', {
        room: 'general',
        through: latest.latest.general,
        reactionsThrough: latest.latestReactions.general,
        all: true,
    });
    assert.equal(result.unread.general, undefined);
    assert.equal(result.unread[dmRoom], 1);
    await f.api(
        f.owner,
        '/activity/acknowledge',
        'POST',
        { room: 'general', message: visible.id, reactionsThrough: 999999 },
        404,
    );
    for (const invalid of [-1, '1', 1.5])
        await f.api(
            f.owner,
            '/activity/acknowledge-visible',
            'POST',
            { room: 'general', messages: [], reactionsThrough: invalid },
            400,
        );
    await f.api(f.other, `/activity/next?room=${dmRoom}`, 'GET', undefined, 403);
    await f.api(f.owner, `/messages/${privateMessage.id}`, 'DELETE');
    assert.equal((await f.api(f.owner, '/activity')).unread[dmRoom], undefined);
});

test('cleared reactions sync to the author account and inaccessible conversations are omitted', async (t) => {
    const f = await roleFixture(t);
    const message = await f.api(f.member, '/messages', 'POST', { room: 'general', body: 'Mine' });
    await f.api(f.owner, `/messages/${message.id}/reaction`, 'POST', { emoji: '👍' });
    const sockets = [];
    t.after(() => sockets.forEach((id) => f.service.io.sockets.sockets.delete(id)));
    const attach = (id, account) => {
        sockets.push(id);
        const events = [];
        f.service.io.sockets.sockets.set(id, {
            data: { token: account.token, user: account.user },
            emit: (event, data) => events.push({ event, data }),
        });
        return events;
    };
    const desktop = attach('persist-desktop', f.member);
    const mobile = attach('persist-mobile', f.member);
    const outsider = attach('persist-other', f.other);
    const target = await f.api(f.member, '/activity/next?room=general');
    await f.api(f.member, '/activity/acknowledge', 'POST', {
        room: 'general',
        message: message.id,
        reactionsThrough: target.reactionsThrough,
    });
    for (const events of [desktop, mobile])
        assert.equal(events.at(-1).data.unread.general, undefined);
    assert.equal(outsider.length, 0);
    await f.api(f.owner, `/messages/${message.id}/reaction`, 'POST', { emoji: '🔥' });
    await f.assign(f.member, []);
    await f.override('everyone', [
        { channel: 'general', permission: 'channels.view', effect: 'deny' },
    ]);
    assert.equal((await f.api(f.member, '/activity')).unread.general, undefined);
    await f.api(f.member, '/activity/next?room=general', 'GET', undefined, 403);
});

test('installing reaction tracking does not replay existing reactions or reset message read state', async (t) => {
    const f = await roleFixture(t);
    const message = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        body: 'Existing message',
    });
    await f.api(f.member, '/activity/acknowledge', 'POST', {
        room: 'general',
        message: message.id,
    });
    await f.api(f.member, `/messages/${message.id}/reaction`, 'POST', { emoji: '👍' });
    // Model a database made before reaction tracking was available.
    f.db.exec('DROP TRIGGER record_reaction_notification; DROP TABLE reaction_notifications');
    await f.restart();
    assert.equal((await f.api(f.owner, '/activity')).unread.general, undefined);
    assert.equal((await f.api(f.member, '/activity')).unread.general, undefined);
    assert.equal((await f.api(f.owner, `/messages/${message.id}`)).reactions.length, 1);
    await f.api(f.member, `/messages/${message.id}/reaction`, 'POST', { emoji: '🔥' });
    assert.equal((await f.api(f.owner, '/activity')).unread.general, 1);
});
