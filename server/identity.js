import {
    X509Certificate,
    createHash,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    randomBytes,
    sign,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';

const day = 86400000;
// Apple platforms reject TLS server certificates valid for longer than 825 days.
const lifetime = 820 * day;
const renewBefore = 30 * day;

export function recordIdentity(run, fingerprint) {
    run(
        "INSERT INTO settings(key,value) VALUES('identity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        fingerprint,
    );
}

// Minimal DER encoding for the one fixed certificate shape Campfire issues itself.
const length = (n) => {
    if (n < 128) return Buffer.from([n]);
    const bytes = [];
    for (; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 255);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const der = (tag, ...parts) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...parts) => der(0x30, ...parts);
const oid = (dotted) => {
    const [first, second, ...rest] = dotted.split('.').map(Number);
    const bytes = [first * 40 + second];
    for (const value of rest) {
        const chunk = [value & 127];
        for (let v = Math.floor(value / 128); v > 0; v = Math.floor(v / 128))
            chunk.unshift((v & 127) | 128);
        bytes.push(...chunk);
    }
    return der(0x06, Buffer.from(bytes));
};
const time = (date) => {
    const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
    // RFC 5280: UTCTime through 2049, GeneralizedTime afterwards.
    return date.getUTCFullYear() < 2050
        ? der(0x17, Buffer.from(iso.slice(2)))
        : der(0x18, Buffer.from(iso));
};
const extension = (id, critical, value) =>
    sequence(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
const ecdsaWithSha256 = sequence(oid('1.2.840.10045.4.3.2'));
const name = sequence(
    der(0x31, sequence(oid('2.5.4.3'), der(0x0c, Buffer.from('Campfire server')))),
);

export function subjectAltNames(address = '') {
    const names = ['localhost', '127.0.0.1', '::1', ...(address ? [address] : [])];
    return [...new Set(names)];
}

function altNameExtension(names) {
    const entries = names.map((value) => {
        if (isIP(value) === 4) return der(0x87, Buffer.from(value.split('.').map(Number)));
        if (isIP(value) === 6) {
            const [head, tail = ''] = value
                .replace(
                    /(\d+)\.(\d+)\.(\d+)\.(\d+)$/,
                    (_, a, b, c, d) =>
                        `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`,
                )
                .split('::');
            const parts = (text) => (text ? text.split(':') : []);
            const groups = [...parts(head)];
            const end = parts(tail);
            while (groups.length + end.length < 8) groups.push('0');
            const bytes = Buffer.alloc(16);
            [...groups, ...end].forEach((group, i) =>
                bytes.writeUInt16BE(parseInt(group, 16), i * 2),
            );
            return der(0x87, bytes);
        }
        return der(0x82, Buffer.from(value, 'ascii'));
    });
    return extension('2.5.29.17', false, sequence(...entries));
}

export function issueCertificate(privateKey, names, now = new Date()) {
    const key = createPrivateKey(privateKey);
    const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
    const serial = randomBytes(16);
    serial[0] = (serial[0] & 0x7f) | 0x40; // Positive and minimally encoded.
    const notBefore = new Date(now.getTime() - 3600000);
    const tbs = sequence(
        der(0xa0, der(0x02, Buffer.from([2]))),
        der(0x02, serial),
        ecdsaWithSha256,
        name,
        sequence(time(notBefore), time(new Date(notBefore.getTime() + lifetime))),
        name,
        spki,
        der(
            0xa3,
            sequence(
                extension('2.5.29.19', true, sequence()),
                extension('2.5.29.15', true, Buffer.from([0x03, 0x02, 0x07, 0x80])),
                extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1'))),
                altNameExtension(names),
            ),
        ),
    );
    const signature = sign('sha256', tbs, { key, dsaEncoding: 'der' });
    const certificate = sequence(tbs, ecdsaWithSha256, der(0x03, Buffer.from([0]), signature));
    return `-----BEGIN CERTIFICATE-----\n${certificate
        .toString('base64')
        .match(/.{1,64}/g)
        .join('\n')}\n-----END CERTIFICATE-----\n`;
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
    let bits = 0,
        value = 0,
        output = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
}

// The pin covers the public key, so re-issued certificates keep the same fingerprint.
export function fingerprint(certificateOrKey) {
    const publicKey =
        typeof certificateOrKey === 'object' && 'publicKey' in certificateOrKey
            ? certificateOrKey.publicKey
            : createPublicKey(certificateOrKey);
    return base32(
        createHash('sha256')
            .update(publicKey.export({ type: 'spki', format: 'der' }))
            .digest(),
    );
}
export const formatFingerprint = (compact) => compact.match(/.{1,4}/g).join('-');

function writePrivate(file, contents) {
    writeFileSync(`${file}.tmp`, contents, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
}

function certificateStatus(pem, key, names, now) {
    try {
        const certificate = new X509Certificate(pem);
        const expected = createPublicKey(key).export({ type: 'spki', format: 'der' });
        const current = certificate.publicKey.export({ type: 'spki', format: 'der' });
        const expires = certificate.validToDate ?? new Date(certificate.validTo);
        return (
            current.equals(expected) &&
            expires.getTime() - now.getTime() > renewBefore &&
            certificate.raw.includes(altNameExtension(names))
        );
    } catch {
        return false;
    }
}

// Self-managed server identity: an ECDSA P-256 key that never changes plus a certificate
// that is re-issued from it before expiry.
export function loadIdentity({
    directory,
    address = '',
    recorded = null,
    allowNew = false,
    now = () => new Date(),
}) {
    const keyFile = path.join(directory, 'tls-key.pem');
    const certFile = path.join(directory, 'tls-cert.pem');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    let key;
    if (existsSync(keyFile)) key = readFileSync(keyFile, 'utf8');
    else {
        if (recorded && !allowNew)
            throw new Error(
                `The server identity key (${keyFile}) is missing. Restore it from a backup: a new key would make every desktop client refuse this server. To deliberately create a new identity, start once with CAMPFIRE_NEW_IDENTITY=1.`,
            );
        key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
            type: 'pkcs8',
            format: 'pem',
        });
        writePrivate(keyFile, key);
    }
    const id = fingerprint(key);
    if (recorded && recorded !== id && !allowNew)
        throw new Error(
            `The server identity key (${keyFile}) does not match the identity this server has been using. Restore the original key, or start once with CAMPFIRE_NEW_IDENTITY=1 to deliberately switch identity.`,
        );
    const names = subjectAltNames(address);
    let cert = existsSync(certFile) ? readFileSync(certFile, 'utf8') : '';
    const renew = () => {
        if (certificateStatus(cert, key, names, now())) return false;
        cert = issueCertificate(key, names, now());
        writePrivate(certFile, cert);
        return true;
    };
    renew();
    return {
        fingerprint: id,
        get certificateSha256() {
            return new X509Certificate(cert).fingerprint256;
        },
        context: () => ({ key, cert }),
        renew,
    };
}

// Host-provided certificate files are re-read so external renewals apply without a restart.
export function loadCertificateFiles({ certFile, keyFile }) {
    let key, cert;
    const read = () => {
        const next = { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') };
        new X509Certificate(next.cert);
        const changed = next.key !== key || next.cert !== cert;
        ({ key, cert } = next);
        return changed;
    };
    read();
    return {
        fingerprint: null,
        get certificateSha256() {
            return new X509Certificate(cert).fingerprint256;
        },
        context: () => ({ key, cert }),
        renew: () => {
            try {
                return read();
            } catch (error) {
                console.error('Could not reload TLS certificate files:', error.message);
                return false;
            }
        },
    };
}
