import type { NotificationTarget } from './types';
import type { ApiClient } from './api';

// Queue repeated clicks locally; acknowledge only after the selected message was shown.
export function createNotificationNavigation(
    api: ApiClient,
    display: (target: NotificationTarget, signal: AbortSignal) => Promise<void>,
    acknowledge: (message: NotificationTarget['message']) => Promise<void>,
    empty: (room: string) => void,
    fail: (error: Error) => void,
) {
    let room: string | null = null;
    let controller = new AbortController();
    let tail = Promise.resolve();
    const cancel = () => {
        controller.abort();
        controller = new AbortController();
        tail = Promise.resolve();
        room = null;
    };
    return {
        cancel,
        open(destination: string) {
            if (room !== destination) {
                cancel();
                room = destination;
            }
            const current = controller;
            tail = tail.then(async () => {
                if (current.signal.aborted) return;
                try {
                    const target = await api<NotificationTarget | null>(
                        `/activity/next?${new URLSearchParams({ room: destination })}`,
                        'GET',
                        undefined,
                        current.signal,
                    );
                    if (current.signal.aborted) return;
                    if (!target) {
                        empty(destination);
                        return;
                    }
                    await display(target, current.signal);
                    if (!current.signal.aborted) await acknowledge(target.message);
                } catch (error) {
                    if (!current.signal.aborted) fail(error as Error);
                }
            });
            return tail;
        },
    };
}
