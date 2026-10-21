import { permissionIds, memberPermissions } from '../shared/permissions.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadPolls, pollData } from './poll-view.js';

export function transaction(db, action) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = action();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

const hasAccounts = (filename) => {
    const database = new DatabaseSync(filename, { readOnly: true });
    try {
        return Boolean(
            database
                .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")
                .get() && database.prepare('SELECT 1 FROM users LIMIT 1').get(),
        );
    } finally {
        database.close();
    }
};

// Databases are not upgraded in place. Anything this version can't open as it is gets a
// clear refusal instead of a confusing failure or an empty community.
function databasePath(dataDir) {
    const current = path.join(dataDir, 'campfire.sqlite');
    if (existsSync(current) && hasAccounts(current)) return current;
    const earlier = readdirSync(dataDir).find(
        (name) =>
            name.endsWith('.sqlite') &&
            name !== 'campfire.sqlite' &&
            hasAccounts(path.join(dataDir, name)),
    );
    if (earlier)
        throw new Error(
            `Found the community database ${earlier} under an earlier name. Stop the server and rename it to campfire.sqlite to keep using it.`,
        );
    return current;
}
function checkCurrent(db) {
    const users = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")
        .get();
    // profiles.frame is the newest part of the schema, so its absence marks an older database.
    const frame = db
        .prepare("SELECT 1 FROM pragma_table_info('profiles') WHERE name='frame'")
        .get();
    if (users && !frame)
        throw new Error(
            'This database was created by an older Campfire version, and this version no longer upgrades databases. Upgrade it first by starting a Campfire build up to commit e1d6373 once, or use a new data directory.',
        );
}

export function openDatabase(dataDir, name) {
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(databasePath(dataDir));
    try {
        checkCurrent(db);
        db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
        db.function('contains_text', (text, search) =>
            Number(text.toLowerCase().includes(search.toLowerCase())),
        );
        const run = (sql, ...params) => db.prepare(sql).run(...params);
        const get = (sql, ...params) => db.prepare(sql).get(...params);
        const all = (sql, ...params) => db.prepare(sql).all(...params);
        // A new community starts with these; existing rows are never touched.
        if (!get('SELECT 1 FROM channels LIMIT 1')) {
            const everyday = 'A place for everyday conversations.';
            for (const channel of [
                ['general', 'text', 1, 1, everyday],
                ['introductions', 'text', 0, 2, everyday],
                ['lounge', 'voice', 1, 3, ''],
            ])
                run(
                    'INSERT INTO channels(id,name,kind,protected,position,description) VALUES(?,?,?,?,?,?)',
                    channel[0],
                    ...channel,
                );
        }
        run(
            'INSERT OR IGNORE INTO roles(id,name,color,permissions) VALUES(?,?,?,?)',
            'everyone',
            'Default',
            null,
            JSON.stringify(memberPermissions),
        );
        run(
            'INSERT OR IGNORE INTO roles(id,name,color,permissions) VALUES(?,?,?,?)',
            'owner',
            'Owner',
            '#f3be57',
            JSON.stringify(permissionIds),
        );
        run('INSERT OR IGNORE INTO settings VALUES(?,?)', 'registrationMode', 'invite');
        run('INSERT OR IGNORE INTO settings VALUES(?,?)', 'name', name);
        return { db, run, get, all };
    } catch (error) {
        db.close();
        throw error;
    }
}

const imageMimes = /^image\/(png|jpeg|gif|webp)$/;

// describeImage measures an image attachment uploaded before sizes were stored.
export function messageViews(all, messages, describeImage = () => null) {
    if (!messages.length) return [];
    const ids = messages.map((m) => m.id),
        placeholders = ids.map(() => '?').join(',');
    const attachments = new Map(),
        reactions = new Map();
    // Measuring reads the whole image, so older uploads are measured a few per request.
    let unmeasured = 20;
    for (const { message, width, height, animated, ...value } of all(
        `SELECT a.message,a.id,a.name,a.mime,i.width,i.height,i.animated FROM attachments a LEFT JOIN attachment_images i ON i.attachment=a.id WHERE a.message IN (${placeholders})`,
        ...ids,
    )) {
        const size =
            width != null
                ? { width, height, animated: !!animated }
                : imageMimes.test(value.mime) && unmeasured-- > 0
                  ? describeImage(value.id)
                  : null;
        if (size?.width) Object.assign(value, size);
        if (!attachments.has(message)) attachments.set(message, []);
        attachments.get(message).push(value);
    }
    for (const { message, ...value } of all(
        `SELECT message,user,emoji FROM reactions WHERE message IN (${placeholders})`,
        ...ids,
    )) {
        if (!reactions.has(message)) reactions.set(message, []);
        reactions.get(message).push(value);
    }
    const counts = new Map(
        all(
            `SELECT thread,COUNT(*) count FROM messages WHERE thread IN (${placeholders}) GROUP BY thread`,
            ...ids,
        ).map(({ thread, count }) => [thread, count]),
    );
    const voiceInvitations = new Map(
        all(
            `SELECT message,channel,name FROM voice_channel_invitations WHERE message IN (${placeholders})`,
            ...ids,
        ).map(({ message, ...invite }) => [message, invite]),
    );
    const polls = loadPolls(all, ids);
    return messages.map((m) => {
        const view = {
            ...m,
            replyCount: counts.get(m.id) || 0,
            attachments: attachments.get(m.id) || [],
            reactions: reactions.get(m.id) || [],
        };
        if (voiceInvitations.has(m.id)) view.voiceInvite = voiceInvitations.get(m.id);
        if (polls.has(m.id)) view[pollData] = polls.get(m.id);
        return view;
    });
}
