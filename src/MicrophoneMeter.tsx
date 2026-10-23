import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import type { Preferences } from './types';
import { formatMicrophoneError } from './media';
import { createMicrophoneMonitor, type MicrophoneReading } from './microphoneMonitor';

function analysisError(reason: unknown) {
    const error = reason as { name?: string; message?: string };
    return `Audio analysis could not start${error?.name ? ` [${error.name}]` : ''}. Resume the meter or retry the preview.${error?.message ? ` ${error.message}` : ''}`;
}

export function MicrophoneMeter({
    preferences,
    activeStream,
    onInputFallback,
    onReading,
    speechProbability,
}: {
    speechProbability?: () => number | null;
    preferences: Preferences;
    activeStream: MediaStream | null;
    onInputFallback: () => void;
    onReading?: (reading: MicrophoneReading | null) => void;
}) {
    const [reading, setReading] = useState<MicrophoneReading | null>(null),
        [error, setError] = useState(''),
        [failed, setFailed] = useState(false);
    const monitoring = !failed;
    const monitor = useRef<ReturnType<typeof createMicrophoneMonitor> | null>(null);
    const context = useRef<AudioContext | null>(null);
    const readingCallback = useRef(onReading);
    readingCallback.current = onReading;
    const publishReading = (value: MicrophoneReading | null) => {
        setReading(value);
        readingCallback.current?.(value);
    };
    const retryPreview = () => {
        setError('');
        setFailed(false);
        try {
            // Resume during a direct gesture if autoplay suspended the automatic preview.
            context.current ??= new AudioContext({ sampleRate: 48000 });
            void context.current.resume().catch((reason) => setError(analysisError(reason)));
        } catch (reason) {
            setError(analysisError(reason));
            setFailed(true);
        }
    };
    useEffect(() => {
        setFailed(false);
    }, [preferences.input, preferences.inputLabel]);
    useEffect(() => {
        if (!monitoring) return;
        try {
            const current = context.current ?? new AudioContext({ sampleRate: 48000 });
            context.current = current;
            void current.resume().catch(() => {});
            return () => {
                monitor.current?.stop();
                monitor.current = null;
                if (context.current === current) context.current = null;
                void current.close().catch(() => {});
                readingCallback.current?.(null);
            };
        } catch (reason) {
            setError(analysisError(reason));
            setFailed(true);
        }
    }, [monitoring]);
    const fallback = useRef(onInputFallback);
    fallback.current = onInputFallback;
    useEffect(() => {
        if (!monitoring || !context.current) return;
        let active = true;
        publishReading(null);
        setError('');
        try {
            const current = createMicrophoneMonitor({
                preferences,
                activeStream,
                speechProbability,
                context: context.current,
                onReading: (value) => {
                    if (active) publishReading(value);
                },
                onError: (reason) => {
                    if (active) {
                        setError(formatMicrophoneError(reason));
                        setFailed(true);
                        publishReading(null);
                    }
                },
                onFallback: () => {
                    if (active) fallback.current();
                },
            });
            monitor.current = current;
            return () => {
                active = false;
                current.stop();
                if (monitor.current === current) monitor.current = null;
            };
        } catch (reason) {
            setError(formatMicrophoneError(reason));
            setFailed(true);
            publishReading(null);
        }
        // Restart the preview when its selected input or processing changes.
    }, [
        monitoring,
        speechProbability,
        preferences.input,
        preferences.inputLabel,
        preferences.noise,
        preferences.noiseSuppressionEngine,
        preferences.echoCancellation,
        preferences.autoGainControl,
        preferences.microphoneVolume,
        activeStream,
    ]);
    const level = monitoring ? reading?.percent || 0 : 0;
    const status = !monitoring
        ? 'Preview unavailable'
        : !reading
          ? 'Opening microphone…'
          : reading.paused
            ? 'Meter paused — click Resume meter'
            : reading.muted
              ? activeStream
                  ? 'Call input muted / push-to-talk waiting'
                  : 'Microphone input muted by device'
              : reading.clipping
                ? 'Input too loud'
                : reading.detected
                  ? 'Input detected'
                  : 'No input detected';
    return (
        <section className="microphone-test" aria-labelledby="microphone-test-title">
            <div className="microphone-test-heading">
                <strong id="microphone-test-title">Microphone level</strong>
                <span className={monitoring && reading?.detected ? 'detecting' : ''}>
                    {monitoring ? <Mic size={14} /> : <MicOff size={14} />}
                    {status}
                </span>
            </div>
            <div
                className="microphone-meter"
                role="meter"
                aria-label="Microphone input level"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(level)}
                aria-valuetext={status}
            >
                {Array.from({ length: 24 }, (_, index) => (
                    <i
                        key={index}
                        className={`${index < Math.ceil((level / 100) * 24) ? 'lit' : ''} ${index >= 21 ? 'hot' : index >= 18 ? 'warm' : ''}`}
                    />
                ))}
            </div>
            <div className="microphone-meter-scale">
                <span>Quiet</span>
                <span>
                    {monitoring && reading?.decibels !== null && reading?.decibels !== undefined
                        ? `${Math.round(reading.decibels)} dBFS`
                        : '—'}
                </span>
                <span>Loud</span>
            </div>
            <p className="muted">
                {activeStream
                    ? 'Shows your call microphone before voice activation, independently of mute and push-to-talk. Rejoin to apply a different input device.'
                    : 'Shows the selected input after microphone volume, before voice activation. Audio stays local and is not played back.'}
            </p>
            <p className="muted">
                Preview runs automatically while Audio & Video settings are open.
            </p>
            {monitoring && reading && <small className="microphone-device">{reading.device}</small>}
            <div className="microphone-test-actions">
                {failed && (
                    <button type="button" className="secondary" onClick={retryPreview}>
                        Retry microphone preview
                    </button>
                )}
                {monitoring && reading?.paused && (
                    <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                            void monitor.current
                                ?.resume()
                                .then(() => setError(''))
                                .catch((reason) => setError(analysisError(reason)))
                        }
                    >
                        Resume meter
                    </button>
                )}
            </div>
            {error && (
                <p className="microphone-test-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
