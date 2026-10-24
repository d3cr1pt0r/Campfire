import { randomUUID } from 'node:crypto';
import express from 'express';
import { imageInfo, imageMime } from './images.js';
import { formatUploadLimit, maxUploadFiles } from '../shared/uploads.js';
import { canonicalRoom } from '../shared/rooms.js';
import { emojis } from '../shared/emojis.js';
import { check, route } from './policies.js';
import { containsText, transaction } from './database.js';
import { createThumbnails } from './thumbnails.js';
import { forViewer } from './poll-view.js';
const removedFile = 'This file was removed after the retention period';
const standardEmojis = new Set(emojis);
// node:sqlite returns blobs as Uint8Array; a Buffer view avoids copying large files.
const bytesOf = (data) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
export function registerMessages({
    app,
    db,
    get,
    all,
    run,
    hasRoom,
    canInRoom,
    messageView,
    messageViews,
    emitRoom,
    io,
    userFor,
    activity,
    storageQuota,
    uploadLimit,
    polls,
    previews,
    reader,
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
    // Cards arrive after the message: the server fetches the links, then updates it.
    const unfurl = (id) =>
        void previews
            ?.unfurl(id)
            .then((changed) => {
                const message = changed && get('SELECT * FROM messages WHERE id=?', id);
                if (message) emitRoom(message.room, 'message:update', messageView(message));
            })
            .catch(() => {});
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
    // Search scans the conversation, so it runs on a worker thread and nobody waits for it.
    // Access may change, and messages be edited or deleted, while it runs; the page is
    // checked again against the current rows.
    const search = async (req, res, room, sql, params) => {
        const cancel = new AbortController();
        res.on('close', () =>
            cancel.abort(Object.assign(new Error('Search cancelled'), { status: 499 })),
        );
        const found = await reader.all(sql, params, cancel.signal);
        const user = get('SELECT * FROM users WHERE id=? AND banned=0', req.user.id);
        check(user && hasRoom(user, room), 'Unknown conversation', 403);
        if (!found.length) return found;
        const current = new Map(
            all(
                `SELECT * FROM messages WHERE id IN (${found.map(() => '?').join(',')})`,
                ...found.map((row) => row.id),
            ).map((row) => [row.id, row]),
        );
        return found.map((row) => {
            const now = current.get(row.id);
            return now && containsText(now.body, req.query.search) ? now : { ...row, gone: true };
        });
    };
    app.get(
        '/api/messages',
        route(async (req, res) => {
            const room = canonicalRoom(req.query.room);
            check(hasRoom(req.user, room), 'Unknown conversation', 403);
            const limit = Number(req.query.limit || 500);
            check(Number.isInteger(limit) && limit >= 1 && limit <= 500, 'Invalid page size');
            if (req.query.around !== undefined) {
                check(
                    typeof req.query.around === 'string' && req.query.around.length <= 100,
                    'Invalid message target',
                );
                check(
                    !req.query.before && !req.query.search && req.query.pinned !== '1',
                    'History jumps cannot use filters',
                );
                const target = get(
                    'SELECT * FROM messages WHERE id=? AND room=?',
                    req.query.around,
                    room,
                );
                check(
                    target && (target.thread ?? null) === (req.query.thread ?? null),
                    'Message not found',
                    404,
                );
                if (target.thread) threadParent(req.user, room, target.thread);
                const thread = target.thread ?? null;
                const side = Math.floor((limit - 1) / 2);
                const before = all(
                    'SELECT * FROM messages WHERE room=? AND thread IS ? AND (created<? OR (created=? AND id<?)) ORDER BY created DESC,id DESC LIMIT ?',
                    room,
                    thread,
                    target.created,
                    target.created,
                    target.id,
                    side + 1,
                );
                const after = all(
                    'SELECT * FROM messages WHERE room=? AND thread IS ? AND (created>? OR (created=? AND id>?)) ORDER BY created,id LIMIT ?',
                    room,
                    thread,
                    target.created,
                    target.created,
                    target.id,
                    side + 1,
                );
                const hasOlder = before.length > side,
                    newer = after.length > side;
                before.length = Math.min(before.length, side);
                after.length = Math.min(after.length, side);
                const oldest = before.at(-1) ?? target;
                const rows = [...before.reverse(), target, ...after];
                res.json({
                    messages: messageViews(rows).map((view) => forViewer(view, req.user.id)),
                    next: hasOlder
                        ? Buffer.from(JSON.stringify([oldest.created, oldest.id])).toString(
                              'base64url',
                          )
                        : null,
                    newer,
                });
                return;
            }
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
            const sql = `SELECT * FROM messages WHERE ${clauses.join(' AND ')} ORDER BY created DESC,id DESC LIMIT ?`;
            const rows = req.query.search
                ? await search(req, res, room, sql, [...params, limit + 1])
                : all(sql, ...params, limit + 1);
            const hasMore = rows.length > limit;
            rows.length = Math.min(rows.length, limit);
            const oldest = rows.at(-1);
            const next =
                hasMore && oldest
                    ? Buffer.from(JSON.stringify([oldest.created, oldest.id])).toString('base64url')
                    : null;
            const messages = messageViews(rows.filter((row) => !row.gone).reverse()).map((view) =>
                forViewer(view, req.user.id),
            );
            res.json({ messages, next });
        }),
    );
    // Text and polls arrive as JSON; files as multipart/form-data with room, body and thread
    // fields and one "file" part each. Both are read only after sign-in.
    const messageJson = express.json({ limit: '1mb' });
    const formFields = new Set(['room', 'body', 'thread']);
    const readForm = async (req) => {
        let form;
        try {
            form = await new Request('http://campfire.invalid/', {
                method: 'POST',
                headers: { 'content-type': req.get('content-type') },
                body: req.body,
            }).formData();
        } catch {
            check(false, 'Invalid message form');
        }
        const fields = {},
            files = [];
        for (const [key, value] of form) {
            if (key === 'file' && typeof value !== 'string')
                files.push({ name: value.name, data: Buffer.from(await value.arrayBuffer()) });
            else {
                check(
                    formFields.has(key) && typeof value === 'string' && !Object.hasOwn(fields, key),
                    'Invalid message form',
                );
                fields[key] = value;
            }
        }
        req.body = fields;
        req.files = files;
    };
    const parseMessage = (req, res, next) => {
        if (!req.is('multipart/form-data')) return messageJson(req, res, next);
        const limit = uploadLimit();
        // The form's framing and text fields fit in the extra 64 KB.
        express.raw({ type: 'multipart/form-data', limit: limit + 64 * 1024 })(
            req,
            res,
            (error) => {
                if (error?.type === 'entity.too.large')
                    return next(
                        Object.assign(
                            new Error(
                                `Attachments must total ${formatUploadLimit(limit)} or less per message`,
                            ),
                            { status: 413 },
                        ),
                    );
                if (error) return next(error);
                readForm(req).then(() => next(), next);
            },
        );
    };
    app.post(
        '/api/messages',
        parseMessage,
        route((req, res) => {
            const fields = req.body;
            check(
                fields && typeof fields === 'object' && !Array.isArray(fields),
                'Invalid message',
            );
            check(
                fields.attachments === undefined && fields.attachment === undefined,
                'Send attachments as multipart/form-data',
            );
            const { body = '' } = fields;
            const room = canonicalRoom(fields.room);
            check(typeof room === 'string' && hasRoom(req.user, room), 'Unknown conversation', 403);
            const thread = fields.thread ?? null;
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
            const files = req.files ?? [];
            check(files.length <= maxUploadFiles, 'Attach up to 10 files per message');
            if (files.length) requireAction(req.user, room, 'files.attach');
            // A poll is a message whose text is the question; it needs no extra permission.
            const poll = fields.poll === undefined ? null : polls.validate(fields.poll);
            if (poll)
                check(
                    !body.trim() && !files.length,
                    'A poll is posted on its own, without text or attachments',
                );
            check(body.trim() || files.length || poll, 'Write a message or attach a file');
            const limit = uploadLimit();
            let total = 0;
            const validated = files.map((file) => {
                check(
                    file.name.length > 0 && file.name.length <= 200,
                    'Attachment names must contain 1–200 characters',
                );
                const mime = imageMime(file.data);
                total += file.data.length;
                check(
                    total <= limit,
                    `Attachments must total ${formatUploadLimit(limit)} or less per message`,
                );
                return {
                    ...file,
                    mime: mime || 'application/octet-stream',
                    // Images store their displayed size; zeros mark an unreadable header.
                    image: mime
                        ? (imageInfo(file.data) ?? { width: 0, height: 0, animated: false })
                        : null,
                };
            });
            const id = randomUUID();
            transaction(db, () => {
                if (validated.length) {
                    const quota = storageQuota();
                    const used = get('SELECT bytes FROM storage_usage WHERE id=1').bytes;
                    check(quota > 0, 'New attachments are turned off on this server', 403);
                    check(
                        used + total <= quota,
                        'Server attachment storage is full. Delete attachments or ask the owner to raise the quota.',
                        413,
                    );
                }
                const now = Date.now();
                run(
                    'INSERT INTO messages(id,room,author,body,created,thread,since) VALUES(?,?,?,?,?,?,?)',
                    id,
                    room,
                    req.user.id,
                    poll ? poll.question : body.trim(),
                    now,
                    thread,
                    now,
                );
                if (poll) polls.insert(id, poll);
                for (const file of validated) {
                    const attachment = randomUUID();
                    run(
                        'INSERT INTO attachments(id,message,name,mime,bytes,data) VALUES(?,?,?,?,?,?)',
                        attachment,
                        id,
                        file.name,
                        file.mime,
                        file.data.length,
                        file.data,
                    );
                    if (file.image)
                        run(
                            'INSERT INTO attachment_images(attachment,width,height,animated) VALUES(?,?,?,?)',
                            attachment,
                            file.image.width,
                            file.image.height,
                            file.image.animated ? 1 : 0,
                        );
                }
            });
            // Links to pages already stored show at once; the rest follow the fetch.
            if (!poll) previews?.link(id);
            const m = messageView(get('SELECT * FROM messages WHERE id=?', id));
            if (poll) polls.schedule(id, poll.ends);
            emitRoom(room, 'message', m);
            updateParent(thread);
            if (!poll) unfurl(id);
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
                previews?.link(m.id);
                previews?.prune();
            }
            if ('pinned' in req.body) {
                // Unpinning restarts the retention period, so a misclick never loses anything.
                if (m.pinned && !req.body.pinned)
                    run('UPDATE messages SET pinned=0,since=? WHERE id=?', Date.now(), m.id);
                else run('UPDATE messages SET pinned=? WHERE id=?', req.body.pinned ? 1 : 0, m.id);
            }
            const view = messageView(get('SELECT * FROM messages WHERE id=?', m.id));
            emitRoom(m.room, 'message:update', view);
            if ('pinned' in req.body) updateParent(m.thread);
            if ('body' in req.body) unfurl(m.id);
            res.json(forViewer(view, req.user.id));
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
            transaction(db, () => {
                run('DELETE FROM messages WHERE id=?', m.id);
                // Losing a pinned reply restarts the thread's period, as unpinning it would.
                if (m.thread && m.pinned)
                    run('UPDATE messages SET since=MAX(since,?) WHERE id=?', Date.now(), m.thread);
            });
            previews?.prune();
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
                    (standardEmojis.has(emoji) ||
                        (/^:[a-z0-9_]{2,32}:$/.test(emoji) &&
                            get('SELECT id FROM emojis WHERE name=?', emoji.slice(1, -1)))),
                'Unsupported emoji',
            );
            const existing = get(
                'SELECT * FROM reactions WHERE message=? AND user=? AND emoji=?',
                m.id,
                req.user.id,
                emoji,
            );
            if (existing)
                run(
                    'DELETE FROM reactions WHERE message=? AND user=? AND emoji=?',
                    m.id,
                    req.user.id,
                    emoji,
                );
            else run('INSERT INTO reactions VALUES(?,?,?)', m.id, req.user.id, emoji);
            emitRoom(m.room, 'message:update', messageView(m));
            if (m.author && m.author !== req.user.id) activity.publish(m.room, m.author);
            if (!existing && m.author && m.author !== req.user.id) {
                const notification = get(
                    'SELECT sequence FROM reaction_notifications WHERE message=? AND actor=? AND emoji=?',
                    m.id,
                    req.user.id,
                    emoji,
                );
                for (const socket of io.sockets.sockets.values()) {
                    const recipient = userFor(socket.data.token);
                    if (recipient?.id === m.author && hasRoom(recipient, m.room))
                        socket.emit('reaction:notification', {
                            message: { id: m.id, room: m.room, thread: m.thread, author: m.author },
                            user: req.user.id,
                            emoji,
                            sequence: notification.sequence,
                        });
                }
            }
            res.json({ ok: true });
        }),
    );
    app.get(
        '/api/attachments/:id/preview',
        route(async (req, res) => {
            // Check access before consulting the cache or touching image data.
            const attachment = get(
                'SELECT a.id,a.mime,a.removed,m.room FROM attachments a JOIN messages m ON m.id=a.message WHERE a.id=?',
                req.params.id,
            );
            check(attachment && hasRoom(req.user, attachment.room), 'Attachment not found', 404);
            check(!attachment.removed, removedFile, 410);
            check(/^image\/(png|jpeg|gif|webp)$/.test(attachment.mime), 'Preview unavailable', 404);
            const data = await thumbnails.get(attachment.id, () => {
                const row = get('SELECT data FROM attachments WHERE id=?', attachment.id);
                return row ? bytesOf(row.data) : null;
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
                'SELECT a.id,a.name,a.removed,m.room FROM attachments a JOIN messages m ON m.id=a.message WHERE a.id=?',
                req.params.id,
            );
            check(a && hasRoom(req.user, a.room), 'Attachment not found', 404);
            check(!a.removed, removedFile, 410);
            res.setHeader(
                'Content-Disposition',
                `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
            );
            const data = bytesOf(get('SELECT data FROM attachments WHERE id=?', a.id).data);
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
