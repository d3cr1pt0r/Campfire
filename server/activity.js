import { canonicalRoom } from '../shared/rooms.js';
import { check, route } from './policies.js';

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

export function createActivity({ app, io, get, all, run, hasRoom, userFor }) {
    const snapshot = (user) => {
        const baseline =
            get('SELECT sequence FROM activity_baselines WHERE user=?', user.id)?.sequence ?? 0;
        const unread = {},
            latest = {};
        const rooms = all(
            `SELECT m.room,MAX(a.sequence) latest,
            SUM(CASE WHEN m.author IS NOT NULL AND m.author<>? AND a.sequence>MAX(?,COALESCE(r.sequence,0),COALESCE(c.sequence,0)) THEN 1 ELSE 0 END) unread
            FROM message_activity a JOIN messages m ON m.id=a.message
            LEFT JOIN conversation_reads r ON r.user=? AND r.room=m.room AND r.thread=COALESCE(m.thread,'')
            LEFT JOIN conversation_reads c ON c.user=? AND c.room=m.room AND c.thread='*'
            GROUP BY m.room`,
            user.id,
            baseline,
            user.id,
            user.id,
        );
        for (const room of rooms) {
            if (!hasRoom(user, room.room)) continue;
            latest[room.room] = room.latest;
            if (room.unread) unread[room.room] = room.unread;
        }
        return {
            version: get('SELECT version FROM activity_version WHERE id=1').version,
            unread,
            latest,
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
    app.get(
        '/api/activity',
        route((req, res) => res.set('Cache-Control', 'no-store').json(snapshot(req.user))),
    );
    app.post(
        '/api/activity/read',
        route((req, res) => {
            const room = canonicalRoom(req.body?.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            const { through, thread = null, all: entireConversation = false } = req.body;
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
            check(
                message && (entireConversation || (message.thread ?? null) === thread),
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
