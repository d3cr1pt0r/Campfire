import { useId } from 'react';
import type { MicrophoneReading } from './microphoneMonitor';
import { speechThreshold, voiceThreshold, voiceThresholdPercent } from './audioPreferences';

export function ActivationThreshold({
    value,
    reading,
    disabled,
    onChange,
    mode = 'level',
}: {
    mode?: 'level' | 'speech';
    value: number | undefined;
    reading: MicrophoneReading | null;
    disabled: boolean;
    onChange: (value: number) => void;
}) {
    const id = useId();
    const speech = mode === 'speech';
    const threshold = speech ? Math.round(speechThreshold(value) * 100) : voiceThreshold(value);
    const ready =
        !!reading &&
        !reading.paused &&
        !reading.muted &&
        (!speech || reading.speechProbability != null);
    const decibels = ready ? reading.decibels : null;
    const probability = ready ? (reading.speechProbability ?? 0) : 0;
    const above = speech
        ? ready && probability >= speechThreshold(value)
        : decibels !== null && decibels >= threshold;
    const position = speech
        ? Math.max(0, Math.min(100, ((probability * 100 - 5) / 90) * 100))
        : voiceThresholdPercent(decibels);
    const shownThreshold = speech ? `${threshold}% speech confidence` : `${threshold} dBFS`;
    const liveText = !ready
        ? disabled
            ? 'Preview bypassed'
            : reading?.paused
              ? 'Preview paused — resume the microphone meter'
              : 'Waiting for microphone preview…'
        : speech
          ? `Live speech confidence: ${Math.round(probability * 100)}%`
          : decibels === null
            ? 'Live mic: Silent'
            : `Live mic: ${Math.round(decibels)} dBFS`;
    return (
        <div
            className={`activation-threshold ${ready ? 'is-measuring' : ''} ${above && !disabled ? 'above-threshold' : ''}`}
        >
            <label className="audio-slider" htmlFor={id}>
                <span>
                    Activation threshold<output htmlFor={id}>{shownThreshold}</output>
                </span>
                <span className="threshold-slider">
                    <span className="threshold-live-track" aria-hidden="true">
                        <i style={{ width: `${position}%` }} />
                        {ready && <b style={{ left: `${position}%` }} />}
                    </span>
                    <input
                        id={id}
                        type="range"
                        min={speech ? 5 : -60}
                        max={speech ? 95 : 0}
                        step={1}
                        value={threshold}
                        disabled={disabled}
                        aria-label="Activation threshold"
                        aria-valuetext={shownThreshold}
                        aria-describedby={`${id}-reading`}
                        onChange={(event) =>
                            onChange(
                                speech
                                    ? (0.95 - Number(event.target.value) / 100) / 0.9
                                    : Number(event.target.value),
                            )
                        }
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
                    : speech
                      ? 'The moving marker shows how likely RNNoise thinks the sound is speech. Lower thresholds accept less certain speech; higher thresholds reject more non-speech sounds.'
                      : 'The moving marker shows your live microphone level; the round handle sets the cutoff. Lower thresholds pick up quieter voices.'}
            </p>
        </div>
    );
}
