import { permissionIds, memberPermissions } from '../shared/permissions.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
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

// Databases are not upgraded in place, so an older one is refused instead of failing oddly.
function checkCurrent(db) {
    const users = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")
        .get();
    // attachments.removed is the newest part of the schema, so its absence marks an older database.
    const current = db
        .prepare("SELECT 1 FROM pragma_table_info('attachments') WHERE name='removed'")
        .get();
    if (users && !current)
        throw new Error(
            'This database was created by an older Campfire version, which this version cannot open. Use a new data directory.',
        );
}

export function openDatabase(dataDir, name) {
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, 'campfire.sqlite'));
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

export function messageViews(all, messages) {
    if (!messages.length) return [];
    const ids = messages.map((m) => m.id),
        placeholders = ids.map(() => '?').join(',');
    const attachments = new Map(),
        reactions = new Map();
    for (const { message, width, height, animated, removed, ...value } of all(
        `SELECT a.message,a.id,a.name,a.mime,a.removed,i.width,i.height,i.animated FROM attachments a LEFT JOIN attachment_images i ON i.attachment=a.id WHERE a.message IN (${placeholders})`,
        ...ids,
    )) {
        // Removed files stay as placeholders; zero sizes mark images whose header could not be read.
        if (removed) value.removed = true;
        else if (width) Object.assign(value, { width, height, animated: !!animated });
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
    // A thread is deleted as a unit, so replies carry their thread's retention clock.
    const units = [...new Set(messages.map((m) => m.thread || m.id))],
        unitPlaceholders = units.map(() => '?').join(',');
    const clocks = new Map(
        all(
            `SELECT COALESCE(m.thread,m.id) unit,COUNT(m.thread) replies,MAX(m.since) since,MAX(m.pinned) kept,MAX(p.ends) pollEnds FROM messages m LEFT JOIN polls p ON p.message=m.id WHERE m.id IN (${unitPlaceholders}) OR m.thread IN (${unitPlaceholders}) GROUP BY unit`,
            ...units,
            ...units,
        ).map(({ unit, ...clock }) => [unit, clock]),
    );
    const voiceInvitations = new Map(
        all(
            `SELECT message,channel,name FROM voice_channel_invitations WHERE message IN (${placeholders})`,
            ...ids,
        ).map(({ message, ...invite }) => [message, invite]),
    );
    const polls = loadPolls(all, ids);
    const cards = new Map();
    for (const { message, ...card } of all(
        `SELECT l.message,p.id,p.url,p.title,p.description,p.site,p.image IS NOT NULL image,p.image_width width,p.image_height height,p.large,p.video FROM message_link_previews l JOIN link_previews p ON p.id=l.preview WHERE l.message IN (${placeholders}) AND p.failed=0 ORDER BY l.message,l.position`,
        ...ids,
    )) {
        if (!cards.has(message)) cards.set(message, []);
        cards
            .get(message)
            .push({ ...card, image: !!card.image, large: !!card.large, video: !!card.video });
    }
    return messages.map((m) => {
        const clock = clocks.get(m.thread || m.id);
        const view = {
            ...m,
            replyCount: m.thread ? 0 : clock?.replies || 0,
            attachments: attachments.get(m.id) || [],
            reactions: reactions.get(m.id) || [],
            retention: {
                since: clock?.since ?? m.since,
                kept: !!clock?.kept,
                pollEnds: clock?.pollEnds ?? null,
            },
        };
        if (voiceInvitations.has(m.id)) view.voiceInvite = voiceInvitations.get(m.id);
        if (polls.has(m.id)) view[pollData] = polls.get(m.id);
        if (cards.has(m.id)) view.previews = cards.get(m.id);
        return view;
    });
}
