import { canReadRoom } from './security.js';
import { channelPermissionIds, effectiveRoleIds } from '../shared/permissions.js';

export function createChannelAccess({ get, all, permissionsFor, roleIds, userFor, io }) {
    const membershipFor = (channel) =>
        get('SELECT * FROM category_channels WHERE channel=?', channel.id);
    const scopeFor = (channel) => {
        const membership = membershipFor(channel);
        const category =
            membership?.synced && get('SELECT * FROM categories WHERE id=?', membership.category);
        return category
            ? {
                  private: category.private,
                  entries: all('SELECT * FROM category_overrides WHERE category=?', category.id),
                  label: `Category ${category.name}`,
              }
            : {
                  private: channel.private,
                  entries: all('SELECT * FROM channel_overrides WHERE channel=?', channel.id),
                  label: 'Channel',
              };
    };
    const resolve = (user, scope, memberships) => {
        if (!user || !scope) return [];
        if (user.owner) return permissionsFor(user);
        const permissions = new Set(permissionsFor(user, memberships));
        if (scope.private) permissions.delete('channels.view');
        const overrides = scope.entries;
        const apply = (entries) => {
            for (const entry of entries)
                if (entry.effect === 'deny') permissions.delete(entry.permission);
            for (const entry of entries)
                if (entry.effect === 'allow') permissions.add(entry.permission);
        };
        const assigned = memberships === undefined ? roleIds(user) : effectiveRoleIds(memberships);
        apply(overrides.filter((entry) => assigned.includes(entry.role)));
        if (!permissions.has('channels.view')) return [];
        return [...permissions];
    };
    const channelPermissions = (user, channel, memberships) =>
        channel ? resolve(user, scopeFor(channel), memberships) : [];
    const categoryPermissions = (user, category) =>
        resolve(user, {
            private: category.private,
            entries: all('SELECT * FROM category_overrides WHERE category=?', category.id),
        });
    const categoriesFor = (user) =>
        all('SELECT * FROM categories ORDER BY position,rowid')
            .filter(
                (category) =>
                    categoryPermissions(user, category).includes('channels.view') ||
                    all(
                        'SELECT c.* FROM channels c JOIN category_channels m ON c.id=m.channel WHERE m.category=?',
                        category.id,
                    ).some((channel) =>
                        channelPermissions(user, channel).includes('channels.view'),
                    ),
            )
            .map((category) => ({
                ...category,
                private: !!category.private,
                permissions: categoryPermissions(user, category),
            }));
    const permissionDetails = (user, channel) => {
        const permissions = channelPermissions(user, channel);
        const roles = all('SELECT * FROM roles WHERE id<>?', 'owner').filter((role) =>
            roleIds(user).includes(role.id),
        );
        const scope = scopeFor(channel);
        const entries = scope.entries;
        const details = channelPermissionIds(channel.kind).map((permission) => {
            let sources = roles
                .filter((role) => JSON.parse(role.permissions).includes(permission))
                .map((role) => role.name);
            let reason = sources.length
                ? `Server roles: ${sources.join(', ')}`
                : 'No server role grants this permission';
            if (permission === 'channels.view' && scope.private)
                reason = `Private ${scope.label.toLowerCase()} default`;
            const baseline = entries.find(
                (entry) =>
                    roleIds(user).includes('everyone') &&
                    entry.role === 'everyone' &&
                    entry.permission === permission,
            );
            if (baseline)
                reason = `${roles.find((role) => role.id === 'everyone')?.name || 'Default'} ${scope.label.toLowerCase()} override: ${baseline.effect}`;
            const overrides = entries.filter(
                (entry) =>
                    entry.role !== 'everyone' &&
                    roleIds(user).includes(entry.role) &&
                    entry.permission === permission,
            );
            const allows = overrides.filter((entry) => entry.effect === 'allow');
            const winners = allows.length
                ? allows
                : overrides.filter((entry) => entry.effect === 'deny');
            if (winners.length)
                reason = `${scope.label} ${allows.length ? 'allow' : 'deny'}: ${winners.map((entry) => roles.find((role) => role.id === entry.role)?.name).join(', ')}`;
            if (!permissions.includes('channels.view')) reason = 'Channel is not visible';
            if (user.owner) reason = 'Protected server ownership';
            return { permission, allowed: permissions.includes(permission), reason };
        });
        return { permissions, details };
    };
    const canInChannel = (user, channel, permission) =>
        channelPermissions(user, channel).includes(permission);
    const canRead = (user, channel) =>
        channel?.kind === 'text' && canInChannel(user, channel, 'channels.view');
    const canJoin = (user, channel) =>
        channel?.kind === 'voice' && canInChannel(user, channel, 'calls.join');
    const hasRoom = (user, room) =>
        !!user &&
        canReadRoom(
            user.id,
            room,
            (id) => canRead(user, get('SELECT * FROM channels WHERE id=?', id)),
            (id) => !!get('SELECT id FROM users WHERE id=?', id),
        );
    // DMs have no channel role overrides. Account bans still end the session.
    const canInRoom = (user, room, permission) =>
        hasRoom(user, room) &&
        (room.startsWith('dm:') ||
            canInChannel(user, get('SELECT * FROM channels WHERE id=?', room), permission));
    const canWrite = (user, room) => canInRoom(user, room, 'messages.send');
    const channelsFor = (user) =>
        all('SELECT * FROM channels ORDER BY position,rowid').flatMap((channel) => {
            const permissions = channelPermissions(user, channel);
            return permissions.includes('channels.view')
                ? [
                      {
                          ...channel,
                          category: membershipFor(channel)?.category ?? null,
                          synced: !!membershipFor(channel)?.synced,
                          private: !!scopeFor(channel).private,
                          protected: !!channel.protected,

                          permissions,
                      },
                  ]
                : [];
        });
    const publishChannels = () => {
        for (const socket of io.sockets.sockets.values()) {
            const user = userFor(socket.data.token);
            if (user) socket.emit('channels', channelsFor(user));
        }
        io.emit('refresh');
    };
    return {
        membershipFor,
        categoryPermissions,
        categoriesFor,
        channelPermissions,
        permissionDetails,
        canInChannel,
        canInRoom,
        canRead,
        canJoin,
        hasRoom,
        canWrite,
        channelsFor,
        publishChannels,
        channelPermissionIds,
    };
}
