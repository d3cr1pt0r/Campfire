import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Mic, Volume2, Video, RefreshCw } from 'lucide-react';
import type { Preferences } from './types';
import { Toggle } from './forms';
import { MicrophoneMeter } from './MicrophoneMeter';
import { formatMicrophoneError, openMicrophone } from './media';
import { audioLevel, voiceThreshold } from './audioPreferences';
import { createNotificationSound } from './notifications';

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

export function AudioVideoSettings({
    prefs,
    setPrefs,
    devices,
    setDevices,
    notify,
    inCall,
    activeStream,
}: {
    prefs: Preferences;
    setPrefs: Dispatch<SetStateAction<Preferences>>;
    devices: MediaDeviceInfo[];
    setDevices: Dispatch<SetStateAction<MediaDeviceInfo[]>>;
    notify: (message: string) => void;
    inCall: boolean;
    activeStream: MediaStream | null;
}) {
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
        <div className="audio-video-settings">
            <div className="audio-settings-intro">
                <p>Balance your voice, calls, and sounds.</p>
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
            {error && (
                <p className="audio-settings-error" role="alert">
                    {error}
                </p>
            )}
            <section className="audio-settings-section" aria-labelledby="audio-microphone-title">
                <h3 id="audio-microphone-title">
                    <Mic size={17} />
                    Microphone
                </h3>
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
                <div className="audio-processing">
                    <Toggle
                        title="Noise suppression"
                        value={prefs.noise}
                        set={(value) =>
                            setPrefs((previous) => ({
                                ...previous,
                                echoCancellation: previous.echoCancellation ?? previous.noise,
                                autoGainControl: previous.autoGainControl ?? previous.noise,
                                noise: value,
                            }))
                        }
                    />
                    <Toggle
                        title="Echo cancellation"
                        value={prefs.echoCancellation ?? prefs.noise}
                        set={(value) => change('echoCancellation', value)}
                    />
                    <Toggle
                        title="Automatic microphone gain"
                        value={prefs.autoGainControl ?? prefs.noise}
                        set={(value) => change('autoGainControl', value)}
                    />
                </div>
                <p className="audio-help">
                    Echo cancellation helps with speakers. Turn automatic gain off for consistent
                    manual volume. Processing uses Chromium.
                </p>
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
                        <AudioSlider
                            label="Activation threshold"
                            value={voiceThreshold(prefs.voiceThreshold)}
                            min={-60}
                            max={-15}
                            step={1}
                            suffix=" dBFS"
                            disabled={prefs.pushToTalk}
                            change={(value) => change('voiceThreshold', value)}
                        />
                        <p className="audio-help">
                            {prefs.pushToTalk
                                ? 'Bypassed while push-to-talk is enabled.'
                                : 'Lower values pick up quieter voices. Audio fades out after 200 ms below the threshold; noise while speaking can still pass through.'}
                        </p>
                    </>
                )}
                <MicrophoneMeter
                    preferences={prefs}
                    activeStream={activeStream}
                    onInputFallback={() =>
                        notify(
                            'Saved microphone unavailable; testing System default. Your selection is kept.',
                        )
                    }
                />
            </section>
            <section className="audio-settings-section" aria-labelledby="audio-playback-title">
                <h3 id="audio-playback-title">
                    <Volume2 size={17} />
                    Playback
                </h3>
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
                    title="Call connection sounds"
                    value={prefs.sounds}
                    set={(value) => change('sounds', value)}
                />
                <p className="audio-help">
                    Sound-effects volume controls call and message sounds independently of output
                    volume. Message alerts are configured in Notifications.
                </p>
            </section>
            <section className="audio-settings-section" aria-labelledby="audio-video-title">
                <h3 id="audio-video-title">
                    <Video size={17} />
                    Video & screen sharing
                </h3>
                <label>
                    Preferred resolution
                    <select
                        value={prefs.quality}
                        onChange={(event) => change('quality', event.target.value)}
                    >
                        <option value="360">360p · Save bandwidth</option>
                        <option value="720">720p · Balanced</option>
                        <option value="1080">1080p · Higher quality</option>
                    </select>
                </label>
                <p className="audio-help">
                    Applies the next time you start your camera or share a screen. Preview your
                    camera in a voice channel. Screen sharing replaces your outgoing camera; on
                    Windows, enable system audio in the share picker.
                </p>
            </section>
        </div>
    );
}
