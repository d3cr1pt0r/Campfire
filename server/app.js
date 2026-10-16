import express from 'express';
import { imageMime, boundedPng, channelName } from './images.js';
import { maxUploadBytes, maxUploadFiles } from '../shared/uploads.js';
import { emojis } from '../shared/emojis.js';
import { tokenHash, createPassword, verifyPassword, hasPermission, canReadRoom } from './security.js';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
export function createApp({ dataDir = 'data', origins = [], name = 'My Driskord server', iceServers = [] } = {}) {
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, 'driskord.sqlite'));
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    const run = (s, ...p) => db.prepare(s).run(...p);
    const get = (s, ...p) => db.prepare(s).get(...p);
    const all = (s, ...p) => db.prepare(s).all(...p);
    run('INSERT OR IGNORE INTO roles VALUES(?,?,?,?)', 'owner', 'Owner', '#f3be57', JSON.stringify(['manage', 'send', 'voice']));
    run('INSERT OR IGNORE INTO roles VALUES(?,?,?,?)', 'member', 'Member', '#a5a8b5', JSON.stringify(['send', 'voice']));
    for (const [id, kind] of [['general', 'text'], ['introductions', 'text'], ['lounge', 'voice']])
        run('INSERT OR IGNORE INTO channels VALUES(?,?,?)', id, id, kind);
    run('INSERT OR IGNORE INTO settings VALUES(?,?)', 'name', name);
    const app = express();
    const http = createServer(app);
    const allowed = origin => !origin || origins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    app.use((req, res, next) => {
        if (req.headers.origin && !allowed(req.headers.origin) && req.headers.origin !== `${req.protocol}://${req.get('host')}`)
            return res.status(403).json({ error: 'Origin not allowed' });
        if (req.headers.origin)
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http: https: ws: wss:; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
        if (req.method === 'OPTIONS')
            return res.sendStatus(204);
        next();
    });
    app.use(express.json({ limit: '8mb' }));
    const io = new Server(http, { cors: { origin: true }, allowRequest: (req, cb) => { const origin = req.headers.origin; cb(null, allowed(origin) || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`); }, maxHttpBufferSize: 100000 });
    const hash = tokenHash;
    const userFor = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user WHERE s.token=? AND s.expires>? AND u.banned=0', hash(token), Date.now());
    const publicUser = u => ({ id: u.id, username: u.username, role: u.role, avatar: get('SELECT id FROM avatars WHERE user=?', u.id)?.id || null });
    const roles = () => all('SELECT * FROM roles').map(r => ({ ...r, permissions: JSON.parse(r.permissions) }));
    const can = (u, permission) => hasPermission(u, JSON.parse(get('SELECT permissions FROM roles WHERE id=?', u.role).permissions), permission);
    const requirePermission = (u, p) => {
        if (!can(u, p))
            throw Object.assign(new Error('Permission denied'), { status: 403 });
    };
    const check = (ok, message, status = 400) => {
        if (!ok)
            throw Object.assign(new Error(message), { status });
    };
    const route = fn => (req, res, next) => {
        try {
            Promise.resolve(fn(req, res)).catch(next);
        }
        catch (e) {
            next(e);
        }
    };
    const auth = (req, res, next) => {
        req.user = userFor(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!req.user)
            return res.status(401).json({ error: 'Please sign in again' });
        next();
    };
    const hasRoom = (u, room) => canReadRoom(u.id, room, r => !!get('SELECT id FROM channels WHERE id=? AND kind=?', r, 'text'), id => !!get('SELECT id FROM users WHERE id=?', id));
    const messageView = m => ({ ...m, attachments: all('SELECT id,name,mime FROM attachments WHERE message=?', m.id), reactions: all('SELECT user,emoji FROM reactions WHERE message=?', m.id) });
    const emitRoom = (room, event, data) => {
        if (room.startsWith('dm:'))
            room.split(':').slice(1).forEach(id => io.to(`user:${id}`).emit(event, data));
        else
            io.emit(event, data);
    };
    const limits = new Map();
    app.get('/api/info', (_req, res) => res.json({ name: get('SELECT value FROM settings WHERE key=?', 'name').value, registration: true }));
    app.post('/api/auth/:action', route((req, res) => {
        check(['login', 'register'].includes(req.params.action), 'Unknown action');
        const key = req.socket.remoteAddress;
        const attempts = limits.get(key) || { count: 0, time: Date.now() };
        if (Date.now() - attempts.time > 60000) {
            attempts.count = 0;
            attempts.time = Date.now();
        }
        attempts.count++;
        limits.set(key, attempts);
        check(attempts.count <= 20, 'Too many attempts. Try again in a minute.', 429);
        const { username, password } = req.body;
        check(typeof username === 'string' && /^[a-zA-Z0-9_ -]{2,32}$/.test(username), 'Username must be 2–32 letters, numbers, spaces, underscores or hyphens');
        check(typeof password === 'string' && password.length >= 10 && password.length <= 128, 'Password must contain 10–128 characters');
        let u = get('SELECT * FROM users WHERE username=?', username);
        if (req.params.action === 'register') {
            check(!u, 'That username is already taken', 409);
            const passwordHash = createPassword(password);
            const id = randomUUID();
            const role = get('SELECT COUNT(*) AS n FROM users').n === 0 ? 'owner' : 'member';
            run('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)', id, username, passwordHash, role);
            u = get('SELECT * FROM users WHERE id=?', id);
        }
        else {
            // Use a dummy hash when the user is absent to avoid a cheap username timing oracle.
            check(verifyPassword(password, u?.password) && u && !u.banned, 'Incorrect username or password', 401);
        }
        run('DELETE FROM sessions WHERE expires<=?', Date.now());
        const token = randomBytes(32).toString('hex');
        run('INSERT INTO sessions VALUES(?,?,?)', hash(token), u.id, Date.now() + 30 * 86400000);
        io.emit('refresh');
        res.json({ token, user: publicUser(u) });
    }));
    app.use('/api', auth);
    app.post('/api/logout', route((req, res) => {
        run('DELETE FROM sessions WHERE token=?', hash(req.headers.authorization.replace(/^Bearer /, '')));
        for (const s of io.sockets.sockets.values())
            if (s.data.token === req.headers.authorization.replace(/^Bearer /, ''))
                s.disconnect(true);
        res.json({ ok: true });
    }));
    app.get('/api/state', route((req, res) => res.json({ me: publicUser(req.user), name: get('SELECT value FROM settings WHERE key=?', 'name').value, users: all('SELECT id,username,role FROM users WHERE banned=0').map(publicUser), roles: roles(), channels: all('SELECT * FROM channels'), friends: all('SELECT * FROM friends WHERE sender=? OR recipient=?', req.user.id, req.user.id), online: [...new Set([...io.sockets.sockets.values()].map(s => s.data.user.id))], calls: visibleCalls(req.user.id), directCalls: privateState(req.user.id), emojis: all('SELECT id,name,author FROM emojis'), iceServers })));
    app.get('/api/messages', route((req, res) => {
        const room = String(req.query.room || '');
        check(hasRoom(req.user, room), 'Unknown conversation', 403);
        let messages = all('SELECT * FROM messages WHERE room=? ORDER BY created DESC LIMIT 500', room).reverse();
        if (req.query.search)
            messages = messages.filter(m => m.body.toLowerCase().includes(String(req.query.search).toLowerCase()));
        res.json(messages.map(messageView));
    }));
    app.post('/api/messages', route((req, res) => {
        requirePermission(req.user, 'send');
        const { room, body = '', attachment, attachments } = req.body;
        check(typeof room === 'string' && hasRoom(req.user, room), 'Unknown conversation', 403);
        check(typeof body === 'string' && body.length <= 4000, 'Messages can contain up to 4,000 characters');
        const files = attachments === undefined ? (attachment == null ? [] : [attachment]) : attachments;
        check(Array.isArray(files) && files.length <= maxUploadFiles, 'Attach up to 10 files per message');
        check(body.trim() || files.length, 'Write a message or attach a file');
        let total = 0;
        const validated = files.map(file => {
            check(file && typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 200 && typeof file.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) && file.data.length <= 7000000, 'Invalid attachment (maximum 5 MB)');
            const bytes = Buffer.from(file.data,'base64'); total += bytes.length;
            check(total <= maxUploadBytes,'Attachments must total 5 MB or less per message');
            return {...file,mime:imageMime(bytes) || 'application/octet-stream'};
        });
        const id = randomUUID();
        db.exec('BEGIN IMMEDIATE');
        try {
            run('INSERT INTO messages(id,room,author,body,created) VALUES(?,?,?,?,?)', id, room, req.user.id, body.trim(), Date.now());
            for (const file of validated) run('INSERT INTO attachments VALUES(?,?,?,?,?)', randomUUID(), id, file.name, file.mime, file.data);
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const m = messageView(get('SELECT * FROM messages WHERE id=?', id));
        emitRoom(room, 'message', m);
        res.json(m);
    }));
    app.patch('/api/messages/:id', route((req, res) => {
        const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
        check(m && hasRoom(req.user, m.room), 'Message not found', 404);
        if ('pinned' in req.body)
            requirePermission(req.user, 'manage');
        if ('body' in req.body) {
            check(m.author === req.user.id, 'Only the author can edit this message', 403);
            check(typeof req.body.body === 'string' && req.body.body.trim().length > 0 && req.body.body.length <= 4000, 'Invalid message');
            run('UPDATE messages SET body=?,edited=? WHERE id=?', req.body.body.trim(), Date.now(), m.id);
        }
        if ('pinned' in req.body) {
            requirePermission(req.user, 'manage');
            run('UPDATE messages SET pinned=? WHERE id=?', req.body.pinned ? 1 : 0, m.id);
        }
        emitRoom(m.room, 'message:update', messageView(get('SELECT * FROM messages WHERE id=?', m.id)));
        res.json({ ok: true });
    }));
    app.delete('/api/messages/:id', route((req, res) => { const m = get('SELECT * FROM messages WHERE id=?', req.params.id); check(m && hasRoom(req.user, m.room), 'Message not found', 404); check(m.author === req.user.id || can(req.user, 'manage'), 'Permission denied', 403); run('DELETE FROM messages WHERE id=?', m.id); emitRoom(m.room, 'message:delete', { id: m.id, room: m.room }); res.json({ ok: true }); }));
    app.post('/api/messages/:id/reaction', route((req, res) => {
        const m = get('SELECT * FROM messages WHERE id=?', req.params.id);
        check(m && hasRoom(req.user, m.room), 'Message not found', 404);
        const emoji = req.body.emoji;
        requirePermission(req.user, 'send');
        check(typeof emoji === 'string' && (emojis.includes(emoji) || (/^:[a-z0-9_]{2,32}:$/.test(emoji) && get('SELECT id FROM emojis WHERE name=?', emoji.slice(1,-1)))), 'Unsupported emoji');
        if (get('SELECT * FROM reactions WHERE message=? AND user=? AND emoji=?', m.id, req.user.id, emoji))
            run('DELETE FROM reactions WHERE message=? AND user=? AND emoji=?', m.id, req.user.id, emoji);
        else
            run('INSERT INTO reactions VALUES(?,?,?)', m.id, req.user.id, emoji);
        emitRoom(m.room, 'message:update', messageView(m));
        res.json({ ok: true });
    }));
    app.get('/api/attachments/:id', route((req, res) => { const a = get('SELECT a.*,m.room FROM attachments a JOIN messages m ON m.id=a.message WHERE a.id=?', req.params.id); check(a && hasRoom(req.user, a.room), 'Attachment not found', 404); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`); const data = Buffer.from(a.data, 'base64'); const mime = imageMime(data); if (req.query.inline === '1' && mime) { res.setHeader('Content-Disposition', 'inline'); res.type(mime); } else res.type('application/octet-stream'); res.send(data); }));
    app.post('/api/friends', route((req, res) => {
        const target = get('SELECT id FROM users WHERE username=? AND banned=0', String(req.body.username));
        check(target && target.id !== req.user.id, 'User not found or this is your own username');
        const incoming = get('SELECT * FROM friends WHERE sender=? AND recipient=?', target.id, req.user.id);
        if (incoming)
            run('UPDATE friends SET accepted=1 WHERE sender=? AND recipient=?', target.id, req.user.id);
        else
            run('INSERT OR IGNORE INTO friends VALUES(?,?,0)', req.user.id, target.id);
        io.to(`user:${target.id}`).to(`user:${req.user.id}`).emit('refresh');
        res.json({ ok: true });
    }));
    app.delete('/api/friends/:id', route((req, res) => { run('DELETE FROM friends WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)', req.user.id, req.params.id, req.params.id, req.user.id); io.to(`user:${req.params.id}`).to(`user:${req.user.id}`).emit('refresh'); res.json({ ok: true }); }));
    app.post('/api/channels', route((req, res) => {
        requirePermission(req.user, 'manage');
        let name; try { name = channelName(req.body.name, req.body.kind); } catch (e) { check(false, e.message); }
        const id = randomUUID(); run('INSERT INTO channels VALUES(?,?,?)', id, name, req.body.kind); io.emit('refresh'); res.json({ id });
    }));
    app.post('/api/profile/avatar', route((req, res) => {
        let data; try { data = boundedPng(req.body.data, 512); } catch (e) { check(false, e.message); }
        const id = randomUUID();
        run('INSERT INTO avatars(id,user,data) VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET id=excluded.id,data=excluded.data', id, req.user.id, data);
        io.emit('refresh'); res.json({ id });
    }));
    app.delete('/api/profile/avatar', route((req,res) => { run('DELETE FROM avatars WHERE user=?', req.user.id); io.emit('refresh'); res.json({ok:true}); }));
    app.get('/api/avatars/:id', route((req,res) => {
        const image = get('SELECT data FROM avatars WHERE id=?', req.params.id); check(image, 'Image not found',404);
        res.type('image/png').send(Buffer.from(image.data,'base64'));
    }));
    app.post('/api/emojis', route((req,res) => {
        requirePermission(req.user,'send');
        const name = req.body.name;
        check(typeof name === 'string' && /^[a-z0-9_]{2,32}$/.test(name), 'Emoji names need 2–32 lowercase letters, numbers or underscores');
        check(!get('SELECT id FROM emojis WHERE name=?',name), 'That emoji name is already used',409);
        check(get('SELECT COUNT(*) n FROM emojis').n < 200,'This server has reached its limit of 200 custom emojis');
        check(get('SELECT COUNT(*) n FROM emojis WHERE author=?', req.user.id).n < 50,'You can upload up to 50 custom emojis');
        let data; try { data = boundedPng(req.body.data,128); } catch(e) { check(false,e.message); }
        const id = randomUUID(); run('INSERT INTO emojis VALUES(?,?,?,?)',id,name,req.user.id,data); io.emit('refresh'); res.json({id});
    }));
    app.get('/api/emojis/:id', route((req,res) => {
        const image = get('SELECT data FROM emojis WHERE id=?',req.params.id); check(image,'Emoji not found',404);
        res.type('image/png').send(Buffer.from(image.data,'base64'));
    }));
    app.delete('/api/emojis/:id',route((req,res) => {
        const emoji = get('SELECT author,name FROM emojis WHERE id=?',req.params.id);
        check(emoji,'Emoji not found',404); check(emoji.author === req.user.id || can(req.user,'manage'),'Permission denied',403);
        const affected = all('SELECT DISTINCT m.* FROM messages m JOIN reactions r ON r.message=m.id WHERE r.emoji=?',`:${emoji.name}:`);
        run('DELETE FROM emojis WHERE id=?',req.params.id);
        run('DELETE FROM reactions WHERE emoji=?',`:${emoji.name}:`);
        affected.forEach(message=>emitRoom(message.room,'message:update',messageView(message)));
        io.emit('refresh'); res.json({ok:true});
    }));
    app.post('/api/roles', route((req, res) => { requirePermission(req.user, 'manage'); const { name, color, permissions } = req.body; check(typeof name === 'string' && name.length > 0 && name.length <= 32 && /^#[0-9a-f]{6}$/i.test(color) && Array.isArray(permissions) && permissions.every(p => ['send', 'voice', 'manage'].includes(p)), 'Invalid role'); check(req.user.role === 'owner' || !permissions.includes('manage'), 'Only the owner can grant server management', 403); const id = randomUUID(); run('INSERT INTO roles VALUES(?,?,?,?)', id, name, color, JSON.stringify(permissions)); io.emit('refresh'); res.json({ id }); }));
    app.patch('/api/roles/:id', route((req, res) => {
        requirePermission(req.user, 'manage');
        const role = get('SELECT * FROM roles WHERE id=?', req.params.id);
        check(role && role.id !== 'owner', 'The owner role cannot be changed', 403);
        const { name, color, permissions } = req.body;
        check(typeof name === 'string' && name.length > 0 && name.length <= 32 && /^#[0-9a-f]{6}$/i.test(color) && Array.isArray(permissions) && permissions.every(p => ['send', 'voice', 'manage'].includes(p)), 'Invalid role');
        check(req.user.role === 'owner' || (!permissions.includes('manage') && !JSON.parse(role.permissions).includes('manage')), 'Only the owner can change management roles', 403);
        run('UPDATE roles SET name=?,color=?,permissions=? WHERE id=?', name, color, JSON.stringify(permissions), role.id);
        enforceCalls();
        io.emit('refresh');
        res.json({ ok: true });
    }));
    app.patch('/api/users/:id/role', route((req, res) => { check(req.user.role === 'owner', 'Only the owner can assign roles', 403); const target = get('SELECT * FROM users WHERE id=?', req.params.id); check(target && target.role !== 'owner' && req.body.role !== 'owner' && get('SELECT id FROM roles WHERE id=?', req.body.role), 'Invalid role assignment'); run('UPDATE users SET role=? WHERE id=?', req.body.role, target.id); enforceCalls(); io.emit('refresh'); res.json({ ok: true }); }));
    app.patch('/api/settings', route((req, res) => { requirePermission(req.user, 'manage'); check(typeof req.body.name === 'string' && req.body.name.trim().length > 0 && req.body.name.length <= 64, 'Server name must contain 1–64 characters'); run('UPDATE settings SET value=? WHERE key=?', req.body.name.trim(), 'name'); io.emit('refresh'); res.json({ ok: true }); }));
    const callState = () => [...io.sockets.sockets.values()].filter(s => s.data.call).map(s => ({ socket: s.id, user: s.data.user.id, channel: s.data.call }));
    // Private call authorization and invitations live only for the active session.
    const privateCalls = new Map();
    const visibleCalls = user => callState().filter(c => !c.channel.startsWith('private:') || privateCalls.get(c.channel)?.allowed.has(user));
    const privateState = user => [...privateCalls.values()].filter(c => c.allowed.has(user)).map(c => ({id:c.id,creator:c.creator,invited:[...c.allowed].filter(id => !c.accepted.has(id)),members:[...c.accepted]}));
    const broadcastCalls = () => {
        for (const s of io.sockets.sockets.values()) s.emit('calls', visibleCalls(s.data.user.id));
    };
    const prunePrivateCalls = () => {
        let changed = false;
        for (const [id, room] of privateCalls) {
            const active = callState().some(c => c.channel === id);
            if (!active && (room.started || Date.now() - room.created > 120000)) { privateCalls.delete(id); changed = true; }
            else {
                for (const [user, invitedAt] of room.pending) if (Date.now() - invitedAt > 120000) { room.pending.delete(user); room.allowed.delete(user); changed = true; }
            }
        }
        for (const [key,time] of recentCalls) if (Date.now()-time > 60000) recentCalls.delete(key);
        if (changed) { broadcastCalls(); io.emit('refresh'); }
    };
    const callTimer = setInterval(prunePrivateCalls, 15000); callTimer.unref();
    const areFriends = (a,b) => !!get('SELECT 1 FROM friends WHERE accepted=1 AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))',a,b,b,a);
    const inviteUser = (caller, room, id) => {
        const target = get('SELECT * FROM users WHERE id=? AND banned=0', id);
        check(target && target.id !== caller.id && areFriends(caller.id,id),'You can only call accepted friends',403);
        requirePermission(target,'voice');
        check([...io.sockets.sockets.values()].some(s => s.data.user.id === id),'That friend is offline');
        check(!room.allowed.has(id),'That person is already invited or in this call',409);
        check(room.allowed.size < 8,'This call is full (8 people maximum)');
        room.allowed.add(id); room.pending.set(id,Date.now());
        io.to(`user:${id}`).emit('call:invite',{id:room.id,from:caller.id});
        io.emit('refresh');
    };
    const recentCalls = new Map();
    app.post('/api/calls', route((req,res) => {
        requirePermission(req.user,'voice');
        check(typeof req.body.user === 'string','Choose a friend');
        check(!callState().some(c=>c.user===req.user.id),'Leave your current call before starting another');
        const key = `${req.user.id}:${req.body.user}`;
        check(Date.now() - (recentCalls.get(key) || 0) > 15000,'Wait a few seconds before calling this friend again',429);
        check([...privateCalls.values()].filter(c=>c.creator===req.user.id).length < 4,'Finish your existing calls first');
        const id = `private:${randomUUID()}`;
        const room = {id,creator:req.user.id,allowed:new Set([req.user.id]),accepted:new Set([req.user.id]),pending:new Map(),created:Date.now(),started:false};
        inviteUser(req.user,room,req.body.user); privateCalls.set(id,room); recentCalls.set(key,Date.now());
        io.emit('refresh'); res.json({id});
    }));
    app.post('/api/calls/:id/invite', route((req,res) => {
        requirePermission(req.user,'voice');
        const room=privateCalls.get(req.params.id);
        check(room && callState().some(c=>c.channel===room.id && c.user===req.user.id),'Join this private call before inviting friends',403);
        check(typeof req.body.user==='string','Choose a friend');
        inviteUser(req.user,room,req.body.user); res.json({ok:true});
    }));
    app.post('/api/calls/:id/decline',route((req,res) => {
        const room=privateCalls.get(req.params.id); check(room?.allowed.has(req.user.id),'Call not found',404);
        check(!callState().some(c=>c.user===req.user.id && c.channel===room.id),'Leave the call first');
        room.allowed.delete(req.user.id); room.accepted.delete(req.user.id); room.pending.delete(req.user.id);
        prunePrivateCalls(); io.emit('refresh'); res.json({ok:true});
    }));
    const enforceCalls = () => {
        for (const s of io.sockets.sockets.values()) {
            const u = userFor(s.data.token);
            if (s.data.call && (!u || !can(u, 'voice'))) {
                s.data.call = null;
                s.emit('call:revoked');
            }
        }
        prunePrivateCalls();
        broadcastCalls();
    };
    io.use((socket, next) => {
        const u = userFor(socket.handshake.auth.token);
        if (!u)
            return next(new Error('Authentication required'));
        socket.data.user = u;
        socket.data.token = socket.handshake.auth.token;
        next();
    });
    io.on('connection', socket => {
        socket.join(`user:${socket.data.user.id}`);
        io.emit('refresh');
        socket.use((_packet, next) => {
            const u = userFor(socket.data.token);
            if (!u) {
                socket.disconnect(true);
                return;
            }
            socket.data.user = u;
            next();
        });
        socket.on('typing', room => {
            if (typeof room === 'string' && hasRoom(socket.data.user, room))
                emitRoom(room, 'typing', { room, user: socket.data.user.id });
        });
        socket.on('call:join', (channel, ack = () => { }) => {
            if (typeof ack !== 'function')
                return;
            try {
                requirePermission(socket.data.user, 'voice');
                check(typeof channel === 'string' && (get('SELECT id FROM channels WHERE id=? AND kind=?', channel, 'voice') || privateCalls.get(channel)?.allowed.has(socket.data.user.id)), 'Unknown voice channel or private call');
                check(!callState().some(c => c.user === socket.data.user.id && c.socket !== socket.id), 'You are already in a call on another device');
                check(callState().filter(c => c.channel === channel).length < 8, 'This call is full (8 people maximum)');
                const peers = callState().filter(c => c.channel === channel && c.socket !== socket.id);
                socket.data.call = channel;
                const room = privateCalls.get(channel);
                if (room) { room.accepted.add(socket.data.user.id); room.pending.delete(socket.data.user.id); room.started = true; io.emit('refresh'); }
                broadcastCalls();
                ack({ peers });
            }
            catch (e) {
                ack({ error: e.message });
            }
        });
        socket.on('call:speaking', active => {
            if (typeof active !== 'boolean' || !socket.data.call || !can(socket.data.user,'voice')) return;
            const now = Date.now(); if (now - (socket.data.lastActivity || 0) < 50) return;
            socket.data.lastActivity = now;
            for (const peer of io.sockets.sockets.values()) if (peer.id !== socket.id && peer.data.call === socket.data.call)
                peer.emit('call:speaking',{user:socket.data.user.id,active});
        });
        socket.on('call:leave', () => { socket.data.call = null; prunePrivateCalls(); broadcastCalls(); });
        socket.on('signal', payload => {
            if (!payload || typeof payload !== 'object')
                return;
            const { to, data } = payload;
            const target = io.sockets.sockets.get(to);
            if (data && typeof data === 'object' && socket.data.call && can(socket.data.user, 'voice') && target?.data.call === socket.data.call && JSON.stringify(data).length < 50000)
                target.emit('signal', { from: socket.id, user: socket.data.user.id, data });
        });
        socket.on('disconnect', () => { prunePrivateCalls(); broadcastCalls(); io.emit('refresh'); });
    });
    const dist = fileURLToPath(new URL('../dist', import.meta.url));
    if (existsSync(dist)) {
        app.use(express.static(dist));
        app.get('/', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
    app.use((err, _req, res, _next) => {
        if (!err.status || err.status >= 500)
            console.error(err);
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
    });
    return { app, http, io, db, close: () => new Promise(resolve => { clearInterval(callTimer); io.close(() => { db.close(); resolve(); }); }) };
}
