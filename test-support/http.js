import { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
export function request(app, endpoint, token, method = 'GET', body, headers = {}) {
    return new Promise((resolve, reject) => {
        const socket = new PassThrough();
        socket.remoteAddress = '127.0.0.1';
        const req = new IncomingMessage(socket);
        req.method = method;
        req.url = '/api' + endpoint;
        const raw = body === undefined ? null : Buffer.from(JSON.stringify(body));
        req.headers = {
            host: 'localhost',
            ...headers,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(raw
                ? { 'content-type': 'application/json', 'content-length': String(raw.length) }
                : {}),
        };
        const res = new ServerResponse(req);
        const chunks = [];
        res.write = (chunk) => {
            chunks.push(Buffer.from(chunk));
            return true;
        };
        res.end = (chunk) => {
            if (chunk) chunks.push(Buffer.from(chunk));
            const buffer = Buffer.concat(chunks);
            let data;
            try {
                data = JSON.parse(buffer.toString());
            } catch {
                data = buffer;
            }
            resolve({ status: res.statusCode, data, headers: res.getHeaders() });
            return res;
        };
        app.handle(req, res, reject);
        if (raw) req.push(raw);
        req.push(null);
    });
}
