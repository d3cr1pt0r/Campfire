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
        member = await signup('Member'),
        outsider = await signup('Outsider');
    const room = canonicalRoom(`dm:${owner.user.id}:${member.user.id}`);
    const upload = async (bytes) => {
        const response = await request(service.app, '/messages', owner.token, 'POST', {
            room,
            attachments: [{ name: 'image.png', data: bytes.toString('base64') }],
        });
        assert.equal(response.status, 200, JSON.stringify(response.data));
        return response.data;
    };
    return { service, owner, member, outsider, upload };
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
    const preview = await request(f.service.app, endpoint, f.member.token);
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
    assert.equal((await request(f.service.app, endpoint, f.member.token)).status, 404);
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

test('image attachments report their displayed size and animation, read when uploaded', async (t) => {
    const f = await fixture(t);
    const frame = (background) =>
        sharp({ create: { width: 300, height: 120, channels: 3, background } })
            .png()
            .toBuffer();
    const [first, second] = await Promise.all([frame('#aa3322'), frame('#2233aa')]);
    const files = {
        'wide.png': first,
        'sideways.jpg': await sharp(first).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
        'moving.gif': await sharp([first, second], { join: { animated: true } })
            .gif()
            .toBuffer(),
        'moving.webp': await sharp([first, second], { join: { animated: true } })
            .webp()
            .toBuffer(),
        'still.gif': await sharp(first).gif().toBuffer(),
        'notes.txt': Buffer.from('plain text'),
    };
    const response = await request(f.service.app, '/messages', f.owner.token, 'POST', {
        room: canonicalRoom(`dm:${f.owner.user.id}:${f.member.user.id}`),
        attachments: Object.entries(files).map(([name, data]) => ({
            name,
            data: data.toString('base64'),
        })),
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const sizes = Object.fromEntries(
        response.data.attachments.map(({ name, width, height, animated }) => [
            name,
            width === undefined ? null : { width, height, animated },
        ]),
    );
    assert.deepEqual(sizes, {
        'wide.png': { width: 300, height: 120, animated: false },
        'sideways.jpg': { width: 120, height: 300, animated: false },
        'moving.gif': { width: 300, height: 120, animated: true },
        'moving.webp': { width: 300, height: 120, animated: true },
        'still.gif': { width: 300, height: 120, animated: false },
        'notes.txt': null,
    });
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachment_images').get().n, 5);
});

test('older image attachments are measured once, when their message is first viewed', async (t) => {
    const f = await fixture(t);
    const original = await sharp({
        create: { width: 640, height: 200, channels: 3, background: '#55aa77' },
    })
        .webp()
        .toBuffer();
    const message = await f.upload(original),
        id = message.attachments[0].id;
    // Uploads from before sizes were stored have no row.
    f.service.db.prepare('DELETE FROM attachment_images').run();
    const history = async () =>
        (
            await request(
                f.service.app,
                `/messages?room=${encodeURIComponent(message.room)}`,
                f.owner.token,
            )
        ).data[0].attachments[0];
    assert.deepEqual(await history(), {
        id,
        name: 'image.png',
        mime: 'image/webp',
        width: 640,
        height: 200,
        animated: false,
    });
    assert.deepEqual(
        { ...f.service.db.prepare('SELECT * FROM attachment_images WHERE attachment=?').get(id) },
        { attachment: id, width: 640, height: 200, animated: 0 },
    );
    // An unreadable header is remembered too, so it is not read again on every view.
    f.service.db.prepare('UPDATE attachment_images SET width=0,height=0').run();
    assert.equal((await history()).width, undefined);
    // Deleting the message removes its stored size.
    await request(f.service.app, `/messages/${message.id}`, f.owner.token, 'DELETE');
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachment_images').get().n, 0);
});

test('image headers give sizes for animated PNGs and nothing for truncated or foreign data', async () => {
    const { imageInfo } = await import('../server/images.js');
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
        .png()
        .toBuffer();
    // An acTL chunk with two frames placed before the image data, as in an APNG.
    const control = Buffer.alloc(20);
    control.writeUInt32BE(8, 0);
    control.write('acTL', 4, 'ascii');
    control.writeUInt32BE(2, 8);
    const animated = Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]);
    assert.deepEqual(imageInfo(animated), { width: 40, height: 30, animated: true });
    assert.deepEqual(imageInfo(png), { width: 40, height: 30, animated: false });
    for (const data of [png.subarray(0, 20), Buffer.from('GIF89a'), Buffer.from('plain text')])
        assert.equal(imageInfo(data), null);
    const jpeg = await sharp(png).jpeg().toBuffer();
    assert.equal(imageInfo(jpeg.subarray(0, 40)), null);
});
