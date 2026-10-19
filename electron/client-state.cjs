const { readFileSync, writeFileSync, renameSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const allowedKeys = new Set(['connection', 'preferences', 'rendererPort']);
// Written only by the main process; the renderer's storage bridge cannot reach these.
const internalKeys = new Set(['pins']);

// Keep client state independent of the ephemeral renderer HTTP port.
// On Windows Electron safeStorage encrypts this with the current user's DPAPI key.
function createClientState(directory, encryption) {
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'client-state.dat');
    let state = {};
    try {
        const saved = readFileSync(file);
        const prefix = saved.subarray(0, 1).toString();
        const contents =
            prefix === 'E'
                ? encryption.decryptString(saved.subarray(1))
                : saved.subarray(1).toString('utf8');
        const parsed = JSON.parse(contents);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed;
    } catch {
        /* First launch, unavailable OS key, or corrupt state: sign in again. */
    }
    const read = (keys, key) =>
        keys.has(key) && typeof state[key] === 'string' ? state[key] : null;
    const write = (keys, limit, key, value) => {
        if (
            !keys.has(key) ||
            (value !== null && (typeof value !== 'string' || value.length > limit))
        )
            return false;
        if (value !== null) {
            try {
                JSON.parse(value);
            } catch {
                return false;
            }
        }
        const next = { ...state };
        if (value === null) delete next[key];
        else next[key] = value;
        const json = JSON.stringify(next);
        const encrypted = encryption.isEncryptionAvailable();
        const bytes = Buffer.concat([
            Buffer.from(encrypted ? 'E' : 'P'),
            encrypted ? encryption.encryptString(json) : Buffer.from(json),
        ]);
        writeFileSync(file + '.tmp', bytes, { mode: 0o600 });
        renameSync(file + '.tmp', file);
        state = next;
        return true;
    };
    return {
        get: (key) => read(allowedKeys, key),
        set: (key, value) => write(allowedKeys, 16384, key, value),
        getInternal: (key) => read(internalKeys, key),
        setInternal: (key, value) => write(internalKeys, 262144, key, value),
    };
}
module.exports = { createClientState };
