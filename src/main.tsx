import { ChatMessages } from './ChatMessages';
import { CallPanel } from './CallPanel';
import { FriendsPanel } from './FriendsPanel';
import { SettingsPanel } from './SettingsPanel';
import { SimpleForm, RoleForm } from './forms';
import { Avatar, initials } from './Avatar';
import { createStateRefresh } from './stateRefresh';
import { useDialog } from './useDialog';
import { useModalNavigation } from './modalNavigation';
import { createApiClient } from './api';
import { useConversation } from './useConversation';
import { canonicalRoom } from '../shared/rooms.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import type { AppSocket } from './types';
import {
    Menu,
    Hash,
    Volume2,
    Plus,
    Settings,
    Users,
    MessageCircle,
    Mic,
    MicOff,
    Headphones,
    HeadphoneOff,
    PhoneOff,
    Phone,
    Search,
    Pin,
    Paperclip,
    Send,
    Smile,
    ChevronDown,
    X,
    Server,
    Shield,
    ArrowRight,
    Radio,
    Globe,
    Copy,
} from 'lucide-react';
import type { State, Message, Preferences, User } from './types';
import { useCall } from './useCall';
import { displayName } from './profiles';
import { PresenceDot } from './PresenceDot';
import { statusLabels, userStatus } from './presence';
import { usePresence } from './usePresence';

import { AssetContext, Emoji } from './ChatContent';
import { resizeImage } from './images';
import { rememberedDevice } from './devices';
import { useSpeaking } from './useSpeaking';
import { validateFileSelection } from '../shared/uploads.js';
import { emojis as standardEmojis } from '../shared/emojis.js';
import './style.css';
const storage = window.driskord?.storage ?? localStorage;
const defaultServerUrl =
    import.meta.env.VITE_DEFAULT_SERVER_URL?.trim() ||
    (window.driskord
        ? ''
        : window.location.port === '5173'
          ? 'http://localhost:3001'
          : window.location.origin);
const defaultPrefs: Preferences = {
    autoIdle: false,
    idleMinutes: 5,
    notifications: false,
    input: '',
    output: '',
    quality: '720',
    noise: true,
    pushToTalk: false,
    sounds: true,
};
function stored<T>(key: string, fallback: T): T {
    try {
        return JSON.parse(storage.getItem(key) || 'null') ?? fallback;
    } catch {
        return fallback;
    }
}
const initial = stored<{
    url: string;
    token: string;
}>('connection', { url: defaultServerUrl, token: '' });
function App() {
    const [url, setUrl] = useState(initial.url),
        [token, setToken] = useState(initial.token),
        [state, setState] = useState<State | null>(null),
        [connected, setConnected] = useState(false);
    const [socket, setSocket] = useState<AppSocket | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [register, setRegister] = useState(true);
    const [room, setRoom] = useState('general'),
        [view, setView] = useState<'chat' | 'friends'>('chat'),
        [draft, setDraft] = useState(''),
        [attachments, setAttachments] = useState<File[]>([]);
    const [search, setSearch] = useState(''),
        [pins, setPins] = useState(false),
        [members, setMembers] = useState(() => window.innerWidth > 1100),
        [typing, setTyping] = useState<Record<string, number>>({}),
        [unread, setUnread] = useState<Record<string, number>>({});
    const [prefs, setPrefs] = useState<Preferences>(() => ({
        ...defaultPrefs,
        ...stored('preferences', {}),
    }));
    usePresence(socket, prefs);
    const [navigationOpen, setNavigationOpen] = useState(false);
    const [compact, setCompact] = useState(() => window.innerWidth <= 800);
    const navigation = useRef<HTMLDivElement>(null);
    useDialog(navigation, () => setNavigationOpen(false), compact && navigationOpen);
    useEffect(() => {
        const query = window.matchMedia('(max-width: 800px)');
        const update = () => {
            setCompact(query.matches);
            setNavigationOpen(false);
        };
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);
    const [draggingFiles, setDraggingFiles] = useState(false);
    const dragDepth = useRef(0);
    const viewRef = useRef(view);
    viewRef.current = view;
    const { modal, setModal, resetModals } = useModalNavigation();
    const [edit, setEdit] = useState<Message | null>(null),
        [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
        [settingsTab, setSettingsTab] = useState('account');
    const fileInput = useRef<HTMLInputElement>(null),
        roomRef = useRef(room),
        stateRef = useRef(state),
        prefsRef = useRef(prefs),
        lastTyping = useRef(0);
    roomRef.current = room;
    stateRef.current = state;
    prefsRef.current = prefs;
    const notify = useCallback((text: string) => setError(text), []);
    const client = useMemo(() => createApiClient(url, token), [url, token]);
    const api = client.json;
    const roomVisible =
        !!state &&
        (room.startsWith('dm:') ||
            state.channels.some((channel) => channel.id === room && channel.kind === 'text'));
    const conversation = useConversation(api, socket, room, !!token && roomVisible, search, pins);
    useEffect(() => {
        if (
            state &&
            !room.startsWith('dm:') &&
            !state.channels.some((channel) => channel.kind === 'text' && channel.id === room)
        ) {
            setRoom(state.channels.find((channel) => channel.kind === 'text')?.id || '');
            setSearch('');
            setPins(false);
        }
    }, [state?.channels, room]);
    const messages = conversation.messages;
    const stateRefresh = useMemo(
        () =>
            createStateRefresh(
                (signal) => api<State>('/state', 'GET', undefined, signal),
                setState,
                (error) => {
                    if ((error as Error & { status?: number }).status === 401) {
                        setToken('');
                        setState(null);
                        resetModals();
                        setUnread({});
                        setRoom('general');
                        storage.removeItem('connection');
                    }
                    notify(error.message);
                },
            ),
        [api, notify],
    );
    const refresh = stateRefresh.refresh;
    useEffect(() => () => stateRefresh.cancel(), [stateRefresh]);
    const call = useCall(socket, prefs, state?.iceServers || [], notify, () =>
        notify(
            'Saved microphone unavailable; using System default for this call. Your selection is kept for next time.',
        ),
    );
    const speaking = useSpeaking(socket, call.microphone, state?.me.id || '', call.channel);
    useEffect(() => {
        storage.setItem('preferences', JSON.stringify(prefs));
    }, [prefs]);
    useEffect(() => {
        if (!token) return;
        storage.setItem('connection', JSON.stringify({ url, token }));
        const s: AppSocket = io(url, { auth: { token }, reconnectionAttempts: 10 });
        setSocket(s);
        void refresh();
        s.on('connect', () => {
            setConnected(true);
            void refresh();
        });
        s.on('disconnect', (reason) => {
            setConnected(false);
            if (reason === 'io server disconnect') void refresh();
        });
        s.on('connect_error', (e) => {
            setConnected(false);
            setError(`Connection: ${e.message}`);
        });
        s.on('refresh', refresh);
        s.on('presence', (presence) => {
            setState((previous) =>
                previous ? { ...previous, presence, online: Object.keys(presence) } : previous,
            );
        });
        s.on('channels', (channels) => {
            setState((previous) => (previous ? { ...previous, channels } : previous));
            void refresh();
        });
        s.on('call:invite', ({ from }: { from: string }) =>
            notify(
                `${displayName(
                    stateRef.current?.users.find((u) => u.id === from),
                    'A friend',
                )} invited you to a call. Open the call invitation to join.`,
            ),
        );
        s.on('calls', (calls) => setState((prev) => (prev ? { ...prev, calls } : null)));
        s.on('message', (m: Message) => {
            if (m.room !== roomRef.current || viewRef.current !== 'chat')
                setUnread((prev) => ({ ...prev, [m.room]: (prev[m.room] || 0) + 1 }));
            if (
                m.author !== stateRef.current?.me.id &&
                prefsRef.current.notifications &&
                stateRef.current?.me.status !== 'dnd' &&
                document.visibilityState === 'hidden' &&
                Notification.permission === 'granted'
            )
                new Notification(stateRef.current?.name || 'Driskord', {
                    body: `${displayName(
                        stateRef.current?.users.find((u) => u.id === m.author),
                        'Someone',
                    )} sent a message`,
                    silent: !prefsRef.current.sounds,
                });
        });
        s.on('typing', ({ room: r, user }: { room: string; user: string }) => {
            if (r === roomRef.current && user !== stateRef.current?.me.id)
                setTyping((prev) => ({ ...prev, [user]: Date.now() + 3500 }));
        });
        return () => {
            s.disconnect();
            setSocket(null);
            setConnected(false);
        };
    }, [url, token, refresh]);
    useEffect(() => {
        if (!token || !state) return;
        setUnread((prev) => ({ ...prev, [room]: 0 }));
        setTyping({});
        setDraft('');
        setAttachments([]);
    }, [room, token, !!state, api, notify]);
    useEffect(() => {
        dragDepth.current = 0;
        setDraggingFiles(false);
    }, [room, view]);
    useEffect(() => {
        const t = setInterval(
            () =>
                setTyping((prev) =>
                    Object.fromEntries(
                        Object.entries(prev).filter(([, expires]) => expires > Date.now()),
                    ),
                ),
            1500,
        );
        return () => clearInterval(t);
    }, []);
    useEffect(() => {
        if (view === 'chat') setUnread((prev) => ({ ...prev, [room]: 0 }));
    }, [view, room]);
    useEffect(() => {
        if (modal !== 'settings') return;
        const refreshDevices = () =>
            navigator.mediaDevices
                ?.enumerateDevices()
                .then((list) => {
                    setDevices(list);
                    setPrefs((previous) => ({
                        ...previous,
                        input: rememberedDevice(
                            list,
                            'audioinput',
                            previous.input,
                            previous.inputLabel,
                        ),
                        inputLabel:
                            list.find(
                                (d) => d.kind === 'audioinput' && d.deviceId === previous.input,
                            )?.label || previous.inputLabel,
                        output: rememberedDevice(
                            list,
                            'audiooutput',
                            previous.output,
                            previous.outputLabel,
                        ),
                        outputLabel:
                            list.find(
                                (d) => d.kind === 'audiooutput' && d.deviceId === previous.output,
                            )?.label || previous.outputLabel,
                    }));
                })
                .catch(() => {});
        void refreshDevices();
        navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
        return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
    }, [modal]);
    useEffect(() => {
        if (modal) setNavigationOpen(false);
    }, [modal]);
    const modalContainer = useRef<HTMLElement>(null);
    useDialog(
        modalContainer,
        () => {
            if (!busy) setModal(null);
        },
        !!modal,
        undefined,
        modal || undefined,
    );
    const act = async (fn: () => Promise<unknown>) => {
        try {
            setBusy(true);
            await fn();
        } catch (e) {
            notify((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const permission = (p: string) =>
        !!state &&
        (state.me.role === 'owner' ||
            !!state.roles.find((r) => r.id === state.me.role)?.permissions.includes(p));
    const canPost =
        permission('send') &&
        (room.startsWith('dm:') ||
            state?.channels.find((channel) => channel.id === room)?.access === 'full');
    const conversationPermission = (name: string) => permission(name) && canPost;
    useEffect(() => {
        if (!canPost)
            setModal((previous) =>
                previous === 'edit' ||
                previous?.startsWith('reaction:') ||
                previous?.startsWith('delete:')
                    ? null
                    : previous,
            );
        if (!roomVisible) setEdit(null);
    }, [canPost, roomVisible]);
    const user = (id: string) => state?.users.find((u) => u.id === id);
    const color = (u?: User) => state?.roles.find((r) => r.id === u?.role)?.color;
    const dm = (id: string) => {
        if (!state) return;
        setRoom(canonicalRoom(`dm:${state.me.id}:${id}`));
        setView('chat');
        setNavigationOpen(false);
        setSearch('');
        setPins(false);
    };
    const selectRoom = (id: string) => {
        setRoom(id);
        setView('chat');
        setNavigationOpen(false);
        setSearch('');
        setPins(false);
    };
    const login = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await act(async () => {
            const target = String(f.get('url')).trim().replace(/\/$/, '');
            const parsed = new URL(target);
            if (
                !['http:', 'https:'].includes(parsed.protocol) ||
                parsed.username ||
                parsed.password ||
                parsed.search ||
                parsed.hash ||
                parsed.pathname !== '/'
            )
                throw new Error('Enter a server origin, for example https://chat.example.com');
            const data = await createApiClient(target, '').json<{ token: string }>(
                `/auth/${register ? 'register' : 'login'}`,
                'POST',
                { username: f.get('username'), password: f.get('password') },
            );
            setUrl(target);
            setToken(data.token);
            setError('');
        });
    };
    const addFiles = (files: File[]) => {
        if (!canPost) {
            notify('This conversation is read-only. Files cannot be uploaded.');
            return;
        }
        if (busy) {
            notify('Wait for the current upload to finish.');
            return;
        }
        if (!files.length) {
            notify('Drop files into chat; folders are not supported.');
            return;
        }
        try {
            const selected = [...attachments, ...files];
            validateFileSelection(selected);
            setAttachments(selected);
        } catch (error) {
            notify((error as Error).message);
        }
    };
    const resetDrop = () => {
        dragDepth.current = 0;
        setDraggingFiles(false);
    };
    const send = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft.trim() && !attachments.length) return;
        const text = draft,
            files = [...attachments],
            targetRoom = room;
        await act(async () => {
            validateFileSelection(files);
            const payload = await Promise.all(
                files.map(async (file) => {
                    const data = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result).split(',')[1]);
                        reader.onerror = () => reject(new Error('Could not read file'));
                        reader.readAsDataURL(file);
                    });
                    return { name: file.name, data };
                }),
            );
            await api('/messages', 'POST', { room: targetRoom, body: text, attachments: payload });
            if (roomRef.current !== targetRoom) return;
            setDraft((previous) => (previous === text ? '' : previous));
            setAttachments([]);
        });
    };
    const download = async (id: string, name: string) =>
        act(async () => {
            const blob = URL.createObjectURL(await client.blob(`/attachments/${id}`));
            const a = document.createElement('a');
            a.href = blob;
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(blob), 10000);
        });
    const startDirectCall = (id: string) =>
        act(async () => {
            if (call.channel) throw new Error('Leave your current call before starting another.');
            const result = await api<{ id: string }>('/calls', 'POST', { user: id });
            await call.join(result.id);
        });
    const uploadAvatar = async (data: string) => {
        await api('/profile/avatar', 'POST', { data });
        await refresh();
    };
    const loadAvatar = async () =>
        new File([await client.blob(`/avatars/${state?.me.avatar}`)], 'avatar.png', {
            type: 'image/png',
        });
    const uploadEmoji = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const file = form.get('image') as File;
        void act(async () => {
            await api('/emojis', 'POST', {
                name: form.get('name'),
                data: await resizeImage(file, 128),
            });
            await refresh();
            notify('Custom emoji uploaded.');
        });
    };
    const callName = state?.channels.find((c) => c.id === call.channel)?.name || 'Private call';
    const logout = async () => {
        await act(async () => {
            await api('/logout', 'POST');
            call.leave();
            setToken('');
            setState(null);
            resetModals();
            setUnread({});
            setRoom('general');
            storage.removeItem('connection');
        });
    };
    const visibleMessages = messages;
    const currentChannel = state?.channels.find((c) => c.id === room),
        dmUser = room.startsWith('dm:')
            ? user(room.split(':').find((id) => id !== state?.me.id && id !== 'dm') || '')
            : undefined;
    const openSettings = (tab = 'account') => {
        setSettingsTab(tab);
        setModal('settings');
    };
    const removingFriend = state?.friends.find((friend) =>
        [friend.sender, friend.recipient].includes(modal?.split(':')[1] || ''),
    );
    const friendAction = removingFriend?.accepted
        ? 'Remove friend'
        : removingFriend?.sender === state?.me.id
          ? 'Cancel request'
          : 'Decline request';
    const showError = error && (
        <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss notification">
                <X size={17} />
            </button>
        </div>
    );
    if (!token || !state)
        return (
            <div className="auth-shell">
                <div className="auth-art">
                    <div className="wordmark">
                        <MessageCircle fill="currentColor" /> driskord<span>BETA</span>
                    </div>
                    <div className="auth-orbit">
                        <div className="orbit-icon">
                            <Headphones size={70} />
                        </div>
                        <i />
                        <i />
                        <i />
                    </div>
                    <h1>
                        Your people.
                        <br />
                        <em>Your place.</em>
                    </h1>
                    <p>
                        A little less noise. A lot more connection.
                        <br />
                        Chat, call, and hang out on a server you own.
                    </p>
                    <div className="auth-features">
                        <span>
                            <Shield size={17} /> Self-hosted by you
                        </span>
                        <span>
                            <Globe size={17} /> Made for your community
                        </span>
                    </div>
                </div>
                <main className="auth-form">
                    <div className="mini-label">MAKE YOURSELF AT HOME</div>
                    <h2>
                        {token
                            ? 'Connecting to your server…'
                            : register
                              ? 'Good conversations start here.'
                              : 'Welcome back.'}
                    </h2>
                    <p className="muted">
                        {token
                            ? 'Waiting for your server to respond.'
                            : register
                              ? 'Create an account on your community’s server.'
                              : 'Your people are just a sign-in away.'}
                    </p>
                    {token ? (
                        <>
                            <button className="primary" onClick={() => void refresh()}>
                                Retry connection
                            </button>
                            <button
                                onClick={() => {
                                    setToken('');
                                    storage.removeItem('connection');
                                }}
                            >
                                Use another server
                            </button>
                        </>
                    ) : (
                        <form onSubmit={login}>
                            <label>
                                Server address
                                <input
                                    name="url"
                                    type="url"
                                    defaultValue={url}
                                    required
                                    placeholder="https://chat.example.com"
                                />
                            </label>
                            <label>
                                Username
                                <input
                                    name="username"
                                    autoComplete="username"
                                    minLength={2}
                                    maxLength={32}
                                    required
                                    placeholder={
                                        register
                                            ? 'Choose a permanent username'
                                            : 'Enter your username'
                                    }
                                    autoCapitalize="none"
                                    spellCheck={false}
                                />
                            </label>
                            {register && (
                                <p className="field-help">
                                    Your username is permanent. You can change your display nickname
                                    later.
                                </p>
                            )}
                            <label>
                                Password
                                <input
                                    name="password"
                                    type="password"
                                    autoComplete={register ? 'new-password' : 'current-password'}
                                    minLength={10}
                                    maxLength={128}
                                    required
                                    placeholder="At least 10 characters"
                                />
                            </label>
                            <button className="primary" disabled={busy}>
                                {busy ? 'Just a moment…' : register ? 'Create account' : 'Sign in'}
                                <ArrowRight size={18} />
                            </button>
                            <p className="auth-switch">
                                {register ? 'Already have an account?' : 'New around here?'}{' '}
                                <button type="button" onClick={() => setRegister(!register)}>
                                    {register ? 'Sign in' : 'Create account'}
                                </button>
                            </p>
                        </form>
                    )}
                    <div className="self-host-note">
                        <Server size={20} />
                        <p>
                            The first account on a new server becomes its owner.
                            <br />
                            Your account and conversations stay on that server.
                        </p>
                    </div>
                </main>
                {showError}
            </div>
        );
    return (
        <AssetContext.Provider value={{ url, token }}>
            <div
                className="app-shell"
                onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
                }}
                onDrop={(e) => {
                    if (e.dataTransfer.types.includes('Files')) {
                        e.preventDefault();
                        resetDrop();
                    }
                }}
                onDragEnd={resetDrop}
            >
                {compact && navigationOpen && (
                    <div
                        className="navigation-backdrop"
                        onClick={() => setNavigationOpen(false)}
                        aria-hidden="true"
                    />
                )}
                <div
                    className={`navigation-shell ${navigationOpen ? 'is-open' : ''}`}
                    ref={navigation}
                    tabIndex={-1}
                    role={compact ? 'dialog' : undefined}
                    aria-modal={compact && navigationOpen ? true : undefined}
                    aria-label="Server navigation"
                    onClick={(event) => {
                        if (
                            (event.target as HTMLElement).closest(
                                '.nav-item, .brand-icon, .server-icon',
                            )
                        )
                            setNavigationOpen(false);
                    }}
                >
                    <nav className="server-rail" aria-label="Servers">
                        <button
                            className="brand-icon"
                            title="Friends"
                            onClick={() => setView('friends')}
                        >
                            <MessageCircle size={28} />
                        </button>
                        <div className="rail-divider" />
                        <button
                            className="server-icon active"
                            title={state.name}
                            onClick={() =>
                                selectRoom(
                                    state.channels.find((channel) => channel.kind === 'text')?.id ||
                                        '',
                                )
                            }
                        >
                            {initials(state.name)}
                        </button>
                        <button
                            className="rail-add"
                            title="Connect to another server"
                            onClick={() => setModal('switch')}
                        >
                            <Plus />
                        </button>
                        <div className="rail-spacer" />
                        <button title="Settings" onClick={() => openSettings()}>
                            <Settings size={23} />
                        </button>
                        <span className="rail-version">v0.1.4</span>
                    </nav>
                    <aside className="sidebar">
                        <button
                            className="navigation-close"
                            aria-label="Close navigation"
                            onClick={() => setNavigationOpen(false)}
                        >
                            <X size={20} />
                        </button>
                        <button className="server-heading" onClick={() => openSettings('server')}>
                            <span>
                                {state.name}
                                <small>
                                    <i className={connected ? 'online-dot' : 'offline-dot'} />
                                    {connected ? 'Your community, connected' : 'Reconnecting…'}
                                </small>
                            </span>
                            <ChevronDown size={18} />
                        </button>
                        <div className="sidebar-content">
                            <button
                                className={`nav-item ${view === 'friends' ? 'selected' : ''}`}
                                aria-current={view === 'friends' ? 'page' : undefined}
                                onClick={() => setView('friends')}
                            >
                                <Users size={19} /> Friends{' '}
                                {state.friends.some(
                                    (f) => !f.accepted && f.recipient === state.me.id,
                                ) && <span className="count">!</span>}
                            </button>
                            <div className="category">
                                <span>TEXT CHANNELS</span>
                                {permission('manage') && (
                                    <button
                                        title="Manage channels and access"
                                        onClick={() => openSettings('channels')}
                                    >
                                        <Settings size={15} />
                                    </button>
                                )}
                                {permission('manage') && (
                                    <button
                                        title="Create text channel"
                                        onClick={() => setModal('channel:text')}
                                    >
                                        <Plus size={16} />
                                    </button>
                                )}
                            </div>
                            {state.channels
                                .filter((c) => c.kind === 'text')
                                .map((c) => (
                                    <button
                                        key={c.id}
                                        className={`nav-item channel ${room === c.id && view === 'chat' ? 'selected' : ''}`}
                                        aria-current={
                                            room === c.id && view === 'chat' ? 'page' : undefined
                                        }
                                        onClick={() => selectRoom(c.id)}
                                    >
                                        <Hash size={20} />
                                        {c.name}
                                        {unread[c.id] > 0 && (
                                            <span className="count">{unread[c.id]}</span>
                                        )}
                                    </button>
                                ))}
                            <div className="category">
                                <span>VOICE CHANNELS</span>
                                {permission('manage') && (
                                    <button
                                        title="Manage voice channels and access"
                                        onClick={() => openSettings('channels')}
                                    >
                                        <Settings size={15} />
                                    </button>
                                )}
                                {permission('manage') && (
                                    <button
                                        title="Create voice channel"
                                        onClick={() => setModal('channel:voice')}
                                    >
                                        <Plus size={16} />
                                    </button>
                                )}
                            </div>
                            {state.channels
                                .filter((c) => c.kind === 'voice')
                                .map((c) => (
                                    <React.Fragment key={c.id}>
                                        <button
                                            className={`nav-item channel ${call.channel === c.id ? 'in-call' : ''}`}
                                            onClick={() => {
                                                if (call.channel !== c.id) void call.join(c.id);
                                            }}
                                        >
                                            <Volume2 size={20} />
                                            {c.name}
                                            {call.channel === c.id && <Radio size={15} />}
                                        </button>
                                        {state.calls
                                            .filter((p) => p.channel === c.id)
                                            .map((p) => (
                                                <div className="voice-member" key={p.socket}>
                                                    <Avatar
                                                        user={user(p.user)}
                                                        color={color(user(p.user))}
                                                        small
                                                        speaking={speaking.has(p.user)}
                                                    />
                                                    {displayName(user(p.user))}
                                                </div>
                                            ))}
                                    </React.Fragment>
                                ))}
                            {(state.directCalls || [])
                                .filter((c) => c.members.includes(state.me.id))
                                .map((c) => (
                                    <button
                                        className={`nav-item ${call.channel === c.id ? 'in-call' : ''}`}
                                        key={c.id}
                                        disabled={!!call.channel && call.channel !== c.id}
                                        onClick={() => {
                                            if (call.channel !== c.id) void call.join(c.id);
                                        }}
                                    >
                                        <Phone size={18} />
                                        Private call ·{' '}
                                        {state.calls.filter((p) => p.channel === c.id).length}{' '}
                                        connected
                                    </button>
                                ))}
                            <div className="category">
                                <span>DIRECT MESSAGES</span>
                                <button
                                    title="Start a direct message"
                                    onClick={() => setView('friends')}
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                            {state.friends
                                .filter((f) => f.accepted)
                                .map((f) => {
                                    const id = f.sender === state.me.id ? f.recipient : f.sender;
                                    const u = user(id);
                                    const dmRoom = canonicalRoom(`dm:${state.me.id}:${id}`);
                                    return (
                                        <button
                                            className={`nav-item ${room === dmRoom && view === 'chat' ? 'selected' : ''}`}
                                            key={id}
                                            onClick={() => dm(id)}
                                        >
                                            <Avatar user={u} color={color(u)} small />
                                            {displayName(u)}
                                            {unread[dmRoom] > 0 && (
                                                <span className="count">{unread[dmRoom]}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            {!state.friends.some((f) => f.accepted) && (
                                <p className="sidebar-hint">
                                    Good conversations start
                                    <br />
                                    with a hello. Add a friend.
                                </p>
                            )}
                        </div>
                        <div className="server-owned">
                            <Shield size={15} />
                            <span>Self-hosted. Yours to keep.</span>
                        </div>
                        {call.channel && (
                            <div className="voice-connected">
                                <div>
                                    <Radio size={17} />
                                    <strong>Voice connected</strong>
                                    <button title="Disconnect call" onClick={call.leave}>
                                        <PhoneOff size={17} />
                                    </button>
                                </div>
                                <small>
                                    {callName} / {state.name}
                                </small>
                            </div>
                        )}
                        <div className="user-bar">
                            <div className="avatar-status self-avatar">
                                <Avatar user={state.me} color={color(state.me)} />
                                <PresenceDot
                                    status={connected ? userStatus(state, state.me.id) : 'offline'}
                                />
                            </div>
                            <div className="user-name">
                                <button onClick={() => openSettings()}>
                                    <strong>{displayName(state.me)}</strong>
                                </button>
                                <label className="sr-only" htmlFor="user-status">
                                    Your status
                                </label>
                                <select
                                    id="user-status"
                                    aria-label="Your status"
                                    value={state.me.status || 'online'}
                                    disabled={busy || !connected}
                                    onChange={(event) => {
                                        const status = event.target.value;
                                        void act(async () => {
                                            await api('/presence', 'PATCH', { status });
                                            await refresh();
                                        });
                                    }}
                                >
                                    <option value="online">
                                        {connected
                                            ? userStatus(state, state.me.id) === 'idle' &&
                                              (state.me.status || 'online') === 'online'
                                                ? 'Idle (automatic)'
                                                : 'Online'
                                            : 'Reconnecting…'}
                                    </option>
                                    <option value="idle">Idle</option>
                                    <option value="dnd">Do not disturb</option>
                                </select>
                            </div>
                            <button
                                title={call.muted ? 'Unmute' : 'Mute microphone'}
                                aria-pressed={call.muted}
                                onClick={() => call.setMuted(!call.muted)}
                            >
                                {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
                            </button>
                            <button
                                title={call.deafened ? 'Undeafen' : 'Deafen'}
                                aria-pressed={call.deafened}
                                onClick={() => call.setDeafened(!call.deafened)}
                            >
                                {call.deafened ? (
                                    <HeadphoneOff size={18} />
                                ) : (
                                    <Headphones size={18} />
                                )}
                            </button>
                            <button title="Settings" onClick={() => openSettings()}>
                                <Settings size={18} />
                            </button>
                        </div>
                    </aside>
                </div>
                <main className="workspace" inert={compact && navigationOpen}>
                    <header className="topbar">
                        <button
                            className="navigation-toggle"
                            title="Channels and friends"
                            aria-label="Open navigation"
                            aria-expanded={navigationOpen}
                            onClick={() => setNavigationOpen(true)}
                        >
                            <Menu size={22} />
                        </button>
                        <div className="channel-title">
                            {view === 'friends' ? (
                                <Users size={23} />
                            ) : dmUser ? (
                                <MessageCircle size={23} />
                            ) : (
                                <Hash size={25} />
                            )}
                            <strong>
                                {view === 'friends'
                                    ? 'Friends'
                                    : displayName(dmUser, '') ||
                                      currentChannel?.name ||
                                      'Conversation'}
                            </strong>
                            <span className="title-divider" />
                            <span className="channel-description">
                                {view === 'friends'
                                    ? 'Better together.'
                                    : dmUser
                                      ? 'A space for the two of you.'
                                      : 'A place for everyday conversations.'}
                            </span>
                        </div>
                        <div className="top-actions">
                            {view === 'chat' && (
                                <>
                                    {dmUser && (
                                        <button
                                            title="Call friend"
                                            disabled={!!call.channel || !permission('voice')}
                                            onClick={() => void startDirectCall(dmUser.id)}
                                        >
                                            <Phone size={20} />
                                        </button>
                                    )}
                                    <button
                                        title="Pinned messages"
                                        aria-label="Pinned messages"
                                        aria-pressed={pins}
                                        className={pins ? 'highlight' : ''}
                                        onClick={() => setPins(!pins)}
                                    >
                                        <Pin size={20} />
                                    </button>
                                    <button
                                        title="Toggle member list"
                                        aria-label="Members"
                                        aria-expanded={members}
                                        aria-controls="community-members"
                                        onClick={() => setMembers(!members)}
                                    >
                                        <Users size={21} />
                                    </button>
                                    <label className="search">
                                        <span className="sr-only">Search this conversation</span>
                                        <input
                                            type="search"
                                            placeholder="Search messages"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                        />
                                        <Search size={16} />
                                    </label>
                                </>
                            )}
                            <span
                                className={`connection-status ${connected ? '' : 'disconnected'}`}
                                title={connected ? 'Connected' : 'Disconnected'}
                            >
                                <i />
                                <span className="sr-only">
                                    {connected ? 'Connected' : 'Disconnected; reconnecting'}
                                </span>
                            </span>
                        </div>
                    </header>
                    {!connected && (
                        <div className="connection-banner" role="status">
                            Connection lost. Reconnecting… Messages will be available when the
                            server returns.
                        </div>
                    )}
                    {call.channel && (
                        <CallPanel
                            state={state}
                            call={call}
                            prefs={prefs}
                            speaking={speaking}
                            callName={callName}
                            setModal={setModal}
                            notify={notify}
                            user={user}
                        />
                    )}
                    <div className="call-invitations">
                        {(state.directCalls || [])
                            .filter((c) => c.invited.includes(state.me.id))
                            .map((c) => (
                                <div key={c.id}>
                                    <span>
                                        {displayName(user(c.creator)) || 'A friend'} invited you to
                                        a private call
                                    </span>
                                    <button
                                        className="primary"
                                        disabled={!!call.channel}
                                        onClick={() => void call.join(c.id)}
                                    >
                                        Join call
                                    </button>
                                    <button
                                        onClick={() =>
                                            void act(() => api(`/calls/${c.id}/decline`, 'POST'))
                                        }
                                    >
                                        Decline
                                    </button>
                                </div>
                            ))}
                    </div>
                    <div className="main-columns">
                        {view === 'friends' ? (
                            <FriendsPanel
                                state={state}
                                call={call}
                                startDirectCall={startDirectCall}
                                permission={permission}
                                user={user}
                                color={color}
                                dm={dm}
                                setModal={setModal}
                                act={act}
                                api={api}
                            />
                        ) : (
                            <section
                                className={`chat-area ${draggingFiles ? 'dragging-files' : ''}`}
                                onDragEnter={(e) => {
                                    if (e.dataTransfer.types.includes('Files')) {
                                        e.preventDefault();
                                        dragDepth.current++;
                                        setDraggingFiles(true);
                                    }
                                }}
                                onDragLeave={() => {
                                    dragDepth.current = Math.max(0, dragDepth.current - 1);
                                    if (!dragDepth.current) setDraggingFiles(false);
                                }}
                                onDragOver={(e) => {
                                    if (e.dataTransfer.types.includes('Files')) {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect =
                                            canPost && !busy ? 'copy' : 'none';
                                    }
                                }}
                                onDrop={(e) => {
                                    if (e.dataTransfer.types.includes('Files')) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        resetDrop();
                                        addFiles(Array.from(e.dataTransfer.files));
                                    }
                                }}
                            >
                                {draggingFiles && (
                                    <div className="file-drop-overlay">
                                        <Paperclip size={42} />
                                        <strong>
                                            {canPost
                                                ? 'Drop files to attach'
                                                : 'This conversation is read-only'}
                                        </strong>
                                        <span>
                                            Up to 10 files · 5 MB total · Review before sending
                                        </span>
                                    </div>
                                )}
                                <ChatMessages
                                    key={`${url}:${state.me.id}:${room}:${search}:${pins}`}
                                    permission={conversationPermission}
                                    conversation={conversation}
                                    search={search}
                                    pins={pins}
                                    dmUser={dmUser}
                                    currentChannel={currentChannel}
                                    visibleMessages={visibleMessages}
                                    user={user}
                                    color={color}
                                    state={state}
                                    dm={dm}
                                    download={download}
                                    act={act}
                                    api={api}
                                    setModal={setModal}
                                    setEdit={setEdit}
                                    clearFilters={() => {
                                        setSearch('');
                                        setPins(false);
                                    }}
                                />
                                <div className="composer-wrap">
                                    {attachments.map((file, index) => (
                                        <div
                                            className="attachment-preview"
                                            key={`${index}:${file.name}`}
                                        >
                                            <Paperclip size={15} />
                                            {file.name}
                                            <small>{Math.ceil(file.size / 1024)} KB</small>
                                            <button
                                                disabled={busy}
                                                onClick={() =>
                                                    setAttachments((previous) =>
                                                        previous.filter((_, i) => i !== index),
                                                    )
                                                }
                                                aria-label={`Remove ${file.name}`}
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>
                                    ))}
                                    <form className="composer" onSubmit={send}>
                                        <button
                                            type="button"
                                            title="Attach files (up to 10 files, 5 MB total)"
                                            disabled={busy || !canPost}
                                            onClick={() => fileInput.current?.click()}
                                        >
                                            <Plus size={22} />
                                        </button>
                                        <input
                                            type="file"
                                            multiple
                                            hidden
                                            ref={fileInput}
                                            onChange={(e) => {
                                                addFiles(Array.from(e.target.files || []));
                                                e.target.value = '';
                                            }}
                                        />
                                        <textarea
                                            aria-label="Message"
                                            placeholder={
                                                canPost
                                                    ? `Message ${dmUser ? '@' + displayName(dmUser) : '#' + (currentChannel?.name || 'general')}`
                                                    : 'This conversation is read-only'
                                            }
                                            value={draft}
                                            disabled={!canPost}
                                            maxLength={4000}
                                            rows={1}
                                            style={!draft ? { height: 'auto' } : undefined}
                                            onChange={(e) => {
                                                setDraft(e.target.value);
                                                e.target.style.height = 'auto';
                                                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                                                if (Date.now() - lastTyping.current > 2000) {
                                                    socket?.emit('typing', room);
                                                    lastTyping.current = Date.now();
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (
                                                    e.key === 'Enter' &&
                                                    !e.shiftKey &&
                                                    !e.nativeEvent.isComposing
                                                ) {
                                                    e.preventDefault();
                                                    if (!busy && !e.nativeEvent.isComposing)
                                                        void send(e);
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            title="Add emoji"
                                            disabled={!canPost || busy}
                                            onClick={() => setModal('emoji')}
                                        >
                                            <Smile size={21} />
                                        </button>
                                        <button
                                            className="send-button"
                                            type="submit"
                                            title="Send message"
                                            disabled={
                                                busy ||
                                                !connected ||
                                                !canPost ||
                                                (!draft.trim() && !attachments.length)
                                            }
                                        >
                                            <Send size={18} />
                                        </button>
                                    </form>
                                    <div className="composer-help">
                                        {Object.keys(typing).length ? (
                                            <span>
                                                {Object.keys(typing)
                                                    .map((id) => displayName(user(id)))
                                                    .join(', ')}{' '}
                                                is typing…
                                            </span>
                                        ) : (
                                            <span>
                                                <strong>Enter</strong> to send ·{' '}
                                                <strong>Shift + Enter</strong> for a new line
                                            </span>
                                        )}
                                        <span>
                                            {draft.length > 3500
                                                ? `${draft.length}/4000`
                                                : 'A little hello can go a long way.'}
                                        </span>
                                    </div>
                                </div>
                            </section>
                        )}
                        {members && (
                            <aside
                                className="member-list"
                                id="community-members"
                                aria-label="Community members"
                            >
                                <div className="member-list-heading">
                                    <span>Members · {state.users.length}</span>
                                    <button
                                        aria-label="Close member list"
                                        title="Close member list"
                                        onClick={() => setMembers(false)}
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                {(['online', 'idle', 'dnd', 'offline'] as const).map((status) => {
                                    const group = state.users.filter(
                                        (u) => userStatus(state, u.id) === status,
                                    );
                                    return group.length ? (
                                        <React.Fragment key={status}>
                                            <div className="member-category">
                                                {statusLabels[status].toUpperCase()} —{' '}
                                                {group.length}
                                            </div>
                                            {group.map((u) => (
                                                <button
                                                    className="member"
                                                    key={u.id}
                                                    onClick={() => {
                                                        if (u.id !== state.me.id) dm(u.id);
                                                        else openSettings();
                                                    }}
                                                >
                                                    <div className="avatar-status">
                                                        <Avatar user={u} color={color(u)} />
                                                        <PresenceDot status={status} />
                                                    </div>
                                                    <span>
                                                        <strong style={{ color: color(u) }}>
                                                            {displayName(u)}
                                                            {u.id === state.me.id && (
                                                                <small>you</small>
                                                            )}
                                                        </strong>
                                                        <small>
                                                            {
                                                                state.roles.find(
                                                                    (r) => r.id === u.role,
                                                                )?.name
                                                            }
                                                        </small>
                                                    </span>
                                                    {u.role === 'owner' && (
                                                        <Shield
                                                            size={14}
                                                            className="owner-shield"
                                                        />
                                                    )}
                                                </button>
                                            ))}
                                        </React.Fragment>
                                    ) : null;
                                })}
                                <div className="community-card">
                                    <div className="community-card-icon">
                                        <MessageCircle size={23} />
                                        <span>✦</span>
                                    </div>
                                    <strong>Small server. Big possibilities.</strong>
                                    <p>Make a little corner of the internet feel like home.</p>
                                    <button
                                        onClick={() =>
                                            void act(async () => {
                                                await navigator.clipboard.writeText(url);
                                                notify(
                                                    'Server address copied. Share it with your friends.',
                                                );
                                            })
                                        }
                                    >
                                        Copy server address <Copy size={13} />
                                    </button>
                                </div>
                            </aside>
                        )}
                    </div>
                    <footer className="status-bar">
                        <span>
                            <Shield size={12} /> Your server. Your conversations.
                        </span>
                        <span>
                            Driskord <i /> Early access
                        </span>
                    </footer>
                </main>
                {modal && (
                    <div
                        className="modal-backdrop"
                        onMouseDown={(e) => {
                            if (e.target === e.currentTarget && !busy) setModal(null);
                        }}
                    >
                        <section
                            ref={modalContainer}
                            tabIndex={-1}
                            className={`modal ${modal === 'settings' ? 'settings-modal' : ''}`}
                            role="dialog"
                            aria-modal="true"
                            aria-label={modal === 'settings' ? 'Settings' : undefined}
                            aria-labelledby={
                                modal !== 'settings' ? 'action-dialog-title' : undefined
                            }
                        >
                            {modal !== 'settings' && (
                                <button
                                    className="modal-close"
                                    aria-label="Close dialog"
                                    disabled={busy}
                                    onClick={() => setModal(null)}
                                >
                                    <X size={21} />
                                </button>
                            )}
                            {modal === 'settings' ? (
                                <SettingsPanel
                                    state={state}
                                    prefs={prefs}
                                    setPrefs={setPrefs}
                                    settingsTab={settingsTab}
                                    setSettingsTab={setSettingsTab}
                                    setModal={setModal}
                                    logout={logout}
                                    color={color}
                                    act={act}
                                    api={api}
                                    refresh={refresh}
                                    notify={notify}
                                    busy={busy}
                                    uploadAvatar={uploadAvatar}
                                    loadAvatar={loadAvatar}
                                    url={url}
                                    devices={devices}
                                    setDevices={setDevices}
                                    call={call}
                                    uploadEmoji={uploadEmoji}
                                    permission={permission}
                                />
                            ) : modal === 'invite-call' ? (
                                <>
                                    <h2 id="action-dialog-title">Invite a friend to this call</h2>
                                    <p>Your friend can accept or decline the invitation.</p>
                                    {state.friends
                                        .filter((f) => f.accepted)
                                        .map((f) => {
                                            const id =
                                                f.sender === state.me.id ? f.recipient : f.sender;
                                            const room = state.directCalls?.find(
                                                (c) => c.id === call.channel,
                                            );
                                            return (
                                                <button
                                                    className="invite-friend"
                                                    key={id}
                                                    disabled={
                                                        busy ||
                                                        !state.online.includes(id) ||
                                                        room?.members.includes(id) ||
                                                        room?.invited.includes(id)
                                                    }
                                                    onClick={() =>
                                                        void act(async () => {
                                                            await api(
                                                                `/calls/${call.channel}/invite`,
                                                                'POST',
                                                                { user: id },
                                                            );
                                                            setModal(null);
                                                        })
                                                    }
                                                >
                                                    {displayName(user(id))} ·{' '}
                                                    {room?.members.includes(id)
                                                        ? 'In this call'
                                                        : room?.invited.includes(id)
                                                          ? 'Invited'
                                                          : state.online.includes(id)
                                                            ? 'Invite'
                                                            : 'Offline'}
                                                </button>
                                            );
                                        })}
                                </>
                            ) : modal === 'switch' ? (
                                <>
                                    <Server size={35} className="settings-hero" />
                                    <h2 id="action-dialog-title">Connect to another server</h2>
                                    <p className="muted">
                                        Sign out to enter another server address. You’ll need an
                                        account on that server. Your current messages stay on this
                                        server.
                                    </p>
                                    <button
                                        className="primary"
                                        onClick={() =>
                                            void act(async () => {
                                                await api('/logout', 'POST');
                                                call.leave();
                                                setToken('');
                                                setState(null);
                                                setUnread({});
                                                setRoom('general');
                                                resetModals();
                                                storage.removeItem('connection');
                                            })
                                        }
                                    >
                                        Sign out & connect
                                    </button>
                                </>
                            ) : modal === 'friend' ? (
                                <>
                                    <Users size={35} className="settings-hero" />
                                    <h2 id="action-dialog-title">Find your people.</h2>
                                    <p className="muted">
                                        Enter their exact username on this server.
                                    </p>
                                    <SimpleForm
                                        label="Username"
                                        submit="Send friend request"
                                        busy={busy}
                                        onSubmit={(value) =>
                                            act(async () => {
                                                await api('/friends', 'POST', { username: value });
                                                setModal(null);
                                            })
                                        }
                                    />
                                </>
                            ) : modal.startsWith('channel:') ? (
                                <>
                                    <h2 id="action-dialog-title">
                                        Create a {modal.split(':')[1]} channel
                                    </h2>
                                    <p className="muted">
                                        Voice names can include capitals and spaces. Text names
                                        convert to lowercase with hyphens.
                                    </p>
                                    <SimpleForm
                                        label="Channel name"
                                        submit="Create channel"
                                        busy={busy}
                                        onSubmit={(value) =>
                                            act(async () => {
                                                await api('/channels', 'POST', {
                                                    name: value,
                                                    kind: modal.split(':')[1],
                                                });
                                                setModal(null);
                                            })
                                        }
                                    />
                                </>
                            ) : modal === 'edit' ? (
                                <>
                                    <h2 id="action-dialog-title">Edit message</h2>
                                    <SimpleForm
                                        label="Message"
                                        initialValue={edit?.body}
                                        submit="Save message"
                                        busy={busy}
                                        onSubmit={(value) =>
                                            act(async () => {
                                                await api(`/messages/${edit?.id}`, 'PATCH', {
                                                    body: value,
                                                });
                                                setModal(null);
                                            })
                                        }
                                    />
                                </>
                            ) : modal.startsWith('role:') ? (
                                <RoleForm
                                    role={state.roles.find((r) => r.id === modal.split(':')[1])}
                                    busy={busy}
                                    owner={state.me.role === 'owner'}
                                    onSave={(data) =>
                                        act(async () => {
                                            const id = modal.split(':')[1];
                                            await api(
                                                id === 'new' ? '/roles' : `/roles/${id}`,
                                                id === 'new' ? 'POST' : 'PATCH',
                                                data,
                                            );
                                            setModal('settings');
                                            setSettingsTab('roles');
                                        })
                                    }
                                />
                            ) : modal === 'emoji' || modal.startsWith('reaction:') ? (
                                <>
                                    <h2 id="action-dialog-title">
                                        {modal === 'emoji'
                                            ? 'Say it with an emoji.'
                                            : 'Add a reaction'}
                                    </h2>
                                    <div className="emoji-picker">
                                        {[
                                            ...standardEmojis,
                                            ...(state.emojis || []).map((e) => `:${e.name}:`),
                                        ].map((emoji) => (
                                            <button
                                                key={emoji}
                                                onClick={() => {
                                                    if (modal === 'emoji') {
                                                        setDraft((d) => d + emoji);
                                                        setModal(null);
                                                    } else
                                                        void act(async () => {
                                                            await api(
                                                                `/messages/${modal.split(':')[1]}/reaction`,
                                                                'POST',
                                                                { emoji },
                                                            );
                                                            setModal(null);
                                                        });
                                                }}
                                                title={emoji}
                                            >
                                                <Emoji value={emoji} custom={state.emojis || []} />
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        className="secondary"
                                        onClick={() => openSettings('emojis')}
                                    >
                                        Upload custom emoji
                                    </button>
                                </>
                            ) : (
                                <>
                                    <h2 id="action-dialog-title">
                                        {modal.startsWith('delete:')
                                            ? 'Delete this message?'
                                            : `${friendAction}?`}
                                    </h2>
                                    <p className="muted">
                                        {modal.startsWith('delete:')
                                            ? 'This will permanently delete the message and any attachment.'
                                            : 'You can send another friend request later.'}
                                    </p>
                                    <div className="dialog-actions">
                                        <button
                                            className="secondary"
                                            disabled={busy}
                                            onClick={() => setModal(null)}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="primary danger-bg"
                                            disabled={busy}
                                            onClick={() =>
                                                void act(async () => {
                                                    const [action, id] = modal.split(':');
                                                    await api(
                                                        action === 'delete'
                                                            ? `/messages/${id}`
                                                            : `/friends/${id}`,
                                                        'DELETE',
                                                    );
                                                    setModal(null);
                                                })
                                            }
                                        >
                                            {busy
                                                ? 'Working…'
                                                : modal.startsWith('delete:')
                                                  ? 'Delete message'
                                                  : friendAction}
                                        </button>
                                    </div>
                                </>
                            )}
                        </section>
                    </div>
                )}
                {showError}
            </div>
        </AssetContext.Provider>
    );
}
createRoot(document.getElementById('root')!).render(<App />);
