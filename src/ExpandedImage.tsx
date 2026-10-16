import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, X } from 'lucide-react';

export function ExpandedImage({ source, name, onClose }: { source: string; name: string; onClose: () => void }) {
    const container = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
    const closeAction = useRef(onClose); closeAction.current = onClose;
    const [fullscreen, setFullscreen] = useState(false), [notice, setNotice] = useState('');
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
                const elements = [...viewer?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []];
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
            setNotice('');
            if (document.fullscreenElement === container.current) await document.exitFullscreen();
            else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
            else setNotice('Full screen is unavailable. You can still use the expanded viewer.');
        } catch { setNotice('Full screen was not allowed. You can still use the expanded viewer.'); }
    };
    return createPortal(<div className="stream-viewer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeAction.current(); }}>
        <section ref={container} className="stream-viewer image-viewer" role="dialog" aria-modal="true" aria-label={`Expanded image: ${name}`}>
            <header className="stream-viewer-header"><div><strong>{name}</strong></div><div className="stream-viewer-actions">
                <button type="button" title={fullscreen ? 'Exit full screen' : 'Full screen'} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
                <button ref={close} type="button" title="Return to chat" aria-label="Close expanded image" onClick={() => closeAction.current()}><X size={22} /></button>
            </div></header>
            <div className="stream-viewer-stage"><img src={source} alt={name} onDoubleClick={() => void toggleFullscreen()} onError={() => setNotice('This image could not be displayed. Return to chat to download the attachment.')} /></div>
            {notice && <div className="stream-viewer-notice" role="status">{notice}</div>}
            <footer className="stream-viewer-footer"><span>Double-click image for full screen · Esc to return</span><button type="button" onClick={() => closeAction.current()}>Return to chat</button></footer>
        </section>
    </div>, document.body);
}
