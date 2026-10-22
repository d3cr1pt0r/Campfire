import { useDialog } from './useDialog';
import { useState, useRef } from 'react';
import { Plus, Hash, Volume2, Folder, ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import type { State, Channel, Category } from './types';
import type { ApiClient } from './api';
import { Toggle } from './forms';
import { ChannelTree } from './ChannelTree';
import { CategoryEditor } from './CategorySettings';
import { ScopePermissions } from './ScopePermissions';
import { RetentionField } from './RetentionSettings';
import { settlePolicy } from '../shared/retention.js';

type Props = {
    state: State;
    api: ApiClient;
    refresh: () => Promise<void>;
    busy: boolean;
    permission: (name: string) => boolean;
    act: (fn: () => Promise<unknown>) => Promise<void>;
    initialSelection?: string;
};
export function ChannelSettings(props: Props) {
    const { state, api, refresh, busy, act, permission } = props;
    const [selected, setSelected] = useState(
        props.initialSelection ||
            (state.categories?.[0]
                ? `category:${state.categories[0].id}`
                : state.channels[0]?.id || ''),
    );
    const [tab, setTab] = useState<'overview' | 'permissions'>('permissions');
    const [creating, setCreating] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [pending, setPending] = useState<{
        id?: string;
        tab?: 'overview' | 'permissions';
    } | null>(null);
    const dialog = useRef<HTMLElement | null>(null);
    useDialog(dialog, () => setPending(null), !!pending);
    const chooseTab = (value: 'overview' | 'permissions') => {
        if (dirty && value !== tab) setPending({ tab: value });
        else setTab(value);
    };
    const channel = state.channels.find((entry) => entry.id === selected);
    const category = state.categories?.find((entry) => `category:${entry.id}` === selected);
    const parent = state.categories?.find((entry) => entry.id === channel?.category);
    const scope = channel || category;
    const select = (id: string) => {
        if (dirty && id !== selected) {
            setPending({ id });
            return;
        }
        setSelected(id);
        setCreating(false);
    };
    return (
        <div className="channel-workspace">
            {pending && (
                <div className="move-policy-backdrop">
                    <section
                        ref={dialog}
                        className="move-policy-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="unsaved-permissions-title"
                    >
                        <h3 id="unsaved-permissions-title">Unsaved permission changes</h3>
                        <p>Save your changes before leaving, or discard them to continue.</p>
                        <button className="primary" onClick={() => setPending(null)}>
                            Keep editing
                        </button>
                        <button
                            onClick={() => {
                                if (pending.id) setSelected(pending.id);
                                if (pending.tab) setTab(pending.tab);
                                setDirty(false);
                                setPending(null);
                            }}
                        >
                            Discard changes
                        </button>
                    </section>
                </div>
            )}
            <div className="organizer-toolbar">
                <div>
                    <h3>Channels & categories</h3>
                    <p>Drag to reorder or move channels into a category.</p>
                </div>
                {permission('channels.create') && (
                    <button className="secondary" onClick={() => setCreating(!creating)}>
                        <Plus size={15} />
                        New
                    </button>
                )}
            </div>
            {creating && (
                <CreateItem
                    {...props}
                    category={category || parent}
                    done={(id) => {
                        setCreating(false);
                        setSelected(id);
                    }}
                />
            )}
            <div className="organizer-layout">
                <div className="organizer-outline">
                    <ChannelTree {...props} mode="settings" selected={selected} select={select} />
                </div>
                <section className="organizer-inspector" aria-label="Selected channel or category">
                    {scope ? (
                        <>
                            <header className="inspector-heading">
                                <span className="inspector-kind">
                                    {category ? 'Category' : parent?.name || 'Uncategorized'}
                                </span>
                                <h3>
                                    {category ? (
                                        <Folder size={19} />
                                    ) : channel?.kind === 'voice' ? (
                                        <Volume2 size={19} />
                                    ) : (
                                        <Hash size={19} />
                                    )}
                                    {scope.name}
                                </h3>
                            </header>
                            <div
                                className="inspector-tabs"
                                role="tablist"
                                aria-label="Channel settings section"
                            >
                                <button
                                    role="tab"
                                    aria-selected={tab === 'overview'}
                                    onClick={() => chooseTab('overview')}
                                >
                                    Overview
                                </button>
                                <button
                                    role="tab"
                                    aria-selected={tab === 'permissions'}
                                    onClick={() => chooseTab('permissions')}
                                >
                                    Permissions
                                </button>
                            </div>
                            <div className="inspector-body" key={`${selected}:${tab}`}>
                                {tab === 'overview' ? (
                                    category ? (
                                        <CategoryEditor {...props} category={category} />
                                    ) : (
                                        channel && <ChannelEditor {...props} channel={channel} />
                                    )
                                ) : (
                                    <>
                                        {category && (
                                            <div className="permission-source-card">
                                                <ShieldCheck size={19} />
                                                <div>
                                                    <strong>Shared category permissions</strong>
                                                    <p>
                                                        Applies to{' '}
                                                        {
                                                            state.channels.filter(
                                                                (entry) =>
                                                                    entry.category ===
                                                                        category.id && entry.synced,
                                                            ).length
                                                        }{' '}
                                                        synced channels. Channels marked Custom keep
                                                        their own permissions.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                        {channel && (
                                            <div
                                                className={`permission-source-card ${channel.synced ? '' : 'custom'}`}
                                            >
                                                <ShieldCheck size={19} />
                                                <div>
                                                    <strong>
                                                        {channel.synced
                                                            ? `Synced with ${parent?.name}`
                                                            : 'This channel has its own permissions'}
                                                    </strong>
                                                    <p>
                                                        {channel.synced
                                                            ? 'Every permission below comes from the category. Changes to the category apply here automatically.'
                                                            : parent
                                                              ? `Changes to ${parent.name} do not affect this channel.`
                                                              : 'Start with server roles, then choose exceptions for this channel.'}
                                                    </p>
                                                    {parent && (
                                                        <div className="permission-source-actions">
                                                            <button
                                                                className="permission-link"
                                                                onClick={() =>
                                                                    select(`category:${parent.id}`)
                                                                }
                                                            >
                                                                Edit {parent.name} permissions →
                                                            </button>
                                                            {permission('channels.access') &&
                                                                permission('channels.edit') && (
                                                                    <button
                                                                        className="permission-link"
                                                                        disabled={busy}
                                                                        onClick={() =>
                                                                            void act(async () => {
                                                                                await api(
                                                                                    `/channels/${channel.id}/category`,
                                                                                    'PUT',
                                                                                    {
                                                                                        category:
                                                                                            parent.id,
                                                                                        synced: !channel.synced,
                                                                                    },
                                                                                );
                                                                                await refresh();
                                                                            })
                                                                        }
                                                                    >
                                                                        {channel.synced
                                                                            ? 'Customize this channel’s permissions'
                                                                            : `Replace with ${parent.name} permissions`}
                                                                    </button>
                                                                )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {channel?.synced && parent ? (
                                            <>
                                                <ScopePermissions
                                                    onDirtyChange={setDirty}
                                                    {...props}
                                                    scope={parent}
                                                    category
                                                    readOnly
                                                />
                                            </>
                                        ) : (
                                            <>
                                                {scope && permission('channels.access') && (
                                                    <Toggle
                                                        title={
                                                            category
                                                                ? 'Private category'
                                                                : 'Private channel'
                                                        }
                                                        value={scope.private}
                                                        disabled={busy}
                                                        set={(value) =>
                                                            void act(async () => {
                                                                await api(
                                                                    category
                                                                        ? `/categories/${scope.id}`
                                                                        : `/channels/${scope.id}/privacy`,
                                                                    'PATCH',
                                                                    { private: value },
                                                                );
                                                                await refresh();
                                                            })
                                                        }
                                                    />
                                                )}
                                                <p className="privacy-help">
                                                    <Lock size={12} />
                                                    Private{' '}
                                                    {category
                                                        ? 'categories hide synced channels'
                                                        : 'channels are hidden'}{' '}
                                                    until a role allows View channels.
                                                </p>
                                                <ScopePermissions
                                                    onDirtyChange={setDirty}
                                                    {...props}
                                                    scope={scope}
                                                    category={!!category}
                                                    readOnly={!permission('channels.access')}
                                                />
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="organizer-empty">
                            <ArrowLeft size={22} />
                            <h3>Select a channel or category</h3>
                            <p>Organize the tree on the left, then edit the selected item here.</p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
function CreateItem({
    category,
    done,
    ...props
}: Props & { category?: Category; done: (id: string) => void }) {
    const [kind, setKind] = useState<'text' | 'voice' | 'category'>('text');
    return (
        <form
            className="organizer-create"
            onSubmit={(event) => {
                event.preventDefault();
                const name = new FormData(event.currentTarget).get('name');
                void props.act(async () => {
                    const result = await props.api<{ id: string }>(
                        kind === 'category' ? '/categories' : '/channels',
                        'POST',
                        {
                            name,
                            kind,
                            ...(kind !== 'category' && category ? { category: category.id } : {}),
                        },
                    );
                    await props.refresh();
                    done(kind === 'category' ? `category:${result.id}` : result.id);
                });
            }}
        >
            <label>
                Create
                <select
                    value={kind}
                    onChange={(event) => setKind(event.target.value as typeof kind)}
                >
                    <option value="text">Text channel</option>
                    <option value="voice">Voice channel</option>
                    <option value="category">Category</option>
                </select>
            </label>
            <label>
                Name
                <input
                    name="name"
                    autoFocus
                    maxLength={32}
                    required
                    placeholder={kind === 'category' ? 'Community' : 'new-channel'}
                />
            </label>
            {category && kind !== 'category' && (
                <small>Inside {category.name} · Uses category permissions</small>
            )}
            <button className="primary" disabled={props.busy}>
                Create {kind === 'category' ? 'category' : 'channel'}
            </button>
        </form>
    );
}

function ChannelEditor({
    channel,
    state,
    api,
    refresh,
    busy,
    act,
    permission,
}: Props & { channel: Channel }) {
    const [confirming, setConfirming] = useState(false);
    return (
        <section className="channel-settings-card" aria-label={`${channel.name} channel settings`}>
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
                            Optional · Up to 200 characters. Shown beside the channel name.
                        </span>
                    </label>
                )}
                <button className="secondary" disabled={busy || !permission('channels.edit')}>
                    Save channel
                </button>
            </form>
            {channel.kind === 'text' && (
                <RetentionField
                    key={JSON.stringify([
                        channel.retention,
                        channel.retentionNext,
                        channel.retentionAt,
                        state.retention.server,
                        state.retention.keepText,
                        state.retention.keepTextUntil,
                    ])}
                    label="Keep messages"
                    help={
                        permission('server.edit')
                            ? 'How long messages here are kept. The server default is set in Server settings.'
                            : 'How long messages here are kept. Only members who can edit server settings change this.'
                    }
                    policy={channel}
                    inherited={settlePolicy(state.retention.server, Date.now()).retention ?? 0}
                    keepText={{
                        keepText: state.retention.keepText,
                        keepTextUntil: state.retention.keepTextUntil,
                    }}
                    canEdit={permission('server.edit')}
                    previewQuery={`scope=channel&channel=${encodeURIComponent(channel.id)}`}
                    save={async (value, applyNow) => {
                        await api(`/retention/channels/${channel.id}`, 'PATCH', {
                            retention: value,
                            applyNow,
                        });
                        await refresh();
                    }}
                    api={api}
                    act={act}
                    busy={busy}
                />
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
