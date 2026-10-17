import type { State, User, Preferences } from './types';

import type { useCall } from './useCall';

import { displayName } from './profiles';
import { Volume2, MicOff, Mic, Video, VideoOff, MonitorUp, PhoneOff } from 'lucide-react';
import { MediaTile } from './MediaTile';

export function CallPanel({
    state,
    call,
    prefs,
    speaking,
    callName,
    setModal,
    notify,
    user,
}: {
    state: State;
    call: ReturnType<typeof useCall>;
    prefs: Preferences;
    speaking: Set<string>;
    callName: string;
    setModal: (modal: string | null) => void;
    notify: (message: string) => void;
    user: (id: string) => User | undefined;
}) {
    return (
        <section className="call-panel">
            <div className="call-heading">
                <span>
                    <Volume2 size={17} />
                    {callName}
                    <span className="live-badge">LIVE</span>
                </span>
                <small>
                    {state.calls.filter((c) => c.channel === call.channel).length} / 8 connected
                </small>
            </div>
            <div className="video-grid">
                <MediaTile
                    stream={call.local}
                    name={`${displayName(state.me)} (you)`}
                    avatar={state.me.avatar}
                    speaking={speaking.has(state.me.id)}
                    muted
                    preview
                />
                {call.remote.map((p) => (
                    <MediaTile
                        key={p.id}
                        stream={p.stream}
                        streamAudio={p.streamAudio}
                        sharing={p.sharing}
                        cameraActive={p.camera}
                        watching={p.watching}
                        watchPending={p.watchPending}
                        onWatch={(enabled) => call.watch(p.id, enabled)}
                        name={displayName(user(p.user)) || 'Member'}
                        avatar={user(p.user)?.avatar}
                        speaking={speaking.has(p.user)}
                        muted={call.deafened}
                        output={prefs.output}
                        outputLabel={prefs.outputLabel}
                        onOutputFallback={() =>
                            notify(
                                'Saved output unavailable; using System default. Your selection is kept for next time.',
                            )
                        }
                    />
                ))}
            </div>
            <div className="call-controls">
                {call.channel?.startsWith('private:') && (
                    <button onClick={() => setModal('invite-call')}>Invite friend</button>
                )}
                <button
                    className={call.muted ? 'danger-bg' : ''}
                    title="Toggle microphone"
                    onClick={() => call.setMuted(!call.muted)}
                >
                    {call.muted ? <MicOff /> : <Mic />}
                </button>
                <button
                    className={call.camera ? 'enabled' : ''}
                    title="Toggle camera / preview"
                    onClick={() => void call.toggleCamera()}
                >
                    {call.camera ? <Video /> : <VideoOff />}
                </button>
                <button
                    className={call.sharing ? 'enabled' : ''}
                    title="Share screen or window"
                    onClick={() => void call.toggleShare()}
                >
                    <MonitorUp />
                </button>
                <button className="danger-bg" title="Leave call" onClick={call.leave}>
                    <PhoneOff />
                </button>
                {prefs.pushToTalk && <small>Hold Space to talk (outside text fields)</small>}
                <button
                    aria-expanded={call.showDetails}
                    onClick={() => call.setShowDetails(!call.showDetails)}
                >
                    Call details
                </button>
            </div>
            {call.showDetails && (
                <div className="call-details">
                    <p>
                        Microphone:{' '}
                        {call.muted
                            ? 'muted'
                            : call.deafened
                              ? 'deafened'
                              : prefs.pushToTalk
                                ? 'push-to-talk enabled'
                                : 'enabled'}
                        . Speak while checking whether audio levels and packet counts change.
                    </p>
                    {call.details.length ? (
                        call.details.map((detail) => (
                            <div key={detail.id}>
                                <strong>{displayName(user(detail.user)) || 'Participant'}</strong>
                                <span>
                                    Connection: {detail.connection} · ICE: {detail.ice} · Audio:{' '}
                                    {detail.direction}
                                </span>
                                <span>
                                    Sent packets: {detail.sent ?? '—'} · Received packets:{' '}
                                    {detail.received ?? '—'}
                                </span>
                                <span>
                                    Video/system audio bytes sent: {detail.mediaSent ?? '—'} ·
                                    received: {detail.mediaReceived ?? '—'}
                                </span>
                                <span>
                                    Your input level:{' '}
                                    {detail.inputLevel === null
                                        ? 'unavailable'
                                        : (detail.inputLevel * 100).toFixed(1) + '%'}{' '}
                                    · Incoming level:{' '}
                                    {detail.receivedLevel === null
                                        ? 'unavailable'
                                        : (detail.receivedLevel * 100).toFixed(1) + '%'}
                                </span>
                            </div>
                        ))
                    ) : (
                        <p>Waiting for another participant.</p>
                    )}
                    <p>
                        If received packet counts increase but you hear nothing, check incoming
                        level, participant volume and playback/output settings. Packet counts alone
                        do not prove the microphone contains speech.
                    </p>
                </div>
            )}
        </section>
    );
}
