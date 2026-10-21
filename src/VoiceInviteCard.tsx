import { Volume2, ArrowRight, Users } from 'lucide-react';
import type { Message, State } from './types';

export function VoiceInviteCard({
    invite,
    state,
    currentChannel,
    onJoin,
}: {
    invite: NonNullable<Message['voiceInvite']>;
    state: State;
    currentChannel?: string | null;
    onJoin?: (channel: string) => void;
}) {
    const channel = state.channels.find(
        (channel) => channel.id === invite.channel && channel.kind === 'voice',
    );
    const available = !!channel?.permissions.includes('calls.join');
    const joined = currentChannel === invite.channel;
    const count = state.calls.filter((call) => call.channel === invite.channel).length;
    const full = count >= 8;
    return (
        <div className="voice-invite-card">
            <span className="voice-invite-card-icon">
                <Volume2 size={23} />
            </span>
            <div className="voice-invite-card-content">
                <span className="voice-invite-card-label">VOICE CHANNEL INVITATION</span>
                <strong>{channel?.name || invite.name}</strong>
                <span className="voice-invite-card-status">
                    <Users size={13} />
                    {!available
                        ? 'Channel unavailable'
                        : `${count} ${count === 1 ? 'member' : 'members'} in voice`}
                </span>
            </div>
            <button
                type="button"
                className="primary"
                disabled={!available || joined || full || !onJoin}
                aria-label={`${joined ? 'Joined' : 'Join'} ${channel?.name || invite.name}`}
                onClick={() => onJoin?.(invite.channel)}
            >
                {joined ? 'Joined' : !available ? 'Unavailable' : full ? 'Full' : 'Join'}
                {available && !joined && !full && <ArrowRight size={15} />}
            </button>
        </div>
    );
}
