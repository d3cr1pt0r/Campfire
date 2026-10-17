export type ApiClient = <T = unknown>(
    path: string,
    method?: string,
    body?: unknown,
    signal?: AbortSignal,
) => Promise<T>;

export function createApiClient(url: string, token: string, transport: typeof fetch = fetch) {
    const request = async (path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => {
        const response = await transport(`${url.replace(/\/$/, '')}/api${path}`, {
            method,
            signal,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
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
