import { randomUUID } from 'node:crypto';
import { imageMime } from './images.js';
import { maxUploadBytes, maxUploadFiles } from '../shared/uploads.js';
import { canonicalRoom } from '../shared/rooms.js';
import { emojis } from '../shared/emojis.js';
import { check, route } from './policies.js';
import { transaction, messageViews } from './database.js';
import { createThumbnails } from './thumbnails.js';
import { forViewer } from './poll-view.js';
export function registerMessages({
    app,
    db,
    get,
    all,
    run,
    hasRoom,
    canInRoom,
    messageView,
    emitRoom,
    maxStoredUploadBytes,
    polls,
}) {
    const thumbnails = createThumbnails({ get, all, run });
    const requireAction = (user, room, permission) =>
        check(canInRoom(user, room, permission), 'Permission denied in this conversation', 403);
    const threadParent = (user, room, thread) => {
        check(
            typeof thread === 'string' && thread.length > 0 && thread.length <= 100,
            'Invalid thread',
        );
        const parent = get('SELECT * FROM messages WHERE id=? AND room=?', thread, room);
        check(parent && hasRoom(user, room), 'Thread not found', 404);
        check(!parent.thread, 'Replies cannot have nested threads');
        return parent;
    };
    const updateParent = (thread) => {
        if (!thread) return;
        const parent = get('SELECT * FROM messages WHERE id=?', thread);
        if (parent) emitRoom(parent.room, 'message:update', messageView(parent));
    };
    app.get(
        '/api/messages/:id',
        route((req, res) => {
            const message = get('SELECT * FROM messages WHERE id=?', req.params.id);
            check(message && hasRoom(req.user, message.room), 'Message not found', 404);
            res.json(forViewer(messageView(message), req.user.id));
        }),
    );
    app.get(
        '/api/messages',
        route((req, res) => {
            const room = canonicalRoom(req.query.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            const limit = Number(req.query.limit || 500);
            check(Number.isInteger(limit) && limit >= 1 && limit <= 500, 'Invalid page size');
            const clauses = ['room=?'],
                params = [room];
            if (req.query.thread !== undefined) {
                threadParent(req.user, room, req.query.thread);
                clauses.push('thread=?');
                params.push(req.query.thread);
            } else clauses.push('thread IS NULL');
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
            const messages = messageViews(all, rows.reverse()).map((view) =>
                forViewer(view, req.user.id),
            );
            res.json(req.query.page === '1' ? { messages, next } : messages);
        }),
    );
    app.post(
        '/api/messages',
        route((req, res) => {
            const { body = '', attachment, attachments } = req.body;
            const room = canonicalRoom(req.body.room);
            check(typeof room === 'string' && hasRoom(req.user, room), 'Unknown conversation', 403);
            const thread = req.body.thread ?? null;
            if (thread === null) requireAction(req.user, room, 'messages.send');
            if (thread !== null) {
                const parent = threadParent(req.user, room, thread);
                requireAction(req.user, room, 'threads.reply');
                if (!get('SELECT id FROM messages WHERE thread=? LIMIT 1', parent.id))
                    requireAction(req.user, room, 'threads.create');
            }
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
            if (files.length) requireAction(req.user, room, 'files.attach');
            // A poll is a message whose text is the question; it needs no extra permission.
            const poll = req.body.poll === undefined ? null : polls.validate(req.body.poll);
            if (poll)
                check(
                    !body.trim() && !files.length,
                    'A poll is posted on its own, without text or attachments',
                );
            check(body.trim() || files.length || poll, 'Write a message or attach a file');
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
                    'INSERT INTO messages(id,room,author,body,created,thread) VALUES(?,?,?,?,?,?)',
                    id,
                    room,
                    req.user.id,
                    poll ? poll.question : body.trim(),
                    Date.now(),
                    thread,
                );
                if (poll) polls.insert(id, poll);
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
            if (poll) polls.schedule(id, poll.ends);
            emitRoom(room, 'message', m);
            updateParent(thread);
            res.json(forViewer(m, req.user.id));
        }),
    );
    app.patch(
        '/api/messages/:id',
        route((req, res) => {
            const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
            check(m && hasRoom(req.user, m.room), 'Message not found', 404);
            if ('pinned' in req.body) requireAction(req.user, m.room, 'messages.pin');
            if ('pinned' in req.body)
                check(typeof req.body.pinned === 'boolean', 'Invalid pin value');
            if ('body' in req.body) {
                check(m.author === req.user.id, 'Only the author can edit this message', 403);
                check(
                    !get('SELECT 1 FROM voice_channel_invitations WHERE message=?', m.id),
                    'Voice invitations cannot be edited. Delete the message to remove the invitation.',
                );
                check(
                    !get('SELECT 1 FROM polls WHERE message=?', m.id),
                    'Polls can’t be edited. Delete it and post a new one instead.',
                );
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
            if (m.author !== req.user.id) {
                check(
                    !m.room.startsWith('dm:'),
                    'Only the author can delete a direct message',
                    403,
                );
                requireAction(req.user, m.room, 'messages.deleteOthers');
            }
            run('DELETE FROM messages WHERE id=?', m.id);
            updateParent(m.thread);
            emitRoom(m.room, 'message:delete', { id: m.id, room: m.room });
            res.json({ ok: true });
        }),
    );
    app.post(
        '/api/messages/:id/reaction',
        route((req, res) => {
            const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
            check(m && hasRoom(req.user, m.room), 'Message not found', 404);
            const emoji = req.body.emoji;
            requireAction(req.user, m.room, 'reactions.add');
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
        '/api/attachments/:id/preview',
        route(async (req, res) => {
            // Check access before consulting the cache or touching image data.
            const attachment = get(
                'SELECT a.id,a.mime,m.room FROM attachments a JOIN messages m ON m.id=a.message WHERE a.id=?',
                req.params.id,
            );
            check(attachment && hasRoom(req.user, attachment.room), 'Attachment not found', 404);
            check(/^image\/(png|jpeg|gif|webp)$/.test(attachment.mime), 'Preview unavailable', 404);
            const data = await thumbnails.get(attachment.id, () => {
                const row = get('SELECT data FROM attachments WHERE id=?', attachment.id);
                return row ? Buffer.from(row.data, 'base64') : null;
            });
            // Access may have changed while the image was processed.
            const user = get('SELECT * FROM users WHERE id=? AND banned=0', req.user.id);
            check(
                user &&
                    hasRoom(user, attachment.room) &&
                    get('SELECT id FROM attachments WHERE id=?', attachment.id),
                'Attachment not found',
                404,
            );
            check(data, 'Preview unavailable', 404);
            res.setHeader('Cache-Control', 'private, no-cache');
            res.vary('Authorization');
            res.type('image/webp').send(data);
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
    return thumbnails;
}
