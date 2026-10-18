import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
const require = createRequire(import.meta.url);
const { createRendererServer, listenRendererServer } = require('../electron/renderer-server.cjs');
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-popouts-'));
let server;
try {
    const outDir = path.join(directory, 'dist');
    await build({
        root,
        configFile: false,
        plugins: [react()],
        build: {
            outDir,
            rollupOptions: { input: path.join(root, 'test-support/stream-popout.html') },
        },
    });
    server = createRendererServer(outDir);
    const port = await listenRendererServer(server);
    const env = {
        ...process.env,
        POPOUT_URL: `http://127.0.0.1:${port}/test-support/stream-popout.html`,
        POPOUT_PROFILE: path.join(directory, 'profile'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/stream-popout.cjs')], {
        env,
        stdio: 'inherit',
    });
    process.exitCode = await new Promise((resolve, reject) => {
        child.once('exit', (code) => resolve(code ?? 1));
        child.once('error', reject);
    });
} finally {
    server?.close();
    await rm(directory, { recursive: true, force: true });
}
