import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
import { serverConfig } from '../server/config.js';
import { isKlipyMedia } from '../shared/klipy.js';
import { klipyGif, klipyGifs, klipyGifMessage } from '../src/klipy.ts';

async function fixture(t, options = {}) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-gifs-'));
    const service = createApp({ dataDir: directory, ...options });
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
    return { service, owner: await signup('Owner'), member: await signup('Member') };
}
const gif = (name, extra = {}) => ({
    url: `https://static.klipy.com/ii/abc/${name}.webp?width=498`,
    preview: `https://static1.klipy.com/ii/abc/${name}-sm.webp`,
    width: 498,
    height: 280,
    title: `GIF ${name}`,
    ...extra,
});

test('the server shares its KLIPY key with members only when one is configured', async (t) => {
    const configured = await fixture(t, { klipyKey: 'server-key' });
    const state = await request(configured.service.app, '/state', configured.member.token);
    assert.equal(state.data.klipyKey, 'server-key');
    const policy = state.headers['content-security-policy'];
    for (const host of ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'])
        assert.match(policy, new RegExp(`img-src [^;]*https://${host.replace(/\./g, '\\.')}`));
    const plain = await fixture(t);
    assert.equal(
        (await request(plain.service.app, '/state', plain.member.token)).data.klipyKey,
        null,
    );
    assert.equal(serverConfig({ KLIPY_API_KEY: '  key-from-env \n' }).klipyKey, 'key-from-env');
    assert.equal(serverConfig({}).klipyKey, '');
});

test('favourite GIFs are kept per member, newest first, and only for KLIPY links', async (t) => {
    const { service, owner, member } = await fixture(t);
    const api = (account, endpoint, method, body) =>
        request(service.app, endpoint, account.token, method, body);
    assert.deepEqual((await api(member, '/gif-favorites')).data, []);
    await api(member, '/gif-favorites', 'POST', gif('first'));
    const list = (await api(member, '/gif-favorites', 'POST', gif('second'))).data;
    assert.deepEqual(
        list.map((favorite) => favorite.title),
        ['GIF second', 'GIF first'],
    );
    // Starring the same GIF again keeps one entry.
    assert.equal((await api(member, '/gif-favorites', 'POST', gif('first'))).data.length, 2);
    assert.deepEqual((await api(owner, '/gif-favorites')).data, []);
    // Another member cannot remove someone else's favourite.
    await api(owner, `/gif-favorites/${list[0].id}`, 'DELETE');
    assert.equal((await api(member, '/gif-favorites')).data.length, 2);
    const removed = (await api(member, `/gif-favorites/${list[0].id}`, 'DELETE')).data;
    assert.deepEqual(
        removed.map((favorite) => favorite.title),
        ['GIF first'],
    );
    for (const invalid of [
        gif('x', { url: 'https://evil.example/x.gif' }),
        gif('x', { url: 'http://static.klipy.com/x.gif' }),
        gif('x', { preview: 'javascript:alert(1)' }),
        gif('x', { width: 0 }),
        gif('x', { height: 5000 }),
        gif('x', { title: 'x'.repeat(201) }),
    ])
        assert.equal((await api(member, '/gif-favorites', 'POST', invalid)).status, 400);
    assert.equal((await request(service.app, '/gif-favorites', null)).status, 401);
});

test('a member can keep up to 200 favourite GIFs', async (t) => {
    const { service, member } = await fixture(t);
    const insert = service.db.prepare(
        'INSERT INTO gif_favorites(id,user,url,preview,width,height,title,created) VALUES(?,?,?,?,?,?,?,?)',
    );
    for (let index = 0; index < 200; index++)
        insert.run(
            `f${index}`,
            member.user.id,
            `https://static.klipy.com/${index}.webp`,
            `https://static.klipy.com/${index}.webp`,
            10,
            10,
            '',
            index,
        );
    const response = await request(
        service.app,
        '/gif-favorites',
        member.token,
        'POST',
        gif('one-more'),
    );
    assert.equal(response.status, 400);
    assert.match(response.data.error, /200/);
});

test('KLIPY results keep their URLs untouched and their order, with a clear limit message', async () => {
    const item = (id, size = {}) => ({
        id,
        title: `Item ${id}`,
        type: 'gif',
        file: {
            hd: {
                webp: {
                    url: `https://static.klipy.com/${id}/hd.webp?tracking=1`,
                    width: 498,
                    height: 280,
                    ...size,
                },
            },
            sm: {
                webp: { url: `https://static2.klipy.com/${id}/sm.webp`, width: 220, height: 124 },
            },
        },
    });
    assert.deepEqual(klipyGif(item(7)), {
        id: '7',
        title: 'Item 7',
        send: { url: 'https://static.klipy.com/7/hd.webp?tracking=1', width: 498, height: 280 },
        preview: { url: 'https://static2.klipy.com/7/sm.webp', width: 220, height: 124 },
    });
    assert.equal(
        klipyGif({
            id: 1,
            file: { hd: { webp: { url: 'https://evil.example/x', width: 1, height: 1 } } },
        }),
        null,
    );
    const requests = [];
    const transport = async (url) => {
        requests.push(url);
        return {
            ok: true,
            status: 200,
            json: async () => ({
                result: true,
                data: { data: [item(2), item(1)], has_next: true },
            }),
        };
    };
    const trending = await klipyGifs('key', '  ', 1, undefined, transport);
    assert.deepEqual(
        trending.gifs.map((entry) => entry.id),
        ['2', '1'],
    );
    assert.equal(trending.next, true);
    assert.equal(requests[0], 'https://api.klipy.com/api/v1/key/gifs/trending?page=1&per_page=24');
    await klipyGifs('key', 'happy cat', 3, undefined, transport);
    assert.equal(
        requests[1],
        'https://api.klipy.com/api/v1/key/gifs/search?page=3&per_page=24&q=happy+cat',
    );
    await assert.rejects(
        klipyGifs('key', '', 1, undefined, async () => ({ ok: false, status: 429 })),
        /hourly limit/,
    );
});

test('only a message that is just a KLIPY media link shows as a GIF', () => {
    const link = 'https://static.klipy.com/ii/abc/happy.webp';
    assert.equal(klipyGifMessage(`  ${link}\n`), link);
    assert.equal(klipyGifMessage(`look ${link}`), null);
    assert.equal(klipyGifMessage('https://static.klipy.com.evil.example/x.webp'), null);
    assert.equal(klipyGifMessage('https://user:pass@static.klipy.com/x.webp'), null);
    assert.equal(isKlipyMedia('https://static.klipy.com:8443/x.webp'), false);
    assert.equal(isKlipyMedia(`https://static.klipy.com/${'x'.repeat(2100)}`), false);
});
