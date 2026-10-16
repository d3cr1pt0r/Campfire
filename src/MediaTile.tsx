import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { AuthImage } from './ChatContent';
import { ExpandedVideo } from './ExpandedVideo';
import { AudioPlayback, type AudioPlaybackHandle } from './AudioPlayback';
import { syncPlaybackTracks } from './playback';

export function MediaTile({ stream, streamAudio = null, sharing = false, cameraActive = false, watching = false, watchPending = false, onWatch, name, muted = false, preview = false, output = '', outputLabel = '', avatar, speaking = false, onOutputFallback }: {
    stream: MediaStream | null;
    streamAudio?: MediaStream | null;
    sharing?: boolean;
    cameraActive?: boolean;
    watching?: boolean;
    watchPending?: boolean;
    onWatch?: (enabled: boolean) => void;
    name: string;
    muted?: boolean;
    preview?: boolean;
    output?: string;
    outputLabel?: string;
    avatar?: string | null;
    speaking?: boolean;
    onOutputFallback?: () => void;
}) {
    const voice=useRef<AudioPlaybackHandle>(null),program=useRef<AudioPlaybackHandle>(null),videoRef=useRef<HTMLVideoElement>(null);
    const [voiceVolume,setVoiceVolume]=useState(1),[streamVolume,setStreamVolume]=useState(1);
    const [voiceError,setVoiceError]=useState(''),[streamError,setStreamError]=useState('');
    const [hasVideo,setHasVideo]=useState(false),[expanded,setExpanded]=useState(false);
    const voiceTrack=preview?undefined:stream?.getAudioTracks()[0];
    const audible=useMemo(()=>new MediaStream(voiceTrack?[voiceTrack]:[]),[voiceTrack]);
    const visibleStream=useMemo(()=>new MediaStream(),[stream]);
    const allowVideo=preview || (sharing?watching:cameraActive);
    useEffect(()=>{if(!hasVideo || !allowVideo)setExpanded(false);},[hasVideo,allowVideo]);
    useEffect(()=>{
        const video=videoRef.current;if(!video)return;
        let active=true;
        const audio=audible,visible=visibleStream;
        video.srcObject=visible;
        const observed=new Set<MediaStreamTrack>();
        const update=()=>{
            if(!active)return;
            const tracks=(stream?.getTracks() || []).filter(t=>t.readyState!=='ended' && (t.kind!=='video' || allowVideo));
            for(const track of tracks)if(!observed.has(track)){
                observed.add(track);track.addEventListener('mute',update);track.addEventListener('unmute',update);track.addEventListener('ended',update);
            }
            syncPlaybackTracks(audio,visible,tracks,preview);
            setHasVideo(visible.getVideoTracks().some(track=>!track.muted));
            if(visible.getVideoTracks().length)void video.play().catch(()=>{});
        };
        stream?.addEventListener('addtrack',update);stream?.addEventListener('removetrack',update);update();
        return ()=>{
            active=false;stream?.removeEventListener('addtrack',update);stream?.removeEventListener('removetrack',update);
            observed.forEach(track=>{track.removeEventListener('mute',update);track.removeEventListener('unmute',update);track.removeEventListener('ended',update);});
            video.pause();video.srcObject=null;
        };
    },[stream,preview,allowVideo,audible,visibleStream]);
    const initials=name.split(/[ -]/).map(word=>word[0]).join('').slice(0,2).toUpperCase();
    const retryAudio=()=>{void voice.current?.play();void program.current?.play();};
    return <div className={`media-tile ${preview?'preview':''} ${speaking?'speaking':''}`}>
        <div className="media-placeholder">{avatar?<AuthImage path={`/avatars/${avatar}`} alt={name} className="call-avatar"/>:initials}<small>{preview?'Your video preview':sharing&&!watching?'Screen share available':'Call participant'}</small></div>
        <video style={{opacity:hasVideo&&allowVideo?1:0}} ref={videoRef} autoPlay playsInline muted title={hasVideo?'Double-click to expand video':undefined} onDoubleClick={()=>{if(hasVideo)setExpanded(true);}}/>
        {hasVideo && allowVideo && <button type="button" className="expand-video" title="Expand video" aria-label={`Expand video from ${name}`} onClick={()=>setExpanded(true)}><Maximize2 size={17}/></button>}
        {!preview && <div className="tile-audio-notices">
            <AudioPlayback ref={voice} stream={audible} muted={muted} volume={voiceVolume} output={output} outputLabel={outputLabel} label="Voice" onError={setVoiceError} onOutputFallback={onOutputFallback}/>
            <AudioPlayback ref={program} stream={sharing&&watching?streamAudio:null} muted={muted || !watching} volume={streamVolume} output={output} outputLabel={outputLabel} label="Stream" onError={setStreamError} onOutputFallback={onOutputFallback}/>
        </div>}
        {expanded && hasVideo && allowVideo && <ExpandedVideo stream={visibleStream} name={name} preview={preview} volume={voiceVolume} onVolume={setVoiceVolume} streamVolume={sharing&&watching?streamVolume:undefined} onStreamVolume={setStreamVolume} onStopWatching={sharing&&watching?()=>onWatch?.(false):undefined} audioError={[voiceError,streamError].filter(Boolean).join(' ')} onPlayAudio={retryAudio} onClose={()=>setExpanded(false)}/>}
        <span className="media-name">{name}{muted&&!preview?' · Deafened':''}</span>
        {!preview && <div className="tile-media-controls">
            {sharing && <button type="button" className="watch-stream" aria-pressed={watching} disabled={watchPending} onClick={()=>onWatch?.(!watching)}>{watchPending?(watching?'Starting stream…':'Stopping stream…'):watching?'Stop watching':'Watch stream'}</button>}
            <label>Voice<input aria-label={`Voice volume for ${name}`} type="range" min="0" max="1" step="0.01" value={voiceVolume} onChange={event=>setVoiceVolume(Number(event.target.value))}/></label>
            {sharing && <label>Stream<input aria-label={`Stream volume for ${name}`} type="range" min="0" max="1" step="0.01" disabled={!watching} value={streamVolume} onChange={event=>setStreamVolume(Number(event.target.value))}/></label>}
        </div>}
    </div>;
}
