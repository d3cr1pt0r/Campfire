import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Star, X } from 'lucide-react';
import { klipyGifs, type Gif } from './klipy';
import type { GifFavorite } from './types';

export type FavoriteGif = Omit<GifFavorite, 'id'>;
// The member's starred GIFs, shared by the picker and GIF messages in chat. The app
// publishes them here so neither needs a provider around the whole interface.
type Favorites = { favorites: GifFavorite[]; toggle: (gif: FavoriteGif) => void };
let current: Favorites = { favorites: [], toggle: () => {} };
const listeners = new Set<() => void>();
export function publishGifFavorites(next: Favorites) {
    current = next;
    listeners.forEach((listener) => listener());
}
export const useGifFavorites = () =>
    useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => current,
    );

export const favoriteOf = (gif: Gif): FavoriteGif => ({
    url: gif.send.url,
    preview: gif.preview.url,
    width: gif.send.width,
    height: gif.send.height,
    title: gif.title,
});
const fromFavorite = (favorite: GifFavorite): Gif => ({
    id: favorite.id,
    title: favorite.title || 'GIF',
    preview: { url: favorite.preview, width: favorite.width, height: favorite.height },
    send: { url: favorite.url, width: favorite.width, height: favorite.height },
});

type Results = { query: string; gifs: Gif[]; page: number; next: boolean };

export function GifPicker({
    klipyKey,
    onPick,
    onClose,
}: {
    klipyKey: string;
    onPick: (gif: Gif) => void;
    onClose: () => void;
}) {
    const { favorites, toggle } = useGifFavorites();
    const [tab, setTab] = useState<'klipy' | 'favorites'>('klipy');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Results>({ query: '', gifs: [], page: 0, next: false });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const search = useRef<HTMLInputElement>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    const loaded = useRef(results);
    loaded.current = results;
    const wanted = query.trim();
    useEffect(() => search.current?.focus(), []);
    // Typing waits 400 ms before searching, which keeps within KLIPY's hourly limit.
    useEffect(() => {
        if (tab !== 'klipy' || (loaded.current.page && loaded.current.query === wanted)) return;
        const controller = new AbortController();
        const timer = setTimeout(
            () => {
                setLoading(true);
                setError('');
                klipyGifs(klipyKey, wanted, 1, controller.signal)
                    .then(({ gifs, next }) => setResults({ query: wanted, gifs, page: 1, next }))
                    .catch((reason: Error) => {
                        if (!controller.signal.aborted) setError(reason.message);
                    })
                    .finally(() => {
                        if (!controller.signal.aborted) setLoading(false);
                    });
            },
            wanted ? 400 : 0,
        );
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [klipyKey, wanted, tab, attempt]);
    // Scrolling to the end of the results loads KLIPY's next page.
    useEffect(() => {
        const target = sentinel.current;
        if (!target || tab !== 'klipy' || !results.next || loading) return;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            const current = loaded.current;
            setLoading(true);
            klipyGifs(klipyKey, current.query, current.page + 1)
                .then(({ gifs, next }) =>
                    setResults((previous) =>
                        previous.query === current.query
                            ? {
                                  ...previous,
                                  gifs: [...previous.gifs, ...gifs],
                                  page: previous.page + 1,
                                  next,
                              }
                            : previous,
                    ),
                )
                .catch((reason: Error) => setError(reason.message))
                .finally(() => setLoading(false));
        });
        observer.observe(target);
        return () => observer.disconnect();
    }, [klipyKey, results, tab, loading]);
    const gifs =
        tab === 'favorites'
            ? favorites.map(fromFavorite)
            : results.query === wanted
              ? results.gifs
              : [];
    const empty =
        tab === 'favorites'
            ? favorites.length
                ? ''
                : 'Star a GIF to keep it here. Favourites follow your account to every device.'
            : !loading && !error && results.query === wanted && results.page && !results.gifs.length
              ? `No GIFs found for “${wanted}”.`
              : '';
    return (
        <div
            className="gif-picker"
            role="dialog"
            aria-label="Choose a GIF"
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }}
        >
            <div className="gif-picker-head">
                <input
                    ref={search}
                    id="gif-search"
                    type="search"
                    aria-label="Search GIFs"
                    placeholder="Search KLIPY"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setTab('klipy');
                    }}
                />
                <button
                    type="button"
                    className="gif-close"
                    aria-label="Close GIF picker"
                    onClick={onClose}
                >
                    <X size={17} />
                </button>
            </div>
            <div className="gif-tabs" role="tablist" aria-label="GIF sources">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'klipy'}
                    onClick={() => setTab('klipy')}
                >
                    {wanted ? 'Results' : 'Trending'}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'favorites'}
                    onClick={() => setTab('favorites')}
                >
                    Favourites{favorites.length ? ` ${favorites.length}` : ''}
                </button>
            </div>
            <div className="gif-results" role="tabpanel" aria-busy={loading}>
                {error && tab === 'klipy' ? (
                    <div className="gif-message" role="status">
                        {error}
                        <button type="button" onClick={() => setAttempt((count) => count + 1)}>
                            Try again
                        </button>
                    </div>
                ) : empty ? (
                    <p className="gif-message">{empty}</p>
                ) : null}
                <div className="gif-grid">
                    {gifs.map((gif) => {
                        const ratio = gif.send.width / gif.send.height;
                        const starred = favorites.some((favorite) => favorite.url === gif.send.url);
                        return (
                            <div
                                className="gif-tile"
                                key={`${gif.id}:${gif.send.url}`}
                                style={{ flexGrow: ratio, flexBasis: `${ratio * 96}px` }}
                            >
                                <button
                                    type="button"
                                    className="gif-choose"
                                    title={gif.title}
                                    aria-label={`Send GIF: ${gif.title}`}
                                    onClick={() => onPick(gif)}
                                >
                                    <img
                                        src={gif.preview.url}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                    />
                                </button>
                                <button
                                    type="button"
                                    className="gif-star"
                                    aria-pressed={starred}
                                    title={starred ? 'Remove from favourites' : 'Add to favourites'}
                                    aria-label={`${starred ? 'Remove from' : 'Add to'} favourites: ${gif.title}`}
                                    onClick={() => toggle(favoriteOf(gif))}
                                >
                                    <Star size={14} />
                                </button>
                            </div>
                        );
                    })}
                </div>
                {tab === 'klipy' && results.next && results.query === wanted && (
                    <div ref={sentinel} className="gif-more" aria-hidden="true" />
                )}
                {loading && <p className="gif-message">Loading GIFs…</p>}
            </div>
            <div className="gif-attribution">Powered by KLIPY</div>
        </div>
    );
}
