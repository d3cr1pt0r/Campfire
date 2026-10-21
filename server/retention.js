import { setImmediate as yieldToChat } from 'node:timers/promises';
import { check, route } from './policies.js';
import { transaction } from './database.js';
import {
    expiryCutoff,
    isRetentionDays,
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
const none = { messages: 0, bytes: 0 };

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
    const policies = () =>
        Object.fromEntries(
            all('SELECT scope,retention,retentionNext,retentionAt FROM retention_policies').map(
                ({ scope, ...policy }) => [scope, policy],
            ),
        );
    const channelRooms = () =>
        all("SELECT id,name,retention,retentionNext,retentionAt FROM channels WHERE kind='text'");
    const channelTarget = (channel) => ({ rooms: 'r.room=?', params: [channel.id] });
    const dmTarget = { rooms: dmRooms, params: [] };
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
        ].some((result) => result.changes > 0);
        if (promoted) publishChannels();
        let deleted = 0;
        for (const target of targets(policies())) {
            const cutoff = expiryCutoff(target.schedule, now);
            if (cutoff === -Infinity) continue;
            for (;;) {
                if (closed) return deleted;
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
        }
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
    const save = (target, value, applyNow) => {
        const next = change(target, value, applyNow);
        if (target.channel)
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
        // A period that applies now deletes what is already past it straight away.
        if (next.retentionAt === null) void sweep().catch(() => {});
        return next;
    };
    // What would go by time under a schedule, counting replies and attachment bytes.
    const doomed = (target, schedule, time) => {
        const cutoff = expiryCutoff(schedule, time);
        if (cutoff === -Infinity) return none;
        return get(
            `WITH units AS (${expired(target.rooms)}),
            doomed AS (SELECT id FROM messages WHERE id IN (SELECT id FROM units) OR thread IN (SELECT id FROM units))
            SELECT (SELECT COUNT(*) FROM doomed) messages,
            (SELECT COALESCE(SUM(bytes),0) FROM attachments WHERE message IN (SELECT id FROM doomed)) bytes`,
            ...target.params,
            cutoff,
            cutoff,
            time,
            time,
        );
    };
    // The messages a change deletes beyond what the current periods would by the same time.
    const preview = (target, value) => {
        const now = Date.now();
        const current = policies();
        const scheduled = change(target, value, false);
        if (scheduled.retentionAt === null) return { at: null, scheduled: none, immediate: none };
        const affected = (next) => {
            if (target.channel)
                return [
                    {
                        ...channelTarget(target.channel),
                        before: retentionSchedule(current, target.channel),
                        after: retentionSchedule(current, next),
                    },
                ];
            if (target.scope === 'dm')
                return [
                    {
                        ...dmTarget,
                        before: retentionSchedule(current, null),
                        after: retentionSchedule({ ...current, dm: next }, null),
                    },
                ];
            return channelRooms().map((channel) => ({
                ...channelTarget(channel),
                before: retentionSchedule(current, channel),
                after: retentionSchedule({ ...current, server: next }, channel),
            }));
        };
        const total = (next, time) =>
            affected(next).reduce(
                (sum, target) => {
                    const after = doomed(target, target.after, time),
                        before = doomed(target, target.before, time);
                    return {
                        messages: sum.messages + Math.max(0, after.messages - before.messages),
                        bytes: sum.bytes + Math.max(0, after.bytes - before.bytes),
                    };
                },
                { ...none },
            );
        return {
            at: scheduled.retentionAt,
            scheduled: total(scheduled, scheduled.retentionAt),
            immediate: total(change(target, value, true), now),
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
            const { scope, channel, retention } = req.query;
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
                'SELECT m.room,SUM(a.bytes) bytes,COUNT(*) files FROM attachments a JOIN messages m ON m.id=a.message GROUP BY m.room ORDER BY bytes DESC',
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
                    WHERE m.id IN (SELECT id FROM kept) OR m.thread IN (SELECT id FROM kept)`,
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
