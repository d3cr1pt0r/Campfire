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

export function migrate(db, through = Infinity) {
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
            db.exec('DROP TABLE IF EXISTS friends');
        },
        () => {
            // The encryption branch also used version 11; finish friend removal for either history.
            db.exec('DROP TABLE IF EXISTS friends');
            // Earlier versions served plain HTTP, so session tokens and invitation codes may
            // have been observed in transit. Encrypted transport starts with fresh ones.
            db.exec(`DELETE FROM sessions;
                UPDATE invitations SET revoked=1 WHERE usedBy IS NULL AND revoked=0;`);
        },
        () => {
            db.exec(`ALTER TABLE users ADD COLUMN owner INTEGER NOT NULL DEFAULT 0 CHECK(owner IN (0,1));
                UPDATE users SET owner=1 WHERE role='owner';
                CREATE UNIQUE INDEX one_server_owner ON users(owner) WHERE owner=1;
                CREATE TRIGGER preserve_server_owner BEFORE UPDATE OF owner,id,banned ON users
                WHEN OLD.owner=1 AND (NEW.owner<>1 OR NEW.id<>OLD.id OR NEW.banned<>0)
                BEGIN SELECT RAISE(ABORT,'Server ownership is protected'); END;
                CREATE TRIGGER preserve_server_owner_delete BEFORE DELETE ON users WHEN OLD.owner=1
                BEGIN SELECT RAISE(ABORT,'Server ownership is protected'); END;
                ALTER TABLE roles ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
                UPDATE roles SET position=rowid WHERE id<>'owner';
                CREATE TABLE user_roles(user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,PRIMARY KEY(user,role));
                INSERT INTO user_roles SELECT id,role FROM users WHERE role<>'owner';
                ALTER TABLE channels ADD COLUMN private INTEGER NOT NULL DEFAULT 0 CHECK(private IN (0,1));
                CREATE TABLE channel_overrides(channel TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                    role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,permission TEXT NOT NULL,
                    effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),PRIMARY KEY(channel,role,permission));`);
            const roles = db.prepare("SELECT * FROM roles WHERE id<>'owner'").all();
            const grants = roles.map((role) => JSON.parse(role.permissions));
            const baseline = [
                'channels.view',
                ...permissionIds.filter(
                    (p) => grants.length && grants.every((list) => list.includes(p)),
                ),
            ];
            db.prepare(
                'INSERT INTO roles(id,name,color,permissions,position) VALUES(?,?,?,?,0)',
            ).run('everyone', 'Everyone', null, JSON.stringify([...new Set(baseline)]));
            for (const role of roles)
                db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(
                    JSON.stringify([
                        ...new Set([
                            'channels.view',
                            ...JSON.parse(role.permissions).filter((p) =>
                                permissionIds.includes(p),
                            ),
                        ]),
                    ]),
                    role.id,
                );
            const save = db.prepare('INSERT OR REPLACE INTO channel_overrides VALUES(?,?,?,?)');
            for (const channel of db.prepare('SELECT * FROM channels').all()) {
                const entries = db
                    .prepare('SELECT * FROM channel_access WHERE channel=?')
                    .all(channel.id);
                if (entries.some((entry) => entry.mode === 'hidden')) {
                    db.prepare('UPDATE channels SET private=1 WHERE id=?').run(channel.id);
                    for (const role of roles) {
                        if (entries.find((entry) => entry.role === role.id)?.mode !== 'hidden')
                            save.run(channel.id, role.id, 'channels.view', 'allow');
                    }
                }
                for (const entry of entries) {
                    if (entry.role === 'owner') continue;
                    if (entry.mode === 'hidden')
                        save.run(channel.id, entry.role, 'channels.view', 'deny');
                    if (entry.mode === 'read-only')
                        for (const permission of [
                            'messages.send',
                            'files.attach',
                            'reactions.add',
                            'threads.create',
                            'threads.reply',
                        ])
                            save.run(channel.id, entry.role, permission, 'deny');
                }
            }
            db.exec(`DROP TABLE channel_access;
                DROP TRIGGER preserve_default_roles; DROP TRIGGER preserve_default_role_ids;
                CREATE TRIGGER preserve_default_roles BEFORE DELETE ON roles WHEN OLD.id IN ('owner','member','everyone')
                BEGIN SELECT RAISE(ABORT,'Default roles cannot be deleted'); END;
                CREATE TRIGGER preserve_default_role_ids BEFORE UPDATE OF id ON roles WHEN NEW.id<>OLD.id
                BEGIN SELECT RAISE(ABORT,'Role IDs cannot change'); END;`);
        },
        () => {
            // Keep the ID and existing configuration; the role now applies only as a fallback.
            db.prepare(
                "UPDATE roles SET name='Default' WHERE id='everyone' AND name='Everyone'",
            ).run();
            // A brand-new community starts with normal member abilities in the fallback role.
            if (
                !db.prepare('SELECT 1 FROM users LIMIT 1').get() &&
                !db.prepare("SELECT 1 FROM roles WHERE id='member'").get()
            )
                db.prepare("UPDATE roles SET permissions=? WHERE id='everyone'").run(
                    JSON.stringify(memberPermissions),
                );
        },
        () => {
            // Retire the redundant built-in role. Remaining assignments stay explicit;
            // members with no assignments automatically use Default.
            db.exec(`UPDATE users SET role='everyone' WHERE role='member';
                DROP TRIGGER preserve_default_roles;
                CREATE TRIGGER preserve_default_roles BEFORE DELETE ON roles WHEN OLD.id IN ('owner','everyone')
                BEGIN SELECT RAISE(ABORT,'Default roles cannot be deleted'); END;
                DELETE FROM roles WHERE id='member';`);
        },
    ];
    migrations.forEach((apply, index) => {
        const version = index + 1;
        if (version > through) return;
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
            'INSERT OR IGNORE INTO roles(id,name,color,permissions) VALUES(?,?,?,?)',
            'owner',
            'Owner',
            '#f3be57',
            JSON.stringify(permissionIds),
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
