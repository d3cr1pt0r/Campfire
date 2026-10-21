const { createHash, randomUUID } = require('node:crypto');
const { mkdir, readFile, writeFile, rename, unlink } = require('node:fs/promises');
const path = require('node:path');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Binary storage survives renderer-port changes and avoids putting large image
// bytes through the synchronous preferences bridge.
function createAvatarStore(directory) {
    const location = (key) => {
        if (typeof key !== 'string' || key.length > 4096) throw Error('Invalid avatar key');
        const parts = JSON.parse(key);
        if (
            !Array.isArray(parts) ||
            parts.length !== 3 ||
            parts.some((part) => typeof part !== 'string' || !part) ||
            !/^\/avatars\/[\w-]+$/.test(parts[2])
        )
            throw Error('Invalid avatar key');
        return path.join(directory, createHash('sha256').update(key).digest('hex') + '.png');
    };
    const valid = (bytes) =>
        bytes.length <= 2 * 1024 * 1024 && bytes.subarray(0, 8).equals(signature);
    return {
        async read(key) {
            try {
                const bytes = await readFile(location(key));
                return valid(bytes) ? bytes : null;
            } catch {
                return null;
            }
        },
        async write(key, bytes) {
            let temporary;
            try {
                const file = location(key);
                if (!(bytes instanceof Uint8Array)) return false;
                const data = Buffer.from(bytes);
                if (!valid(data)) return false;
                await mkdir(directory, { recursive: true, mode: 0o700 });
                temporary = file + '.' + randomUUID() + '.tmp';
                await writeFile(temporary, data, { mode: 0o600 });
                await rename(temporary, file);
                return true;
            } catch {
                return false;
            } finally {
                if (temporary) await unlink(temporary).catch(() => {});
            }
        },
    };
}
module.exports = { createAvatarStore };
