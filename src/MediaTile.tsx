import { ParticipantAudioContext } from './ParticipantAudio';
import { VolumeControl } from './VolumeControl';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HeadphoneOff, Maximize2, MicOff, PictureInPicture2, TriangleAlert } from 'lucide-react';
import { AuthImage } from './ChatContent';
import { ExpandedVideo } from './ExpandedVideo';
import { AudioPlayback, type AudioPlaybackHandle } from './AudioPlayback';
import { syncPlaybackTracks } from './playback';
import { initials } from './profiles';
import { PopoutVideo } from './PopoutVideo';

export function MediaTile({
    participant,
    stream,
    streamAudio = null,
    sharing = false,
    cameraActive = false,
    watching = false,
    watchPending = false,
    onWatch,
    name,
    avatarName = name,
    muted = false,
    microphoneMuted = false,
    deafened = false,
    preview = false,
    output = '',
    outputLabel = '',
    avatar,
    speaking = false,
    onOutputFallback,
    onPopoutBlocked,
    videoWarning,
}: {
    participant?: string;
    stream: MediaStream | null;
    streamAudio?: MediaStream | null;
    sharing?: boolean;
    cameraActive?: boolean;
    watching?: boolean;
    watchPending?: boolean;
    onWatch?: (enabled: boolean) => void;
    name: string;
    avatarName?: string;
    muted?: boolean;
    microphoneMuted?: boolean;
    deafened?: boolean;
    preview?: boolean;
    output?: string;
    outputLabel?: string;
    avatar?: string | null;
    speaking?: boolean;
    onOutputFallback?: () => void;
    onPopoutBlocked?: () => void;
    // Why the sender is reducing this video, as they reported it.
    videoWarning?: string;
}) {
    const voice = useRef<AudioPlaybackHandle>(null),
        program = useRef<AudioPlaybackHandle>(null),
        videoRef = useRef<HTMLVideoElement>(null);
    const audioPreferences = useContext(ParticipantAudioContext);
    const [localVoiceVolume, setLocalVoiceVolume] = useState(1),
        [localStreamVolume, setLocalStreamVolume] = useState(1);
    const saved = participant ? audioPreferences.levels(participant) : null;
    const voiceVolume = saved?.voice ?? localVoiceVolume;
    const streamVolume = saved?.stream ?? localStreamVolume;
    const setVoiceVolume = (value: number) =>
        participant
            ? audioPreferences.change(participant, 'voice', value)
            : setLocalVoiceVolume(value);
    const setStreamVolume = (value: number) =>
        participant
            ? audioPreferences.change(participant, 'stream', value)
            : setLocalStreamVolume(value);
    const [voiceError, setVoiceError] = useState(''),
        [streamError, setStreamError] = useState('');
    const [hasVideo, setHasVideo] = useState(false),
        [expanded, setExpanded] = useState(false);
    const [popout, setPopout] = useState<Window | null>(null);
    const closePopout = () => setPopout(null);
    useEffect(() => {
        if (!sharing || (!watching && !watchPending)) setPopout(null);
    }, [sharing, watching, watchPending]);
    const openPopout = () => {
        if (popout && !popout.closed) {
            popout.focus();
            return;
        }
        const target = window.open(
            'about:blank',
            `campfire-stream-${crypto.randomUUID()}`,
            'popup=yes,width=960,height=600,resizable=yes,scrollbars=no',
        );
        if (!target) {
            onPopoutBlocked?.();
            return;
        }
        setPopout(target);
        if (!watching) onWatch?.(true);
    };
    const voiceTrack = preview ? undefined : stream?.getAudioTracks()[0];
    const audible = useMemo(() => new MediaStream(voiceTrack ? [voiceTrack] : []), [voiceTrack]);
    const visibleStream = useMemo(() => new MediaStream(), [stream]);
    const allowVideo = preview || (sharing ? watching : cameraActive);
    useEffect(() => {
        if (!hasVideo || !allowVideo) setExpanded(false);
    }, [hasVideo, allowVideo]);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        let active = true;
        const audio = audible,
            visible = visibleStream;
        video.srcObject = visible;
        const observed = new Set<MediaStreamTrack>();
        const update = () => {
            if (!active) return;
            const tracks = (stream?.getTracks() || []).filter(
                (t) => t.readyState !== 'ended' && (t.kind !== 'video' || allowVideo),
            );
            for (const track of tracks)
                if (!observed.has(track)) {
                    observed.add(track);
                    track.addEventListener('mute', update);
                    track.addEventListener('unmute', update);
                    track.addEventListener('ended', update);
                }
            syncPlaybackTracks(audio, visible, tracks, preview);
            setHasVideo(visible.getVideoTracks().some((track) => !track.muted));
            if (visible.getVideoTracks().length) void video.play().catch(() => {});
        };
        stream?.addEventListener('addtrack', update);
        stream?.addEventListener('removetrack', update);
        update();
        return () => {
            active = false;
            stream?.removeEventListener('addtrack', update);
            stream?.removeEventListener('removetrack', update);
            observed.forEach((track) => {
                track.removeEventListener('mute', update);
                track.removeEventListener('unmute', update);
                track.removeEventListener('ended', update);
            });
            video.pause();
            video.srcObject = null;
        };
    }, [stream, preview, allowVideo, audible, visibleStream]);
    const retryAudio = () => {
        void voice.current?.play();
        void program.current?.play();
    };
    const status = (microphoneMuted || deafened) && (
        <span
            className="call-media-status"
            role="img"
            aria-label={deafened ? 'Deafened' : 'Microphone muted'}
            title={deafened ? 'Deafened' : 'Microphone muted'}
        >
            {deafened ? <HeadphoneOff size={14} /> : <MicOff size={14} />}
        </span>
    );
    return (
        <div
            className={`media-tile ${preview ? 'preview' : ''} ${speaking ? 'speaking' : ''} ${sharing && !preview ? 'has-stream' : ''}`}
            role="group"
            aria-label={name}
            tabIndex={0}
        >
            <div className="media-placeholder">
                <div className="call-avatar-wrap">
                    {avatar ? (
                        <AuthImage path={`/avatars/${avatar}`} alt={name} className="call-avatar" />
                    ) : (
                        initials(avatarName)
                    )}
                </div>
            </div>
            <video
                style={{ opacity: hasVideo && allowVideo ? 1 : 0 }}
                ref={videoRef}
                autoPlay
                playsInline
                muted
                title={hasVideo ? 'Double-click to expand video' : undefined}
                onDoubleClick={() => {
                    if (hasVideo) setExpanded(true);
                }}
            />
            {status}
            {videoWarning && hasVideo && allowVideo && (
                <span
                    className="media-video-warning"
                    role="img"
                    aria-label={videoWarning}
                    title={videoWarning}
                >
                    <TriangleAlert size={14} />
                </span>
            )}
            {!preview && sharing && (
                <button
                    type="button"
                    className="popout-video"
                    title={popout ? 'Focus stream window' : 'Pop out stream'}
                    aria-label={`Pop out stream from ${name}`}
                    aria-pressed={!!popout}
                    disabled={watchPending && !watching}
                    onClick={openPopout}
                >
                    <PictureInPicture2 size={17} />
                </button>
            )}
            {popout && (
                <PopoutVideo
                    target={popout}
                    stream={visibleStream}
                    name={name}
                    ready={hasVideo && allowVideo}
                    onClose={closePopout}
                >
                    <VolumeControl
                        name={name}
                        label="Voice"
                        value={voiceVolume}
                        onChange={setVoiceVolume}
                    />
                    <VolumeControl
                        name={name}
                        label="Stream"
                        value={streamVolume}
                        onChange={setStreamVolume}
                    />
                    {(voiceError || streamError) && (
                        <button onClick={retryAudio}>Play audio</button>
                    )}
                    {muted && <span>Deafened</span>}
                    <button
                        onClick={() => {
                            closePopout();
                            onWatch?.(false);
                        }}
                    >
                        Stop watching
                    </button>
                </PopoutVideo>
            )}
            {hasVideo && allowVideo && (
                <button
                    type="button"
                    className="expand-video"
                    title="Expand video"
                    aria-label={`Expand video from ${name}`}
                    onClick={() => setExpanded(true)}
                >
                    <Maximize2 size={17} />
                </button>
            )}
            {!preview && (
                <div className="tile-audio-notices">
                    <AudioPlayback
                        ref={voice}
                        stream={audible}
                        muted={muted}
                        volume={voiceVolume * audioPreferences.outputVolume}
                        output={output}
                        outputLabel={outputLabel}
                        label="Voice"
                        onError={setVoiceError}
                        onOutputFallback={onOutputFallback}
                    />
                    <AudioPlayback
                        ref={program}
                        stream={sharing && watching ? streamAudio : null}
                        muted={muted || !watching}
                        volume={streamVolume * audioPreferences.outputVolume}
                        output={output}
                        outputLabel={outputLabel}
                        label="Stream"
                        onError={setStreamError}
                        onOutputFallback={onOutputFallback}
                    />
                </div>
            )}
            {expanded && hasVideo && allowVideo && (
                <ExpandedVideo
                    stream={visibleStream}
                    name={name}
                    preview={preview}
                    volume={voiceVolume}
                    onVolume={setVoiceVolume}
                    streamVolume={sharing && watching ? streamVolume : undefined}
                    onStreamVolume={setStreamVolume}
                    onStopWatching={sharing && watching ? () => onWatch?.(false) : undefined}
                    audioError={[voiceError, streamError].filter(Boolean).join(' ')}
                    onPlayAudio={retryAudio}
                    onClose={() => setExpanded(false)}
                />
            )}
            <div className="media-tile-overlay">
                <span className="media-name">
                    {name}
                    {muted && !preview ? ' · Deafened' : ''}
                </span>
                {!preview && (
                    <div className="tile-media-controls">
                        <VolumeControl
                            name={name}
                            label="Voice"
                            value={voiceVolume}
                            onChange={setVoiceVolume}
                        />
                        {sharing && (
                            <VolumeControl
                                name={name}
                                label="Stream"
                                value={streamVolume}
                                onChange={setStreamVolume}
                                disabled={!watching}
                            />
                        )}
                    </div>
                )}
            </div>
            {!preview && sharing && (
                <button
                    type="button"
                    className="watch-stream"
                    aria-pressed={watching}
                    disabled={watchPending}
                    onClick={() => onWatch?.(!watching)}
                >
                    {watchPending
                        ? watching
                            ? 'Starting stream…'
                            : 'Stopping stream…'
                        : watching
                          ? 'Stop watching'
                          : 'Watch stream'}
                </button>
            )}
        </div>
    );
}
