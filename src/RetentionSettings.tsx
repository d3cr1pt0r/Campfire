import { useState } from 'react';
import type { ApiClient } from './api';
import type { RetentionPreview } from './types';
import { formatDay } from './retention';
import { formatBytes } from '../shared/uploads.js';
import {
    formatRetention,
    isRetentionDays,
    isShorter,
    maxRetentionDays,
    retentionPresets,
    settlePolicy,
    type RetentionPolicy,
} from '../shared/retention.js';

type Confirm = { value: number | null; preview: RetentionPreview; now: boolean };

const choiceOf = (value: number | null) =>
    value === null
        ? 'default'
        : retentionPresets.some(([days]) => days === value)
          ? String(value)
          : 'custom';
const amount = ({ messages, bytes }: { messages: number; bytes: number }) =>
    `${messages.toLocaleString('en-US')} ${messages === 1 ? 'message' : 'messages'}${bytes ? ` and ${formatBytes(bytes)} of attachments` : ''}`;

// One retention setting: the server default, direct messages, or a channel's override.
// inherited is the server default in force, offered to channels as "Server default".
export function RetentionField({
    label,
    help,
    policy,
    inherited,
    canEdit,
    previewQuery,
    save,
    api,
    act,
    busy,
}: {
    label: string;
    help: string;
    policy: Partial<RetentionPolicy>;
    inherited?: number;
    canEdit: boolean;
    previewQuery: string;
    save: (value: number | null, applyNow: boolean) => Promise<void>;
    api: ApiClient;
    act: (action: () => Promise<unknown>) => Promise<void>;
    busy: boolean;
}) {
    const current = settlePolicy(
        {
            retention: policy.retention ?? null,
            retentionNext: policy.retentionNext ?? null,
            retentionAt: policy.retentionAt ?? null,
        },
        Date.now(),
    );
    const channel = inherited !== undefined;
    const [choice, setChoice] = useState(choiceOf(current.retention));
    const [custom, setCustom] = useState(
        String(
            current.retention && choiceOf(current.retention) === 'custom' ? current.retention : 60,
        ),
    );
    const [confirm, setConfirm] = useState<Confirm | null>(null);
    const selected =
        choice === 'default' ? null : choice === 'custom' ? Number(custom) : Number(choice);
    const describe = (value: number | null) =>
        value === null
            ? `${formatRetention(inherited ?? 0)} (the server default)`
            : formatRetention(value);
    const changed = selected !== current.retention;
    // Shorter periods show what they delete first; longer ones apply straight away.
    const review = (value: number | null, now: boolean) =>
        act(async () => {
            if (value !== null && !isRetentionDays(value))
                throw new Error(
                    `Choose Forever or 1–${maxRetentionDays.toLocaleString('en-US')} days`,
                );
            if (!now && !isShorter(current, value, { now: Date.now(), inherited })) {
                await save(value, false);
                return;
            }
            const preview = await api<RetentionPreview>(
                `/retention/preview?${previewQuery}&retention=${value === null ? 'default' : value}`,
            );
            setConfirm({ value, preview, now });
        });
    const apply = (value: number | null, now: boolean) =>
        act(async () => {
            await save(value, now);
            setConfirm(null);
        });
    return (
        <div className="retention-field">
            <label>
                {label}
                <select
                    value={choice}
                    disabled={!canEdit || busy}
                    onChange={(event) => {
                        setChoice(event.target.value);
                        setConfirm(null);
                    }}
                >
                    {channel && (
                        <option value="default">
                            Server default ({formatRetention(inherited ?? 0)})
                        </option>
                    )}
                    {retentionPresets.map(([days, name]) => (
                        <option key={days} value={String(days)}>
                            {name}
                        </option>
                    ))}
                    <option value="custom">Custom number of days</option>
                </select>
            </label>
            {choice === 'custom' && (
                <label>
                    Days
                    <input
                        type="number"
                        min={1}
                        max={maxRetentionDays}
                        step={1}
                        value={custom}
                        disabled={!canEdit || busy}
                        onChange={(event) => {
                            setCustom(event.target.value);
                            setConfirm(null);
                        }}
                    />
                </label>
            )}
            <small className="field-help">{help}</small>
            {current.retentionAt !== null && (
                <div className="retention-pending" role="status">
                    <p>
                        Changes to {describe(current.retentionNext)} on{' '}
                        {formatDay(current.retentionAt, Date.now())}. Members see a notice until
                        then.
                    </p>
                    {canEdit && (
                        <>
                            <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() => void apply(current.retention, false)}
                            >
                                Cancel change
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void review(current.retentionNext, true)}
                            >
                                Apply now…
                            </button>
                        </>
                    )}
                </div>
            )}
            {canEdit && changed && !confirm && (
                <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void review(selected, false)}
                >
                    Save
                </button>
            )}
            {confirm && !confirm.now && (
                <div className="channel-delete-confirm" role="group" aria-label="Confirm period">
                    <p>
                        {confirm.preview.at === null
                            ? `Keep messages for ${describe(confirm.value)}.`
                            : `From ${formatDay(confirm.preview.at, Date.now())}, messages older than ${describe(confirm.value)} will be deleted (${confirm.preview.scheduled.messages ? `about ${amount(confirm.preview.scheduled)} as things stand` : 'none are that old yet'}). Members see a notice until then, and pinned messages are kept.`}
                    </p>
                    <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => void apply(confirm.value, false)}
                    >
                        Schedule change
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirm({ ...confirm, now: true })}
                    >
                        Apply now…
                    </button>
                </div>
            )}
            {confirm?.now && (
                <div className="channel-delete-confirm" role="alert">
                    <p>
                        {confirm.preview.immediate.messages
                            ? `Delete about ${amount(confirm.preview.immediate)} now, without a notice week? This can’t be undone.`
                            : `Keep messages for ${describe(confirm.value)} from now on, without a notice week? Nothing is old enough to be deleted yet.`}
                    </p>
                    <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                        Back
                    </button>
                    <button
                        type="button"
                        className="danger-bg"
                        disabled={busy}
                        onClick={() => void apply(confirm.value, true)}
                    >
                        {confirm.preview.immediate.messages ? 'Delete now' : 'Apply now'}
                    </button>
                </div>
            )}
        </div>
    );
}
