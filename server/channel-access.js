import { canReadRoom } from './security.js';
import { channelPermissionIds, effectiveRoleIds } from '../shared/permissions.js';

export function createChannelAccess({ get, all, permissionsFor, roleIds, userFor, io }) {
    const channelPermissions = (user, channel, memberships) => {
        if (!user || !channel) return [];
        if (user.owner) return permissionsFor(user);
        const permissions = new Set(permissionsFor(user, memberships));
        if (channel.private) permissions.delete('channels.view');
        const overrides = all('SELECT * FROM channel_overrides WHERE channel=?', channel.id);
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
    const permissionDetails = (user, channel) => {
        const permissions = channelPermissions(user, channel);
        const roles = all('SELECT * FROM roles WHERE id<>?', 'owner').filter((role) =>
            roleIds(user).includes(role.id),
        );
        const entries = all('SELECT * FROM channel_overrides WHERE channel=?', channel.id);
        const details = channelPermissionIds(channel.kind).map((permission) => {
            let sources = roles
                .filter((role) => JSON.parse(role.permissions).includes(permission))
                .map((role) => role.name);
            let reason = sources.length
                ? `Server roles: ${sources.join(', ')}`
                : 'No server role grants this permission';
            if (permission === 'channels.view' && channel.private)
                reason = 'Private channel default';
            const baseline = entries.find(
                (entry) =>
                    roleIds(user).includes('everyone') &&
                    entry.role === 'everyone' &&
                    entry.permission === permission,
            );
            if (baseline)
                reason = `${roles.find((role) => role.id === 'everyone')?.name || 'Default'} channel override: ${baseline.effect}`;
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
                reason = `Channel ${allows.length ? 'allow' : 'deny'}: ${winners.map((entry) => roles.find((role) => role.id === entry.role)?.name).join(', ')}`;
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
        all(
            "SELECT * FROM channels ORDER BY CASE kind WHEN 'text' THEN 0 ELSE 1 END,position,rowid",
        ).flatMap((channel) => {
            const permissions = channelPermissions(user, channel);
            return permissions.includes('channels.view')
                ? [
                      {
                          ...channel,
                          protected: !!channel.protected,
                          private: !!channel.private,
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
