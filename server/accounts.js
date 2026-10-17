import { randomBytes, randomUUID } from 'node:crypto';
import { createPassword, verifyPassword, tokenHash } from './security.js';
import { check, route, createRateLimit } from './policies.js';
import { transaction } from './database.js';
export function registerAccounts({ app, io, db, get, run, publicUser, sessionLifetimeMs }) {
    const limit = createRateLimit();
    app.get('/api/info', (_req, res) =>
        res.json({
            name: get('SELECT value FROM settings WHERE key=?', 'name').value,
            registration: true,
        }),
    );
    app.post(
        '/api/auth/:action',
        route(async (req, res) => {
            check(['login', 'register'].includes(req.params.action), 'Unknown action');
            limit(req.ip || req.socket.remoteAddress);
            const { username, password } = req.body;
            check(
                typeof username === 'string' && /^[a-zA-Z0-9_ -]{2,32}$/.test(username),
                'Username must be 2–32 letters, numbers, spaces, underscores or hyphens',
            );
            check(
                typeof password === 'string' && password.length >= 10 && password.length <= 128,
                'Password must contain 10–128 characters',
            );
            let u = get('SELECT * FROM users WHERE username=?', username);
            if (req.params.action === 'register') {
                check(!u, 'That username is already taken', 409);
                const passwordHash = await createPassword(password);
                const id = randomUUID();
                transaction(db, () => {
                    check(
                        !get('SELECT id FROM users WHERE username=?', username),
                        'That username is already taken',
                        409,
                    );
                    const role =
                        get('SELECT COUNT(*) AS n FROM users').n === 0 ? 'owner' : 'member';
                    run(
                        'INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)',
                        id,
                        username,
                        passwordHash,
                        role,
                    );
                    run('INSERT INTO profiles(user,nickname) VALUES(?,?)', id, username);
                });
                u = get('SELECT * FROM users WHERE id=?', id);
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
            res.json({ token, user: publicUser(u) });
        }),
    );
}
