import { Toggle } from './forms';
import { useRef, useState } from 'react';
import { GripVertical, ChevronDown, Hash, Volume2 } from 'lucide-react';
import type { State, Channel } from './types';
import type { ApiClient } from './api';

type Props = {
    state: State;
    api: ApiClient;
    refresh: () => Promise<void>;
    busy: boolean;
    permission: (name: string) => boolean;
    act: (fn: () => Promise<unknown>) => Promise<void>;
};
export function ChannelSettings(props: Props) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const [dragged, setDragged] = useState<string | null>(null);
    const source = useRef<string | null>(null);
    const [destination, setDestination] = useState<{
        id: string;
        placement: 'before' | 'after';
    } | null>(null);
    const [reordering, setReordering] = useState(false);
    const resetDrag = () => {
        source.current = null;
        setDragged(null);
        setDestination(null);
    };
    const drop = (sourceId: string, target: string, placement: 'before' | 'after' = 'before') => {
        resetDrag();
        setReordering(true);
        void props.act(async () => {
            try {
                await props.api(`/channels/${sourceId}/drop`, 'POST', { target, placement });
                await props.refresh();
            } finally {
                setReordering(false);
            }
        });
    };
    return (
        <div className="channel-settings-list" aria-busy={reordering}>
            <span className="sr-only" role="status">
                {reordering
                    ? 'Saving channel order…'
                    : destination
                      ? `Move ${props.state.channels.find((c) => c.id === dragged)?.name} ${destination.placement} ${props.state.channels.find((c) => c.id === destination.id)?.name}`
                      : ''}
            </span>
            <p className="muted">
                Select a channel to edit its name and description. Channel access is configured in
                Roles & permissions. Drag the handles to reorder channels within each type. The
                highlighted line shows where the channel will be inserted. Focus a handle and use
                Alt + Arrow keys to reorder with the keyboard. Permanent channels can be renamed and
                reordered.
            </p>
            {(['text', 'voice'] as const).map((kind) => {
                const channels = props.state.channels.filter((channel) => channel.kind === kind);
                return (
                    <section key={kind} aria-label={`${kind} channel settings`}>
                        <h3>{kind === 'text' ? 'Text channels' : 'Voice channels'}</h3>
                        {channels.map((channel, index) => (
                            <div
                                className={`channel-settings-item ${dragged === channel.id ? 'is-dragging' : ''} ${destination?.id === channel.id ? `drop-${destination.placement}` : ''}`}
                                key={channel.id}
                                onDragOver={(event) => {
                                    const id = source.current;
                                    if (
                                        props.busy ||
                                        reordering ||
                                        !id ||
                                        id === channel.id ||
                                        !channels.some((c) => c.id === id)
                                    )
                                        return;
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = 'move';
                                    const rect = event.currentTarget
                                        .querySelector('.channel-settings-summary')!
                                        .getBoundingClientRect();
                                    const placement =
                                        event.clientY < rect.top + rect.height / 2
                                            ? 'before'
                                            : 'after';
                                    setDestination((previous) =>
                                        previous?.id === channel.id &&
                                        previous.placement === placement
                                            ? previous
                                            : { id: channel.id, placement },
                                    );
                                }}
                                onDragLeave={(event) => {
                                    if (
                                        !(event.relatedTarget instanceof Node) ||
                                        !event.currentTarget.contains(event.relatedTarget)
                                    )
                                        setDestination((previous) =>
                                            previous?.id === channel.id ? null : previous,
                                        );
                                }}
                                onDrop={(event) => {
                                    const id = source.current;
                                    if (
                                        props.busy ||
                                        reordering ||
                                        !id ||
                                        id === channel.id ||
                                        !channels.some((c) => c.id === id)
                                    )
                                        return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const rect = event.currentTarget
                                        .querySelector('.channel-settings-summary')!
                                        .getBoundingClientRect();
                                    drop(
                                        id,
                                        channel.id,
                                        event.clientY < rect.top + rect.height / 2
                                            ? 'before'
                                            : 'after',
                                    );
                                }}
                            >
                                <div className="channel-settings-summary">
                                    <button
                                        className="channel-settings-expand"
                                        aria-expanded={expanded === channel.id}
                                        aria-controls={`channel-editor-${channel.id}`}
                                        onClick={() =>
                                            setExpanded(expanded === channel.id ? null : channel.id)
                                        }
                                    >
                                        {kind === 'text' ? (
                                            <Hash size={17} />
                                        ) : (
                                            <Volume2 size={17} />
                                        )}
                                        <span>{channel.name}</span>
                                        {channel.protected && <small>Permanent</small>}
                                        <ChevronDown size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        className="channel-drag-handle"
                                        title="Drag to reorder · Alt + Arrow keys"
                                        aria-label={`Reorder ${channel.name}`}
                                        disabled={
                                            props.busy ||
                                            reordering ||
                                            !props.permission('channels.reorder')
                                        }
                                        draggable={
                                            !props.busy &&
                                            !reordering &&
                                            props.permission('channels.reorder')
                                        }
                                        onDragStart={(event) => {
                                            source.current = channel.id;
                                            setDragged(channel.id);
                                            setExpanded(null);
                                            event.dataTransfer.setData('text/plain', channel.id);
                                            event.dataTransfer.effectAllowed = 'move';
                                        }}
                                        onDragEnd={resetDrag}
                                        onKeyDown={(event) => {
                                            if (
                                                !event.altKey ||
                                                !['ArrowUp', 'ArrowDown'].includes(event.key)
                                            )
                                                return;
                                            event.preventDefault();
                                            const next = index + (event.key === 'ArrowUp' ? -1 : 1);
                                            if (next < 0 || next >= channels.length) return;
                                            if (event.key === 'ArrowUp')
                                                drop(channel.id, channels[next].id);
                                            else drop(channel.id, channels[next].id, 'after');
                                        }}
                                    >
                                        <GripVertical size={18} />
                                    </button>
                                </div>
                                {expanded === channel.id && (
                                    <div id={`channel-editor-${channel.id}`}>
                                        <ChannelEditor {...props} channel={channel} />
                                    </div>
                                )}
                            </div>
                        ))}
                    </section>
                );
            })}
        </div>
    );
}

function ChannelEditor({
    channel,
    api,
    refresh,
    busy,
    act,
    permission,
}: Props & { channel: Channel }) {
    const [confirming, setConfirming] = useState(false);
    return (
        <section className="channel-settings-card" aria-label={`${channel.name} channel settings`}>
            <h3>
                {channel.kind === 'text' ? '#' : '🔊'} {channel.name}{' '}
                {channel.protected && <small>Permanent channel</small>}
            </h3>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const name = form.get('name');
                    void act(async () => {
                        await api(`/channels/${channel.id}`, 'PATCH', {
                            name,
                            ...(channel.kind === 'text'
                                ? { description: form.get('description') }
                                : {}),
                        });
                        await refresh();
                    });
                }}
            >
                <label>
                    Channel name
                    <input
                        name="name"
                        key={channel.name}
                        defaultValue={channel.name}
                        required
                        maxLength={32}
                        disabled={!permission('channels.edit') || busy}
                    />
                </label>
                {channel.kind === 'text' && (
                    <label>
                        Channel description
                        <input
                            name="description"
                            key={`${channel.id}:${channel.description}`}
                            defaultValue={channel.description}
                            maxLength={200}
                            disabled={!permission('channels.edit') || busy}
                            placeholder="What is this channel for?"
                        />
                        <span className="field-help">
                            Shown next to the channel name. Leave empty to hide it. Up to 200
                            characters.
                        </span>
                    </label>
                )}
                <button className="secondary" disabled={busy || !permission('channels.edit')}>
                    Save channel
                </button>
            </form>
            {permission('channels.access') && (
                <div className="channel-privacy">
                    <Toggle
                        title="Private channel"
                        value={channel.private}
                        set={(value) =>
                            void act(async () => {
                                await api(`/channels/${channel.id}/privacy`, 'PATCH', {
                                    private: value,
                                });
                                await refresh();
                            })
                        }
                    />
                    <p className="muted">
                        Private channels are hidden by default, including from newly created roles.
                        Grant View channels explicitly in Roles & permissions.
                    </p>
                </div>
            )}
            {channel.kind === 'text' && permission('channels.edit') && (
                <Toggle
                    title="Show who reacted in this channel"
                    value={channel.reactionAuthors !== 0 && channel.reactionAuthors !== false}
                    set={(value) =>
                        void act(async () => {
                            await api(`/channels/${channel.id}`, 'PATCH', {
                                reactionAuthors: value,
                            });
                            await refresh();
                        })
                    }
                />
            )}
            {!channel.protected &&
                permission('channels.delete') &&
                (confirming ? (
                    <div className="channel-delete-confirm">
                        <p>
                            Delete {channel.name}
                            {channel.kind === 'text'
                                ? ' and all its messages and attachments'
                                : ' and disconnect everyone in it'}
                            ? This cannot be undone.
                        </p>
                        <button disabled={busy} onClick={() => setConfirming(false)}>
                            Cancel
                        </button>
                        <button
                            className="danger-bg"
                            disabled={busy}
                            onClick={() =>
                                void act(async () => {
                                    await api(`/channels/${channel.id}`, 'DELETE');
                                    await refresh();
                                })
                            }
                        >
                            Confirm deletion
                        </button>
                    </div>
                ) : (
                    <button
                        className="danger-text"
                        disabled={busy}
                        onClick={() => setConfirming(true)}
                    >
                        Delete channel
                    </button>
                ))}
        </section>
    );
}
