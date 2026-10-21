import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
let active = 0;
const waiting = [];
async function passwordKey(password, salt) {
    if (active >= 4) {
        if (waiting.length >= 32)
            throw Object.assign(new Error('Authentication is busy. Try again shortly.'), {
                status: 503,
            });
        await new Promise((resolve) => waiting.push(resolve));
    } else active++;
    try {
        return await derive(password, salt, 64);
    } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
    }
}
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export async function createPassword(password) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${(await passwordKey(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password, stored) {
    const [salt, digest] = (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = await passwordKey(password, salt);
    const expected = Buffer.from(digest || '', 'hex');
    return expected.length === actual.length && timingSafeEqual(actual, expected) && !!stored;
}
export function canReadRoom(userId, room, channelExists, userExists) {
    if (channelExists(room)) return true;
    const parts = room.split(':');
    return (
        parts.length === 3 &&
        parts[0] === 'dm' &&
        parts.slice(1).includes(userId) &&
        parts.slice(1).every(userExists)
    );
}
