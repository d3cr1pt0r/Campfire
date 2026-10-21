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
import { isRetentionDays } from '../shared/retention.js';

const format = 'campfire-server-setup';
const serverFields = [
    'name',
    'icon',
    'reactionAuthors',
    'profileFrames',
    'maxUploadBytes',
    'maxStoredUploadBytes',
];

function validateSnapshot(value) {
    if (
        value?.format !== format ||
        ![1, 2].includes(value.version) ||
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
    // Snapshots from databases without retention have none; they restore the defaults.
    if (
        value.retention !== undefined &&
        (!isRetentionDays(value.retention?.server) ||
            !isRetentionDays(value.retention.dm) ||
            typeof value.retention.keepText !== 'boolean')
    )
        throw new Error('Snapshot contains invalid retention settings');
    if (value.version === 2 || value.channels !== undefined) {
        if (
            !Array.isArray(value.channels) ||
            new Set(value.channels.map((c) => c.key)).size !== value.channels.length ||
            value.channels.some(
                (c) =>
                    typeof c.key !== 'string' ||
                    !['text', 'voice'].includes(c.kind) ||
                    typeof c.protected !== 'boolean' ||
                    typeof c.private !== 'boolean' ||
                    typeof c.reactionAuthors !== 'boolean' ||
                    (c.retention !== null && !isRetentionDays(c.retention)) ||
                    !Array.isArray(c.overrides) ||
                    c.overrides.some((o) => !keys.includes(o.role)),
            ) ||
            !['text', 'voice'].every(
                (kind) => value.channels.filter((c) => c.kind === kind && c.protected).length === 1,
            )
        )
            throw new Error('Snapshot contains invalid channels or role references');
    }
    if (value.categories !== undefined) {
        const categories = value.categories;
        if (
            !Array.isArray(categories) ||
            new Set(categories.map((c) => c.key)).size !== categories.length ||
            categories.some(
                (c) =>
                    typeof c.key !== 'string' ||
                    typeof c.name !== 'string' ||
                    typeof c.private !== 'boolean' ||
                    !Array.isArray(c.overrides) ||
                    c.overrides.some((o) => !keys.includes(o.role)),
            ) ||
            value.channels?.some(
                (c) =>
                    c.category != null &&
                    (!categories.some((entry) => entry.key === c.category) ||
                        typeof c.synced !== 'boolean'),
            )
        )
            throw new Error('Snapshot contains invalid categories or membership references');
    }
    return value;
}

// The retention the owner last chose. A pending change counts as made: a reset community has
// no messages for its notice week to protect.
function captureRetention(get) {
    if (!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_policies'"))
        return undefined;
    const period = (scope) => {
        const policy = get('SELECT * FROM retention_policies WHERE scope=?', scope);
        return policy.retentionAt === null ? policy.retention : policy.retentionNext;
    };
    const mode = get('SELECT keepText,keepTextUntil FROM retention_mode WHERE id=1');
    return {
        server: period('server'),
        dm: period('dm'),
        keepText: !!mode.keepText && mode.keepTextUntil === null,
    };
}

export function captureSetup(dataDir, snapshotFile) {
    const db = new DatabaseSync(path.join(dataDir, 'campfire.sqlite'), { readOnly: true });
    let snapshot;
    try {
        db.exec('BEGIN');
        const all = (sql, ...args) => db.prepare(sql).all(...args);
        const get = (sql, ...args) => db.prepare(sql).get(...args);
        const server = {};
        for (const { key, value } of all('SELECT * FROM settings')) {
            if (![...serverFields, 'registrationMode', 'identity'].includes(key))
                throw new Error(`No setup API mapping for server setting: ${key}`);
            if (['reactionAuthors', 'profileFrames'].includes(key)) {
                if (!['true', 'false'].includes(value)) throw new Error(`Invalid ${key} setting`);
                server[key] = value === 'true';
            } else if (['maxUploadBytes', 'maxStoredUploadBytes'].includes(key))
                server[key] = Number(value);
            else if (key === 'icon') server.icon = value || null;
            else server[key] = value;
        }
        snapshot = validateSnapshot({
            format,
            version: 2,
            created: new Date().toISOString(),
            server,
            retention: captureRetention(get),
            categories: get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='categories'")
                ? all('SELECT * FROM categories ORDER BY position,rowid').map((category) => ({
                      key: category.id,
                      name: category.name,
                      private: !!category.private,
                      overrides: all(
                          'SELECT role,permission,effect FROM category_overrides WHERE category=? ORDER BY role,permission',
                          category.id,
                      ).map((row) => ({ ...row })),
                  }))
                : [],
            channels: all('SELECT * FROM channels ORDER BY position,rowid').map((c) => ({
                key: c.id,
                ...(get(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_channels'",
                )
                    ? (() => {
                          const membership = get(
                              'SELECT * FROM category_channels WHERE channel=?',
                              c.id,
                          );
                          return {
                              category: membership?.category ?? null,
                              synced: !!membership?.synced,
                          };
                      })()
                    : { category: null, synced: false }),
                name: c.name,
                kind: c.kind,
                protected: !!c.protected,
                description: c.description,
                reactionAuthors: !!c.reactionAuthors,
                private: !!c.private,
                retention: (c.retentionAt == null ? c.retention : c.retentionNext) ?? null,
                overrides: all(
                    'SELECT role,permission,effect FROM channel_overrides WHERE channel=? ORDER BY role,permission',
                    c.id,
                ).map((row) => ({ ...row })),
            })),
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
    if (snapshot.retention) {
        const { server, dm, keepText } = snapshot.retention;
        // Nothing is old enough to delete yet, so every change applies at once.
        await api('PATCH', '/retention/keep-text', { keepText, applyNow: true });
        await api('PATCH', '/retention/server', { retention: server, applyNow: true });
        await api('PATCH', '/retention/dm', { retention: dm, applyNow: true });
    }
    const channels = new Map();
    if (snapshot.channels) {
        const defaults = (await api('GET', '/state')).channels;
        for (const c of snapshot.channels) {
            const id = c.protected
                ? defaults.find((entry) => entry.kind === c.kind && entry.protected).id
                : (await api('POST', '/channels', { name: c.name, kind: c.kind })).id;
            channels.set(c.key, id);
            await api('PATCH', `/channels/${id}`, {
                name: c.name,
                ...(c.kind === 'text'
                    ? { description: c.description, reactionAuthors: c.reactionAuthors }
                    : {}),
            });
            await api('PATCH', `/channels/${id}/privacy`, { private: c.private });
            if (c.kind === 'text')
                await api('PATCH', `/retention/channels/${id}`, {
                    retention: c.retention,
                    applyNow: true,
                });
        }
        for (const c of defaults.filter((entry) => !entry.protected))
            await api('DELETE', `/channels/${c.id}`);
        for (const kind of ['text', 'voice']) {
            const ordered = snapshot.channels.filter((c) => c.kind === kind);
            for (let i = 1; i < ordered.length; i++)
                await api('POST', `/channels/${channels.get(ordered[i].key)}/drop`, {
                    target: channels.get(ordered[i - 1].key),
                    placement: 'after',
                });
        }
        for (const role of snapshot.roles) {
            const overrides = snapshot.channels.flatMap((c) =>
                c.overrides
                    .filter((o) => o.role === role.key)
                    .map(({ role: ignored, ...o }) => ({ ...o, channel: channels.get(c.key) })),
            );
            if (overrides.length) {
                const { key, ...body } = role;
                await api('PATCH', `/roles/${roles.get(key)}`, { ...body, overrides });
            }
        }
    }
    const categories = new Map();
    for (const category of snapshot.categories || []) {
        const { id } = await api('POST', '/categories', { name: category.name });
        categories.set(category.key, id);
        await api('PATCH', `/categories/${id}`, { private: category.private });
        for (const role of snapshot.roles) {
            const overrides = category.overrides
                .filter((entry) => entry.role === role.key)
                .map(({ role: ignored, ...entry }) => entry);
            if (overrides.length)
                await api('PUT', `/categories/${id}/access`, {
                    role: roles.get(role.key),
                    overrides,
                });
        }
    }
    for (const channel of snapshot.channels || [])
        if (channel.category)
            await api('PUT', `/channels/${channels.get(channel.key)}/category`, {
                category: categories.get(channel.category),
                synced: channel.synced,
            });
    // Restore the visible mixed text/voice order within each category (and the top level).
    const previousInCategory = new Map();
    for (const channel of snapshot.channels || []) {
        const category = channel.category ? categories.get(channel.category) : null;
        await api('POST', `/channels/${channels.get(channel.key)}/place`, {
            category,
            placement: 'after',
            target: previousInCategory.get(category) ?? null,
        });
        previousInCategory.set(category, channels.get(channel.key));
    }
    return { accounts, roles, channels, categories };
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
        if (
            snapshot.channels &&
            db.prepare('SELECT COUNT(*) n FROM channels').get().n !== snapshot.channels.length
        )
            throw new Error('Restored channel count does not match the snapshot');
        if (
            snapshot.categories &&
            db.prepare('SELECT COUNT(*) n FROM categories').get().n !== snapshot.categories.length
        )
            throw new Error('Restored category count does not match the snapshot');
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
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
