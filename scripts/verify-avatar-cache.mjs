import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
const require = createRequire(import.meta.url);
const { createRendererServer, listenRendererServer } = require('../electron/renderer-server.cjs');
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-avatar-ui-'));
const service = createApp({
    dataDir: path.join(directory, 'data'),
    name: 'Avatar cache verification',
});
const counts = new Map();
service.http.prependListener('request', (req) => {
    if (req.method === 'GET' && req.url.startsWith('/api/avatars/'))
        counts.set(req.url, (counts.get(req.url) || 0) + 1);
});
let renderer;
try {
    const accounts = [];
    const upload = async (account, color) => {
        const data = await sharp({
            create: { width: 512, height: 512, channels: 4, background: color },
        })
            .png()
            .toBuffer();
        const response = await request(service.app, '/profile/avatar', account.token, 'POST', {
            data: data.toString('base64'),
        });
        assert.equal(response.status, 200);
        return response.data.id;
    };
    for (const username of ['Alice', 'Bob']) {
        const response = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'avatar-cache-test-password',
            setupCode: 'test-owner-setup',
        });
        assert.equal(response.status, 200);
        accounts.push(response.data);
    }
    const ids = [await upload(accounts[0], '#aa5500'), await upload(accounts[1], '#0077aa')];
    for (let i = 0; i < 80; i++) {
        const response = await request(service.app, '/messages', accounts[i % 2].token, 'POST', {
            room: 'general',
            body: `Avatar message ${i + 1}`,
        });
        assert.equal(response.status, 200);
    }
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    let previousPort;
    for (const phase of ['cold', 'restart', 'updated', 'browser-cold', 'browser-restart']) {
        if (phase === 'updated') ids[0] = await upload(accounts[0], '#55aa00');
        if (!renderer) {
            renderer = createRendererServer(path.join(root, 'dist'));
            await listenRendererServer(renderer);
        }
        const port = renderer.address().port;
        // Deliberately use a different renderer origin after restart.
        if (phase !== 'browser-restart' && port === previousPort)
            throw Error('Expected a new renderer port');
        previousPort = port;
        const env = {
            ...process.env,
            AVATAR_PHASE: phase,
            AVATAR_ORIGIN: `http://127.0.0.1:${service.http.address().port}`,
            AVATAR_RENDERER: `http://127.0.0.1:${port}`,
            AVATAR_ACCOUNT: JSON.stringify(accounts[0]),
            AVATAR_IDS: JSON.stringify(ids),
            AVATAR_PROFILE: path.join(directory, 'profile'),
        };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(electron, [path.join(root, 'test-support/avatar-cache.cjs')], {
            env,
            stdio: 'inherit',
        });
        const code = await new Promise((resolve, reject) => {
            child.once('exit', resolve);
            child.once('error', reject);
        });
        assert.equal(code, 0);
        const expected = phase.startsWith('browser') ? 2 : 1;
        assert.equal(
            counts.get(`/api/avatars/${ids[0]}`),
            expected,
            'Alice avatar downloaded once per backend',
        );
        assert.equal(
            counts.get(`/api/avatars/${ids[1]}`),
            expected,
            'Bob avatar downloaded once per backend',
        );
        console.log(
            `PASS ${phase}: cumulative avatar downloads = ${JSON.stringify(Object.fromEntries(counts))}`,
        );
        if (phase !== 'browser-cold') {
            await new Promise((resolve) => renderer.close(resolve));
            renderer = undefined;
        }
    }
} finally {
    renderer?.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
}
