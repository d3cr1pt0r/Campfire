import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
import { serverConfig } from '../server/config.js';
import {
    publicAddress,
    safeFetch,
    pageMetadata,
    youtubeVideo,
    previewLinks,
} from '../server/link-previews.js';

test('only public internet addresses may be fetched for previews', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2607:f8b0:4004:800::200e', '::ffff:8.8.8.8'])
        assert.equal(publicAddress(address), true, address);
    for (const address of [
        '127.0.0.1',
        '10.1.2.3',
        '172.20.0.1',
        '192.168.1.5',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '224.0.0.1',
        '::1',
        '::',
        'fe80::1',
        'fd12::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '64:ff9b::7f00:1',
        'not-an-address',
    ])
        assert.equal(publicAddress(address), false, address);
});

test('the fetcher refuses other schemes, credentials, ports and private DNS answers', async () => {
    const resolve = (answers) => async () => answers.map((address) => ({ address }));
    const refuse = (url, answers = ['93.184.216.34']) =>
        assert.rejects(safeFetch(url, { accept: '*/*', maxBytes: 10, resolve: resolve(answers) }));
    await refuse('file:///etc/passwd');
    await refuse('ftp://example.com/');
    await refuse('https://user:secret@example.com/');
    await refuse('https://example.com:8443/');
    await refuse('http://example.com:3001/');
    await refuse('http://127.0.0.1/');
    await refuse('http://[::1]/');
    await refuse('http://metadata.example/', ['169.254.169.254']);
    // One private answer is enough to refuse, so a mixed DNS reply cannot slip through.
    await refuse('http://mixed.example/', ['93.184.216.34', '10.0.0.5']);
    await refuse('http://nothing.example/', []);
});

test('page tags give the title, description, site and image in any attribute order', () => {
    const html = `<html><head>
        <title>Fallback title</title>
        <meta content="Breaking &amp; important &#8212; news" property="og:title">
        <meta property='og:description' content='A   long
            description &quot;quoted&quot;'>
        <meta name="twitter:card" content="summary_large_image">
        <meta property="og:image" content="/images/lead.jpg?w=1200&amp;h=630">
        <meta property="og:site_name" content="Daily Example">
    </head></html>`;
    assert.deepEqual(pageMetadata(html, 'https://news.example/story/1'), {
        title: 'Breaking & important — news',
        description: 'A long description "quoted"',
        site: 'Daily Example',
        image: 'https://news.example/images/lead.jpg?w=1200&h=630',
        large: true,
        video: false,
    });
    const plain = pageMetadata(
        `<title> Just a title </title><meta name="description" content="${'x'.repeat(400)}">`,
        'https://www.plain.example/',
    );
    assert.equal(plain.title, 'Just a title');
    assert.equal(plain.site, 'plain.example');
    assert.equal(plain.description.length, 300);
    assert.equal(plain.image, null);
    assert.equal(plain.large, false);
});

test('YouTube links of every common shape are recognised', () => {
    for (const link of [
        'https://www.youtube.com/watch?v=RUB37QhWNkw',
        'https://youtube.com/watch?v=RUB37QhWNkw&t=42s',
        'https://m.youtube.com/watch?v=RUB37QhWNkw',
        'https://music.youtube.com/watch?v=RUB37QhWNkw',
        'https://youtu.be/RUB37QhWNkw?si=abc',
        'https://www.youtube.com/shorts/RUB37QhWNkw',
        'https://www.youtube.com/live/RUB37QhWNkw',
    ])
        assert.equal(youtubeVideo(link), 'RUB37QhWNkw', link);
    for (const link of [
        'https://www.youtube.com/watch?v=short',
        'https://www.youtube.com/channel/UC123',
        'https://notyoutube.com/watch?v=RUB37QhWNkw',
        'not a link',
    ])
        assert.equal(youtubeVideo(link), null, link);
});

test('the first three links outside code get previews, not GIFs or credentials', () => {
    assert.deepEqual(
        previewLinks(
            'See https://a.example/one, (https://b.example/two) and https://a.example/one again: https://c.example/three! https://d.example/four',
        ),
        ['https://a.example/one', 'https://b.example/two', 'https://c.example/three'],
    );
    assert.deepEqual(previewLinks('`https://code.example/` ```\nhttps://block.example/\n```'), []);
    assert.deepEqual(previewLinks('https://static.klipy.com/ii/abc/cat.webp'), []);
    assert.deepEqual(previewLinks('https://user:pass@secret.example/'), []);
    assert.deepEqual(previewLinks(String.raw`https://wiki.example/\_private\_`), [
        'https://wiki.example/_private_',
    ]);
    assert.deepEqual(previewLinks('https://wiki.example/A_(film)'), [
        'https://wiki.example/A_(film)',
    ]);
    assert.deepEqual(previewLinks(undefined), []);
});

const jpeg = (width, height) =>
    sharp({ create: { width, height, channels: 3, background: '#2266aa' } })
        .jpeg()
        .toBuffer();

async function fixture(t, pages) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-previews-'));
    const requests = [];
    const linkPreviewFetcher = async (url) => {
        requests.push(url);
        const page = pages[url];
        if (!page) throw new Error('Unreachable');
        return { url, ...(await page()) };
    };
    const service = createApp({ dataDir: directory, linkPreviews: true, linkPreviewFetcher });
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
        member = await signup('Member');
    const post = async (account, body) => {
        const response = await request(service.app, '/messages', account.token, 'POST', {
            room: 'general',
            body,
        });
        assert.equal(response.status, 200, JSON.stringify(response.data));
        await service.previews.idle();
        return response.data;
    };
    const view = async (id) => (await request(service.app, `/messages/${id}`, member.token)).data;
    return { service, owner, member, post, view, requests };
}

test('posted links get cards from the page tags and YouTube, with server-made images', async (t) => {
    const article = `<meta property="og:title" content="Rover lands"><meta property="og:description" content="It worked."><meta property="og:image" content="https://news.example/lead.jpg"><meta name="twitter:card" content="summary_large_image">`;
    const f = await fixture(t, {
        'https://news.example/rover': async () => ({
            type: 'text/html; charset=utf-8',
            body: Buffer.from(article),
        }),
        'https://news.example/lead.jpg': async () => ({
            type: 'image/jpeg',
            body: await jpeg(1600, 900),
        }),
        'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DRUB37QhWNkw':
            async () => ({
                type: 'application/json',
                body: Buffer.from(JSON.stringify({ title: 'A talk', author_name: 'A channel' })),
            }),
        'https://i.ytimg.com/vi/RUB37QhWNkw/hqdefault.jpg': async () => ({
            type: 'image/jpeg',
            body: await jpeg(480, 360),
        }),
    });
    const message = await f.post(
        f.owner,
        'Look: https://news.example/rover and https://youtu.be/RUB37QhWNkw and https://down.example/',
    );
    const previews = (await f.view(message.id)).previews;
    assert.deepEqual(
        previews.map(({ title, description, site, image, width, height, large, video }) => ({
            title,
            description,
            site,
            image,
            width,
            height,
            large,
            video,
        })),
        [
            {
                title: 'Rover lands',
                description: 'It worked.',
                site: 'news.example',
                image: true,
                width: 640,
                height: 360,
                large: true,
                video: false,
            },
            // YouTube thumbnails are cropped from 4:3 to 16:9.
            {
                title: 'A talk',
                description: 'A channel',
                site: 'YouTube',
                image: true,
                width: 640,
                height: 360,
                large: true,
                video: true,
            },
        ],
    );
    const picture = await request(
        f.service.app,
        `/link-previews/${previews[0].id}/image`,
        f.member.token,
    );
    assert.equal(picture.status, 200);
    assert.match(String(picture.headers['content-type']), /image\/webp/);
    assert.equal(
        (await request(f.service.app, `/link-previews/${previews[0].id}/image`, null)).status,
        401,
    );
    // Pages are fetched once: another message linking the same pages reuses the cards,
    // and the unreachable page is not retried within the hour.
    const fetched = f.requests.length;
    const again = await f.post(f.member, 'https://news.example/rover https://down.example/');
    assert.equal(f.requests.length, fetched);
    assert.equal((await f.view(again.id)).previews.length, 1);
});

test('the author or a moderator can remove a message’s cards, and edits keep them removed', async (t) => {
    const page = (title) => async () => ({
        type: 'text/html',
        body: Buffer.from(`<meta property="og:title" content="${title}">`),
    });
    const f = await fixture(t, {
        'https://site.example/a': page('Page A'),
        'https://site.example/b': page('Page B'),
    });
    const mine = await f.post(f.member, 'https://site.example/a');
    assert.equal((await f.view(mine.id)).previews[0].title, 'Page A');
    // Editing the link fetches the new page's card.
    await request(f.service.app, `/messages/${mine.id}`, f.member.token, 'PATCH', {
        body: 'https://site.example/b',
    });
    await f.service.previews.idle();
    assert.equal((await f.view(mine.id)).previews[0].title, 'Page B');
    const theirs = await f.post(f.owner, 'https://site.example/a');
    assert.equal(
        (await request(f.service.app, `/messages/${theirs.id}/previews`, f.member.token, 'DELETE'))
            .status,
        403,
    );
    assert.equal(
        (await request(f.service.app, `/messages/${mine.id}/previews`, f.member.token, 'DELETE'))
            .status,
        200,
    );
    assert.equal((await f.view(mine.id)).previews, undefined);
    await request(f.service.app, `/messages/${mine.id}`, f.member.token, 'PATCH', {
        body: 'https://site.example/a again',
    });
    await f.service.previews.idle();
    assert.equal((await f.view(mine.id)).previews, undefined);
    // The owner moderates channels, so they may remove the member's cards too.
    const other = await f.post(f.member, 'https://site.example/a');
    assert.equal(
        (await request(f.service.app, `/messages/${other.id}/previews`, f.owner.token, 'DELETE'))
            .status,
        200,
    );
});

test('previews can be switched off for a server', async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-previews-off-'));
    let fetches = 0;
    const service = createApp({
        dataDir: directory,
        linkPreviews: false,
        linkPreviewFetcher: async () => {
            fetches++;
            throw new Error('Should not fetch');
        },
    });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const owner = (
        await request(service.app, '/auth/register', null, 'POST', {
            username: 'Owner',
            password: 'test-password-123',
            setupCode: 'test-owner-setup',
        })
    ).data;
    await request(service.app, '/messages', owner.token, 'POST', {
        room: 'general',
        body: 'https://a.example/',
    });
    await service.previews.idle();
    assert.equal(fetches, 0);
    assert.equal(serverConfig({ LINK_PREVIEWS: 'off' }).linkPreviews, false);
    assert.equal(serverConfig({ LINK_PREVIEWS: ' OFF ' }).linkPreviews, false);
    assert.equal(serverConfig({}).linkPreviews, true);
});
