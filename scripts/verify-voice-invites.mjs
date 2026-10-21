import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
const require = createRequire(import.meta.url);
const { createRendererServer, listenRendererServer } = require('../electron/renderer-server.cjs');
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-voice-invites-'));
const output = '/tmp/campfire-voice-invite-review';
const service = createApp({ dataDir: path.join(directory, 'data'), name: 'Voice invitations' });
let renderer;
try {
    await mkdir(output, { recursive: true });
    const accounts = [];
    for (const username of ['Alice', 'Bob', 'Casey']) {
        const response = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'voice-invite-password',
            setupCode: 'test-owner-setup',
        });
        if (response.status !== 200) throw Error(JSON.stringify(response.data));
        accounts.push(response.data);
    }
    await request(service.app, '/channels', accounts[0].token, 'POST', {
        name: 'Game Room',
        kind: 'voice',
    });
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    renderer = createRendererServer(path.join(root, 'dist'));
    const port = await listenRendererServer(renderer);
    const env = {
        ...process.env,
        INVITE_ORIGIN: `http://127.0.0.1:${service.http.address().port}`,
        INVITE_RENDERER: `http://127.0.0.1:${port}`,
        INVITE_ACCOUNTS: JSON.stringify(accounts),
        INVITE_PROFILE: path.join(directory, 'profile'),
        INVITE_OUTPUT: output,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/voice-invites.cjs')], {
        env,
        stdio: 'inherit',
    });
    process.exitCode = await new Promise((resolve, reject) => {
        child.once('exit', (code) => resolve(code ?? 1));
        child.once('error', reject);
    });
} finally {
    renderer?.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
}
