import {
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Volume2 } from 'lucide-react';
import { VolumeControl } from './VolumeControl';
import { AssetContext } from './ChatContent';
import type { ContextType } from 'react';

export const ParticipantAudioContext = createContext({
    outputVolume: 1,
    levels: (_user: string) => ({ voice: 1, stream: 1 }),
    change: (_user: string, _kind: 'voice' | 'stream', _value: number) => {},
});

export function ParticipantAudio({
    user,
    name,
    children,
    self,
}: {
    user: string;
    name: string;
    children: ReactNode;
    self: boolean;
}) {
    const audio = useContext(ParticipantAudioContext);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const trigger = useRef<HTMLDivElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const close = () => {
        setPosition(null);
        trigger.current?.focus();
    };
    useLayoutEffect(() => {
        if (!position || !popup.current) return;
        const node = popup.current;
        node.style.left = `${Math.max(8, Math.min(position.x, innerWidth - node.offsetWidth - 8))}px`;
        node.style.top = `${Math.max(8, Math.min(position.y, innerHeight - node.offsetHeight - 8))}px`;
        node.querySelector('input')?.focus();
    }, [position]);
    useEffect(() => {
        if (!position) return;
        const outside = (event: PointerEvent) => {
            if (!popup.current?.contains(event.target as Node)) setPosition(null);
        };
        const dismiss = () => setPosition(null);
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', key, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('blur', dismiss);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', key, true);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('blur', dismiss);
        };
    }, [position]);
    const levels = audio.levels(user);
    return (
        <div
            className={`voice-member ${self ? '' : 'has-audio-controls'}`}
            ref={trigger}
            tabIndex={self ? undefined : 0}
            aria-label={self ? undefined : `${name}, audio controls`}
            title={self ? undefined : 'Right-click or press Shift+F10 for audio controls'}
            onContextMenu={(event) => {
                if (self) return;
                event.preventDefault();
                setPosition({ x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
                if (self || event.target !== event.currentTarget) return;
                if (
                    event.key === 'ContextMenu' ||
                    (event.shiftKey && event.key === 'F10') ||
                    event.key === 'Enter' ||
                    event.key === ' '
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setPosition({ x: rect.right, y: rect.top });
                }
            }}
        >
            {children}
            {position &&
                createPortal(
                    <div
                        className="participant-audio-popup"
                        ref={popup}
                        role="dialog"
                        aria-label={`Audio controls for ${name}`}
                        onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget))
                                setPosition(null);
                        }}
                    >
                        <strong>
                            <Volume2 size={15} />
                            {name}
                        </strong>
                        <p>Only changes what you hear.</p>
                        <VolumeControl
                            name={name}
                            label="Voice"
                            value={levels.voice}
                            onChange={(value) => audio.change(user, 'voice', value)}
                        />
                        <VolumeControl
                            name={name}
                            label="Stream"
                            value={levels.stream}
                            onChange={(value) => audio.change(user, 'stream', value)}
                        />
                        <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                                audio.change(user, 'voice', 1);
                                audio.change(user, 'stream', 1);
                            }}
                        >
                            Reset volumes
                        </button>
                    </div>,
                    document.body,
                )}
        </div>
    );
}

export function MediaContexts({
    assets,
    audio,
    children,
}: {
    assets: ContextType<typeof AssetContext>;
    audio: ContextType<typeof ParticipantAudioContext>;
    children: ReactNode;
}) {
    return (
        <ParticipantAudioContext.Provider value={audio}>
            <AssetContext.Provider value={assets}>{children}</AssetContext.Provider>
        </ParticipantAudioContext.Provider>
    );
}
