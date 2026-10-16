import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, X } from 'lucide-react';

export function ExpandedVideo({ stream, name, preview, volume, onVolume, audioError, onPlayAudio, onClose }: {
    stream: MediaStream | null;
    name: string;
    preview: boolean;
    volume: number;
    onVolume: (volume: number) => void;
    audioError: string;
    onPlayAudio: () => void;
    onClose: () => void;
}) {
    const container = useRef<HTMLElement>(null), video = useRef<HTMLVideoElement>(null), close = useRef<HTMLButtonElement>(null);
    const closeAction = useRef(onClose); closeAction.current = onClose;
    const [fullscreen, setFullscreen] = useState(false), [error, setError] = useState(''), [fullscreenNotice, setFullscreenNotice] = useState('');
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        let active = true;
        element.srcObject = stream;
        void element.play().then(() => { if (active) setError(''); }).catch(reason => {
            if (active) setError(`Video playback failed${reason.name ? ` [${reason.name}]` : ''}. Use Retry video.`);
        });
        return () => { active = false; element.pause(); element.srcObject = null; };
    }, [stream]);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const viewer = container.current;
        close.current?.focus({ preventScroll: true });
        const updateFullscreen = () => setFullscreen(document.fullscreenElement === viewer);
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopImmediatePropagation();
                if (document.fullscreenElement === viewer) void document.exitFullscreen().catch(() => {});
                else closeAction.current();
            }
            if (event.key === 'Tab') {
                const elements = [...viewer?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || []];
                const first = elements[0], last = elements[elements.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        };
        document.addEventListener('fullscreenchange', updateFullscreen);
        document.addEventListener('keydown', key, true);
        return () => {
            document.removeEventListener('fullscreenchange', updateFullscreen);
            document.removeEventListener('keydown', key, true);
            if (document.fullscreenElement === viewer) void document.exitFullscreen().catch(() => {});
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, []);
    const toggleFullscreen = async () => {
        try {
            setFullscreenNotice('');
            if (document.fullscreenElement === container.current) await document.exitFullscreen();
            else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
            else setFullscreenNotice('Full screen is unavailable. The expanded viewer still fills the app window.');
        } catch { setFullscreenNotice('Full screen was not allowed. You can still use the expanded viewer.'); }
    };
    return createPortal(<div className="stream-viewer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeAction.current(); }}>
        <section ref={container} className="stream-viewer" role="dialog" aria-modal="true" aria-label={`Expanded video from ${name}`}>
            <header className="stream-viewer-header"><div><strong>{name}</strong><span>{preview ? 'Your video preview' : 'Live video'}</span></div><div className="stream-viewer-actions">
                <button type="button" title={fullscreen ? 'Exit full screen' : 'Full screen'} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
                <button ref={close} type="button" title="Return to call" aria-label="Close expanded video" onClick={() => closeAction.current()}><X size={22} /></button>
            </div></header>
            <div className="stream-viewer-stage"><video ref={video} autoPlay playsInline muted onDoubleClick={() => void toggleFullscreen()} /></div>
            {(error || audioError || fullscreenNotice) && <div className="stream-viewer-notice" role="status">{fullscreenNotice && <span>{fullscreenNotice}</span>}{error && <><span>{error}</span><button type="button" onClick={() => void video.current?.play().then(() => setError('')).catch(() => setError('Video playback is still unavailable. Return to the call and rejoin.'))}>Retry video</button></>}{audioError && <><span>{audioError}</span><button type="button" onClick={onPlayAudio}>Play audio</button></>}</div>}
            <footer className="stream-viewer-footer"><span>Double-click video for full screen · Esc to return</span>{!preview && <label>Participant volume<input type="range" min="0" max="1" step="0.01" value={volume} aria-label={`Volume for ${name}`} onChange={event => onVolume(Number(event.target.value))} /></label>}<button type="button" onClick={() => closeAction.current()}>Return to call</button></footer>
        </section>
    </div>, document.body);
}
