import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The call stays in the opener; this window only presents its existing video track.
export function PopoutVideo({
    target,
    stream,
    name,
    ready,
    onClose,
    children,
}: {
    target: Window;
    stream: MediaStream;
    name: string;
    ready: boolean;
    onClose: () => void;
    children: ReactNode;
}) {
    const video = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState(false);
    useLayoutEffect(() => {
        const doc = target.document;
        doc.body.className = 'stream-popout-body';
        for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style')) {
            doc.head.append(sheet.cloneNode(true));
        }
        const theme = () => {
            doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
        };
        theme();
        const observer = new MutationObserver(theme);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
        return () => {
            observer.disconnect();
            target.close();
        };
    }, [target]);
    useEffect(() => {
        target.document.title = `${name} — Campfire stream`;
    }, [target, name]);
    useEffect(() => {
        const closed = () => onClose();
        target.addEventListener('pagehide', closed);
        // Also covers native window closure on platforms that omit pagehide.
        const timer = window.setInterval(() => {
            if (target.closed) onClose();
        }, 500);
        return () => {
            target.removeEventListener('pagehide', closed);
            window.clearInterval(timer);
        };
    }, [target, onClose]);
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        let active = true;
        element.srcObject = stream;
        if (ready)
            void element.play().catch(() => {
                if (active) setError(true);
            });
        return () => {
            active = false;
            element.pause();
            element.srcObject = null;
        };
    }, [stream, ready]);
    return createPortal(
        <main className="stream-popout" aria-label={`Stream from ${name}`}>
            <header>
                <strong>{name}</strong>
                <button onClick={onClose}>Return to call</button>
            </header>
            <div className="stream-popout-stage">
                <video ref={video} autoPlay playsInline muted />
                {!ready && <p role="status">Waiting for video…</p>}
                {error && (
                    <button
                        className="stream-popout-retry"
                        onClick={() => {
                            void video.current
                                ?.play()
                                .then(() => setError(false))
                                .catch(() => setError(true));
                        }}
                    >
                        Retry video
                    </button>
                )}
            </div>
            <footer>{children}</footer>
        </main>,
        target.document.body,
    );
}
