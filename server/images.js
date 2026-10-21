const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function imageMime(data) {
    if (data.length >= 24 && data.subarray(0, 8).equals(pngSignature)) return 'image/png';
    if (data.length >= 10 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6)))
        return 'image/gif';
    if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255)
        return 'image/jpeg';
    if (
        data.length >= 12 &&
        data.toString('ascii', 0, 4) === 'RIFF' &&
        data.toString('ascii', 8, 12) === 'WEBP'
    )
        return 'image/webp';
    return null;
}
const sized = (width, height, animated = false) =>
    width > 0 && height > 0 && width <= 100000 && height <= 100000
        ? { width, height, animated }
        : null;
const colorTable = (flags) => (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0);
function pngInfo(data) {
    // An acTL chunk before the image data marks an animated PNG.
    for (let offset = 8; offset + 12 <= data.length; ) {
        const type = data.toString('ascii', offset + 4, offset + 8);
        if (type === 'IDAT' || type === 'IEND') break;
        if (type === 'acTL')
            return sized(
                data.readUInt32BE(16),
                data.readUInt32BE(20),
                data.readUInt32BE(offset + 8) > 1,
            );
        offset += data.readUInt32BE(offset) + 12;
    }
    return sized(data.readUInt32BE(16), data.readUInt32BE(20));
}
function gifInfo(data) {
    let offset = 13 + colorTable(data[10]);
    let frames = 0;
    const skipSubBlocks = () => {
        while (offset < data.length && data[offset]) offset += data[offset] + 1;
        offset++;
    };
    while (offset < data.length && frames < 2) {
        if (data[offset] === 0x2c) {
            frames++;
            offset += 10 + colorTable(data[offset + 9]) + 1;
            skipSubBlocks();
        } else if (data[offset] === 0x21) {
            offset += 2;
            skipSubBlocks();
        } else break;
    }
    return sized(data.readUInt16LE(6), data.readUInt16LE(8), frames > 1);
}
function exifOrientation(data, tiff) {
    const little = data.toString('ascii', tiff, tiff + 2) === 'II';
    const u16 = (at) => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
    const u32 = (at) => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
    const directory = tiff + u32(tiff + 4);
    for (let entry = 0, count = u16(directory); entry < count; entry++) {
        const at = directory + 2 + entry * 12;
        if (u16(at) === 0x0112) return u16(at + 8);
    }
    return 1;
}
function jpegInfo(data) {
    let orientation = 1;
    for (let offset = 2; offset + 4 <= data.length; ) {
        if (data[offset] !== 0xff) return null;
        const marker = data[offset + 1];
        if (marker === 0xff) {
            offset++;
            continue;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            offset += 2;
            continue;
        }
        if (marker === 0xe1 && data.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0')
            orientation = exifOrientation(data, offset + 10);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            const height = data.readUInt16BE(offset + 5),
                width = data.readUInt16BE(offset + 7);
            // EXIF orientations 5–8 turn the picture sideways, as previews do.
            return orientation >= 5 && orientation <= 8
                ? sized(height, width)
                : sized(width, height);
        }
        if (marker === 0xda) return null;
        offset += 2 + data.readUInt16BE(offset + 2);
    }
    return null;
}
function webpInfo(data) {
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8 ')
        return sized(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') {
        const bits = data.readUInt32LE(21);
        return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X')
        return sized(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1, !!(data[20] & 0x02));
    return null;
}
// Reads the displayed pixel size and whether the image animates from its header, so
// clients can reserve exact space before loading it. Unknown or malformed data is null.
export function imageInfo(data) {
    try {
        const mime = imageMime(data);
        if (mime === 'image/png') return pngInfo(data);
        if (mime === 'image/gif') return gifInfo(data);
        if (mime === 'image/jpeg') return jpegInfo(data);
        if (mime === 'image/webp') return webpInfo(data);
    } catch {
        /* Truncated headers read past the end of the data. */
    }
    return null;
}
// The client decodes/resizes/re-encodes uploads. Enforce the stored raster size
// independently rather than accepting unbounded source images or SVG content.
export function boundedPng(encoded, side) {
    if (
        typeof encoded !== 'string' ||
        encoded.length > 2100000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    )
        throw new Error('Upload a resized PNG image (maximum 1.5 MB)');
    const data = Buffer.from(encoded, 'base64');
    if (
        imageMime(data) !== 'image/png' ||
        data.length < 45 ||
        data.toString('ascii', 12, 16) !== 'IHDR' ||
        data.readUInt32BE(8) !== 13
    )
        throw new Error('Invalid PNG image');
    const width = data.readUInt32BE(16),
        height = data.readUInt32BE(20);
    if (!width || !height || width > side || height > side || data.length > 1572864)
        throw new Error(`Image must be at most ${side} × ${side} pixels and 1.5 MB`);
    return data.toString('base64');
}
export function channelName(name, kind) {
    if (!['text', 'voice'].includes(kind) || typeof name !== 'string')
        throw new Error('Invalid channel type or name');
    name = name.trim().normalize('NFC');
    if (kind === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    if (
        !(kind === 'text' ? /^[\p{L}\p{M}\p{N}-]{1,32}$/u : /^[\p{L}\p{M}\p{N} _-]{1,32}$/u).test(
            name,
        )
    )
        throw new Error(
            kind === 'text'
                ? 'Use 1–32 letters, numbers, spaces, or hyphens'
                : 'Use 1–32 letters, numbers, spaces, underscores, or hyphens',
        );
    return name;
}
