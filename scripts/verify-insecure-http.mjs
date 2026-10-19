import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
import { serverConfig } from '../server/config.js';

const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-http-'));
const config = serverConfig({ TLS: 'off', ALLOW_INSECURE_HTTP: '1' });
const service = createApp({ ...config, tls: null, dataDir: path.join(directory, 'data') });
try {
    const account = await request(service.app, '/auth/register', null, 'POST', {
        username: 'HttpTester',
        password: 'http-test-password',
        setupCode: 'test-owner-setup',
    });
    if (account.status !== 200) throw Error('Unable to create isolated test account');
    await new Promise((resolve) => service.http.listen(0, config.host, resolve));
    // A second loopback address exercises the remote-address policy without using a real LAN.
    const origin = `http://127.0.0.2:${service.http.address().port}`;
    const env = {
        ...process.env,
        HTTP_ORIGIN: origin,
        HTTP_PROFILE: path.join(directory, 'profile'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/insecure-http.cjs')], {
        env,
        stdio: 'inherit',
    });
    process.exitCode = await new Promise((resolve, reject) => {
        child.once('exit', (code) => resolve(code ?? 1));
        child.once('error', reject);
    });
} finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
}
