import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from './api';
import type { State, StorageOverview } from './types';
import { KeepTextField, RetentionField } from './RetentionSettings';
import { conversationSchedule, periodLabel } from './retention';
import {
    formatBytes,
    formatUploadLimit,
    uploadLimitCeiling,
    formatStorageQuota,
    gigabyte,
    storageQuotaCeiling,
} from '../shared/uploads.js';

export function StorageSettings({
    state,
    api,
    act,
    busy,
    refresh,
    notify,
}: {
    state: State;
    api: ApiClient;
    act: (action: () => Promise<unknown>) => Promise<void>;
    busy: boolean;
    refresh: () => Promise<void>;
    notify: (message: string) => void;
}) {
    const [overview, setOverview] = useState<StorageOverview | null>(null);
    const load = useCallback(async () => {
        try {
            setOverview(await api<StorageOverview>('/storage'));
        } catch (e) {
            notify((e as Error).message);
        }
    }, [api, notify]);
    useEffect(() => {
        void load();
    }, [load]);
    const saveScope =
        (scope: 'server' | 'dm') => async (value: number | null, applyNow: boolean) => {
            await api(`/retention/${scope}`, 'PATCH', { retention: value, applyNow });
            await refresh();
            await load();
        };
    const now = Date.now();
    const period = (room: string) => {
        const schedule = conversationSchedule(state, room);
        return schedule ? periodLabel(schedule, now) : '';
    };
    const keepText = {
        keepText: state.retention.keepText,
        keepTextUntil: state.retention.keepTextUntil,
    };
    const quota = overview?.attachments.quota;
    // Fields restart from the saved settings when they change. Keys name each field, since
    // the channel and direct message periods are often the same.
    const saved = JSON.stringify(keepText);
    return (
        <>
            <section className="account-section retention-settings" aria-label="Message retention">
                <h3>Message retention</h3>
                <p className="muted">
                    Old messages, or only their files, can be deleted automatically to keep the
                    server small. Pinned messages are always kept, and a thread is deleted only once
                    its newest message is old enough. A change that deletes more starts after a
                    week, so members can pin what they want to keep.
                </p>
                <KeepTextField
                    key={`keep-text:${saved}`}
                    mode={keepText}
                    save={async (value, applyNow) => {
                        await api('/retention/keep-text', 'PATCH', { keepText: value, applyNow });
                        await refresh();
                        await load();
                    }}
                    api={api}
                    act={act}
                    busy={busy}
                />
                <RetentionField
                    key={`server:${JSON.stringify(state.retention.server)}:${saved}`}
                    label="Channels"
                    help="Applies to every text channel unless the channel sets its own period in Channels."
                    policy={state.retention.server}
                    keepText={keepText}
                    canEdit
                    previewQuery="scope=server"
                    save={saveScope('server')}
                    api={api}
                    act={act}
                    busy={busy}
                />
                <RetentionField
                    key={`dm:${JSON.stringify(state.retention.dm)}:${saved}`}
                    label="Direct messages"
                    help="Applies to every direct message, including personal notes."
                    policy={state.retention.dm}
                    keepText={keepText}
                    canEdit
                    previewQuery="scope=dm"
                    save={saveScope('dm')}
                    api={api}
                    act={act}
                    busy={busy}
                />
            </section>
            <section className="account-section storage-settings" aria-label="Attachment storage">
                <h3>Attachment storage</h3>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const megabytes = Number(
                            new FormData(event.currentTarget).get('maxUploadMegabytes'),
                        );
                        void act(async () => {
                            await api('/settings', 'PATCH', {
                                maxUploadBytes: megabytes * 1024 * 1024,
                            });
                            notify('Maximum upload size saved.');
                        });
                    }}
                >
                    <label>
                        Maximum upload size (MB)
                        <input
                            key={state.maxUploadBytes}
                            name="maxUploadMegabytes"
                            type="number"
                            min={1}
                            max={uploadLimitCeiling / (1024 * 1024)}
                            step={1}
                            required
                            defaultValue={state.maxUploadBytes / (1024 * 1024)}
                        />
                        <small className="field-help">
                            Combined size of the files in one message, up to{' '}
                            {formatUploadLimit(uploadLimitCeiling)}. Larger uploads use more server
                            memory and storage.
                        </small>
                    </label>
                    <button className="primary" disabled={busy}>
                        Save upload limit
                    </button>
                </form>
                {!overview && <p className="muted">Loading storage use…</p>}
                {overview && quota !== undefined && (
                    <form
                        key={quota}
                        onSubmit={(event) => {
                            event.preventDefault();
                            const gigabytes = Number(
                                new FormData(event.currentTarget).get('storageGigabytes'),
                            );
                            void act(async () => {
                                await api('/settings', 'PATCH', {
                                    maxStoredUploadBytes: gigabytes * gigabyte,
                                });
                                notify('Attachment storage limit saved.');
                                await load();
                            });
                        }}
                    >
                        <label>
                            Attachment storage limit (GB)
                            <input
                                name="storageGigabytes"
                                type="number"
                                min={0}
                                max={storageQuotaCeiling / gigabyte}
                                step={1}
                                required
                                defaultValue={quota / gigabyte}
                            />
                            <small className="field-help">
                                Combined size of every stored attachment. At the limit new
                                attachments are refused; 0 turns them off. Files already sent stay
                                available.
                            </small>
                        </label>
                        <button className="primary" disabled={busy}>
                            Save limit
                        </button>
                    </form>
                )}
                {overview && (
                    <div className="storage-overview" aria-label="Storage use">
                        {quota ? (
                            <meter
                                min={0}
                                max={quota}
                                value={Math.min(overview.attachments.bytes, quota)}
                                aria-label="Attachment storage used"
                            />
                        ) : null}
                        <p>
                            {quota
                                ? `${formatBytes(overview.attachments.bytes)} of ${formatStorageQuota(quota)} used by attachments.`
                                : `New attachments are turned off. ${formatBytes(overview.attachments.bytes)} of attachments are stored.`}
                        </p>
                        <p className="muted">
                            Database file: {formatBytes(overview.database.bytes)}
                            {overview.database.free
                                ? `, ${formatBytes(overview.database.free)} of it free and returned to the disk after the next cleanup`
                                : ''}
                            . Pinned threads keep {formatBytes(overview.kept.bytes)} of attachments
                            permanently.
                        </p>
                        <table className="storage-table">
                            <thead>
                                <tr>
                                    <th scope="col">Conversation</th>
                                    <th scope="col">Attachments</th>
                                    <th scope="col">Kept for</th>
                                </tr>
                            </thead>
                            <tbody>
                                {overview.channels.map((channel) => (
                                    <tr key={channel.id}>
                                        <th scope="row">#{channel.name}</th>
                                        <td>
                                            {formatBytes(channel.bytes)} · {channel.files}{' '}
                                            {channel.files === 1 ? 'file' : 'files'}
                                        </td>
                                        <td>{period(channel.id)}</td>
                                    </tr>
                                ))}
                                {!!overview.otherChannels.files && (
                                    <tr>
                                        <th scope="row">Other channels</th>
                                        <td>
                                            {formatBytes(overview.otherChannels.bytes)} ·{' '}
                                            {overview.otherChannels.files}{' '}
                                            {overview.otherChannels.files === 1 ? 'file' : 'files'}
                                        </td>
                                        <td />
                                    </tr>
                                )}
                                <tr>
                                    <th scope="row">Direct messages</th>
                                    <td>
                                        {formatBytes(overview.directMessages.bytes)} ·{' '}
                                        {overview.directMessages.files}{' '}
                                        {overview.directMessages.files === 1 ? 'file' : 'files'}
                                    </td>
                                    <td>{period('dm:')}</td>
                                </tr>
                            </tbody>
                        </table>
                        <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => void load()}
                        >
                            Refresh
                        </button>
                    </div>
                )}
            </section>
        </>
    );
}
