import { randomUUID } from 'node:crypto';
import { boundedPng, channelName } from './images.js';
import { check, route, validateRole } from './policies.js';
import { transaction } from './database.js';
import { channelPermissionIds } from '../shared/permissions.js';
import {
    formatStorageQuota,
    formatUploadLimit,
    isStorageQuota,
    isUploadLimit,
    storageQuotaCeiling,
    uploadLimitCeiling,
} from '../shared/uploads.js';
export function registerAdministration({
    app,
    io,
    db,
    get,
    all,
    run,
    requirePermission,
    enforceCalls,
    canInChannel,
    can,
    highest,
    channelPermissions,
    permissionsFor,
    permissionDetails,
    publishChannels,
    previews,
}) {
    app.post(
        '/api/channels',
        route((req, res) => {
            requirePermission(req.user, 'channels.create');
            let name;
            try {
                name = channelName(req.body.name, req.body.kind);
            } catch (e) {
                check(false, e.message);
            }
            const id = randomUUID();
            check(
                req.body.private === undefined || typeof req.body.private === 'boolean',
                'Invalid private channel setting',
            );
            run(
                'INSERT INTO channels(id,name,kind,position,description,private) VALUES(?,?,?,?,?,?)',
                id,
                name,
                req.body.kind,
                get(
                    'SELECT COALESCE(MAX(position),0)+1 position FROM channels WHERE kind=?',
                    req.body.kind,
                ).position,
                req.body.kind === 'text' ? 'A place for everyday conversations.' : '',
                Number(req.body.private === true),
            );
            publishChannels();
            res.json({ id });
        }),
    );
    const managedChannel = (req, permission) => {
        requirePermission(req.user, permission);
        const channel = get('SELECT * FROM channels WHERE id=?', req.params.id);
        check(
            channel && canInChannel(req.user, channel, 'channels.view'),
            'Channel not found',
            404,
        );
        return channel;
    };
    app.post(
        '/api/channels/:id/move',
        route((req, res) => {
            const channel = managedChannel(req, 'channels.reorder');
            check(['up', 'down'].includes(req.body.direction), 'Invalid move direction');
            transaction(db, () => {
                const channels = all(
                    'SELECT * FROM channels WHERE kind=? ORDER BY position,rowid',
                    channel.kind,
                ).filter((entry) => canInChannel(req.user, entry, 'channels.view'));
                const index = channels.findIndex((entry) => entry.id === channel.id);
                const other = channels[index + (req.body.direction === 'up' ? -1 : 1)];
                if (other) {
                    // Renumber first so the swap works whatever gaps or ties the positions have.
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
    app.post(
        '/api/channels/:id/drop',
        route((req, res) => {
            const channel = managedChannel(req, 'channels.reorder');
            const target = get('SELECT * FROM channels WHERE id=?', req.body.target);
            check(
                target &&
                    target.kind === channel.kind &&
                    canInChannel(req.user, target, 'channels.view'),
                'Invalid drop target',
            );
            const placement = req.body.placement ?? 'before';
            check(['before', 'after'].includes(placement), 'Invalid drop placement');
            transaction(db, () => {
                const ordered = all(
                    'SELECT id FROM channels WHERE kind=? ORDER BY position,rowid',
                    channel.kind,
                ).map((c) => c.id);
                if (channel.id !== target.id) {
                    ordered.splice(ordered.indexOf(channel.id), 1);
                    ordered.splice(
                        ordered.indexOf(target.id) + (placement === 'after' ? 1 : 0),
                        0,
                        channel.id,
                    );
                    ordered.forEach((id, position) =>
                        run('UPDATE channels SET position=? WHERE id=?', position, id),
                    );
                }
            });
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.patch(
        '/api/channels/:id',
        route((req, res) => {
            const channel = managedChannel(req, 'channels.edit');
            check(
                req.body.name !== undefined ||
                    req.body.description !== undefined ||
                    req.body.reactionAuthors !== undefined,
                'No channel changes provided',
            );
            if (req.body.reactionAuthors !== undefined)
                check(
                    channel.kind === 'text' && typeof req.body.reactionAuthors === 'boolean',
                    'Invalid reaction author setting',
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
            if (req.body.reactionAuthors !== undefined) {
                run(
                    'UPDATE channels SET reactionAuthors=? WHERE id=?',
                    Number(req.body.reactionAuthors),
                    channel.id,
                );
            }
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.patch(
        '/api/channels/:id/privacy',
        route((req, res) => {
            const channel = managedChannel(req, 'channels.access');
            check(typeof req.body.private === 'boolean', 'Invalid private channel setting');
            run('UPDATE channels SET private=? WHERE id=?', Number(req.body.private), channel.id);
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.delete(
        '/api/channels/:id',
        route((req, res) => {
            const channel = managedChannel(req, 'channels.delete');
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
            previews.prune();
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    const roleFor = (id, restoring = false) =>
        get("SELECT * FROM roles WHERE id=? AND (? OR id<>'owner')", id, Number(restoring));
    const mayManageRole = (actor, role) =>
        !!role && (actor.owner || (role.id !== 'everyone' && highest(actor) > role.position));
    const mayManageMember = (actor, target) =>
        !!target &&
        !target.owner &&
        target.id !== actor.id &&
        (actor.owner || highest(actor) > highest(target));
    const roleAccess = (req, role) => {
        requirePermission(req.user, 'channels.access');
        check(mayManageRole(req.user, role), 'You can only manage lower roles', 403);
    };
    const validateOverrides = (req, role, entries) => {
        roleAccess(req, role);
        check(Array.isArray(entries) && entries.length <= 10000, 'Invalid overrides');
        const seen = new Set();
        for (const entry of entries) {
            const channel = entry && get('SELECT * FROM channels WHERE id=?', entry.channel);
            check(
                channel && canInChannel(req.user, channel, 'channels.view'),
                'Channel not found',
                404,
            );
            check(
                channelPermissionIds(channel.kind).includes(entry.permission) &&
                    ['allow', 'deny', 'inherit'].includes(entry.effect),
                'Invalid channel permission',
            );
            const key = `${channel.id}:${entry.permission}`;
            check(!seen.has(key), 'Duplicate override');
            seen.add(key);
            if (!req.user.owner)
                check(
                    canInChannel(req.user, channel, entry.permission),
                    'You cannot change a permission you do not have',
                    403,
                );
        }
    };
    const saveOverrides = (role, entries) => {
        for (const entry of entries) {
            run(
                'DELETE FROM channel_overrides WHERE channel=? AND role=? AND permission=?',
                entry.channel,
                role,
                entry.permission,
            );
            if (entry.effect !== 'inherit')
                run(
                    'INSERT INTO channel_overrides VALUES(?,?,?,?)',
                    entry.channel,
                    role,
                    entry.permission,
                    entry.effect,
                );
        }
    };
    const validateGrants = (req, permissions) => {
        if (!req.user.owner)
            check(
                permissions.every((p) => can(req.user, p)),
                'You cannot grant permissions you do not have',
                403,
            );
    };
    const validateMembershipChange = (req, target, ids) => {
        if (req.user.owner) return;
        const before = permissionsFor(target);
        check(
            permissionsFor(target, ids).every(
                (permission) => before.includes(permission) || can(req.user, permission),
            ),
            'This change would activate Default permissions you do not have',
            403,
        );
        for (const channel of all('SELECT * FROM channels')) {
            const previous = channelPermissions(target, channel);
            const next = channelPermissions(target, channel, ids);
            const actor = channelPermissions(req.user, channel);
            check(
                next.every(
                    (permission) => previous.includes(permission) || actor.includes(permission),
                ),
                'This change would grant channel permissions you do not have',
                403,
            );
        }
    };
    app.post(
        '/api/roles',
        route((req, res) => {
            requirePermission(req.user, 'roles.manage');
            const { name, color, permissions } = validateRole(req.body);
            validateGrants(req, permissions);
            check(req.body.channelAccess === undefined, 'Use targeted channel overrides');
            check(
                req.user.owner || highest(req.user) > 0,
                'A ranked role is required to create lower roles',
                403,
            );
            const id = randomUUID();
            transaction(db, () => {
                const position = req.user.owner
                    ? get('SELECT COALESCE(MAX(position),0)+1 n FROM roles').n
                    : highest(req.user) - 0.5;
                run(
                    'INSERT INTO roles(id,name,color,permissions,position) VALUES(?,?,?,?,?)',
                    id,
                    name,
                    color,
                    JSON.stringify(permissions),
                    position,
                );
                // Keep a strict, integral order after inserting below a delegate's highest role.
                all(
                    "SELECT id FROM roles WHERE id NOT IN ('owner','everyone') ORDER BY position,id",
                ).forEach((entry, index) =>
                    run('UPDATE roles SET position=? WHERE id=?', index + 1, entry.id),
                );
                if (req.body.overrides) {
                    validateOverrides(req, roleFor(id), req.body.overrides);
                    saveOverrides(id, req.body.overrides);
                }
            });
            publishChannels();
            res.json({ id });
        }),
    );
    app.patch(
        '/api/roles/:id',
        route((req, res) => {
            requirePermission(req.user, 'roles.manage');
            const role = roleFor(req.params.id, req.setupRestore === true);
            check(role, 'Role not found', 404);
            check(mayManageRole(req.user, role), 'You can only edit lower roles', 403);
            // Ownership grants every current permission independently of this legacy
            // role row. Restore its appearance but rebuild that list from the server.
            const { name, color, permissions } = validateRole(
                req.setupRestore && role.id === 'owner'
                    ? { ...req.body, permissions: permissionsFor(req.user) }
                    : req.body,
            );
            validateGrants(req, permissions);
            check(req.body.channelAccess === undefined, 'Use targeted channel overrides');
            if (req.body.overrides) validateOverrides(req, role, req.body.overrides);
            transaction(db, () => {
                run(
                    'UPDATE roles SET name=?,color=?,permissions=? WHERE id=?',
                    name,
                    color,
                    JSON.stringify(permissions),
                    role.id,
                );
                if (req.body.overrides) saveOverrides(role.id, req.body.overrides);
            });
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.put(
        '/api/roles/:id/access',
        route((req, res) => {
            const role = roleFor(req.params.id);
            check(role, 'Role not found', 404);
            validateOverrides(req, role, req.body.overrides);
            transaction(db, () => saveOverrides(role.id, req.body.overrides));
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.post(
        '/api/roles/:id/move',
        route((req, res) => {
            requirePermission(req.user, 'roles.manage');
            const role = roleFor(req.params.id);
            check(role && role.id !== 'everyone', 'The baseline role cannot move', 400);
            check(mayManageRole(req.user, role), 'You can only move lower roles', 403);
            check(['up', 'down'].includes(req.body.direction), 'Invalid direction');
            const ordered = all(
                "SELECT * FROM roles WHERE id NOT IN ('owner','everyone') ORDER BY position DESC,id",
            );
            const index = ordered.findIndex((entry) => entry.id === role.id);
            const other = ordered[index + (req.body.direction === 'up' ? -1 : 1)];
            if (other) {
                check(mayManageRole(req.user, other), 'You cannot move a role above your own', 403);
                [ordered[index], ordered[index + (req.body.direction === 'up' ? -1 : 1)]] = [
                    other,
                    role,
                ];
                transaction(db, () =>
                    ordered.forEach((entry, i) =>
                        run('UPDATE roles SET position=? WHERE id=?', ordered.length - i, entry.id),
                    ),
                );
            }
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.delete(
        '/api/roles/:id',
        route((req, res) => {
            requirePermission(req.user, 'roles.manage');
            const role = roleFor(req.params.id);
            check(role, 'Role not found', 404);
            check(role.id !== 'everyone', 'The Default role cannot be deleted', 409);
            check(mayManageRole(req.user, role), 'You can only delete lower roles', 403);
            for (const target of all(
                'SELECT u.* FROM users u JOIN user_roles r ON r.user=u.id WHERE r.role=?',
                role.id,
            ))
                validateMembershipChange(
                    req,
                    target,
                    all(
                        'SELECT role FROM user_roles WHERE user=? AND role<>?',
                        target.id,
                        role.id,
                    ).map((entry) => entry.role),
                );
            run('DELETE FROM roles WHERE id=?', role.id);
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.patch(
        '/api/users/:id/roles',
        route((req, res) => {
            requirePermission(req.user, 'roles.assign');
            const target = get('SELECT * FROM users WHERE id=?', req.params.id);
            check(
                (req.user.owner && target?.owner && target.id === req.user.id) ||
                    mayManageMember(req.user, target),
                'You can only assign roles to lower members',
                403,
            );
            const ids = req.body.roles;
            check(
                Array.isArray(ids) &&
                    ids.length <= 100 &&
                    new Set(ids).size === ids.length &&
                    ids.every((id) => typeof id === 'string' && id !== 'everyone' && !!roleFor(id)),
                'Invalid role assignment',
            );
            const current = all('SELECT role FROM user_roles WHERE user=?', target.id).map(
                (entry) => entry.role,
            );
            const changed = [...new Set([...current, ...ids])].filter(
                (id) => current.includes(id) !== ids.includes(id),
            );
            for (const id of changed) {
                const role = roleFor(id);
                check(
                    mayManageRole(req.user, role),
                    'You can only assign or remove lower roles',
                    403,
                );
                if (ids.includes(id)) validateGrants(req, JSON.parse(role.permissions));
                // Channel overrides must not let an assignment grant channel abilities the actor lacks.
                if (!req.user.owner && ids.includes(id))
                    for (const entry of all(
                        "SELECT * FROM channel_overrides WHERE role=? AND effect='allow'",
                        id,
                    ))
                        check(
                            canInChannel(
                                req.user,
                                get('SELECT * FROM channels WHERE id=?', entry.channel),
                                entry.permission,
                            ),
                            'This role grants channel access you do not have',
                            403,
                        );
            }
            validateMembershipChange(req, target, ids);
            transaction(db, () => {
                run('DELETE FROM user_roles WHERE user=?', target.id);
                for (const id of ids) run('INSERT INTO user_roles VALUES(?,?)', target.id, id);
            });
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.get(
        '/api/users/:id/permissions',
        route((req, res) => {
            check(
                can(req.user, 'roles.manage') ||
                    can(req.user, 'roles.assign') ||
                    can(req.user, 'channels.access'),
                'Permission denied',
                403,
            );
            const channel = get('SELECT * FROM channels WHERE id=?', req.query.channel);
            check(
                channel && canInChannel(req.user, channel, 'channels.view'),
                'Channel not found',
                404,
            );
            const user = get('SELECT * FROM users WHERE id=? AND banned=0', req.params.id);
            check(user, 'Member not found', 404);
            res.json(permissionDetails(user, channel));
        }),
    );
    app.post(
        '/api/users/:id/access',
        route((req, res) => {
            check(typeof req.body.enabled === 'boolean', 'Invalid access setting');
            requirePermission(req.user, req.body.enabled ? 'members.restore' : 'members.ban');
            const target = get('SELECT * FROM users WHERE id=?', req.params.id);
            check(mayManageMember(req.user, target), 'You can only moderate lower members', 403);
            transaction(db, () => {
                run('UPDATE users SET banned=? WHERE id=?', Number(!req.body.enabled), target.id);
                run('DELETE FROM sessions WHERE user=?', target.id);
                run('DELETE FROM password_resets WHERE user=?', target.id);
            });
            for (const socket of io.sockets.sockets.values())
                if (socket.data.user.id === target.id) socket.disconnect(true);
            enforceCalls();
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.delete(
        '/api/users/:id',
        route((req, res) => {
            requirePermission(req.user, 'members.delete');
            const target = get('SELECT * FROM users WHERE id=?', req.params.id);
            check(target, 'Member not found', 404);
            check(mayManageMember(req.user, target), 'You can only delete lower members', 403);
            check(
                req.body?.username === target.username,
                'Enter the account username to confirm deletion',
            );
            transaction(db, () => {
                run('DELETE FROM sessions WHERE user=?', target.id);
                run('DELETE FROM reactions WHERE user=?', target.id);
                // Nobody can open a direct message with a deleted member again, so those go with
                // the account, personal notes included. Rooms are dm:<lower id>:<higher id>.
                run(
                    "DELETE FROM messages WHERE room IN (SELECT 'dm:' || min(?1,id) || ':' || max(?1,id) FROM users)",
                    target.id,
                );
                // Keep channel history and replies without retaining the account identity.
                run('UPDATE messages SET author=NULL WHERE author=?', target.id);
                run('UPDATE emojis SET author=NULL WHERE author=?', target.id);
                // Clearing usedBy alone would make a redeemed invitation usable again.
                run('UPDATE invitations SET usedBy=NULL,revoked=1 WHERE usedBy=?', target.id);
                run('DELETE FROM users WHERE id=?', target.id);
            });
            previews.prune();
            for (const socket of io.sockets.sockets.values())
                if (socket.data.user.id === target.id) socket.disconnect(true);
            enforceCalls();
            io.emit('member:deleted', { id: target.id });
            publishChannels();
            res.json({ ok: true });
        }),
    );
    app.patch(
        '/api/settings',
        route((req, res) => {
            requirePermission(req.user, 'server.edit');
            const {
                name,
                icon,
                reactionAuthors,
                profileFrames,
                maxUploadBytes,
                maxStoredUploadBytes,
            } = req.body;
            check(
                name !== undefined ||
                    icon !== undefined ||
                    reactionAuthors !== undefined ||
                    profileFrames !== undefined ||
                    maxUploadBytes !== undefined ||
                    maxStoredUploadBytes !== undefined,
                'No settings provided',
            );
            if (name !== undefined)
                check(
                    typeof name === 'string' && name.trim().length > 0 && name.length <= 64,
                    'Server name must contain 1–64 characters',
                );
            if (reactionAuthors !== undefined)
                check(typeof reactionAuthors === 'boolean', 'Invalid reaction setting');
            if (profileFrames !== undefined)
                check(typeof profileFrames === 'boolean', 'Invalid profile frame setting');
            if (maxUploadBytes !== undefined)
                check(
                    isUploadLimit(maxUploadBytes),
                    `Maximum upload size must be a whole number of MB from 1 to ${formatUploadLimit(uploadLimitCeiling)}`,
                );
            if (maxStoredUploadBytes !== undefined)
                check(
                    isStorageQuota(maxStoredUploadBytes),
                    `Attachment storage must be a whole number of GB from 0 to ${formatStorageQuota(storageQuotaCeiling)}`,
                );
            let image;
            if (icon !== undefined && icon !== null) {
                try {
                    image = boundedPng(icon, 256);
                } catch (error) {
                    check(false, error.message);
                }
            }
            transaction(db, () => {
                const save = (key, value) =>
                    run(
                        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                        key,
                        value,
                    );
                if (name !== undefined) save('name', name.trim());
                if (icon !== undefined) save('icon', image || '');
                if (reactionAuthors !== undefined) save('reactionAuthors', String(reactionAuthors));
                if (profileFrames !== undefined) save('profileFrames', String(profileFrames));
                if (maxUploadBytes !== undefined) save('maxUploadBytes', String(maxUploadBytes));
                if (maxStoredUploadBytes !== undefined)
                    save('maxStoredUploadBytes', String(maxStoredUploadBytes));
            });
            publishChannels();
            res.json({ ok: true });
        }),
    );
}
