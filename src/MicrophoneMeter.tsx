import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import type { Preferences } from './types';
import { formatMicrophoneError } from './media';
import { createMicrophoneMonitor, type MicrophoneReading } from './microphoneMonitor';

function analysisError(reason: unknown) {
    const error = reason as {name?: string; message?: string};
    return `Audio analysis could not start${error?.name ? ` [${error.name}]` : ''}. Resume the meter or restart the test.${error?.message ? ` ${error.message}` : ''}`;
}

export function MicrophoneMeter({ preferences, activeStream, onInputFallback }: {
    preferences: Preferences;
    activeStream: MediaStream | null;
    onInputFallback: () => void;
}) {
    const [testing, setTesting] = useState(false), [reading, setReading] = useState<MicrophoneReading | null>(null), [error, setError] = useState('');
    const monitor = useRef<ReturnType<typeof createMicrophoneMonitor> | null>(null);
    const context = useRef<AudioContext | null>(null);
    const stopTest = () => {
        monitor.current?.stop(); monitor.current = null;
        const previous = context.current; context.current = null;
        if (previous) void previous.close().catch(() => {});
        setTesting(false); setReading(null);
    };
    const startTest = () => {
        setError('');
        try {
            // Run inside the button's user gesture, before capture/effects await.
            const current = new AudioContext();
            context.current = current;
            void current.resume().catch(reason => {
                if (context.current === current) setError(analysisError(reason));
            });
            setTesting(true);
        } catch (reason) { setError(analysisError(reason)); }
    };
    useEffect(() => () => {
        monitor.current?.stop();
        const current = context.current; context.current = null;
        if (current) void current.close().catch(() => {});
    }, []);
    const fallback = useRef(onInputFallback); fallback.current = onInputFallback;
    useEffect(() => {
        if (!testing || !context.current) return;
        let active = true;
        setReading(null); setError('');
        try {
            const current = createMicrophoneMonitor({
                preferences,
                activeStream,
                context: context.current,
                onReading: value => { if (active) setReading(value); },
                onError: reason => { if (active) { setError(formatMicrophoneError(reason)); stopTest(); } },
                onFallback: () => { if (active) fallback.current(); },
            });
            monitor.current = current;
            return () => { active = false; current.stop(); if (monitor.current === current) monitor.current = null; };
        } catch (reason) {
            setError(formatMicrophoneError(reason)); stopTest();
        }
        // Restart an active test when its selected input or processing changes.
    }, [testing, preferences.input, preferences.inputLabel, preferences.noise, activeStream]);
    const level = testing ? reading?.percent || 0 : 0;
    const status = !testing ? 'Test stopped' : !reading ? 'Opening microphone…' : reading.paused ? 'Meter paused — click Resume meter' : reading.muted ? (activeStream ? 'Call input muted / push-to-talk waiting' : 'Microphone input muted by device') : reading.clipping ? 'Input too loud' : reading.detected ? 'Input detected' : 'No input detected';
    return <section className="microphone-test" aria-labelledby="microphone-test-title">
        <div className="microphone-test-heading"><strong id="microphone-test-title">Microphone level</strong><span className={testing && reading?.detected ? 'detecting' : ''}>{testing ? <Mic size={14} /> : <MicOff size={14} />}{status}</span></div>
        <div className="microphone-meter" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level)} aria-valuetext={status}>
            {Array.from({ length: 24 }, (_, index) => <i key={index} className={`${index < Math.ceil(level / 100 * 24) ? 'lit' : ''} ${index >= 21 ? 'hot' : index >= 18 ? 'warm' : ''}`} />)}
        </div>
        <div className="microphone-meter-scale"><span>Quiet</span><span>{testing && reading?.decibels !== null && reading?.decibels !== undefined ? `${Math.round(reading.decibels)} dBFS` : '—'}</span><span>Loud</span></div>
        <p className="muted">{activeStream ? `Current call microphone: ${activeStream.getAudioTracks()[0]?.label || 'Microphone'}. Mute, deafen and push-to-talk affect this meter. Rejoin the call to apply a different input selection.` : 'Start the test and speak to check the selected input. Audio stays local and is not played back.'}</p>
        {testing && reading && <small className="microphone-device">{reading.device}</small>}
        <div className="microphone-test-actions"><button type="button" className="secondary" onClick={() => { if (testing) stopTest(); else startTest(); }}>{testing ? 'Stop microphone test' : 'Start microphone test'}</button>{testing && reading?.paused && <button type="button" className="secondary" onClick={() => void monitor.current?.resume().then(() => setError('')).catch(reason => setError(analysisError(reason)))}>Resume meter</button>}</div>
        {error && <p className="microphone-test-error" role="alert">{error}</p>}
    </section>;
}
