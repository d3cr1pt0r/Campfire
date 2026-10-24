import { canonicalRoom } from '../shared/rooms.js';
import { check, route } from './policies.js';
import { forViewer } from './poll-view.js';

const modes = ['all', 'mentions', 'muted'];
function preferences(value) {
    check(
        value && typeof value === 'object' && !Array.isArray(value),
        'Invalid notification settings',
    );
    check(
        typeof value.muted === 'boolean' && typeof value.directMessages === 'boolean',
        'Invalid notification settings',
    );
    check(modes.includes(value.defaultMode), 'Invalid notification mode');
    const overrides = (entries) => {
        check(
            entries && typeof entries === 'object' && !Array.isArray(entries),
            'Invalid notification overrides',
        );
        check(Object.keys(entries).length <= 10000, 'Too many notification overrides');
        return Object.fromEntries(
            Object.entries(entries).map(([id, mode]) => {
                check(
                    id.length > 0 && id.length <= 250 && modes.includes(mode),
                    'Invalid notification override',
                );
                return [id, mode];
            }),
        );
    };
    return {
        muted: value.muted,
        directMessages: value.directMessages,
        defaultMode: value.defaultMode,
        channels: overrides(value.channels),
        categories: overrides(value.categories),
    };
}

export function createActivity({ app, io, get, all, run, hasRoom, userFor, messageView }) {
    const snapshot = (user) => {
        const baseline =
            get('SELECT sequence FROM activity_baselines WHERE user=?', user.id)?.sequence ?? 0;
        const unread = {},
            latest = {},
            latestReactions = {};
        const rooms = all(
            `SELECT m.room,MAX(a.sequence) latest,
            SUM(CASE WHEN m.author IS NOT NULL AND m.author<>? AND seen.message IS NULL AND a.sequence>MAX(?,COALESCE(r.sequence,0),COALESCE(c.sequence,0)) THEN 1 ELSE 0 END) unread
            FROM message_activity a JOIN messages m ON m.id=a.message
            LEFT JOIN conversation_reads r ON r.user=? AND r.room=m.room AND r.thread=COALESCE(m.thread,'')
            LEFT JOIN conversation_reads c ON c.user=? AND c.room=m.room AND c.thread='*'
            LEFT JOIN activity_acknowledgments seen ON seen.user=? AND seen.message=m.id
            GROUP BY m.room`,
            user.id,
            baseline,
            user.id,
            user.id,
            user.id,
        );
        for (const room of rooms) {
            if (!hasRoom(user, room.room)) continue;
            latest[room.room] = room.latest;
            if (room.unread) unread[room.room] = room.unread;
        }
        for (const room of all(
            `SELECT m.room,MAX(n.sequence) latest,
            SUM(CASE WHEN n.acknowledged=0 THEN 1 ELSE 0 END) unread
            FROM reaction_notifications n JOIN messages m ON m.id=n.message
            WHERE n.recipient=? GROUP BY m.room`,
            user.id,
        )) {
            if (!hasRoom(user, room.room)) continue;
            latestReactions[room.room] = room.latest;
            if (room.unread) unread[room.room] = (unread[room.room] ?? 0) + room.unread;
        }
        return {
            version: get('SELECT version FROM activity_version WHERE id=1').version,
            unread,
            latest,
            latestReactions,
        };
    };
    const publish = (room, onlyUser) => {
        const snapshots = new Map();
        for (const socket of io.sockets.sockets.values()) {
            const user = userFor(socket.data.token);
            if (!user || (onlyUser && user.id !== onlyUser) || (room && !hasRoom(user, room)))
                continue;
            if (!snapshots.has(user.id)) snapshots.set(user.id, snapshot(user));
            socket.emit('activity', snapshots.get(user.id));
        }
    };
    const savedPreferences = (id) => {
        const row = get('SELECT settings FROM notification_preferences WHERE user=?', id);
        return row ? JSON.parse(row.settings) : null;
    };
    const reactionCutoff = (value = 0) => {
        check(Number.isSafeInteger(value) && value >= 0, 'Invalid reaction read position');
        check(
            value <=
                (get("SELECT seq FROM sqlite_sequence WHERE name='reaction_notifications'")?.seq ??
                    0),
            'Unknown reaction read position',
            404,
        );
        return value;
    };
    app.get(
        '/api/activity',
        route((req, res) => res.set('Cache-Control', 'no-store').json(snapshot(req.user))),
    );
    app.get(
        '/api/activity/next',
        route((req, res) => {
            const room = canonicalRoom(req.query.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            let message = get(
                `SELECT m.* FROM message_activity a JOIN messages m ON m.id=a.message
            LEFT JOIN conversation_reads r ON r.user=? AND r.room=m.room AND r.thread=COALESCE(m.thread,'')
            LEFT JOIN conversation_reads c ON c.user=? AND c.room=m.room AND c.thread='*'
            LEFT JOIN activity_acknowledgments seen ON seen.user=? AND seen.message=m.id
            WHERE m.room=? AND m.author IS NOT NULL AND m.author<>? AND seen.message IS NULL
            AND a.sequence>MAX(COALESCE((SELECT sequence FROM activity_baselines WHERE user=?),0),COALESCE(r.sequence,0),COALESCE(c.sequence,0))
            ORDER BY a.sequence DESC LIMIT 1`,
                req.user.id,
                req.user.id,
                req.user.id,
                room,
                req.user.id,
                req.user.id,
            );
            const reaction = get(
                `SELECT n.* FROM reaction_notifications n JOIN messages m ON m.id=n.message
                WHERE n.recipient=? AND n.acknowledged=0 AND m.room=?
                ORDER BY n.sequence DESC LIMIT 1`,
                req.user.id,
                room,
            );
            let reactionsThrough;
            // Message sequence at reaction time orders both activity types without
            // depending on wall-clock time or changing the message's own sequence.
            if (
                reaction &&
                (!message ||
                    reaction.after_message_sequence >=
                        get('SELECT sequence FROM message_activity WHERE message=?', message.id)
                            .sequence)
            ) {
                message = get('SELECT * FROM messages WHERE id=?', reaction.message);
                reactionsThrough = reaction.sequence;
            }
            res.set('Cache-Control', 'no-store').json(
                message
                    ? {
                          message: forViewer(messageView(message), req.user.id),
                          parent: message.thread
                              ? forViewer(
                                    messageView(
                                        get('SELECT * FROM messages WHERE id=?', message.thread),
                                    ),
                                    req.user.id,
                                )
                              : null,
                          ...(reactionsThrough
                              ? {
                                    reactionsThrough,
                                    reactions: all(
                                        `SELECT DISTINCT message,emoji FROM reaction_notifications
                                        WHERE recipient=? AND message=? AND sequence<=? AND acknowledged=0`,
                                        req.user.id,
                                        message.id,
                                        reactionsThrough,
                                    ),
                                }
                              : {}),
                      }
                    : null,
            );
        }),
    );
    app.post(
        '/api/activity/acknowledge',
        route((req, res) => {
            const room = canonicalRoom(req.body?.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            check(
                typeof req.body.message === 'string' && req.body.message.length <= 100,
                'Invalid message',
            );
            const message = get(
                'SELECT id FROM messages WHERE id=? AND room=?',
                req.body.message,
                room,
            );
            check(message, 'Message not found', 404);
            const reactionsThrough = reactionCutoff(req.body.reactionsThrough);
            run(
                'INSERT OR IGNORE INTO activity_acknowledgments(user,message) VALUES(?,?)',
                req.user.id,
                message.id,
            );
            run(
                `UPDATE reaction_notifications SET acknowledged=1
                WHERE recipient=? AND message=? AND sequence<=? AND acknowledged=0`,
                req.user.id,
                message.id,
                reactionsThrough,
            );
            publish(null, req.user.id);
            res.json(snapshot(req.user));
        }),
    );
    app.post(
        '/api/activity/acknowledge-visible',
        route((req, res) => {
            const room = canonicalRoom(req.body?.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            const ids = req.body?.messages;
            check(
                Array.isArray(ids) &&
                    ids.length <= 500 &&
                    ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100),
                'Invalid visible messages',
            );
            const unique = [...new Set(ids)];
            const reactionsThrough = reactionCutoff(req.body.reactionsThrough);
            // Match the notification queue, then acknowledge only this viewport's
            // IDs in one statement. Offscreen and later arrivals stay pending.
            const acknowledged = unique.length
                ? all(
                      `INSERT OR IGNORE INTO activity_acknowledgments(user,message)
                 SELECT ?,m.id FROM message_activity a JOIN messages m ON m.id=a.message
                 LEFT JOIN conversation_reads r ON r.user=? AND r.room=m.room AND r.thread=COALESCE(m.thread,'')
                 LEFT JOIN conversation_reads c ON c.user=? AND c.room=m.room AND c.thread='*'
                 LEFT JOIN activity_acknowledgments seen ON seen.user=? AND seen.message=m.id
                 WHERE m.room=? AND m.id IN (${unique.map(() => '?').join(',')})
                 AND m.author IS NOT NULL AND m.author<>? AND seen.message IS NULL
                 AND a.sequence>MAX(COALESCE((SELECT sequence FROM activity_baselines WHERE user=?),0),COALESCE(r.sequence,0),COALESCE(c.sequence,0))
                 RETURNING message`,
                      req.user.id,
                      req.user.id,
                      req.user.id,
                      req.user.id,
                      room,
                      ...unique,
                      req.user.id,
                      req.user.id,
                  ).map((row) => row.message)
                : [];
            const reactions =
                unique.length && reactionsThrough
                    ? all(
                          `UPDATE reaction_notifications SET acknowledged=1
                      WHERE recipient=? AND sequence<=? AND acknowledged=0
                      AND message IN (SELECT id FROM messages WHERE room=? AND id IN (${unique.map(() => '?').join(',')}))
                      RETURNING message,emoji`,
                          req.user.id,
                          reactionsThrough,
                          room,
                          ...unique,
                      )
                    : [];
            const messages = [
                ...new Set([...acknowledged, ...reactions.map((row) => row.message)]),
            ];
            if (messages.length) publish(null, req.user.id);
            res.json({ ...snapshot(req.user), messages, reactions });
        }),
    );
    app.post(
        '/api/activity/read',
        route((req, res) => {
            const room = canonicalRoom(req.body?.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            const { through, thread = null, all: entireConversation = false } = req.body;
            const reactionsThrough = reactionCutoff(req.body.reactionsThrough);
            check(Number.isSafeInteger(through) && through > 0, 'Invalid read position');
            check(typeof entireConversation === 'boolean', 'Invalid read scope');
            check(
                thread === null ||
                    (typeof thread === 'string' && thread.length > 0 && thread.length <= 100),
                'Invalid thread',
            );
            check(!entireConversation || thread === null, 'Invalid read scope');
            // The position must refer to an actual message in the acknowledged scope. Never trust
            // a client timestamp or an arbitrary future position that could hide later messages.
            const message = get(
                'SELECT m.thread FROM message_activity a JOIN messages m ON m.id=a.message WHERE a.sequence=? AND m.room=?',
                through,
                room,
            );
            // A menu's latest message can be deleted before Clear is clicked. An issued,
            // now-deleted sequence is still a safe cutoff: later arrivals have higher numbers.
            const deletedCutoff =
                entireConversation &&
                !message &&
                through <=
                    (get("SELECT seq FROM sqlite_sequence WHERE name='message_activity'")?.seq ??
                        0) &&
                !get('SELECT 1 FROM message_activity WHERE sequence=?', through);
            check(
                deletedCutoff ||
                    (message && (entireConversation || (message.thread ?? null) === thread)),
                'Unknown read position',
                404,
            );
            const scope = entireConversation ? '*' : (thread ?? '');
            run(
                `INSERT INTO conversation_reads(user,room,thread,sequence) VALUES(?,?,?,?)
            ON CONFLICT(user,room,thread) DO UPDATE SET sequence=excluded.sequence WHERE excluded.sequence>conversation_reads.sequence`,
                req.user.id,
                room,
                scope,
                through,
            );
            run(
                `UPDATE reaction_notifications SET acknowledged=1
                WHERE recipient=? AND sequence<=? AND acknowledged=0
                AND message IN (SELECT id FROM messages WHERE room=? AND (?=1 OR thread IS ?))`,
                req.user.id,
                reactionsThrough,
                room,
                entireConversation ? 1 : 0,
                thread,
            );
            publish(null, req.user.id);
            res.json(snapshot(req.user));
        }),
    );
    app.get(
        '/api/notification-preferences',
        route((req, res) =>
            res.set('Cache-Control', 'no-store').json(savedPreferences(req.user.id)),
        ),
    );
    const save = (importOnly) =>
        route((req, res) => {
            const value = preferences(req.body);
            run(
                importOnly
                    ? 'INSERT OR IGNORE INTO notification_preferences(user,settings) VALUES(?,?)'
                    : 'INSERT INTO notification_preferences(user,settings) VALUES(?,?) ON CONFLICT(user) DO UPDATE SET settings=excluded.settings',
                req.user.id,
                JSON.stringify(value),
            );
            const saved = savedPreferences(req.user.id);
            for (const socket of io.sockets.sockets.values()) {
                if (userFor(socket.data.token)?.id === req.user.id)
                    socket.emit('notification-preferences', saved);
            }
            res.json(saved);
        });
    app.post('/api/notification-preferences/import', save(true));
    app.put('/api/notification-preferences', save(false));
    return { snapshot, publish, savedPreferences };
}
