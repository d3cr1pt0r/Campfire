import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { canReadRoom } from './security.js';
import { canonicalRoom } from '../shared/rooms.js';
import { openDatabase, messageViews } from './database.js';
import { originPolicy, route } from './policies.js';
import { createSessions } from './sessions.js';
import { registerAccounts } from './accounts.js';
import { registerMessages } from './messages.js';
import { registerProfiles } from './profiles.js';
import { registerFriends } from './friends.js';
import { registerAdministration } from './administration.js';
import { registerCalls } from './calls.js';

export function createApp({
    dataDir = 'data',
    origins = [],
    name = 'My Driskord server',
    iceServers = [],
    trustProxy = false,
    maxStoredUploadBytes = 1024 * 1024 * 1024,
    sessionLifetimeMs = 30 * 86400000,
} = {}) {
    if (!Number.isSafeInteger(maxStoredUploadBytes) || maxStoredUploadBytes < 0)
        throw new Error('Invalid upload storage limit');
    if (!Number.isSafeInteger(sessionLifetimeMs) || sessionLifetimeMs <= 0)
        throw new Error('Invalid session lifetime');
    const database = openDatabase(dataDir, name);
    const { db, get, all } = database;
    const app = express();
    app.set('trust proxy', trustProxy);
    const http = createServer(app);
    const allowed = originPolicy(origins);
    app.use((req, res, next) => {
        if (!allowed(req.headers.origin, req.get('host')))
            return res.status(403).json({ error: 'Origin not allowed' });
        if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http: https: ws: wss:; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });
    app.use(express.json({ limit: '8mb' }));
    const io = new Server(http, {
        cors: { origin: true },
        allowRequest: (req, callback) =>
            callback(null, allowed(req.headers.origin, req.headers.host)),
        maxHttpBufferSize: 100000,
    });
    const sessions = createSessions({ ...database, io });
    const hasRoom = (user, room) =>
        canReadRoom(
            user.id,
            room,
            (id) => !!get('SELECT id FROM channels WHERE id=? AND kind=?', id, 'text'),
            (id) => !!get('SELECT id FROM users WHERE id=?', id),
        );
    const messageView = (message) => messageViews(all, [message])[0];
    const emitRoom = (rawRoom, event, data) => {
        const room = canonicalRoom(rawRoom);
        if (room.startsWith('dm:'))
            room.split(':')
                .slice(1)
                .forEach((id) => io.to(`user:${id}`).emit(event, data));
        else io.emit(event, data);
    };
    const context = {
        ...database,
        ...sessions,
        app,
        io,
        hasRoom,
        messageView,
        emitRoom,
        maxStoredUploadBytes,
        sessionLifetimeMs,
    };
    // Public registration/login must precede the authenticated feature routes.
    registerAccounts(context);
    app.use('/api', sessions.auth);
    app.post(
        '/api/logout',
        route((req, res) => {
            sessions.revoke(req.headers.authorization.replace(/^Bearer /, ''));
            res.json({ ok: true });
        }),
    );
    const calls = registerCalls(context);
    app.get(
        '/api/state',
        route((req, res) =>
            res.json({
                me: sessions.publicUser(req.user),
                name: get('SELECT value FROM settings WHERE key=?', 'name').value,
                users: sessions.users(),
                roles: all('SELECT * FROM roles').map((role) => ({
                    ...role,
                    permissions: JSON.parse(role.permissions),
                })),
                channels: all('SELECT * FROM channels'),
                friends: all(
                    'SELECT * FROM friends WHERE sender=? OR recipient=?',
                    req.user.id,
                    req.user.id,
                ),
                online: [
                    ...new Set(
                        [...io.sockets.sockets.values()].map((socket) => socket.data.user.id),
                    ),
                ],
                calls: calls.visibleCalls(req.user.id),
                directCalls: calls.privateState(req.user.id),
                emojis: all('SELECT id,name,author FROM emojis'),
                iceServers,
            }),
        ),
    );
    registerMessages(context);
    registerProfiles(context);
    registerFriends(context);
    registerAdministration({ ...context, enforceCalls: calls.enforceCalls });
    const dist = fileURLToPath(new URL('../dist', import.meta.url));
    if (existsSync(dist)) {
        app.use(express.static(dist));
        app.get('/', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
    app.use((error, _req, res, _next) => {
        if (!error.status || error.status >= 500) console.error(error);
        res.status(error.status || 500).json({
            error: error.status ? error.message : 'Internal server error',
        });
    });
    return {
        app,
        http,
        io,
        db,
        close: () =>
            new Promise((resolve) => {
                calls.close();
                sessions.close();
                io.close(() => {
                    db.close();
                    resolve();
                });
            }),
    };
}
