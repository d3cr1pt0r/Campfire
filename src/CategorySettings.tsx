import { useState } from 'react';
import type { Category, State } from './types';
import type { ApiClient } from './api';

type Props = {
    state: State;
    api: ApiClient;
    busy: boolean;
    refresh: () => Promise<void>;
    permission: (id: string) => boolean;
    act: (fn: () => Promise<unknown>) => unknown;
};
export function CategoryEditor({ category, ...props }: Props & { category: Category }) {
    const { api, busy, refresh, act, permission } = props;
    const [confirming, setConfirming] = useState(false);
    return (
        <div className="settings-section category-editor">
            {permission('channels.edit') && (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const name = new FormData(event.currentTarget).get('name');
                        void act(async () => {
                            await api(`/categories/${category.id}`, 'PATCH', { name });
                            await refresh();
                        });
                    }}
                >
                    <label>
                        Category name
                        <input
                            name="name"
                            defaultValue={category.name}
                            key={category.name}
                            maxLength={32}
                            required
                            disabled={busy}
                        />
                    </label>
                    <button className="primary" disabled={busy}>
                        Save category
                    </button>
                </form>
            )}
            {permission('channels.delete') &&
                permission('channels.access') &&
                (confirming ? (
                    <div className="category-delete-confirm">
                        <p>
                            Delete {category.name}? Its channels become uncategorized and keep their
                            current permissions and messages.
                        </p>
                        <button disabled={busy} onClick={() => setConfirming(false)}>
                            Cancel
                        </button>
                        <button
                            className="danger-bg"
                            disabled={busy}
                            onClick={() =>
                                void act(async () => {
                                    await api(`/categories/${category.id}`, 'DELETE');
                                    await refresh();
                                })
                            }
                        >
                            Confirm category deletion
                        </button>
                    </div>
                ) : (
                    <button
                        className="danger-text"
                        disabled={busy}
                        onClick={() => setConfirming(true)}
                    >
                        Delete category
                    </button>
                ))}
        </div>
    );
}
