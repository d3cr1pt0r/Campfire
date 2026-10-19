// HTTP approvals are owned by the main process, independent of saved login sessions.
const loopback = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
function httpOrigin(value) {
    try {
        const url = new URL(value);
        if (
            url.protocol === 'http:' &&
            !url.username &&
            !url.password &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash &&
            !loopback(url.hostname)
        )
            return url.origin;
    } catch {
        /* Invalid or non-HTTP origins cannot be approved. */
    }
    return null;
}

function createHttpPolicy(clientState) {
    let saved;
    try {
        saved = JSON.parse(clientState.getInternal('http-origins') || '[]');
    } catch {
        saved = [];
    }
    const origins = new Set(
        (Array.isArray(saved) ? saved : []).filter(
            (value) => typeof value === 'string' && httpOrigin(value) === value,
        ),
    );
    return {
        isAllowed: (value) => origins.has(httpOrigin(value)),
        setAllowed(value, enabled) {
            const origin = httpOrigin(value);
            if (!origin || typeof enabled !== 'boolean') return false;
            const next = new Set(origins);
            if (enabled) next.add(origin);
            else next.delete(origin);
            if (!clientState.setInternal('http-origins', JSON.stringify([...next]))) return false;
            origins.clear();
            for (const item of next) origins.add(item);
            return true;
        },
        allowsRequest(value) {
            try {
                const url = new URL(value);
                if (!['http:', 'ws:'].includes(url.protocol)) return true;
                if (loopback(url.hostname)) return true;
                url.protocol = 'http:';
                return origins.has(url.origin);
            } catch {
                return false;
            }
        },
    };
}

function installHttpPolicy({ session, ipcMain, clientState, trusted, confirm }) {
    const policy = createHttpPolicy(clientState);
    const pending = new Set();
    session.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !policy.allowsRequest(details.url) });
    });
    ipcMain.on('http:is-allowed', (event, origin) => {
        event.returnValue = trusted(event.senderFrame?.url) && policy.isAllowed(origin);
    });
    ipcMain.handle('http:set-allowed', async (event, value, enabled) => {
        if (!trusted(event.senderFrame?.url)) throw Error('Untrusted HTTP approval request');
        const origin = httpOrigin(value);
        if (!origin || typeof enabled !== 'boolean' || pending.has(origin)) return false;
        if (enabled && !policy.isAllowed(origin)) {
            pending.add(origin);
            try {
                if (!(await confirm(event, origin))) return false;
            } finally {
                pending.delete(origin);
            }
        }
        return policy.setAllowed(origin, enabled);
    });
    return policy;
}

module.exports = { createHttpPolicy, installHttpPolicy };
