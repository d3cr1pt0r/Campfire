import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { createShowcaseServer } from './showcase/server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const outputArg = args.find((arg) => arg.startsWith('--output='));
if (args.some((arg) => arg !== '--preview' && !arg.startsWith('--output=')))
    throw new Error('Usage: npm run showcase -- [--preview] [--output=/path/image.png]');
const output = path.resolve(
    root,
    outputArg?.slice('--output='.length) || 'Docs/screenshots/campfire-desktop.png',
);
if (!output.endsWith('.png')) throw new Error('Showcase output must have a .png extension.');

const temporary = await mkdtemp(path.join(tmpdir(), 'campfire-showcase-'));
let server;
try {
    server = await createShowcaseServer(root, path.join(temporary, 'vite'));
    await server.listen();
    const address = server.httpServer.address();
    const environment = {
        ...process.env,
        TZ: 'UTC',
        SHOWCASE_URL: `http://127.0.0.1:${address.port}`,
        SHOWCASE_OUTPUT: output,
        SHOWCASE_PROFILE: path.join(temporary, 'electron'),
        SHOWCASE_PREVIEW: preview ? '1' : '0',
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'scripts/showcase/capture.cjs')], {
        cwd: root,
        env: environment,
        stdio: 'inherit',
    });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        const code = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', (code) => resolve(code ?? 1));
        });
        process.exitCode = code;
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
} finally {
    await server?.close();
    await rm(temporary, { recursive: true, force: true });
}
