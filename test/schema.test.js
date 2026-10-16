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
        db.prepare('INSERT INTO roles VALUES(?,?,?,?)').run('member', 'Member', '#112233', '["send"]');
        db.prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)').run('a', 'Alice', 'hash', 'member');
        assert.throws(() => db.prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)').run('b', 'alice', 'hash', 'member'), /UNIQUE/);
        assert.throws(() => db.prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)').run('b', 'Bob', 'hash', 'missing'), /FOREIGN KEY/);
        db.prepare('INSERT INTO messages(id,room,author,body,created) VALUES(?,?,?,?,?)').run('m', 'general', 'a', 'Hello', Date.now());
        db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?)').run('f', 'm', 'test.txt', 'application/octet-stream', 'aGVsbG8=');
        db.prepare('INSERT INTO reactions VALUES(?,?,?)').run('m', 'a', '👍');
        db.prepare('DELETE FROM messages WHERE id=?').run('m');
        assert.equal(db.prepare('SELECT count(*) n FROM attachments').get().n, 0);
        assert.equal(db.prepare('SELECT count(*) n FROM reactions').get().n, 0);
    }
    finally {
        db.close();
    }
});
