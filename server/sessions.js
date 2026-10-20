import { tokenHash } from './security.js';
import { permissionIds, effectiveRoleIds } from '../shared/permissions.js';
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
    const publicUser = (u) => {
        const profile = get('SELECT nickname,frame FROM profiles WHERE user=?', u.id);
        return {
            id: u.id,
            username: u.username,
            nickname: profile?.nickname || u.username,
            frame: profile?.frame || null,
            owner: !!u.owner,
            roles: all('SELECT role FROM user_roles WHERE user=?', u.id).map((entry) => entry.role),
            status:
                get('SELECT status FROM presence_preferences WHERE user=?', u.id)?.status ||
                'online',
            avatar: get('SELECT id FROM avatars WHERE user=?', u.id)?.id || null,
        };
    };
    const users = () => all('SELECT * FROM users WHERE banned=0').map(publicUser);
    const roleIds = (u) =>
        effectiveRoleIds(
            all('SELECT role FROM user_roles WHERE user=?', u.id).map((entry) => entry.role),
        );
    const permissionsFor = (u, assigned) =>
        !u
            ? []
            : u.owner
              ? permissionIds
              : [
                    ...new Set(
                        (assigned === undefined ? roleIds(u) : effectiveRoleIds(assigned)).flatMap(
                            (id) =>
                                JSON.parse(
                                    get('SELECT permissions FROM roles WHERE id=?', id)
                                        ?.permissions || '[]',
                                ),
                        ),
                    ),
                ];
    const can = (u, permission) =>
        !!u && permissionIds.includes(permission) && permissionsFor(u).includes(permission);
    const highest = (u) =>
        u?.owner
            ? Infinity
            : Math.max(
                  0,
                  ...roleIds(u).map(
                      (id) => get('SELECT position FROM roles WHERE id=?', id)?.position || 0,
                  ),
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
        permissionsFor,
        roleIds,
        highest,
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
