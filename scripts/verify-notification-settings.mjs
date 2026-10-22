import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import electron from 'electron';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-notification-ui-'));
const output = '/tmp/campfire-notification-review';
const service = createApp({ dataDir: path.join(directory, 'data'), name: 'Notification review' });
try {
    await mkdir(output, { recursive: true });
    const members = [];
    for (const username of ['Alice', 'Bob']) {
        const result = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'settings-test-password',
            setupCode: 'test-owner-setup',
        });
        if (result.status !== 200) throw Error(JSON.stringify(result.data));
        members.push(result.data);
    }
    await new Promise((resolve) => service.http.listen(0, '127.0.0.1', resolve));
    const env = {
        ...process.env,
        MEMBER_ORIGIN: `http://127.0.0.1:${service.http.address().port}`,
        MEMBER_FIXTURE: JSON.stringify(members),
        MEMBER_PROFILE: path.join(directory, 'profile'),
        MEMBER_OUTPUT: output,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.resolve('test-support/notification-settings.cjs')], {
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
