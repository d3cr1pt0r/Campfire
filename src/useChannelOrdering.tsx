import { useRef, useState, type DragEvent } from 'react';
import { useDialog } from './useDialog';
import type { State } from './types';
import type { ApiClient } from './api';

type Item = { id: string; kind: 'channel' | 'category' };
type Destination = { category: string | null; target?: string; placement: 'before' | 'after' };
export function useChannelOrdering({
    state,
    api,
    refresh,
    permission,
    busy = false,
}: {
    state: State;
    api: ApiClient;
    refresh: () => Promise<void>;
    permission: (id: string) => boolean;
    busy?: boolean;
}) {
    const source = useRef<Item | null>(null);
    const [dragging, setDragging] = useState<Item | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const [pending, setPending] = useState<{ item: Item; destination: Destination } | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const dialog = useRef<HTMLElement | null>(null);
    useDialog(dialog, () => setPending(null), !!pending);
    const enabled = permission('channels.reorder') && !busy && !saving;
    const clear = () => {
        source.current = null;
        setDragging(null);
        setOver(null);
    };
    const save = async (item: Item, destination: Destination, synced: boolean) => {
        setPending(null);
        setSaving(true);
        setError('');
        try {
            await api(
                item.kind === 'category'
                    ? `/categories/${item.id}/drop`
                    : `/channels/${item.id}/place`,
                'POST',
                { ...destination, synced },
            );
            await refresh();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };
    const place = (item: Item, destination: Destination) => {
        clear();
        const channel = state.channels.find((entry) => entry.id === item.id);
        if (
            item.kind === 'channel' &&
            channel &&
            (channel.category ?? null) !== destination.category &&
            destination.category
        ) {
            setPending({ item, destination });
        } else void save(item, destination, !!channel?.synced && !!destination.category);
    };
    const handle = (item: Item) => ({
        draggable: enabled,
        onDragStart: (event: DragEvent) => {
            event.stopPropagation();
            source.current = item;
            setDragging(item);
            setError('');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.id);
        },
        onDragEnd: clear,
    });
    const target = (
        key: string,
        destination: Destination,
        accepts: 'channel' | 'category' | 'both' = 'channel',
    ) => ({
        onDragOver: (event: DragEvent) => {
            if (
                !enabled ||
                !source.current ||
                (accepts !== 'both' && source.current.kind !== accepts) ||
                destination.target === source.current.id
            )
                return;
            if (source.current.kind === 'channel') {
                const channel = state.channels.find((entry) => entry.id === source.current?.id);
                if (
                    (channel?.category ?? null) !== destination.category &&
                    (!permission('channels.edit') || !permission('channels.access'))
                )
                    return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setOver(key);
        },
        onDragLeave: (event: DragEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
                setOver((value) => (value === key ? null : value));
        },
        onDrop: (event: DragEvent) => {
            if (over !== key || !source.current) return;
            event.preventDefault();
            event.stopPropagation();
            place(source.current, destination);
        },
    });
    const feedback = (
        <>
            {error && (
                <p className="organizer-error" role="alert">
                    {error}
                    <button onClick={() => setError('')}>Dismiss</button>
                </p>
            )}
            <span className="sr-only" role="status">
                {saving ? 'Saving channel layout' : over ? 'Drop to move here' : ''}
            </span>
            {pending && (
                <div className="move-policy-backdrop">
                    <section
                        ref={dialog}
                        className="move-policy-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="move-policy-title"
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') setPending(null);
                        }}
                    >
                        <h3 id="move-policy-title">
                            Move #
                            {state.channels.find((entry) => entry.id === pending.item.id)?.name}?
                        </h3>
                        <p>
                            Choose how this channel uses permissions in{' '}
                            <strong>
                                {
                                    state.categories?.find(
                                        (entry) => entry.id === pending.destination.category,
                                    )?.name
                                }
                            </strong>
                            .
                        </p>
                        <button
                            className="move-policy-choice"
                            autoFocus
                            onClick={() => void save(pending.item, pending.destination, true)}
                        >
                            <strong>Use category permissions</strong>
                            <span>
                                Replace channel permissions and follow future category changes.
                            </span>
                        </button>
                        <button
                            className="move-policy-choice"
                            onClick={() => void save(pending.item, pending.destination, false)}
                        >
                            <strong>Keep current permissions</strong>
                            <span>
                                Move the channel with its current access. Manage it separately.
                            </span>
                        </button>
                        <button onClick={() => setPending(null)}>Cancel move</button>
                    </section>
                </div>
            )}
        </>
    );
    return { handle, target, dragging, over, enabled, place, feedback };
}
