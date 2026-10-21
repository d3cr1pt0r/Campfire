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
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-invite-ui-'));
const output = '/tmp/campfire-invite-members';
const service = createApp({ dataDir: path.join(directory, 'data'), name: 'Invitation review' });
const sockets = [];
let renderer;
try {
    await mkdir(output, { recursive: true });
    const accounts = [];
    for (const username of ['Owner', 'Offline', 'Busy', 'Idle', 'Zeta', 'Able']) {
        const result = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'invite-members-test-password',
            setupCode: 'test-owner-setup',
        });
        assert.equal(result.status, 200);
        accounts.push(result.data);
    }
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${service.http.address().port}`;
    for (const account of accounts.slice(2)) {
        const socket = io(origin, { auth: { token: account.token }, transports: ['websocket'] });
        sockets.push(socket);
        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
        });
        if (['Busy', 'Idle'].includes(account.user.username)) {
            assert.equal(
                (
                    await request(service.app, '/presence', account.token, 'PATCH', {
                        status: account.user.username === 'Busy' ? 'dnd' : 'idle',
                    })
                ).status,
                200,
            );
        }
    }
    renderer = createRendererServer(path.join(root, 'dist'));
    const port = await listenRendererServer(renderer);
    const env = {
        ...process.env,
        INVITE_ORIGIN: origin,
        INVITE_RENDERER: `http://127.0.0.1:${port}`,
        INVITE_ACCOUNT: JSON.stringify(accounts[0]),
        INVITE_OUTPUT: output,
        INVITE_PROFILE: path.join(directory, 'profile'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/invite-members.cjs')], {
        env,
        stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
    });
    assert.equal(code, 0);
    const offline = accounts.find((account) => account.user.username === 'Offline');
    assert.equal(
        service.db
            .prepare('SELECT COUNT(*) n FROM voice_channel_invitations WHERE recipient=?')
            .get(offline.user.id).n,
        2,
    );
    console.log('PASS reopen and resend delivered two separate DM invitations');
} finally {
    for (const socket of sockets) socket.disconnect();
    renderer?.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
}
