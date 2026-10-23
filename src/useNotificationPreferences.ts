import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AppSocket, NotificationPreferences, Preferences, State } from './types';
import type { ApiClient } from './api';
import { notificationPreferences, withNotificationPreferences } from './notificationPreferences';

export function useNotificationPreferences(
    api: ApiClient,
    socket: AppSocket | null,
    state: State | null,
    setState: Dispatch<SetStateAction<State | null>>,
    local: Preferences,
    setLocal: Dispatch<SetStateAction<Preferences>>,
    server: string,
    fail: (error: Error) => void,
) {
    const user = state?.me.id ?? '';
    const prefs = useMemo(
        () => withNotificationPreferences(local, state?.notificationPreferences, server, user),
        [local, state?.notificationPreferences, server, user],
    );
    const latest = useRef(prefs);
    latest.current = prefs;
    const connection = useRef(api);
    connection.current = api;
    const queue = useMemo(() => ({ tail: Promise.resolve(), revision: 0, pending: 0 }), [api]);
    useEffect(() => {
        const receive = (value: NotificationPreferences) => {
            if (queue.pending) return;
            setState((previous) =>
                previous?.me.id === user
                    ? { ...previous, notificationPreferences: value }
                    : previous,
            );
            // Keep a local copy for quick startup and legacy import, including per-server DM rules.
            setLocal((previous) => withNotificationPreferences(previous, value, server, user));
        };
        socket?.on('notification-preferences', receive);
        return () => {
            socket?.off('notification-preferences', receive);
        };
    }, [socket, user, server, setState, setLocal, queue]);
    useEffect(() => {
        if (!user || state?.notificationPreferences !== null) return;
        let active = true;
        void api<NotificationPreferences>(
            '/notification-preferences/import',
            'POST',
            notificationPreferences(latest.current, server, user),
        )
            .then((value) => {
                if (active) {
                    setState((previous) =>
                        previous?.me.id === user
                            ? { ...previous, notificationPreferences: value }
                            : previous,
                    );
                    setLocal((previous) =>
                        withNotificationPreferences(previous, value, server, user),
                    );
                }
            })
            .catch((error: Error) => {
                if (active) fail(error);
            });
        return () => {
            active = false;
        };
    }, [api, user, state?.notificationPreferences, server, setState, setLocal, fail]);
    const setPrefs: Dispatch<SetStateAction<Preferences>> = (update) => {
        const previous = latest.current;
        const next = typeof update === 'function' ? update(previous) : update;
        latest.current = next;
        setLocal(next);
        if (!user || state?.notificationPreferences === undefined) return;
        const before = notificationPreferences(previous, server, user);
        const after = notificationPreferences(next, server, user);
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        const revision = ++queue.revision;
        queue.pending++;
        setState((current) =>
            current?.me.id === user ? { ...current, notificationPreferences: after } : current,
        );
        queue.tail = queue.tail.then(async () => {
            if (connection.current !== api) {
                queue.pending--;
                return;
            }
            try {
                const saved = await api<NotificationPreferences>(
                    '/notification-preferences',
                    'PUT',
                    after,
                );
                if (connection.current === api && revision === queue.revision) {
                    setState((current) =>
                        current?.me.id === user
                            ? { ...current, notificationPreferences: saved }
                            : current,
                    );
                    setLocal((current) =>
                        withNotificationPreferences(current, saved, server, user),
                    );
                }
            } catch (error) {
                if (connection.current !== api) return;
                fail(error as Error);
                if (revision === queue.revision) {
                    const saved = await api<NotificationPreferences | null>(
                        '/notification-preferences',
                    ).catch(() => null);
                    if (connection.current === api)
                        setState((current) =>
                            current?.me.id === user
                                ? { ...current, notificationPreferences: saved }
                                : current,
                        );
                }
            } finally {
                queue.pending--;
            }
        });
    };
    return { prefs, setPrefs };
}
