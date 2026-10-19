const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const CSP =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

// UI asset host only: community APIs run on the separately hosted server.
function createRendererServer(distDirectory) {
    const server = createServer(async (req, res) => {
        res.setHeader('Content-Security-Policy', CSP);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers.host !== `127.0.0.1:${server.address().port}`) {
            res.writeHead(403).end();
            return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        try {
            const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const asset = requested === '/' ? 'index.html' : requested.slice(1);
            const file = path.resolve(distDirectory, asset);
            const relative = path.relative(distDirectory, file);
            if (
                relative.startsWith('..') ||
                path.isAbsolute(relative) ||
                !mime[path.extname(file)]
            ) {
                res.writeHead(404).end();
                return;
            }
            const contents = await readFile(file);
            res.writeHead(200, { 'Content-Type': mime[path.extname(file)] });
            res.end(req.method === 'HEAD' ? undefined : contents);
        } catch {
            res.writeHead(404).end();
        }
    });
    return server;
}
async function listenRendererServer(server, preferredPort = 0) {
    const listen = (port) =>
        new Promise((resolve, reject) => {
            const failed = (error) => {
                server.off('listening', ready);
                reject(error);
            };
            const ready = () => {
                server.off('error', failed);
                resolve();
            };
            server.once('error', failed);
            server.once('listening', ready);
            server.listen(port, '127.0.0.1');
        });
    const port =
        Number.isInteger(preferredPort) && preferredPort >= 1024 && preferredPort <= 65535
            ? preferredPort
            : 0;
    try {
        await listen(port);
    } catch (error) {
        if (port && error.code === 'EADDRINUSE') await listen(0);
        else throw error;
    }
    return server.address().port;
}
module.exports = { createRendererServer, listenRendererServer };
