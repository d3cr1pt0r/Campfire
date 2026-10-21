import { isKlipyMedia } from '../shared/klipy.js';

// KLIPY's standard integration: the member's app calls KLIPY and loads its media
// directly, using the URLs exactly as returned and keeping results in KLIPY's order.

type Rendition = { url: string; width: number; height: number };
type Item = {
    id: number | string;
    title?: string;
    type?: string;
    file?: Record<string, Record<string, Rendition | undefined> | undefined>;
};
export type Gif = {
    id: string;
    title: string;
    // A small animated preview for the picker, and the larger version that is sent.
    preview: Rendition;
    send: Rendition;
};

const rendition = (item: Item, sizes: string[], formats: string[]) => {
    for (const size of sizes)
        for (const format of formats) {
            const media = item.file?.[size]?.[format];
            if (media && isKlipyMedia(media.url) && media.width > 0 && media.height > 0)
                return media;
        }
    return null;
};

export function klipyGif(item: Item): Gif | null {
    const send = rendition(item, ['hd', 'md'], ['webp', 'gif']);
    const preview = rendition(item, ['sm', 'xs', 'md'], ['webp', 'gif']);
    if (!send || !preview) return null;
    return { id: String(item.id), title: item.title || 'GIF', preview, send };
}

// Trending when the query is empty, otherwise search. Pages hold up to 24 GIFs.
export async function klipyGifs(
    key: string,
    query: string,
    page: number,
    signal?: AbortSignal,
    transport: typeof fetch = fetch,
) {
    const params = new URLSearchParams({ page: String(page), per_page: '24' });
    if (query.trim()) params.set('q', query.trim());
    const response = await transport(
        `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${query.trim() ? 'search' : 'trending'}?${params}`,
        { signal },
    );
    if (response.status === 429)
        throw new Error('GIF search has reached its hourly limit. Try again later.');
    if (!response.ok) throw new Error('GIF search is unavailable right now. Try again later.');
    const body = (await response.json()) as {
        data?: { data?: Item[]; has_next?: boolean };
    };
    return {
        gifs: (body.data?.data || []).map(klipyGif).filter((gif): gif is Gif => !!gif),
        next: !!body.data?.has_next,
    };
}

// A message whose whole text is one KLIPY media link is shown as that GIF.
export function klipyGifMessage(body: string) {
    const text = body.trim();
    return !/\s/.test(text) && isKlipyMedia(text) ? text : null;
}
