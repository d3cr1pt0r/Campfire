// Desktop pinning applies only to HTTPS. HTTP approval is enforced separately.
export const pinsFor = (origin: string) =>
    origin.startsWith('https:') ? globalThis.window?.campfire?.pins : undefined;

// What the desktop app's main process reports about a server's TLS identity.
export type ServerCheck =
    | { state: 'pinned' | 'trusted' | 'unknown' | 'changed'; fingerprint: string }
    | { state: 'unreachable'; message: string };

type Presented<Kind extends string> = { kind: Kind; fingerprint: string };
export type TrustStep =
    | { kind: 'ready' }
    | Presented<'pin'>
    | Presented<'confirm'>
    | Presented<'replace'>
    | Presented<'changed'>
    | Presented<'mismatch'>
    | { kind: 'unreachable'; message: string };

// pinned/trusted: connect. unknown: pin silently when a link vouches for it, otherwise ask.
// changed: refuse, unless a link carries the new identity (the main process then confirms).
export function trustStep(check: ServerCheck, linkPin?: string): TrustStep {
    if (check.state === 'unreachable') return { kind: 'unreachable', message: check.message };
    const { fingerprint } = check;
    if (linkPin && linkPin !== fingerprint) return { kind: 'mismatch', fingerprint };
    if (check.state === 'unknown') return { kind: linkPin ? 'pin' : 'confirm', fingerprint };
    if (check.state === 'changed') return { kind: linkPin ? 'replace' : 'changed', fingerprint };
    return { kind: 'ready' };
}

// Browsers can't pin: a self-signed server must first be accepted in its own tab.
export function connectionHint(error: Error, origin: string, pageOrigin: string, desktop: boolean) {
    if (
        !desktop &&
        error instanceof TypeError &&
        origin !== pageOrigin &&
        origin.startsWith('https:')
    )
        return `Your browser couldn’t verify ${origin}. Open it in a new tab, accept the certificate warning, then try again. The Campfire desktop app verifies servers automatically.`;
    return error.message;
}
