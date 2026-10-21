-- The complete Campfire schema, run on every start. A new data directory gets every table; a
-- database from an older version is refused (checkCurrent in database.js), never upgraded.
-- Incremental vacuum lets retention give freed space back to the disk; it must precede the tables.
PRAGMA auto_vacuum=INCREMENTAL;
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS roles(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    permissions TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS preserve_default_role_ids BEFORE UPDATE OF id ON roles WHEN NEW.id<>OLD.id
BEGIN SELECT RAISE(ABORT,'Role IDs cannot change'); END;
CREATE TRIGGER IF NOT EXISTS preserve_default_roles BEFORE DELETE ON roles WHEN OLD.id IN ('owner','everyone')
BEGIN SELECT RAISE(ABORT,'Default roles cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    banned INTEGER NOT NULL DEFAULT 0 CHECK(banned IN (0,1)),
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
    user TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presence_preferences(
    user TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('online','idle','dnd'))
);
CREATE TABLE IF NOT EXISTS sessions(
    token TEXT PRIMARY KEY,
    user TEXT NOT NULL REFERENCES users(id),
    expires INTEGER NOT NULL
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
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS channels(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('text','voice')),
    protected INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    reactionAuthors INTEGER NOT NULL DEFAULT 1 CHECK(reactionAuthors IN (0,1)),
    private INTEGER NOT NULL DEFAULT 0 CHECK(private IN (0,1)),
    -- Days messages are kept (0 forever, NULL the server default). A shorter period waits in
    -- retentionNext (NULL there: the server default) until retentionAt.
    retention INTEGER CHECK(retention>=0),
    retentionNext INTEGER CHECK(retentionNext>0),
    retentionAt INTEGER,
    CHECK(retentionNext IS NULL OR retentionAt IS NOT NULL)
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

-- since starts the retention period: when the message was posted, or last unpinned.
CREATE TABLE IF NOT EXISTS messages(
    id TEXT PRIMARY KEY,
    room TEXT NOT NULL,
    author TEXT REFERENCES users(id),
    body TEXT NOT NULL,
    created INTEGER NOT NULL,
    edited INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    thread TEXT REFERENCES messages(id) ON DELETE CASCADE,
    since INTEGER NOT NULL
);
-- The server default for channels, and the one period for every direct message.
CREATE TABLE IF NOT EXISTS retention_policies(
    scope TEXT PRIMARY KEY CHECK(scope IN ('server','dm')),
    retention INTEGER NOT NULL DEFAULT 0 CHECK(retention>=0),
    retentionNext INTEGER CHECK(retentionNext>0),
    retentionAt INTEGER,
    CHECK((retentionNext IS NULL) = (retentionAt IS NULL))
);
INSERT OR IGNORE INTO retention_policies(scope) VALUES('server'),('dm');
-- Keep the original name so a deleted channel still has a readable invitation.
CREATE TABLE IF NOT EXISTS voice_channel_invitations(
    message TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    name TEXT NOT NULL,
    recipient TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS messages_room_cursor ON messages(room,created,id);
CREATE INDEX IF NOT EXISTS messages_thread_cursor ON messages(thread,room,created,id);
-- Retention looks for old unpinned top-level messages, conversation by conversation.
CREATE INDEX IF NOT EXISTS messages_expiry ON messages(room,since) WHERE thread IS NULL AND pinned=0;
CREATE TRIGGER IF NOT EXISTS valid_message_thread BEFORE INSERT ON messages
WHEN NEW.thread IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM messages WHERE id=NEW.thread AND room=NEW.room AND thread IS NULL
) BEGIN SELECT RAISE(ABORT,'Invalid thread parent'); END;
CREATE TRIGGER IF NOT EXISTS immutable_message_thread BEFORE UPDATE OF thread,room ON messages
WHEN NEW.thread IS NOT OLD.thread OR NEW.room IS NOT OLD.room
BEGIN SELECT RAISE(ABORT,'Message conversation cannot change'); END;

-- Files are stored as raw bytes, last so reading the other columns never loads them; bytes
-- repeats their length for the storage triggers.
CREATE TABLE IF NOT EXISTS attachments(
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    data BLOB NOT NULL,
    CHECK(typeof(data)='blob' AND bytes=length(data))
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments(message);
-- Displayed size of image attachments, so clients can reserve their exact space before
-- loading them. Zero sizes mark images whose header could not be read.
CREATE TABLE IF NOT EXISTS attachment_images(
    attachment TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    animated INTEGER NOT NULL CHECK(animated IN (0,1))
);
-- Link previews the server fetched, shared by every message that links the same page.
-- failed marks pages that gave no card, so they are not fetched again for an hour. Cards no
-- message links are dropped a day after their fetch.
CREATE TABLE IF NOT EXISTS link_previews(
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    site TEXT NOT NULL DEFAULT '',
    image BLOB,
    image_width INTEGER NOT NULL DEFAULT 0,
    image_height INTEGER NOT NULL DEFAULT 0,
    large INTEGER NOT NULL DEFAULT 0,
    video INTEGER NOT NULL DEFAULT 0,
    fetched INTEGER NOT NULL,
    failed INTEGER NOT NULL DEFAULT 0
);
-- Messages whose author removed their link previews.
CREATE TABLE IF NOT EXISTS hidden_link_previews(
    message TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
);
-- The stored cards each message shows, in link order.
CREATE TABLE IF NOT EXISTS message_link_previews(
    message TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 2),
    preview TEXT NOT NULL REFERENCES link_previews(id) ON DELETE CASCADE,
    PRIMARY KEY(message,position)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS message_link_previews_preview ON message_link_previews(preview);
-- GIFs a member starred in the GIF picker. Only KLIPY's links are kept, not the media.
CREATE TABLE IF NOT EXISTS gif_favorites(
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    preview TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    UNIQUE(user, url)
);
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
    message TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user TEXT NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    PRIMARY KEY(message,user,emoji)
);
CREATE TABLE IF NOT EXISTS emojis(
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    author TEXT REFERENCES users(id),
    data TEXT NOT NULL
);
