import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { createScreenAudio } = createRequire(import.meta.url)('../electron/screen-audio.cjs');
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'campfire-pipewire-test-'));
const children = [];
const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
const bridge = createScreenAudio({
    helperPath: path.join(root, 'electron/native/bin/campfire-pipewire'),
    excludePid: 0,
});
const graph = () => JSON.parse(execFileSync('pw-dump', { encoding: 'utf8' }));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = () =>
    graph()
        .filter((entry) => entry.type.endsWith(':Node'))
        .map((entry) => entry.info.props);
const original = snapshot()
    .filter(
        (props) => props['media.class'] === 'Audio/Sink' || props['media.class'] === 'Audio/Source',
    )
    .map((props) => props['object.serial']);
const capture = (name) =>
    new Promise((resolve, reject) => {
        const child = spawn('pw-record', [
            '--raw',
            '--rate=48000',
            '--format=f32',
            '--channels=2',
            `--target=${name}`,
            '-',
        ]);
        children.push(child);
        const chunks = [];
        let size = 0,
            error = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(Error('No audio arrived from the capture source. ' + error));
        }, 6000);
        child.stderr.on('data', (bytes) => {
            error += bytes;
        });
        child.stdout.on('data', (bytes) => {
            chunks.push(bytes);
            size += bytes.length;
            if (size >= 48000 * 2 * 4) {
                clearTimeout(timer);
                child.kill();
                const data = Buffer.concat(chunks);
                const samples = [];
                for (let i = data.length - 24000 * 2 * 4; i + 4 <= data.length; i += 8)
                    samples.push(data.readFloatLE(i));
                resolve(samples);
            }
        });
        child.once('error', reject);
    });
const amplitude = (samples, frequency) => {
    let real = 0,
        imaginary = 0;
    for (let i = 0; i < samples.length; i++) {
        const phase = (2 * Math.PI * frequency * i) / 48000;
        real += samples[i] * Math.cos(phase);
        imaginary += samples[i] * Math.sin(phase);
    }
    return (2 * Math.hypot(real, imaginary)) / samples.length;
};
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
    for (const [frequency, name] of [
        [440, 'Campfire test application'],
        [880, 'campfire'],
    ]) {
        const child = spawn(binary, [String(frequency), name]);
        children.push(child);
    }
    let info;
    for (let i = 0; i < 30; i++) {
        bridge.selected(owner, { name: 'Synthetic test window' });
        info = await bridge.info(owner);
        if (info.applications.some((app) => app.name === 'Campfire test application')) break;
        await pause(100);
    }
    assert.equal(info.available, true, info.reason);
    const application = info.applications.find((app) => app.name === 'Campfire test application');
    assert.ok(application, 'fixture is discovered');
    assert.equal(
        info.applications.some((app) => app.name === 'campfire'),
        false,
    );
    const source = await bridge.start(owner, info.token, application.id);
    const samples = await capture(source.name);
    const included = amplitude(samples, 440),
        excluded = amplitude(samples, 880);
    assert.ok(included > 0.02, `selected application audio arrives: ${included}`);
    assert.ok(excluded < 0.005, `Campfire audio is excluded: ${excluded}`);
    console.log(
        'PASS native capture delivers selected application audio and excludes Campfire playback',
    );
    await bridge.stop(owner, source.token);
    bridge.selected(owner, { name: 'Synthetic system share' });
    const systemInfo = await bridge.info(owner);
    const system = await bridge.start(owner, systemInfo.token, 'system');
    const lateTone = spawn(binary, ['660', 'Campfire late test application']);
    children.push(lateTone);
    let routes;
    for (let i = 0; i < 30; i++) {
        const entries = graph();
        const input = entries.find(
            (entry) =>
                entry.type.endsWith(':Node') &&
                entry.info.props['node.name'] === system.name + '-input',
        );
        const nodes = entries.filter((entry) => entry.type.endsWith(':Node'));
        const links = entries.filter(
            (entry) => entry.type.endsWith(':Link') && entry.info['input-node-id'] === input?.id,
        );
        routes = links.map(
            (entry) =>
                nodes.find((node) => node.id === entry.info['output-node-id'])?.info.props[
                    'application.name'
                ],
        );
        if (routes.includes('Campfire late test application')) break;
        await pause(100);
    }
    assert.ok(routes.includes('Campfire test application'));
    assert.ok(routes.includes('Campfire late test application'));
    assert.equal(
        routes.some((name) => name?.toLowerCase() === 'campfire'),
        false,
    );
    await bridge.stop(owner, system.token);
    console.log('PASS system mode includes new application streams and excludes Campfire');
    await pause(200);
    assert.equal(
        snapshot().some((props) => props['node.name'] === source.name),
        false,
    );
    const remaining = snapshot()
        .filter(
            (props) =>
                props['media.class'] === 'Audio/Sink' || props['media.class'] === 'Audio/Source',
        )
        .map((props) => props['object.serial']);
    for (const serial of original)
        assert.ok(remaining.includes(serial), 'original audio device is preserved');
    console.log(
        'PASS stopping capture removes the temporary source and preserves existing audio devices',
    );
} finally {
    bridge.close();
    for (const child of children) child.kill();
    await rm(directory, { recursive: true, force: true });
}
