import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';
import { build } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-screen-audio-'));
let tone;
try {
    const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'libpipewire-0.3'], {
        encoding: 'utf8',
    })
        .trim()
        .split(/\s+/);
    const binary = path.join(directory, 'tone');
    assert.equal(
        spawnSync(
            'cc',
            ['-O2', path.join(root, 'test-support/pipewire-tone.c'), '-o', binary, ...flags, '-lm'],
            { stdio: 'inherit' },
        ).status,
        0,
    );
    tone = spawn(binary, ['440', 'Campfire browser test tone']);
    const dist = path.join(directory, 'dist');
    await build({
        configFile: false,
        root,
        logLevel: 'warn',
        publicDir: false,
        build: {
            outDir: dist,
            rollupOptions: { input: path.join(root, 'test-support/screen-audio.html') },
        },
    });
    const env = {
        ...process.env,
        SCREEN_AUDIO_DIST: dist,
        SCREEN_AUDIO_PROFILE: path.join(directory, 'profile'),
        SCREEN_AUDIO_OUTPUT: path.join(tmpdir(), 'campfire-screen-audio-review'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'test-support/screen-audio.cjs')], {
        env,
        stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
    });
    assert.equal(code, 0);
} finally {
    tone?.kill();
    await rm(directory, { recursive: true, force: true });
}
