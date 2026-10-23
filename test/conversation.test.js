import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, inlineReplies } from '../src/conversation.ts';
import { createStateRefresh } from '../src/stateRefresh.ts';
import { createApiClient, messagePayload } from '../src/api.ts';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const message = (id, body = id, room = 'general') => ({
    id,
    body,
    room,
    created: 1,
    pinned: 0,
    reactions: [],
    attachments: [],
    author: 'alice',
    edited: null,
});

test('late history cannot overwrite live arrivals, edits or deletions', async () => {
    const result = deferred();
    const store = createConversation('general', () => result.promise);
    const loading = store.reload();
    store.receive({ type: 'upsert', message: message('new') });
    store.receive({ type: 'upsert', message: message('edited', 'new body') });
    store.receive({ type: 'delete', id: 'deleted' });
    result.resolve({ messages: [message('edited', 'old body'), message('deleted')], next: null });
    await loading;
    assert.deepEqual(
        store.getSnapshot().messages.map((m) => [m.id, m.body]),
        [
            ['edited', 'new body'],
            ['new', 'new'],
        ],
    );
});

test('expired threads leave loaded and late history, replies included', async () => {
    const result = deferred();
    const store = createConversation('general', () => result.promise);
    const loading = store.reload();
    store.receive({ type: 'upsert', message: message('kept') });
    store.receive({ type: 'expire', ids: ['old'] });
    result.resolve({
        messages: [message('old'), { ...message('reply'), thread: 'old' }, message('kept')],
        next: null,
    });
    await loading;
    assert.deepEqual(
        store.getSnapshot().messages.map((m) => m.id),
        ['kept'],
    );
    store.receive({ type: 'expire', ids: ['kept'] });
    assert.deepEqual(store.getSnapshot().messages, []);
});

test('removed files become placeholders in loaded and late history', async () => {
    const result = deferred();
    const store = createConversation('general', () => result.promise);
    const loading = store.reload();
    const file = { id: 'f', name: 'photo.png', mime: 'image/png', width: 4, height: 3 };
    store.receive({ type: 'strip', ids: ['old'] });
    result.resolve({
        messages: [
            { ...message('old'), attachments: [file], previews: [{ id: 'card' }] },
            { ...message('reply'), thread: 'old', attachments: [{ ...file, id: 'g' }] },
            { ...message('other'), attachments: [{ ...file, id: 'h' }] },
        ],
        next: null,
    });
    await loading;
    const byId = Object.fromEntries(store.getSnapshot().messages.map((m) => [m.id, m]));
    assert.deepEqual(byId.old.attachments, [
        { id: 'f', name: 'photo.png', mime: 'image/png', removed: true },
    ]);
    assert.equal(byId.old.previews, undefined);
    assert.equal(byId.reply.attachments[0].removed, true);
    assert.equal(byId.other.attachments[0].removed, undefined);
});

test('member deletion anonymizes loaded and arriving history without reviving reactions', async () => {
    const result = deferred();
    const authored = {
        ...message('authored'),
        reactions: [
            { user: 'alice', emoji: '👍' },
            { user: 'bob', emoji: '🔥' },
        ],
    };
    const other = {
        ...message('other'),
        author: 'bob',
        reactions: [{ user: 'alice', emoji: '👍' }],
    };
    let calls = 0;
    const store = createConversation('general', () =>
        ++calls === 1
            ? Promise.resolve({ messages: [authored, other], next: 'cursor' })
            : result.promise,
    );
    await store.reload();
    const loading = store.loadOlder();
    store.receive({ type: 'member-deleted', id: 'alice' });
    assert.equal(store.getSnapshot().messages.find((m) => m.id === 'authored').author, null);
    assert.equal(store.getSnapshot().messages.find((m) => m.id === 'other').author, 'bob');
    result.resolve({ messages: [authored, { ...authored, id: 'older' }], next: null });
    await loading;
    assert.equal(store.getSnapshot().messages.find((m) => m.id === 'older').author, null);
    assert.ok(
        store.getSnapshot().messages.every((m) => m.reactions.every((r) => r.user !== 'alice')),
    );
    assert.deepEqual(store.getSnapshot().messages.find((m) => m.id === 'authored').reactions, [
        { user: 'bob', emoji: '🔥' },
    ]);
});

test('a superseded request is aborted and its eventual result is ignored', async () => {
    const old = deferred(),
        current = deferred(),
        signals = [];
    let calls = 0;
    const store = createConversation('general', (_before, signal) => {
        signals.push(signal);
        return ++calls === 1 ? old.promise : current.promise;
    });
    const first = store.reload(),
        second = store.reload();
    assert.equal(signals[0].aborted, true);
    current.resolve({ messages: [message('current')], next: null });
    await second;
    old.resolve({ messages: [message('stale')], next: null });
    await first;
    assert.deepEqual(
        store.getSnapshot().messages.map((m) => m.id),
        ['current'],
    );
});

test('older pages deduplicate messages and cannot resurrect a deleted message', async () => {
    const page = deferred();
    let calls = 0;
    const store = createConversation('general', () =>
        ++calls === 1
            ? Promise.resolve({ messages: [message('latest')], next: 'cursor' })
            : page.promise,
    );
    await store.reload();
    const loading = store.loadOlder();
    store.receive({ type: 'delete', id: 'old' });
    page.resolve({ messages: [message('old'), message('latest')], next: null });
    await loading;
    assert.deepEqual(
        store.getSnapshot().messages.map((m) => m.id),
        ['latest'],
    );
});

test('filters remove live edits that cease matching and ignore other rooms', async () => {
    const store = createConversation(
        'general',
        async () => ({ messages: [message('id', 'find me')], next: null }),
        (m) => m.body.includes('find'),
    );
    await store.reload();
    store.receive({ type: 'upsert', message: message('other', 'find me', 'private') });
    store.receive({ type: 'upsert', message: message('id', 'changed') });
    assert.deepEqual(store.getSnapshot().messages, []);
});

test('state refresh coalesces bursts, serializes requests and discards stale snapshots', async () => {
    const first = deferred(),
        second = deferred(),
        values = [];
    let calls = 0;
    const refresh = createStateRefresh(
        () => (++calls === 1 ? first.promise : second.promise),
        (value) => values.push(value),
        (error) => {
            throw error;
        },
    );
    const pending = refresh.refresh();
    refresh.refresh();
    await Promise.resolve();
    assert.equal(calls, 1);
    refresh.refresh();
    first.resolve('stale');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 2);
    second.resolve('current');
    await pending;
    assert.deepEqual(values, ['current']);
});

test('cancelling refresh prevents an old account response from updating state', async () => {
    const result = deferred(),
        values = [];
    let signal;
    const refresh = createStateRefresh(
        (next) => {
            signal = next;
            return result.promise;
        },
        (value) => values.push(value),
        (error) => {
            throw error;
        },
    );
    const pending = refresh.refresh();
    await Promise.resolve();
    refresh.cancel();
    result.resolve('old account');
    await pending;
    assert.equal(signal.aborted, true);
    assert.deepEqual(values, []);
});

test('shared API handles JSON/blob responses, cancellation and non-JSON failures', async () => {
    const calls = [];
    const api = createApiClient('https://server.example/', 'token', async (url, options) => {
        calls.push({ url, options });
        return url.endsWith('/failure')
            ? new Response('gateway error', { status: 502 })
            : new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
    });
    const controller = new AbortController();
    assert.deepEqual(await api.json('/state', 'GET', undefined, controller.signal), { ok: true });
    assert.equal(calls[0].url, 'https://server.example/api/state');
    assert.equal(calls[0].options.signal, controller.signal);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
    assert.equal((await api.blob('/asset')).type, 'application/json');
    // Files travel as a form, whose content type the browser sets with its boundary.
    const file = new File(['hi'], 'note.txt');
    const form = messagePayload({ room: 'general', body: 'With a file' }, [file]);
    await api.json('/messages', 'POST', form);
    assert.equal(calls.at(-1).options.body, form);
    assert.equal(calls.at(-1).options.headers['Content-Type'], undefined);
    assert.equal(form.get('file').name, 'note.txt');
    assert.equal(form.get('thread'), null);
    assert.deepEqual(messagePayload({ room: 'general', body: 'Text' }, []), {
        room: 'general',
        body: 'Text',
    });
    await api.json('/messages', 'POST', { room: 'general', body: 'Text' });
    assert.equal(calls.at(-1).options.headers['Content-Type'], 'application/json');
    await assert.rejects(
        api.json('/failure'),
        (error) => error.status === 502 && error.message.includes('502'),
    );
});

test('automatic history requests coalesce while pending and stop at the end', async () => {
    const older = deferred();
    let calls = 0;
    const store = createConversation('general', () =>
        ++calls === 1
            ? Promise.resolve({ messages: [message('latest')], next: 'older' })
            : older.promise,
    );
    await store.reload();
    const first = store.loadOlder();
    await store.loadOlder();
    await store.loadOlder();
    assert.equal(calls, 2);
    older.resolve({ messages: [message('before')], next: null });
    await first;
    await store.loadOlder();
    assert.equal(calls, 2);
    assert.equal(store.getSnapshot().messages.length, 2);
});

test('history failures preserve the reading data and cursor so retry can recover', async () => {
    let calls = 0;
    const store = createConversation('general', async (before) => {
        calls++;
        if (calls === 1) return { messages: [message('latest')], next: 'older' };
        assert.equal(before, 'older');
        if (calls === 2) throw new Error('Temporary failure');
        return { messages: [message('before')], next: null };
    });
    await store.reload();
    await store.loadOlder();
    assert.equal(store.getSnapshot().error, 'Temporary failure');
    assert.equal(store.getSnapshot().next, 'older');
    assert.equal(store.getSnapshot().messages[0].id, 'latest');
    await store.loadOlder();
    assert.equal(store.getSnapshot().error, '');
    assert.equal(store.getSnapshot().messages.length, 2);
});

test('room and thread histories stay isolated while parent counts update during loading', async () => {
    const root = message('parent');
    const reply = { ...message('reply'), thread: root.id };
    const otherReply = { ...message('other'), thread: 'other-parent' };
    const pending = deferred();
    const room = createConversation(
        'general',
        () => pending.promise,
        (m) => !m.thread,
    );
    const thread = createConversation(
        'general',
        async () => ({ messages: [reply], next: null }),
        (m) => m.thread === root.id,
    );
    const loading = room.reload();
    room.receive({ type: 'upsert', message: reply });
    room.receive({ type: 'upsert', message: { ...root, replyCount: 2 } });
    pending.resolve({ messages: [{ ...root, replyCount: 0 }, reply], next: null });
    await loading;
    await thread.reload();
    thread.receive({ type: 'upsert', message: otherReply });
    thread.receive({ type: 'upsert', message: { ...root, replyCount: 2 } });
    thread.receive({ type: 'upsert', message: { ...reply, body: 'Edited live' } });
    assert.deepEqual(
        room.getSnapshot().messages.map((m) => [m.id, m.replyCount]),
        [['parent', 2]],
    );
    assert.deepEqual(
        thread.getSnapshot().messages.map((m) => [m.id, m.body]),
        [['reply', 'Edited live']],
    );
    thread.receive({ type: 'delete', id: reply.id });
    assert.deepEqual(thread.getSnapshot().messages, []);
});

test('short threads show inline only with all their replies loaded', async () => {
    const root = { ...message('parent'), replyCount: 2 };
    const replies = ['first', 'second'].map((id) => ({ ...message(id), thread: root.id }));
    const store = createConversation('general', async () => ({
        messages: [root],
        next: null,
        replies,
    }));
    await store.reload();
    const loaded = new Map([[root.id, store.getSnapshot().messages.filter((m) => m.thread)]]);
    assert.deepEqual(
        inlineReplies(root, loaded).map((m) => m.id),
        ['first', 'second'],
    );
    // Past three replies, or with some still missing, the thread opens in the panel.
    assert.equal(inlineReplies({ ...root, replyCount: 4 }, loaded), null);
    assert.equal(inlineReplies({ ...root, replyCount: 3 }, loaded), null);
    assert.equal(inlineReplies(root, null), null);
});
