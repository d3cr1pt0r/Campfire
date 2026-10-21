import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
const require = createRequire(import.meta.url);
const { createRendererServer, listenRendererServer } = require('../electron/renderer-server.cjs');
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-audio-'));
const output = '/tmp/campfire-audio-review';
const service = createApp({ dataDir: path.join(directory, 'data'), name: 'Audio verification' });
let renderer;
try {
    await mkdir(output, { recursive: true });
    const accounts = [];
    for (const username of ['Alice', 'Bob']) {
        const response = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'audio-verification-password',
            setupCode: 'test-owner-setup',
        });
        if (response.status !== 200) throw Error('Registration failed');
        accounts.push(response.data);
    }
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    renderer = createRendererServer(process.env.AUDIO_DIST || path.join(root, 'dist'));
    const port = await listenRendererServer(renderer);
    const assets = await readdir(
        path.join(process.env.AUDIO_DIST || path.join(root, 'dist'), 'assets'),
    );
    const worklet = assets.find((name) => name.startsWith('voiceGate.worklet-'));
    const env = {
        ...process.env,
        AUDIO_WORKLET: worklet ? `/assets/${worklet}` : '',
        AUDIO_ORIGIN: `http://127.0.0.1:${service.http.address().port}`,
        AUDIO_RENDERER: `http://127.0.0.1:${port}`,
        AUDIO_ACCOUNTS: JSON.stringify(accounts),
        AUDIO_PROFILE: path.join(directory, 'profile'),
        AUDIO_OUTPUT: output,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/audio-settings.cjs')], {
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
