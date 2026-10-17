import type { State, User, Preferences } from './types';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import type { useCall } from './useCall';

import { displayName } from './profiles';
import {
    Volume2,
    MicOff,
    Mic,
    Video,
    VideoOff,
    MonitorUp,
    PhoneOff,
    ChevronDown,
    ChevronUp,
    Phone,
    UserPlus,
    Activity,
} from 'lucide-react';
import { MediaTile } from './MediaTile';
import { fitCallParticipants } from './callLayout';

export function CallPanel({
    state,
    onHide,
    call,
    prefs,
    speaking,
    callName,
    setModal,
    notify,
    user,
}: {
    state: State;
    onHide: () => void;
    call: ReturnType<typeof useCall>;
    prefs: Preferences;
    speaking: Set<string>;
    callName: string;
    setModal: (modal: string | null) => void;
    notify: (message: string) => void;
    user: (id: string) => User | undefined;
}) {
    const dock = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const toolbar = useRef<HTMLDivElement>(null);
    const drag = useRef<{ pointer: number; y: number; height: number } | null>(null);
    const [workspaceHeight, setWorkspaceHeight] = useState(800);
    const [conversationMinimum, setConversationMinimum] = useState(84);
    const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
    const [resizing, setResizing] = useState(false);
    const [minimum, setMinimum] = useState(76);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const gallery = fitCallParticipants(stageSize.width, stageSize.height, call.remote.length + 1);
    const participantOpacity = Math.max(0, Math.min(1, (stageSize.height - 24) / 96));
    const maximum = Math.max(minimum, workspaceHeight - conversationMinimum);
    const height = call.panelOpen
        ? Math.max(minimum, Math.min(maximum, expandedHeight ?? workspaceHeight * 0.43))
        : minimum;
    const compactLayout = height < minimum + 64;
    const privateCall = call.channel?.startsWith('private:');
    const participants = new Set(
        state.calls
            .filter((participant) => participant.channel === call.channel)
            .map((participant) => participant.user),
    ).size;
    useLayoutEffect(() => {
        const workspace = dock.current?.parentElement;
        if (!workspace) return;
        const serverHeading = workspace.closest('.app-shell')?.querySelector('.server-heading');
        const update = () => {
            const headerHeight = serverHeading?.getBoundingClientRect().height || 76;
            setMinimum(headerHeight);
            setWorkspaceHeight(workspace.clientHeight);
            // The conversation can collapse to its header. The divider is 8px.
            setConversationMinimum(headerHeight + 8);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(workspace);
        if (serverHeading) observer.observe(serverHeading);
        return () => observer.disconnect();
    });
    useLayoutEffect(() => {
        if (!stage.current) return;
        const observer = new ResizeObserver(([entry]) => {
            setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(stage.current);
        return () => observer.disconnect();
    }, []);
    const resize = (requested: number) => {
        const next = Math.max(minimum, Math.min(maximum, requested));
        if (next <= minimum) {
            call.setPanelOpen(false);
            call.setShowDetails(false);
        } else {
            setExpandedHeight(next);
            call.setPanelOpen(true);
        }
    };
    const toggle = () => {
        if (call.panelOpen) onHide();
        else call.setPanelOpen(true);
    };
    return (
        <>
            <div
                ref={dock}
                className={`call-dock ${resizing ? 'resizing' : ''} ${compactLayout ? 'compact' : ''}`}
                style={{ height }}
            >
                <section id="call-panel" className="call-panel" aria-label="Call details">
                    <div className="call-heading">
                        <div className="call-identity">
                            {privateCall ? <Phone size={20} /> : <Volume2 size={20} />}
                            <div className="call-summary-copy">
                                <strong title={callName}>{callName}</strong>
                                <small
                                    title={`${privateCall ? 'Private call' : 'Voice channel'} · ${participants} / 8 connected`}
                                >
                                    <span className="call-summary-kind">
                                        {privateCall ? 'Private call' : 'Voice channel'} ·{' '}
                                    </span>
                                    {participants} / 8 connected
                                </small>
                            </div>
                        </div>
                        <div className="call-heading-actions">
                            <span className="live-badge">LIVE</span>
                            <button
                                aria-label={
                                    call.panelOpen ? 'Hide call details' : 'Show call details'
                                }
                                title={call.panelOpen ? 'Hide call details' : 'Show call details'}
                                aria-expanded={call.panelOpen}
                                aria-controls="call-panel-body"
                                onClick={toggle}
                            >
                                {call.panelOpen ? (
                                    <ChevronUp size={18} />
                                ) : (
                                    <ChevronDown size={18} />
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="call-panel-body" id="call-panel-body">
                        <div
                            className="call-stage"
                            ref={stage}
                            inert={compactLayout || participantOpacity === 0}
                            aria-hidden={compactLayout || participantOpacity === 0}
                        >
                            <div
                                className="video-grid"
                                style={
                                    {
                                        width: gallery.width,
                                        opacity: participantOpacity,
                                        visibility: participantOpacity === 0 ? 'hidden' : 'visible',
                                        '--participant-scale': gallery.scale,
                                    } as CSSProperties
                                }
                            >
                                <div className="call-participant">
                                    <MediaTile
                                        stream={call.local}
                                        name={`${displayName(state.me)} (you)`}
                                        avatarName={displayName(state.me)}
                                        avatar={state.me.avatar}
                                        speaking={speaking.has(state.me.id)}
                                        muted
                                        preview
                                    />
                                </div>
                                {call.remote.map((p) => (
                                    <div className="call-participant" key={p.id}>
                                        <MediaTile
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
                                    </div>
                                ))}
                            </div>
                        </div>
                        {call.showDetails && (
                            <div
                                className="call-details"
                                id="call-connection-details"
                                tabIndex={0}
                                role="region"
                                aria-label="Connection diagnostics"
                            >
                                <p>
                                    Microphone:{' '}
                                    {!call.canSpeak
                                        ? 'listen only (speaking not permitted)'
                                        : call.muted
                                          ? 'muted'
                                          : call.deafened
                                            ? 'deafened'
                                            : prefs.pushToTalk
                                              ? 'push-to-talk enabled'
                                              : 'enabled'}
                                    . Speak while checking whether audio levels and packet counts
                                    change.
                                </p>
                                {call.details.length ? (
                                    call.details.map((detail) => (
                                        <div key={detail.id}>
                                            <strong>
                                                {displayName(user(detail.user)) || 'Participant'}
                                            </strong>
                                            <span>
                                                Connection: {detail.connection} · ICE: {detail.ice}{' '}
                                                · Audio: {detail.direction}
                                            </span>
                                            <span>
                                                Sent packets: {detail.sent ?? '—'} · Received
                                                packets: {detail.received ?? '—'}
                                            </span>
                                            <span>
                                                Video/system audio bytes sent:{' '}
                                                {detail.mediaSent ?? '—'} · received:{' '}
                                                {detail.mediaReceived ?? '—'}
                                            </span>
                                            <span>
                                                Your input level:{' '}
                                                {detail.inputLevel === null
                                                    ? 'unavailable'
                                                    : (detail.inputLevel * 100).toFixed(1) +
                                                      '%'}{' '}
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
                                    If received packet counts increase but you hear nothing, check
                                    incoming level, participant volume and playback/output settings.
                                    Packet counts alone do not prove the microphone contains speech.
                                </p>
                            </div>
                        )}
                        <div
                            className="call-toolbar"
                            ref={toolbar}
                            title={
                                prefs.pushToTalk
                                    ? 'Hold Space to talk (outside text fields)'
                                    : undefined
                            }
                        >
                            <div className="call-controls">
                                {call.channel?.startsWith('private:') &&
                                    (state.me.role === 'owner' ||
                                        state.roles
                                            .find((r) => r.id === state.me.role)
                                            ?.permissions.includes('calls.start')) && (
                                        <button
                                            title="Invite friend"
                                            aria-label="Invite friend"
                                            onClick={() => setModal('invite-call')}
                                        >
                                            <UserPlus />
                                        </button>
                                    )}
                                <button
                                    className={call.muted ? 'danger-bg' : ''}
                                    disabled={!call.canSpeak}
                                    title={call.muted ? 'Unmute microphone' : 'Mute microphone'}
                                    aria-label={
                                        call.muted ? 'Unmute microphone' : 'Mute microphone'
                                    }
                                    aria-pressed={!call.muted}
                                    onClick={() => call.setMuted(!call.muted)}
                                >
                                    {call.muted ? <MicOff /> : <Mic />}
                                </button>
                                <button
                                    className={call.camera ? 'enabled' : ''}
                                    disabled={!call.canCamera}
                                    title={call.camera ? 'Turn off camera' : 'Turn on camera'}
                                    aria-label={call.camera ? 'Turn off camera' : 'Turn on camera'}
                                    aria-pressed={call.camera}
                                    onClick={() => void call.toggleCamera()}
                                >
                                    {call.camera ? <Video /> : <VideoOff />}
                                </button>
                                <button
                                    className={call.sharing ? 'enabled' : ''}
                                    disabled={!call.canShare}
                                    title={
                                        call.sharing
                                            ? 'Stop screen sharing'
                                            : 'Share screen or window'
                                    }
                                    aria-label={
                                        call.sharing
                                            ? 'Stop screen sharing'
                                            : 'Share screen or window'
                                    }
                                    aria-pressed={call.sharing}
                                    onClick={() => void call.toggleShare()}
                                >
                                    <MonitorUp />
                                </button>
                                <button
                                    className="danger-bg"
                                    title="Leave call"
                                    onClick={call.leave}
                                >
                                    <PhoneOff />
                                </button>
                                <button
                                    title="Connection diagnostics"
                                    aria-label="Connection diagnostics"
                                    aria-expanded={call.showDetails}
                                    aria-controls="call-connection-details"
                                    onClick={() => {
                                        if (!call.showDetails) {
                                            setExpandedHeight((previous) =>
                                                Math.max(
                                                    previous ?? workspaceHeight * 0.43,
                                                    minimum + 180,
                                                ),
                                            );
                                            call.setPanelOpen(true);
                                        }
                                        call.setShowDetails(!call.showDetails);
                                    }}
                                >
                                    <Activity />
                                </button>
                            </div>
                            {prefs.pushToTalk && (
                                <small className="call-push-hint">
                                    Hold Space to talk (outside text fields)
                                </small>
                            )}
                        </div>
                    </div>
                </section>
            </div>
            <div
                className={`call-splitter ${resizing ? 'resizing' : ''}`}
                role="separator"
                tabIndex={0}
                aria-label="Resize call and conversation sections"
                aria-orientation="horizontal"
                aria-controls="call-panel"
                aria-valuemin={minimum}
                aria-valuemax={Math.round(maximum)}
                aria-valuenow={Math.round(height)}
                aria-valuetext={
                    call.panelOpen
                        ? `Call details ${Math.round(height)} pixels high`
                        : 'Compact call information'
                }
                title="Drag to resize call details · Arrow keys to resize · Home to collapse"
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.focus();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { pointer: event.pointerId, y: event.clientY, height };
                    setResizing(true);
                }}
                onPointerMove={(event) => {
                    const start = drag.current;
                    if (start?.pointer === event.pointerId)
                        resize(start.height + event.clientY - start.y);
                }}
                onPointerUp={(event) => {
                    if (drag.current?.pointer !== event.pointerId) return;
                    drag.current = null;
                    setResizing(false);
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onLostPointerCapture={() => {
                    drag.current = null;
                    setResizing(false);
                }}
                onKeyDown={(event) => {
                    const step = event.shiftKey ? 80 : 20;
                    const requested =
                        event.key === 'ArrowDown'
                            ? height + step
                            : event.key === 'ArrowUp'
                              ? height - step
                              : event.key === 'Home'
                                ? minimum
                                : event.key === 'End'
                                  ? maximum
                                  : null;
                    if (requested === null) return;
                    event.preventDefault();
                    resize(requested);
                }}
                onDoubleClick={toggle}
            >
                <span />
            </div>
        </>
    );
}
