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
    name = name.trim();
    if (kind === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    if (!(kind === 'text' ? /^[a-z0-9-]{1,32}$/ : /^[\p{L}\p{N} _-]{1,32}$/u).test(name))
        throw new Error(
            kind === 'text'
                ? 'Use 1–32 letters, numbers, spaces, or hyphens'
                : 'Use 1–32 letters, numbers, spaces, underscores, or hyphens',
        );
    return name;
}
