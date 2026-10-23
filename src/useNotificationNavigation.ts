import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from './api';
import type { Message, MessageJump, NotificationTarget } from './types';
import { createNotificationNavigation } from './notificationNavigation';

export function useNotificationNavigation(
    api: ApiClient,
    navigate: (room: string, parent: Message | null) => void,
    acknowledge: (message: Message) => Promise<void>,
    acknowledgeVisible: (
        room: string,
        messages: string[],
        signal: AbortSignal,
    ) => Promise<string[]>,
    fail: (error: Error) => void,
) {
    const [jump, setJump] = useState<(NotificationTarget & { request: number }) | null>(null);
    const serial = useRef(0);
    const pending = useRef<{
        request: number;
        target: Message;
        signal: AbortSignal;
        remaining: Set<'message' | 'parent'>;
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
                        pending.current = {
                            request,
                            target: target.message,
                            signal,
                            remaining: new Set(target.parent ? ['message', 'parent'] : ['message']),
                            resolve: () => done(),
                            reject: done,
                        };
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
    // A thread notification is ready only after both its reply and original
    // message are visible, so queued clicks cannot skip the parent's highlight.
    const markShown = useCallback(
        async (request: number, part: 'message' | 'parent', visible: string[]) => {
            const current = pending.current;
            if (current?.request !== request || !current.remaining.has(part)) return [];
            try {
                const matched = await acknowledgeVisible(
                    current.target.room,
                    visible.filter((id) => id !== current.target.id),
                    current.signal,
                );
                if (pending.current !== current) return [];
                current.remaining.delete(part);
                if (!current.remaining.size) current.resolve();
                return matched;
            } catch (error) {
                if (pending.current === current) current.reject(error as Error);
                return [];
            }
        },
        [acknowledgeVisible],
    );
    const shown = useCallback(
        (request: number, visible: string[]) => markShown(request, 'message', visible),
        [markShown],
    );
    const parentShown = useCallback(
        (request: number, visible: string[]) => markShown(request, 'parent', visible),
        [markShown],
    );
    const failed = useCallback((request: number, error: Error) => {
        if (pending.current?.request === request) pending.current.reject(error);
    }, []);
    return {
        jump,
        shown,
        parentShown,
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
        parentJump: jump?.parent
            ? ({ id: jump.parent.id, request: jump.request } satisfies MessageJump)
            : undefined,
        messageJump: jump
            ? ({ id: jump.message.id, request: jump.request } satisfies MessageJump)
            : undefined,
    };
}
