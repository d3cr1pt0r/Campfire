import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { randomUUID } from 'node:crypto';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';
const root = path.resolve(import.meta.dirname, '..');
const sound = process.argv.includes('--sound');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-member-ui-'));
const output = '/tmp/campfire-member-review';
const service = createApp({
    dataDir: path.join(directory, 'data'),
    name: 'Member messaging verification',
});
try {
    await mkdir(output, { recursive: true });
    const members = [];
    for (const username of ['Alice', 'Bob', 'Casey', 'Dana']) {
        const response = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'member-ui-password',
            setupCode: 'test-owner-setup',
        });
        if (response.status !== 200) throw Error('Unable to create verification account');
        members.push(response.data);
    }
    // Seed directory-only members without exercising the registration rate limit.
    for (let i = 0; i < 46; i++) {
        const id = randomUUID();
        const username = `Member${i + 1}`;
        service.db
            .prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)')
            .run(id, username, 'fixture-unused-password', members[1].user.role);
        service.db.prepare('INSERT INTO profiles(user,nickname) VALUES(?,?)').run(id, username);
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
    const child = spawn(
        electron,
        [
            path.join(
                root,
                sound ? 'test-support/notification-sound.cjs' : 'test-support/member-messaging.cjs',
            ),
        ],
        {
            env,
            stdio: 'inherit',
        },
    );
    process.exitCode = await new Promise((resolve, reject) => {
        child.once('exit', (code) => resolve(code ?? 1));
        child.once('error', reject);
    });
} finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
}
