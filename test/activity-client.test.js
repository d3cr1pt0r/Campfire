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
        dmNotifications: true,
        channelNotifications: { [key('general')]: 'all', [other]: 'muted' },
        categoryNotifications: { [key('old-category')]: 'muted' },
    };
    const settings = {
        muted: true,
        directMessages: false,
        defaultMode: 'mentions',
        channels: { introductions: 'all' },
        categories: {},
    };
    const merged = withNotificationPreferences(local, settings, server, user);
    assert.deepEqual(notificationPreferences(merged, server, user), settings);
    assert.equal(merged.channelNotifications[other], 'muted');
    assert.equal(merged.channelNotifications[key('general')], undefined);
    assert.equal(merged.categoryNotifications[key('old-category')], undefined);
    assert.equal(merged.notifications, false);
    assert.equal(merged.messageSounds, false);
    assert.equal(merged.output, 'device-speaker');
});
