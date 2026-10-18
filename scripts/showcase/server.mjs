import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import sharp from 'sharp';
import { avatarSources, messages, replies, scenario, sharedFrame, state } from './fixture.mjs';

export async function createShowcaseServer(root, cacheDir) {
    const parent = messages.find((message) => message.id === scenario.thread);
    if (
        !parent ||
        parent.replyCount !== replies.filter((reply) => reply.thread === parent.id).length
    )
        throw new Error('Showcase thread and reply count must match the fixture replies.');
    const people = new Set(state.users.map((user) => user.id));
    if ([...messages, ...replies].some((message) => !people.has(message.author)))
        throw new Error('Every showcase message must have a fixture author.');
    const client = fileURLToPath(new URL('./client.mjs', import.meta.url));
    const assets = new Map(
        await Promise.all([
            ...Object.entries(avatarSources).map(async ([id, svg]) => [
                `/api/avatars/${id}`,
                await sharp(Buffer.from(svg)).png().toBuffer(),
            ]),
            sharp(Buffer.from(sharedFrame))
                .png()
                .toBuffer()
                .then((image) => ['/api/showcase/frame', image]),
        ]),
    );
    const server = await createServer({
        root,
        cacheDir,
        configFile: false,
        envDir: false,
        server: { host: '127.0.0.1', port: 0, strictPort: true },
        plugins: [
            {
                name: 'campfire-readme-showcase',
                enforce: 'pre',
                resolveId(source, importer) {
                    if (!importer?.replaceAll('\\', '/').endsWith('/src/main.tsx')) return;
                    if (['socket.io-client', './useCall', './useSpeaking'].includes(source))
                        return client;
                },
                transformIndexHtml(html) {
                    return html.replace(
                        '<head>',
                        `<head><script>
                            localStorage.clear();
                            localStorage.setItem('connection', JSON.stringify({url:location.origin,token:'showcase-sample'}));
                            localStorage.setItem('preferences', JSON.stringify({theme:'dark',autoIdle:false,notifications:false,messageSounds:false,sounds:false}));
                        </script>`,
                    );
                },
                configureServer(vite) {
                    vite.middlewares.use((request, response, next) => {
                        const url = new URL(request.url, 'http://showcase.local');
                        if (!url.pathname.startsWith('/api/')) return next();
                        if (request.method !== 'GET') {
                            response.writeHead(405, { 'Content-Type': 'application/json' });
                            response.end(JSON.stringify({ error: 'Showcase data is read-only.' }));
                            return;
                        }
                        const asset = assets.get(url.pathname);
                        if (asset) {
                            response.writeHead(200, { 'Content-Type': 'image/png' });
                            response.end(asset);
                            return;
                        }
                        let data;
                        if (url.pathname === '/api/state') data = state;
                        else if (url.pathname === '/api/info')
                            data = { registrationMode: 'invite', setupRequired: false };
                        else if (url.pathname === '/api/messages') {
                            const thread = url.searchParams.get('thread');
                            const source = thread ? replies : messages;
                            data = {
                                messages: source.filter(
                                    (message) =>
                                        message.room === url.searchParams.get('room') &&
                                        (!thread || message.thread === thread) &&
                                        (!url.searchParams.has('pinned') || message.pinned) &&
                                        (!url.searchParams.get('search') ||
                                            message.body
                                                .toLowerCase()
                                                .includes(
                                                    url.searchParams.get('search').toLowerCase(),
                                                )),
                                ),
                                next: null,
                            };
                        } else if (url.pathname.startsWith('/api/messages/'))
                            data = [...messages, ...replies].find(
                                (message) => message.id === url.pathname.split('/').at(-1),
                            );
                        response.writeHead(data ? 200 : 404, {
                            'Content-Type': 'application/json',
                        });
                        response.end(
                            JSON.stringify(data || { error: 'Unknown showcase resource.' }),
                        );
                    });
                },
            },
            react(),
        ],
    });
    return server;
}
