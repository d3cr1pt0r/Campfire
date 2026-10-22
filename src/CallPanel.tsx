import { hasPermission } from '../shared/permissions.js';
import type { State, User, Preferences } from './types';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

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
    Phone,
    UserPlus,
    Activity,
    Maximize2,
    Ellipsis,
    Check,
} from 'lucide-react';
import { MediaTile } from './MediaTile';
import { MemberIdentity } from './MemberIdentity';
import { fitCallParticipants } from './callLayout';

export type CallAreaMode = 'split' | 'call' | 'conversation';

export function CallPanel({
    state,
    call,
    prefs,
    speaking,
    callName,
    setModal,
    notify,
    user,
    areaMode,
    onAreaModeChange,
}: {
    state: State;
    call: ReturnType<typeof useCall>;
    prefs: Preferences;
    speaking: Set<string>;
    callName: string;
    setModal: (modal: string | null) => void;
    notify: (message: string) => void;
    user: (id: string) => User | undefined;
    areaMode: CallAreaMode;
    onAreaModeChange: (mode: CallAreaMode) => void;
}) {
    const dock = useRef<HTMLDivElement>(null);
    const splitter = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const toolbar = useRef<HTMLDivElement>(null);
    const optionsMenu = useRef<HTMLDivElement>(null);
    const optionsId = useId();
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
    const [showNonStreaming, setShowNonStreaming] = useState(true);
    const [gridView, setGridView] = useState(true);
    const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
    const drag = useRef<{ pointer: number; y: number; height: number } | null>(null);
    const [workspaceHeight, setWorkspaceHeight] = useState(800);
    const [conversationMinimum, setConversationMinimum] = useState(84);
    const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
    const [resizing, setResizing] = useState(false);
    const [minimum, setMinimum] = useState(76);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const showLocal = showNonStreaming || call.camera || call.sharing;
    const visibleRemote = call.remote.filter(
        (participant) => showNonStreaming || participant.camera || participant.sharing,
    );
    const visibleIds = [...(showLocal ? ['local'] : []), ...visibleRemote.map((p) => p.id)];
    const visibleParticipants = visibleIds.length;
    const selectedId =
        selectedParticipant && visibleIds.includes(selectedParticipant)
            ? selectedParticipant
            : visibleRemote.find((p) => p.sharing)?.id ||
              visibleRemote.find((p) => p.camera)?.id ||
              visibleIds[0];
    const gallery = fitCallParticipants(
        stageSize.width,
        stageSize.height,
        gridView ? visibleParticipants : Math.min(1, visibleParticipants),
    );
    const participantOpacity = Math.max(0, Math.min(1, (stageSize.height - 24) / 96));
    const maximum = Math.max(minimum, workspaceHeight - conversationMinimum);
    const panelOpen = areaMode === 'call' || (areaMode === 'split' && call.panelOpen);
    const height =
        areaMode === 'call'
            ? maximum
            : panelOpen
              ? Math.max(minimum, Math.min(maximum, expandedHeight ?? workspaceHeight * 0.43))
              : minimum;
    const compactLayout = height < minimum + 64;
    const privateCall = call.channel?.startsWith('private:');
    const canInvite = privateCall && hasPermission(state.me, state.roles, 'calls.start');
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
            const splitterHeight = splitter.current?.getBoundingClientRect().height || 8;
            // Include the divider in the compact height so its bottom aligns with the sidebar.
            setMinimum(Math.max(0, headerHeight - splitterHeight));
            setWorkspaceHeight(workspace.clientHeight);
            // Reserve the conversation header and the divider at maximum call height.
            setConversationMinimum(headerHeight + splitterHeight);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(workspace);
        if (splitter.current) observer.observe(splitter.current);
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
        onAreaModeChange('split');
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
        onAreaModeChange('split');
        call.setPanelOpen(!panelOpen);
        if (panelOpen) call.setShowDetails(false);
    };
    return (
        <>
            <div
                ref={dock}
                className={`call-dock ${resizing ? 'resizing' : ''} ${compactLayout ? 'compact' : ''}`}
                style={{ height, '--call-control-count': canInvite ? 7 : 6 } as CSSProperties}
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
                                className="panel-expand"
                                title="Expand call details"
                                aria-label="Expand call details"
                                aria-controls="call-panel"
                                onClick={() => onAreaModeChange('call')}
                            >
                                <Maximize2 size={18} />
                            </button>
                        </div>
                    </div>
                    <div className="call-panel-body" id="call-panel-body">
                        <div
                            className={`call-stage ${gridView ? '' : 'spotlight'}`}
                            ref={stage}
                            inert={compactLayout || participantOpacity === 0}
                            aria-hidden={compactLayout || participantOpacity === 0}
                        >
                            <div
                                className="video-grid"
                                style={
                                    {
                                        width: gallery.width,
                                        height: gridView ? gallery.height : undefined,
                                        display: visibleParticipants === 0 ? 'none' : undefined,
                                        opacity: participantOpacity,
                                        visibility: participantOpacity === 0 ? 'hidden' : 'visible',
                                        '--participant-columns': gallery.columns,
                                        '--participant-rows': gallery.rows,
                                    } as CSSProperties
                                }
                            >
                                <div
                                    className="call-participant"
                                    hidden={!showLocal || (!gridView && selectedId !== 'local')}
                                >
                                    <MediaTile
                                        stream={call.local}
                                        name={`${displayName(state.me)} (you)`}
                                        avatarName={displayName(state.me)}
                                        avatar={state.me.avatar}
                                        speaking={speaking.has(state.me.id)}
                                        muted
                                        microphoneMuted={call.muted}
                                        deafened={call.deafened}
                                        preview
                                    />
                                </div>
                                {call.remote.map((p) => (
                                    <div
                                        className="call-participant"
                                        key={p.id}
                                        hidden={
                                            (!showNonStreaming && !p.camera && !p.sharing) ||
                                            (!gridView && selectedId !== p.id)
                                        }
                                    >
                                        <MediaTile
                                            participant={p.user}
                                            stream={p.stream}
                                            streamAudio={p.streamAudio}
                                            sharing={p.sharing}
                                            cameraActive={p.camera}
                                            watching={p.watching}
                                            watchPending={p.watchPending}
                                            onWatch={(enabled) => call.watch(p.id, enabled)}
                                            onPopoutBlocked={() =>
                                                notify(
                                                    'Allow pop-up windows to pop out this stream.',
                                                )
                                            }
                                            name={displayName(user(p.user)) || 'Member'}
                                            avatar={user(p.user)?.avatar}
                                            speaking={speaking.has(p.user)}
                                            muted={call.deafened}
                                            microphoneMuted={
                                                state.calls.find((member) => member.socket === p.id)
                                                    ?.muted
                                            }
                                            deafened={
                                                state.calls.find((member) => member.socket === p.id)
                                                    ?.deafened
                                            }
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
                            {!gridView && visibleParticipants > 1 && (
                                <div className="call-thumbnails" aria-label="Select a participant">
                                    {visibleIds
                                        .filter((id) => id !== selectedId)
                                        .map((id) => {
                                            const participant = call.remote.find(
                                                (p) => p.id === id,
                                            );
                                            const member =
                                                id === 'local'
                                                    ? state.me
                                                    : user(participant?.user || '');
                                            const name = `${displayName(member, 'Member')}${id === 'local' ? ' (you)' : ''}`;
                                            return (
                                                <button
                                                    key={id}
                                                    className="call-thumbnail"
                                                    title={`Show ${name} in main view`}
                                                    aria-label={`Show ${name} in main view`}
                                                    onClick={() => setSelectedParticipant(id)}
                                                >
                                                    <MemberIdentity
                                                        user={member}
                                                        state={state}
                                                        speaking={speaking.has(member?.id || '')}
                                                        secondary={false}
                                                        showOwner={false}
                                                    />
                                                </button>
                                            );
                                        })}
                                </div>
                            )}
                            {visibleParticipants === 0 && (
                                <p className="call-empty-state" role="status">
                                    No cameras or screen shares to show.
                                </p>
                            )}
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
                                            <MemberIdentity
                                                user={user(detail.user)}
                                                state={state}
                                                secondary={false}
                                            />
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
                                {canInvite && (
                                    <button
                                        title="Invite member"
                                        aria-label="Invite member"
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
                                    title="More call options"
                                    aria-label="More call options"
                                    aria-haspopup="menu"
                                    aria-expanded={optionsOpen}
                                    popoverTarget={optionsId}
                                    onClick={(event) => {
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setMenuPosition({
                                            left: Math.max(
                                                8,
                                                Math.min(rect.right - 280, window.innerWidth - 288),
                                            ),
                                            top: rect.top >= 112 ? rect.top - 104 : rect.bottom + 8,
                                        });
                                    }}
                                >
                                    <Ellipsis />
                                </button>
                                <div
                                    ref={optionsMenu}
                                    id={optionsId}
                                    className="call-options-menu"
                                    popover="auto"
                                    role="menu"
                                    aria-label="Call options"
                                    style={menuPosition}
                                    onToggle={(event) => {
                                        const open = event.newState === 'open';
                                        setOptionsOpen(open);
                                        if (open)
                                            optionsMenu.current
                                                ?.querySelector<HTMLButtonElement>('button')
                                                ?.focus({ preventScroll: true });
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Tab') optionsMenu.current?.hidePopover();
                                        if (
                                            ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                                                event.key,
                                            )
                                        ) {
                                            event.preventDefault();
                                            const items = [
                                                ...(optionsMenu.current?.querySelectorAll<HTMLButtonElement>(
                                                    '[role="menuitemcheckbox"]',
                                                ) || []),
                                            ];
                                            const current = items.findIndex(
                                                (item) => item === document.activeElement,
                                            );
                                            const next =
                                                event.key === 'Home'
                                                    ? 0
                                                    : event.key === 'End'
                                                      ? items.length - 1
                                                      : (current +
                                                            (event.key === 'ArrowDown' ? 1 : -1) +
                                                            items.length) %
                                                        items.length;
                                            items[next]?.focus();
                                        }
                                    }}
                                >
                                    <button
                                        type="button"
                                        role="menuitemcheckbox"
                                        aria-checked={showNonStreaming}
                                        onClick={() => setShowNonStreaming((show) => !show)}
                                    >
                                        <span className="call-option-check">
                                            {showNonStreaming && <Check size={16} />}
                                        </span>
                                        Show participants without video
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitemcheckbox"
                                        aria-checked={gridView}
                                        onClick={() => setGridView((grid) => !grid)}
                                    >
                                        <span className="call-option-check">
                                            {gridView && <Check size={16} />}
                                        </span>
                                        Grid View
                                    </button>
                                </div>
                                <button
                                    title="Connection diagnostics"
                                    aria-label="Connection diagnostics"
                                    aria-expanded={call.showDetails}
                                    aria-controls="call-connection-details"
                                    onClick={() => {
                                        if (!call.showDetails) {
                                            if (areaMode === 'conversation')
                                                onAreaModeChange('split');
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
                ref={splitter}
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
                    panelOpen
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
