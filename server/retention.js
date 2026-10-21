import { setImmediate as yieldToChat } from 'node:timers/promises';
import { check, route } from './policies.js';
import { transaction } from './database.js';
import {
    expiryCutoff,
    isRetentionDays,
    nextKeepText,
    nextPolicy,
    retentionSchedule,
    settlePolicy,
} from '../shared/retention.js';

const hour = 3600000;
const batch = 100;
// DM rooms are dm:<id>:<id>; ';' sorts right after ':', so this range is every DM.
const dmRooms = "r.room>='dm:' AND r.room<'dm;'";
// Top-level messages whose whole thread is past the cutoff, with no pin and no running poll.
// Parameters: the rooms', then cutoff, cutoff, time, time.
const expired = (rooms) => `SELECT r.id,r.room FROM messages r INDEXED BY messages_expiry
    WHERE ${rooms} AND r.thread IS NULL AND r.pinned=0 AND r.since<=?
    AND NOT EXISTS(SELECT 1 FROM messages c WHERE c.thread=r.id AND (c.pinned=1 OR c.since>?))
    AND NOT EXISTS(SELECT 1 FROM polls p WHERE p.message=r.id AND p.ends>?)
    AND NOT EXISTS(SELECT 1 FROM messages c JOIN polls p ON p.message=c.id WHERE c.thread=r.id AND p.ends>?)`;
// Threads that still have files or link cards, with their clock: the only ones a period that
// keeps text has anything left to remove from.
const withFiles = `WITH units(id) AS (
        SELECT COALESCE(m.thread,m.id) FROM attachments a JOIN messages m ON m.id=a.message WHERE a.removed IS NULL
        UNION SELECT COALESCE(m.thread,m.id) FROM message_link_previews l JOIN messages m ON m.id=l.message)
    SELECT r.id,r.room,MAX(x.since) since,MAX(x.pinned) kept,MAX(p.ends) pollEnds
    FROM units u JOIN messages r ON r.id=u.id JOIN messages x ON x.id=u.id OR x.thread=u.id
    LEFT JOIN polls p ON p.message=x.id GROUP BY r.id`;
// A thread's messages, for a list of thread ids given twice.
const threadMessages = (count) => {
    const marks = Array(count).fill('?').join(',');
    return `SELECT id FROM messages WHERE id IN (${marks}) OR thread IN (${marks})`;
};
const none = { messages: 0, files: 0, bytes: 0 };

export function registerRetention({
    app,
    db,
    get,
    all,
    run,
    requirePermission,
    canInChannel,
    publishChannels,
    emitRoom,
    previews,
    storageQuota,
}) {
    const mode = () => {
        const row = get('SELECT keepText,keepTextUntil FROM retention_mode WHERE id=1');
        return { keepText: !!row.keepText, keepTextUntil: row.keepTextUntil };
    };
    const policies = () => ({
        ...Object.fromEntries(
            all('SELECT scope,retention,retentionNext,retentionAt FROM retention_policies').map(
                ({ scope, ...policy }) => [scope, policy],
            ),
        ),
        ...mode(),
    });
    const channelRooms = () =>
        all("SELECT id,name,retention,retentionNext,retentionAt FROM channels WHERE kind='text'");
    const channelTarget = (channel) => ({
        room: channel.id,
        rooms: 'r.room=?',
        params: [channel.id],
    });
    const dmTarget = { room: null, rooms: dmRooms, params: [] };
    const targets = (current) => [
        ...channelRooms().map((channel) => ({
            ...channelTarget(channel),
            schedule: retentionSchedule(current, channel),
        })),
        { ...dmTarget, schedule: retentionSchedule(current, null) },
    ];
    const freePages = () => get('PRAGMA freelist_count').freelist_count;
    // Gives freed pages back to the disk a little at a time, so chat never waits long.
    const vacuum = async () => {
        for (let free = freePages(); free > 0 && !closed; ) {
            db.exec('PRAGMA incremental_vacuum(512)');
            const left = freePages();
            if (left >= free) break;
            free = left;
            await yieldToChat();
        }
    };
    let closed = false;
    // Deletes whole threads past their period.
    const expire = async (target, cutoff, now) => {
        let deleted = 0;
        while (!closed) {
            // Deleting a thread's first message removes its replies, files and the rest.
            const rows = transaction(db, () => {
                const found = all(
                    `${expired(target.rooms)} LIMIT ${batch}`,
                    ...target.params,
                    cutoff,
                    cutoff,
                    now,
                    now,
                );
                if (found.length)
                    run(
                        `DELETE FROM messages WHERE id IN (${found.map(() => '?').join(',')})`,
                        ...found.map((row) => row.id),
                    );
                return found;
            });
            for (const [room, gone] of Map.groupBy(rows, (row) => row.room))
                emitRoom(room, 'messages:expired', { room, ids: gone.map((row) => row.id) });
            deleted += rows.length;
            if (rows.length < batch) break;
            await yieldToChat();
        }
        return deleted;
    };
    // Removes files and link cards from threads past their period, keeping the text. Each
    // file leaves its name and type behind as a placeholder.
    const strip = async (cutoffs, now) => {
        const due = all(withFiles).filter((unit) => {
            const cutoff = cutoffs.get(unit.room.startsWith('dm:') ? null : unit.room);
            return (
                cutoff !== undefined && !unit.kept && unit.since <= cutoff && !(unit.pollEnds > now)
            );
        });
        for (let start = 0; start < due.length && !closed; start += batch) {
            const rows = due.slice(start, start + batch),
                ids = rows.map((row) => row.id);
            const scope = threadMessages(ids.length),
                params = [...ids, ...ids];
            const files = `SELECT id FROM attachments WHERE removed IS NULL AND message IN (${scope})`;
            transaction(db, () => {
                run(`DELETE FROM attachment_images WHERE attachment IN (${files})`, ...params);
                run(`DELETE FROM attachment_previews WHERE attachment IN (${files})`, ...params);
                run(
                    `UPDATE attachments SET data=x'',bytes=0,removed=? WHERE removed IS NULL AND message IN (${scope})`,
                    now,
                    ...params,
                );
                // Hidden, so editing the text later doesn't bring the cards back.
                run(
                    `INSERT OR IGNORE INTO hidden_link_previews(message) SELECT DISTINCT message FROM message_link_previews WHERE message IN (${scope})`,
                    ...params,
                );
                run(`DELETE FROM message_link_previews WHERE message IN (${scope})`, ...params);
            });
            for (const [room, done] of Map.groupBy(rows, (row) => row.room))
                emitRoom(room, 'messages:files-removed', { room, ids: done.map((row) => row.id) });
            await yieldToChat();
        }
    };
    const pass = async (now) => {
        const promoted = [
            run(
                'UPDATE retention_policies SET retention=retentionNext,retentionNext=NULL,retentionAt=NULL WHERE retentionAt<=?',
                now,
            ),
            run(
                'UPDATE channels SET retention=retentionNext,retentionNext=NULL,retentionAt=NULL WHERE retentionAt<=?',
                now,
            ),
            run(
                'UPDATE retention_mode SET keepText=0,keepTextUntil=NULL WHERE keepTextUntil<=?',
                now,
            ),
        ].some((result) => result.changes > 0);
        if (promoted) publishChannels();
        const current = policies();
        let deleted = 0;
        const cutoffs = new Map();
        for (const target of targets(current)) {
            cutoffs.set(target.room, expiryCutoff(target.schedule, now));
            const cutoff = expiryCutoff(target.schedule, now, { text: true });
            if (cutoff !== -Infinity) deleted += await expire(target, cutoff, now);
            if (closed) return deleted;
        }
        // Without keepText, threads past their period were deleted whole above.
        if (current.keepText) await strip(cutoffs, now);
        previews?.prune();
        await vacuum();
        return deleted;
    };
    let running = Promise.resolve();
    // One pass at a time; resolves to the number of threads it deleted.
    const sweep = (now) => {
        const result = running.then(() => (closed ? 0 : pass(now ?? Date.now())));
        running = result.catch((error) => console.error(error));
        return result;
    };
    void sweep().catch(() => {});
    const timer = setInterval(() => void sweep().catch(() => {}), hour);
    timer.unref();

    // A saved change: the channel row, or the server or DM scope.
    const change = (target, value, applyNow) => {
        const now = Date.now();
        const current = policies();
        const policy = target.channel ?? current[target.scope];
        return nextPolicy(policy, value, {
            now,
            applyNow,
            inherited: settlePolicy(current.server, now).retention,
        });
    };
    // What happens on save, for the policies or for keepText; see the saving rules in
    // shared/retention.js.
    const changeFor = (target, value, applyNow) =>
        target.keepText
            ? nextKeepText(mode(), value, { now: Date.now(), applyNow })
            : change(target, value, applyNow);
    const pending = (target, next) => (target.keepText ? next.keepTextUntil : next.retentionAt);
    const save = (target, value, applyNow) => {
        const next = changeFor(target, value, applyNow);
        if (target.keepText)
            run(
                'UPDATE retention_mode SET keepText=?,keepTextUntil=? WHERE id=1',
                Number(next.keepText),
                next.keepTextUntil,
            );
        else if (target.channel)
            run(
                'UPDATE channels SET retention=?,retentionNext=?,retentionAt=? WHERE id=?',
                next.retention,
                next.retentionNext,
                next.retentionAt,
                target.channel.id,
            );
        else
            run(
                'UPDATE retention_policies SET retention=?,retentionNext=?,retentionAt=? WHERE scope=?',
                next.retention,
                next.retentionNext,
                next.retentionAt,
                target.scope,
            );
        publishChannels();
        // A change that applies now removes what is already past it straight away.
        if (pending(target, next) === null) void sweep().catch(() => {});
        return next;
    };
    // What would go by time under a schedule: deleted messages, and the files removed with
    // them or from threads whose text is kept.
    const count = (target, schedule, time) => {
        const at = (cutoff) => {
            if (cutoff === -Infinity) return none;
            return get(
                `WITH units AS (${expired(target.rooms)}),
                doomed AS (SELECT id FROM messages WHERE id IN (SELECT id FROM units) OR thread IN (SELECT id FROM units))
                SELECT (SELECT COUNT(*) FROM doomed) messages,
                (SELECT COUNT(*) FROM attachments WHERE removed IS NULL AND message IN (SELECT id FROM doomed)) files,
                (SELECT COALESCE(SUM(bytes),0) FROM attachments WHERE message IN (SELECT id FROM doomed)) bytes`,
                ...target.params,
                cutoff,
                cutoff,
                time,
                time,
            );
        };
        const files = at(expiryCutoff(schedule, time));
        return {
            messages: at(expiryCutoff(schedule, time, { text: true })).messages,
            files: files.files,
            bytes: files.bytes,
        };
    };
    // The conversations a change affects, with their schedules before and after it.
    const compare = (current, next, target) => {
        if (target.channel)
            return [
                {
                    ...channelTarget(target.channel),
                    before: retentionSchedule(current, target.channel),
                    after: retentionSchedule(current, next),
                },
            ];
        const after = target.keepText
            ? { ...current, ...next }
            : { ...current, [target.scope]: next };
        return [
            ...(target.scope === 'dm' ? [] : channelRooms()).map((channel) => ({
                ...channelTarget(channel),
                before: retentionSchedule(current, channel),
                after: retentionSchedule(after, channel),
            })),
            ...(target.scope === 'server'
                ? []
                : [
                      {
                          ...dmTarget,
                          before: retentionSchedule(current, null),
                          after: retentionSchedule(after, null),
                      },
                  ]),
        ];
    };
    // What a change removes beyond what the current settings would by the same time.
    const preview = (target, value) => {
        const now = Date.now();
        const current = policies();
        const scheduled = changeFor(target, value, false);
        const at = pending(target, scheduled);
        if (at === null || (target.keepText && value))
            return { at: null, scheduled: none, immediate: none };
        const total = (next, time) =>
            compare(current, next, target).reduce(
                (sum, pair) => {
                    const after = count(pair, pair.after, time),
                        before = count(pair, pair.before, time);
                    return Object.fromEntries(
                        Object.keys(none).map((key) => [
                            key,
                            sum[key] + Math.max(0, after[key] - before[key]),
                        ]),
                    );
                },
                { ...none },
            );
        return {
            at,
            scheduled: total(scheduled, at),
            immediate: total(changeFor(target, value, true), now),
        };
    };

    const parseValue = (value, inherit) => {
        check(
            (inherit && value === null) || isRetentionDays(value),
            'Choose Forever or 1–3,650 days',
        );
        return value;
    };
    const parseApplyNow = (value) => {
        check(value === undefined || typeof value === 'boolean', 'Invalid apply setting');
        return value === true;
    };
    const scopeFor = (scope) => {
        check(scope === 'server' || scope === 'dm', 'Not found', 404);
        return { scope };
    };
    const channelFor = (user, id) => {
        const channel = get('SELECT * FROM channels WHERE id=?', id);
        check(channel && canInChannel(user, channel, 'channels.view'), 'Channel not found', 404);
        check(channel.kind === 'text', 'Only text channels keep messages');
        return { channel };
    };
    app.patch(
        '/api/retention/keep-text',
        route((req, res) => {
            requirePermission(req.user, 'server.edit');
            check(typeof req.body.keepText === 'boolean', 'Invalid keep text setting');
            const applyNow = parseApplyNow(req.body.applyNow);
            res.json({ ok: true, mode: save({ keepText: true }, req.body.keepText, applyNow) });
        }),
    );
    app.patch(
        '/api/retention/channels/:id',
        route((req, res) => {
            requirePermission(req.user, 'server.edit');
            const target = channelFor(req.user, req.params.id);
            const value = parseValue(req.body.retention, true);
            res.json({ ok: true, policy: save(target, value, parseApplyNow(req.body.applyNow)) });
        }),
    );
    app.patch(
        '/api/retention/:scope',
        route((req, res) => {
            requirePermission(req.user, 'server.edit');
            const target = scopeFor(req.params.scope);
            const value = parseValue(req.body.retention, false);
            res.json({ ok: true, policy: save(target, value, parseApplyNow(req.body.applyNow)) });
        }),
    );
    app.get(
        '/api/retention/preview',
        route((req, res) => {
            requirePermission(req.user, 'server.edit');
            const { scope, channel, retention, keepText } = req.query;
            if (scope === 'keep-text') {
                check(keepText === 'true' || keepText === 'false', 'Invalid keep text setting');
                res.json(preview({ keepText: true }, keepText === 'true'));
                return;
            }
            const target =
                scope === 'channel'
                    ? channelFor(req.user, String(channel))
                    : scopeFor(String(scope));
            const value =
                retention === 'default'
                    ? null
                    : /^\d{1,4}$/.test(String(retention))
                      ? Number(retention)
                      : undefined;
            res.json(preview(target, parseValue(value, !!target.channel)));
        }),
    );
    app.get(
        '/api/storage',
        route((req, res) => {
            requirePermission(req.user, 'server.edit');
            const pragma = (name) => get(`PRAGMA ${name}`)[name];
            const pageSize = pragma('page_size');
            const channels = new Map(all('SELECT * FROM channels').map((row) => [row.id, row]));
            const listed = [],
                otherChannels = { bytes: 0, files: 0 },
                directMessages = { bytes: 0, files: 0 };
            const add = (sum, row) => {
                sum.bytes += row.bytes;
                sum.files += row.files;
            };
            for (const row of all(
                'SELECT m.room,SUM(a.bytes) bytes,COUNT(*) files FROM attachments a JOIN messages m ON m.id=a.message WHERE a.removed IS NULL GROUP BY m.room ORDER BY bytes DESC',
            )) {
                const channel = channels.get(row.room);
                if (row.room.startsWith('dm:')) add(directMessages, row);
                // Channels this member can't see, and those past the top ten, are summed.
                else if (
                    channel &&
                    listed.length < 10 &&
                    canInChannel(req.user, channel, 'channels.view')
                )
                    listed.push({
                        id: channel.id,
                        name: channel.name,
                        bytes: row.bytes,
                        files: row.files,
                    });
                else add(otherChannels, row);
            }
            res.json({
                attachments: {
                    bytes: get('SELECT bytes FROM storage_usage WHERE id=1').bytes,
                    quota: storageQuota(),
                },
                database: {
                    bytes: pragma('page_count') * pageSize,
                    free: pragma('freelist_count') * pageSize,
                },
                // Pinned threads are never deleted.
                kept: get(
                    `WITH kept(id) AS (SELECT COALESCE(thread,id) FROM messages WHERE pinned=1)
                    SELECT COALESCE(SUM(a.bytes),0) bytes,COUNT(a.id) files FROM attachments a JOIN messages m ON m.id=a.message
                    WHERE a.removed IS NULL AND (m.id IN (SELECT id FROM kept) OR m.thread IN (SELECT id FROM kept))`,
                ),
                channels: listed,
                otherChannels,
                directMessages,
            });
        }),
    );
    return {
        policies,
        sweep,
        async close() {
            closed = true;
            clearInterval(timer);
            await running;
        },
    };
}
