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

// HTTPS by default. Direct remote HTTP requires its own explicit opt-in.
export function serverConfig(env = process.env, argv = []) {
    const devHttp = argv.includes('--dev-http');
    const directHttp = argv.includes('--http');
    const forceHttps = argv.includes('--https');
    if ([devHttp, directHttp, forceHttps].filter(Boolean).length > 1)
        fail('Use only one transport option: --http, --https, or --dev-http.');
    const port = Number(env.PORT || 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT must be 1–65535.');
    const host = devHttp ? '127.0.0.1' : env.HOST || '0.0.0.0';
    const trustProxy = env.TRUST_PROXY
        ? env.TRUST_PROXY.split(',')
              .map((value) => value.trim())
              .filter(Boolean)
        : false;
    const warnings = [];
    const mode =
        devHttp || directHttp ? 'off' : forceHttps ? 'on' : (env.TLS || 'on').trim().toLowerCase();
    if (!['on', 'off'].includes(mode)) fail('TLS must be "on" (default) or "off".');
    const allowInsecureHttp = directHttp || env.ALLOW_INSECURE_HTTP === '1';
    let tls;
    if (mode === 'off') {
        if (!loopbackHosts.has(host) && !trustProxy && !allowInsecureHttp)
            fail(
                'TLS=off is only allowed on loopback, behind TRUST_PROXY, or with ALLOW_INSECURE_HTTP=1.',
            );
        if (!loopbackHosts.has(host))
            warnings.push(
                allowInsecureHttp
                    ? 'Insecure HTTP enabled: credentials, messages and files are unencrypted in transit.'
                    : 'Plain HTTP backend: make sure only your HTTPS reverse proxy can reach this port.',
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
        // Optional: a KLIPY API key turns on GIF search for members.
        klipyKey: (env.KLIPY_API_KEY || '').trim(),
        // LINK_PREVIEWS=off stops the server fetching linked pages for preview cards.
        linkPreviews: (env.LINK_PREVIEWS || 'on').trim().toLowerCase() !== 'off',
        trustProxy,
        maxStoredUploadBytes: Number(env.MAX_STORED_UPLOAD_BYTES || 1073741824),
        publicAddress: publicAddress(env.PUBLIC_ADDRESS),
        allowNewIdentity: env.CAMPFIRE_NEW_IDENTITY === '1',
        tls,
        warnings,
    };
}
