import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ActivitySnapshot, AppSocket } from './types';
import type { ApiClient } from './api';
import { createActivityClient } from './activity';

export function useUnread(
    api: ApiClient,
    socket: AppSocket | null,
    initial: ActivitySnapshot | undefined,
    fail: (error: Error) => void,
) {
    const client = useMemo(() => createActivityClient(api, fail), [api, fail]);
    const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
    useEffect(() => {
        if (initial) client.receive(initial);
    }, [client, initial]);
    useEffect(() => {
        socket?.on('activity', client.receive);
        return () => {
            socket?.off('activity', client.receive);
            client.cancel();
        };
    }, [client, socket]);
    return {
        unread: snapshot.unread,
        latest: snapshot.latest,
        acknowledge: client.acknowledge,
        dismissUnread: client.dismiss,
    };
}
