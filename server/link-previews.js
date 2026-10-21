import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { isKlipyMedia } from '../shared/klipy.js';
import { check, route } from './policies.js';

// Link previews: the server fetches a linked page once, reads its Open Graph tags (or
// YouTube's oEmbed data), shrinks its image and stores the card. Members' apps never
// contact the linked site, and the fetcher refuses anything outside the public internet.

const agent =
    'Mozilla/5.0 (compatible; CampfireLinkPreview/1.0; +https://github.com/d3cr1pt0r/Campfire)';
const blocked = new net.BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
])
    blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
    ['::', 127],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
])
    blocked.addSubnet(address, prefix, 'ipv6');

// True only for addresses on the public internet: no loopback, private, link-local,
// carrier-grade NAT, documentation, multicast or mapped ranges (cloud metadata included).
export function publicAddress(address) {
    const family = net.isIP(address);
    // BlockList judges IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) by their IPv4 rules.
    return !!family && !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

const resolveHost = async (hostname) => lookup(hostname, { all: true, verbatim: true });

// GET a public http(s) URL on its standard port. The connection goes to the address that
// was checked, so a DNS answer cannot change between the check and the request.
export async function safeFetch(
    target,
    { accept, maxBytes, truncate = false, redirects = 3, resolve = resolveHost } = {},
) {
    const url = new URL(target);
    check(['http:', 'https:'].includes(url.protocol), 'Unsupported link');
    check(!url.username && !url.password, 'Unsupported link');
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    check(port === (url.protocol === 'https:' ? 443 : 80), 'Unsupported port');
    const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const addresses = net.isIP(hostname) ? [{ address: hostname }] : await resolve(hostname);
    check(
        addresses.length && addresses.every(({ address }) => publicAddress(address)),
        'Link points to a private network',
    );
    const response = await new Promise((done, fail) => {
        const request = (url.protocol === 'https:' ? https : http).request(
            {
                host: addresses[0].address,
                port,
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                servername: net.isIP(hostname) ? undefined : hostname,
                headers: { host: url.host, 'user-agent': agent, accept, 'accept-language': 'en' },
                timeout: 5000,
            },
            (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    res.resume();
                    return done({ redirect: new URL(res.headers.location, url).href });
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return fail(new Error(`The page answered ${res.statusCode}`));
                }
                const chunks = [];
                let size = 0;
                const finish = () =>
                    done({
                        url: url.href,
                        type: String(res.headers['content-type'] || ''),
                        body: Buffer.concat(chunks),
                    });
                res.on('data', (chunk) => {
                    size += chunk.length;
                    if (size <= maxBytes) return chunks.push(chunk);
                    res.destroy();
                    // Pages keep their tags near the top, so a long page is read in part.
                    if (truncate) finish();
                    else fail(new Error('The response is too large'));
                });
                res.on('end', finish);
                res.on('error', fail);
            },
        );
        request.on('timeout', () => request.destroy(new Error('The page took too long')));
        request.on('error', fail);
        request.end();
    });
    if (!response.redirect) return response;
    check(redirects > 0, 'Too many redirects');
    return safeFetch(response.redirect, {
        accept,
        maxBytes,
        truncate,
        redirects: redirects - 1,
        resolve,
    });
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text) =>
    text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
        if (code[0] !== '#') return entities[code.toLowerCase()] ?? entity;
        const point =
            code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
const clean = (text, limit) => {
    const value = decode(String(text || ''))
        .replace(/\s+/g, ' ')
        .trim();
    return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
};

// Title, description, site name and image from a page's Open Graph, Twitter and HTML tags.
export function pageMetadata(html, pageUrl) {
    const meta = {};
    for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attributes = {};
        for (const match of tag.matchAll(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi))
            attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
        const key = (attributes.property || attributes.name || '').toLowerCase();
        if (key && attributes.content && !(key in meta)) meta[key] = attributes.content;
    }
    const pageTitle = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
    let image = null;
    const source =
        meta['og:image:secure_url'] ||
        meta['og:image'] ||
        meta['og:image:url'] ||
        meta['twitter:image'] ||
        meta['twitter:image:src'];
    try {
        if (source) image = new URL(decode(source), pageUrl).href;
    } catch {
        image = null;
    }
    return {
        title: clean(meta['og:title'] || meta['twitter:title'] || pageTitle, 200),
        description: clean(
            meta['og:description'] || meta['twitter:description'] || meta.description,
            300,
        ),
        site: clean(meta['og:site_name'] || new URL(pageUrl).hostname.replace(/^www\./, ''), 80),
        image,
        large:
            meta['twitter:card'] === 'summary_large_image' || /^video/.test(meta['og:type'] || ''),
        video: /^video/.test(meta['og:type'] || ''),
    };
}

// The 11-character video id of a YouTube watch, short, live or youtu.be link.
export function youtubeVideo(link) {
    try {
        const url = new URL(link);
        const host = url.hostname.replace(/^(www|m|music)\./, '');
        const id =
            host === 'youtu.be'
                ? url.pathname.slice(1)
                : host === 'youtube.com'
                  ? url.pathname === '/watch'
                      ? url.searchParams.get('v')
                      : /^\/(shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[2]
                  : null;
        return id && /^[\w-]{11}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}

// Links in a message that get previews: the first three, outside code, not KLIPY GIFs.
export function previewLinks(body) {
    const text = String(body || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`\n]*`/g, ' ')
        .replace(/\\([\\`*_~>.-])/g, '$1');
    const links = [];
    for (const [raw] of text.matchAll(/https?:\/\/[^\s<>]+/gi)) {
        let link = raw.replace(/[.,!?;:'"]+$/, '');
        while (
            link.endsWith(')') &&
            (link.match(/\(/g)?.length || 0) < (link.match(/\)/g)?.length || 0)
        )
            link = link.slice(0, -1);
        try {
            const url = new URL(link);
            if (url.username || url.password || isKlipyMedia(url.href) || links.includes(url.href))
                continue;
            links.push(url.href);
        } catch {
            /* Not a link after all. */
        }
        if (links.length === 3) break;
    }
    return links;
}

export const previewId = (url) => createHash('sha256').update(url).digest('hex').slice(0, 32);

const day = 86400000;
export function createLinkPreviews({ get, run, enabled = true, fetcher = safeFetch }) {
    const pending = new Map(),
        unfurls = new Set();
    let active = 0;
    let closed = false;
    const queue = [];
    const pump = () => {
        while (active < 3 && queue.length) {
            const task = queue.shift();
            active++;
            task().finally(() => {
                active--;
                pump();
            });
        }
    };
    const card = async (url) => {
        const video = youtubeVideo(url);
        if (video) {
            const watch = `https://www.youtube.com/watch?v=${video}`;
            const response = await fetcher(
                `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
                { accept: 'application/json', maxBytes: 65536 },
            );
            const data = JSON.parse(response.body.toString('utf8'));
            return {
                title: clean(data.title, 200),
                description: clean(data.author_name, 300),
                site: 'YouTube',
                image: `https://i.ytimg.com/vi/${video}/hqdefault.jpg`,
                large: true,
                video: true,
            };
        }
        const page = await fetcher(url, {
            accept: 'text/html,application/xhtml+xml',
            maxBytes: 512 * 1024,
            truncate: true,
        });
        check(/text\/html|application\/xhtml\+xml/i.test(page.type), 'Not a web page');
        return pageMetadata(page.body.toString('utf8'), page.url);
    };
    const picture = async (source, video) => {
        const response = await fetcher(source, { accept: 'image/*', maxBytes: 5 * 1024 * 1024 });
        check(/^image\//i.test(response.type), 'Not an image');
        // YouTube thumbnails carry letterbox bars; cropping to 16:9 removes them.
        const { data, info } = await sharp(response.body, {
            limitInputPixels: 40_000_000,
            pages: 1,
        })
            .rotate()
            .resize(
                video
                    ? { width: 640, height: 360, fit: 'cover' }
                    : { width: 640, height: 640, fit: 'inside', withoutEnlargement: true },
            )
            .webp({ quality: 72 })
            .timeout({ seconds: 5 })
            .toBuffer({ resolveWithObject: true });
        check(data.length <= 300 * 1024, 'The image is too large');
        return { data, width: info.width, height: info.height };
    };
    const store = async (url) => {
        if (closed) return false;
        let row = {
            title: '',
            description: '',
            site: '',
            image: null,
            width: 0,
            height: 0,
            large: 0,
            video: 0,
            failed: 1,
        };
        try {
            const found = await card(url);
            if (found.title) {
                row = {
                    ...row,
                    ...found,
                    large: found.large ? 1 : 0,
                    video: found.video ? 1 : 0,
                    failed: 0,
                };
                if (found.image)
                    try {
                        const image = await picture(found.image, found.video);
                        row = {
                            ...row,
                            image: image.data,
                            width: image.width,
                            height: image.height,
                        };
                    } catch {
                        /* The card still shows without its image. */
                    }
            }
        } catch {
            /* Unreachable, blocked or unsupported pages simply get no preview. */
        }
        if (closed) return false;
        // Not REPLACE: replacing the row would cascade away every message's link to it.
        run(
            'INSERT INTO link_previews(id,url,title,description,site,image,image_width,image_height,large,video,fetched,failed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,site=excluded.site,image=excluded.image,image_width=excluded.image_width,image_height=excluded.image_height,large=excluded.large,video=excluded.video,fetched=excluded.fetched,failed=excluded.failed',
            previewId(url),
            url,
            row.title,
            row.description,
            row.site,
            row.image,
            row.width,
            row.height,
            row.large,
            row.video,
            Date.now(),
            row.failed,
        );
        // Keep the cache bounded, dropping unlinked cards first; the oldest previews are
        // fetched again if linked again.
        run(
            'DELETE FROM link_previews WHERE id IN (SELECT p.id FROM link_previews p ORDER BY EXISTS(SELECT 1 FROM message_link_previews l WHERE l.preview=p.id) DESC,p.fetched DESC LIMIT -1 OFFSET 5000)',
        );
        return !row.failed;
    };
    const refresh = (url) => {
        const cached = get('SELECT fetched,failed FROM link_previews WHERE url=?', url);
        if (cached && Date.now() - cached.fetched < (cached.failed ? day / 24 : day)) return null;
        if (pending.has(url)) return pending.get(url);
        if (closed || queue.length >= 50) return null;
        const result = new Promise((done) => {
            queue.push(() => store(url).then(done, () => done(false)));
        });
        pending.set(url, result);
        result.finally(() => pending.delete(url));
        pump();
        return result;
    };
    // Points a message at the stored cards of the links in its current text.
    const link = (id) => {
        run('DELETE FROM message_link_previews WHERE message=?', id);
        const message = get('SELECT body FROM messages WHERE id=?', id);
        if (!message || get('SELECT 1 FROM hidden_link_previews WHERE message=?', id)) return;
        previewLinks(message.body).forEach((url, position) =>
            run(
                'INSERT INTO message_link_previews(message,position,preview) SELECT ?,?,id FROM link_previews WHERE id=?',
                id,
                position,
                previewId(url),
            ),
        );
    };
    const unfurl = async (id) => {
        if (!enabled) return false;
        const message = get('SELECT body FROM messages WHERE id=?', id);
        if (!message || get('SELECT 1 FROM hidden_link_previews WHERE message=?', id)) return false;
        const work = previewLinks(message.body).map(refresh).filter(Boolean);
        if (!work.length) return false;
        const changed = (await Promise.all(work)).some(Boolean);
        if (closed) return false;
        link(id);
        return changed;
    };
    const settled = () => Promise.allSettled([...pending.values(), ...unfurls]);
    return {
        enabled,
        link,
        // Cards no message shows go a day after their fetch, so the refetch cache still applies.
        prune: () =>
            run(
                'DELETE FROM link_previews WHERE fetched<? AND NOT EXISTS(SELECT 1 FROM message_link_previews WHERE preview=link_previews.id)',
                Date.now() - day,
            ),
        // Fetches previews for a message's links, then reports whether any card changed.
        unfurl(id) {
            const task = unfurl(id);
            const clear = () => unfurls.delete(task);
            unfurls.add(task);
            task.then(clear, clear);
            return task;
        },
        async idle() {
            await settled();
        },
        // Lets running fetches finish without writing, before the database closes.
        async close() {
            closed = true;
            queue.length = 0;
            await settled();
        },
    };
}

export function registerLinkPreviews({
    app,
    get,
    run,
    hasRoom,
    canInRoom,
    messageView,
    emitRoom,
    previews,
}) {
    app.get(
        '/api/link-previews/:id/image',
        route((req, res) => {
            const row = get(
                'SELECT image FROM link_previews WHERE id=? AND image IS NOT NULL',
                req.params.id,
            );
            check(row, 'Preview image not found', 404);
            res.setHeader('Cache-Control', 'private, max-age=86400');
            res.type('image/webp').send(Buffer.from(row.image));
        }),
    );
    // The author, or someone who may delete others' channel messages, can remove the cards.
    app.delete(
        '/api/messages/:id/previews',
        route((req, res) => {
            const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
            check(m && hasRoom(req.user, m.room), 'Message not found', 404);
            check(
                m.author === req.user.id ||
                    (!m.room.startsWith('dm:') &&
                        canInRoom(req.user, m.room, 'messages.deleteOthers')),
                'Only the author can remove these previews',
                403,
            );
            run('INSERT OR IGNORE INTO hidden_link_previews(message) VALUES(?)', m.id);
            previews.link(m.id);
            previews.prune();
            emitRoom(m.room, 'message:update', messageView(m));
            res.json({ ok: true });
        }),
    );
    return previews;
}
