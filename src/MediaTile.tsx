import { useCallback, useEffect, useRef, useState } from 'react';
import { playbackError, selectAudioOutput, syncPlaybackTracks } from './playback';

export function MediaTile({ stream, name, muted = false, preview = false, output = '', onOutputFallback }: {
    stream: MediaStream | null;
    name: string;
    muted?: boolean;
    preview?: boolean;
    output?: string;
    onOutputFallback?: () => void;
}) {
    const audioRef = useRef<HTMLAudioElement>(null), videoRef = useRef<HTMLVideoElement>(null);
    const [volume, setVolume] = useState(1), [audioError, setAudioError] = useState(''), [outputNotice, setOutputNotice] = useState('');
    const [hasVideo, setHasVideo] = useState(false);
    const fallback = useRef(onOutputFallback); fallback.current = onOutputFallback;
    const outputQueue = useRef(Promise.resolve());
    const playbackVersion = useRef(0);
    const playAudio = useCallback(async () => {
        const audio = audioRef.current;
        if (!audio || !(audio.srcObject as MediaStream | null)?.getAudioTracks().length) return;
        const version = ++playbackVersion.current, source = audio.srcObject;
        try { await audio.play(); if (version === playbackVersion.current && audio.srcObject === source) setAudioError(''); }
        catch (error) { if (version === playbackVersion.current && audio.srcObject === source) setAudioError(playbackError(error)); }
    }, []);
    useEffect(() => {
        const audio = audioRef.current, video = videoRef.current;
        if (!audio || !video) return;
        let active = true;
        const audible = new MediaStream(), visible = new MediaStream();
        // Video/camera track changes cannot replace or mute the audio element.
        audio.srcObject = audible;
        video.srcObject = visible;
        const observed = new Set<MediaStreamTrack>();
        const update = () => {
            if (!active) return;
            const tracks = (stream?.getTracks() || []).filter(track => track.readyState !== 'ended');
            for (const track of tracks) if (!observed.has(track)) {
                observed.add(track);
                track.addEventListener('mute', update);
                track.addEventListener('unmute', update);
                track.addEventListener('ended', update);
            }
            syncPlaybackTracks(audible, visible, tracks, preview);
            setHasVideo(visible.getVideoTracks().some(track => !track.muted));
            if (audible.getAudioTracks().length) void playAudio();
            if (visible.getVideoTracks().length) void video.play().catch(() => {});
        };
        stream?.addEventListener('addtrack', update);
        stream?.addEventListener('removetrack', update);
        update();
        return () => {
            active = false;
            playbackVersion.current++;
            stream?.removeEventListener('addtrack', update);
            stream?.removeEventListener('removetrack', update);
            observed.forEach(track => { track.removeEventListener('mute', update); track.removeEventListener('unmute', update); track.removeEventListener('ended', update); });
            audio.pause(); audio.srcObject = null;
            video.pause(); video.srcObject = null;
        };
    }, [stream, preview, playAudio]);
    useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
    useEffect(() => {
        if (preview) return;
        let canceled = false;
        outputQueue.current = outputQueue.current.catch(() => {}).then(async () => {
            const audio = audioRef.current;
            if (canceled || !audio) return;
            try {
                const reset = await selectAudioOutput(audio, output);
                if (canceled) return;
                setOutputNotice(reset ? 'Saved output unavailable; using System default.' : '');
                if (reset) fallback.current?.();
            } catch (error) {
                if (!canceled) setOutputNotice(`Cannot select audio output [${(error as Error).name || 'Error'}]. Choose System default in Settings → Voice & video.`);
            }
        });
        return () => { canceled = true; };
    }, [output, preview]);
    const initials = name.split(/[ -]/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
    return <div className={`media-tile ${preview ? 'preview' : ''}`}>
        <div className="media-placeholder">{initials}<small>{preview ? 'Your camera preview' : 'Call participant'}</small></div>
        <audio ref={audioRef} autoPlay muted={muted || preview} />
        <video style={{ opacity: hasVideo ? 1 : 0 }} ref={videoRef} autoPlay playsInline muted />
        <span className="media-name">{name}{muted && !preview ? ' · Deafened' : ''}</span>
        {(audioError || outputNotice) && <div className="media-notices" role="status">
            {audioError && <><span>{audioError}</span><button onClick={() => void playAudio()}>Play audio</button></>}
            {outputNotice && <span>{outputNotice}</span>}
        </div>}
        {!preview && <input className="volume-slider" aria-label={`Volume for ${name}`} title={`Participant volume: ${Math.round(volume * 100)}%`} type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))} />}
    </div>;
}
