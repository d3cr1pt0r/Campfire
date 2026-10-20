import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/database.js';

test('schema initializes twice and enforces identity, role and attachment integrity', () => {
    const db = new DatabaseSync(':memory:');
    try {
        const schema = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
        db.exec(schema);
        db.exec(schema);
        db.prepare('INSERT INTO roles(id,name,color,permissions) VALUES(?,?,?,?)').run(
            'member',
            'Member',
            '#112233',
            '["send"]',
        );
        db.prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)').run(
            'a',
            'Alice',
            'hash',
            'member',
        );
        assert.throws(
            () =>
                db
                    .prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)')
                    .run('b', 'alice', 'hash', 'member'),
            /UNIQUE/,
        );
        assert.throws(
            () =>
                db
                    .prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)')
                    .run('b', 'Bob', 'hash', 'missing'),
            /FOREIGN KEY/,
        );
        db.prepare('INSERT INTO messages(id,room,author,body,created) VALUES(?,?,?,?,?)').run(
            'm',
            'general',
            'a',
            'Hello',
            Date.now(),
        );
        db.prepare('INSERT INTO attachments(id,message,name,mime,data) VALUES(?,?,?,?,?)').run(
            'f',
            'm',
            'test.txt',
            'application/octet-stream',
            'aGVsbG8=',
        );
        db.prepare('INSERT INTO reactions VALUES(?,?,?)').run('m', 'a', '👍');
        db.prepare('DELETE FROM messages WHERE id=?').run('m');
        assert.equal(db.prepare('SELECT count(*) n FROM attachments').get().n, 0);
        assert.equal(db.prepare('SELECT count(*) n FROM reactions').get().n, 0);
    } finally {
        db.close();
    }
});

test('a database from an older version is refused with a way forward', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-older-'));
    try {
        const old = new DatabaseSync(path.join(directory, 'campfire.sqlite'));
        old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT);
            INSERT INTO users VALUES('a', 'Alice');
            CREATE TABLE profiles(user TEXT PRIMARY KEY, nickname TEXT NOT NULL);`);
        old.close();
        assert.throws(() => openDatabase(directory, 'Test'), /older Campfire version/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a community saved under an earlier filename is refused instead of starting empty', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-renamed-'));
    try {
        const { db } = openDatabase(directory, 'Test');
        db.prepare('INSERT INTO users(id,username,password) VALUES(?,?,?)').run('a', 'Alice', 'h');
        // Closing the last connection folds the WAL back into the file, so it can be renamed.
        db.close();
        const current = path.join(directory, 'campfire.sqlite');
        const earlier = path.join(directory, 'driskord.sqlite');
        renameSync(current, earlier);
        assert.throws(() => openDatabase(directory, 'Test'), /rename it to campfire\.sqlite/);
        assert.equal(existsSync(current), false);
        // A current database with accounts opens normally and keeps them.
        renameSync(earlier, current);
        const reopened = openDatabase(directory, 'Test');
        assert.equal(reopened.get('SELECT username FROM users WHERE id=?', 'a').username, 'Alice');
        reopened.db.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
