import { randomUUID } from 'node:crypto';
import { channelName } from './images.js';
import { check, route, validateRole } from './policies.js';
import { transaction } from './database.js';
export function registerAdministration({
    app,
    db,
    get,
    all,
    run,
    requirePermission,
    enforceCalls,
    canRead,
    canJoin,
    publishChannels,
}) {
    app.post(
        '/api/channels',
        route((req, res) => {
            requirePermission(req.user, 'manage');
            let name;
            try {
                name = channelName(req.body.name, req.body.kind);
            } catch (e) {
                check(false, e.message);
            }
            const id = randomUUID();
            run(
                'INSERT INTO channels(id,name,kind,position,description) VALUES(?,?,?,?,?)',
                id,
                name,
                req.body.kind,
                get(
                    'SELECT COALESCE(MAX(position),0)+1 position FROM channels WHERE kind=?',
                    req.body.kind,
                ).position,
                req.body.kind === 'text' ? 'A place for everyday conversations.' : '',
            );
            publishChannels();
            res.json({ id });
        }),
    );
    const managedChannel = (req) => {
        requirePermission(req.user, 'manage');
        const channel = get('SELECT * FROM channels WHERE id=?', req.params.id);
        check(
            channel && (canRead(req.user, channel) || canJoin(req.user, channel)),
            'Channel not found',
            404,
        );
        return channel;
    };
    app.post(
        '/api/channels/:id/move',
        route((req, res) => {
            const channel = managedChannel(req);
            check(['up', 'down'].includes(req.body.direction), 'Invalid move direction');
            transaction(db, () => {
                const channels = all(
                    'SELECT * FROM channels WHERE kind=? ORDER BY position,rowid',
                    channel.kind,
                ).filter((entry) => canRead(req.user, entry) || canJoin(req.user, entry));
                const index = channels.findIndex((entry) => entry.id === channel.id);
                const other = channels[index + (req.body.direction === 'up' ? -1 : 1)];
                if (other) {
                    // Renumber first so even imported channels with tied positions move reliably.
                    const ordered = all(
                        'SELECT id FROM channels WHERE kind=? ORDER BY position,rowid',
                        channel.kind,
                    );
                    ordered.forEach((entry, position) =>
                        run('UPDATE channels SET position=? WHERE id=?', position, entry.id),
                    );
                    const first = get(
                        'SELECT position FROM channels WHERE id=?',
                        channel.id,
                    ).position;
                    const second = get(
                        'SELECT position FROM channels WHERE id=?',
                        other.id,
                    ).position;
                    run('UPDATE channels SET position=? WHERE id=?', second, channel.id);
                    run('UPDATE channels SET position=? WHERE id=?', first, other.id);
                }
            });
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.patch(
        '/api/channels/:id',
        route((req, res) => {
            const channel = managedChannel(req);
            check(
                req.body.name !== undefined || req.body.description !== undefined,
                'No channel changes provided',
            );
            let name = channel.name;
            try {
                if (req.body.name !== undefined) name = channelName(req.body.name, channel.kind);
            } catch (error) {
                check(false, error.message);
            }
            let description = channel.description;
            if (req.body.description !== undefined) {
                check(channel.kind === 'text', 'Only text channels have descriptions');
                check(
                    typeof req.body.description === 'string' &&
                        req.body.description.length <= 200 &&
                        !/[\r\n\x00-\x1f\x7f]/.test(req.body.description),
                    'Channel description must be a single line of at most 200 characters',
                );
                description = req.body.description.trim();
            }
            run(
                'UPDATE channels SET name=?,description=? WHERE id=?',
                name,
                description,
                channel.id,
            );
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.delete(
        '/api/channels/:id',
        route((req, res) => {
            const channel = managedChannel(req);
            transaction(db, () => {
                check(
                    !channel.protected &&
                        get('SELECT COUNT(*) n FROM channels WHERE kind=?', channel.kind).n > 1,
                    'The protected text and voice channels cannot be deleted',
                    409,
                );
                run('DELETE FROM messages WHERE room=?', channel.id);
                run('DELETE FROM channels WHERE id=?', channel.id);
            });
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.put(
        '/api/channels/:id/access',
        route((req, res) => {
            const channel = managedChannel(req);
            const entries = req.body.permissions;
            check(
                Array.isArray(entries) && entries.length <= all('SELECT id FROM roles').length,
                'Invalid channel permissions',
            );
            const seen = new Set();
            for (const entry of entries) {
                check(
                    entry &&
                        typeof entry.role === 'string' &&
                        entry.role !== 'owner' &&
                        !seen.has(entry.role) &&
                        get('SELECT id FROM roles WHERE id=?', entry.role),
                    'Invalid or duplicate role',
                );
                check(
                    (channel.kind === 'text'
                        ? ['full', 'read-only', 'hidden']
                        : ['full', 'hidden']
                    ).includes(entry.mode),
                    'Invalid channel access mode',
                );
                seen.add(entry.role);
            }
            transaction(db, () => {
                run('DELETE FROM channel_access WHERE channel=?', channel.id);
                for (const entry of entries)
                    run(
                        'INSERT INTO channel_access(channel,role,mode) VALUES(?,?,?)',
                        channel.id,
                        entry.role,
                        entry.mode,
                    );
            });
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.post(
        '/api/roles',
        route((req, res) => {
            requirePermission(req.user, 'manage');
            const { name, color, permissions } = validateRole(req.body);
            check(
                req.user.role === 'owner' || !permissions.includes('manage'),
                'Only the owner can grant server management',
                403,
            );
            const id = randomUUID();
            run('INSERT INTO roles VALUES(?,?,?,?)', id, name, color, JSON.stringify(permissions));
            publishChannels();
            res.json({ id });
        }),
    );
    app.patch(
        '/api/roles/:id',
        route((req, res) => {
            requirePermission(req.user, 'manage');
            const role = get('SELECT * FROM roles WHERE id=?', req.params.id);
            check(role, 'Role not found', 404);
            const { name, color, permissions } = validateRole(req.body);
            check(
                req.user.role === 'owner' ||
                    (role.id !== 'owner' &&
                        !permissions.includes('manage') &&
                        !JSON.parse(role.permissions).includes('manage')),
                'Only the owner can change management roles',
                403,
            );
            run(
                'UPDATE roles SET name=?,color=?,permissions=? WHERE id=?',
                name,
                color,
                JSON.stringify(permissions),
                role.id,
            );
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.delete(
        '/api/roles/:id',
        route((req, res) => {
            requirePermission(req.user, 'manage');
            const role = get('SELECT * FROM roles WHERE id=?', req.params.id);
            check(role, 'Role not found', 404);
            check(
                role.id !== 'owner' && role.id !== 'member',
                'The default owner and member roles cannot be deleted',
                409,
            );
            check(
                req.user.role === 'owner' || !JSON.parse(role.permissions).includes('manage'),
                'Only the owner can delete management roles',
                403,
            );
            check(
                req.user.role === 'owner' ||
                    !get('SELECT id FROM users WHERE role=? LIMIT 1', role.id),
                'Only the owner can delete assigned roles and move their users to Member',
                403,
            );
            transaction(db, () => {
                run('UPDATE users SET role=? WHERE role=?', 'member', role.id);
                run('DELETE FROM roles WHERE id=?', role.id);
            });
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.patch(
        '/api/users/:id/role',
        route((req, res) => {
            check(req.user.role === 'owner', 'Only the owner can assign roles', 403);
            const target = get('SELECT * FROM users WHERE id=?', req.params.id);
            check(
                target &&
                    target.role !== 'owner' &&
                    req.body.role !== 'owner' &&
                    get('SELECT id FROM roles WHERE id=?', req.body.role),
                'Invalid role assignment',
            );
            run('UPDATE users SET role=? WHERE id=?', req.body.role, target.id);
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.patch(
        '/api/settings',
        route((req, res) => {
            requirePermission(req.user, 'manage');
            check(
                typeof req.body.name === 'string' &&
                    req.body.name.trim().length > 0 &&
                    req.body.name.length <= 64,
                'Server name must contain 1–64 characters',
            );
            run('UPDATE settings SET value=? WHERE key=?', req.body.name.trim(), 'name');
            publishChannels();
            res.json({ ok: true });
        }),
    );
}
