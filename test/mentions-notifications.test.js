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
    const prefs = { channelNotifications: { [notificationKey(server, me.id, 'general')]: false } };
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
        channelNotifications: { [notificationKey(server, me.id, 'dm:bob:me')]: false },
    };
    assert.equal(
        shouldNotify(message('hi', { room: 'dm:bob:me' }), me, dmPrefs, server, users),
        false,
    );
});

test('channel modes preserve legacy settings and choose all, mentions, or muted', () => {
    for (const value of [undefined, true, 'mentions', 'invalid'])
        assert.equal(channelNotificationMode(value), 'mentions');
    for (const value of [false, 'muted']) assert.equal(channelNotificationMode(value), 'muted');
    assert.equal(channelNotificationMode('all'), 'all');
    const server = 'https://chat.example';
    const key = notificationKey(server, me.id, 'general');
    for (const [mode, ordinary, mention] of [
        ['all', true, true],
        ['mentions', false, true],
        ['muted', false, false],
        [true, false, true],
        [false, false, false],
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
        false,
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
