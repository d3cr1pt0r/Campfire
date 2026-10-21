export type ApiClient = <T = unknown>(
    path: string,
    method?: string,
    body?: unknown,
    signal?: AbortSignal,
) => Promise<T>;

// Files go as multipart form data with their raw bytes; everything else as JSON.
export function messagePayload(
    fields: { room: string; body: string; thread?: string },
    files: File[],
) {
    if (!files.length) return fields;
    const form = new FormData();
    for (const [key, value] of Object.entries(fields))
        if (value !== undefined) form.set(key, value);
    for (const file of files) form.append('file', file, file.name);
    return form;
}

export function createApiClient(url: string, token: string, transport: typeof fetch = fetch) {
    const request = async (path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => {
        // The browser sets a form's content type itself, with its boundary.
        const form = body instanceof FormData;
        const response = await transport(`${url.replace(/\/$/, '')}/api${path}`, {
            method,
            signal,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), {
                status: response.status,
            });
        }
        return response;
    };
    const json: ApiClient = async (path, method, body, signal) =>
        (await request(path, method, body, signal)).json();
    return {
        json,
        blob: async (path: string, signal?: AbortSignal) =>
            (await request(path, 'GET', undefined, signal)).blob(),
    };
}
