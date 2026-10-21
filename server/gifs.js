import { randomUUID } from 'node:crypto';
import { check, route } from './policies.js';
import { isKlipyMedia } from '../shared/klipy.js';

const maxFavorites = 200;
const dimension = (value) => Number.isInteger(value) && value > 0 && value <= 4096;

// Each member's starred GIFs, kept on the server so they follow the account between
// devices. Only KLIPY's links and sizes are stored, never the media itself.
export function registerGifs({ app, get, all, run }) {
    const favorites = (user) =>
        all(
            'SELECT id,url,preview,width,height,title FROM gif_favorites WHERE user=? ORDER BY created DESC, rowid DESC',
            user,
        );
    app.get(
        '/api/gif-favorites',
        route((req, res) => res.json(favorites(req.user.id))),
    );
    app.post(
        '/api/gif-favorites',
        route((req, res) => {
            const { url, preview, width, height, title = '' } = req.body || {};
            check(
                isKlipyMedia(url) &&
                    isKlipyMedia(preview) &&
                    dimension(width) &&
                    dimension(height) &&
                    typeof title === 'string' &&
                    title.length <= 200,
                'Invalid GIF',
            );
            if (!get('SELECT id FROM gif_favorites WHERE user=? AND url=?', req.user.id, url)) {
                check(
                    get('SELECT COUNT(*) count FROM gif_favorites WHERE user=?', req.user.id)
                        .count < maxFavorites,
                    `Keep up to ${maxFavorites} favourite GIFs. Remove one to add another.`,
                );
                run(
                    'INSERT INTO gif_favorites(id,user,url,preview,width,height,title,created) VALUES(?,?,?,?,?,?,?,?)',
                    randomUUID(),
                    req.user.id,
                    url,
                    preview,
                    width,
                    height,
                    title.trim(),
                    Date.now(),
                );
            }
            res.json(favorites(req.user.id));
        }),
    );
    app.delete(
        '/api/gif-favorites/:id',
        route((req, res) => {
            run('DELETE FROM gif_favorites WHERE id=? AND user=?', req.params.id, req.user.id);
            res.json(favorites(req.user.id));
        }),
    );
}
