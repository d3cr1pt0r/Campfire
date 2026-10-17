import { useEffect } from 'react';
import type { AppSocket, Preferences } from './types';
import { idleDelay, shouldIdle } from './presence';

export function usePresence(socket: AppSocket | null, prefs: Preferences) {
    useEffect(() => {
        let disposed = false;
        let lastActivity = Date.now();
        let lastSent: boolean | undefined;
        let polling = false;
        const send = (value: boolean) => {
            if (socket?.connected && value !== lastSent) {
                socket.emit('presence:idle', value);
                lastSent = value;
            }
        };
        const poll = async () => {
            if (polling) return;
            polling = true;
            const activityAtStart = lastActivity;
            try {
                const system = prefs.autoIdle
                    ? await window.driskord?.getIdleState?.().catch(() => null)
                    : null;
                if (!disposed && lastActivity === activityAtStart)
                    send(
                        shouldIdle(
                            !!prefs.autoIdle,
                            idleDelay(prefs.idleMinutes),
                            system?.seconds ?? (Date.now() - lastActivity) / 1000,
                            system?.locked,
                        ),
                    );
            } finally {
                polling = false;
            }
        };
        const activity = () => {
            lastActivity = Date.now();
            // Input within this app is always evidence of activity, including on platforms
            // where the desktop idle API is unavailable.
            send(false);
        };
        const reconnect = () => {
            lastSent = undefined;
            void poll();
        };
        const check = () => void poll();
        const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
        events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
        socket?.on('connect', reconnect);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);
        const timer = window.setInterval(() => void poll(), 5000);
        void poll();
        return () => {
            disposed = true;
            window.clearInterval(timer);
            events.forEach((event) => window.removeEventListener(event, activity));
            socket?.off('connect', reconnect);
            window.removeEventListener('focus', check);
            document.removeEventListener('visibilitychange', check);
        };
    }, [socket, prefs.autoIdle, prefs.idleMinutes]);
}
