import { canonicalRoom } from '../shared/rooms.js';
import { check, route } from './policies.js';
import { transaction } from './database.js';

// Invitations are ordinary direct messages; this table adds the join-card metadata.
export function registerVoiceInvitations({
    app,
    db,
    get,
    all,
    run,
    canJoin,
    requirePermission,
    canInRoom,
    messageView,
    emitRoom,
    io,
}) {
    const channelFor = (req) => {
        const channel = get('SELECT * FROM channels WHERE id=?', req.params.id);
        check(canJoin(req.user, channel), 'Voice channel unavailable', 403);
        requirePermission(req.user, 'calls.start');
        return channel;
    };
    app.get(
        '/api/voice-channels/:id/invitees',
        route((req, res) => {
            const channel = channelFor(req);
            // Evaluate each member's own channel permissions, including private-channel overrides.
            const users = all('SELECT * FROM users WHERE banned=0 AND id<>?', req.user.id)
                .filter((user) => canJoin(user, channel))
                .map((user) => user.id);
            const sent = all(
                `SELECT v.recipient FROM voice_channel_invitations v JOIN messages m ON m.id=v.message
            WHERE v.channel=? AND m.author=? AND m.created>?`,
                channel.id,
                req.user.id,
                Date.now() - 120000,
            ).map((invite) => invite.recipient);
            res.json({ users, sent });
        }),
    );
    app.post(
        '/api/voice-channels/:id/invite',
        route((req, res) => {
            const channel = channelFor(req);
            check(typeof req.body.user === 'string', 'Choose a member');
            const requestId = req.body.requestId;
            check(
                typeof requestId === 'string' &&
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        requestId,
                    ),
                'Invalid invitation request',
            );
            const target = get('SELECT * FROM users WHERE id=? AND banned=0', req.body.user);
            check(
                target && target.id !== req.user.id && canJoin(target, channel),
                'That member cannot join this voice channel',
                403,
            );
            const room = canonicalRoom(`dm:${req.user.id}:${target.id}`);
            check(
                canInRoom(req.user, room, 'messages.send'),
                'Cannot send a message to this member',
                403,
            );
            // Each opening uses a new request ID. Retrying a send reuses its ID.
            const existing = get(
                `SELECT m.* FROM messages m JOIN voice_channel_invitations v ON v.message=m.id
                WHERE m.id=? AND v.channel=? AND v.recipient=? AND m.author=?`,
                requestId,
                channel.id,
                target.id,
                req.user.id,
            );
            if (existing) {
                res.json(messageView(existing));
                return;
            }
            check(
                !get('SELECT id FROM messages WHERE id=?', requestId),
                'Invitation request already used',
                409,
            );
            check(
                ![...io.sockets.sockets.values()].some(
                    (socket) =>
                        socket.data.user.id === target.id && socket.data.call === channel.id,
                ),
                'That member is already in this channel',
                409,
            );
            const id = requestId;
            transaction(db, () => {
                const now = Date.now();
                run(
                    'INSERT INTO messages(id,room,author,body,created,since) VALUES(?,?,?,?,?,?)',
                    id,
                    room,
                    req.user.id,
                    `Invitation to voice channel ${channel.name}`,
                    now,
                    now,
                );
                run(
                    'INSERT INTO voice_channel_invitations(message,channel,name,recipient) VALUES(?,?,?,?)',
                    id,
                    channel.id,
                    channel.name,
                    target.id,
                );
            });
            const message = messageView(get('SELECT * FROM messages WHERE id=?', id));
            emitRoom(room, 'message', message);
            io.emit('refresh');
            res.json(message);
        }),
    );
}
