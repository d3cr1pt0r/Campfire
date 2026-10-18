import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { request } from '../test-support/http.js';

for (const emptyCurrent of [false, true]) {
    test(`existing accounts can log in after rebranding with ${emptyCurrent ? 'an empty' : 'no'} current database`, async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'campfire-database-upgrade-'));
        let service;
        try {
            service = createApp({ dataDir: directory, setupCode: 'setup-secret' });
            const credentials = { username: 'Owner', password: 'secure-password-123' };
            const registered = await request(service.app, '/auth/register', null, 'POST', {
                ...credentials,
                setupCode: 'setup-secret',
            });
            assert.equal(registered.status, 200);
            await service.close();
            service = null;
            const current = path.join(directory, 'campfire.sqlite');
            renameSync(current, path.join(directory, 'previous-community.sqlite'));
            if (emptyCurrent) {
                const empty = new DatabaseSync(current);
                empty.exec('CREATE TABLE users(id TEXT PRIMARY KEY)');
                empty.close();
            }
            service = createApp({ dataDir: directory });
            assert.equal((await request(service.app, '/info')).data.setupRequired, false);
            const loggedIn = await request(service.app, '/auth/login', null, 'POST', credentials);
            assert.equal(loggedIn.status, 200);
            assert.ok(loggedIn.data.token);
            assert.equal(service.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
        } finally {
            await service?.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
