import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
const { createRendererServer, listenRendererServer } = createRequire(import.meta.url)(
    '../electron/renderer-server.cjs',
);
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-retention-'));
const output = process.env.RETENTION_OUTPUT || path.join(tmpdir(), 'campfire-retention');
const day = 86400000;
const service = createApp({ dataDir: path.join(directory, 'data'), name: 'Retention review' });
let renderer, control;
try {
    await mkdir(output, { recursive: true });
    const accounts = [];
    for (const username of ['Owner', 'Member']) {
        const result = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'retention-test-password',
            setupCode: 'test-owner-setup',
        });
        assert.equal(result.status, 200);
        accounts.push(result.data);
    }
    const post = async (body, extra = {}) =>
        (
            await request(service.app, '/messages', accounts[1].token, 'POST', {
                room: 'general',
                body,
                ...extra,
            })
        ).data;
    const age = (id, days) =>
        service.db
            .prepare('UPDATE messages SET created=created-?1,since=since-?1 WHERE id=?2')
            .run(days * day, id);
    const messages = {};
    for (const [name, days] of [
        ['Forty days old', 40],
        ['Almost due', 26],
        ['Thread start', 10],
    ]) {
        messages[name] = await post(name);
        age(messages[name].id, days);
    }
    messages.reply = await post('Thread reply', { thread: messages['Thread start'].id });
    age(messages.reply.id, 10);
    await post('Fresh message');
    // The desktop app asks this to age a thread and run a cleanup pass.
    control = createServer(async (req, res) => {
        if (req.url === '/expire-thread') {
            for (const message of [messages['Thread start'], messages.reply]) age(message.id, 25);
            await service.retention.sweep();
        }
        res.end('ok');
    });
    await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    renderer = createRendererServer(path.join(root, 'dist'));
    const port = await listenRendererServer(renderer);
    const env = {
        ...process.env,
        RETENTION_ORIGIN: `http://127.0.0.1:${service.http.address().port}`,
        RETENTION_RENDERER: `http://127.0.0.1:${port}`,
        RETENTION_CONTROL: `http://127.0.0.1:${control.address().port}`,
        RETENTION_ACCOUNT: JSON.stringify(accounts[0]),
        RETENTION_OUTPUT: output,
        RETENTION_PROFILE: path.join(directory, 'profile'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/retention.cjs')], {
        env,
        stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
    });
    assert.equal(code, 0);
    // The app's uploads arrive as raw bytes.
    assert.deepEqual(
        service.db
            .prepare('SELECT name,typeof(data) type FROM attachments ORDER BY name')
            .all()
            .map((row) => ({ ...row })),
        [
            { name: 'dot.png', type: 'blob' },
            { name: 'notes.txt', type: 'blob' },
        ],
    );
    console.log('PASS uploads from the app are stored as raw bytes');
    console.log(`Screenshots: ${output}`);
} finally {
    control?.close();
    renderer?.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
}
