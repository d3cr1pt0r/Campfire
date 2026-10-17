export type PresenceStatus = 'online' | 'idle' | 'dnd';
export type User = {
    id: string;
    username: string;
    nickname: string;
    avatar?: string | null;
    role: string;
    status?: PresenceStatus;
};
export type Role = {
    id: string;
    name: string;
    color: string;
    permissions: string[];
};
export type Channel = {
    id: string;
    name: string;
    kind: 'text' | 'voice';
    description: string;
    protected: boolean;
    reactionAuthors?: number | boolean;
    access: 'full' | 'read-only';
};
export type ChannelAccess = {
    channel: string;
    role: string;
    mode: 'full' | 'read-only' | 'hidden';
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
    removedUsers?: User[];
    users: User[];
    roles: Role[];
    channels: Channel[];
    channelPermissions: ChannelAccess[];
    friends: {
        sender: string;
        recipient: string;
        accepted: number;
    }[];
    online: string[];
    presence: Record<string, PresenceStatus>;
    calls: CallMember[];
    directCalls: { id: string; creator: string; invited: string[]; members: string[] }[];
    emojis: { id: string; name: string; author: string }[];
    iceServers: RTCIceServer[];
};
export type Message = {
    thread?: string | null;
    replyCount?: number;
    id: string;
    room: string;
    author: string;
    body: string;
    created: number;
    edited: number | null;
    pinned: number;
    attachments: {
        id: string;
        name: string;
        mime: string;
    }[];
    reactions: {
        user: string;
        emoji: string;
    }[];
};
export type Preferences = {
    theme?: 'system' | 'dark' | 'light';
    autoIdle?: boolean;
    idleMinutes?: number;
    notifications: boolean;
    messageSounds?: boolean;
    dmNotifications?: boolean;
    mentionNotifications?: boolean;
    channelNotifications?: Record<string, boolean>;
    serverNotifications?: Record<string, boolean>;
    closeToTray?: boolean;
    input: string;
    inputLabel?: string;
    output: string;
    outputLabel?: string;
    quality: string;
    noise: boolean;
    pushToTalk: boolean;
    sounds: boolean;
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
