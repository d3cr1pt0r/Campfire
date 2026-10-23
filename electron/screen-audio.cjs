const { spawn: spawnProcess } = require('node:child_process');
const { randomUUID } = require('node:crypto');

// One temporary source per renderer. The helper owns all of its PipeWire objects;
// terminating it removes those objects without restoring or changing system defaults.
function createScreenAudio({ helperPath, spawn = spawnProcess, excludePid = process.pid }) {
    const selections = new Map();
    const sessions = new Map();
    const pendingStarts = new Map();
    const watched = new WeakSet();
    const stop = async (owner, token) => {
        if (!token || selections.get(owner.id)?.token === token) selections.delete(owner.id);
        if (!token || pendingStarts.get(owner.id) === token) pendingStarts.delete(owner.id);
        const session = sessions.get(owner.id);
        if (token && session?.token !== token) return;
        if (!session) return;
        sessions.delete(owner.id);
        session.stopping = true;
        session.child.stdin?.end();
        session.child.kill();
        await new Promise((resolve) => {
            if (session.child.exitCode !== null) return resolve();
            const timer = setTimeout(() => {
                session.child.kill('SIGKILL');
                resolve();
            }, 1000);
            session.child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    };
    const selected = (owner, selection) => {
        if (!owner || owner.isDestroyed()) return;
        selections.set(owner.id, { ...selection, token: randomUUID(), choices: new Set() });
        if (watched.has(owner)) return;
        watched.add(owner);
        owner.once('destroyed', () => void stop(owner));
        owner.on('render-process-gone', () => void stop(owner));
        owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
            if (mainFrame && !inPlace) void stop(owner);
        });
    };
    const list = (windowId) =>
        new Promise((resolve, reject) => {
            const args = ['--list', '--exclude-pid', String(excludePid)];
            if (windowId) args.push('--window', String(windowId));
            const child = spawn(helperPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '',
                error = '';
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(Error('PipeWire did not respond.'));
            }, 5000);
            child.stdout.on('data', (bytes) => {
                output += bytes;
                if (output.length > 1024 * 1024) {
                    child.kill();
                    reject(Error('Too many audio sources.'));
                }
            });
            child.stderr.on('data', (bytes) => {
                error = (error + bytes).slice(-4096);
            });
            child.once('error', () => {
                clearTimeout(timer);
                reject(Error('Linux audio capture is unavailable in this build.'));
            });
            child.once('exit', (code) => {
                clearTimeout(timer);
                if (code !== 0)
                    return reject(Error(error.trim() || 'PipeWire audio is unavailable.'));
                try {
                    resolve(JSON.parse(output));
                } catch {
                    reject(Error('Invalid PipeWire source list.'));
                }
            });
        });
    const info = async (owner) => {
        const selection = selections.get(owner.id);
        if (!selection) throw Error('Choose a screen or window first.');
        try {
            const snapshot = await list(selection.windowId);
            if (selections.get(owner.id) !== selection) throw Error('Screen selection changed.');
            const applications = [],
                groups = new Set();
            for (const source of snapshot.applications) {
                if (!/^\d+$/.test(source.id)) continue;
                const key =
                    /^\d+$/.test(source.pid) && Number(source.pid) > 0 ? source.pid : source.id;
                if (groups.has(key)) continue;
                groups.add(key);
                applications.push({
                    id: source.id,
                    name: String(source.name).slice(0, 200),
                    pid: source.pid,
                });
            }
            applications.sort((a, b) => a.name.localeCompare(b.name));
            selection.choices = new Set(['system', ...applications.map((source) => source.id)]);
            const matches = applications.filter(
                (source) => Number(source.pid) === snapshot.windowPid && snapshot.windowPid > 0,
            );
            return {
                token: selection.token,
                selection: selection.name,
                available: true,
                applications: applications.map(({ id, name }) => ({ id, name })),
                recommended: matches.length === 1 ? matches[0].id : 'none',
            };
        } catch (error) {
            return {
                token: selection.token,
                selection: selection.name,
                available: false,
                applications: [],
                recommended: 'none',
                reason: error.message,
            };
        }
    };
    const start = async (owner, token, choice) => {
        const selection = selections.get(owner.id);
        if (!selection || token !== selection.token || !selection.choices.has(choice))
            throw Error('Choose an available audio source for the current screen share.');
        // Claim this selection before awaiting shutdown, so another IPC cannot start twice.
        selections.delete(owner.id);
        pendingStarts.set(owner.id, token);
        const previous = sessions.get(owner.id);
        if (previous) await stop(owner, previous.token);
        if (owner.isDestroyed() || pendingStarts.get(owner.id) !== token)
            throw Error('Screen sharing was cancelled.');
        pendingStarts.delete(owner.id);
        const name = `campfire-share-${randomUUID()}`;
        const child = spawn(
            helperPath,
            ['--application', choice, '--name', name, '--exclude-pid', String(excludePid)],
            { stdio: ['pipe', 'pipe', 'pipe'] },
        );
        const session = { child, token, name, stopping: false };
        sessions.set(owner.id, session);
        let ready = false,
            output = '',
            error = '';
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                void stop(owner, token);
                reject(Error('The audio source did not become ready.'));
            }, 5000);
            child.stdout.on('data', (bytes) => {
                output += bytes;
                if (output.length > 65536) {
                    void stop(owner, token);
                    reject(Error('Invalid audio helper response.'));
                }
                for (let newline; (newline = output.indexOf('\n')) >= 0; ) {
                    const line = output.slice(0, newline);
                    output = output.slice(newline + 1);
                    try {
                        const event = JSON.parse(line);
                        if (
                            event.event === 'ready' &&
                            event.name === name &&
                            sessions.get(owner.id) === session
                        ) {
                            ready = true;
                            clearTimeout(timer);
                            resolve({ token, name });
                        }
                    } catch {
                        /* A malformed record is handled by the readiness timeout. */
                    }
                }
            });
            child.stderr.on('data', (bytes) => {
                error = (error + bytes).slice(-4096);
            });
            child.once('error', () => {
                clearTimeout(timer);
                void stop(owner, token);
                reject(Error('Unable to start Linux audio capture.'));
            });
            child.once('exit', () => {
                clearTimeout(timer);
                if (sessions.get(owner.id) === session) sessions.delete(owner.id);
                if (!ready)
                    reject(
                        Error(
                            session.stopping
                                ? 'Screen sharing was cancelled.'
                                : error.trim() || 'Audio capture stopped before it was ready.',
                        ),
                    );
                else if (!session.stopping && !owner.isDestroyed())
                    owner.send('screen-audio:ended', token);
            });
        });
    };
    return {
        selected,
        info,
        start,
        stop,
        close() {
            selections.clear();
            pendingStarts.clear();
            for (const session of sessions.values()) {
                session.stopping = true;
                session.child.kill();
            }
            sessions.clear();
        },
    };
}

function installScreenAudio({ app, ipcMain, trusted, helperPath }) {
    const capture = createScreenAudio({ helperPath });
    const authorize = (event) => {
        if (!trusted(event.senderFrame?.url) || event.senderFrame !== event.sender.mainFrame)
            throw Error('Untrusted audio capture request');
        return event.sender;
    };
    ipcMain.handle('screen-audio:info', (event) => capture.info(authorize(event)));
    ipcMain.handle('screen-audio:start', (event, token, choice) =>
        capture.start(authorize(event), token, choice),
    );
    ipcMain.handle('screen-audio:stop', (event, token) => capture.stop(authorize(event), token));
    app.on('before-quit', () => capture.close());
    return capture;
}
module.exports = { createScreenAudio, installScreenAudio };
