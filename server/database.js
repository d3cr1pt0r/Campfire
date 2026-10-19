import { migratePermissions, permissionIds, memberPermissions } from '../shared/permissions.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
        () => {
            db.exec(`ALTER TABLE channels ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;
                INSERT INTO channels(id,name,kind) SELECT 'general','general','text' WHERE NOT EXISTS(SELECT 1 FROM channels WHERE kind='text');
                INSERT INTO channels(id,name,kind) SELECT 'lounge','lounge','voice' WHERE NOT EXISTS(SELECT 1 FROM channels WHERE kind='voice');
                UPDATE channels SET protected=1 WHERE id=(SELECT id FROM channels WHERE kind='text' ORDER BY (id='general') DESC,rowid LIMIT 1);
                UPDATE channels SET protected=1 WHERE id=(SELECT id FROM channels WHERE kind='voice' ORDER BY (id='lounge') DESC,rowid LIMIT 1);
                CREATE UNIQUE INDEX protected_channel_kind ON channels(kind) WHERE protected=1;
                CREATE TABLE channel_access(channel TEXT REFERENCES channels(id) ON DELETE CASCADE,role TEXT REFERENCES roles(id) ON DELETE CASCADE,mode TEXT NOT NULL CHECK(mode IN ('full','read-only','hidden')),PRIMARY KEY(channel,role));
                CREATE TRIGGER preserve_channels BEFORE DELETE ON channels WHEN OLD.protected=1 OR (SELECT COUNT(*) FROM channels WHERE kind=OLD.kind)<=1 BEGIN SELECT RAISE(ABORT,'Keep the protected text and voice channels'); END;
                CREATE TRIGGER preserve_channel_kind BEFORE UPDATE OF kind,protected ON channels WHEN NEW.kind IS NOT OLD.kind OR NEW.protected IS NOT OLD.protected BEGIN SELECT RAISE(ABORT,'Channel type and protection cannot change'); END;`);
        },
        () => {
            db.exec(`CREATE TRIGGER preserve_default_roles BEFORE DELETE ON roles
                WHEN OLD.id IN ('owner','member') BEGIN SELECT RAISE(ABORT,'Default roles cannot be deleted'); END;
                CREATE TRIGGER preserve_default_role_ids BEFORE UPDATE OF id ON roles
                WHEN OLD.id IN ('owner','member') AND NEW.id IS NOT OLD.id
                BEGIN SELECT RAISE(ABORT,'Default role IDs cannot change'); END;`);
        },
        () => {
            db.exec(`ALTER TABLE messages ADD COLUMN thread TEXT REFERENCES messages(id) ON DELETE CASCADE;
                CREATE INDEX messages_thread_cursor ON messages(thread,room,created,id);
                CREATE TRIGGER valid_message_thread BEFORE INSERT ON messages
                WHEN NEW.thread IS NOT NULL AND NOT EXISTS(
                    SELECT 1 FROM messages WHERE id=NEW.thread AND room=NEW.room AND thread IS NULL
                ) BEGIN SELECT RAISE(ABORT,'Invalid thread parent'); END;
                CREATE TRIGGER immutable_message_thread BEFORE UPDATE OF thread,room ON messages
                WHEN NEW.thread IS NOT OLD.thread OR NEW.room IS NOT OLD.room
                BEGIN SELECT RAISE(ABORT,'Message conversation cannot change'); END;`);
        },
        () => {
            db.exec(`ALTER TABLE channels ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
                UPDATE channels SET position=rowid;
                CREATE INDEX channels_kind_position ON channels(kind,position);`);
        },
        () => {
            db.exec(`INSERT OR IGNORE INTO settings(key,value)
                SELECT 'registrationMode', CASE WHEN EXISTS(SELECT 1 FROM users) THEN 'open' ELSE 'invite' END;
                CREATE TABLE invitations(
                    id TEXT PRIMARY KEY, tokenHash TEXT UNIQUE NOT NULL,
                    label TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
                    usedBy TEXT REFERENCES users(id), revoked INTEGER NOT NULL DEFAULT 0
                );`);
        },
        () => {
            db.exec(`ALTER TABLE channels ADD COLUMN description TEXT NOT NULL DEFAULT '';
                UPDATE channels SET description='A place for everyday conversations.' WHERE kind='text';`);
        },
        () => {
            for (const role of db.prepare('SELECT id,permissions FROM roles').all()) {
                db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(
                    JSON.stringify(
                        role.id === 'owner'
                            ? permissionIds
                            : migratePermissions(JSON.parse(role.permissions)),
                    ),
                    role.id,
                );
            }
        },
        () => {
            db.exec(
                'ALTER TABLE channels ADD COLUMN reactionAuthors INTEGER NOT NULL DEFAULT 1 CHECK(reactionAuthors IN (0,1))',
            );
        },
        () => {
            // Earlier versions served plain HTTP, so session tokens and invitation codes may
            // have been observed in transit. Encrypted transport starts with fresh ones.
            db.exec(`DELETE FROM sessions;
                UPDATE invitations SET revoked=1 WHERE usedBy IS NULL AND revoked=0;`);
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

function communityDatabasePath(dataDir) {
    const current = path.join(dataDir, 'campfire.sqlite');
    const hasAccounts = (filename) => {
        const database = new DatabaseSync(filename, { readOnly: true });
        try {
            if (
                !database
                    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")
                    .get()
            )
                return false;
            return Boolean(database.prepare('SELECT 1 FROM users LIMIT 1').get());
        } finally {
            database.close();
        }
    };
    if (existsSync(current) && hasAccounts(current)) return current;
    // A branding change must not strand an existing community under its previous filename.
    const existing = readdirSync(dataDir, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isFile() &&
                entry.name.endsWith('.sqlite') &&
                entry.name !== 'campfire.sqlite',
        )
        .map((entry) => path.join(dataDir, entry.name))
        .filter(hasAccounts);
    if (existing.length > 1)
        throw new Error(
            'Multiple existing community databases found. Select one by backing up the data directory and moving the intended database to campfire.sqlite while the server is stopped.',
        );
    return existing[0] ?? current;
}

export function openDatabase(dataDir, name) {
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(communityDatabasePath(dataDir));
    try {
        db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
        if (!db.prepare('SELECT COUNT(*) n FROM channels').get().n) {
            const insert = db.prepare('INSERT INTO channels(id,name,kind) VALUES(?,?,?)');
            for (const [id, kind] of [
                ['general', 'text'],
                ['introductions', 'text'],
                ['lounge', 'voice'],
            ])
                insert.run(id, id, kind);
        }
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
            JSON.stringify(permissionIds),
        );
        run(
            'INSERT OR IGNORE INTO roles VALUES(?,?,?,?)',
            'member',
            'Member',
            '#a5a8b5',
            JSON.stringify(memberPermissions),
        );
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
    const counts = new Map(
        all(
            `SELECT thread,COUNT(*) count FROM messages WHERE thread IN (${placeholders}) GROUP BY thread`,
            ...ids,
        ).map(({ thread, count }) => [thread, count]),
    );
    return messages.map((m) => ({
        ...m,
        replyCount: counts.get(m.id) || 0,
        attachments: attachments.get(m.id) || [],
        reactions: reactions.get(m.id) || [],
    }));
}
