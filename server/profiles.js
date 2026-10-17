import { randomUUID } from 'node:crypto';
import { boundedPng } from './images.js';
import { check, route } from './policies.js';
export function registerProfiles({
    app,
    io,
    get,
    all,
    run,
    publicUser,
    requirePermission,
    can,
    emitRoom,
    messageView,
}) {
    app.patch(
        '/api/profile',
        route((req, res) => {
            check(
                Object.keys(req.body).every((key) => key === 'nickname'),
                'Only the nickname can be changed; account usernames are permanent',
            );
            const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
            check(
                nickname.length > 0 &&
                    nickname.length <= 32 &&
                    !/[\u0000-\u001f\u007f]/.test(nickname),
                'Nickname must contain 1–32 characters without line breaks or control characters',
            );
            run(
                'INSERT INTO profiles(user,nickname) VALUES(?,?) ON CONFLICT(user) DO UPDATE SET nickname=excluded.nickname',
                req.user.id,
                nickname,
            );
            io.emit('refresh');
            res.json({ user: publicUser(req.user) });
        }),
    );
    app.post(
        '/api/profile/avatar',
        route((req, res) => {
            let data;
            try {
                data = boundedPng(req.body.data, 512);
            } catch (e) {
                check(false, e.message);
            }
            const id = randomUUID();
            run(
                'INSERT INTO avatars(id,user,data) VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET id=excluded.id,data=excluded.data',
                id,
                req.user.id,
                data,
            );
            io.emit('refresh');
            res.json({ id });
        }),
    );
    app.delete(
        '/api/profile/avatar',
        route((req, res) => {
            run('DELETE FROM avatars WHERE user=?', req.user.id);
            io.emit('refresh');
            res.json({ ok: true });
        }),
    );
    app.get(
        '/api/avatars/:id',
        route((req, res) => {
            const image = get('SELECT data FROM avatars WHERE id=?', req.params.id);
            check(image, 'Image not found', 404);
            res.type('image/png').send(Buffer.from(image.data, 'base64'));
        }),
    );
    app.post(
        '/api/emojis',
        route((req, res) => {
            requirePermission(req.user, 'send');
            const name = req.body.name;
            check(
                typeof name === 'string' && /^[a-z0-9_]{2,32}$/.test(name),
                'Emoji names need 2–32 lowercase letters, numbers or underscores',
            );
            check(
                !get('SELECT id FROM emojis WHERE name=?', name),
                'That emoji name is already used',
                409,
            );
            check(
                get('SELECT COUNT(*) n FROM emojis').n < 200,
                'This server has reached its limit of 200 custom emojis',
            );
            check(
                get('SELECT COUNT(*) n FROM emojis WHERE author=?', req.user.id).n < 50,
                'You can upload up to 50 custom emojis',
            );
            let data;
            try {
                data = boundedPng(req.body.data, 128);
            } catch (e) {
                check(false, e.message);
            }
            const id = randomUUID();
            run('INSERT INTO emojis VALUES(?,?,?,?)', id, name, req.user.id, data);
            io.emit('refresh');
            res.json({ id });
        }),
    );
    app.get(
        '/api/emojis/:id',
        route((req, res) => {
            const image = get('SELECT data FROM emojis WHERE id=?', req.params.id);
            check(image, 'Emoji not found', 404);
            res.type('image/png').send(Buffer.from(image.data, 'base64'));
        }),
    );
    app.delete(
        '/api/emojis/:id',
        route((req, res) => {
            const emoji = get('SELECT author,name FROM emojis WHERE id=?', req.params.id);
            check(emoji, 'Emoji not found', 404);
            check(
                emoji.author === req.user.id || can(req.user, 'manage'),
                'Permission denied',
                403,
            );
            const affected = all(
                'SELECT DISTINCT m.* FROM messages m JOIN reactions r ON r.message=m.id WHERE r.emoji=?',
                `:${emoji.name}:`,
            );
            run('DELETE FROM emojis WHERE id=?', req.params.id);
            run('DELETE FROM reactions WHERE emoji=?', `:${emoji.name}:`);
            affected.forEach((message) =>
                emitRoom(message.room, 'message:update', messageView(message)),
            );
            io.emit('refresh');
            res.json({ ok: true });
        }),
    );
}
