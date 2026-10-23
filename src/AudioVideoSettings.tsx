import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Preferences, VideoAdaptation } from './types';
import { Toggle } from './forms';
import { MicrophoneMeter } from './MicrophoneMeter';
import { formatMicrophoneError, openMicrophone } from './media';
import { audioLevel, speechActivation, voiceReleaseDelay } from './audioPreferences';
import { ActivationThreshold } from './ActivationThreshold';
import type { MicrophoneReading } from './microphoneMonitor';
import { createNotificationSound } from './notifications';
import {
    adaptations,
    bitrateScales,
    cameraFrameRates,
    cameraHeights,
    captureSize,
    formatBitrate,
    maxBitrate,
    screenFrameRates,
    screenHeights,
    videoSettings,
    type VideoSource,
} from './videoQuality';

function AudioSlider({
    label,
    value,
    max = 1,
    min = 0,
    step = 0.01,
    suffix = '%',
    change,
    disabled = false,
}: {
    label: string;
    value: number;
    max?: number;
    min?: number;
    step?: number;
    suffix?: string;
    change: (value: number) => void;
    disabled?: boolean;
}) {
    const shown = suffix === '%' ? Math.round(value * 100) : value;
    return (
        <label className="audio-slider">
            <span>
                {label}
                <output>
                    {shown}
                    {suffix}
                </output>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                aria-label={label}
                aria-valuetext={`${shown}${suffix}`}
                onChange={(e) => change(Number(e.target.value))}
            />
        </label>
    );
}

const screenFrameRateHints: Record<number, string> = {
    5: ' · documents and code',
    60: ' · games and video',
};

export function AudioVideoSettings({
    prefs,
    setPrefs,
    devices,
    setDevices,
    notify,
    inCall,
    activeStream,
    speechProbability,
}: {
    prefs: Preferences;
    setPrefs: Dispatch<SetStateAction<Preferences>>;
    devices: MediaDeviceInfo[];
    setDevices: Dispatch<SetStateAction<MediaDeviceInfo[]>>;
    notify: (message: string) => void;
    inCall: boolean;
    activeStream: MediaStream | null;
    speechProbability?: () => number | null;
}) {
    const [microphoneReading, setMicrophoneReading] = useState<MicrophoneReading | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState('');
    const preferences = useRef(prefs);
    preferences.current = prefs;
    const player = useRef<ReturnType<typeof createNotificationSound> | null>(null);
    useEffect(() => {
        player.current = createNotificationSound(() => preferences.current);
        return () => {
            player.current?.close();
            player.current = null;
        };
    }, []);
    const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
        setPrefs((previous) => ({ ...previous, [key]: value }));
    const refresh = async () => {
        setRefreshing(true);
        setError('');
        try {
            const { stream } = await openMicrophone(preferences.current);
            stream.getTracks().forEach((track) => track.stop());
            setDevices(await navigator.mediaDevices.enumerateDevices());
        } catch (reason) {
            setError(formatMicrophoneError(reason));
        } finally {
            setRefreshing(false);
        }
    };
    const camera = videoSettings(prefs, 'camera'),
        screen = videoSettings(prefs, 'screen');
    const advancedVideo = (source: VideoSource) => {
        const settings = source === 'camera' ? camera : screen;
        const { width, height } = captureSize(null, settings);
        const ceiling = formatBitrate(maxBitrate(source, width, height, settings));
        const step = Math.max(
            0,
            bitrateScales.findIndex((scale) => scale.value === settings.bitrateScale),
        );
        const name = source === 'camera' ? 'Camera' : 'Screen sharing';
        const shown = `${bitrateScales[step].label} · up to ${ceiling} per viewer`;
        return (
            <fieldset key={source}>
                <legend>{name}</legend>
                <label className="audio-slider">
                    <span>
                        Bitrate
                        <output>{shown}</output>
                    </span>
                    <input
                        type="range"
                        min={0}
                        max={bitrateScales.length - 1}
                        step={1}
                        value={step}
                        aria-label={`${name} bitrate`}
                        aria-valuetext={shown}
                        onChange={(event) =>
                            change(
                                source === 'camera' ? 'cameraBitrate' : 'screenBitrate',
                                bitrateScales[Number(event.target.value)].value,
                            )
                        }
                    />
                </label>
                <label>
                    When the connection cannot keep up
                    <select
                        value={settings.adaptation}
                        onChange={(event) =>
                            change(
                                source === 'camera' ? 'cameraAdaptation' : 'screenAdaptation',
                                event.target.value as VideoAdaptation,
                            )
                        }
                    >
                        {adaptations.map((mode) => (
                            <option key={mode.value} value={mode.value}>
                                {mode.label}
                            </option>
                        ))}
                    </select>
                </label>
            </fieldset>
        );
    };
    const deviceSelect = (kind: 'input' | 'output') => {
        const deviceKind = kind === 'input' ? 'audioinput' : 'audiooutput';
        const saved = prefs[kind];
        const savedLabel = kind === 'input' ? prefs.inputLabel : prefs.outputLabel;
        const options = devices.filter((device) => device.kind === deviceKind && device.deviceId);
        return (
            <label className="audio-device">
                {kind === 'input' ? 'Input device' : 'Output device'}
                <select
                    value={saved}
                    onChange={(event) => {
                        const value = event.target.value;
                        setPrefs((previous) => ({
                            ...previous,
                            [kind]: value,
                            [kind === 'input' ? 'inputLabel' : 'outputLabel']:
                                options.find((device) => device.deviceId === value)?.label || '',
                        }));
                    }}
                >
                    <option value="">System default</option>
                    {saved && !options.some((device) => device.deviceId === saved) && (
                        <option value={saved}>{savedLabel || 'Saved device'} (unavailable)</option>
                    )}
                    {options.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                            {device.label ||
                                `${kind === 'input' ? 'Microphone' : 'Speaker'} ${index + 1}`}
                        </option>
                    ))}
                </select>
            </label>
        );
    };
    return (
        <div className="settings-page audio-video-settings">
            {error && (
                <p className="audio-settings-error" role="alert">
                    {error}
                </p>
            )}
            <section
                className="settings-section audio-settings-section"
                aria-labelledby="audio-microphone-title"
            >
                <div className="audio-settings-intro">
                    <h3 id="audio-microphone-title">Microphone</h3>
                    <button
                        type="button"
                        className="secondary"
                        disabled={refreshing}
                        onClick={() => void refresh()}
                    >
                        <RefreshCw size={14} />
                        {refreshing ? 'Refreshing…' : 'Refresh devices'}
                    </button>
                </div>
                <p className="field-help">Preferences save automatically on this device.</p>
                {deviceSelect('input')}
                {inCall && (
                    <p className="audio-help">
                        Input device changes apply when you rejoin. Levels and processing update
                        during the call.
                    </p>
                )}
                <AudioSlider
                    label="Microphone volume"
                    value={audioLevel(prefs.microphoneVolume, 1, 2)}
                    max={2}
                    change={(value) => change('microphoneVolume', value)}
                />
                <p className="audio-help">
                    100% keeps the original level. Boost also raises remaining background noise.
                </p>
                <MicrophoneMeter
                    onReading={setMicrophoneReading}
                    preferences={prefs}
                    activeStream={activeStream}
                    speechProbability={speechProbability}
                    onInputFallback={() =>
                        notify(
                            'Saved microphone unavailable; testing System default. Your selection is kept.',
                        )
                    }
                />
            </section>
            <section
                className="settings-section audio-settings-section"
                aria-labelledby="audio-processing-title"
            >
                <h3 id="audio-processing-title">Voice processing</h3>
                <div className="audio-processing">
                    <Toggle
                        title="Noise suppression"
                        value={prefs.noise}
                        set={(value) => change('noise', value)}
                    />
                    <label className="audio-engine-choice">
                        Noise suppression engine
                        <select
                            value={
                                prefs.noiseSuppressionEngine === 'chromium' ? 'chromium' : 'rnnoise'
                            }
                            disabled={!prefs.noise}
                            onChange={(event) =>
                                change(
                                    'noiseSuppressionEngine',
                                    event.target.value as 'chromium' | 'rnnoise',
                                )
                            }
                        >
                            <option value="chromium">Chromium</option>
                            <option value="rnnoise">RNNoise</option>
                        </select>
                    </label>
                    <Toggle
                        title="Echo cancellation"
                        value={prefs.echoCancellation ?? true}
                        set={(value) => change('echoCancellation', value)}
                    />
                    <Toggle
                        title="Automatic microphone gain"
                        value={prefs.autoGainControl ?? true}
                        set={(value) => change('autoGainControl', value)}
                    />
                </div>
                <p className="audio-help">
                    Echo cancellation helps with speakers. Turn automatic gain off for consistent
                    manual volume. RNNoise runs locally; echo cancellation and automatic gain
                    continue to use Chromium with either noise suppression engine.
                </p>
            </section>
            <section
                className="settings-section audio-settings-section"
                aria-labelledby="audio-input-mode-title"
            >
                <h3 id="audio-input-mode-title">Input mode</h3>
                <Toggle
                    title="Push-to-talk"
                    value={prefs.pushToTalk}
                    set={(value) => change('pushToTalk', value)}
                />
                <p className="audio-help">
                    Hold Space while the app is focused, outside text fields.
                </p>
                <Toggle
                    title="Voice activation"
                    value={!!prefs.voiceActivation}
                    set={(value) => change('voiceActivation', value)}
                />
                {prefs.voiceActivation && (
                    <>
                        <label>
                            Activation method
                            <select
                                value={prefs.voiceActivationMode ?? 'level'}
                                disabled={prefs.pushToTalk}
                                onChange={(event) =>
                                    change(
                                        'voiceActivationMode',
                                        event.target.value as 'level' | 'speech',
                                    )
                                }
                            >
                                <option value="level">Microphone volume</option>
                                <option
                                    value="speech"
                                    disabled={
                                        !prefs.noise || prefs.noiseSuppressionEngine === 'chromium'
                                    }
                                >
                                    Speech detection (RNNoise)
                                </option>
                            </select>
                        </label>
                        {prefs.voiceActivationMode === 'speech' && !speechActivation(prefs) && (
                            <p className="audio-help">
                                Speech detection needs RNNoise noise suppression. Microphone volume
                                activation is used until RNNoise is enabled.
                            </p>
                        )}
                        <ActivationThreshold
                            mode={speechActivation(prefs) ? 'speech' : 'level'}
                            value={
                                speechActivation(prefs)
                                    ? prefs.speechSensitivity
                                    : prefs.voiceThreshold
                            }
                            reading={microphoneReading}
                            disabled={prefs.pushToTalk}
                            onChange={(value) =>
                                change(
                                    speechActivation(prefs)
                                        ? 'speechSensitivity'
                                        : 'voiceThreshold',
                                    value,
                                )
                            }
                        />
                        <details className="account-details">
                            <summary>Advanced voice activation</summary>
                            <AudioSlider
                                label="Speech release delay"
                                value={voiceReleaseDelay(prefs.voiceReleaseDelay)}
                                min={0}
                                max={1000}
                                step={10}
                                suffix=" ms"
                                disabled={prefs.pushToTalk}
                                change={(value) => change('voiceReleaseDelay', value)}
                            />
                            <p className="audio-help">
                                Keeps the microphone open briefly after speech to preserve word
                                endings. Applies to both activation methods.
                            </p>
                        </details>
                    </>
                )}
            </section>
            <section
                className="settings-section audio-settings-section"
                aria-labelledby="audio-playback-title"
            >
                <h3 id="audio-playback-title">Playback</h3>
                <div className="audio-output-row">
                    {deviceSelect('output')}
                    <button
                        type="button"
                        className="secondary"
                        disabled={testing || audioLevel(prefs.outputVolume) === 0}
                        onClick={() => {
                            setTesting(true);
                            setError('');
                            void player.current
                                ?.play('test')
                                .then((played) => {
                                    if (!played)
                                        setError(
                                            'Speaker test could not play. Check the output device and try again.',
                                        );
                                })
                                .finally(() => setTesting(false));
                        }}
                    >
                        {testing ? 'Playing…' : 'Test speakers'}
                    </button>
                </div>
                <AudioSlider
                    label="Output volume"
                    value={audioLevel(prefs.outputVolume)}
                    change={(value) => change('outputVolume', value)}
                />
                <p className="audio-help">
                    Controls voices and shared audio. Right-click a member under a voice channel to
                    adjust their saved voice and stream levels.
                </p>
                <AudioSlider
                    label="Sound-effects volume"
                    value={audioLevel(prefs.soundEffectsVolume)}
                    change={(value) => change('soundEffectsVolume', value)}
                />
                <Toggle
                    title="Call sounds"
                    value={prefs.sounds}
                    set={(value) => change('sounds', value)}
                />
                <p className="audio-help">
                    Sound-effects volume controls call and message sounds independently of output
                    volume. Call sounds cover joining and leaving, mute and deafen, screen sharing,
                    and the ringback while you call someone. Incoming calls always ring unless you
                    are in Do Not Disturb or have muted the server. Message alerts are configured in
                    Notifications.
                </p>
            </section>
            <section
                className="settings-section audio-settings-section"
                aria-labelledby="audio-video-title"
            >
                <h3 id="audio-video-title">Video & screen sharing</h3>
                <div className="video-quality-columns">
                    <fieldset>
                        <legend>Camera</legend>
                        <label>
                            Resolution
                            <select
                                value={String(camera.height)}
                                onChange={(event) => change('quality', event.target.value)}
                            >
                                {cameraHeights.map((height) => (
                                    <option key={height} value={String(height)}>
                                        {height}p
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Frame rate
                            <select
                                value={camera.frameRate}
                                onChange={(event) =>
                                    change('cameraFrameRate', Number(event.target.value))
                                }
                            >
                                {cameraFrameRates.map((rate) => (
                                    <option key={rate} value={rate}>
                                        {rate} fps
                                    </option>
                                ))}
                            </select>
                        </label>
                    </fieldset>
                    <fieldset>
                        <legend>Screen sharing</legend>
                        <label>
                            Resolution
                            <select
                                value={screen.height === null ? 'source' : String(screen.height)}
                                onChange={(event) => change('screenResolution', event.target.value)}
                            >
                                <option value="source">Source · sharpest</option>
                                {screenHeights.map((height) => (
                                    <option key={height} value={String(height)}>
                                        Up to {height}p
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Frame rate
                            <select
                                value={screen.frameRate}
                                onChange={(event) =>
                                    change('screenFrameRate', Number(event.target.value))
                                }
                            >
                                {screenFrameRates.map((rate) => (
                                    <option key={rate} value={rate}>
                                        {rate} fps{screenFrameRateHints[rate] ?? ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </fieldset>
                </div>
                <p className="audio-help">
                    Changes apply right away, also during a call. Source sends your screen at its
                    own resolution; a lower one scales it down, which blurs small text. Preview your
                    camera in a voice channel. Screen sharing replaces your outgoing camera; on
                    Windows, enable system audio in the share picker.
                </p>
                <details className="account-details video-advanced">
                    <summary>Advanced</summary>
                    <div className="video-quality-columns">
                        {advancedVideo('camera')}
                        {advancedVideo('screen')}
                    </div>
                    <p className="audio-help">
                        Bitrate is the most your video may use for each viewer. A slower connection
                        still lowers it, and still images use far less. Everyone watching gets a
                        copy, so your upload carries it once per viewer.
                    </p>
                </details>
            </section>
        </div>
    );
}
