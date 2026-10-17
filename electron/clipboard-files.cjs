const { open, constants } = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;

function pathsFromFormat(format, bytes) {
    if (bytes.length > 65536) throw Error('Too many clipboard files');
    if (format === 'FileNameW') return bytes.toString('utf16le').split('\0').filter(Boolean);
    if (format === 'CF_HDROP') {
        if (bytes.length < 20) return [];
        const offset = bytes.readUInt32LE(0);
        if (offset < 20 || offset >= bytes.length) return [];
        return bytes
            .subarray(offset)
            .toString(bytes.readUInt32LE(16) ? 'utf16le' : 'latin1')
            .split('\0')
            .filter(Boolean);
    }
    return bytes
        .toString('utf8')
        .split(/[\r\n\0]+/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('file:'))
        .map((line) => {
            try {
                return fileURLToPath(line);
            } catch {
                throw Error('Only local clipboard files are supported');
            }
        });
}

async function clipboardAttachments(clipboard) {
    // Only paths supplied by an OS file-copy clipboard format are accepted.
    // The IPC caller cannot supply paths or request arbitrary filesystem reads.
    const items = await clipboard.read();
    const formats = [
        'CF_HDROP',
        'FileNameW',
        'text/uri-list',
        'x-special/gnome-copied-files',
        'public.file-url',
    ];
    let paths = [];
    for (const format of formats) {
        const types = [format, `electron application/osclipboard;format="${format}"`];
        const item = items.find((item) => types.some((type) => item.types.includes(type)));
        if (!item) continue;
        const type = types.find((type) => item.types.includes(type));
        const blob = await item.getType(type);
        if (blob.size > 65536) throw Error('Too many clipboard files');
        paths = pathsFromFormat(format, Buffer.from(await blob.arrayBuffer()));
        if (paths.length) break;
    }
    paths = [...new Set(paths)];
    if (paths.length > MAX_FILES) throw Error('Attach up to 10 files per message');
    const files = [];
    let total = 0;
    for (const filename of paths) {
        if (!path.isAbsolute(filename)) throw Error('Only local clipboard files are supported');
        const handle = await open(filename, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
        try {
            const stat = await handle.stat();
            if (!stat.isFile()) throw Error('Folders cannot be attached. Select files instead.');
            if (total + stat.size > MAX_BYTES)
                throw Error('Attachments must total 5 MB or less per message');
            const chunks = [];
            const stream = handle.createReadStream({
                start: 0,
                end: MAX_BYTES - total,
                autoClose: false,
            });
            for await (const chunk of stream) {
                total += chunk.length;
                if (total > MAX_BYTES) {
                    stream.destroy();
                    throw Error('Attachments must total 5 MB or less per message');
                }
                chunks.push(chunk);
            }
            files.push({
                name: path.basename(filename),
                data: new Uint8Array(Buffer.concat(chunks)),
                type: '',
            });
        } finally {
            await handle.close();
        }
    }
    if (files.length) return { files, text: '' };
    // Image copies/screenshots do not necessarily expose File objects in Electron.
    const image = items.find((item) => item.types.includes('image/png'));
    if (image) {
        const blob = await image.getType('image/png');
        if (blob.size > MAX_BYTES) throw Error('Files must be 5 MB or smaller');
        return {
            files: [
                {
                    name: 'pasted-image.png',
                    data: new Uint8Array(await blob.arrayBuffer()),
                    type: 'image/png',
                },
            ],
            text: '',
        };
    }
    return { files: [], text: (await clipboard.readText()).slice(0, 4000) };
}
module.exports = { pathsFromFormat, clipboardAttachments };
