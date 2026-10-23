import { useEffect, useRef, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { attachScreenAudio, type ScreenAudioInfo } from './screenAudio';

export function useScreenShareAudio() {
    const [prompt, setPrompt] = useState<ScreenAudioInfo | null>(null);
    const [choice, setChoice] = useState('none');
    const answer = useRef<((choice: string | null) => void) | null>(null);
    const panel = useRef<HTMLElement>(null);
    const finish = (value: string | null) => {
        const resolve = answer.current;
        answer.current = null;
        setPrompt(null);
        resolve?.(value);
    };
    useEffect(
        () => () => {
            answer.current?.(null);
            answer.current = null;
        },
        [],
    );
    useEffect(() => {
        if (!prompt) return;
        const previous = document.activeElement as HTMLElement | null;
        panel.current?.querySelector<HTMLElement>('select')?.focus();
        return () => previous?.focus();
    }, [prompt?.token]);
    const attach = async (stream: MediaStream, signal: AbortSignal) => {
        const bridge = window.campfire?.screenAudio;
        if (!bridge) return () => {};
        const cancelled = () => finish(null);
        signal.addEventListener('abort', cancelled, { once: true });
        try {
            return await attachScreenAudio({
                stream,
                signal,
                bridge,
                choose: (info) =>
                    new Promise((resolve) => {
                        if (signal.aborted) return resolve(null);
                        answer.current = resolve;
                        setChoice(info.available ? info.recommended : 'none');
                        setPrompt(info);
                    }),
            });
        } finally {
            signal.removeEventListener('abort', cancelled);
        }
    };
    const dialog = prompt && (
        <div
            className="modal-backdrop screen-audio-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) finish(null);
            }}
        >
            <section
                ref={panel}
                className="modal screen-audio-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="screen-audio-title"
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        finish(null);
                    }
                    if (event.key === 'Tab') {
                        const controls = [
                            ...event.currentTarget.querySelectorAll<HTMLElement>(
                                'button:not(:disabled),select:not(:disabled)',
                            ),
                        ];
                        const first = controls[0],
                            last = controls.at(-1);
                        if (event.shiftKey && document.activeElement === first) {
                            event.preventDefault();
                            last?.focus();
                        } else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault();
                            first?.focus();
                        }
                    }
                }}
            >
                <button
                    className="modal-close"
                    aria-label="Cancel screen sharing"
                    onClick={() => finish(null)}
                >
                    <X size={20} />
                </button>
                <h2 id="screen-audio-title">
                    <Volume2 size={20} aria-hidden /> Screen-share audio
                </h2>
                <p className="muted">
                    Sharing: <strong>{prompt.selection}</strong>
                </p>
                <label>
                    Audio
                    <select
                        aria-label="Screen-share audio"
                        value={choice}
                        onChange={(event) => setChoice(event.target.value)}
                    >
                        <option value="none">No audio</option>
                        {prompt.available && (
                            <option value="system">System audio (excluding Campfire)</option>
                        )}
                        {prompt.applications.map((application) => (
                            <option key={application.id} value={application.id}>
                                {application.name}
                            </option>
                        ))}
                    </select>
                </label>
                <p className="field-help">
                    {!prompt.available
                        ? 'Audio capture is unavailable on this system. You can still share video.'
                        : choice === 'system'
                          ? 'Shares sound from your applications. Campfire call playback and your microphone are excluded.'
                          : choice === 'none'
                            ? 'Your screen or window will be shared without application audio.'
                            : 'Shares all sound from this application, which may include other windows or tabs. Your microphone stays separate.'}
                </p>
                {prompt.available && !prompt.applications.length && (
                    <p className="field-help">
                        No applications are playing audio yet. System audio will include
                        applications as they start playing.
                    </p>
                )}
                <div className="dialog-actions">
                    <button onClick={() => finish(null)}>Cancel</button>
                    <button className="primary" onClick={() => finish(choice)}>
                        Start sharing
                    </button>
                </div>
            </section>
        </div>
    );
    return { attach, dialog };
}
