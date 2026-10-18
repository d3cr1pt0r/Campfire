import { randomUUID } from 'node:crypto';
import { check, route } from './policies.js';
import { canonicalRoom } from '../shared/rooms.js';
export function registerCalls({
    app,
    io,
    get,
    userFor,
    can,
    requirePermission,
    canWrite,
    canJoin,
    emitRoom,
    attach,
}) {
    const callState = () =>
        [...io.sockets.sockets.values()]
            .filter((s) => s.data.call)
            .map((s) => ({
                socket: s.id,
                user: s.data.user.id,
                channel: s.data.call,
                shareId: s.data.shareId || null,
                muted: !!s.data.muted,
                deafened: !!s.data.deafened,
                camera: !!s.data.camera,
            }));
    // Private call authorization and invitations live only for the active session.
    const privateCalls = new Map();
    const visibleCalls = (user) =>
        callState().filter((c) =>
            c.channel.startsWith('private:')
                ? privateCalls.get(c.channel)?.allowed.has(user)
                : canJoin(
                      get('SELECT * FROM users WHERE id=?', user),
                      get('SELECT * FROM channels WHERE id=?', c.channel),
                  ),
        );
    const privateState = (user) =>
        [...privateCalls.values()]
            .filter((c) => c.allowed.has(user))
            .map((c) => ({
                id: c.id,
                creator: c.creator,
                invited: [...c.allowed].filter((id) => !c.accepted.has(id)),
                members: [...c.accepted],
            }));
    const broadcastCalls = () => {
        for (const s of io.sockets.sockets.values()) s.emit('calls', visibleCalls(s.data.user.id));
    };
    const prunePrivateCalls = () => {
        let changed = false;
        for (const [id, room] of privateCalls) {
            const active = callState().some((c) => c.channel === id);
            if (!active && (room.started || Date.now() - room.created > 120000)) {
                privateCalls.delete(id);
                changed = true;
            } else {
                for (const [user, invitedAt] of room.pending)
                    if (Date.now() - invitedAt > 120000) {
                        room.pending.delete(user);
                        room.allowed.delete(user);
                        changed = true;
                    }
            }
        }
        for (const [key, time] of recentCalls)
            if (Date.now() - time > 60000) recentCalls.delete(key);
        if (changed) {
            broadcastCalls();
            io.emit('refresh');
        }
    };
    const callTimer = setInterval(prunePrivateCalls, 15000);
    callTimer.unref();
    const inviteUser = (caller, room, id) => {
        const target = get('SELECT * FROM users WHERE id=? AND banned=0', id);
        check(target && target.id !== caller.id, 'Choose another member of this server', 403);
        requirePermission(target, 'calls.join');
        check(
            [...io.sockets.sockets.values()].some((s) => s.data.user.id === id),
            'That member is offline',
        );
        check(!room.allowed.has(id), 'That person is already invited or in this call', 409);
        check(room.allowed.size < 8, 'This call is full (8 people maximum)');
        room.allowed.add(id);
        room.pending.set(id, Date.now());
        io.to(`user:${id}`).emit('call:invite', { id: room.id, from: caller.id });
        io.emit('refresh');
    };
    const recentCalls = new Map();
    app.post(
        '/api/calls',
        route((req, res) => {
            requirePermission(req.user, 'calls.join');
            requirePermission(req.user, 'calls.start');
            check(typeof req.body.user === 'string', 'Choose a member');
            check(
                !callState().some((c) => c.user === req.user.id),
                'Leave your current call before starting another',
            );
            const key = `${req.user.id}:${req.body.user}`;
            check(
                Date.now() - (recentCalls.get(key) || 0) > 15000,
                'Wait a few seconds before calling this member again',
                429,
            );
            check(
                [...privateCalls.values()].filter((c) => c.creator === req.user.id).length < 4,
                'Finish your existing calls first',
            );
            const id = `private:${randomUUID()}`;
            const room = {
                id,
                creator: req.user.id,
                allowed: new Set([req.user.id]),
                accepted: new Set([req.user.id]),
                pending: new Map(),
                created: Date.now(),
                started: false,
            };
            inviteUser(req.user, room, req.body.user);
            privateCalls.set(id, room);
            recentCalls.set(key, Date.now());
            io.emit('refresh');
            res.json({ id });
        }),
    );
    app.post(
        '/api/calls/:id/invite',
        route((req, res) => {
            requirePermission(req.user, 'calls.join');
            requirePermission(req.user, 'calls.start');
            const room = privateCalls.get(req.params.id);
            check(
                room && callState().some((c) => c.channel === room.id && c.user === req.user.id),
                'Join this private call before inviting members',
                403,
            );
            check(typeof req.body.user === 'string', 'Choose a member');
            inviteUser(req.user, room, req.body.user);
            res.json({ ok: true });
        }),
    );
    app.post(
        '/api/calls/:id/decline',
        route((req, res) => {
            const room = privateCalls.get(req.params.id);
            check(room?.allowed.has(req.user.id), 'Call not found', 404);
            check(
                !callState().some((c) => c.user === req.user.id && c.channel === room.id),
                'Leave the call first',
            );
            room.allowed.delete(req.user.id);
            room.accepted.delete(req.user.id);
            room.pending.delete(req.user.id);
            prunePrivateCalls();
            io.emit('refresh');
            res.json({ ok: true });
        }),
    );
    const enforceCalls = () => {
        for (const s of io.sockets.sockets.values()) {
            const u = userFor(s.data.token);
            if (u && !can(u, 'calls.share')) s.data.shareId = null;
            if (u && !can(u, 'calls.camera')) s.data.camera = false;
            if (
                s.data.call &&
                (!u ||
                    !can(u, 'calls.join') ||
                    (!s.data.call.startsWith('private:') &&
                        !canJoin(u, get('SELECT * FROM channels WHERE id=?', s.data.call))))
            ) {
                s.data.call = null;
                s.emit(
                    'call:revoked',
                    'This voice channel was deleted or your call access changed.',
                );
            }
        }
        prunePrivateCalls();
        broadcastCalls();
    };
    io.use((socket, next) => {
        const u = userFor(socket.handshake.auth.token);
        if (!u) return next(new Error('Authentication required'));
        socket.data.user = u;
        socket.data.token = socket.handshake.auth.token;
        next();
    });
    io.on('connection', (socket) => {
        socket.join(`user:${socket.data.user.id}`);
        io.emit('refresh');
        attach(socket);
        socket.on('typing', (rawRoom, thread) => {
            const room = canonicalRoom(rawRoom);
            if (
                thread !== undefined &&
                (typeof thread !== 'string' ||
                    !get(
                        'SELECT id FROM messages WHERE id=? AND room=? AND thread IS NULL',
                        thread,
                        room,
                    ))
            )
                return;
            if (
                thread &&
                (!can(socket.data.user, 'threads.reply') ||
                    (!get('SELECT id FROM messages WHERE thread=? LIMIT 1', thread) &&
                        !can(socket.data.user, 'threads.create')))
            )
                return;
            if (typeof room === 'string' && canWrite(socket.data.user, room))
                emitRoom(room, 'typing', {
                    room,
                    user: socket.data.user.id,
                    ...(thread ? { thread } : {}),
                });
        });
        socket.on('call:join', (channel, ack = () => {}) => {
            if (typeof ack !== 'function') return;
            try {
                requirePermission(socket.data.user, 'calls.join');
                check(
                    typeof channel === 'string' &&
                        (canJoin(
                            socket.data.user,
                            get('SELECT * FROM channels WHERE id=?', channel),
                        ) ||
                            privateCalls.get(channel)?.allowed.has(socket.data.user.id)),
                    'Unknown voice channel or private call',
                );
                check(
                    !callState().some(
                        (c) => c.user === socket.data.user.id && c.socket !== socket.id,
                    ),
                    'You are already in a call on another device',
                );
                check(
                    callState().filter((c) => c.channel === channel).length < 8,
                    'This call is full (8 people maximum)',
                );
                const peers = callState().filter(
                    (c) => c.channel === channel && c.socket !== socket.id,
                );
                if (socket.data.call !== channel) {
                    socket.data.shareId = null;
                    socket.data.muted = false;
                    socket.data.deafened = false;
                    socket.data.camera = false;
                }
                socket.data.call = channel;
                const room = privateCalls.get(channel);
                if (room) {
                    room.accepted.add(socket.data.user.id);
                    room.pending.delete(socket.data.user.id);
                    room.started = true;
                    io.emit('refresh');
                }
                broadcastCalls();
                ack({ peers });
            } catch (e) {
                ack({ error: e.message });
            }
        });
        const allowedInCall = (peer) => {
            const user = peer && userFor(peer.data.token);
            return (
                !!user &&
                can(user, 'calls.join') &&
                !!peer.data.call &&
                (peer.data.call.startsWith('private:')
                    ? privateCalls.get(peer.data.call)?.allowed.has(user.id)
                    : canJoin(user, get('SELECT * FROM channels WHERE id=?', peer.data.call)))
            );
        };
        socket.on('call:status', (status) => {
            if (
                !socket.data.call ||
                !allowedInCall(socket) ||
                !status ||
                ['muted', 'deafened', 'camera'].some((key) => typeof status[key] !== 'boolean')
            )
                return;
            socket.data.muted = status.muted || status.deafened;
            socket.data.deafened = status.deafened;
            socket.data.camera = status.camera && can(socket.data.user, 'calls.camera');
            broadcastCalls();
        });
        socket.on('call:media', (shareId) => {
            if (!socket.data.call || !allowedInCall(socket)) return;
            if (
                shareId !== null &&
                (typeof shareId !== 'string' || !shareId.length || shareId.length > 80)
            )
                return;
            if (shareId !== null && !can(socket.data.user, 'calls.share')) return;
            if ((socket.data.shareId || null) === shareId) return;
            socket.data.shareId = shareId;
            broadcastCalls();
        });
        socket.on('call:speaking', (active) => {
            if (
                typeof active !== 'boolean' ||
                !socket.data.call ||
                !allowedInCall(socket) ||
                !can(socket.data.user, 'calls.speak')
            )
                return;
            const now = Date.now();
            if (now - (socket.data.lastActivity || 0) < 50) return;
            socket.data.lastActivity = now;
            for (const peer of io.sockets.sockets.values())
                if (
                    peer.id !== socket.id &&
                    peer.data.call === socket.data.call &&
                    allowedInCall(peer)
                )
                    peer.emit('call:speaking', { user: socket.data.user.id, active });
        });
        socket.on('call:leave', () => {
            socket.data.call = null;
            socket.data.shareId = null;
            prunePrivateCalls();
            broadcastCalls();
        });
        socket.on('signal', (payload) => {
            if (!payload || typeof payload !== 'object') return;
            const { to, data } = payload;
            const target = io.sockets.sockets.get(to);
            if (data?.media?.camera && !can(socket.data.user, 'calls.camera')) return;
            if (data?.media?.sharing && !can(socket.data.user, 'calls.share')) return;
            if (
                data &&
                typeof data === 'object' &&
                socket.data.call &&
                allowedInCall(socket) &&
                allowedInCall(target) &&
                target?.data.call === socket.data.call &&
                JSON.stringify(data).length < 50000
            )
                target.emit('signal', { from: socket.id, user: socket.data.user.id, data });
        });
        socket.on('disconnect', () => {
            prunePrivateCalls();
            broadcastCalls();
            io.emit('refresh');
        });
    });
    return {
        visibleCalls,
        privateState,
        enforceCalls,
        close() {
            clearInterval(callTimer);
        },
    };
}
