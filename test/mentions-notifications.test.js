import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionSegments, mentionQuery, completeMention } from '../src/mentions.ts';
import { notificationKey, shouldNotify, channelNotificationMode } from '../src/notifications.ts';

const me = {
    id: 'me',
    username: 'd3cr1pt0r',
    nickname: 'Klemen',
    role: 'member',
    status: 'online',
};
const bob = { id: 'bob', username: 'Bob', nickname: 'B', role: 'member' };
const bobSmith = { ...bob, id: 'bob-smith', username: 'Bob Smith' };
const users = [me, bob, bobSmith];
const message = (body, extra = {}) => ({
    id: 'message',
    room: 'general',
    author: 'bob',
    body,
    ...extra,
});

test('mentions match exact permanent usernames without email or prefix false positives', () => {
    const text = 'Hello @D3CR1PT0R, @Bob Smith! @Bob. user@Bob.com @Bobby @unknown';
    const segments = mentionSegments(text, users);
    assert.equal(segments.map((part) => part.text).join(''), text);
    assert.deepEqual(
        segments.filter((part) => part.user).map((part) => part.user.id),
        ['me', 'bob-smith', 'bob'],
    );
    assert.equal(
        mentionSegments('@Klemen', users).some((part) => part.user),
        false,
    );
    assert.equal(
        mentionSegments('@d3cr1pt0r_suffix @d3cr1pt0r-other', users).some((part) => part.user),
        false,
    );
});

test('autocomplete uses the caret, supports spaces, replaces a partial token, and preserves surrounding text', () => {
    assert.deepEqual(mentionQuery('Hi @Bob S', 9), { start: 3, end: 9, query: 'Bob S' });
    const input = 'Hello @d3cr1pt0r, welcome';
    const query = mentionQuery(input, 9);
    const completed = completeMention(input, query, me.username);
    assert.equal(completed.text, 'Hello @d3cr1pt0r , welcome');
    assert.equal(completed.caret, 17);
    assert.equal(mentionQuery('user@Bob', 8), null);
    assert.equal(mentionQuery('@Bob\nnew line', 13), null);
    assert.equal(mentionQuery('@' + 'a'.repeat(33), 34), null);
    assert.equal(
        completeMention('a'.repeat(3998) + '@b', { start: 3998, end: 4000 }, me.username),
        null,
    );
});

test('default notification policy alerts only DMs and direct mentions and respects DND, self, and opt-outs', () => {
    const notify = (body, prefs = {}, extra = {}, person = me) =>
        shouldNotify(message(body, extra), person, prefs, 'https://chat.example', users);
    assert.equal(notify('ordinary message'), false);
    assert.equal(notify('@d3cr1pt0r hi'), true);
    assert.equal(notify('@Klemen hi'), false);
    assert.equal(notify('@d3cr1pt0r_suffix'), false);
    assert.equal(notify('https://example.com/@d3cr1pt0r'), false);
    assert.equal(notify('mail@d3cr1pt0r'), false);
    assert.equal(notify('@d3cr1pt0r', {}, { thread: 'parent' }), true);
    assert.equal(notify('hi', {}, { room: 'dm:bob:me' }), true);
    assert.equal(notify('hi', { dmNotifications: false }, { room: 'dm:bob:me' }), false);
    assert.equal(notify('@d3cr1pt0r', { mentionNotifications: false }), false);
    assert.equal(notify('@d3cr1pt0r', {}, { author: 'me' }), false);
    assert.equal(notify('@d3cr1pt0r', {}, {}, { ...me, status: 'dnd' }), false);
    assert.equal(
        shouldNotify(message('@Bob Smith'), bob, {}, 'https://chat.example', users),
        false,
    );
    // Desktop permission and sound are separate presentation choices, not subscription choices.
    assert.equal(notify('@d3cr1pt0r', { notifications: false, messageSounds: false }), true);
});

test('conversation opt-outs are scoped to the account, server and parent room including threads', () => {
    const server = 'https://chat.example';
    const prefs = {
        channelNotifications: { [notificationKey(server, me.id, 'general')]: 'muted' },
    };
    assert.equal(
        notificationKey(server + '/', 'me', 'general'),
        notificationKey(server, 'me', 'general'),
    );
    assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, server, users), false);
    assert.equal(
        shouldNotify(message('@d3cr1pt0r', { thread: 'parent' }), me, prefs, server, users),
        false,
    );
    assert.equal(
        shouldNotify(message('@d3cr1pt0r', { room: 'other' }), me, prefs, server, users),
        true,
    );
    assert.equal(
        shouldNotify(message('@d3cr1pt0r'), me, prefs, 'https://other.example', users),
        true,
    );
    assert.equal(shouldNotify(message('@Bob', { author: me.id }), bob, prefs, server, users), true);
    const dmPrefs = {
        channelNotifications: { [notificationKey(server, me.id, 'dm:bob:me')]: 'muted' },
    };
    assert.equal(
        shouldNotify(message('hi', { room: 'dm:bob:me' }), me, dmPrefs, server, users),
        false,
    );
});

test('channel modes choose all, mentions, or muted, with mentions for anything else', () => {
    for (const value of [undefined, true, false, 'mentions', 'invalid'])
        assert.equal(channelNotificationMode(value), 'mentions');
    assert.equal(channelNotificationMode('muted'), 'muted');
    assert.equal(channelNotificationMode('all'), 'all');
    const server = 'https://chat.example';
    const key = notificationKey(server, me.id, 'general');
    for (const [mode, ordinary, mention] of [
        ['all', true, true],
        ['mentions', false, true],
        ['muted', false, false],
    ]) {
        const prefs = { channelNotifications: { [key]: mode } };
        assert.equal(shouldNotify(message('ordinary'), me, prefs, server, users), ordinary);
        assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, server, users), mention);
        assert.equal(
            shouldNotify(message('thread reply', { thread: 'parent' }), me, prefs, server, users),
            ordinary,
        );
        assert.equal(
            shouldNotify(message('@d3cr1pt0r', { thread: 'parent' }), me, prefs, server, users),
            mention,
        );
    }
});

test('all-message channels remain scoped and respect server mute, DND, and self-message exclusions', () => {
    const server = 'https://chat.example';
    const prefs = {
        channelNotifications: { [notificationKey(server, me.id, 'general')]: 'all' },
        mentionNotifications: false,
    };
    assert.equal(shouldNotify(message('ordinary'), me, prefs, server, users), true);
    assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, server, users), true);
    assert.equal(
        shouldNotify(message('ordinary', { room: 'other' }), me, prefs, server, users),
        false,
    );
    assert.equal(
        shouldNotify(message('ordinary'), me, prefs, 'https://other.example', users),
        false,
    );
    assert.equal(
        shouldNotify(message('ordinary'), { ...me, status: 'dnd' }, prefs, server, users),
        false,
    );
    assert.equal(
        shouldNotify(message('ordinary', { author: me.id }), me, prefs, server, users),
        false,
    );
    assert.equal(
        shouldNotify(
            message('ordinary'),
            me,
            { ...prefs, serverNotifications: { [notificationKey(server, me.id, '*')]: false } },
            server,
            users,
        ),
        false,
    );
    assert.equal(
        shouldNotify(message('@d3cr1pt0r', { room: 'other' }), me, prefs, server, users),
        false,
    );
    const dm = 'dm:bob:me';
    assert.equal(
        shouldNotify(
            message('hello', { room: dm }),
            me,
            {
                dmNotifications: false,
                channelNotifications: { [notificationKey(server, me.id, dm)]: 'all' },
            },
            server,
            users,
        ),
        true,
    );
    assert.equal(
        shouldNotify(
            message('hello', { room: dm }),
            me,
            { channelNotifications: { [notificationKey(server, me.id, dm)]: 'muted' } },
            server,
            users,
        ),
        false,
    );
});

test('server muting silences mentions, thread replies and DMs only for the selected account/server', () => {
    const server = 'https://chat.example';
    const prefs = { serverNotifications: { [notificationKey(server, me.id, '*')]: false } };
    assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, server), false);
    assert.equal(
        shouldNotify(message('@d3cr1pt0r', { thread: 'parent' }), me, prefs, server),
        false,
    );
    assert.equal(shouldNotify(message('hello', { room: 'dm:bob:me' }), me, prefs, server), false);
    assert.equal(
        shouldNotify(message('hello', { room: 'dm:bob:me' }), me, prefs, server + '/'),
        false,
    );
    assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, 'https://another.example'), true);
    assert.equal(shouldNotify(message('@d3cr1pt0r'), { ...me, id: 'other' }, prefs, server), true);
});

test('emoji completion uses the caret, avoids URLs and resolves standard and custom aliases', async () => {
    const { emojiQuery, emojiMatches } = await import('../src/emojiCompletion.ts');
    assert.deepEqual(emojiQuery('hi :smi later', 7), { start: 3, end: 7, query: 'smi' });
    assert.equal(emojiQuery('https:', 6), null);
    assert.equal(emojiQuery('12:30', 5), null);
    assert.equal(emojiQuery('done :smile:', 12), null);
    assert.equal(emojiMatches('smi', [])[0].value, '😄');
    assert.equal(emojiMatches('camp', [{ name: 'campfire' }])[0].value, ':campfire:');
    assert.equal(emojiMatches('smile', [{ name: 'smile' }])[0].value, ':smile:');
    assert.equal(emojiMatches('', []).length, 8);
});

test('server defaults inherit into channels and threads but remain separate from DMs', () => {
    const server = 'https://chat.example';
    const serverKey = notificationKey(server, me.id, '*');
    for (const [mode, ordinary, mention] of [
        ['all', true, true],
        ['mentions', false, true],
        ['muted', false, false],
    ]) {
        const prefs = { serverNotificationModes: { [serverKey]: mode } };
        for (const thread of [undefined, 'parent']) {
            assert.equal(
                shouldNotify(message('ordinary', { thread }), me, prefs, server, users),
                ordinary,
            );
            assert.equal(
                shouldNotify(message('@d3cr1pt0r', { thread }), me, prefs, server, users),
                mention,
            );
        }
        assert.equal(
            shouldNotify(message('hello', { room: 'dm:bob:me' }), me, prefs, server, users),
            true,
        );
    }
});

test('channel overrides beat category overrides, which beat server defaults independently of access sync', () => {
    const server = 'https://chat.example';
    const channels = [
        { id: 'general', category: 'community', synced: false },
        { id: 'other', category: 'community', synced: true },
    ];
    const prefs = {
        serverNotificationModes: { [notificationKey(server, me.id, '*')]: 'muted' },
        categoryNotifications: { [notificationKey(server, me.id, 'community')]: 'all' },
        channelNotifications: { [notificationKey(server, me.id, 'general')]: 'mentions' },
    };
    const notify = (body, room = 'general', extra = {}) =>
        shouldNotify(message(body, { room, ...extra }), me, prefs, server, users, channels);
    assert.equal(notify('ordinary'), false);
    assert.equal(notify('@d3cr1pt0r'), true);
    assert.equal(notify('ordinary', 'other'), true);
    assert.equal(notify('ordinary', 'unknown'), false);
    delete prefs.channelNotifications[notificationKey(server, me.id, 'general')];
    assert.equal(notify('ordinary', 'general', { thread: 'parent' }), true);
    prefs.categoryNotifications[notificationKey(server, me.id, 'community')] = 'muted';
    assert.equal(notify('@d3cr1pt0r'), false);
    delete prefs.categoryNotifications[notificationKey(server, me.id, 'community')];
    prefs.serverNotificationModes[notificationKey(server, me.id, '*')] = 'all';
    assert.equal(notify('ordinary'), true);
});

test('inherited notification rules remain account/server scoped and respect master exclusions', () => {
    const server = 'https://chat.example';
    const channels = [{ id: 'general', category: 'community' }];
    const prefs = {
        categoryNotifications: { [notificationKey(server, me.id, 'community')]: 'all' },
    };
    assert.equal(shouldNotify(message('ordinary'), me, prefs, server, users, channels), true);
    assert.equal(
        shouldNotify(message('ordinary'), me, prefs, 'https://elsewhere.example', users, channels),
        false,
    );
    assert.equal(
        shouldNotify(message('ordinary'), { ...me, id: 'other' }, prefs, server, users, channels),
        false,
    );
    assert.equal(
        shouldNotify(message('ordinary'), { ...me, status: 'dnd' }, prefs, server, users, channels),
        false,
    );
    assert.equal(
        shouldNotify(message('ordinary', { author: me.id }), me, prefs, server, users, channels),
        false,
    );
    assert.equal(
        shouldNotify(
            message('@d3cr1pt0r'),
            me,
            { ...prefs, serverNotifications: { [notificationKey(server, me.id, '*')]: false } },
            server,
            users,
            channels,
        ),
        false,
    );
});

test('legacy preferences retain their default until an explicit server policy replaces it', () => {
    const server = 'https://chat.example';
    const prefs = { mentionNotifications: false };
    assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, server, users), false);
    prefs.serverNotificationModes = { [notificationKey(server, me.id, '*')]: 'mentions' };
    assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, server, users), true);
    prefs.serverNotificationModes[notificationKey(server, me.id, '*')] = 'corrupt';
    assert.equal(shouldNotify(message('@d3cr1pt0r'), me, prefs, server, users), false);
});

test('DM overrides can opt in or out of their default while server mute and DND still win', () => {
    const server = 'https://chat.example',
        room = 'dm:bob:me';
    const prefs = {
        dmNotifications: false,
        channelNotifications: { [notificationKey(server, me.id, room)]: 'all' },
    };
    assert.equal(shouldNotify(message('hello', { room }), me, prefs, server, users), true);
    assert.equal(
        shouldNotify(message('hello', { room }), { ...me, status: 'dnd' }, prefs, server, users),
        false,
    );
    assert.equal(
        shouldNotify(
            message('hello', { room }),
            me,
            { ...prefs, serverNotifications: { [notificationKey(server, me.id, '*')]: false } },
            server,
            users,
        ),
        false,
    );
    delete prefs.channelNotifications[notificationKey(server, me.id, room)];
    assert.equal(shouldNotify(message('hello', { room }), me, prefs, server, users), false);
    prefs.dmNotifications = true;
    prefs.channelNotifications[notificationKey(server, me.id, room)] = 'muted';
    assert.equal(shouldNotify(message('hello', { room }), me, prefs, server, users), false);
});
