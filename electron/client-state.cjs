const { readFileSync, writeFileSync, renameSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const allowedKeys = new Set(['connection', 'preferences', 'rendererPort']);

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
    return {
        get(key) {
            return allowedKeys.has(key) && typeof state[key] === 'string' ? state[key] : null;
        },
        set(key, value) {
            if (
                !allowedKeys.has(key) ||
                (value !== null && (typeof value !== 'string' || value.length > 16384))
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
        },
    };
}
module.exports = { createClientState };
