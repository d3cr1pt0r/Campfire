import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { roleFixture } from '../test-support/role-fixture.js';
import { memberPermissions } from '../shared/permissions.js';

// Fake sockets receive what the server emits, serialized the way Socket.IO sends it.
const listen = (f, account) => {
    const socket = new EventEmitter();
    const id = `${account.user.id}-socket`;
    const updates = [];
    Object.assign(socket, {
        id,
        data: { user: account.user, token: account.token },
        join(room) {
            f.service.io.sockets.adapter.addAll(id, new Set([room]));
        },
        use() {},
        client: { writeToEngine() {} },
        notifyOutgoingListeners() {},
    });
    f.service.io.sockets.sockets.set(id, socket);
    EventEmitter.prototype.emit.call(f.service.io.sockets, 'connection', socket);
    for (const event of ['message', 'message:update'])
        socket.on(event, (payload) => updates.push(JSON.parse(JSON.stringify(payload))));
    return {
        updates,
        close() {
            f.service.io.sockets.sockets.delete(id);
            f.service.io.sockets.adapter.delAll(id);
        },
    };
};
const poll = (overrides = {}) => ({
    question: 'Which night for game night?',
    answers: ['Friday', 'Saturday', 'Sunday'],
    hours: 24,
    ...overrides,
});
const post = (f, account, body, status) =>
    f.api(account, '/messages', 'POST', { room: 'general', ...body }, status);
const vote = (f, account, message, answers, status) =>
    f.api(account, `/messages/${message.id}/vote`, 'POST', { answers }, status);
const history = async (f, account, message) =>
    (await f.api(account, '/messages?room=general')).messages.find((m) => m.id === message.id);

test('polls validate their question, answers, length and options', async (t) => {
    const f = await roleFixture(t);
    const created = await post(f, f.member, { poll: poll() });
    assert.equal(created.body, 'Which night for game night?');
    assert.deepEqual(
        created.poll.answers.map((answer) => answer.text),
        ['Friday', 'Saturday', 'Sunday'],
    );
    assert.equal(created.poll.multiple, false);
    assert.equal(created.poll.anonymous, false);
    assert.equal(created.poll.ended, false);
    assert.equal(created.poll.total, 0);
    assert.deepEqual(created.poll.mine, []);
    assert.ok(Math.abs(created.poll.ends - (Date.now() + 24 * 3600000)) < 5000);
    for (const invalid of [
        poll({ question: '  ' }),
        poll({ question: 'x'.repeat(301) }),
        poll({ answers: ['Only one'] }),
        poll({ answers: Array.from({ length: 11 }, (_, i) => `Answer ${i}`) }),
        poll({ answers: ['Friday', ' friday '] }),
        poll({ answers: ['Friday', 'x'.repeat(81)] }),
        poll({ answers: ['Friday', 'Two\nlines'] }),
        poll({ hours: 2 }),
        poll({ multiple: 'yes' }),
        'not a poll',
    ])
        await post(f, f.member, { poll: invalid }, 400);
    await post(f, f.member, { body: 'Extra text', poll: poll() }, 400);
    await post(f, f.member, { poll: poll(), attachments: [{ name: 'a.txt', data: 'aGk=' }] }, 400);
    await f.api(f.member, `/messages/${created.id}`, 'PATCH', { body: 'Changed' }, 400);
    const thread = await post(f, f.member, {
        thread: created.id,
        poll: poll({ question: 'Pizza or tacos?', answers: ['Pizza', 'Tacos'] }),
    });
    assert.equal(thread.thread, created.id);
    assert.equal(thread.poll.answers.length, 2);
});

test('results stay hidden until a member votes and update live for each viewer', async (t) => {
    const f = await roleFixture(t);
    const watcher = listen(f, f.other);
    t.after(() => watcher.close());
    const created = await post(f, f.owner, { poll: poll() });
    const [friday, saturday, sunday] = created.poll.answers.map((answer) => answer.id);
    assert.equal('count' in created.poll.answers[0], false);

    const voted = await vote(f, f.member, created, [friday]);
    assert.deepEqual(voted.poll.mine, [friday]);
    assert.equal(voted.poll.total, 1);
    assert.deepEqual(
        voted.poll.answers.map((answer) => [answer.count, answer.voters]),
        [
            [1, [f.member.user.id]],
            [0, []],
            [0, []],
        ],
    );
    // Someone who hasn't voted sees the total but not how votes split.
    const seen = watcher.updates.at(-1).poll;
    assert.equal(seen.total, 1);
    assert.deepEqual(seen.mine, []);
    assert.equal(
        seen.answers.some((answer) => 'count' in answer || 'voters' in answer),
        false,
    );
    assert.equal((await history(f, f.other, created)).poll.answers[0].count, undefined);

    await vote(f, f.other, created, [saturday]);
    assert.deepEqual(
        watcher.updates.at(-1).poll.answers.map((answer) => answer.count),
        [1, 1, 0],
    );
    // One answer per member in a single-choice poll; changing and removing both work.
    await vote(f, f.member, created, [friday, sunday], 400);
    assert.deepEqual((await vote(f, f.member, created, [sunday])).poll.mine, [sunday]);
    const removed = await vote(f, f.member, created, []);
    assert.deepEqual(removed.poll.mine, []);
    assert.equal(removed.poll.total, 1);
    assert.equal(removed.poll.answers[0].count, undefined);
    for (const bad of [['not-an-answer'], [friday, friday], 'friday', [1]])
        await vote(f, f.member, created, bad, 400);

    const other = await post(f, f.owner, {
        poll: poll({ question: 'Snacks?', answers: ['Chips', 'Fruit', 'Both'], multiple: true }),
    });
    await vote(f, f.member, created, [other.poll.answers[0].id], 400);
    const both = await vote(f, f.member, other, [
        other.poll.answers[0].id,
        other.poll.answers[1].id,
    ]);
    assert.equal(both.poll.total, 1);
    assert.deepEqual(
        both.poll.answers.map((answer) => answer.count),
        [1, 1, 0],
    );
});

test('anonymous polls never send who voted for what, to anyone', async (t) => {
    const f = await roleFixture(t);
    const watcher = listen(f, f.owner);
    t.after(() => watcher.close());
    const created = await post(f, f.owner, { poll: poll({ anonymous: true }) });
    assert.equal(created.poll.anonymous, true);
    const [friday, saturday] = created.poll.answers.map((answer) => answer.id);
    const memberView = await vote(f, f.member, created, [friday]);
    await vote(f, f.other, created, [saturday]);
    const ownerView = await vote(f, f.owner, created, [friday]);
    assert.deepEqual(memberView.poll.mine, [friday]);
    assert.deepEqual(
        ownerView.poll.answers.map((answer) => answer.count),
        [2, 1, 0],
    );
    const payloads = [
        created,
        memberView,
        ownerView,
        await history(f, f.owner, created),
        await history(f, f.member, created),
        await f.api(f.owner, `/messages/${created.id}`),
        ...watcher.updates,
    ];
    for (const payload of payloads.filter((message) => message.id === created.id)) {
        const text = JSON.stringify(payload.poll);
        assert.equal(text.includes('voters'), false);
        for (const account of [f.member, f.other])
            assert.equal(text.includes(account.user.id), false);
    }
});

test('voting needs reaction permission and stops when the poll is ended', async (t) => {
    const f = await roleFixture(t);
    const watcher = listen(f, f.other);
    t.after(() => watcher.close());
    const created = await post(f, f.member, { poll: poll() });
    const [friday] = created.poll.answers.map((answer) => answer.id);
    await f.flags(memberPermissions.filter((permission) => permission !== 'reactions.add'));
    await vote(f, f.member, created, [friday], 403);
    await f.flags(memberPermissions);
    await vote(f, f.member, created, [friday]);

    // Only the author or a moderator can end it early.
    await f.api(f.other, `/messages/${created.id}/poll/end`, 'POST', {}, 403);
    await f.api(f.member, `/messages/${created.id}/poll/end`, 'POST', {});
    const ended = watcher.updates.at(-1).poll;
    assert.equal(ended.ended, true);
    // Final results are visible to everyone, including members who never voted.
    assert.deepEqual(
        ended.answers.map((answer) => answer.count),
        [1, 0, 0],
    );
    await vote(f, f.other, created, [friday], 409);
    const moderated = await post(f, f.member, { poll: poll() });
    await f.api(f.owner, `/messages/${moderated.id}/poll/end`, 'POST', {});
    assert.equal((await history(f, f.member, moderated)).poll.ended, true);

    // Polls in a DM stay inside the DM.
    const room = `dm:${[f.owner.user.id, f.member.user.id].sort().join(':')}`;
    const private_ = await f.api(f.owner, '/messages', 'POST', { room, poll: poll() });
    await vote(f, f.other, private_, [private_.poll.answers[0].id], 404);
    await f.api(f.member, `/messages/${private_.id}/poll/end`, 'POST', {}, 403);
});

test('deleting a poll removes its answers and votes', async (t) => {
    const f = await roleFixture(t);
    const created = await post(f, f.member, { poll: poll() });
    await vote(f, f.other, created, [created.poll.answers[0].id]);
    await f.api(f.member, `/messages/${created.id}`, 'DELETE');
    for (const table of ['polls', 'poll_answers', 'poll_votes'])
        assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});

test('when voting time runs out, everyone receives the final results', async (t) => {
    const f = await roleFixture(t);
    const created = await post(f, f.member, { poll: poll() });
    await vote(f, f.member, created, [created.poll.answers[1].id]);
    // Polls still open at startup are scheduled again from the database.
    f.db.prepare('UPDATE polls SET ends=? WHERE message=?').run(Date.now() + 200, created.id);
    await f.restart();
    const watcher = listen(f, f.other);
    t.after(() => watcher.close());
    await new Promise((resolve) => setTimeout(resolve, 600));
    const final = watcher.updates.find((message) => message.id === created.id)?.poll;
    assert.equal(final?.ended, true);
    assert.deepEqual(
        final.answers.map((answer) => answer.count),
        [0, 1, 0],
    );
});
