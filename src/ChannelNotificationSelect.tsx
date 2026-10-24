import { Bell, BellOff } from 'lucide-react';
import type { ChannelNotificationMode } from './types';
import { channelNotificationMode } from './notifications';

export function ChannelNotificationSelect({
    label,
    mode,
    onChange,
    compact = false,
    inheritLabel,
    directMessage = false,
}: {
    label: string;
    mode: ChannelNotificationMode | 'inherit';
    onChange: (mode: ChannelNotificationMode | 'inherit') => void;
    inheritLabel?: string;
    directMessage?: boolean;
    compact?: boolean;
}) {
    return (
        <label className={`channel-notification-select ${compact ? 'compact' : ''}`}>
            {compact ? (
                mode === 'muted' ? (
                    <BellOff size={18} />
                ) : (
                    <Bell size={18} />
                )
            ) : (
                <span>{label}</span>
            )}
            <select
                aria-label={label}
                value={mode}
                onChange={(event) =>
                    onChange(
                        event.target.value === 'inherit'
                            ? 'inherit'
                            : channelNotificationMode(event.target.value),
                    )
                }
            >
                {inheritLabel && <option value="inherit">{inheritLabel}</option>}
                <option value="all">All messages</option>
                {!directMessage && <option value="mentions">Only mentions</option>}
                <option value="muted">Nothing</option>
            </select>
        </label>
    );
}
