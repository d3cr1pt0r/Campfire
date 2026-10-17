import { randomUUID } from 'node:crypto';
import { imageMime } from './images.js';
import { maxUploadBytes, maxUploadFiles } from '../shared/uploads.js';
import { canonicalRoom } from '../shared/rooms.js';
import { emojis } from '../shared/emojis.js';
import { check, route } from './policies.js';
import { transaction, messageViews } from './database.js';
export function registerMessages({
    app,
    db,
    get,
    all,
    run,
    hasRoom,
    requirePermission,
    can,
    canWrite,
    messageView,
    emitRoom,
    maxStoredUploadBytes,
}) {
    const requireWrite = (user, room) =>
        check(canWrite(user, room), 'This conversation is read-only', 403);
    app.get(
        '/api/messages',
        route((req, res) => {
            const room = canonicalRoom(req.query.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            const limit = Number(req.query.limit || 500);
            check(Number.isInteger(limit) && limit >= 1 && limit <= 500, 'Invalid page size');
            const clauses = ['room=?'],
                params = [room];
            if (req.query.search) {
                check(
                    typeof req.query.search === 'string' && req.query.search.length <= 4000,
                    'Invalid search',
                );
                clauses.push('contains_text(body,?)');
                params.push(req.query.search);
            }
            if (req.query.pinned === '1') clauses.push('pinned=1');
            if (req.query.before) {
                let cursor;
                try {
                    cursor = JSON.parse(
                        Buffer.from(String(req.query.before), 'base64url').toString(),
                    );
                } catch {
                    check(false, 'Invalid history cursor');
                }
                check(
                    Array.isArray(cursor) &&
                        cursor.length === 2 &&
                        Number.isSafeInteger(cursor[0]) &&
                        typeof cursor[1] === 'string' &&
                        cursor[1].length <= 100,
                    'Invalid history cursor',
                );
                clauses.push('(created < ? OR (created = ? AND id < ?))');
                params.push(cursor[0], cursor[0], cursor[1]);
            }
            const rows = all(
                `SELECT * FROM messages WHERE ${clauses.join(' AND ')} ORDER BY created DESC,id DESC LIMIT ?`,
                ...params,
                limit + 1,
            );
            const hasMore = rows.length > limit;
            rows.length = Math.min(rows.length, limit);
            const oldest = rows.at(-1);
            const next =
                hasMore && oldest
                    ? Buffer.from(JSON.stringify([oldest.created, oldest.id])).toString('base64url')
                    : null;
            const messages = messageViews(all, rows.reverse());
            res.json(req.query.page === '1' ? { messages, next } : messages);
        }),
    );
    app.post(
        '/api/messages',
        route((req, res) => {
            requirePermission(req.user, 'send');
            const { body = '', attachment, attachments } = req.body;
            const room = canonicalRoom(req.body.room);
            check(typeof room === 'string' && hasRoom(req.user, room), 'Unknown conversation', 403);
            requireWrite(req.user, room);
            check(
                typeof body === 'string' && body.length <= 4000,
                'Messages can contain up to 4,000 characters',
            );
            const files =
                attachments === undefined ? (attachment == null ? [] : [attachment]) : attachments;
            check(
                Array.isArray(files) && files.length <= maxUploadFiles,
                'Attach up to 10 files per message',
            );
            check(body.trim() || files.length, 'Write a message or attach a file');
            let total = 0;
            const validated = files.map((file) => {
                check(
                    file &&
                        typeof file.name === 'string' &&
                        file.name.length > 0 &&
                        file.name.length <= 200 &&
                        typeof file.data === 'string' &&
                        /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) &&
                        file.data.length <= 7000000,
                    'Invalid attachment (maximum 5 MB)',
                );
                const bytes = Buffer.from(file.data, 'base64');
                total += bytes.length;
                check(total <= maxUploadBytes, 'Attachments must total 5 MB or less per message');
                return {
                    ...file,
                    bytes: bytes.length,
                    mime: imageMime(bytes) || 'application/octet-stream',
                };
            });
            const id = randomUUID();
            transaction(db, () => {
                const used = get('SELECT bytes FROM storage_usage WHERE id=1').bytes;
                check(
                    !total || used + total <= maxStoredUploadBytes,
                    'Server attachment storage is full. Delete attachments or ask the owner to raise the quota.',
                    413,
                );
                run(
                    'INSERT INTO messages(id,room,author,body,created) VALUES(?,?,?,?,?)',
                    id,
                    room,
                    req.user.id,
                    body.trim(),
                    Date.now(),
                );
                for (const file of validated)
                    run(
                        'INSERT INTO attachments(id,message,name,mime,data,bytes) VALUES(?,?,?,?,?,?)',
                        randomUUID(),
                        id,
                        file.name,
                        file.mime,
                        file.data,
                        file.bytes,
                    );
            });
            const m = messageView(get('SELECT * FROM messages WHERE id=?', id));
            emitRoom(room, 'message', m);
            res.json(m);
        }),
    );
    app.patch(
        '/api/messages/:id',
        route((req, res) => {
            const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
            check(m && hasRoom(req.user, m.room), 'Message not found', 404);
            if (!m.room.startsWith('dm:')) requireWrite(req.user, m.room);
            if ('pinned' in req.body) requirePermission(req.user, 'manage');
            if ('body' in req.body) requirePermission(req.user, 'send');
            if ('body' in req.body) {
                check(m.author === req.user.id, 'Only the author can edit this message', 403);
                check(
                    typeof req.body.body === 'string' &&
                        req.body.body.trim().length > 0 &&
                        req.body.body.length <= 4000,
                    'Invalid message',
                );
                run(
                    'UPDATE messages SET body=?,edited=? WHERE id=?',
                    req.body.body.trim(),
                    Date.now(),
                    m.id,
                );
            }
            if ('pinned' in req.body) {
                run('UPDATE messages SET pinned=? WHERE id=?', req.body.pinned ? 1 : 0, m.id);
            }
            emitRoom(
                m.room,
                'message:update',
                messageView(get('SELECT * FROM messages WHERE id=?', m.id)),
            );
            res.json({ ok: true });
        }),
    );
    app.delete(
        '/api/messages/:id',
        route((req, res) => {
            const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
            check(m && hasRoom(req.user, m.room), 'Message not found', 404);
            if (!m.room.startsWith('dm:')) requireWrite(req.user, m.room);
            check(m.author === req.user.id || can(req.user, 'manage'), 'Permission denied', 403);
            run('DELETE FROM messages WHERE id=?', m.id);
            emitRoom(m.room, 'message:delete', { id: m.id, room: m.room });
            res.json({ ok: true });
        }),
    );
    app.post(
        '/api/messages/:id/reaction',
        route((req, res) => {
            const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
            check(m && hasRoom(req.user, m.room), 'Message not found', 404);
            if (!m.room.startsWith('dm:')) requireWrite(req.user, m.room);
            const emoji = req.body.emoji;
            requirePermission(req.user, 'send');
            check(
                typeof emoji === 'string' &&
                    (emojis.includes(emoji) ||
                        (/^:[a-z0-9_]{2,32}:$/.test(emoji) &&
                            get('SELECT id FROM emojis WHERE name=?', emoji.slice(1, -1)))),
                'Unsupported emoji',
            );
            if (
                get(
                    'SELECT * FROM reactions WHERE message=? AND user=? AND emoji=?',
                    m.id,
                    req.user.id,
                    emoji,
                )
            )
                run(
                    'DELETE FROM reactions WHERE message=? AND user=? AND emoji=?',
                    m.id,
                    req.user.id,
                    emoji,
                );
            else run('INSERT INTO reactions VALUES(?,?,?)', m.id, req.user.id, emoji);
            emitRoom(m.room, 'message:update', messageView(m));
            res.json({ ok: true });
        }),
    );
    app.get(
        '/api/attachments/:id',
        route((req, res) => {
            const a = get(
                'SELECT a.*,m.room FROM attachments a JOIN messages m ON m.id=a.message WHERE a.id=?',
                req.params.id,
            );
            check(a && hasRoom(req.user, a.room), 'Attachment not found', 404);
            res.setHeader(
                'Content-Disposition',
                `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
            );
            const data = Buffer.from(a.data, 'base64');
            const mime = imageMime(data);
            if (req.query.inline === '1' && mime) {
                res.setHeader('Content-Disposition', 'inline');
                res.type(mime);
            } else res.type('application/octet-stream');
            res.send(data);
        }),
    );
}
