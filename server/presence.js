import { route, check } from './policies.js';

export function registerPresence({ app, io, get, run }) {
    const snapshot = () => {
        const devices = new Map();
        for (const socket of io.sockets.sockets.values()) {
            const id = socket.data.user.id;
            devices.set(id, !!devices.get(id) || !socket.data.idle);
        }
        return Object.fromEntries(
            [...devices].map(([id, active]) => {
                const manual =
                    get('SELECT status FROM presence_preferences WHERE user=?', id)?.status ||
                    'online';
                return [id, manual === 'online' && !active ? 'idle' : manual];
            }),
        );
    };
    const publish = () => io.emit('presence', snapshot());
    app.patch(
        '/api/presence',
        route((req, res) => {
            const status = req.body?.status;
            check(['online', 'idle', 'dnd'].includes(status), 'Invalid status');
            run(
                'INSERT INTO presence_preferences(user,status) VALUES(?,?) ON CONFLICT(user) DO UPDATE SET status=excluded.status',
                req.user.id,
                status,
            );
            publish();
            io.emit('refresh');
            res.json({ ok: true });
        }),
    );
    io.on('connection', (socket) => {
        socket.data.idle = false;
        publish();
        socket.on('presence:idle', (idle) => {
            if (typeof idle !== 'boolean' || socket.data.idle === idle) return;
            socket.data.idle = idle;
            publish();
        });
        socket.on('disconnect', publish);
    });
    return { snapshot };
}
