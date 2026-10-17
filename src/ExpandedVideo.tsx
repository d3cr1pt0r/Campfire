import { useEffect, useRef, useState } from 'react';
import { ExpandedViewer } from './ExpandedViewer';
import { VolumeControl } from './VolumeControl';

export function ExpandedVideo({
    stream,
    name,
    preview,
    volume,
    onVolume,
    streamVolume,
    onStreamVolume,
    onStopWatching,
    audioError,
    onPlayAudio,
    onClose,
}: {
    stream: MediaStream | null;
    name: string;
    preview: boolean;
    volume: number;
    onVolume: (volume: number) => void;
    streamVolume?: number;
    onStreamVolume?: (volume: number) => void;
    onStopWatching?: () => void;
    audioError: string;
    onPlayAudio: () => void;
    onClose: () => void;
}) {
    const video = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        let active = true;
        element.srcObject = stream;
        void element
            .play()
            .then(() => {
                if (active) setError('');
            })
            .catch((reason) => {
                if (active)
                    setError(
                        `Video playback failed${reason.name ? ` [${reason.name}]` : ''}. Use Retry video.`,
                    );
            });
        return () => {
            active = false;
            element.pause();
            element.srcObject = null;
        };
    }, [stream]);
    return (
        <ExpandedViewer
            kind="video"
            name={name}
            label={`Expanded video from ${name}`}
            subtitle={preview ? 'Your video preview' : 'Live video'}
            onClose={onClose}
            notice={
                error || audioError ? (
                    <>
                        {error && (
                            <>
                                <span>{error}</span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        void video.current
                                            ?.play()
                                            .then(() => setError(''))
                                            .catch(() =>
                                                setError(
                                                    'Video playback is still unavailable. Return to the call and rejoin.',
                                                ),
                                            )
                                    }
                                >
                                    Retry video
                                </button>
                            </>
                        )}
                        {audioError && (
                            <>
                                <span>{audioError}</span>
                                <button type="button" onClick={onPlayAudio}>
                                    Play audio
                                </button>
                            </>
                        )}
                    </>
                ) : null
            }
            controls={
                <>
                    {!preview && (
                        <VolumeControl
                            name={name}
                            label="Voice"
                            value={volume}
                            onChange={onVolume}
                        />
                    )}
                    {!preview && streamVolume !== undefined && (
                        <VolumeControl
                            name={name}
                            label="Stream"
                            value={streamVolume}
                            onChange={(value) => onStreamVolume?.(value)}
                        />
                    )}
                    {onStopWatching && (
                        <button type="button" onClick={onStopWatching}>
                            Stop watching
                        </button>
                    )}
                </>
            }
        >
            {(fullscreen) => (
                <video ref={video} autoPlay playsInline muted onDoubleClick={fullscreen} />
            )}
        </ExpandedViewer>
    );
}
