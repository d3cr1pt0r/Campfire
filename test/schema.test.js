import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
        db.prepare('INSERT INTO users(id,username,password) VALUES(?,?,?)').run(
            'a',
            'Alice',
            'hash',
        );
        assert.throws(
            () =>
                db
                    .prepare('INSERT INTO users(id,username,password) VALUES(?,?,?)')
                    .run('b', 'alice', 'hash'),
            /UNIQUE/,
        );
        assert.throws(
            () => db.prepare("INSERT INTO user_roles VALUES('a','missing')").run(),
            /FOREIGN KEY/,
        );
        db.prepare(
            'INSERT INTO messages(id,room,author,body,created,since) VALUES(?,?,?,?,?,?)',
        ).run('m', 'general', 'a', 'Hello', 1, 1);
        assert.throws(
            () =>
                db
                    .prepare('INSERT INTO messages(id,room,author,body,created) VALUES(?,?,?,?,?)')
                    .run('n', 'general', 'a', 'No clock', 1),
            /NOT NULL/,
        );
        const attach = db.prepare(
            'INSERT INTO attachments(id,message,name,mime,bytes,data) VALUES(?,?,?,?,?,?)',
        );
        attach.run('f', 'm', 'test.txt', 'application/octet-stream', 5, Buffer.from('hello'));
        // Files are raw bytes whose length matches the stored size.
        assert.throws(() => attach.run('g', 'm', 'text', 'text/plain', 8, 'aGVsbG8='), /CHECK/);
        assert.throws(() => attach.run('h', 'm', 'short', 'x', 9, Buffer.from('hello')), /CHECK/);
        assert.throws(() => attach.run('i', 'm', null, 'x', 5, Buffer.from('hello')), /NOT NULL/);
        // A removed file keeps no bytes.
        assert.throws(
            () => db.prepare("UPDATE attachments SET removed=1 WHERE id='f'").run(),
            /CHECK/,
        );
        assert.equal(db.prepare('SELECT bytes FROM storage_usage').get().bytes, 5);
        db.prepare('INSERT INTO reactions VALUES(?,?,?)').run('m', 'a', '👍');
        db.prepare(
            "INSERT INTO link_previews(id,url,fetched) VALUES('p','https://example.com',1)",
        ).run();
        const link = db.prepare(
            'INSERT INTO message_link_previews(message,position,preview) VALUES(?,?,?)',
        );
        link.run('m', 0, 'p');
        assert.throws(() => link.run('m', 1, 'missing'), /FOREIGN KEY/);
        assert.throws(() => link.run('m', 3, 'p'), /CHECK/);
        // A card's links go with it, and a message's links go with the message.
        db.prepare("DELETE FROM link_previews WHERE id='p'").run();
        assert.equal(db.prepare('SELECT count(*) n FROM message_link_previews').get().n, 0);
        db.prepare(
            "INSERT INTO link_previews(id,url,fetched) VALUES('p','https://example.com',1)",
        ).run();
        link.run('m', 0, 'p');
        db.prepare('DELETE FROM messages WHERE id=?').run('m');
        for (const table of ['attachments', 'reactions', 'message_link_previews'])
            assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
        assert.equal(db.prepare('SELECT bytes FROM storage_usage').get().bytes, 0);
    } finally {
        db.close();
    }
});

test('retention policies exist for the server and direct messages and stay consistent', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        assert.deepEqual(
            db
                .prepare('SELECT scope,retention FROM retention_policies ORDER BY scope')
                .all()
                .map((row) => ({ ...row })),
            [
                { scope: 'dm', retention: 0 },
                { scope: 'server', retention: 0 },
            ],
        );
        const policy = db.prepare(
            "UPDATE retention_policies SET retention=?,retentionNext=?,retentionAt=? WHERE scope='server'",
        );
        assert.throws(() => policy.run(30, 14, null), /CHECK/);
        assert.throws(() => policy.run(30, 0, 1), /CHECK/);
        assert.throws(() => policy.run(-1, null, null), /CHECK/);
        policy.run(30, 14, 1);
        db.prepare("INSERT INTO channels(id,name,kind) VALUES('c','c','text')").run();
        const channel = db.prepare(
            "UPDATE channels SET retention=?,retentionNext=?,retentionAt=? WHERE id='c'",
        );
        // A pending change to the server default is NULL with a start time.
        channel.run(30, null, 1);
        assert.throws(() => channel.run(30, 14, null), /CHECK/);
        assert.throws(() => db.prepare("UPDATE channels SET kind='other'").run(), /CHECK|change/);
        // Text is kept until a date only while it is kept at all.
        assert.deepEqual(
            { ...db.prepare('SELECT keepText,keepTextUntil FROM retention_mode').get() },
            {
                keepText: 0,
                keepTextUntil: null,
            },
        );
        assert.throws(() => db.prepare('UPDATE retention_mode SET keepTextUntil=1').run(), /CHECK/);
        db.prepare('UPDATE retention_mode SET keepText=1,keepTextUntil=1').run();
    } finally {
        db.close();
    }
});

test('new databases give freed space back to the disk', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-vacuum-'));
    try {
        const { db, get } = openDatabase(directory, 'Test');
        assert.equal(get('PRAGMA auto_vacuum').auto_vacuum, 2);
        db.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a database from an older version is refused with a way forward', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-older-'));
    try {
        const old = new DatabaseSync(path.join(directory, 'campfire.sqlite'));
        old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT);
            INSERT INTO users VALUES('a', 'Alice');
            CREATE TABLE profiles(user TEXT PRIMARY KEY, nickname TEXT NOT NULL, frame TEXT);
            CREATE TABLE messages(id TEXT PRIMARY KEY, room TEXT, body TEXT, created INTEGER);`);
        old.close();
        assert.throws(
            () => openDatabase(directory, 'Test'),
            (error) =>
                /older Campfire version.*new data directory/.test(error.message) &&
                !/commit/.test(error.message),
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
