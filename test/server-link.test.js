import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatFingerprint,
    normalizeFingerprint,
    parseServerLink,
    restoreConnection,
    serverLink,
} from '../src/serverLink.ts';
import { connectionHint, trustStep } from '../src/serverTrust.ts';
import { notificationKey } from '../src/notifications.ts';
import { preferConstantBitrate } from '../src/signaling.ts';

const pin = 'WMCFB4XOUTLT2JV4NRB45NS7MHMYODME7WWVQCCLSBMAY2ZQBEJQ';
const invite = 'a'.repeat(64);

test('addresses default to HTTPS and reject remote HTTP without an opt-in', () => {
    assert.deepEqual(parseServerLink('203.0.113.5:3001'), { origin: 'https://203.0.113.5:3001' });
    assert.deepEqual(parseServerLink(' https://Chat.Example.com/ '), {
        origin: 'https://chat.example.com',
    });
    assert.deepEqual(parseServerLink('http://localhost:3001'), { origin: 'http://localhost:3001' });
    assert.deepEqual(parseServerLink('http://127.0.0.1:3001'), { origin: 'http://127.0.0.1:3001' });
    assert.throws(() => parseServerLink('http://203.0.113.5:3001'), /use https:\/\//);
    assert.throws(() => parseServerLink('http://chat.example.com'), /use https:\/\//);
    assert.throws(() => parseServerLink('ftp://chat.example.com'), /https:\/\//);
    assert.throws(() => parseServerLink('https://user:pass@chat.example.com'), /only the server/);
    assert.throws(() => parseServerLink('https://chat.example.com/path'), /only the server/);
    assert.throws(() => parseServerLink('https://chat.example.com/?x=1'), /only the server/);
    assert.throws(() => parseServerLink('   '), /Enter a server/);
});

test('server and invite links carry a normalised fingerprint, invitation and setup code', () => {
    const grouped = formatFingerprint(pin);
    assert.match(grouped, /^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
    assert.equal(normalizeFingerprint(grouped.toLowerCase()), pin);
    assert.equal(normalizeFingerprint('ABC'), null);
    const link = serverLink('https://203.0.113.5:3001/', { pin, invite });
    assert.equal(link, `https://203.0.113.5:3001/#pin=${grouped}&invite=${invite}`);
    assert.deepEqual(parseServerLink(link), { origin: 'https://203.0.113.5:3001', pin, invite });
    assert.equal(serverLink('https://chat.example.com', {}), 'https://chat.example.com/');
    assert.deepEqual(parseServerLink(`https://chat.example.com/#pin=${pin}&setup=owner-code`), {
        origin: 'https://chat.example.com',
        pin,
        setup: 'owner-code',
    });
    assert.throws(() => parseServerLink('https://chat.example.com/#pin=ABCD'), /fingerprint/);
    assert.throws(() => parseServerLink('https://chat.example.com/#invite=nope'), /invitation/);
});

test('remote HTTP needs explicit approval and cannot claim fingerprint verification', () => {
    const origin = 'http://192.168.1.5:3001';
    assert.deepEqual(parseServerLink(`${origin}/#invite=${invite}&setup=owner-code`, true), {
        origin,
        invite,
        setup: 'owner-code',
    });
    assert.throws(() => parseServerLink(`${origin}/#invite=${invite}`), /allow insecure HTTP/i);
    assert.throws(
        () => parseServerLink(`${origin}/#pin=${pin}`, true),
        /fingerprints require HTTPS/,
    );
    assert.deepEqual(parseServerLink('192.168.1.5:3001', true), {
        origin: 'https://192.168.1.5:3001',
    });
    assert.deepEqual(
        restoreConnection({ url: origin, token: 'saved' }, '', (value) => value === origin),
        {
            url: origin,
            token: 'saved',
        },
    );
    assert.deepEqual(
        restoreConnection({ url: origin, token: 'saved' }, '', () => false),
        {
            url: 'https://192.168.1.5:3001',
            token: '',
        },
    );
});

test('saved plain-HTTP connections upgrade to HTTPS and require signing in again', () => {
    assert.deepEqual(restoreConnection({ url: 'http://203.0.113.5:3001', token: 't' }, ''), {
        url: 'https://203.0.113.5:3001',
        token: '',
    });
    assert.deepEqual(restoreConnection({ url: 'https://chat.example.com/', token: 't' }, ''), {
        url: 'https://chat.example.com',
        token: 't',
    });
    assert.deepEqual(restoreConnection({ url: 'http://localhost:3001', token: 't' }, ''), {
        url: 'http://localhost:3001',
        token: 't',
    });
    assert.deepEqual(restoreConnection(null, 'https://default'), {
        url: 'https://default',
        token: '',
    });
    assert.deepEqual(restoreConnection({ url: 'javascript:alert(1)', token: 't' }, ''), {
        url: '',
        token: '',
    });
    assert.deepEqual(restoreConnection({ url: 'not a url', token: 't' }, 'x'), {
        url: 'x',
        token: '',
    });
});

test('desktop trust decisions: links vouch for new servers, changed identities are refused', () => {
    const other = 'B'.repeat(52);
    assert.deepEqual(trustStep({ state: 'pinned', fingerprint: pin }), { kind: 'ready' });
    assert.deepEqual(trustStep({ state: 'trusted', fingerprint: pin }), { kind: 'ready' });
    assert.deepEqual(trustStep({ state: 'unknown', fingerprint: pin }), {
        kind: 'confirm',
        fingerprint: pin,
    });
    assert.deepEqual(trustStep({ state: 'unknown', fingerprint: pin }, pin), {
        kind: 'pin',
        fingerprint: pin,
    });
    assert.deepEqual(trustStep({ state: 'unknown', fingerprint: other }, pin), {
        kind: 'mismatch',
        fingerprint: other,
    });
    assert.deepEqual(trustStep({ state: 'changed', fingerprint: other }), {
        kind: 'changed',
        fingerprint: other,
    });
    assert.deepEqual(trustStep({ state: 'changed', fingerprint: other }, other), {
        kind: 'replace',
        fingerprint: other,
    });
    assert.deepEqual(trustStep({ state: 'pinned', fingerprint: pin }, other), {
        kind: 'mismatch',
        fingerprint: pin,
    });
    assert.deepEqual(trustStep({ state: 'unreachable', message: 'timeout' }, pin), {
        kind: 'unreachable',
        message: 'timeout',
    });
});

test('browser network failures to another HTTPS origin explain the certificate step', () => {
    const network = new TypeError('Failed to fetch');
    const remote = 'https://203.0.113.5:3001';
    assert.match(connectionHint(network, remote, 'https://app.example', false), /new tab/);
    assert.equal(connectionHint(network, remote, remote, false), 'Failed to fetch');
    assert.equal(connectionHint(network, remote, 'http://127.0.0.1:5', true), 'Failed to fetch');
    assert.equal(connectionHint(new Error('Denied'), remote, 'x', false), 'Denied');
});

test('notification choices are keyed by host, so HTTP and HTTPS share them', () => {
    assert.equal(
        notificationKey('http://203.0.113.5:3001', 'me', 'general'),
        notificationKey('https://203.0.113.5:3001/', 'me', 'general'),
    );
});

test('voice uses constant-bitrate Opus without disturbing other codecs or parameters', () => {
    const offer = [
        'v=0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10;useinbandfec=1',
        'a=rtpmap:0 PCMU/8000',
        '',
    ].join('\r\n');
    const updated = preferConstantBitrate(offer);
    assert.match(updated, /\r\na=fmtp:111 minptime=10;useinbandfec=1;cbr=1\r\n/);
    assert.equal(preferConstantBitrate(updated), updated);
    assert.equal(updated.includes('usedtx=1'), false);
    const bare = 'm=audio 9 RTP/SAVPF 96\na=rtpmap:96 OPUS/48000/2\na=sendrecv\n';
    assert.equal(
        preferConstantBitrate(bare),
        'm=audio 9 RTP/SAVPF 96\na=rtpmap:96 OPUS/48000/2\na=fmtp:96 cbr=1\na=sendrecv\n',
    );
    const video = 'm=video 9 RTP/SAVPF 96\na=rtpmap:96 VP8/90000\n';
    assert.equal(preferConstantBitrate(video), video);
    assert.equal(
        preferConstantBitrate('a=rtpmap:111 opus/48000/2\na=fmtp:111 cbr=0\n'),
        'a=rtpmap:111 opus/48000/2\na=fmtp:111 cbr=0\n',
    );
});

test('bundled voice and stream audio keep identical Opus parameters', () => {
    const section =
        'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';
    const sdp = 'v=0\r\na=group:BUNDLE voice stream\r\n' + section + section;
    const updated = preferConstantBitrate(sdp);
    assert.equal(updated.match(/;cbr=1/g).length, 2);
    assert.equal(preferConstantBitrate(updated), updated);
});
