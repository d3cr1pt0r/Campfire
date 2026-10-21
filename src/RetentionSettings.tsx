import { useState } from 'react';
import type { ApiClient } from './api';
import type { RetentionCount, RetentionPreview } from './types';
import { formatDay } from './retention';
import { Toggle } from './forms';
import { formatBytes } from '../shared/uploads.js';
import {
    formatRetention,
    isRetentionDays,
    isShorter,
    maxRetentionDays,
    retentionPresets,
    settleKeepText,
    settlePolicy,
    type KeepTextMode,
    type RetentionPolicy,
} from '../shared/retention.js';

type Confirm = { preview: RetentionPreview; now: boolean };
type Act = (action: () => Promise<unknown>) => Promise<void>;

const choiceOf = (value: number | null) =>
    value === null
        ? 'default'
        : retentionPresets.some(([days]) => days === value)
          ? String(value)
          : 'custom';
const plural = (count: number, one: string, many: string) =>
    `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
// What a change removes, as the server counted it; empty when nothing.
const effect = ({ messages, files, bytes }: RetentionCount) =>
    messages
        ? `about ${plural(messages, 'message', 'messages')}${bytes ? ` and ${formatBytes(bytes)} of attachments` : ''}`
        : files
          ? `about ${plural(files, 'file', 'files')} (${formatBytes(bytes)})`
          : '';
const asThingsStand = (count: RetentionCount) =>
    effect(count) ? `${effect(count)} as things stand` : 'none are that old yet';
const onDay = (time: number) => formatDay(time, Date.now());

// A change that removes more: scheduled after the notice week, or applied now behind a
// second confirmation.
function ChangeConfirm({
    confirm,
    setConfirm,
    scheduled,
    nothingNow,
    removing,
    apply,
    busy,
}: {
    confirm: Confirm;
    setConfirm: (confirm: Confirm | null) => void;
    scheduled: string;
    nothingNow: string;
    removing: 'Delete' | 'Remove';
    apply: (now: boolean) => void;
    busy: boolean;
}) {
    if (!confirm.now)
        return (
            <div className="channel-delete-confirm" role="group" aria-label="Confirm change">
                <p>{scheduled}</p>
                <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                </button>
                <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => apply(false)}
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
        );
    const amount = effect(confirm.preview.immediate);
    return (
        <div className="channel-delete-confirm" role="alert">
            <p>
                {amount
                    ? `${removing} ${amount} now, without a notice week? This can’t be undone.`
                    : nothingNow}
            </p>
            <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                Back
            </button>
            <button type="button" className="danger-bg" disabled={busy} onClick={() => apply(true)}>
                {amount ? `${removing} now` : 'Apply now'}
            </button>
        </div>
    );
}

// One retention setting: the server default, direct messages, or a channel's override.
// inherited is the server default in force, offered to channels as "Server default".
export function RetentionField({
    label,
    help,
    policy,
    inherited,
    keepText,
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
    keepText: KeepTextMode;
    canEdit: boolean;
    previewQuery: string;
    save: (value: number | null, applyNow: boolean) => Promise<void>;
    api: ApiClient;
    act: Act;
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
    const [confirm, setConfirm] = useState<(Confirm & { value: number | null }) | null>(null);
    const selected =
        choice === 'default' ? null : choice === 'custom' ? Number(custom) : Number(choice);
    const describe = (value: number | null) =>
        value === null
            ? `${formatRetention(inherited ?? 0)} (the server default)`
            : formatRetention(value);
    // Whether periods remove only files at that time.
    const keptAt = (time: number) =>
        keepText.keepText && (keepText.keepTextUntil === null || time < keepText.keepTextUntil);
    const goes = (value: number | null, time: number) =>
        keptAt(time)
            ? `files older than ${describe(value)} will be removed`
            : `messages older than ${describe(value)} will be deleted`;
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
                        Changes to {describe(current.retentionNext)} on {onDay(current.retentionAt)}
                        . Members see a notice until then.
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
            {confirm && (
                <ChangeConfirm
                    confirm={confirm}
                    setConfirm={(next) => setConfirm(next && { ...next, value: confirm.value })}
                    scheduled={
                        confirm.preview.at === null
                            ? `Keep messages for ${describe(confirm.value)}.`
                            : `From ${onDay(confirm.preview.at)}, ${goes(confirm.value, confirm.preview.at)} (${asThingsStand(confirm.preview.scheduled)}). Members see a notice until then, and pinned messages are kept.`
                    }
                    nothingNow={`Keep ${keptAt(Date.now()) ? 'files' : 'messages'} for ${describe(confirm.value)} from now on, without a notice week? Nothing is old enough to be removed yet.`}
                    removing={keptAt(Date.now()) ? 'Remove' : 'Delete'}
                    apply={(now) => void apply(confirm.value, now)}
                    busy={busy}
                />
            )}
        </div>
    );
}

// The server-wide switch that makes periods remove only files, keeping the messages.
export function KeepTextField({
    mode,
    save,
    api,
    act,
    busy,
}: {
    mode: KeepTextMode;
    save: (keepText: boolean, applyNow: boolean) => Promise<void>;
    api: ApiClient;
    act: Act;
    busy: boolean;
}) {
    const current = settleKeepText(mode, Date.now());
    const [confirm, setConfirm] = useState<Confirm | null>(null);
    const apply = (keepText: boolean, now: boolean) =>
        act(async () => {
            await save(keepText, now);
            setConfirm(null);
        });
    // No longer keeping messages deletes the old ones, so it shows what goes first.
    const review = (now: boolean) =>
        act(async () => {
            const preview = await api<RetentionPreview>(
                '/retention/preview?scope=keep-text&keepText=false',
            );
            setConfirm({ preview, now });
        });
    return (
        <div className="retention-field">
            <Toggle
                title="Keep messages permanently, only remove files"
                value={current.keepText && current.keepTextUntil === null}
                set={(value) => void (value ? apply(true, false) : review(false))}
            />
            <small className="field-help">
                When a period ends, its files, images and link previews are removed and the messages
                stay, with a note where each file was.
            </small>
            {current.keepTextUntil !== null && (
                <div className="retention-pending" role="status">
                    <p>
                        Messages will be deleted along with their files from{' '}
                        {onDay(current.keepTextUntil)}. Members see a notice until then.
                    </p>
                    <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void apply(true, false)}
                    >
                        Keep messages
                    </button>
                    <button type="button" disabled={busy} onClick={() => void review(true)}>
                        Apply now…
                    </button>
                </div>
            )}
            {confirm && (
                <ChangeConfirm
                    confirm={confirm}
                    setConfirm={setConfirm}
                    scheduled={
                        confirm.preview.at === null
                            ? 'Messages are already deleted with their files.'
                            : `From ${onDay(confirm.preview.at)}, messages past their period will be deleted, not just their files (${asThingsStand(confirm.preview.scheduled)}). Members see a notice until then, and pinned messages are kept.`
                    }
                    nothingNow="Stop keeping messages now, without a notice week? Nothing is old enough to be deleted yet."
                    removing="Delete"
                    apply={(now) => void apply(false, now)}
                    busy={busy}
                />
            )}
        </div>
    );
}
