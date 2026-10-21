import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApp } from '../server/app.js';

const format = 'campfire-server-setup';
const serverFields = ['name', 'icon', 'reactionAuthors', 'profileFrames', 'maxUploadBytes'];

function validateSnapshot(value) {
    if (
        value?.format !== format ||
        value.version !== 1 ||
        !value.server ||
        !Array.isArray(value.roles) ||
        !Array.isArray(value.users) ||
        !value.users.length
    )
        throw new Error('Unsupported server setup snapshot');
    if (
        value.users.filter((user) => user.owner === true).length !== 1 ||
        value.users.some(
            (user) =>
                typeof user.owner !== 'boolean' ||
                typeof user.banned !== 'boolean' ||
                !Array.isArray(user.roles) ||
                typeof user.username !== 'string',
        ) ||
        value.users.some((user) => user.owner && user.banned)
    )
        throw new Error('Snapshot must contain exactly one active owner and valid accounts');
    const keys = value.roles.map((role) => role.key);
    if (
        new Set(keys).size !== keys.length ||
        keys.some((key) => typeof key !== 'string') ||
        !['owner', 'everyone'].every((key) => keys.includes(key)) ||
        value.users.some((user) =>
            user.roles.some((key) => !keys.includes(key) || ['owner', 'everyone'].includes(key)),
        )
    )
        throw new Error('Snapshot contains invalid role references');
    if (
        Object.keys(value.server).some(
            (key) => ![...serverFields, 'registrationMode', 'identity'].includes(key),
        )
    )
        throw new Error('Snapshot contains unsupported server settings');
    return value;
}

export function captureSetup(dataDir, snapshotFile) {
    const db = new DatabaseSync(path.join(dataDir, 'campfire.sqlite'), { readOnly: true });
    let snapshot;
    try {
        db.exec('BEGIN');
        const all = (sql, ...args) => db.prepare(sql).all(...args);
        const server = {};
        for (const { key, value } of all('SELECT * FROM settings')) {
            if (![...serverFields, 'registrationMode', 'identity'].includes(key))
                throw new Error(`No setup API mapping for server setting: ${key}`);
            if (['reactionAuthors', 'profileFrames'].includes(key)) {
                if (!['true', 'false'].includes(value)) throw new Error(`Invalid ${key} setting`);
                server[key] = value === 'true';
            } else if (key === 'maxUploadBytes') server[key] = Number(value);
            else if (key === 'icon') server.icon = value || null;
            else server[key] = value;
        }
        snapshot = validateSnapshot({
            format,
            version: 1,
            created: new Date().toISOString(),
            server,
            roles: all('SELECT * FROM roles ORDER BY position,id').map((role) => ({
                key: role.id,
                name: role.name,
                color: role.color,
                permissions: JSON.parse(role.permissions),
            })),
            users: all('SELECT * FROM users ORDER BY owner DESC,username').map((user) => {
                const profile = db
                    .prepare('SELECT nickname,frame FROM profiles WHERE user=?')
                    .get(user.id);
                const presence = db
                    .prepare('SELECT status FROM presence_preferences WHERE user=?')
                    .get(user.id);
                return {
                    username: user.username,
                    passwordHash: user.password,
                    owner: !!user.owner,
                    banned: !!user.banned,
                    roles: all(
                        'SELECT role FROM user_roles WHERE user=? ORDER BY role',
                        user.id,
                    ).map((row) => row.role),
                    ...(profile ? { profile: { ...profile } } : {}),
                    ...(presence ? { presence: presence.status } : {}),
                };
            }),
        });
        db.exec('COMMIT');
    } finally {
        db.close();
    }
    mkdirSync(path.dirname(snapshotFile), { recursive: true, mode: 0o700 });
    writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
    });
    return snapshot;
}

// The write path only speaks the server API. No account/role/settings SQL lives here.
export async function populateSetup(snapshot, api) {
    validateSnapshot(snapshot);
    const roles = new Map();
    for (const role of snapshot.roles) {
        const { key, ...body } = role;
        if (['everyone', 'owner'].includes(key)) {
            await api('PATCH', `/roles/${key}`, body);
            roles.set(key, key);
        } else {
            const result = await api('POST', '/roles', body);
            roles.set(key, result.id);
        }
    }
    const accounts = new Map();
    // The server makes the first restored account the owner, just like normal setup.
    for (const user of [...snapshot.users].sort((a, b) => Number(b.owner) - Number(a.owner))) {
        const { id } = await api('POST', '/setup/users', {
            username: user.username,
            passwordHash: user.passwordHash,
        });
        accounts.set(user.username, id);
        await api('PATCH', `/users/${id}/roles`, {
            roles: user.roles.map((key) => roles.get(key)),
        });
        if (user.profile) await api('PATCH', '/profile', user.profile, id);
        if (user.presence !== undefined)
            await api('PATCH', '/presence', { status: user.presence }, id);
        if (user.banned) await api('POST', `/users/${id}/access`, { enabled: false });
    }
    const { registrationMode, identity, ...settings } = snapshot.server;
    if (Object.keys(settings).length) await api('PATCH', '/settings', settings);
    if (registrationMode !== undefined)
        await api('PATCH', '/registration', { mode: registrationMode });
    if (identity) await api('PUT', '/setup/identity', { fingerprint: identity });
    return { accounts, roles };
}

function verifyDatabase(filename, snapshot) {
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
        if (
            db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
            db.prepare('PRAGMA foreign_key_check').all().length
        )
            throw new Error('Restored database failed integrity checks');
        if (
            db.prepare('SELECT COUNT(*) n FROM users').get().n !== snapshot.users.length ||
            db.prepare('SELECT COUNT(*) n FROM roles').get().n !== snapshot.roles.length ||
            db.prepare('SELECT COUNT(*) n FROM users WHERE owner=1 AND banned=0').get().n !== 1
        )
            throw new Error('Restored account/role counts do not match the snapshot');
        for (const table of [
            'messages',
            'attachments',
            'sessions',
            'invitations',
            'password_resets',
        ])
            if (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)
                throw new Error(`Unexpected ${table} in the fresh database`);
    } finally {
        db.close();
    }
}

export async function resetSetup(dataDir, snapshotFile) {
    const snapshot = validateSnapshot(JSON.parse(readFileSync(snapshotFile, 'utf8')));
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const staging = mkdtempSync(path.join(dataDir, '.setup-reset-'));
    const replacement = path.join(staging, 'campfire.sqlite');
    const target = path.join(dataDir, 'campfire.sqlite');
    let backup = null;
    try {
        const token = randomBytes(32).toString('hex');
        const service = createApp({
            dataDir: staging,
            setupRestoreToken: token,
            linkPreviews: false,
        });
        try {
            await new Promise((resolve, reject) => {
                service.http.once('error', reject);
                service.http.listen(0, '127.0.0.1', resolve);
            });
            const origin = `http://127.0.0.1:${service.http.address().port}`;
            await populateSetup(snapshot, async (method, endpoint, body, user) => {
                const response = await fetch(`${origin}/api${endpoint}`, {
                    method,
                    headers: {
                        authorization: `Bearer ${token}`,
                        'content-type': 'application/json',
                        ...(user ? { 'x-setup-user': user } : {}),
                    },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(10000),
                });
                const result = await response.json();
                if (!response.ok)
                    throw new Error(`${method} ${endpoint}: ${result.error || response.status}`);
                return result;
            });
        } finally {
            await service.close();
        }
        verifyDatabase(replacement, snapshot);
        chmodSync(replacement, 0o600);
        if (existsSync(target)) {
            const current = new DatabaseSync(target);
            try {
                current.exec('PRAGMA busy_timeout=1000');
                // Consolidate committed WAL contents before moving the whole file.
                // An attached WAL connection (e.g. a running server) refuses this switch.
                if (current.prepare('PRAGMA journal_mode=DELETE').get().journal_mode !== 'delete')
                    throw new Error('Stop the server before resetting the database');
            } finally {
                current.close();
            }
            const directory = mkdtempSync(path.join(dataDir, 'before-reset-'));
            backup = path.join(directory, 'campfire.sqlite');
            renameSync(target, backup);
        } else if (existsSync(`${target}-wal`) || existsSync(`${target}-shm`)) {
            throw new Error('Database sidecars exist without the original database');
        }
        try {
            if (backup) chmodSync(backup, 0o600);
            renameSync(replacement, target);
        } catch (error) {
            if (backup) renameSync(backup, target);
            throw error;
        }
        return { snapshot, backup };
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}

async function main() {
    process.umask(0o077);
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: { 'data-dir': { type: 'string' }, snapshot: { type: 'string' } },
    });
    const [command] = positionals;
    if (positionals.length !== 1 || !['capture', 'reset'].includes(command))
        throw new Error(
            'Usage: npm run setup:capture|setup:reset -- [--data-dir data] [--snapshot .private/server-setup.json]',
        );
    const dataDir = path.resolve(values['data-dir'] || process.env.DATA_DIR || 'data');
    const snapshotFile = path.resolve(values.snapshot || '.private/server-setup.json');
    const result =
        command === 'capture'
            ? { snapshot: captureSetup(dataDir, snapshotFile) }
            : await resetSetup(dataDir, snapshotFile);
    console.log(
        `${command === 'capture' ? 'Saved' : 'Restored'} ${result.snapshot.users.length} accounts and ${result.snapshot.roles.length} roles. Snapshot: ${snapshotFile}`,
    );
    if (result.backup) console.log(`Previous database backup: ${result.backup}`);
    if (command === 'reset') console.log('Fresh database ready. You can start the server.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await main();
    } catch (error) {
        console.error(`Server setup failed: ${error.message}`);
        process.exitCode = 1;
    }
}
