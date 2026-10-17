import { check, route } from './policies.js';
export function registerFriends({ app, io, get, run }) {
    app.post(
        '/api/friends',
        route((req, res) => {
            const target = get(
                'SELECT id FROM users WHERE username=? AND banned=0',
                String(req.body.username),
            );
            check(
                target && target.id !== req.user.id,
                'User not found or this is your own username',
            );
            const incoming = get(
                'SELECT * FROM friends WHERE sender=? AND recipient=?',
                target.id,
                req.user.id,
            );
            if (incoming)
                run(
                    'UPDATE friends SET accepted=1 WHERE sender=? AND recipient=?',
                    target.id,
                    req.user.id,
                );
            else run('INSERT OR IGNORE INTO friends VALUES(?,?,0)', req.user.id, target.id);
            io.to(`user:${target.id}`).to(`user:${req.user.id}`).emit('refresh');
            res.json({ ok: true });
        }),
    );
    app.delete(
        '/api/friends/:id',
        route((req, res) => {
            run(
                'DELETE FROM friends WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)',
                req.user.id,
                req.params.id,
                req.params.id,
                req.user.id,
            );
            io.to(`user:${req.params.id}`).to(`user:${req.user.id}`).emit('refresh');
            res.json({ ok: true });
        }),
    );
}
