// Server addresses and shareable links. A link may carry the server's identity fingerprint
// (#pin=) so the desktop app can verify the server from the very first connection.
export type ServerLink = { origin: string; pin?: string; invite?: string; setup?: string };

export const isLoopbackHost = (hostname: string) =>
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

export function normalizeFingerprint(value: string) {
    const compact = value.replace(/[\s-]/g, '').toUpperCase();
    return /^[A-Z2-7]{52}$/.test(compact) ? compact : null;
}

export const formatFingerprint = (compact: string) => compact.match(/.{1,4}/g)!.join('-');

export function parseServerLink(input: string, allowInsecureHttp = false): ServerLink {
    const text = input.trim();
    if (!text) throw new Error('Enter a server address or link.');
    let url: URL;
    try {
        url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        throw new Error(
            'Enter a server address, for example 203.0.113.5:3001 or https://chat.example.com',
        );
    }
    if (!['https:', 'http:'].includes(url.protocol))
        throw new Error('Campfire server addresses start with https://');
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !allowInsecureHttp)
        throw new Error(
            'Campfire servers use https://. To use remote HTTP, allow insecure HTTP for this server in the desktop app.',
        );
    if (url.username || url.password || url.search || url.pathname !== '/')
        throw new Error('Enter only the server address, for example https://chat.example.com');
    const params = new URLSearchParams(url.hash.slice(1));
    const link: ServerLink = { origin: url.origin };
    const pin = params.get('pin');
    if (pin !== null) {
        if (url.protocol !== 'https:')
            throw new Error(
                'Server fingerprints require HTTPS. HTTP cannot verify a server identity.',
            );
        const fingerprint = normalizeFingerprint(pin);
        if (!fingerprint)
            throw new Error(
                'This link’s server fingerprint is incomplete. Ask for the link again.',
            );
        link.pin = fingerprint;
    }
    const invite = params.get('invite');
    if (invite) {
        if (!/^[a-f0-9]{64}$/.test(invite))
            throw new Error('This link’s invitation code is incomplete. Ask for the link again.');
        link.invite = invite;
    }
    const setup = params.get('setup');
    if (setup) link.setup = setup.slice(0, 256);
    return link;
}

export function serverLink(origin: string, { pin, invite }: { pin?: string; invite?: string }) {
    const params = [
        ...(pin ? [`pin=${formatFingerprint(pin)}`] : []),
        ...(invite ? [`invite=${invite}`] : []),
    ];
    return `${origin.replace(/\/$/, '')}/${params.length ? `#${params.join('&')}` : ''}`;
}

// Upgrade legacy remote HTTP sessions to HTTPS unless the desktop app has explicitly
// approved that exact HTTP origin. Browsers never supply an approval callback.
export function restoreConnection(
    saved: unknown,
    fallback: string,
    allowInsecureHttp: (origin: string) => boolean = () => false,
) {
    const { url, token } = (saved || {}) as { url?: unknown; token?: unknown };
    if (typeof url !== 'string' || !url) return { url: fallback, token: '' };
    try {
        const parsed = new URL(url);
        if (
            parsed.protocol === 'http:' &&
            !isLoopbackHost(parsed.hostname) &&
            !allowInsecureHttp(parsed.origin)
        ) {
            parsed.protocol = 'https:';
            return { url: parsed.origin, token: '' };
        }
        if (!['https:', 'http:'].includes(parsed.protocol)) return { url: fallback, token: '' };
        return { url: parsed.origin, token: typeof token === 'string' ? token : '' };
    } catch {
        return { url: fallback, token: '' };
    }
}
