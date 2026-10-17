import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { rememberedDevice } from './devices';
import { playbackError, selectAudioOutput } from './playback';
export type AudioPlaybackHandle = { play: () => Promise<void> };
export const AudioPlayback = forwardRef<
    AudioPlaybackHandle,
    {
        stream: MediaStream | null;
        muted: boolean;
        volume: number;
        output: string;
        outputLabel: string;
        label: string;
        onError: (error: string) => void;
        onOutputFallback?: () => void;
    }
>(function AudioPlayback(
    { stream, muted, volume, output, outputLabel, label, onError, onOutputFallback },
    ref,
) {
    const element = useRef<HTMLAudioElement>(null),
        version = useRef(0),
        queue = useRef(Promise.resolve());
    const callbacks = useRef({ onError, onOutputFallback });
    callbacks.current = { onError, onOutputFallback };
    const track = stream?.getAudioTracks()[0];
    const [error, setError] = useState(''),
        [notice, setNotice] = useState('');
    const play = useCallback(async () => {
        const audio = element.current;
        if (!audio || !(audio.srcObject as MediaStream | null)?.getAudioTracks().length) return;
        const attempt = ++version.current,
            source = audio.srcObject;
        try {
            await audio.play();
            if (attempt === version.current && source === audio.srcObject) {
                setError('');
                callbacks.current.onError('');
            }
        } catch (reason) {
            if (attempt === version.current && source === audio.srcObject) {
                const text = playbackError(reason);
                setError(text);
                callbacks.current.onError(text);
            }
        }
    }, []);
    useImperativeHandle(ref, () => ({ play }), [play]);
    useEffect(() => {
        const audio = element.current;
        if (!audio) return;
        audio.srcObject = stream;
        const update = () => {
            void play();
        };
        const observed = new Set<MediaStreamTrack>();
        const sync = () => {
            stream?.getTracks().forEach((track) => {
                if (!observed.has(track)) {
                    observed.add(track);
                    track.addEventListener('unmute', update);
                }
            });
            if (stream?.getAudioTracks().length) update();
            else {
                setError('');
                callbacks.current.onError('');
            }
        };
        stream?.addEventListener('addtrack', sync);
        stream?.addEventListener('removetrack', sync);
        sync();
        return () => {
            version.current++;
            stream?.removeEventListener('addtrack', sync);
            stream?.removeEventListener('removetrack', sync);
            observed.forEach((track) => track.removeEventListener('unmute', update));
            audio.pause();
            audio.srcObject = null;
        };
    }, [stream, track, play]);
    useEffect(() => {
        if (element.current) element.current.volume = volume;
    }, [volume]);
    useEffect(() => {
        if (!track) {
            setNotice('');
            return;
        }
        let cancelled = false;
        queue.current = queue.current
            .catch(() => {})
            .then(async () => {
                const audio = element.current;
                if (cancelled || !audio) return;
                try {
                    const devices = output ? await navigator.mediaDevices.enumerateDevices() : [];
                    if (cancelled) return;
                    const reset = await selectAudioOutput(
                        audio,
                        rememberedDevice(devices, 'audiooutput', output, outputLabel),
                    );
                    if (cancelled) return;
                    setNotice(reset ? 'Saved output unavailable; using System default.' : '');
                    if (reset) callbacks.current.onOutputFallback?.();
                } catch (reason) {
                    if (!cancelled)
                        setNotice(
                            `Cannot select ${label.toLowerCase()} output [${(reason as Error).name || 'Error'}]. Choose System default in Settings → Voice & video.`,
                        );
                }
            });
        return () => {
            cancelled = true;
        };
    }, [output, outputLabel, label, track]);
    return (
        <>
            <audio ref={element} autoPlay muted={muted} />
            {(error || notice) && (
                <div className="audio-notice" role="status">
                    <span>
                        {label}: {error || notice}
                    </span>
                    {error && (
                        <button type="button" onClick={() => void play()}>
                            Play audio
                        </button>
                    )}
                </div>
            )}
        </>
    );
});
