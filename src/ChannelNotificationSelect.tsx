import { Bell, BellOff } from 'lucide-react';
import type { ChannelNotificationMode } from './types';
import { channelNotificationMode } from './notifications';

export function ChannelNotificationSelect({
    label,
    mode,
    onChange,
    compact = false,
}: {
    label: string;
    mode: ChannelNotificationMode;
    onChange: (mode: ChannelNotificationMode) => void;
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
                onChange={(event) => onChange(channelNotificationMode(event.target.value))}
            >
                <option value="all">All messages</option>
                <option value="mentions">Mentions only</option>
                <option value="muted">Muted</option>
            </select>
        </label>
    );
}
