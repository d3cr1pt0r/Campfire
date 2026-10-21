-- The complete Campfire schema. It runs on every start: a new data directory gets every
-- table, and an existing database is left as it is.
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS roles(
    id TEXT PRIMARY KEY,
    name TEXT,
    color TEXT,
    permissions TEXT,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS preserve_default_role_ids BEFORE UPDATE OF id ON roles WHEN NEW.id<>OLD.id
BEGIN SELECT RAISE(ABORT,'Role IDs cannot change'); END;
CREATE TRIGGER IF NOT EXISTS preserve_default_roles BEFORE DELETE ON roles WHEN OLD.id IN ('owner','everyone')
BEGIN SELECT RAISE(ABORT,'Default roles cannot be deleted'); END;

-- Role assignments live in user_roles; users.role is never used for authorization.
CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE COLLATE NOCASE,
    password TEXT,
    role TEXT REFERENCES roles(id),
    banned INTEGER DEFAULT 0,
    owner INTEGER NOT NULL DEFAULT 0 CHECK(owner IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_server_owner ON users(owner) WHERE owner=1;
CREATE TRIGGER IF NOT EXISTS immutable_username BEFORE UPDATE OF username ON users
WHEN NEW.username COLLATE BINARY IS NOT OLD.username COLLATE BINARY
BEGIN SELECT RAISE(ABORT,'Account usernames cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS preserve_server_owner BEFORE UPDATE OF owner,id,banned ON users
WHEN OLD.owner=1 AND (NEW.owner<>1 OR NEW.id<>OLD.id OR NEW.banned<>0)
BEGIN SELECT RAISE(ABORT,'Server ownership is protected'); END;
CREATE TRIGGER IF NOT EXISTS preserve_server_owner_delete BEFORE DELETE ON users WHEN OLD.owner=1
BEGIN SELECT RAISE(ABORT,'Server ownership is protected'); END;

CREATE TABLE IF NOT EXISTS user_roles(
    user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY(user,role)
);
CREATE TABLE IF NOT EXISTS profiles(
    user TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    frame TEXT
);
CREATE TABLE IF NOT EXISTS avatars(
    id TEXT PRIMARY KEY,
    user TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presence_preferences(
    user TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('online','idle','dnd'))
);
CREATE TABLE IF NOT EXISTS sessions(
    token TEXT PRIMARY KEY,
    user TEXT REFERENCES users(id),
    expires INTEGER
);
CREATE TABLE IF NOT EXISTS password_resets(
    user TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tokenHash TEXT UNIQUE NOT NULL,
    expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations(
    id TEXT PRIMARY KEY,
    tokenHash TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    usedBy TEXT REFERENCES users(id),
    revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS channels(
    id TEXT PRIMARY KEY,
    name TEXT,
    kind TEXT,
    protected INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    reactionAuthors INTEGER NOT NULL DEFAULT 1 CHECK(reactionAuthors IN (0,1)),
    private INTEGER NOT NULL DEFAULT 0 CHECK(private IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS protected_channel_kind ON channels(kind) WHERE protected=1;
CREATE INDEX IF NOT EXISTS channels_kind_position ON channels(kind,position);
CREATE TRIGGER IF NOT EXISTS preserve_channels BEFORE DELETE ON channels
WHEN OLD.protected=1 OR (SELECT COUNT(*) FROM channels WHERE kind=OLD.kind)<=1
BEGIN SELECT RAISE(ABORT,'Keep the protected text and voice channels'); END;
CREATE TRIGGER IF NOT EXISTS preserve_channel_kind BEFORE UPDATE OF kind,protected ON channels
WHEN NEW.kind IS NOT OLD.kind OR NEW.protected IS NOT OLD.protected
BEGIN SELECT RAISE(ABORT,'Channel type and protection cannot change'); END;
CREATE TABLE IF NOT EXISTS channel_overrides(
    channel TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
    PRIMARY KEY(channel,role,permission)
);

CREATE TABLE IF NOT EXISTS messages(
    id TEXT PRIMARY KEY,
    room TEXT,
    author TEXT REFERENCES users(id),
    body TEXT,
    created INTEGER,
    edited INTEGER,
    pinned INTEGER DEFAULT 0,
    thread TEXT REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS messages_room_created ON messages(room,created);
CREATE INDEX IF NOT EXISTS messages_room_cursor ON messages(room,created,id);
CREATE INDEX IF NOT EXISTS messages_thread_cursor ON messages(thread,room,created,id);
CREATE TRIGGER IF NOT EXISTS valid_message_thread BEFORE INSERT ON messages
WHEN NEW.thread IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM messages WHERE id=NEW.thread AND room=NEW.room AND thread IS NULL
) BEGIN SELECT RAISE(ABORT,'Invalid thread parent'); END;
CREATE TRIGGER IF NOT EXISTS immutable_message_thread BEFORE UPDATE OF thread,room ON messages
WHEN NEW.thread IS NOT OLD.thread OR NEW.room IS NOT OLD.room
BEGIN SELECT RAISE(ABORT,'Message conversation cannot change'); END;

CREATE TABLE IF NOT EXISTS attachments(
    id TEXT PRIMARY KEY,
    message TEXT REFERENCES messages(id) ON DELETE CASCADE,
    name TEXT,
    mime TEXT,
    data TEXT,
    bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments(message);
CREATE TABLE IF NOT EXISTS attachment_previews(
    attachment TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    data BLOB,
    bytes INTEGER NOT NULL
);
-- Total stored attachment bytes, kept current by the triggers below.
CREATE TABLE IF NOT EXISTS storage_usage(id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL);
INSERT OR IGNORE INTO storage_usage VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS attachment_usage_insert AFTER INSERT ON attachments
BEGIN UPDATE storage_usage SET bytes=bytes+NEW.bytes WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS attachment_usage_delete AFTER DELETE ON attachments
BEGIN UPDATE storage_usage SET bytes=bytes-OLD.bytes WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS attachment_usage_update AFTER UPDATE OF bytes ON attachments
BEGIN UPDATE storage_usage SET bytes=bytes+NEW.bytes-OLD.bytes WHERE id=1; END;

-- A poll belongs to the message that posts it; the message body holds the question.
-- Voting stops at ends, which ending a poll early moves to that moment.
CREATE TABLE IF NOT EXISTS polls(
    message TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    multiple INTEGER NOT NULL CHECK(multiple IN (0,1)),
    anonymous INTEGER NOT NULL CHECK(anonymous IN (0,1)),
    ends INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_answers(
    id TEXT PRIMARY KEY,
    poll TEXT NOT NULL REFERENCES polls(message) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS poll_answers_poll ON poll_answers(poll,position);
-- Anonymous polls keep votes too, so each member votes once; who voted is never sent.
CREATE TABLE IF NOT EXISTS poll_votes(
    answer TEXT NOT NULL REFERENCES poll_answers(id) ON DELETE CASCADE,
    user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(answer,user)
);

CREATE TABLE IF NOT EXISTS reactions(
    message TEXT REFERENCES messages(id) ON DELETE CASCADE,
    user TEXT REFERENCES users(id),
    emoji TEXT,
    PRIMARY KEY(message,user,emoji)
);
CREATE INDEX IF NOT EXISTS reactions_message ON reactions(message);
CREATE TABLE IF NOT EXISTS emojis(
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    author TEXT REFERENCES users(id),
    data TEXT NOT NULL
);
