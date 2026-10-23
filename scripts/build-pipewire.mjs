import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'linux') process.exit(0);
const root = fileURLToPath(new URL('..', import.meta.url));
const flags = spawnSync('pkg-config', ['--cflags', '--libs', 'libpipewire-0.3', 'x11'], {
    encoding: 'utf8',
});
if (flags.status !== 0)
    throw Error(
        'Building Linux audio capture requires a C compiler, pkg-config, libpipewire-0.3-dev and libx11-dev.',
    );
const output = path.join(root, 'electron/native/bin/campfire-pipewire');
mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync(
    process.env.CC || 'cc',
    [
        '-std=gnu11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-o',
        output,
        path.join(root, 'electron/native/pipewire-capture.c'),
        ...flags.stdout.trim().split(/\s+/),
    ],
    { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Built ${output}`);
