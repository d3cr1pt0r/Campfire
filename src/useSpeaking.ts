import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { createMicrophoneMonitor } from './microphoneMonitor';
export function useSpeaking(socket: Socket | null, microphone: MediaStream | null, localUser: string, channel: string | null) {
    const [speaking, setSpeaking] = useState<Set<string>>(new Set());
    useEffect(() => {
        setSpeaking(new Set());
        if (!socket || !microphone || !channel) return;
        const activity = new Map<string,number>();
        let localUntil = 0, localActive = false, previous = false, lastSent = 0;
        // Detect the raw microphone, before mixing program audio. The server
        // scopes these small activity hints to current call participants.
        let monitor: ReturnType<typeof createMicrophoneMonitor>;
        try { monitor = createMicrophoneMonitor({
            preferences: {input:'',noise:false}, activeStream: microphone,
            onReading: reading => {
                if (reading.muted || reading.paused) localUntil = 0;
                else if (reading.detected) localUntil = performance.now() + 250;
            },
            onFallback: () => {}, onError: () => { localUntil = 0; },
        }); } catch { return; }
        const received = ({user,active}: {user:string;active:boolean}) => {
            if (active) activity.set(user,performance.now()+2500); else activity.delete(user);
        };
        socket.on('call:speaking',received);
        const timer = setInterval(() => {
            const now = performance.now(); localActive = localUntil > now;
            if (localActive !== previous || (localActive && now-lastSent > 1000)) {
                socket.emit('call:speaking',localActive); previous=localActive; lastSent=now;
            }
            if (localActive) activity.set(localUser,now+250); else activity.delete(localUser);
            for (const [user,until] of activity) if (until<now) activity.delete(user);
            const next = new Set(activity.keys());
            setSpeaking(current => current.size===next.size && [...current].every(id=>next.has(id)) ? current : next);
        },100);
        const resume = () => { void monitor.resume().catch(()=>{}); };
        window.addEventListener('pointerdown',resume);
        return () => {
            clearInterval(timer); window.removeEventListener('pointerdown',resume);
            socket.off('call:speaking',received); socket.emit('call:speaking',false); monitor.stop();
        };
    }, [socket,microphone,localUser,channel]);
    return speaking;
}
