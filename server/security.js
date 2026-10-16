import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function createPassword(password) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
    const [salt, digest] = (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex')) && !!stored;
}
export function hasPermission(user, permissions, permission) {
    return user.role === 'owner' || permissions.includes(permission);
}
export function canReadRoom(userId, room, channelExists, userExists) {
    if (channelExists(room))
        return true;
    const parts = room.split(':');
    return parts.length === 3 && parts[0] === 'dm' && parts.slice(1).includes(userId) && parts[1] !== parts[2] && parts.slice(1).every(userExists);
}
