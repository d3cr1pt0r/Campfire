import { permissionIds } from '../shared/permissions.js';
export function check(ok, message, status = 400) {
    if (!ok) throw Object.assign(new Error(message), { status });
}

export const route = (fn) => (req, res, next) => {
    try {
        Promise.resolve(fn(req, res)).catch(next);
    } catch (error) {
        next(error);
    }
};

export function validateRole({ name, color, permissions }) {
    check(
        typeof name === 'string' &&
            name.trim().length > 0 &&
            name.length <= 32 &&
            (color === null || (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) &&
            Array.isArray(permissions) &&
            permissions.every((p) => permissionIds.includes(p)),
        'Invalid role',
    );
    return { name: name.trim(), color, permissions: [...new Set(permissions)] };
}

export function originPolicy(origins = []) {
    return (origin, host) =>
        !origin ||
        origins.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        origin === `http://${host}` ||
        origin === `https://${host}`;
}

// Bound both entry lifetime and cardinality. A full limiter fails closed rather
// than evicting an active address and allowing it to reset its allowance.
export function createRateLimit({
    maximum = 20,
    windowMs = 60000,
    capacity = 10000,
    now = Date.now,
} = {}) {
    const entries = new Map();
    return (key) => {
        const time = now();
        for (const [address, entry] of entries)
            if (time - entry.time >= windowMs) entries.delete(address);
        let entry = entries.get(key);
        if (!entry) {
            check(entries.size < capacity, 'Authentication is busy. Try again in a minute.', 429);
            entry = { count: 0, time };
            entries.set(key, entry);
        }
        check(++entry.count <= maximum, 'Too many attempts. Try again in a minute.', 429);
    };
}
