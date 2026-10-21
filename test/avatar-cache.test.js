import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createAvatarCache } from '../src/avatarCache.ts';
const { createAvatarStore } = createRequire(import.meta.url)('../electron/avatar-cache.cjs');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const png = new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' });
const key = (server = 'https://example.com', account = 'alice', id = 'avatar-1') =>
    JSON.stringify([server, account, `/avatars/${id}`]);

test('concurrent and remounted avatars share one download, decode, and URL', async () => {
    const saved = new Map();
    let downloads = 0,
        decodes = 0;
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const cache = createAvatarCache(
        {
            read: async (key) => saved.get(key),
            write: async (key, blob) => {
                saved.set(key, blob);
            },
        },
        async () => {
            decodes++;
        },
    );
    const fetch = async () => {
        downloads++;
        await gate;
        return png;
    };
    const listeners = Array.from({ length: 30 }, () => cache.subscribe(key(), fetch, () => {}));
    await tick();
    assert.equal(downloads, 1);
    // Unmounting one occurrence must not cancel another's shared request.
    listeners.shift()();
    release();
    await tick();
    const source = cache.source(key());
    assert.ok(source.startsWith('blob:'));
    assert.equal(decodes, 1);
    listeners.forEach((stop) => stop());
    const stop = cache.subscribe(key(), fetch, () => {});
    assert.equal(cache.source(key()), source);
    assert.equal(downloads, 1);
    stop();
    // A new renderer cache reads the persisted bytes without the network.
    const restarted = createAvatarCache(
        { read: async (key) => saved.get(key), write: async () => {} },
        async () => {},
    );
    const done = restarted.subscribe(key(), fetch, () => {});
    await tick();
    assert.ok(restarted.source(key()));
    assert.equal(downloads, 1);
    done();
});

test('server, account, and avatar ID are independent cache resources', async () => {
    let downloads = 0;
    const cache = createAvatarCache(
        { read: async () => undefined, write: async () => {} },
        async () => {},
    );
    const keys = [
        key(),
        key('https://other.example'),
        key(undefined, 'bob'),
        key(undefined, undefined, 'avatar-2'),
    ];
    const stops = keys.map((key) =>
        cache.subscribe(
            key,
            async () => {
                downloads++;
                return png;
            },
            () => {},
        ),
    );
    await tick();
    assert.equal(downloads, 4);
    assert.equal(new Set(keys.map((key) => cache.source(key))).size, 4);
    stops.forEach((stop) => stop());
});

test('unused memory entries are evicted without evicting persistent bytes or active images', async () => {
    const saved = new Map();
    let downloads = 0;
    const cache = createAvatarCache(
        {
            read: async (key) => saved.get(key),
            write: async (key, blob) => {
                saved.set(key, blob);
            },
        },
        async () => {},
        1,
    );
    const fetch = async () => {
        downloads++;
        return png;
    };
    const active = cache.subscribe('active', fetch, () => {});
    const unused = cache.subscribe('unused', fetch, () => {});
    await tick();
    unused();
    assert.ok(cache.source('active'));
    assert.equal(cache.source('unused'), '');
    const restored = cache.subscribe('unused', fetch, () => {});
    await tick();
    assert.ok(cache.source('unused'));
    assert.equal(downloads, 2);
    restored();
    active();
});

test('failed requests can retry and corrupt cached images are repaired', async () => {
    let calls = 0;
    const cache = createAvatarCache(
        { read: async () => undefined, write: async () => {} },
        async () => {},
    );
    const fetch = async () => {
        if (++calls === 1) throw Error('offline');
        return png;
    };
    const stop = cache.subscribe('retry', fetch, () => {});
    await tick();
    stop();
    assert.equal(cache.source('retry'), '');
    const done = cache.subscribe('retry', fetch, () => {});
    await tick();
    assert.ok(cache.source('retry'));
    assert.equal(calls, 2);
    done();
    let decodes = 0,
        writes = 0;
    const corrupt = createAvatarCache(
        {
            read: async () => png,
            write: async () => {
                writes++;
            },
        },
        async () => {
            if (++decodes === 1) throw Error('corrupt');
        },
    );
    const repaired = corrupt.subscribe(
        'corrupt',
        async () => png,
        () => {},
    );
    await tick();
    assert.ok(corrupt.source('corrupt'));
    assert.equal(writes, 1);
    repaired();
});

test('desktop avatar files survive store recreation and reject unsafe keys and invalid bytes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'campfire-avatar-test-'));
    try {
        const store = createAvatarStore(directory);
        const bytes = new Uint8Array(await png.arrayBuffer());
        assert.equal(await store.write(key(), bytes), true);
        assert.deepEqual(new Uint8Array(await createAvatarStore(directory).read(key())), bytes);
        assert.equal(await store.read(key(undefined, 'bob')), null);
        assert.equal(await store.read(key(undefined, undefined, 'avatar-2')), null);
        assert.equal(await store.write(key(undefined, undefined, '../../escape'), bytes), false);
        assert.equal(await store.write(key(), new Uint8Array(30)), false);
        assert.equal(await store.write(key(), new Uint8Array(3 * 1024 * 1024)), false);
        assert.equal((await readdir(directory)).length, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
