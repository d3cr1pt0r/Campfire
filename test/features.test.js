import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitImage, attachmentFrame } from '../src/images.ts';
import { rememberedDevice } from '../src/devices.ts';
import { messageParts } from '../src/messageText.ts';
import { channelName, boundedPng, imageMime } from '../server/images.js';
import { emojis } from '../shared/emojis.js';
test('profile resize preserves aspect ratio, fits 512 pixels, and never upscales', () => {
    assert.deepEqual(fitImage(2048, 1024, 512), { width: 512, height: 256 });
    assert.deepEqual(fitImage(100, 200, 512), { width: 100, height: 200 });
    assert.deepEqual(fitImage(300, 1200, 512), { width: 128, height: 512 });
    assert.deepEqual(fitImage(20000, 1, 128), { width: 128, height: 1 });
});
test('device recovery matches a unique label without guessing between duplicate devices', () => {
    const devices = [
        { kind: 'audioinput', deviceId: 'new-mic', label: 'USB Mic' },
        { kind: 'audiooutput', deviceId: 'new-speakers', label: 'Headset' },
        { kind: 'audioinput', deviceId: 'default', label: 'Default' },
    ];
    assert.equal(rememberedDevice(devices, 'audioinput', 'old', 'USB Mic'), 'new-mic');
    assert.equal(rememberedDevice(devices, 'audiooutput', 'old', 'Headset'), 'new-speakers');
    assert.equal(rememberedDevice(devices, 'audioinput', '', 'USB Mic'), '');
    assert.equal(rememberedDevice(devices, 'audioinput', 'new-mic', 'Other'), 'new-mic');
    assert.equal(rememberedDevice(devices, 'audioinput', 'old', 'Missing'), 'old');
    assert.equal(
        rememberedDevice(
            [...devices, { kind: 'audioinput', deviceId: 'another', label: 'USB Mic' }],
            'audioinput',
            'old',
            'USB Mic',
        ),
        'old',
    );
});
test('image attachments keep their own shape within 480×360, cropping only extreme ones', () => {
    assert.deepEqual(attachmentFrame(1920, 400), { width: 480, height: 100 });
    assert.deepEqual(attachmentFrame(1200, 1600), { width: 270, height: 360 });
    assert.deepEqual(attachmentFrame(120, 80), { width: 120, height: 80 });
    // Slivers keep a 48px side and are cropped; tiny images are never enlarged.
    assert.deepEqual(attachmentFrame(4800, 100), { width: 480, height: 48 });
    assert.deepEqual(attachmentFrame(200, 6000), { width: 48, height: 360 });
    assert.deepEqual(attachmentFrame(20, 10), { width: 20, height: 10 });
});
test('message links support HTTPS, query strings and balanced parentheses while excluding executable schemes', () => {
    const text =
        'See https://example.com/a?q=x&b=y, and https://example.com/a_(test). :party_cat: javascript:alert(1)';
    const parts = messageParts(text);
    assert.equal(parts.map((p) => p.text).join(''), text);
    assert.deepEqual(
        parts.filter((p) => p.link).map((p) => p.text),
        ['https://example.com/a?q=x&b=y', 'https://example.com/a_(test)'],
    );
    assert.ok(parts.some((p) => p.text === ':party_cat:'));
    assert.ok(!messageParts('https://user:password@example.com').some((p) => p.link));
    assert.deepEqual(
        messageParts('(https://example.com/a)')
            .filter((p) => p.link)
            .map((p) => p.text),
        ['https://example.com/a'],
    );
});
test('channel naming supports ordinary voice display names and normalizes text names', () => {
    assert.equal(channelName('Test', 'voice'), 'Test');
    assert.equal(channelName(' Test Room ', 'voice'), 'Test Room');
    assert.equal(channelName('Test Room', 'text'), 'test-room');
    assert.equal(channelName('Lounge 2', 'voice'), 'Lounge 2');
    for (const value of ['', ' ', 'x'.repeat(33), '<script>'])
        assert.throws(() => channelName(value, 'voice'));
});
test('raster upload validation rejects excessive dimensions, SVG and oversized payloads', () => {
    const valid = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
        'base64',
    );
    assert.equal(imageMime(valid), 'image/png');
    assert.equal(boundedPng(valid.toString('base64'), 512), valid.toString('base64'));
    const large = Buffer.from(valid);
    large.writeUInt32BE(513, 20);
    assert.throws(() => boundedPng(large.toString('base64'), 512));
    assert.throws(() => boundedPng(Buffer.from('<svg/>').toString('base64'), 512));
    assert.throws(() => boundedPng('A'.repeat(2100001), 512));
    assert.equal(imageMime(Buffer.from('<html>')), null);
});
test('expanded standard emoji catalog contains no duplicates and includes complex sequences', () => {
    assert.ok(emojis.length > 200);
    assert.equal(emojis.length, new Set(emojis).size);
    assert.ok(emojis.includes('❤️‍🔥'));
    assert.ok(emojis.includes('🚀'));
});

test('file picker and drop selection share count, per-file and combined limits', async () => {
    const { validateFileSelection, maxUploadBytes } = await import('../shared/uploads.js');
    validateFileSelection([{ size: 1 }, { size: 2 }]);
    validateFileSelection([{ size: maxUploadBytes }]);
    assert.throws(
        () => validateFileSelection(Array.from({ length: 11 }, () => ({ size: 1 }))),
        /10 files/,
    );
    assert.throws(() => validateFileSelection([{ size: maxUploadBytes + 1 }]), /5 MB/);
    assert.throws(() => validateFileSelection([{ size: maxUploadBytes }, { size: 1 }]), /total/);
});

test('display names prefer nicknames while preserving the permanent username as fallback', async () => {
    const { displayName } = await import('../src/profiles.ts');
    assert.equal(displayName({ nickname: 'Display', username: 'account' }), 'Display');
    assert.equal(displayName({ nickname: '', username: 'account' }), 'account');
    assert.equal(displayName(undefined, 'Former member'), 'Former member');
});

test('avatar initials handle single names, hyphens, extra spaces and Unicode names', async () => {
    const { initials } = await import('../src/profiles.ts');
    assert.equal(initials('Icy'), 'I');
    assert.equal(initials(' Alex  Rivera '), 'AR');
    assert.equal(initials('Jean-Luc'), 'JL');
    assert.equal(initials('Žiga Čop'), 'ŽČ');
    assert.equal(initials(''), '?');
});
