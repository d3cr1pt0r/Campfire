import { useCallback, useSyncExternalStore } from 'react';
import { createApiClient } from './api';
import { avatarStore, createAvatarCache } from './avatarCache';

const avatars = createAvatarCache(avatarStore, async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
});

export function useAvatarImage(url: string, token: string, account: string, path: string | null) {
    const key = JSON.stringify([url.replace(/\/$/, ''), account, path]);
    const subscribe = useCallback(
        (notify: () => void) => {
            if (!path || !account) return () => {};
            return avatars.subscribe(key, () => createApiClient(url, token).blob(path), notify);
        },
        [key, url, token, account, path],
    );
    const snapshot = useCallback(
        () => (path && account ? avatars.source(key) : ''),
        [key, path, account],
    );
    return useSyncExternalStore(subscribe, snapshot);
}
