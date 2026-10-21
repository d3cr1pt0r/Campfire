import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/database.js';
import { createReader } from '../server/reader.js';

// A query that keeps SQLite busy for a while without any data.
const slow = (count) =>
    `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<${count}) SELECT count(*) n FROM c`;

function fixture(t, options) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-reader-'));
    const database = openDatabase(directory, 'Test');
    const reader = createReader(database.file, options);
    t.after(async () => {
        await reader.close();
        database.db.close();
        rmSync(directory, { recursive: true, force: true });
    });
    return { ...database, reader };
}

test('the main thread keeps serving while a slow query runs in the background', async (t) => {
    const f = fixture(t);
    f.run(
        "INSERT INTO messages(id,room,author,body,created,since) VALUES('m','general',NULL,'Hello Campfire',1,1)",
    );
    const order = [];
    const background = f.reader.all(slow(3_000_000), []).then((rows) => {
        order.push('background');
        return rows;
    });
    // Chat keeps going: timers fire and the main connection reads and writes meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 20));
    f.run(
        "INSERT INTO messages(id,room,author,body,created,since) VALUES('n','general',NULL,'Still here',2,2)",
    );
    assert.equal(f.get('SELECT COUNT(*) n FROM messages').n, 2);
    order.push('main');
    assert.deepEqual(
        (await background).map((row) => ({ ...row })),
        [{ n: 3_000_000 }],
    );
    assert.deepEqual(order, ['main', 'background']);
    // Searches see what the main thread wrote, with the same matching.
    const found = await f.reader.all(
        'SELECT id FROM messages WHERE contains_text(body,?) ORDER BY id',
        ['CAMPFIRE'],
    );
    assert.deepEqual(
        found.map((row) => row.id),
        ['m'],
    );
    // The worker's connection cannot write.
    await assert.rejects(
        f.reader.all("DELETE FROM messages WHERE id='m'", []),
        (error) => error.status === 500 && /readonly/i.test(error.message),
    );
});

test('a query that runs too long is stopped, and the next one still works', async (t) => {
    const f = fixture(t);
    // Start the worker before testing its deadline, so startup speed is irrelevant.
    await f.reader.all('SELECT 1', []);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const timedOut = assert.rejects(
        f.reader.all(slow(3_000_000), []),
        (error) => error.status === 503 && /too long/.test(error.message),
    );
    t.mock.timers.tick(10000);
    t.mock.timers.reset();
    await timedOut;
    // The replacement worker gets the normal deadline, including on slower CI hosts.
    assert.deepEqual(
        (await f.reader.all('SELECT 1 x', [])).map((row) => ({ ...row })),
        [{ x: 1 }],
    );
});

test('waiting queries can be dropped, a full queue answers busy, and closing ends them', async (t) => {
    const f = fixture(t, { workers: 1, queued: 1 });
    const running = f.reader.all(slow(3_000_000), []);
    const cancel = new AbortController();
    const waiting = f.reader.all('SELECT 1 x', [], cancel.signal);
    cancel.abort(Object.assign(new Error('Search cancelled'), { status: 499 }));
    await assert.rejects(waiting, (error) => error.status === 499);
    const queued = f.reader.all('SELECT 2 x', []);
    await assert.rejects(f.reader.all('SELECT 3 x', []), (error) => error.status === 503);
    assert.equal((await running)[0].n, 3_000_000);
    assert.equal((await queued)[0].x, 2);
    const late = assert.rejects(f.reader.all(slow(3_000_000), []), (error) => error.status === 503);
    await f.reader.close();
    await late;
    await assert.rejects(f.reader.all('SELECT 1', []), (error) => error.status === 503);
});
