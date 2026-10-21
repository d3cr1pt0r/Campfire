import { useId } from 'react';
import type { MicrophoneReading } from './microphoneMonitor';
import { voiceThreshold, voiceThresholdPercent } from './audioPreferences';

export function ActivationThreshold({
    value,
    reading,
    disabled,
    onChange,
}: {
    value: number | undefined;
    reading: MicrophoneReading | null;
    disabled: boolean;
    onChange: (value: number) => void;
}) {
    const id = useId();
    const threshold = voiceThreshold(value);
    const ready = !!reading && !reading.paused && !reading.muted;
    const decibels = ready ? reading.decibels : null;
    const above = decibels !== null && decibels >= threshold;
    const position = voiceThresholdPercent(decibels);
    const liveText = !ready
        ? 'Start microphone test to see your level'
        : decibels === null
          ? 'Live mic: Silent'
          : `Live mic: ${Math.round(decibels)} dBFS`;
    return (
        <div
            className={`activation-threshold ${ready ? 'is-measuring' : ''} ${above && !disabled ? 'above-threshold' : ''}`}
        >
            <label className="audio-slider" htmlFor={id}>
                <span>
                    Activation threshold<output htmlFor={id}>{threshold} dBFS</output>
                </span>
                <span className="threshold-slider">
                    <span className="threshold-live-track" aria-hidden="true">
                        <i style={{ width: `${position}%` }} />
                        {ready && <b style={{ left: `${position}%` }} />}
                    </span>
                    <input
                        id={id}
                        type="range"
                        min={-60}
                        max={0}
                        step={1}
                        value={threshold}
                        disabled={disabled}
                        aria-label="Activation threshold"
                        aria-valuetext={`${threshold} dBFS`}
                        aria-describedby={`${id}-reading`}
                        onChange={(event) => onChange(Number(event.target.value))}
                    />
                </span>
            </label>
            <div className="threshold-reading" id={`${id}-reading`}>
                <span className="threshold-live-value">{liveText}</span>
                <span className="threshold-comparison">
                    {disabled
                        ? 'Bypassed for push-to-talk'
                        : ready
                          ? above
                              ? 'Above threshold'
                              : 'Below threshold'
                          : ''}
                </span>
            </div>
            <p className="audio-help">
                {disabled
                    ? 'Voice activation is bypassed while push-to-talk is enabled.'
                    : 'Speak during the microphone test. The moving marker shows your live level; the round handle sets the cutoff. Lower values pick up quieter voices.'}
            </p>
        </div>
    );
}
