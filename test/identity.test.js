import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    fingerprint,
    formatFingerprint,
    issueCertificate,
    loadIdentity,
} from '../server/identity.js';
import { createApp } from '../server/app.js';

const day = 86400000;
const temporary = (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-identity-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
};

test('a self-issued certificate is a valid, short-lived TLS server certificate', () => {
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
    });
    const now = new Date('2026-10-19T12:00:00Z');
    const cert = new X509Certificate(
        issueCertificate(
            key,
            ['localhost', '127.0.0.1', '::1', 'chat.example.com', '2001:db8::5'],
            now,
        ),
    );
    assert.equal(cert.verify(cert.publicKey), true);
    assert.equal(cert.ca, false);
    assert.equal(cert.subject, 'CN=Campfire server');
    assert.equal(
        cert.subjectAltName,
        'DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1, DNS:chat.example.com, IP Address:2001:DB8:0:0:0:0:0:5',
    );
    assert.deepEqual(cert.keyUsage, ['1.3.6.1.5.5.7.3.1']);
    const validity = new Date(cert.validTo) - new Date(cert.validFrom);
    assert.ok(validity <= 825 * day && validity > 800 * day);
    assert.ok(cert.checkHost('localhost') && cert.checkIP('127.0.0.1'));
    assert.equal(fingerprint(cert), fingerprint(key));
    assert.match(fingerprint(key), /^[A-Z2-7]{52}$/);
    assert.match(formatFingerprint(fingerprint(key)), /^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
});

test('identity keys persist, certificates renew from the same key, and SAN changes re-issue', (t) => {
    const directory = temporary(t);
    let now = new Date('2026-10-19T12:00:00Z');
    const first = loadIdentity({ directory, now: () => now });
    const firstCert = first.context().cert;
    const again = loadIdentity({ directory, now: () => now });
    assert.equal(again.fingerprint, first.fingerprint);
    assert.equal(again.context().cert, firstCert);
    assert.equal(again.renew(), false);
    now = new Date(now.getTime() + 800 * day);
    assert.equal(again.renew(), true);
    assert.notEqual(again.context().cert, firstCert);
    assert.equal(fingerprint(new X509Certificate(again.context().cert)), first.fingerprint);
    const moved = loadIdentity({ directory, address: '203.0.113.5', now: () => now });
    assert.equal(moved.fingerprint, first.fingerprint);
    assert.match(new X509Certificate(moved.context().cert).subjectAltName, /203\.0\.113\.5/);
    assert.equal(readFileSync(path.join(directory, 'tls-cert.pem'), 'utf8'), moved.context().cert);
    if (process.platform !== 'win32')
        assert.equal(statSync(path.join(directory, 'tls-key.pem')).mode & 0o777, 0o600);
});

test('a lost or replaced identity key refuses to start without an explicit opt-in', (t) => {
    const directory = temporary(t);
    const original = loadIdentity({ directory });
    unlinkSync(path.join(directory, 'tls-key.pem'));
    assert.throws(
        () => loadIdentity({ directory, recorded: original.fingerprint }),
        /identity key .* is missing/,
    );
    const replacement = loadIdentity({ directory, recorded: original.fingerprint, allowNew: true });
    assert.notEqual(replacement.fingerprint, original.fingerprint);
    assert.throws(
        () => loadIdentity({ directory, recorded: original.fingerprint }),
        /does not match/,
    );
});

test('the server records its identity and refuses to start when the key disappears', async (t) => {
    const dataDir = temporary(t);
    const tls = { directory: path.join(dataDir, 'identity') };
    const service = createApp({ dataDir, tls, setupCode: 'owner-secret' });
    const recorded = service.db
        .prepare("SELECT value FROM settings WHERE key='identity'")
        .get().value;
    assert.equal(recorded, service.identity.fingerprint);
    assert.match(service.identity.certificateSha256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    await service.close();
    unlinkSync(path.join(tls.directory, 'tls-key.pem'));
    assert.throws(() => createApp({ dataDir, tls }), /missing/);
    const renewed = createApp({ dataDir, tls: { ...tls, allowNew: true } });
    assert.notEqual(renewed.identity.fingerprint, recorded);
    await renewed.close();
});
