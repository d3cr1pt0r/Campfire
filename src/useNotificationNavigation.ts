import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from './api';
import type { Message, MessageJump, NotificationTarget } from './types';
import { createNotificationNavigation } from './notificationNavigation';

export function useNotificationNavigation(
    api: ApiClient,
    navigate: (room: string, parent: Message | null) => void,
    acknowledge: (message: Message) => Promise<void>,
    fail: (error: Error) => void,
) {
    const [jump, setJump] = useState<(NotificationTarget & { request: number }) | null>(null);
    const serial = useRef(0);
    const pending = useRef<{
        request: number;
        resolve: () => void;
        reject: (error: Error) => void;
    } | null>(null);
    const navigation = useMemo(
        () =>
            createNotificationNavigation(
                api,
                (target, signal) =>
                    new Promise<void>((resolve, reject) => {
                        const request = ++serial.current;
                        const abort = () => {
                            if (pending.current?.request === request) pending.current = null;
                            reject(new DOMException('Navigation cancelled', 'AbortError'));
                        };
                        signal.addEventListener('abort', abort, { once: true });
                        const done = (error?: Error) => {
                            signal.removeEventListener('abort', abort);
                            if (pending.current?.request === request) pending.current = null;
                            if (error) reject(error);
                            else resolve();
                        };
                        pending.current = { request, resolve: () => done(), reject: done };
                        navigate(target.message.room, target.parent);
                        setJump({ ...target, request });
                    }),
                acknowledge,
                (room) => {
                    navigate(room, null);
                    setJump(null);
                },
                fail,
            ),
        [api, navigate, acknowledge, fail],
    );
    useEffect(() => {
        setJump(null);
        return () => {
            navigation.cancel();
        };
    }, [navigation]);
    const shown = useCallback((request: number) => {
        if (pending.current?.request === request) pending.current.resolve();
    }, []);
    const failed = useCallback((request: number, error: Error) => {
        if (pending.current?.request === request) pending.current.reject(error);
    }, []);
    return {
        jump,
        shown,
        failed,
        cancel: navigation.cancel,
        open: (room: string, unread: boolean) => {
            if (unread) void navigation.open(room);
            else {
                navigation.cancel();
                setJump(null);
                navigate(room, null);
            }
        },
        messageJump: jump
            ? ({ id: jump.message.id, request: jump.request } satisfies MessageJump)
            : undefined,
    };
}
