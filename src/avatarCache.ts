// Avatar IDs change on upload. Persist their bytes without expiry; limit only
// unused decoded object URLs so a long session doesn't retain every bitmap.
type Entry = { source: string; pending?: Promise<void>; listeners: Set<() => void> };
type Store = {
    read(key: string): Promise<Blob | undefined>;
    write(key: string, blob: Blob): Promise<void>;
};

export function createAvatarCache(
    store: Store,
    decode: (source: string) => Promise<void>,
    limit = 128,
) {
    const entries = new Map<string, Entry>();
    const prune = () => {
        for (const [key, entry] of entries) {
            if (entries.size <= limit) break;
            if (!entry.listeners.size && !entry.pending) {
                if (entry.source) URL.revokeObjectURL(entry.source);
                entries.delete(key);
            }
        }
    };
    return {
        source(key: string) {
            return entries.get(key)?.source || '';
        },
        subscribe(key: string, fetchImage: () => Promise<Blob>, notify: () => void) {
            let entry = entries.get(key);
            if (!entry) {
                entry = { source: '', listeners: new Set() };
                entries.set(key, entry);
            }
            const current = entry;
            entries.delete(key);
            entries.set(key, current);
            current.listeners.add(notify);
            if (!current.source && !current.pending) {
                current.pending = (async () => {
                    let blob = await store.read(key).catch(() => undefined);
                    let persisted = !!blob;
                    for (;;) {
                        if (!blob) blob = await fetchImage();
                        if (blob.type !== 'image/png') throw Error('Avatar unavailable');
                        const source = URL.createObjectURL(blob);
                        try {
                            await decode(source);
                        } catch (error) {
                            URL.revokeObjectURL(source);
                            // Repair a corrupt local entry once.
                            if (persisted) {
                                persisted = false;
                                blob = undefined;
                                continue;
                            }
                            throw error;
                        }
                        if (!persisted) await store.write(key, blob).catch(() => {});
                        current.source = source;
                        break;
                    }
                })()
                    .catch(() => {
                        // Don't cache failures: a later mount can retry.
                    })
                    .finally(() => {
                        current.pending = undefined;
                        for (const listener of current.listeners) listener();
                        prune();
                    });
            }
            return () => {
                current.listeners.delete(notify);
                prune();
            };
        },
    };
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
    return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('campfire-avatars', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('avatars');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            database = undefined;
            reject(request.error);
        };
    }));
}
export const avatarStore: Store = {
    async read(key) {
        if (window.campfire?.avatars) {
            const bytes = await window.campfire.avatars.read(key);
            return bytes ? new Blob([new Uint8Array(bytes)], { type: 'image/png' }) : undefined;
        }
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const request = db.transaction('avatars').objectStore('avatars').get(key);
            request.onsuccess = () =>
                resolve(request.result instanceof Blob ? request.result : undefined);
            request.onerror = () => reject(request.error);
        });
    },
    async write(key, blob) {
        if (window.campfire?.avatars) {
            await window.campfire.avatars.write(key, new Uint8Array(await blob.arrayBuffer()));
            return;
        }
        const db = await openDatabase();
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction('avatars', 'readwrite');
            transaction.objectStore('avatars').put(blob, key);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    },
};
