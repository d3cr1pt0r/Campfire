import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
import { canonicalRoom } from '../shared/rooms.js';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-thumbnails-'));
    const service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const signup = async (username) =>
        (
            await request(service.app, '/auth/register', null, 'POST', {
                username,
                password: 'test-password-123',
                setupCode: 'test-owner-setup',
            })
        ).data;
    const owner = await signup('Owner'),
        friend = await signup('Friend'),
        outsider = await signup('Outsider');
    await request(service.app, '/friends', owner.token, 'POST', { username: 'Friend' });
    await request(service.app, '/friends', friend.token, 'POST', { username: 'Owner' });
    const room = canonicalRoom(`dm:${owner.user.id}:${friend.user.id}`);
    const upload = async (bytes) => {
        const response = await request(service.app, '/messages', owner.token, 'POST', {
            room,
            attachments: [{ name: 'image.png', data: bytes.toString('base64') }],
        });
        assert.equal(response.status, 200, JSON.stringify(response.data));
        return response.data;
    };
    return { service, owner, friend, outsider, upload };
}

test('thumbnails are small WebP images with original aspect ratio, cached, access controlled, and cascade deleted', async (t) => {
    const f = await fixture(t);
    const original = await sharp({
        create: { width: 1800, height: 1200, channels: 3, background: '#9977dd' },
    })
        .png()
        .toBuffer();
    const message = await f.upload(original),
        id = message.attachments[0].id;
    const endpoint = `/attachments/${id}/preview`;
    assert.equal((await request(f.service.app, endpoint)).status, 401);
    assert.equal((await request(f.service.app, endpoint, f.outsider.token)).status, 404);
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachment_previews').get().n, 0);
    const preview = await request(f.service.app, endpoint, f.friend.token);
    assert.equal(preview.status, 200);
    assert.match(preview.headers['content-type'], /image\/webp/);
    const metadata = await sharp(preview.data).metadata();
    assert.equal(metadata.width, 480);
    assert.equal(metadata.height, 320);
    assert.ok(preview.data.length < original.length);
    const again = await request(f.service.app, endpoint, f.owner.token);
    assert.deepEqual(again.data, preview.data);
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachment_previews').get().n, 1);
    const full = await request(f.service.app, `/attachments/${id}?inline=1`, f.owner.token);
    assert.deepEqual(full.data, original);
    await request(f.service.app, `/messages/${message.id}`, f.owner.token, 'DELETE');
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachment_previews').get().n, 0);
    assert.equal((await request(f.service.app, endpoint, f.friend.token)).status, 404);
});

test('invalid and excessive-pixel images fail previews without changing downloadable originals', async (t) => {
    const f = await fixture(t);
    const invalid = Buffer.alloc(45);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(invalid);
    invalid.writeUInt32BE(13, 8);
    invalid.write('IHDR', 12);
    invalid.writeUInt32BE(100000, 16);
    invalid.writeUInt32BE(100000, 20);
    const message = await f.upload(invalid),
        id = message.attachments[0].id;
    for (let i = 0; i < 2; i++)
        assert.equal(
            (await request(f.service.app, `/attachments/${id}/preview`, f.owner.token)).status,
            404,
        );
    assert.equal(
        f.service.db.prepare('SELECT data FROM attachment_previews WHERE attachment=?').get(id)
            .data,
        null,
    );
    assert.deepEqual(
        (await request(f.service.app, `/attachments/${id}`, f.owner.token)).data,
        invalid,
    );
});

test('legacy attachments create previews on demand and concurrent requests share one cached result', async (t) => {
    const f = await fixture(t);
    const original = await sharp({
        create: { width: 600, height: 1800, channels: 3, background: '#11aaee' },
    })
        .gif()
        .toBuffer();
    const message = await f.upload(original),
        id = message.attachments[0].id;
    const endpoint = `/attachments/${id}/preview`;
    const results = await Promise.all(
        Array.from({ length: 8 }, () => request(f.service.app, endpoint, f.owner.token)),
    );
    results.forEach((result) => {
        assert.equal(result.status, 200);
        assert.deepEqual(result.data, results[0].data);
    });
    const metadata = await sharp(results[0].data).metadata();
    assert.equal(metadata.width, 120);
    assert.equal(metadata.height, 360);
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachment_previews').get().n, 1);
    assert.deepEqual(
        (await request(f.service.app, `/attachments/${id}?inline=1`, f.owner.token)).data,
        original,
    );
});

test('thumbnail decoding bounds concurrency and queued work, and deduplicates an in-flight image', async (t) => {
    const { createThumbnails } = await import('../server/thumbnails.js');
    const f = await fixture(t);
    const original = await sharp({
        create: { width: 1000, height: 1000, channels: 3, background: '#33bb66' },
    })
        .png()
        .toBuffer();
    const message = await f.upload(original);
    const insert = f.service.db.prepare(
        'INSERT INTO attachments(id,message,name,mime,data,bytes) VALUES(?,?,?,?,?,?)',
    );
    for (let i = 0; i < 33; i++)
        insert.run(
            `bounded-${i}`,
            message.id,
            'test.png',
            'image/png',
            original.toString('base64'),
            original.length,
        );
    const thumbnails = createThumbnails({
        get: (sql, ...params) => f.service.db.prepare(sql).get(...params),
        all: (sql, ...params) => f.service.db.prepare(sql).all(...params),
        run: (sql, ...params) => f.service.db.prepare(sql).run(...params),
    });
    t.after(() => thumbnails.close());
    let loads = 0;
    const jobs = Array.from({ length: 33 }, (_, i) =>
        thumbnails.get(`bounded-${i}`, () => {
            loads++;
            return original;
        }),
    );
    const duplicate = thumbnails.get('bounded-0', () => {
        throw Error('Duplicate decoded');
    });
    assert.equal(loads, 2, 'only two originals start decoding immediately');
    const results = await Promise.allSettled(jobs);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 32);
    assert.equal(results[32].reason.status, 503);
    assert.equal(loads, 32);
    assert.deepEqual(await duplicate, results[0].value);
});
