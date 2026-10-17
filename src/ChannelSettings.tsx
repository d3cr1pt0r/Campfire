import { useState } from 'react';
import { ArrowUp, ArrowDown, ChevronDown, Hash, Volume2 } from 'lucide-react';
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
    const move = (channel: Channel, direction: 'up' | 'down') =>
        void props.act(async () => {
            await props.api(`/channels/${channel.id}/move`, 'POST', { direction });
            await props.refresh();
        });
    return (
        <div className="channel-settings-list">
            <p className="muted">
                Select a channel to edit its name and description. Channel access is configured in
                Roles & permissions. Use the arrows to reorder channels within each type. Permanent
                channels can be renamed and reordered.
            </p>
            {(['text', 'voice'] as const).map((kind) => {
                const channels = props.state.channels.filter((channel) => channel.kind === kind);
                return (
                    <section key={kind} aria-label={`${kind} channel settings`}>
                        <h3>{kind === 'text' ? 'Text channels' : 'Voice channels'}</h3>
                        {channels.map((channel, index) => (
                            <div className="channel-settings-item" key={channel.id}>
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
                                        title="Move up"
                                        aria-label={`Move ${channel.name} up`}
                                        disabled={
                                            props.busy ||
                                            !props.permission('channels.reorder') ||
                                            index === 0
                                        }
                                        onClick={() => move(channel, 'up')}
                                    >
                                        <ArrowUp size={16} />
                                    </button>
                                    <button
                                        title="Move down"
                                        aria-label={`Move ${channel.name} down`}
                                        disabled={
                                            props.busy ||
                                            !props.permission('channels.reorder') ||
                                            index === channels.length - 1
                                        }
                                        onClick={() => move(channel, 'down')}
                                    >
                                        <ArrowDown size={16} />
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
