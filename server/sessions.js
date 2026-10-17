import { tokenHash, hasPermission } from './security.js';
import { check } from './policies.js';

export function createSessions({ get, all, run, io }) {
    const timers = new Map();
    const userFor = (token) =>
        typeof token === 'string' &&
        /^[a-f0-9]{64}$/.test(token) &&
        get(
            'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user WHERE s.token=? AND s.expires>? AND u.banned=0',
            tokenHash(token),
            Date.now(),
        );
    const publicUser = (u) => ({
        id: u.id,
        username: u.username,
        nickname: get('SELECT nickname FROM profiles WHERE user=?', u.id)?.nickname || u.username,
        role: u.role,
        status:
            get('SELECT status FROM presence_preferences WHERE user=?', u.id)?.status || 'online',
        avatar: get('SELECT id FROM avatars WHERE user=?', u.id)?.id || null,
    });
    const users = () =>
        all(`SELECT u.id,u.username,u.role,COALESCE(p.nickname,u.username) nickname,a.id avatar
        FROM users u LEFT JOIN profiles p ON p.user=u.id LEFT JOIN avatars a ON a.user=u.id WHERE u.banned=0`);
    const can = (u, permission) =>
        !!u &&
        hasPermission(
            u,
            JSON.parse(
                get('SELECT permissions FROM roles WHERE id=?', u.role)?.permissions || '[]',
            ),
            permission,
        );
    const requirePermission = (u, permission) =>
        check(can(u, permission), 'Permission denied', 403);
    const auth = (req, res, next) => {
        req.user = userFor(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!req.user) return res.status(401).json({ error: 'Please sign in again' });
        next();
    };
    const attach = (socket) => {
        const expire = () => {
            clearTimeout(timers.get(socket.id));
            timers.delete(socket.id);
            const session = get(
                'SELECT expires FROM sessions WHERE token=?',
                tokenHash(socket.data.token),
            );
            if (!session || session.expires <= Date.now() || !userFor(socket.data.token)) {
                socket.disconnect(true);
                return;
            }
            // Node timers cannot represent the full 30-day session lifetime.
            const timer = setTimeout(expire, Math.min(session.expires - Date.now(), 2147483647));
            timer.unref();
            timers.set(socket.id, timer);
        };
        socket.on('disconnect', () => {
            clearTimeout(timers.get(socket.id));
            timers.delete(socket.id);
        });
        expire();
        socket.use((_packet, next) => {
            const user = userFor(socket.data.token);
            if (!user) return socket.disconnect(true);
            socket.data.user = user;
            next();
        });
    };
    const revoke = (token) => {
        run('DELETE FROM sessions WHERE token=?', tokenHash(token));
        for (const socket of io.sockets.sockets.values())
            if (socket.data.token === token) socket.disconnect(true);
    };
    return {
        userFor,
        publicUser,
        users,
        can,
        requirePermission,
        auth,
        attach,
        revoke,
        close() {
            timers.forEach(clearTimeout);
            timers.clear();
        },
    };
}
