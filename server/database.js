import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalRoom } from '../shared/rooms.js';

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

export function migrate(db) {
    db.exec(
        'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied INTEGER NOT NULL)',
    );
    const migrations = [
        () => {
            const update = db.prepare('UPDATE messages SET room=? WHERE room=?');
            for (const { room } of db
                .prepare("SELECT DISTINCT room FROM messages WHERE room LIKE 'dm:%'")
                .all()) {
                const canonical = canonicalRoom(room);
                if (room !== canonical) update.run(canonical, room);
            }
            db.exec('CREATE INDEX IF NOT EXISTS messages_room_cursor ON messages(room,created,id)');
        },
        () => {
            db.exec('ALTER TABLE attachments ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0');
            // Base64 length minus padding gives the original binary byte count.
            db.exec(
                "UPDATE attachments SET bytes=(length(data)*3)/4-CASE WHEN data LIKE '%==' THEN 2 WHEN data LIKE '%=' THEN 1 ELSE 0 END",
            );
            db.exec(
                'CREATE TABLE storage_usage(id INTEGER PRIMARY KEY CHECK(id=1),bytes INTEGER NOT NULL)',
            );
            db.exec('INSERT INTO storage_usage SELECT 1,COALESCE(SUM(bytes),0) FROM attachments');
            db.exec(`CREATE TRIGGER attachment_usage_insert AFTER INSERT ON attachments BEGIN UPDATE storage_usage SET bytes=bytes+NEW.bytes WHERE id=1; END;
                CREATE TRIGGER attachment_usage_delete AFTER DELETE ON attachments BEGIN UPDATE storage_usage SET bytes=bytes-OLD.bytes WHERE id=1; END;
                CREATE TRIGGER attachment_usage_update AFTER UPDATE OF bytes ON attachments BEGIN UPDATE storage_usage SET bytes=bytes+NEW.bytes-OLD.bytes WHERE id=1; END;`);
        },
    ];
    migrations.forEach((apply, index) => {
        const version = index + 1;
        if (db.prepare('SELECT 1 FROM migrations WHERE version=?').get(version)) return;
        transaction(db, () => {
            apply();
            db.prepare('INSERT INTO migrations VALUES(?,?)').run(version, Date.now());
        });
    });
}

export function openDatabase(dataDir, name) {
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, 'driskord.sqlite'));
    try {
        db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
        migrate(db);
        db.function('contains_text', (text, search) =>
            Number(text.toLowerCase().includes(search.toLowerCase())),
        );
        const run = (sql, ...params) => db.prepare(sql).run(...params);
        const get = (sql, ...params) => db.prepare(sql).get(...params);
        const all = (sql, ...params) => db.prepare(sql).all(...params);
        run(
            'INSERT OR IGNORE INTO roles VALUES(?,?,?,?)',
            'owner',
            'Owner',
            '#f3be57',
            JSON.stringify(['manage', 'send', 'voice']),
        );
        run(
            'INSERT OR IGNORE INTO roles VALUES(?,?,?,?)',
            'member',
            'Member',
            '#a5a8b5',
            JSON.stringify(['send', 'voice']),
        );
        for (const [id, kind] of [
            ['general', 'text'],
            ['introductions', 'text'],
            ['lounge', 'voice'],
        ])
            run('INSERT OR IGNORE INTO channels VALUES(?,?,?)', id, id, kind);
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
    for (const { message, ...value } of all(
        `SELECT message,id,name,mime FROM attachments WHERE message IN (${placeholders})`,
        ...ids,
    )) {
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
    return messages.map((m) => ({
        ...m,
        attachments: attachments.get(m.id) || [],
        reactions: reactions.get(m.id) || [],
    }));
}
