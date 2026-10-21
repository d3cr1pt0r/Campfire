import { randomUUID } from 'node:crypto';
import { check, route } from './policies.js';
import { transaction } from './database.js';
import { channelPermissionIds } from '../shared/permissions.js';

const permissions = [
    ...new Set([...channelPermissionIds('text'), ...channelPermissionIds('voice')]),
];
export function registerCategories({
    app,
    db,
    get,
    all,
    run,
    requirePermission,
    highest,
    categoryPermissions,
    categoriesFor,
    channelPermissions,
    canInChannel,
    publishChannels,
    enforceCalls,
}) {
    const children = (id) =>
        all(
            'SELECT c.* FROM channels c JOIN category_channels m ON m.channel=c.id WHERE m.category=?',
            id,
        );
    const managed = (req, permission) => {
        requirePermission(req.user, permission);
        const category = get('SELECT * FROM categories WHERE id=?', req.params.id);
        check(
            category && categoriesFor(req.user).some((entry) => entry.id === category.id),
            'Category not found',
            404,
        );
        check(
            children(category.id).every((channel) =>
                canInChannel(req.user, channel, 'channels.view'),
            ),
            'You must have access to every channel in this category',
            403,
        );
        return category;
    };
    const name = (value) => {
        check(
            typeof value === 'string' &&
                value.trim().length > 0 &&
                value.length <= 32 &&
                !/[\x00-\x1f\x7f]/.test(value),
            'Category name must be 1–32 characters on one line',
        );
        return value.trim();
    };
    const publish = (res) => {
        enforceCalls();
        publishChannels();
        res.json({ ok: true });
    };
    // Detaching preserves the exact effective policy, including private defaults and every role.
    const detach = (channel, category) => {
        run('DELETE FROM channel_overrides WHERE channel=?', channel.id);
        run(
            'INSERT INTO channel_overrides(channel,role,permission,effect) SELECT ?,role,permission,effect FROM category_overrides WHERE category=?',
            channel.id,
            category.id,
        );
        run('UPDATE channels SET private=? WHERE id=?', category.private, channel.id);
    };
    const safeChange = (req, channels, action) =>
        transaction(db, () => {
            const users = req.user.owner ? [] : all('SELECT * FROM users WHERE banned=0');
            const before = channels.map((channel) => ({
                channel,
                actor: channelPermissions(req.user, channel),
                members: users.map((user) => channelPermissions(user, channel)),
            }));
            action();
            for (const { channel, actor, members } of before)
                users.forEach((user, index) =>
                    check(
                        channelPermissions(
                            user,
                            get('SELECT * FROM channels WHERE id=?', channel.id),
                        ).every((p) => members[index].includes(p) || actor.includes(p)),
                        'This change would grant channel permissions you do not have',
                        403,
                    ),
                );
        });
    app.post(
        '/api/categories',
        route((req, res) => {
            requirePermission(req.user, 'channels.create');
            const id = randomUUID();
            run(
                'INSERT INTO categories(id,name,position) VALUES(?,?,?)',
                id,
                name(req.body.name),
                get('SELECT COALESCE(MAX(position),0)+1 n FROM categories').n,
            );
            publishChannels();
            res.json({ id });
        }),
    );
    app.patch(
        '/api/categories/:id',
        route((req, res) => {
            const category = managed(
                req,
                req.body.private !== undefined ? 'channels.access' : 'channels.edit',
            );
            if (req.body.name !== undefined) requirePermission(req.user, 'channels.edit');
            check(
                req.body.name !== undefined || req.body.private !== undefined,
                'No category changes provided',
            );
            if (req.body.private !== undefined)
                check(typeof req.body.private === 'boolean', 'Invalid private category setting');
            safeChange(req, children(category.id), () =>
                run(
                    'UPDATE categories SET name=?,private=? WHERE id=?',
                    req.body.name === undefined ? category.name : name(req.body.name),
                    req.body.private === undefined ? category.private : Number(req.body.private),
                    category.id,
                ),
            );
            publish(res);
        }),
    );
    app.post(
        '/api/categories/:id/move',
        route((req, res) => {
            const category = managed(req, 'channels.reorder');
            check(['up', 'down'].includes(req.body.direction), 'Invalid direction');
            const ordered = categoriesFor(req.user).map((entry) => entry.id);
            const index = ordered.indexOf(category.id),
                next = index + (req.body.direction === 'up' ? -1 : 1);
            if (ordered[next]) {
                [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
                // Preserve positions occupied by invisible categories.
                const positions = all('SELECT id FROM categories ORDER BY position,rowid').map(
                    (entry) => entry.id,
                );
                let cursor = 0;
                transaction(db, () =>
                    positions.forEach((id, position) =>
                        run(
                            'UPDATE categories SET position=? WHERE id=?',
                            position,
                            ordered.includes(id) ? ordered[cursor++] : id,
                        ),
                    ),
                );
            }
            publish(res);
        }),
    );
    app.post(
        '/api/categories/:id/drop',
        route((req, res) => {
            const category = managed(req, 'channels.reorder');
            const target = get('SELECT * FROM categories WHERE id=?', req.body.target);
            check(
                target && categoriesFor(req.user).some((entry) => entry.id === target.id),
                'Invalid category target',
                404,
            );
            check(['before', 'after'].includes(req.body.placement), 'Invalid placement');
            const ordered = all('SELECT id FROM categories ORDER BY position,rowid').map(
                (entry) => entry.id,
            );
            if (category.id !== target.id) {
                ordered.splice(ordered.indexOf(category.id), 1);
                ordered.splice(
                    ordered.indexOf(target.id) + (req.body.placement === 'after' ? 1 : 0),
                    0,
                    category.id,
                );
                transaction(db, () =>
                    ordered.forEach((id, index) =>
                        run('UPDATE categories SET position=? WHERE id=?', index, id),
                    ),
                );
            }
            publish(res);
        }),
    );
    app.post(
        '/api/channels/:id/place',
        route((req, res) => {
            requirePermission(req.user, 'channels.reorder');
            const channel = get('SELECT * FROM channels WHERE id=?', req.params.id);
            check(
                channel && canInChannel(req.user, channel, 'channels.view'),
                'Channel not found',
                404,
            );
            check(
                req.body.category === null || typeof req.body.category === 'string',
                'Invalid category',
            );
            const category =
                req.body.category === null
                    ? null
                    : get('SELECT * FROM categories WHERE id=?', req.body.category);
            check(
                req.body.category === null ||
                    (category && categoriesFor(req.user).some((entry) => entry.id === category.id)),
                'Category not found',
                404,
            );
            const previous = get('SELECT * FROM category_channels WHERE channel=?', channel.id);
            const moving = (previous?.category ?? null) !== req.body.category;
            if (moving) {
                requirePermission(req.user, 'channels.edit');
                requirePermission(req.user, 'channels.access');
                check(
                    typeof req.body.synced === 'boolean' && (category || !req.body.synced),
                    'Choose a permission source',
                );
                check(
                    !category ||
                        (categoryPermissions(req.user, category).includes('channels.view') &&
                            children(category.id).every((entry) =>
                                canInChannel(req.user, entry, 'channels.view'),
                            )),
                    'Category not found',
                    404,
                );
            }
            check(['before', 'after'].includes(req.body.placement), 'Invalid placement');
            const target =
                req.body.target == null
                    ? null
                    : get('SELECT * FROM channels WHERE id=?', req.body.target);
            check(
                req.body.target == null ||
                    (target &&
                        target.id !== channel.id &&
                        canInChannel(req.user, target, 'channels.view') &&
                        (get('SELECT category FROM category_channels WHERE channel=?', target.id)
                            ?.category ?? null) === req.body.category),
                'Invalid channel target',
            );
            safeChange(req, [channel], () => {
                if (moving) {
                    if (previous?.synced && !req.body.synced)
                        detach(
                            channel,
                            get('SELECT * FROM categories WHERE id=?', previous.category),
                        );
                    run('DELETE FROM category_channels WHERE channel=?', channel.id);
                    if (category)
                        run(
                            'INSERT INTO category_channels VALUES(?,?,?)',
                            channel.id,
                            category.id,
                            Number(req.body.synced),
                        );
                }
                const ordered = all('SELECT id FROM channels ORDER BY position,rowid')
                    .map((entry) => entry.id)
                    .filter((id) => id !== channel.id);
                const siblings = all(
                    'SELECT c.id FROM channels c LEFT JOIN category_channels m ON m.channel=c.id WHERE m.category IS ? AND c.id<>? ORDER BY c.position,c.rowid',
                    req.body.category,
                    channel.id,
                );
                const anchor = target?.id ?? siblings.at(-1)?.id;
                const index = anchor
                    ? ordered.indexOf(anchor) + (!target || req.body.placement === 'after' ? 1 : 0)
                    : ordered.length;
                ordered.splice(index, 0, channel.id);
                ordered.forEach((id, position) =>
                    run('UPDATE channels SET position=? WHERE id=?', position, id),
                );
            });
            publish(res);
        }),
    );
    app.delete(
        '/api/categories/:id',
        route((req, res) => {
            const category = managed(req, 'channels.delete');
            requirePermission(req.user, 'channels.access');
            transaction(db, () => {
                for (const channel of children(category.id))
                    if (
                        get('SELECT synced FROM category_channels WHERE channel=?', channel.id)
                            .synced
                    )
                        detach(channel, category);
                run('DELETE FROM categories WHERE id=?', category.id);
            });
            publish(res);
        }),
    );
    app.put(
        '/api/categories/:id/access',
        route((req, res) => {
            const category = managed(req, 'channels.access');
            const role = get("SELECT * FROM roles WHERE id=? AND id<>'owner'", req.body.role);
            check(
                role &&
                    (req.user.owner ||
                        (role.id !== 'everyone' && highest(req.user) > role.position)),
                'You can only manage lower roles',
                403,
            );
            const entries = req.body.overrides;
            check(
                Array.isArray(entries) && entries.length <= permissions.length,
                'Invalid overrides',
            );
            const seen = new Set();
            for (const entry of entries) {
                check(
                    entry &&
                        permissions.includes(entry.permission) &&
                        ['allow', 'deny', 'inherit'].includes(entry.effect) &&
                        !seen.has(entry.permission),
                    'Invalid category permission',
                );
                seen.add(entry.permission);
                if (!req.user.owner) {
                    check(
                        categoryPermissions(req.user, category).includes(entry.permission),
                        'You cannot change a permission you do not have',
                        403,
                    );
                    check(
                        children(category.id).every((channel) =>
                            canInChannel(req.user, channel, entry.permission),
                        ),
                        'You cannot change a permission you do not have in a child channel',
                        403,
                    );
                }
            }
            transaction(db, () => {
                for (const entry of entries) {
                    run(
                        'DELETE FROM category_overrides WHERE category=? AND role=? AND permission=?',
                        category.id,
                        role.id,
                        entry.permission,
                    );
                    if (entry.effect !== 'inherit')
                        run(
                            'INSERT INTO category_overrides VALUES(?,?,?,?)',
                            category.id,
                            role.id,
                            entry.permission,
                            entry.effect,
                        );
                }
            });
            publish(res);
        }),
    );
    app.put(
        '/api/channels/:id/category',
        route((req, res) => {
            requirePermission(req.user, 'channels.edit');
            requirePermission(req.user, 'channels.access');
            const channel = get('SELECT * FROM channels WHERE id=?', req.params.id);
            check(
                channel && canInChannel(req.user, channel, 'channels.view'),
                'Channel not found',
                404,
            );
            check(
                req.body.category === null || typeof req.body.category === 'string',
                'Invalid category',
            );
            check(typeof req.body.synced === 'boolean', 'Choose synced or custom permissions');
            const category =
                req.body.category === null
                    ? null
                    : get('SELECT * FROM categories WHERE id=?', req.body.category);
            check(
                req.body.category === null ||
                    (category &&
                        categoryPermissions(req.user, category).includes('channels.view') &&
                        children(category.id).every((entry) =>
                            canInChannel(req.user, entry, 'channels.view'),
                        )),
                'Category not found',
                404,
            );
            check(category || !req.body.synced, 'Uncategorized channels cannot sync');
            safeChange(req, [channel], () => {
                const previous = get('SELECT * FROM category_channels WHERE channel=?', channel.id);
                if (previous?.synced && (!category || !req.body.synced))
                    detach(channel, get('SELECT * FROM categories WHERE id=?', previous.category));
                run('DELETE FROM category_channels WHERE channel=?', channel.id);
                if (category)
                    run(
                        'INSERT INTO category_channels VALUES(?,?,?)',
                        channel.id,
                        category.id,
                        Number(req.body.synced),
                    );
            });
            publish(res);
        }),
    );
}
