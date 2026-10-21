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
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-appearance-'));
const output = '/tmp/campfire-account-appearance';
const service = createApp({ dataDir: path.join(directory, 'data'), name: 'Appearance review' });
let renderer;
try {
    await mkdir(output, { recursive: true });
    const accounts = [];
    for (const username of ['Alice', 'Bob']) {
        const response = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'appearance-test-password',
            setupCode: 'test-owner-setup',
        });
        if (response.status !== 200) throw Error(JSON.stringify(response.data));
        accounts.push(response.data);
    }
    const room = `dm:${accounts
        .map((account) => account.user.id)
        .sort()
        .join(':')}`;
    const send = async (account, body, conversation = 'general', extra = {}) => {
        const response = await request(service.app, '/messages', account.token, 'POST', {
            room: conversation,
            body,
            ...extra,
        });
        if (response.status !== 200) throw Error(JSON.stringify(response.data));
        return response.data;
    };
    for (let i = 0; i < 65; i++) await send(accounts[i % 2], `Short message ${i + 1}`);
    await send(
        accounts[1],
        '**Formatted message**\n\n- A list item\n- Another list item\n\n```\nconst compact = true;\n```',
    );
    const parent = await send(accounts[1], 'Thread starter');
    for (let i = 0; i < 6; i++)
        await send(accounts[i % 2], `Reply ${i + 1}`, 'general', { thread: parent.id });
    for (let i = 0; i < 18; i++) await send(accounts[i % 2], `Direct message ${i + 1}`, room);
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    renderer = createRendererServer(process.env.APPEARANCE_DIST || path.join(root, 'dist'));
    const port = await listenRendererServer(renderer);
    const env = {
        ...process.env,
        APPEARANCE_ORIGIN: `http://127.0.0.1:${service.http.address().port}`,
        APPEARANCE_RENDERER: `http://127.0.0.1:${port}`,
        APPEARANCE_ACCOUNTS: JSON.stringify(accounts),
        APPEARANCE_PARENT: parent.id,
        APPEARANCE_PROFILE: path.join(directory, 'profile'),
        APPEARANCE_OUTPUT: output,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/message-appearance.cjs')], {
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
