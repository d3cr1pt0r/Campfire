import { timingSafeEqual } from 'node:crypto';
import { check, route } from './policies.js';
import { transaction } from './database.js';
import { createAccount } from './account-store.js';
import { recordIdentity } from './identity.js';

// Enabled only by the offline reset tool for its fresh, temporary server.
// No environment variable or normal server command enables this mode.
export function mountSetupRestore({ app, db, get, run }, token) {
    check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'Invalid restore token');
    check(!get('SELECT 1 FROM users LIMIT 1'), 'Restore requires an empty community');
    app.use('/api', (req, res, next) => {
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
        if (
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
            !/^[a-f0-9]{64}$/.test(supplied) ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        )
            return res.status(403).json({ error: 'Setup restore authorization required' });
        // Only the small set of APIs used by the tool is available in this mode.
        const endpoint = `${req.method} ${req.path}`;
        if (
            ![
                'POST /setup/users',
                'PUT /setup/identity',
                'PATCH /settings',
                'PATCH /registration',
                'POST /roles',
                'PATCH /profile',
                'PATCH /presence',
                'PATCH /retention/server',
                'PATCH /retention/dm',
                'PATCH /retention/keep-text',
            ].includes(endpoint) &&
            !/^PATCH \/(?:roles\/[^/]+|users\/[^/]+\/roles)$/.test(endpoint) &&
            !/^POST \/users\/[^/]+\/access$/.test(endpoint)
        )
            return res.status(403).json({ error: 'API unavailable during setup restore' });
        try {
            req.setupRestore = true;
            req.user = get('SELECT * FROM users WHERE owner=1') || { id: 'setup', owner: 1 };
            const target = req.headers['x-setup-user'];
            if (target !== undefined) {
                check(
                    ['PATCH /profile', 'PATCH /presence'].includes(endpoint),
                    'Invalid restore target',
                );
                req.user = get('SELECT * FROM users WHERE id=?', target);
                check(req.user, 'Restore user not found', 404);
            }
            next();
        } catch (error) {
            next(error);
        }
    });
    app.post(
        '/api/setup/users',
        route((req, res) => {
            const { username, passwordHash } = req.body;
            const user = transaction(db, () =>
                createAccount(
                    { get, run },
                    {
                        username,
                        passwordHash,
                        owner: !get('SELECT 1 FROM users LIMIT 1'),
                    },
                ),
            );
            res.json({ id: user.id });
        }),
    );
    app.put(
        '/api/setup/identity',
        route((req, res) => {
            const fingerprint = req.body.fingerprint;
            check(
                typeof fingerprint === 'string' && /^[A-Z2-7]{52}$/.test(fingerprint),
                'Invalid server fingerprint',
            );
            recordIdentity(run, fingerprint);
            res.json({ ok: true });
        }),
    );
}
