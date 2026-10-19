import { isIP } from 'node:net';

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const label = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const hostname = new RegExp(`^(?=.{1,253}$)(${label}\\.)*${label}$`, 'i');
const fail = (message) => {
    throw new Error(message);
};

// Normalise the optional public hostname or IP used in certificates and printed links.
export function publicAddress(value) {
    const address = String(value || '')
        .trim()
        .replace(/^\[(.*)\]$/, '$1');
    if (!address) return '';
    if (isIP(address) || hostname.test(address)) return address.toLowerCase();
    return fail('PUBLIC_ADDRESS must be a hostname or IP address without a scheme or port.');
}

// Transport rules: every server is HTTPS unless plain HTTP is either confined to this
// machine (development) or explicitly placed behind a trusted HTTPS reverse proxy.
export function serverConfig(env = process.env, argv = []) {
    const devHttp = argv.includes('--dev-http');
    const port = Number(env.PORT || 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT must be 1–65535.');
    const host = devHttp ? '127.0.0.1' : env.HOST || '0.0.0.0';
    const trustProxy = env.TRUST_PROXY
        ? env.TRUST_PROXY.split(',')
              .map((value) => value.trim())
              .filter(Boolean)
        : false;
    const warnings = [];
    const mode = devHttp ? 'off' : (env.TLS || 'on').trim().toLowerCase();
    if (!['on', 'off'].includes(mode)) fail('TLS must be "on" (default) or "off".');
    let tls;
    if (mode === 'off') {
        if (!loopbackHosts.has(host) && !trustProxy)
            fail(
                'TLS=off is only allowed when HOST is a loopback address or TRUST_PROXY names the HTTPS reverse proxy in front of Campfire.',
            );
        if (!loopbackHosts.has(host))
            warnings.push(
                'Plain HTTP backend: make sure only your HTTPS reverse proxy can reach this port.',
            );
        tls = { mode: 'off' };
    } else if (env.TLS_CERT_FILE || env.TLS_KEY_FILE) {
        if (!env.TLS_CERT_FILE || !env.TLS_KEY_FILE)
            fail('Set both TLS_CERT_FILE and TLS_KEY_FILE, or neither.');
        tls = { mode: 'files', certFile: env.TLS_CERT_FILE, keyFile: env.TLS_KEY_FILE };
    } else tls = { mode: 'self' };
    return {
        port,
        host,
        dataDir: env.DATA_DIR || 'data',
        name: env.SERVER_NAME || 'My Campfire server',
        origins: (env.CLIENT_ORIGINS || '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
        iceServers: JSON.parse(env.ICE_SERVERS || '[]'),
        trustProxy,
        maxStoredUploadBytes: Number(env.MAX_STORED_UPLOAD_BYTES || 1073741824),
        publicAddress: publicAddress(env.PUBLIC_ADDRESS),
        allowNewIdentity: env.CAMPFIRE_NEW_IDENTITY === '1',
        tls,
        warnings,
    };
}
