import { canReadRoom } from './security.js';

export function createChannelAccess({ get, all, can, userFor, io }) {
    const mode = (user, channel) => {
        if (!user || !channel) return 'hidden';
        if (user.role === 'owner') return 'full';
        return (
            get('SELECT mode FROM channel_access WHERE channel=? AND role=?', channel.id, user.role)
                ?.mode || 'full'
        );
    };
    const canRead = (user, channel) => channel?.kind === 'text' && mode(user, channel) !== 'hidden';
    const canJoin = (user, channel) =>
        channel?.kind === 'voice' && can(user, 'calls.join') && mode(user, channel) === 'full';
    const hasRoom = (user, room) =>
        canReadRoom(
            user.id,
            room,
            (id) => canRead(user, get('SELECT * FROM channels WHERE id=?', id)),
            (id) => !!get('SELECT id FROM users WHERE id=?', id),
        );
    const isWritable = (user, room) =>
        !!user &&
        hasRoom(user, room) &&
        (room.startsWith('dm:') ||
            mode(user, get('SELECT * FROM channels WHERE id=?', room)) === 'full');
    const canWrite = (user, room) =>
        !!user &&
        can(user, 'messages.send') &&
        hasRoom(user, room) &&
        (room.startsWith('dm:') ||
            mode(user, get('SELECT * FROM channels WHERE id=?', room)) === 'full');
    const channelsFor = (user) => {
        const overrides = new Map(
            all('SELECT channel,mode FROM channel_access WHERE role=?', user.role).map((entry) => [
                entry.channel,
                entry.mode,
            ]),
        );
        return all(
            "SELECT * FROM channels ORDER BY CASE kind WHEN 'text' THEN 0 ELSE 1 END,position,rowid",
        ).flatMap((channel) => {
            const access = user.role === 'owner' ? 'full' : overrides.get(channel.id) || 'full';
            if (access === 'hidden' || (channel.kind === 'voice' && access !== 'full')) return [];
            return [
                {
                    ...channel,
                    protected: !!channel.protected,
                    access:
                        channel.kind === 'text' && access === 'read-only' ? 'read-only' : 'full',
                },
            ];
        });
    };
    const publishChannels = () => {
        for (const socket of io.sockets.sockets.values()) {
            const user = userFor(socket.data.token);
            if (user) socket.emit('channels', channelsFor(user));
        }
        io.emit('refresh');
    };
    return { isWritable, mode, canRead, canJoin, hasRoom, canWrite, channelsFor, publishChannels };
}
