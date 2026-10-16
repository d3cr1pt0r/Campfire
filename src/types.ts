export type User = {
    id: string;
    username: string;
    role: string;
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
};
export type CallMember = {
    socket: string;
    user: string;
    channel: string;
};
export type State = {
    me: User;
    name: string;
    users: User[];
    roles: Role[];
    channels: Channel[];
    friends: {
        sender: string;
        recipient: string;
        accepted: number;
    }[];
    online: string[];
    calls: CallMember[];
    iceServers: RTCIceServer[];
};
export type Message = {
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
    notifications: boolean;
    input: string;
    output: string;
    quality: string;
    noise: boolean;
    pushToTalk: boolean;
    sounds: boolean;
};
