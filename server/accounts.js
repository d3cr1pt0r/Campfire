import { randomBytes } from 'node:crypto';
import { checkUsername, createAccount } from './account-store.js';
import { createPassword, verifyPassword, tokenHash } from './security.js';
import { check, route, createRateLimit } from './policies.js';
import { transaction } from './database.js';
const checkPassword = (password) =>
    check(
        typeof password === 'string' && password.length >= 8 && password.length <= 128,
        'Password must contain 8–128 characters',
    );
export function registerAccounts({
    app,
    io,
    db,
    get,
    run,
    publicUser,
    sessionLifetimeMs,
    registration,
    requirePermission,
    highest,
}) {
    const limit = createRateLimit();
    app.get('/api/info', (_req, res) =>
        res.set('Cache-Control', 'no-store').json({
            name: get('SELECT value FROM settings WHERE key=?', 'name').value,
            registration: registration.mode() === 'open',
            registrationMode: registration.mode(),
            setupRequired: registration.needsSetup(),
        }),
    );
    app.post(
        '/api/auth/:action',
        route(async (req, res) => {
            check(['login', 'register', 'reset'].includes(req.params.action), 'Unknown action');
            limit(req.ip || req.socket.remoteAddress);
            const { username, password } = req.body;
            checkUsername(username);
            checkPassword(password);
            let u = get('SELECT * FROM users WHERE username=?', username);
            if (req.params.action === 'register') {
                registration.authorize(req.body);
                check(!u, 'That username is already taken', 409);
                const passwordHash = await createPassword(password);
                transaction(db, () => {
                    check(
                        !get('SELECT id FROM users WHERE username=?', username),
                        'That username is already taken',
                        409,
                    );
                    const role = registration.authorize(req.body);
                    u = createAccount(
                        { get, run },
                        { username, passwordHash, owner: role === 'owner' },
                    );
                    // Check/consume within the same transaction as account creation.
                    // The owner insert changes needsSetup(), so only members redeem invitations.
                    if (role === 'member') registration.authorize(req.body, true, u.id);
                });
            } else if (req.params.action === 'reset') {
                const code = req.body.resetToken;
                const invalid = 'Invalid or expired password reset token';
                check(typeof code === 'string' && /^[a-f0-9]{64}$/.test(code), invalid, 401);
                const hash = tokenHash(code);
                const validReset = () =>
                    get(
                        `SELECT u.* FROM password_resets r JOIN users u ON u.id=r.user
                     WHERE u.username=? AND u.banned=0 AND r.tokenHash=? AND r.expires>?`,
                        username,
                        hash,
                        Date.now(),
                    );
                check(validReset(), invalid, 401);
                const passwordHash = await createPassword(password);
                transaction(db, () => {
                    // Recheck after hashing so concurrent redemption can only succeed once.
                    u = validReset();
                    check(u, invalid, 401);
                    run('UPDATE users SET password=? WHERE id=?', passwordHash, u.id);
                    run('DELETE FROM password_resets WHERE user=?', u.id);
                    run('DELETE FROM sessions WHERE user=?', u.id);
                });
                for (const socket of io.sockets.sockets.values())
                    if (socket.data.user?.id === u.id) socket.disconnect(true);
            } else {
                // Use a dummy hash when the user is absent to avoid a cheap username timing oracle.
                const valid = await verifyPassword(password, u?.password);
                u = u && get('SELECT * FROM users WHERE id=?', u.id);
                check(valid && u && !u.banned, 'Incorrect username or password', 401);
            }
            run('DELETE FROM sessions WHERE expires<=?', Date.now());
            const token = randomBytes(32).toString('hex');
            run(
                'INSERT INTO sessions VALUES(?,?,?)',
                tokenHash(token),
                u.id,
                Date.now() + sessionLifetimeMs,
            );
            io.emit('refresh');
            res.set('Cache-Control', 'no-store').json({ token, user: publicUser(u) });
        }),
    );
    const passwordLimit = createRateLimit({ maximum: 5 });
    // Mounted after authentication by createApp.
    const generationLimit = createRateLimit({ maximum: 5 });
    const mount = () => {
        app.post(
            '/api/users/:id/password-reset',
            route((req, res) => {
                requirePermission(req.user, 'members.resetPassword');
                const target = get('SELECT * FROM users WHERE id=? AND banned=0', req.params.id);
                check(
                    target &&
                        !target.owner &&
                        target.id !== req.user.id &&
                        highest(req.user) > highest(target),
                    'You can only reset passwords for lower members',
                    403,
                );
                generationLimit(req.user.id);
                const token = randomBytes(32).toString('hex');
                const expires = Date.now() + 60 * 60 * 1000;
                run('DELETE FROM password_resets WHERE expires<=?', Date.now());
                run(
                    'INSERT OR REPLACE INTO password_resets(user,tokenHash,expires) VALUES(?,?,?)',
                    target.id,
                    tokenHash(token),
                    expires,
                );
                res.set('Cache-Control', 'no-store').json({ token, expires });
            }),
        );
        app.post(
            '/api/account/password',
            route(async (req, res) => {
                passwordLimit(req.user.id);
                const { current, password } = req.body;
                check(
                    typeof current === 'string' && current.length <= 128,
                    'Enter your current password',
                );
                checkPassword(password);
                check(
                    await verifyPassword(current, req.user.password),
                    'Your current password is incorrect',
                    403,
                );
                const passwordHash = await createPassword(password);
                const token = req.headers.authorization.replace(/^Bearer /, '');
                transaction(db, () => {
                    check(
                        get('SELECT id FROM users WHERE id=? AND banned=0', req.user.id),
                        'Please sign in again',
                        401,
                    );
                    run('UPDATE users SET password=? WHERE id=?', passwordHash, req.user.id);
                    run('DELETE FROM password_resets WHERE user=?', req.user.id);
                    // Other devices may hold a session captured with the old password.
                    run(
                        'DELETE FROM sessions WHERE user=? AND token<>?',
                        req.user.id,
                        tokenHash(token),
                    );
                });
                for (const socket of io.sockets.sockets.values())
                    if (socket.data.user?.id === req.user.id && socket.data.token !== token)
                        socket.disconnect(true);
                res.json({ ok: true });
            }),
        );
    };
    return { mount };
}
