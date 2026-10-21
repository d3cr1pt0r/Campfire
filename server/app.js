import express from 'express';
import { createRegistration } from './registration.js';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createChannelAccess } from './channel-access.js';
import { canonicalRoom } from '../shared/rooms.js';
import { openDatabase, messageViews } from './database.js';
import { imageInfo } from './images.js';
import { originPolicy, route } from './policies.js';
import { createSessions } from './sessions.js';
import { registerAccounts } from './accounts.js';
import { registerMessages } from './messages.js';
import { registerPolls } from './polls.js';
import { forViewer } from './poll-view.js';
import { registerProfiles } from './profiles.js';
import { registerAdministration } from './administration.js';
import { registerCalls } from './calls.js';
import { registerVoiceInvitations } from './voice-invitations.js';
import { registerPresence } from './presence.js';
import { loadCertificateFiles, loadIdentity } from './identity.js';

export function createApp({
    dataDir = 'data',
    origins = [],
    name = 'My Campfire server',
    iceServers = [],
    trustProxy = false,
    maxStoredUploadBytes = 1024 * 1024 * 1024,
    setupCode,
    sessionLifetimeMs = 30 * 86400000,
    // null: plain HTTP (development, TLS proxy, or explicitly enabled direct HTTP).
    // { directory, address, allowNew }: self-managed identity. { certFile, keyFile }: host files.
    tls = null,
} = {}) {
    if (!Number.isSafeInteger(maxStoredUploadBytes) || maxStoredUploadBytes < 0)
        throw new Error('Invalid upload storage limit');
    if (!Number.isSafeInteger(sessionLifetimeMs) || sessionLifetimeMs <= 0)
        throw new Error('Invalid session lifetime');
    const database = openDatabase(dataDir, name);
    const { db, get, all, run } = database;
    let identity = null;
    try {
        if (tls?.directory) {
            identity = loadIdentity({
                ...tls,
                recorded: get("SELECT value FROM settings WHERE key='identity'")?.value || null,
            });
            run(
                "INSERT INTO settings(key,value) VALUES('identity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                identity.fingerprint,
            );
        } else if (tls) identity = loadCertificateFiles(tls);
    } catch (error) {
        db.close();
        throw error;
    }
    const app = express();
    app.set('trust proxy', trustProxy);
    const secureContext = () => ({ ...identity.context(), minVersion: 'TLSv1.3' });
    const http = identity ? createSecureServer(secureContext(), app) : createServer(app);
    const renewal =
        identity &&
        setInterval(() => {
            if (identity.renew()) http.setSecureContext(secureContext());
        }, 86400000);
    renewal?.unref();
    const publicIdentity = () =>
        identity
            ? {
                  ...(identity.fingerprint ? { fingerprint: identity.fingerprint } : {}),
                  certificateSha256: identity.certificateSha256,
              }
            : undefined;
    const allowed = originPolicy(origins);
    app.use((req, res, next) => {
        if (!allowed(req.headers.origin, req.get('host')))
            return res.status(403).json({ error: 'Origin not allowed' });
        if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
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
    const access = createChannelAccess({ ...database, ...sessions, io });
    const { hasRoom } = access;
    // Image attachments from before sizes were stored are measured once, when first viewed.
    const describeImage = (id) => {
        const row = get('SELECT data FROM attachments WHERE id=?', id);
        if (!row) return null;
        const size = imageInfo(Buffer.from(row.data, 'base64'));
        run(
            'INSERT OR IGNORE INTO attachment_images(attachment,width,height,animated) VALUES(?,?,?,?)',
            id,
            size?.width ?? 0,
            size?.height ?? 0,
            size?.animated ? 1 : 0,
        );
        return size;
    };
    const views = (messages) => messageViews(all, messages, describeImage);
    const messageView = (message) => views([message])[0];
    const emitRoom = (rawRoom, event, data) => {
        const room = canonicalRoom(rawRoom);
        for (const socket of io.sockets.sockets.values()) {
            const user = sessions.userFor(socket.data.token);
            // Each member gets their own view of a poll: results only after voting.
            if (user && hasRoom(user, room)) socket.emit(event, forViewer(data, user.id));
        }
    };
    const context = {
        ...database,
        ...sessions,
        ...access,
        app,
        io,
        hasRoom,
        messageView,
        messageViews: views,
        emitRoom,
        maxStoredUploadBytes,
        sessionLifetimeMs,
    };
    const registration = createRegistration({ ...context, setupCode });
    context.registration = registration;
    // Public registration/login must precede the authenticated feature routes.
    const accounts = registerAccounts(context);
    app.use('/api', sessions.auth);
    registration.mount();
    accounts.mount();
    app.post(
        '/api/logout',
        route((req, res) => {
            sessions.revoke(req.headers.authorization.replace(/^Bearer /, ''));
            res.json({ ok: true });
        }),
    );
    const presence = registerPresence(context);
    const calls = registerCalls(context);
    registerVoiceInvitations(context);
    app.get(
        '/api/state',
        route((req, res) => {
            const channels = access.channelsFor(req.user);
            const users = sessions.users();
            const visible = new Set(channels.map((channel) => channel.id));
            res.json({
                me: sessions.publicUser(req.user),
                name: get('SELECT value FROM settings WHERE key=?', 'name').value,
                icon: get("SELECT value FROM settings WHERE key='icon'")?.value || null,
                reactionAuthors:
                    get("SELECT value FROM settings WHERE key='reactionAuthors'")?.value !==
                    'false',
                profileFrames: sessions.profileFramesEnabled(),
                removedUsers:
                    sessions.can(req.user, 'members.ban') ||
                    sessions.can(req.user, 'members.restore') ||
                    sessions.can(req.user, 'members.delete')
                        ? all('SELECT * FROM users WHERE banned=1').map(sessions.publicUser)
                        : [],
                users,
                directMessages: users
                    .filter((user) => user.id !== req.user.id)
                    .flatMap((user) => {
                        const room = canonicalRoom(`dm:${req.user.id}:${user.id}`);
                        const latest = get(
                            'SELECT created AS updated FROM messages WHERE room=? ORDER BY created DESC,id DESC LIMIT 1',
                            room,
                        );
                        if (!latest) return [];
                        const received = get(
                            'SELECT COALESCE(MAX(created),0) received FROM messages WHERE room=? AND author=?',
                            room,
                            user.id,
                        ).received;
                        return [{ room, updated: latest.updated, received }];
                    }),
                presence: presence.snapshot(),
                roles: all("SELECT * FROM roles WHERE id<>'owner' ORDER BY position DESC,id").map(
                    (role) => ({
                        ...role,
                        permissions: JSON.parse(role.permissions),
                    }),
                ),
                channels,
                channelPermissions:
                    sessions.can(req.user, 'roles.manage') ||
                    sessions.can(req.user, 'channels.access')
                        ? all('SELECT * FROM channel_overrides').filter((entry) =>
                              visible.has(entry.channel),
                          )
                        : [],
                online: [
                    ...new Set(
                        [...io.sockets.sockets.values()].map((socket) => socket.data.user.id),
                    ),
                ],
                calls: calls.visibleCalls(req.user.id),
                directCalls: calls.privateState(req.user.id),
                emojis: all('SELECT id,name,author FROM emojis'),
                iceServers,
                identity: publicIdentity(),
            });
        }),
    );
    const polls = registerPolls(context);
    const messages = registerMessages({ ...context, polls });
    registerProfiles(context);
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
    let closing;
    return {
        setupCode: registration.setupCode,
        identity: publicIdentity(),
        app,
        http,
        io,
        db,
        close: () => {
            closing ??= (async () => {
                clearInterval(renewal);
                await messages.close();
                polls.close();
                calls.close();
                sessions.close();
                await io.close();
                db.close();
            })();
            return closing;
        },
    };
}
