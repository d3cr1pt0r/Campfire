import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useDialog } from './useDialog';

export function ExpandedViewer({
    name,
    label,
    kind,
    subtitle,
    onClose,
    children,
    notice,
    controls,
}: {
    name: string;
    label: string;
    kind: 'image' | 'video';
    subtitle?: string;
    onClose: () => void;
    children: (fullscreen: () => void) => ReactNode;
    notice?: ReactNode;
    controls?: ReactNode;
}) {
    const container = useRef<HTMLElement>(null),
        close = useRef<HTMLButtonElement>(null);
    const [fullscreen, setFullscreen] = useState(false),
        [error, setError] = useState('');
    useDialog(container, onClose, true, close);
    useEffect(() => {
        const update = () => setFullscreen(document.fullscreenElement === container.current);
        document.addEventListener('fullscreenchange', update);
        return () => document.removeEventListener('fullscreenchange', update);
    }, []);
    const toggle = async () => {
        try {
            setError('');
            if (document.fullscreenElement === container.current) await document.exitFullscreen();
            else if (container.current?.requestFullscreen)
                await container.current.requestFullscreen();
            else setError('Full screen is unavailable. You can still use the expanded viewer.');
        } catch {
            setError('Full screen was not allowed. You can still use the expanded viewer.');
        }
    };
    return createPortal(
        <div
            className="stream-viewer-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={container}
                tabIndex={-1}
                className={`stream-viewer ${kind === 'image' ? 'image-viewer' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label={label}
            >
                <header className="stream-viewer-header">
                    <div>
                        <strong>{name}</strong>
                        {subtitle && <span>{subtitle}</span>}
                    </div>
                    <div className="stream-viewer-actions">
                        <button
                            type="button"
                            title={fullscreen ? 'Exit full screen' : 'Full screen'}
                            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                            onClick={() => void toggle()}
                        >
                            {fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
                        </button>
                        <button
                            ref={close}
                            type="button"
                            title={kind === 'image' ? 'Return to chat' : 'Return to call'}
                            aria-label={`Close expanded ${kind}`}
                            onClick={onClose}
                        >
                            <X size={22} />
                        </button>
                    </div>
                </header>
                <div className="stream-viewer-stage">{children(() => void toggle())}</div>
                {(error || notice) && (
                    <div className="stream-viewer-notice" role="status">
                        {error && <span>{error}</span>}
                        {notice}
                    </div>
                )}
                <footer className="stream-viewer-footer">
                    <span>Double-click {kind} for full screen · Esc to return</span>
                    {controls}
                    <button type="button" onClick={onClose}>
                        {kind === 'image' ? 'Return to chat' : 'Return to call'}
                    </button>
                </footer>
            </section>
        </div>,
        document.body,
    );
}
