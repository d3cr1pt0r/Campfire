import { randomUUID } from 'node:crypto';
import { channelName } from './images.js';
import { check, route, validateRole } from './policies.js';
export function registerAdministration({ app, io, get, run, requirePermission, enforceCalls }) {
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
            run('INSERT INTO channels VALUES(?,?,?)', id, name, req.body.kind);
            io.emit('refresh');
            res.json({ id });
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
            io.emit('refresh');
            res.json({ id });
        }),
    );
    app.patch(
        '/api/roles/:id',
        route((req, res) => {
            requirePermission(req.user, 'manage');
            const role = get('SELECT * FROM roles WHERE id=?', req.params.id);
            check(role && role.id !== 'owner', 'The owner role cannot be changed', 403);
            const { name, color, permissions } = validateRole(req.body);
            check(
                req.user.role === 'owner' ||
                    (!permissions.includes('manage') &&
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
            io.emit('refresh');
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
            io.emit('refresh');
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
            io.emit('refresh');
            res.json({ ok: true });
        }),
    );
}
