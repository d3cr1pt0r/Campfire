import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    appliesRetention,
    dayMs,
    deletionTime,
    expiryCutoff,
    finalWindow,
    formatRetention,
    isRetentionDays,
    nextKeepText,
    nextPolicy,
    noticeMs,
    periodAt,
    retentionSchedule,
    upcomingChange,
} from '../shared/retention.js';
import { formatBytes, formatStorageQuota, gigabyte, isStorageQuota } from '../shared/uploads.js';
import {
    conversationSchedule,
    hasFiles,
    messageRetention,
    periodLabel,
    pinKeeps,
    retentionChip,
    retentionNotice,
    unpinText,
} from '../src/retention.ts';

const policy = (retention, retentionNext = null, retentionAt = null) => ({
    retention,
    retentionNext,
    retentionAt,
});
const forever = policy(0);

test('retention periods are whole days up to ten years and read as words', () => {
    for (const days of [0, 1, 30, 3650]) assert.equal(isRetentionDays(days), true);
    for (const days of [-1, 3651, 1.5, '30', null, Infinity])
        assert.equal(isRetentionDays(days), false);
    assert.equal(formatRetention(0), 'Forever');
    assert.equal(formatRetention(Infinity), 'Forever');
    assert.equal(formatRetention(365), '1 year');
    assert.equal(formatRetention(14), '2 weeks');
    assert.equal(formatRetention(60), '60 days');
    assert.equal(formatRetention(1), '1 day');
});

test('schedules merge a channel with the server default it follows', () => {
    const T1 = 1000 * dayMs,
        T2 = 2000 * dayMs;
    assert.deepEqual(retentionSchedule({ server: forever, dm: policy(30) }, null), [
        { from: -Infinity, days: 30, source: 'dm', keepText: false },
    ]);
    const server = policy(0, 14, T1);
    assert.deepEqual(retentionSchedule({ server, dm: forever }, { retention: null }), [
        { from: -Infinity, days: Infinity, source: 'server', keepText: false },
        { from: T1, days: 14, source: 'server', keepText: false },
    ]);
    // A channel's own period ignores the server default.
    assert.deepEqual(retentionSchedule({ server, dm: forever }, { retention: 0 }), [
        { from: -Infinity, days: Infinity, source: 'channel', keepText: false },
    ]);
    // A channel that will follow the server default again, before or after the server changes.
    const following = (at) => policy(365, null, at);
    assert.deepEqual(
        retentionSchedule({ server: policy(30, 14, T1), dm: forever }, following(T2)),
        [
            { from: -Infinity, days: 365, source: 'channel', keepText: false },
            { from: T2, days: 14, source: 'server', keepText: false },
        ],
    );
    assert.deepEqual(
        retentionSchedule({ server: policy(30, 14, T2), dm: forever }, following(T1)),
        [
            { from: -Infinity, days: 365, source: 'channel', keepText: false },
            { from: T1, days: 30, source: 'server', keepText: false },
            { from: T2, days: 14, source: 'server', keepText: false },
        ],
    );
    const schedule = retentionSchedule({ server: forever, dm: forever }, following(T1));
    assert.equal(periodAt(schedule, T1 - 1), 365);
    assert.equal(periodAt(schedule, T1), Infinity);
});

test('deletion times follow the periods in force, pins and running polls', () => {
    const now = 100 * dayMs;
    const thirty = [{ from: -Infinity, days: 30, source: 'channel' }];
    const unit = (since, extra = {}) => ({ since, kept: false, pollEnds: null, ...extra });
    assert.equal(deletionTime([{ from: -Infinity, days: Infinity }], unit(0)), null);
    assert.equal(deletionTime(thirty, unit(now, { kept: true })), null);
    assert.equal(deletionTime(thirty, unit(now)), now + 30 * dayMs);
    assert.equal(deletionTime(thirty, unit(now, { pollEnds: now + 40 * dayMs })), now + 40 * dayMs);
    // Forever until a change a week away, then two weeks.
    const change = now + 7 * dayMs;
    const pending = [
        { from: -Infinity, days: Infinity, source: 'server' },
        { from: change, days: 14, source: 'server' },
    ];
    assert.equal(deletionTime(pending, unit(now - 50 * dayMs)), change);
    assert.equal(deletionTime(pending, unit(now)), now + 14 * dayMs);
    // A thread is due exactly when its clock is at or before the cutoff.
    const schedules = [
        thirty,
        pending,
        [
            { from: -Infinity, days: 365, source: 'channel' },
            { from: change, days: 30, source: 'server' },
            { from: change + 20 * dayMs, days: 1, source: 'server' },
        ],
    ];
    for (const schedule of schedules)
        for (let since = now - 400 * dayMs; since <= now + 60 * dayMs; since += 3 * dayMs + 7)
            for (const time of [now, change, change + 10 * dayMs, now + 90 * dayMs]) {
                const at = deletionTime(schedule, unit(since));
                assert.equal(
                    at !== null && at <= time,
                    since <= expiryCutoff(schedule, time),
                    `${since} at ${time}`,
                );
            }
    assert.equal(expiryCutoff([{ from: -Infinity, days: Infinity }], now), -Infinity);
});

test('only shorter coming periods are announced, and the hourglass shows in the last days', () => {
    const now = 100 * dayMs;
    const shorter = [
        { from: -Infinity, days: Infinity, source: 'server' },
        { from: now + dayMs, days: 14, source: 'server' },
    ];
    assert.deepEqual(upcomingChange(shorter, now), { ...shorter[1], kind: 'messages' });
    assert.equal(appliesRetention(shorter, now), true);
    // A channel returning to a longer server default is no warning.
    const longer = [
        { from: -Infinity, days: 14, source: 'channel' },
        { from: now + dayMs, days: 30, source: 'server' },
    ];
    assert.equal(upcomingChange(longer, now), null);
    assert.equal(appliesRetention([{ from: -Infinity, days: Infinity }], now), false);
    assert.equal(finalWindow(365), 7 * dayMs);
    assert.equal(finalWindow(14), 3.5 * dayMs);
    assert.equal(finalWindow(1), dayMs / 4);
});

test('saving a period: longer applies now, shorter waits a week unless applied now', () => {
    const now = 100 * dayMs,
        at = now + 3 * dayMs;
    const save = (current, value, options = {}) => nextPolicy(current, value, { now, ...options });
    assert.deepEqual(save(policy(30), 60), policy(60));
    assert.deepEqual(save(policy(30), 0), policy(0));
    // Saving the period in force cancels a pending change.
    assert.deepEqual(save(policy(30, 14, at), 30), policy(30));
    assert.deepEqual(save(forever, 30), policy(0, 30, now + noticeMs));
    // A milder change keeps the announced date; a stricter one restarts the notice.
    assert.deepEqual(save(policy(0, 14, at), 30), policy(0, 30, at));
    assert.deepEqual(save(policy(0, 30, at), 14), policy(0, 14, now + noticeMs));
    assert.deepEqual(save(forever, 30, { applyNow: true }), policy(30));
    // A channel following the server default compares against the default in force.
    assert.deepEqual(save(policy(365), null, { inherited: 30 }), policy(365, null, now + noticeMs));
    assert.deepEqual(save(policy(365), null, { inherited: 0 }), policy(null));
    // A change whose date has passed is the period in force.
    assert.deepEqual(save(policy(0, 14, now - 1), 30), policy(30));
});

test('storage sizes and quotas read as plain amounts', () => {
    assert.equal(formatBytes(0), '0 bytes');
    assert.equal(formatBytes(1), '1 byte');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(10 * 1024 * 1024), '10 MB');
    assert.equal(formatBytes(3.14 * gigabyte), '3.1 GB');
    assert.equal(formatStorageQuota(1_000_000 * gigabyte), '1,000,000 GB');
    for (const bytes of [0, gigabyte, 1_000_000 * gigabyte])
        assert.equal(isStorageQuota(bytes), true);
    for (const bytes of [-gigabyte, gigabyte + 1, 1_000_001 * gigabyte, '1', null])
        assert.equal(isStorageQuota(bytes), false);
});

test('members see the period, coming changes and deletion dates in plain words', () => {
    // Local noon keeps the dates stable in every time zone.
    const now = new Date(2026, 9, 21, 12).getTime();
    const day = (offset) => now + offset * dayMs;
    const state = (server, dm = forever, channel = {}) => ({
        retention: { server, dm },
        channels: [{ id: 'general', ...channel }],
    });
    assert.equal(conversationSchedule(state(forever), 'missing'), null);
    const forEver = conversationSchedule(state(forever), 'general');
    assert.equal(retentionChip(forEver, now, false), null);
    assert.equal(messageRetention(forEver, { since: now, kept: false }, now, false, now), null);
    assert.equal(unpinText(forEver, { since: now, kept: false }, now), null);

    const month = conversationSchedule(state(policy(30)), 'general');
    assert.deepEqual(retentionChip(month, now, false), {
        label: '1 month',
        title: 'Messages here are deleted 1 month after they’re posted. Pinned messages are kept.',
    });
    assert.deepEqual(
        messageRetention(month, { since: day(-25), kept: false }, day(-25), false, now),
        { title: 'Posted Sep 26 · deleted Oct 26 unless pinned', ending: true },
    );
    assert.equal(
        messageRetention(month, { since: day(-10), kept: false }, day(-10), false, now).ending,
        false,
    );
    assert.deepEqual(messageRetention(month, { since: now, kept: false }, now, true, now), {
        title: 'Pinned · kept permanently',
        ending: false,
    });
    assert.equal(
        messageRetention(month, { since: now, kept: true }, now, false, now).title,
        'Posted Oct 21 · kept while its thread has a pinned message',
    );
    assert.equal(
        unpinText(month, { since: now, kept: false }, now),
        'Unpinned. It will be deleted on Nov 20.',
    );
    assert.equal(
        unpinText(month, { since: now, kept: true }, now),
        'Unpinned. Its thread stays, as another message in it is pinned.',
    );

    const coming = conversationSchedule(state(policy(0, 14, day(7))), 'general');
    assert.deepEqual(retentionChip(coming, now, false), {
        label: '2 weeks from Oct 28',
        title: 'Messages here are kept forever for now. From Oct 28, they’re deleted 2 weeks after posting. Pinned messages are kept.',
    });
    assert.deepEqual(retentionNotice(coming, now, false, true), {
        source: 'server',
        at: day(7),
        text: 'From Oct 28, messages here older than 2 weeks will be deleted. Pin anything you want to keep.',
    });
    const direct = conversationSchedule(state(forever, policy(0, 30, day(7))), 'dm:a:b');
    assert.equal(
        retentionNotice(direct, now, true, false).text,
        'From Oct 28, direct messages older than 1 month will be deleted. Pinned messages are kept.',
    );
    assert.equal(retentionNotice(month, now, false, true), null);
    // Dates in another year say which.
    assert.equal(
        unpinText(conversationSchedule(state(policy(365)), 'general'), { since: now }, now),
        'Unpinned. It will be deleted on Oct 21, 2027.',
    );
});

test('keeping text splits schedules, so files and text expire separately', () => {
    const now = 100 * dayMs,
        until = now + 7 * dayMs;
    const kept = { server: policy(30), dm: forever, keepText: true, keepTextUntil: null };
    assert.deepEqual(retentionSchedule(kept, { retention: null }), [
        { from: -Infinity, days: 30, source: 'server', keepText: true },
    ]);
    const ending = retentionSchedule({ ...kept, keepTextUntil: until }, { retention: null });
    assert.deepEqual(ending, [
        { from: -Infinity, days: 30, source: 'server', keepText: true },
        { from: until, days: 30, source: 'server', keepText: false },
    ]);
    const unit = (since) => ({ since, kept: false, pollEnds: null });
    const forEver = retentionSchedule(kept, { retention: null });
    assert.equal(deletionTime(forEver, unit(now), { text: true }), null);
    assert.equal(deletionTime(forEver, unit(now)), now + 30 * dayMs);
    assert.equal(expiryCutoff(forEver, now, { text: true }), -Infinity);
    // Once text is no longer kept, old messages go when that starts.
    assert.equal(deletionTime(ending, unit(now - 40 * dayMs), { text: true }), until);
    assert.equal(deletionTime(ending, unit(now), { text: true }), now + 30 * dayMs);
    for (let since = now - 60 * dayMs; since <= now + 40 * dayMs; since += 2 * dayMs + 11)
        for (const time of [now, until, until + 20 * dayMs])
            for (const text of [true, false]) {
                const at = deletionTime(ending, unit(since), { text });
                assert.equal(
                    at !== null && at <= time,
                    since <= expiryCutoff(ending, time, { text }),
                    `${since} at ${time}`,
                );
            }
    assert.equal(upcomingChange(ending, now).kind, 'text');
    // A shorter period while text is kept only removes files sooner.
    const sooner = retentionSchedule(
        { ...kept, server: policy(30, 14, until) },
        { retention: null },
    );
    assert.equal(upcomingChange(sooner, now).kind, 'files');
    // Nothing is announced where messages are kept forever anyway.
    assert.equal(
        upcomingChange(retentionSchedule({ ...kept, keepTextUntil: until }, { retention: 0 }), now),
        null,
    );
});

test('keeping text applies at once; no longer keeping it waits a week unless applied now', () => {
    const now = 100 * dayMs,
        at = now + 3 * dayMs;
    const mode = (keepText, keepTextUntil = null) => ({ keepText, keepTextUntil });
    assert.deepEqual(nextKeepText(mode(false), true, { now }), mode(true));
    assert.deepEqual(nextKeepText(mode(true), false, { now }), mode(true, now + noticeMs));
    assert.deepEqual(nextKeepText(mode(true, at), false, { now }), mode(true, at));
    assert.deepEqual(nextKeepText(mode(true, at), true, { now }), mode(true));
    assert.deepEqual(nextKeepText(mode(true), false, { now, applyNow: true }), mode(false));
    assert.deepEqual(nextKeepText(mode(false), false, { now }), mode(false));
    assert.deepEqual(nextKeepText(mode(true, now - 1), false, { now }), mode(false));
});

test('with text kept, members are told about files, and text-only messages show nothing', () => {
    const now = new Date(2026, 9, 21, 12).getTime();
    const day = (offset) => now + offset * dayMs;
    const state = (keepTextUntil = null, server = policy(30)) => ({
        retention: { server, dm: forever, keepText: true, keepTextUntil },
        channels: [{ id: 'general' }],
    });
    const kept = conversationSchedule(state(), 'general');
    assert.deepEqual(retentionChip(kept, now, false), {
        label: 'Files · 1 month',
        title: 'Files here are removed 1 month after they’re posted; the messages are kept. Pinned messages keep their files.',
    });
    assert.equal(periodLabel(kept, now), 'Files · 1 month');
    const old = { since: day(-25), kept: false, pollEnds: null };
    assert.equal(messageRetention(kept, old, day(-25), false, now, false), null);
    assert.equal(messageRetention(kept, old, day(-25), true, now, false), null);
    assert.deepEqual(messageRetention(kept, old, day(-25), false, now, true), {
        title: 'Posted Sep 26 · files removed Oct 26 unless pinned',
        ending: true,
    });
    assert.equal(pinKeeps(kept, old, now, false), false);
    assert.equal(pinKeeps(kept, old, now, true), true);
    const fresh = { since: now, kept: false, pollEnds: null };
    assert.equal(unpinText(kept, fresh, now, false), null);
    assert.equal(
        unpinText(kept, fresh, now, true),
        'Unpinned. Its files will be removed on Nov 20.',
    );
    // Text kept only until Oct 28.
    const ending = conversationSchedule(state(day(7)), 'general');
    assert.deepEqual(retentionChip(ending, now, false), {
        label: '1 month from Oct 28',
        title: 'Files here are removed 1 month after they’re posted; the messages are kept. From Oct 28, messages are deleted too, 1 month after posting. Pinned messages are kept.',
    });
    assert.deepEqual(retentionNotice(ending, now, false, true), {
        source: 'keep-text',
        at: day(7),
        text: 'From Oct 28, messages here older than 1 month will be deleted, not just their files. Pin anything you want to keep.',
    });
    assert.equal(
        messageRetention(ending, old, day(-25), false, now, true).title,
        'Posted Sep 26 · files removed Oct 26, deleted Oct 28 unless pinned',
    );
    assert.equal(
        messageRetention(ending, old, day(-25), false, now, false).title,
        'Posted Sep 26 · deleted Oct 28 unless pinned',
    );
    const shorter = conversationSchedule(state(null, policy(30, 14, day(7))), 'general');
    assert.equal(
        retentionNotice(shorter, now, false, false).text,
        'From Oct 28, files here older than 2 weeks will be removed. Pinned messages are kept.',
    );
    assert.equal(
        hasFiles({ attachments: [{ id: 'a', name: 'a', mime: 'x', removed: true }] }),
        false,
    );
    assert.equal(hasFiles({ attachments: [], previews: [{}] }), true);
});
