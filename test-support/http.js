import { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
// A message with files, as the apps send it: text fields plus one "file" part per file.
export function messageForm(fields, files = []) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value != null) form.set(key, value);
    for (const { name, data } of files) form.append('file', new Blob([data]), name);
    return form;
}
export async function request(app, endpoint, token, method = 'GET', body, headers = {}) {
    let raw = null,
        type = 'application/json';
    if (body instanceof FormData) {
        const encoded = new Response(body);
        type = encoded.headers.get('content-type');
        raw = Buffer.from(await encoded.arrayBuffer());
    } else if (body !== undefined) raw = Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
        const socket = new PassThrough();
        socket.remoteAddress = '127.0.0.1';
        const req = new IncomingMessage(socket);
        req.method = method;
        req.url = '/api' + endpoint;
        req.headers = {
            host: 'localhost',
            ...headers,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(raw ? { 'content-type': type, 'content-length': String(raw.length) } : {}),
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
        app.handle(req, res, (error) => {
            if (error) reject(error);
            else {
                res.statusCode = 404;
                res.end();
            }
        });
        if (raw) req.push(raw);
        req.push(null);
    });
}
