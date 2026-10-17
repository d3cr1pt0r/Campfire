import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { tokenHash } from './security.js';
import { check, route, createRateLimit } from './policies.js';
import { transaction } from './database.js';

export function createRegistration({ app, get, all, run, db, io, setupCode }) {
    const initialSetupCode =
        get('SELECT COUNT(*) n FROM users').n === 0
            ? (setupCode ?? randomBytes(32).toString('hex'))
            : null;
    const setupHash = initialSetupCode ? tokenHash(initialSetupCode) : null;
    const mode = () => get("SELECT value FROM settings WHERE key='registrationMode'").value;
    const needsSetup = () => get('SELECT COUNT(*) n FROM users').n === 0;
    const authorize = (body, consume = false, userId) => {
        if (needsSetup()) {
            check(
                setupHash &&
                    typeof body.setupCode === 'string' &&
                    body.setupCode.length <= 256 &&
                    timingSafeEqual(Buffer.from(tokenHash(body.setupCode)), Buffer.from(setupHash)),
                'Enter the owner setup code from the server console.',
                403,
            );
            return 'owner';
        }
        if (mode() === 'open') return 'member';
        check(
            typeof body.inviteCode === 'string' && /^[a-f0-9]{64}$/.test(body.inviteCode),
            'A valid invitation is required to create an account.',
            403,
        );
        const invitation = get(
            'SELECT * FROM invitations WHERE tokenHash=?',
            tokenHash(body.inviteCode),
        );
        check(
            invitation &&
                !invitation.revoked &&
                !invitation.usedBy &&
                invitation.expires > Date.now(),
            'This invitation is invalid, expired, or already used.',
            403,
        );
        if (consume) run('UPDATE invitations SET usedBy=? WHERE id=?', userId, invitation.id);
        return 'member';
    };
    const owner = (req) =>
        check(req.user.role === 'owner', 'Only the owner can manage registration.', 403);
    // Mounted after authentication by createApp.
    const mount = () => {
        app.get(
            '/api/registration',
            route((req, res) => {
                owner(req);
                res.set('Cache-Control', 'no-store').json({
                    mode: mode(),
                    invitations: all(
                        'SELECT id,label,created,expires,usedBy,revoked FROM invitations ORDER BY created DESC,rowid DESC LIMIT 200',
                    ),
                });
            }),
        );
        app.patch(
            '/api/registration',
            route((req, res) => {
                owner(req);
                check(['open', 'invite'].includes(req.body.mode), 'Invalid registration mode');
                transaction(db, () => {
                    if (req.body.mode === 'open' && mode() !== 'open')
                        run('UPDATE invitations SET revoked=1 WHERE usedBy IS NULL');
                    run("UPDATE settings SET value=? WHERE key='registrationMode'", req.body.mode);
                });
                io.emit('refresh');
                res.json({ ok: true });
            }),
        );
        const limit = createRateLimit({ maximum: 20 });
        app.post(
            '/api/invitations',
            route((req, res) => {
                owner(req);
                limit(req.user.id);
                check(
                    mode() === 'invite',
                    'Switch to Invite only before creating invitations.',
                    409,
                );
                const label = req.body.label ?? '';
                check(
                    typeof label === 'string' && label.length <= 64,
                    'Label must be at most 64 characters',
                );
                check(
                    get(
                        'SELECT COUNT(*) n FROM invitations WHERE revoked=0 AND usedBy IS NULL AND expires>?',
                        Date.now(),
                    ).n < 100,
                    'Revoke an unused invitation before creating more.',
                    409,
                );
                const code = randomBytes(32).toString('hex');
                const id = randomUUID(),
                    created = Date.now(),
                    expires = created + 7 * 86400000;
                run(
                    'INSERT INTO invitations(id,tokenHash,label,created,expires) VALUES(?,?,?,?,?)',
                    id,
                    tokenHash(code),
                    label.trim(),
                    created,
                    expires,
                );
                res.setHeader('Cache-Control', 'no-store');
                res.json({ id, code, expires });
            }),
        );
        app.delete(
            '/api/invitations/:id',
            route((req, res) => {
                owner(req);
                check(
                    get('SELECT id FROM invitations WHERE id=?', req.params.id),
                    'Invitation not found',
                    404,
                );
                run(
                    'UPDATE invitations SET revoked=1 WHERE id=? AND usedBy IS NULL',
                    req.params.id,
                );
                res.json({ ok: true });
            }),
        );
    };
    return { mode, needsSetup, authorize, mount, setupCode: initialSetupCode };
}
