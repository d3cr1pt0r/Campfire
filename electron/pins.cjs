const { X509Certificate, createHash } = require('node:crypto');
const { isIP } = require('node:net');
const tls = require('node:tls');

// Must match fingerprint() in server/identity.js: base32(SHA-256(SPKI DER)) of the public key,
// so a re-issued certificate for the same key keeps its pin.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function fingerprint(certificate) {
    const parsed =
        certificate instanceof X509Certificate ? certificate : new X509Certificate(certificate);
    const digest = createHash('sha256')
        .update(parsed.publicKey.export({ type: 'spki', format: 'der' }))
        .digest();
    let bits = 0,
        value = 0,
        output = '';
    for (const byte of digest) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    return bits ? output + alphabet[(value << (5 - bits)) & 31] : output;
}

function normalizeFingerprint(value) {
    if (typeof value !== 'string') return null;
    const compact = value.replace(/[\s-]/g, '').toUpperCase();
    return /^[A-Z2-7]{52}$/.test(compact) ? compact : null;
}

const hostKey = (hostname) => hostname.replace(/^\[|\]$/g, '').toLowerCase();

// Only bare https:// origins can be checked or pinned.
function parseOrigin(value) {
    const url = new URL(String(value));
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
    )
        throw new Error('Expected an https:// server origin');
    return {
        origin: url.origin,
        host: hostKey(url.hostname),
        port: Number(url.port || 443),
    };
}

// Pins are saved per origin and grouped by host, because Chromium's verifier sees no port.
function createPinStore(read, write) {
    let pins = {};
    try {
        const saved = JSON.parse(read() || '{}');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) pins = saved;
    } catch {
        /* Unreadable pins: servers will ask to be confirmed again. */
    }
    return {
        get(origin) {
            const target = parseOrigin(origin);
            return pins[target.host]?.[target.origin] ?? null;
        },
        forHost: (hostname) => Object.values(pins[hostKey(hostname)] || {}),
        set(origin, value) {
            const target = parseOrigin(origin);
            pins = { ...pins, [target.host]: { ...pins[target.host], [target.origin]: value } };
            write(JSON.stringify(pins));
        },
        remove(origin) {
            const target = parseOrigin(origin);
            const { [target.origin]: _removed, ...rest } = pins[target.host] || {};
            const next = { ...pins, [target.host]: rest };
            if (!Object.keys(rest).length) delete next[target.host];
            pins = next;
            write(JSON.stringify(pins));
        },
    };
}

// Chromium certificate verification: 0 accepts, -2 rejects, -3 keeps Chromium's own result.
// A pinned host accepts only its pinned keys, even if a certificate authority vouches for another.
function verifyDecision(store, hostname, presented, errorCode) {
    const pinned = store.forHost(hostname);
    if (pinned.length) return presented && pinned.includes(presented) ? 0 : -2;
    return errorCode === 0 ? -3 : -2;
}

function checkState(store, origin, presented, authorized) {
    const pinned = store.get(origin);
    if (pinned) return pinned === presented ? 'pinned' : 'changed';
    return authorized ? 'trusted' : 'unknown';
}

// Reads the server's identity outside Chromium, so an unconfirmed certificate is never
// verified (and cached as rejected) by the browser engine before the user decides.
function inspectServer({ host, port }, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const socket = tls.connect({
            host,
            port,
            servername: isIP(host) ? undefined : host,
            rejectUnauthorized: false,
        });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('The server did not respond.'));
        }, timeout);
        socket.once('secureConnect', () => {
            clearTimeout(timer);
            const certificate = socket.getPeerX509Certificate();
            const authorized = socket.authorized;
            socket.end();
            if (!certificate) reject(new Error('The server presented no certificate.'));
            else resolve({ fingerprint: fingerprint(certificate), authorized });
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

module.exports = {
    fingerprint,
    normalizeFingerprint,
    parseOrigin,
    createPinStore,
    verifyDecision,
    checkState,
    inspectServer,
};
