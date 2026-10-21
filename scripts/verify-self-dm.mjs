import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';
import { io } from 'socket.io-client';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
const { createRendererServer, listenRendererServer } = createRequire(import.meta.url)(
    '../electron/renderer-server.cjs',
);
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-self-dm-'));
const output = '/tmp/campfire-self-dm';
const service = createApp({
    dataDir: path.join(directory, 'data'),
    name: 'Personal messages review',
});
const sockets = [],
    delivered = [[], []];
let renderer;
try {
    await mkdir(output, { recursive: true });
    const accounts = [];
    for (const username of ['Owner', 'Other']) {
        const result = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'self-dm-test-password',
            setupCode: 'test-owner-setup',
        });
        assert.equal(result.status, 200);
        accounts.push(result.data);
    }
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${service.http.address().port}`;
    for (const [index, account] of accounts.entries()) {
        const socket = io(origin, { auth: { token: account.token }, transports: ['websocket'] });
        sockets.push(socket);
        socket.on('message', (message) => delivered[index].push(message));
        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
        });
    }
    renderer = createRendererServer(path.join(root, 'dist'));
    const port = await listenRendererServer(renderer);
    const env = {
        ...process.env,
        SELF_DM_ORIGIN: origin,
        SELF_DM_RENDERER: `http://127.0.0.1:${port}`,
        SELF_DM_ACCOUNT: JSON.stringify(accounts[0]),
        SELF_DM_OUTPUT: output,
        SELF_DM_PROFILE: path.join(directory, 'profile'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/self-dm.cjs')], {
        env,
        stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
    });
    assert.equal(code, 0);
    assert.equal(
        delivered[0].length,
        1,
        'another session on the same account receives exactly one note',
    );
    assert.equal(delivered[1].length, 0, 'another account receives no private note');
    assert.equal(delivered[0][0].attachments.length, 1);
    assert.equal(delivered[0][0].body, 'A note to myself');
    console.log('PASS private socket delivery: same account once, other account never');
} finally {
    for (const socket of sockets) socket.disconnect();
    renderer?.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
}
