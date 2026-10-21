import type { AvatarFrame } from './frames.js';
import type { RetentionPolicies, RetentionPolicy, RetentionUnit } from './retention.js';
export type PresenceStatus = 'online' | 'idle' | 'dnd';
export type User = {
    id: string;
    username: string;
    nickname: string;
    avatar?: string | null;
    frame?: AvatarFrame | null;
    roles: string[];
    owner: boolean;
    status?: PresenceStatus;
};
export type Role = {
    id: string;
    name: string;
    color: string | null;
    position: number;
    permissions: string[];
};
export type Channel = {
    id: string;
    name: string;
    kind: 'text' | 'voice';
    description: string;
    protected: boolean;
    reactionAuthors?: number | boolean;
    private: boolean;
    permissions: string[];
} & Partial<RetentionPolicy>;
export type ChannelAccess = {
    channel: string;
    role: string;
    permission: string;
    effect: 'allow' | 'deny';
};
export type CallMember = {
    socket: string;
    user: string;
    channel: string;
    shareId?: string | null;
    muted?: boolean;
    deafened?: boolean;
    camera?: boolean;
};
export type State = {
    me: User;
    name: string;
    icon?: string | null;
    reactionAuthors?: boolean;
    profileFrames?: boolean;
    // Combined size allowed for one message's attachments, set in Server settings.
    maxUploadBytes: number;
    // How long channel and direct messages are kept; channels may override the default.
    retention: RetentionPolicies;
    removedUsers?: User[];
    users: User[];
    roles: Role[];
    channels: Channel[];
    channelPermissions: ChannelAccess[];
    online: string[];
    presence: Record<string, PresenceStatus>;
    calls: CallMember[];
    directCalls: { id: string; creator: string; invited: string[]; members: string[] }[];
    directMessages?: { room: string; updated: number; received?: number }[];
    emojis: { id: string; name: string; author: string | null }[];
    iceServers: RTCIceServer[];
    // The server owner's KLIPY key; null when GIF search is not set up.
    klipyKey?: string | null;
    // Present when the server terminates TLS itself; fingerprint only for its own identity.
    identity?: { fingerprint?: string; certificateSha256: string };
};
export type Message = {
    thread?: string | null;
    replyCount?: number;
    id: string;
    room: string;
    author: string | null;
    body: string;
    created: number;
    edited: number | null;
    pinned: number;
    attachments: {
        id: string;
        name: string;
        mime: string;
        // Displayed pixel size of an image, when the server could read it.
        width?: number;
        height?: number;
        animated?: boolean;
        // Retention removed the file and kept the message; only its name and type remain.
        removed?: boolean;
    }[];
    reactions: {
        user: string;
        emoji: string;
    }[];
    // The question is the message body.
    poll?: Poll;
    voiceInvite?: { channel: string; name: string };
    // Cards the server made for links in the body, once it has fetched them.
    previews?: LinkPreview[];
    // The retention clock of the message's thread, which is deleted as a unit.
    retention?: RetentionUnit;
};
// Messages deleted, and files removed with them or from messages whose text is kept.
export type RetentionCount = { messages: number; files: number; bytes: number };
export type RetentionPreview = {
    // When a scheduled change would take effect; null when the change applies at once.
    at: number | null;
    scheduled: RetentionCount;
    immediate: RetentionCount;
};
export type StorageOverview = {
    attachments: { bytes: number; quota: number };
    database: { bytes: number; free: number };
    kept: { bytes: number; files: number };
    channels: { id: string; name: string; bytes: number; files: number }[];
    otherChannels: { bytes: number; files: number };
    directMessages: { bytes: number; files: number };
};
export type LinkPreview = {
    id: string;
    url: string;
    title: string;
    description: string;
    site: string;
    // Whether the server has an image for the card, and its size.
    image: boolean;
    width: number;
    height: number;
    // Large cards show the image under the text; videos get a play badge.
    large: boolean;
    video: boolean;
};
// Shaped per member: counts appear once they have voted or voting has closed, and
// voters only in public polls.
export type Poll = {
    multiple: boolean;
    anonymous: boolean;
    ends: number;
    ended: boolean;
    total: number;
    mine: string[];
    answers: { id: string; text: string; count?: number; voters?: string[] }[];
};
export type ChannelNotificationMode = 'all' | 'mentions' | 'muted';
export type Preferences = {
    theme?: 'system' | 'dark' | 'light';
    messageAvatars?: 'normal' | 'compact' | 'hidden';
    autoIdle?: boolean;
    idleMinutes?: number;
    notifications: boolean;
    messageSounds?: boolean;
    dmNotifications?: boolean;
    mentionNotifications?: boolean;
    channelNotifications?: Record<string, ChannelNotificationMode>;
    serverNotifications?: Record<string, boolean>;
    closeToTray?: boolean;
    input: string;
    inputLabel?: string;
    output: string;
    outputLabel?: string;
    quality: string;
    noise: boolean;
    echoCancellation?: boolean;
    autoGainControl?: boolean;
    microphoneVolume?: number;
    outputVolume?: number;
    soundEffectsVolume?: number;
    voiceActivation?: boolean;
    voiceThreshold?: number;
    participantVolumes?: Record<string, { voice: number; stream: number }>;
    pushToTalk: boolean;
    sounds: boolean;
    formattingToolbar?: boolean;
    // Retention banners a member dismissed, by conversation, with the change's start.
    retentionNotices?: Record<string, number>;
};

export type MediaRole = 'voice' | 'video' | 'streamAudio';
export type MediaState = { sharing: boolean; camera: boolean; shareId: string | null };
export type CallSignal = {
    version: 2;
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
    media?: MediaState;
    watch?: { shareId: string; enabled: boolean; revision: number };
    watchAck?: { shareId: string; enabled: boolean; revision: number };
};

export type JoinResult = { peers: CallMember[]; error?: never } | { error: string; peers?: never };
export interface ServerEvents {
    presence: (statuses: Record<string, PresenceStatus>) => void;
    refresh: () => void;
    message: (message: Message) => void;
    'message:update': (message: Message) => void;
    'message:delete': (event: { id: string; room: string }) => void;
    // Top-level messages whose retention period ended; their replies went with them.
    'messages:expired': (event: { room: string; ids: string[] }) => void;
    // Threads whose files and link cards retention removed, keeping their text.
    'messages:files-removed': (event: { room: string; ids: string[] }) => void;
    'member:deleted': (event: { id: string }) => void;
    typing: (event: { room: string; user: string; thread?: string | null }) => void;
    calls: (members: CallMember[]) => void;
    'call:invite': (event: { id: string; from: string }) => void;
    'call:revoked': (reason?: string) => void;
    channels: (channels: Channel[]) => void;
    'call:speaking': (event: { user: string; active: boolean }) => void;
    signal: (event: { from: string; user: string; data: CallSignal }) => void;
}
export interface ClientEvents {
    'call:media': (shareId: string | null) => void;
    'call:status': (status: { muted: boolean; deafened: boolean; camera: boolean }) => void;
    'presence:idle': (idle: boolean) => void;
    typing: (room: string, thread?: string) => void;
    'call:join': (channel: string, ack: (result: JoinResult) => void) => void;
    'call:leave': () => void;
    'call:speaking': (active: boolean) => void;
    signal: (event: { to: string; data: CallSignal }) => void;
}

// A GIF a member starred; the links are KLIPY's own.
export type GifFavorite = {
    id: string;
    url: string;
    preview: string;
    width: number;
    height: number;
    title: string;
};
