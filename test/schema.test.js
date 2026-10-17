import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
test('schema initializes twice and enforces identity, role and attachment integrity', () => {
    const db = new DatabaseSync(':memory:');
    try {
        const schema = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
        db.exec(schema);
        db.exec(schema);
        db.prepare('INSERT INTO roles VALUES(?,?,?,?)').run(
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
        db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?)').run(
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

test('profile migration backfills existing usernames and preserves changed nicknames on restart', () => {
    const db = new DatabaseSync(':memory:');
    try {
        const schema = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
        db.exec(schema);
        db.prepare('INSERT INTO roles VALUES(?,?,?,?)').run('member', 'Member', '#112233', '[]');
        db.prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)').run(
            'legacy',
            'Original',
            'hash',
            'member',
        );
        db.exec(schema);
        assert.equal(
            db.prepare('SELECT nickname FROM profiles WHERE user=?').get('legacy').nickname,
            'Original',
        );
        db.prepare('UPDATE profiles SET nickname=? WHERE user=?').run('New Display', 'legacy');
        db.exec(schema);
        assert.equal(
            db.prepare('SELECT nickname FROM profiles WHERE user=?').get('legacy').nickname,
            'New Display',
        );
        assert.equal(
            db.prepare('SELECT username FROM users WHERE id=?').get('legacy').username,
            'Original',
        );
        assert.throws(
            () => db.prepare('UPDATE users SET username=? WHERE id=?').run('Other', 'legacy'),
            /cannot be changed/,
        );
        assert.throws(
            () => db.prepare('UPDATE users SET username=? WHERE id=?').run('original', 'legacy'),
            /cannot be changed/,
        );
    } finally {
        db.close();
    }
});
