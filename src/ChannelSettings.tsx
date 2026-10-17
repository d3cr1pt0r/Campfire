import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronDown, Hash, Volume2 } from 'lucide-react';
import type { State, Channel, ChannelAccess } from './types';
import type { ApiClient } from './api';

type Props = {
    state: State;
    api: ApiClient;
    refresh: () => Promise<void>;
    busy: boolean;
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
                Select a channel to edit its name and role access. Use the arrows to reorder
                channels within each type. Permanent channels can be renamed and reordered.
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
                                        disabled={props.busy || index === 0}
                                        onClick={() => move(channel, 'up')}
                                    >
                                        <ArrowUp size={16} />
                                    </button>
                                    <button
                                        title="Move down"
                                        aria-label={`Move ${channel.name} down`}
                                        disabled={props.busy || index === channels.length - 1}
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

function ChannelEditor({ state, channel, api, refresh, busy, act }: Props & { channel: Channel }) {
    const serialized = JSON.stringify(
        state.channelPermissions.filter((entry) => entry.channel === channel.id),
    );
    const [modes, setModes] = useState<Record<string, ChannelAccess['mode']>>({});
    const [confirming, setConfirming] = useState(false);
    useEffect(() => {
        setModes(
            Object.fromEntries(
                (JSON.parse(serialized) as ChannelAccess[]).map((entry) => [
                    entry.role,
                    entry.mode,
                ]),
            ),
        );
    }, [serialized]);
    return (
        <section className="channel-settings-card" aria-label={`${channel.name} channel settings`}>
            <h3>
                {channel.kind === 'text' ? '#' : '🔊'} {channel.name}{' '}
                {channel.protected && <small>Permanent channel</small>}
            </h3>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    const name = new FormData(event.currentTarget).get('name');
                    void act(async () => {
                        await api(`/channels/${channel.id}`, 'PATCH', { name });
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
                    />
                </label>
                <button className="secondary" disabled={busy}>
                    Rename channel
                </button>
            </form>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () => {
                        await api(`/channels/${channel.id}/access`, 'PUT', {
                            permissions: state.roles
                                .filter((role) => role.id !== 'owner')
                                .map((role) => ({ role: role.id, mode: modes[role.id] || 'full' })),
                        });
                        await refresh();
                    });
                }}
            >
                <p>Owner: full access</p>
                {state.roles
                    .filter((role) => role.id !== 'owner')
                    .map((role) => (
                        <label className="channel-access-row" key={role.id}>
                            <span>{role.name}</span>
                            <select
                                aria-label={`${role.name} access to ${channel.name}`}
                                value={modes[role.id] || 'full'}
                                disabled={busy}
                                onChange={(event) =>
                                    setModes({
                                        ...modes,
                                        [role.id]: event.target.value as ChannelAccess['mode'],
                                    })
                                }
                            >
                                <option value="full">
                                    {channel.kind === 'text' ? 'Full access' : 'Visible'}
                                </option>
                                {channel.kind === 'text' && (
                                    <option value="read-only">Read only</option>
                                )}
                                <option value="hidden">Hidden</option>
                            </select>
                        </label>
                    ))}
                <button className="secondary" disabled={busy}>
                    Save channel access
                </button>
            </form>
            {!channel.protected &&
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
