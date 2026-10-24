import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityClient, isReadingConversation } from '../src/activity.ts';
import {
    notificationPreferences,
    withNotificationPreferences,
} from '../src/notificationPreferences.ts';
import { notificationKey } from '../src/notifications.ts';
import { createNotificationNavigation } from '../src/notificationNavigation.ts';

test('rapid notification clicks wait for display and acknowledgment before selecting the next target', async () => {
    const targets = [{ message: { id: 'newest' } }, { message: { id: 'older' } }];
    const displayed = [],
        acknowledged = [],
        errors = [];
    const navigation = createNotificationNavigation(
        async () => targets.shift() ?? null,
        (target) => new Promise((resolve) => displayed.push({ id: target.message.id, resolve })),
        async (message) => {
            acknowledged.push(message.id);
        },
        () => {},
        (error) => errors.push(error),
    );
    const first = navigation.open('general'),
        second = navigation.open('general');
    await new Promise(setImmediate);
    assert.deepEqual(
        displayed.map((entry) => entry.id),
        ['newest'],
    );
    assert.deepEqual(acknowledged, []);
    displayed[0].resolve();
    await first;
    await new Promise(setImmediate);
    assert.deepEqual(acknowledged, ['newest']);
    assert.deepEqual(
        displayed.map((entry) => entry.id),
        ['newest', 'older'],
    );
    displayed[1].resolve();
    await second;
    assert.deepEqual(acknowledged, ['newest', 'older']);
    assert.deepEqual(errors, []);
});

test('failed message display and cancelled navigation leave notifications pending', async () => {
    const acknowledged = [],
        errors = [];
    const target = { message: { id: 'unshown' } };
    const failed = createNotificationNavigation(
        async () => target,
        async () => {
            throw Error('Load failed');
        },
        async (message) => acknowledged.push(message.id),
        () => {},
        (error) => errors.push(error.message),
    );
    await failed.open('general');
    assert.deepEqual(acknowledged, []);
    assert.deepEqual(errors, ['Load failed']);
    const navigation = createNotificationNavigation(
        async () => target,
        (_target, signal) =>
            new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(Error('Cancelled')), { once: true });
            }),
        async (message) => acknowledged.push(message.id),
        () => {},
        (error) => errors.push(error.message),
    );
    const pending = navigation.open('general');
    await new Promise(setImmediate);
    navigation.cancel();
    await pending;
    assert.deepEqual(acknowledged, []);
    assert.deepEqual(errors, ['Load failed']);
});

test('read acknowledgments coalesce and stale replies cannot replace newer activity', async () => {
    const calls = [],
        failures = [];
    const api = (_path, _method, body) => new Promise((resolve) => calls.push({ body, resolve }));
    const client = createActivityClient(api, (error) => failures.push(error));
    client.receive({ version: 1, unread: { general: 2 }, latest: { general: 2 } });
    client.read('general', 1);
    client.read('general', 2);
    client.read('general', 2);
    assert.equal(calls.length, 1);
    client.receive({ version: 4, unread: { general: 2 }, latest: { general: 3 } });
    calls[0].resolve({ version: 3, unread: { general: 1 }, latest: { general: 2 } });
    await new Promise(setImmediate);
    assert.equal(client.getSnapshot().version, 4);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.through, 2);
    calls[1].resolve({ version: 5, unread: { general: 1 }, latest: { general: 3 } });
    await new Promise(setImmediate);
    client.read('general', 2);
    assert.equal(calls.length, 2);
    client.dismiss('general');
    assert.deepEqual(calls[2].body, { room: 'general', through: 3, thread: null, all: true });
    client.cancel();
    calls[2].resolve({ version: 6, unread: {}, latest: { general: 3 } });
    await new Promise(setImmediate);
    assert.equal(client.getSnapshot().version, 5);
    assert.deepEqual(failures, []);
});

test('focused conversation suppression requires visibility, focus and matching thread', () => {
    const message = { room: 'general' };
    assert.equal(isReadingConversation(message, 'general', null, true, true), true);
    assert.equal(isReadingConversation(message, 'general', null, true, false), false);
    assert.equal(isReadingConversation(message, 'general', null, false, true), false);
    assert.equal(isReadingConversation(message, 'other', null, true, true), false);
    assert.equal(
        isReadingConversation({ ...message, thread: 'root' }, 'general', null, true, true),
        false,
    );
    assert.equal(
        isReadingConversation({ ...message, thread: 'root' }, 'general', 'root', true, true),
        true,
    );
});

test('synced notification rules replace only this account and server while device settings remain local', () => {
    const server = 'https://chat.example',
        user = 'me';
    const key = (scope) => notificationKey(server, user, scope);
    const other = notificationKey(server, 'other', 'general');
    const local = {
        notifications: false,
        messageSounds: false,
        output: 'device-speaker',
        reactionNotifications: { [notificationKey(server, 'other', '*')]: false },
        dmNotifications: true,
        channelNotifications: { [key('general')]: 'all', [other]: 'muted' },
        categoryNotifications: { [key('old-category')]: 'muted' },
    };
    const settings = {
        muted: true,
        directMessages: false,
        reactions: false,
        defaultMode: 'mentions',
        channels: { introductions: 'all' },
        categories: {},
    };
    const merged = withNotificationPreferences(local, settings, server, user);
    assert.deepEqual(notificationPreferences(merged, server, user), settings);
    assert.equal(merged.channelNotifications[other], 'muted');
    assert.equal(merged.channelNotifications[key('general')], undefined);
    assert.equal(merged.categoryNotifications[key('old-category')], undefined);
    assert.equal(merged.reactionNotifications[key('*')], false);
    assert.equal(merged.reactionNotifications[notificationKey(server, 'other', '*')], false);
    const legacy = { ...settings };
    delete legacy.reactions;
    const restoredLegacy = withNotificationPreferences(merged, legacy, server, user);
    assert.equal(notificationPreferences(restoredLegacy, server, user).reactions, true);
    assert.equal(merged.notifications, false);
    assert.equal(merged.messageSounds, false);
    assert.equal(merged.output, 'device-speaker');
});

test('visible acknowledgments update activity, return queued matches, and discard stale account responses', async () => {
    const calls = [];
    const api = (path, method, body, signal) =>
        new Promise((resolve) => calls.push({ path, method, body, signal, resolve }));
    const client = createActivityClient(api, () => {});
    const controller = new AbortController();
    const first = client.acknowledgeVisible('general', ['visible', 'read'], controller.signal);
    assert.equal(calls[0].path, '/activity/acknowledge-visible');
    assert.deepEqual(calls[0].body, { room: 'general', messages: ['visible', 'read'] });
    assert.equal(calls[0].signal, controller.signal);
    calls[0].resolve({
        version: 2,
        unread: { general: 1 },
        latest: { general: 4 },
        messages: ['visible'],
        reactions: [{ message: 'visible', emoji: '👍' }],
    });
    assert.deepEqual(await first, {
        messages: ['visible'],
        reactions: [{ message: 'visible', emoji: '👍' }],
    });
    assert.equal(client.getSnapshot().unread.general, 1);
    assert.deepEqual(await client.acknowledgeVisible('general', []), {
        messages: [],
        reactions: [],
    });
    assert.equal(calls.length, 1);
    const stale = client.acknowledgeVisible('general', ['another']);
    client.cancel();
    calls[1].resolve({ version: 3, unread: {}, latest: { general: 5 }, messages: ['another'] });
    assert.deepEqual(await stale, { messages: [], reactions: [] });
    assert.equal(client.getSnapshot().version, 2);
});

test('reaction acknowledgments and clears retain captured cutoffs across later arrivals', async () => {
    const calls = [];
    const client = createActivityClient(
        async (path, _method, body) => {
            calls.push({ path, body });
            return {
                version: calls.length,
                unread: {},
                latest: { general: 1 },
                messages: ['visible'],
            };
        },
        () => {},
    );
    client.receive({
        version: 0,
        unread: { general: 1 },
        latest: { general: 1 },
        latestReactions: { general: 10 },
    });
    await client.acknowledgeVisible('general', ['visible']);
    assert.equal(calls[0].body.reactionsThrough, 10);
    await client.acknowledge({ id: 'target', room: 'general' }, 8);
    assert.equal(calls[1].body.reactionsThrough, 8);
    client.receive({
        version: 3,
        unread: { general: 2 },
        latest: { general: 1 },
        latestReactions: { general: 11 },
    });
    client.dismiss('general', 1, 10); // Captured when the context menu opened.
    await new Promise(setImmediate);
    assert.equal(calls[2].body.reactionsThrough, 10);
    client.receive({
        version: 4,
        unread: { general: 1 },
        latest: { general: 1 },
        latestReactions: { general: 11 },
    });
    client.dismiss('general'); // Same message position, newer reaction cutoff.
    await new Promise(setImmediate);
    assert.equal(calls[3].body.reactionsThrough, 11);
    client.cancel();
});

test('jump acknowledgment uses the selected reaction cutoff even if another reaction arrives during display', async () => {
    const acknowledgments = [];
    let show;
    const navigation = createNotificationNavigation(
        async () => ({
            message: { id: 'mine', room: 'general' },
            parent: null,
            reactionsThrough: 7,
        }),
        () =>
            new Promise((resolve) => {
                show = resolve;
            }),
        async (message, reactionsThrough) =>
            acknowledgments.push({ id: message.id, reactionsThrough }),
        () => {},
        (error) => {
            throw error;
        },
    );
    const pending = navigation.open('general');
    await new Promise(setImmediate);
    assert.deepEqual(acknowledgments, []);
    show();
    await pending;
    assert.deepEqual(acknowledgments, [{ id: 'mine', reactionsThrough: 7 }]);
});
