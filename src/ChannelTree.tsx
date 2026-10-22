import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, GripVertical, Hash, Lock, Settings, Volume2 } from 'lucide-react';
import type { State, Channel } from './types';
import type { ApiClient } from './api';
import { useChannelOrdering } from './useChannelOrdering';
import { useChannelDragScroll } from './useChannelDragScroll';

export function ChannelTree({
    state,
    api,
    refresh,
    permission,
    busy,
    mode,
    selected,
    select,
    renderChannel,
    unread = {},
    storage,
    storageKey,
    manage,
}: {
    state: State;
    api: ApiClient;
    refresh: () => Promise<void>;
    permission: (id: string) => boolean;
    busy?: boolean;
    mode: 'settings' | 'sidebar';
    selected?: string;
    select?: (id: string) => void;
    renderChannel?: (channel: Channel) => ReactNode;
    unread?: Record<string, number>;
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
    storageKey?: string;
    manage?: (id: string) => void;
}) {
    const [collapsed, setCollapsed] = useState<string[]>(() => {
        try {
            const value = JSON.parse(storage?.getItem(storageKey || '') || '[]');
            return Array.isArray(value)
                ? value.filter((id): id is string => typeof id === 'string')
                : [];
        } catch {
            return [];
        }
    });
    useEffect(() => {
        if (storage && storageKey) storage.setItem(storageKey, JSON.stringify(collapsed));
    }, [collapsed, storage, storageKey]);
    const ordering = useChannelOrdering({
        state,
        api,
        refresh,
        permission,
        busy,
        allowReordering: mode === 'settings',
    });
    const tree = useRef<HTMLDivElement>(null);
    useChannelDragScroll(tree, mode === 'settings' && ordering.enabled && !!ordering.dragging);
    const categories = state.categories || [];
    const groups = [{ id: null, name: 'Uncategorized' }, ...categories];
    return (
        <div
            ref={tree}
            className={`channel-tree channel-tree-${mode}`}
            aria-label="Channel organization"
            aria-busy={!ordering.enabled && !!ordering.dragging}
        >
            {groups.map((group, index) => {
                const channels = state.channels.filter(
                    (channel) => (channel.category ?? null) === group.id,
                );
                const key = group.id || 'uncategorized';
                const closed = collapsed.includes(key);
                const count = channels.reduce((sum, channel) => sum + (unread[channel.id] || 0), 0);
                const dropKey = `into:${key}`;
                return (
                    <section
                        className={`tree-group ${group.id ? '' : 'tree-uncategorized'} ${ordering.over === dropKey ? 'drop-into' : ''}`}
                        key={key}
                        {...ordering.target(dropKey, { category: group.id, placement: 'after' })}
                    >
                        {group.id && (
                            <div
                                className={`tree-category-drop ${ordering.over === `category:${key}` ? 'drop-before' : ''}`}
                                {...ordering.target(
                                    `category:${key}`,
                                    { category: group.id, target: group.id, placement: 'before' },
                                    'category',
                                )}
                            >
                                <div
                                    className={`tree-category ${selected === `category:${group.id}` ? 'is-selected' : ''} ${count ? 'has-unread' : ''}`}
                                    {...ordering.handle({ kind: 'category', id: group.id })}
                                    onKeyDown={(event) => {
                                        if (
                                            !ordering.enabled ||
                                            !event.altKey ||
                                            !['ArrowUp', 'ArrowDown'].includes(event.key)
                                        )
                                            return;
                                        event.preventDefault();
                                        const target =
                                            categories[
                                                index - 1 + (event.key === 'ArrowUp' ? -1 : 1)
                                            ];
                                        if (target && group.id)
                                            ordering.place(
                                                { kind: 'category', id: group.id },
                                                {
                                                    category: target.id,
                                                    target: target.id,
                                                    placement:
                                                        event.key === 'ArrowUp'
                                                            ? 'before'
                                                            : 'after',
                                                },
                                            );
                                    }}
                                >
                                    {mode === 'settings' && (
                                        <GripVertical className="tree-grip" size={13} />
                                    )}
                                    {mode === 'settings' ? (
                                        <>
                                            <button
                                                className="tree-collapse"
                                                aria-label={`${closed ? 'Expand' : 'Collapse'} ${group.name}`}
                                                aria-expanded={!closed}
                                                onClick={() =>
                                                    setCollapsed((previous) =>
                                                        closed
                                                            ? previous.filter((id) => id !== key)
                                                            : [...previous, key],
                                                    )
                                                }
                                            >
                                                <ChevronDown
                                                    size={12}
                                                    className={closed ? 'collapsed' : ''}
                                                />
                                            </button>
                                            <button
                                                className="tree-category-name"
                                                onClick={() => select?.(`category:${group.id}`)}
                                            >
                                                {group.name}
                                            </button>
                                            <span className="tree-channel-count">
                                                {channels.length}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                className="tree-category-name category-toggle"
                                                aria-expanded={!closed}
                                                aria-controls={`tree-${key}`}
                                                onClick={() =>
                                                    setCollapsed((previous) =>
                                                        closed
                                                            ? previous.filter((id) => id !== key)
                                                            : [...previous, key],
                                                    )
                                                }
                                            >
                                                <span>{group.name}</span>
                                                <ChevronDown
                                                    size={11}
                                                    className={closed ? 'collapsed' : ''}
                                                />
                                            </button>
                                            {count > 0 && (
                                                <span
                                                    className="count"
                                                    aria-label={`${count} unread messages`}
                                                >
                                                    {count}
                                                </span>
                                            )}
                                            {manage && (
                                                <button
                                                    className="tree-category-manage"
                                                    aria-label={`Edit ${group.name}`}
                                                    onClick={() => manage?.(`category:${group.id}`)}
                                                >
                                                    <Settings size={13} />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                        {!group.id && mode === 'settings' && (
                            <div className="tree-uncategorized-heading">Uncategorized</div>
                        )}
                        <div className="tree-children" id={`tree-${key}`} hidden={closed}>
                            {channels.map((channel, channelIndex) => {
                                const before = `before:${channel.id}`;
                                const after = `after:${channel.id}`;
                                return (
                                    <div
                                        className={`tree-channel ${selected === channel.id ? 'is-selected' : ''} ${ordering.dragging?.id === channel.id ? 'is-dragging' : ''} ${ordering.over === before ? 'drop-before' : ''} ${ordering.over === after ? 'drop-after' : ''}`}
                                        key={channel.id}
                                        {...ordering.handle({ id: channel.id, kind: 'channel' })}
                                        onDragOver={(event) => {
                                            const rect =
                                                event.currentTarget.getBoundingClientRect();
                                            const key =
                                                event.clientY < rect.top + rect.height / 2
                                                    ? before
                                                    : after;
                                            ordering
                                                .target(key, {
                                                    category: group.id,
                                                    target: channel.id,
                                                    placement: key === before ? 'before' : 'after',
                                                })
                                                .onDragOver(event);
                                        }}
                                        onDrop={(event) => {
                                            ordering
                                                .target(ordering.over === before ? before : after, {
                                                    category: group.id,
                                                    target: channel.id,
                                                    placement:
                                                        ordering.over === before
                                                            ? 'before'
                                                            : 'after',
                                                })
                                                .onDrop(event);
                                        }}
                                        onKeyDown={(event) => {
                                            if (
                                                !ordering.enabled ||
                                                !event.altKey ||
                                                !['ArrowUp', 'ArrowDown'].includes(event.key)
                                            )
                                                return;
                                            event.preventDefault();
                                            const target =
                                                channels[
                                                    channelIndex +
                                                        (event.key === 'ArrowUp' ? -1 : 1)
                                                ];
                                            if (target)
                                                ordering.place(
                                                    { kind: 'channel', id: channel.id },
                                                    {
                                                        category: group.id,
                                                        target: target.id,
                                                        placement:
                                                            event.key === 'ArrowUp'
                                                                ? 'before'
                                                                : 'after',
                                                    },
                                                );
                                        }}
                                    >
                                        {mode === 'settings' ? (
                                            <button
                                                className="tree-channel-select"
                                                onClick={() => select?.(channel.id)}
                                            >
                                                <GripVertical className="tree-grip" size={13} />
                                                {channel.kind === 'text' ? (
                                                    <Hash size={16} />
                                                ) : (
                                                    <Volume2 size={16} />
                                                )}
                                                <span>{channel.name}</span>
                                                {channel.private && <Lock size={11} />}
                                                <small
                                                    className={
                                                        channel.category && !channel.synced
                                                            ? 'custom-access'
                                                            : ''
                                                    }
                                                >
                                                    {channel.category
                                                        ? channel.synced
                                                            ? 'Synced'
                                                            : 'Custom'
                                                        : ''}
                                                </small>
                                            </button>
                                        ) : (
                                            <>
                                                {renderChannel?.(channel)}
                                                {manage && (
                                                    <button
                                                        className="tree-channel-manage"
                                                        aria-label={`Edit ${channel.name}`}
                                                        onClick={() => manage(channel.id)}
                                                    >
                                                        <Settings size={13} />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                            {!channels.length &&
                                (mode === 'settings' || ordering.dragging?.kind === 'channel') && (
                                    <div className="tree-empty">Drop channels here</div>
                                )}
                        </div>
                        {group.id && index === groups.length - 1 && (
                            <div
                                className={`tree-category-end ${ordering.over === `end:${key}` ? 'drop-after' : ''}`}
                                {...ordering.target(
                                    `end:${key}`,
                                    { category: group.id, target: group.id, placement: 'after' },
                                    'category',
                                )}
                            />
                        )}
                    </section>
                );
            })}
            {mode === 'settings' && ordering.feedback}
        </div>
    );
}
