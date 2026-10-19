import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
import { canonicalRoom } from '../shared/rooms.js';

test('upgrade removes relationships and endpoints while preserving member DMs, attachments and sessions', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'campfire-member-upgrade-'));
    let service = createApp({ dataDir });
    try {
        const signup = async (username) => {
            const result = await request(service.app, '/auth/register', null, 'POST', {
                username,
                password: 'member-test-password',
                setupCode: 'test-owner-setup',
            });
            assert.equal(result.status, 200);
            return result.data;
        };
        const alice = await signup('Alice'),
            bob = await signup('Bob'),
            other = await signup('Other');
        const room = canonicalRoom(`dm:${alice.user.id}:${bob.user.id}`);
        const sent = await request(service.app, '/messages', alice.token, 'POST', {
            room,
            body: 'A direct conversation',
            attachments: [
                { name: 'note.txt', data: Buffer.from('saved attachment').toString('base64') },
            ],
        });
        assert.equal(sent.status, 200);
        // Recreate the previous database version with accepted and pending relationships.
        service.db.exec(
            'DELETE FROM migrations WHERE version=11; CREATE TABLE friends(sender TEXT REFERENCES users(id),recipient TEXT REFERENCES users(id),accepted INTEGER DEFAULT 0,PRIMARY KEY(sender,recipient)); CREATE INDEX friends_recipient ON friends(recipient);',
        );
        service.db.prepare('INSERT INTO friends VALUES(?,?,?)').run(alice.user.id, bob.user.id, 1);
        service.db.prepare('INSERT INTO friends VALUES(?,?,?)').run(bob.user.id, other.user.id, 0);
        await service.close();
        service = createApp({ dataDir });
        assert.deepEqual(
            service.db
                .prepare(
                    "SELECT name FROM sqlite_master WHERE name IN ('friends','friends_recipient')",
                )
                .all(),
            [],
        );
        assert.equal(service.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
        const state = await request(service.app, '/state', alice.token);
        assert.equal(state.status, 200);
        assert.equal('friends' in state.data, false);
        assert.equal(state.data.users.length, 3);
        assert.deepEqual(state.data.directMessages, [{ room, updated: sent.data.created }]);
        assert.deepEqual(
            (await request(service.app, '/state', other.token)).data.directMessages,
            [],
        );
        assert.deepEqual((await request(service.app, '/state', bob.token)).data.directMessages, [
            { room, updated: sent.data.created },
        ]);
        const history = await request(
            service.app,
            `/messages?room=${encodeURIComponent(room)}`,
            bob.token,
        );
        assert.equal(history.status, 200);
        assert.equal(history.data[0].body, 'A direct conversation');
        const file = await request(
            service.app,
            `/attachments/${history.data[0].attachments[0].id}`,
            bob.token,
        );
        assert.equal(file.status, 200);
        assert.equal(file.data.toString(), 'saved attachment');
        assert.equal(
            (await request(service.app, `/messages?room=${encodeURIComponent(room)}`, other.token))
                .status,
            403,
        );
        assert.equal(
            (await request(service.app, '/friends', alice.token, 'POST', { username: 'Bob' }))
                .status,
            404,
        );
        assert.equal(
            (await request(service.app, `/friends/${bob.user.id}`, alice.token, 'DELETE')).status,
            404,
        );
        await service.close();
        service = createApp({ dataDir });
        assert.equal(
            service.db.prepare("SELECT name FROM sqlite_master WHERE name='friends'").get(),
            undefined,
        );
        assert.equal(
            (await request(service.app, `/messages?room=${encodeURIComponent(room)}`, bob.token))
                .data.length,
            1,
        );
    } finally {
        await service.close();
        rmSync(dataDir, { recursive: true, force: true });
    }
});
