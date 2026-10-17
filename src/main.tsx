import { hasRolePermission } from '../shared/permissions.js';
import { notificationKey, shouldNotify, createNotificationSound } from './notifications';
import { version as appVersion } from '../package.json';
import { ChatComposer } from './ChatComposer';
import { ThreadPanel } from './ThreadPanel';
import { ChatMessages } from './ChatMessages';
import type { ChatScrollPosition } from './chatScroll';
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
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
    ChevronDown,
    X,
    Server,
    Shield,
    ArrowRight,
    Radio,
    Globe,
    MonitorPlay,
    Video,
    Bell,
    BellOff,
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
import campfireIcon from './assets/campfire-icon.png';
import './style.css';
import './campfire-theme.css';
import { applyTheme, themePreference, watchTheme } from './theme';
import { CampfireScene } from './CampfireScene';
function CampfireMark() {
    return <img className="campfire-mark" src={campfireIcon} alt="" />;
}
const storage = window.driskord?.storage ?? localStorage;
const defaultServerUrl =
    import.meta.env.VITE_DEFAULT_SERVER_URL?.trim() ||
    (window.driskord
        ? ''
        : window.location.port === '5173'
          ? 'http://localhost:3001'
          : window.location.origin);
const defaultPrefs: Preferences = {
    theme: 'system',
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
const initialPreferences: Preferences = {
    ...defaultPrefs,
    ...stored<Partial<Preferences>>('preferences', {}),
};
initialPreferences.theme = themePreference(initialPreferences.theme);
applyTheme(
    initialPreferences.theme,
    document.documentElement,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
);
const initial = stored<{
    url: string;
    token: string;
}>('connection', { url: defaultServerUrl, token: '' });
const invitationFromLink = new URLSearchParams(window.location.hash.slice(1)).get('invite') || '';
if (invitationFromLink)
    history.replaceState(null, '', window.location.pathname + window.location.search);
function App() {
    const chatScrollMemory = useRef(new Map<string, ChatScrollPosition>());
    const [url, setUrl] = useState(initial.url),
        [token, setToken] = useState(initial.token),
        [state, setState] = useState<State | null>(null),
        [connected, setConnected] = useState(false);
    const [socket, setSocket] = useState<AppSocket | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [register, setRegister] = useState(true);
    const [authUrl, setAuthUrl] = useState(
        invitationFromLink ? window.location.origin : initial.url,
    );
    const [inviteCode, setInviteCode] = useState(invitationFromLink);
    const [serverInfo, setServerInfo] = useState<{
        registrationMode: 'open' | 'invite';
        setupRequired: boolean;
    } | null>(null);
    const [infoError, setInfoError] = useState('');
    useEffect(() => {
        if (token) return;
        setServerInfo(null);
        setInfoError('');
        const controller = new AbortController();
        const timer = setTimeout(() => {
            try {
                const parsed = new URL(authUrl.trim());
                if (
                    !['http:', 'https:'].includes(parsed.protocol) ||
                    parsed.username ||
                    parsed.password ||
                    parsed.pathname !== '/' ||
                    parsed.search ||
                    parsed.hash
                )
                    return;
                void createApiClient(parsed.origin, '')
                    .json<{ registrationMode: 'open' | 'invite'; setupRequired: boolean }>(
                        '/info',
                        'GET',
                        undefined,
                        controller.signal,
                    )
                    .then((info) => {
                        if (!controller.signal.aborted) setServerInfo(info);
                    })
                    .catch((e) => {
                        if (!controller.signal.aborted) setInfoError(e.message);
                    });
            } catch {
                /* The submit handler explains invalid addresses. */
            }
        }, 350);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [authUrl, token]);
    const [room, setRoom] = useState('general'),
        [view, setView] = useState<'chat' | 'friends'>('chat'),
        [draft, setDraft] = useState(''),
        [attachments, setAttachments] = useState<File[]>([]);
    const [thread, setThread] = useState<Message | null>(null);
    useEffect(() => setThread(null), [room, url, token, view]);
    const [search, setSearch] = useState(''),
        [pins, setPins] = useState(false),
        [members, setMembers] = useState(() => window.innerWidth > 1100),
        [typing, setTyping] = useState<Record<string, number>>({}),
        [unread, setUnread] = useState<Record<string, number>>({});
    const [prefs, setPrefs] = useState<Preferences>(initialPreferences);
    useLayoutEffect(
        () =>
            watchTheme(
                prefs.theme,
                document.documentElement,
                window.matchMedia('(prefers-color-scheme: dark)'),
            ),
        [prefs.theme],
    );
    usePresence(socket, prefs);
    useEffect(() => {
        const update = () =>
            document.documentElement.classList.toggle('app-focused', document.hasFocus());
        update();
        window.addEventListener('focus', update);
        window.addEventListener('blur', update);
        return () => {
            window.removeEventListener('focus', update);
            window.removeEventListener('blur', update);
        };
    }, []);
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
    const callPanelToggle = useRef<HTMLButtonElement>(null);
    const call = useCall(
        socket,
        prefs,
        state?.iceServers || [],
        notify,
        () =>
            notify(
                'Saved microphone unavailable; using System default for this call. Your selection is kept for next time.',
            ),
        (p) =>
            !!state &&
            hasRolePermission(
                state.me.role,
                state.roles.find((r) => r.id === state.me.role)?.permissions || [],
                p,
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
        const messageSound = createNotificationSound();
        const seenMessages = new Set<string>();
        s.on('message', (m: Message) => {
            if (seenMessages.has(m.id)) return;
            seenMessages.add(m.id);
            if (seenMessages.size > 1000) seenMessages.delete(seenMessages.values().next().value!);
            if (m.room !== roomRef.current || viewRef.current !== 'chat')
                setUnread((prev) => ({ ...prev, [m.room]: (prev[m.room] || 0) + 1 }));
            const me = stateRef.current?.me;
            const preferences = prefsRef.current;
            if (!me || !shouldNotify(m, me, preferences, url, stateRef.current?.users)) return;
            if (preferences.messageSounds !== false) messageSound.play();
            if (
                preferences.notifications &&
                (document.visibilityState === 'hidden' || !document.hasFocus()) &&
                'Notification' in window &&
                Notification.permission === 'granted'
            ) {
                try {
                    const sender = displayName(
                        stateRef.current?.users.find((u) => u.id === m.author),
                        'Someone',
                    );
                    new Notification(stateRef.current?.name || 'Campfire', {
                        body: m.room.startsWith('dm:')
                            ? `${sender} sent you a direct message`
                            : `${sender} mentioned you`,
                        silent: true,
                    });
                } catch {
                    /* OS notifications are optional; do not interrupt message handling. */
                }
            }
        });
        s.on('typing', ({ room: r, user, thread }) => {
            if (!thread && r === roomRef.current && user !== stateRef.current?.me.id)
                setTyping((prev) => ({ ...prev, [user]: Date.now() + 3500 }));
        });
        return () => {
            messageSound.close();
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
        hasRolePermission(
            state.me.role,
            state.roles.find((r) => r.id === state.me.role)?.permissions || [],
            p,
        );
    const canPost =
        permission('messages.send') &&
        (room.startsWith('dm:') ||
            state?.channels.find((channel) => channel.id === room)?.access === 'full');
    const conversationPermission = (name: string) =>
        permission(name) &&
        (name === 'messages.deleteOwn' ||
            ((!currentChannel || currentChannel.access === 'full') &&
                !(dmUser && name === 'messages.deleteOthers')));
    useEffect(() => {
        if (!roomVisible)
            setModal((previous) =>
                previous === 'edit' ||
                previous?.startsWith('reaction:') ||
                previous?.startsWith('delete:')
                    ? null
                    : previous,
            );
        if (!roomVisible) setEdit(null);
    }, [roomVisible]);
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
                {
                    username: f.get('username'),
                    password: f.get('password'),
                    ...(register
                        ? { inviteCode: inviteCode.trim(), setupCode: f.get('setupCode') }
                        : {}),
                },
            );
            setUrl(target);
            setToken(data.token);
            setError('');
        });
    };
    const attachmentsRef = useRef(attachments);
    attachmentsRef.current = attachments;
    const uploadBusy = useRef(busy);
    uploadBusy.current = busy;
    const addFiles = (files: File[]) => {
        if (!canPost || !permission('files.attach')) {
            notify('You do not have permission to attach files in this conversation.');
            return;
        }
        if (uploadBusy.current) {
            notify('Wait for the current upload to finish.');
            return;
        }
        if (!files.length) {
            notify('Drop files into chat; folders are not supported.');
            return;
        }
        try {
            const selected = [...attachmentsRef.current, ...files];
            validateFileSelection(selected);
            attachmentsRef.current = selected;
            setAttachments(selected);
        } catch (error) {
            notify((error as Error).message);
        }
    };
    const pasteDesktop = async (textarea: HTMLTextAreaElement) => {
        if (!window.driskord?.readClipboardAttachments || !canPost) return;
        const targetRoom = room;
        const account = state?.me.id;
        try {
            const clipboard = await window.driskord.readClipboardAttachments();
            if (
                !textarea.isConnected ||
                document.activeElement !== textarea ||
                textarea.disabled ||
                roomRef.current !== targetRoom ||
                stateRef.current?.me.id !== account
            )
                return;
            if (clipboard.files.length) {
                addFiles(
                    clipboard.files.map(
                        (file) =>
                            new File([new Uint8Array(file.data)], file.name, { type: file.type }),
                    ),
                );
            } else if (clipboard.text) {
                // Chromium's text-edit command preserves selection, undo, and
                // the same React input path as ordinary typing.
                textarea.focus();
                document.execCommand('insertText', false, clipboard.text);
            }
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
    useEffect(() => {
        const shortcut = (event: KeyboardEvent) => {
            if (!state || event.isComposing || event.repeat) return;
            const key = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                if (key === 'f' && !event.shiftKey && !modal) {
                    event.preventDefault();
                    setView('chat');
                    requestAnimationFrame(() => {
                        const input = document.querySelector<HTMLInputElement>('.search input');
                        input?.focus();
                        input?.select();
                    });
                } else if (key === ',' && !event.shiftKey && !modal) {
                    event.preventDefault();
                    setSettingsTab('account');
                    setModal('settings');
                } else if (event.shiftKey && call.channel && (key === 'm' || key === 'd')) {
                    event.preventDefault();
                    if (key === 'm') call.setMuted(!call.muted);
                    else call.setDeafened(!call.deafened);
                }
            }
        };
        window.addEventListener('keydown', shortcut);
        return () => window.removeEventListener('keydown', shortcut);
    }, [state, modal, call.channel, call.muted, call.deafened]);
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
                        <CampfireMark /> Campfire<span>BETA</span>
                    </div>
                    <div className="auth-orbit">
                        <CampfireScene />
                    </div>
                    <h1>
                        Pull up a chair.
                        <br />
                        <em>Stay a while.</em>
                    </h1>
                    <p>
                        Good friends. Cold beers. Long conversations.
                        <br />
                        Your own little corner of the internet, warmed by good company.
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
                                    value={authUrl}
                                    onChange={(e) => setAuthUrl(e.target.value)}
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
                            {register && serverInfo?.setupRequired && (
                                <label>
                                    Owner setup code
                                    <input
                                        name="setupCode"
                                        required
                                        autoComplete="off"
                                        maxLength={256}
                                    />
                                    <span className="field-help">
                                        Find this one-time code in your server console. This account
                                        becomes the owner.
                                    </span>
                                </label>
                            )}
                            {register &&
                                !serverInfo?.setupRequired &&
                                serverInfo?.registrationMode !== 'open' && (
                                    <label>
                                        Invitation code
                                        <input
                                            value={inviteCode}
                                            onChange={(e) => setInviteCode(e.target.value)}
                                            required={serverInfo?.registrationMode === 'invite'}
                                            autoComplete="off"
                                            maxLength={64}
                                            spellCheck={false}
                                        />
                                        <span className="field-help">
                                            {serverInfo?.registrationMode === 'invite'
                                                ? 'This server is invite only. Ask its owner for an invitation.'
                                                : 'Enter an invitation if required by this server.'}
                                        </span>
                                    </label>
                                )}
                            {infoError && (
                                <p className="field-help">
                                    Could not check registration: {infoError}
                                </p>
                            )}
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
                            New servers require an owner setup code from the server console.
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
                            <CampfireMark />
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
                            {state.icon ? (
                                <img src={`data:image/png;base64,${state.icon}`} alt={state.name} />
                            ) : (
                                initials(state.name)
                            )}
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
                        <span className="rail-version">v{appVersion}</span>
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
                                    {connected ? 'Good company, always.' : 'Reconnecting…'}
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
                                {['channels.edit', 'channels.reorder', 'channels.delete'].some(
                                    permission,
                                ) && (
                                    <button
                                        title="Manage channels"
                                        onClick={() => openSettings('channels')}
                                    >
                                        <Settings size={15} />
                                    </button>
                                )}
                                {permission('channels.create') && (
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
                                {['channels.edit', 'channels.reorder', 'channels.delete'].some(
                                    permission,
                                ) && (
                                    <button
                                        title="Manage voice channels"
                                        onClick={() => openSettings('channels')}
                                    >
                                        <Settings size={15} />
                                    </button>
                                )}
                                {permission('channels.create') && (
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
                                            disabled={!permission('calls.join')}
                                            onClick={() => {
                                                if (call.channel !== c.id) void call.join(c.id);
                                                else {
                                                    call.setPanelOpen(!call.panelOpen);
                                                    if (call.panelOpen) call.setShowDetails(false);
                                                }
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
                                                    <span>{displayName(user(p.user))}</span>
                                                    {p.deafened ? (
                                                        <span
                                                            title="Deafened"
                                                            aria-label="Deafened"
                                                        >
                                                            <HeadphoneOff size={14} />
                                                        </span>
                                                    ) : p.muted ? (
                                                        <span
                                                            title="Microphone muted"
                                                            aria-label="Microphone muted"
                                                        >
                                                            <MicOff size={14} />
                                                        </span>
                                                    ) : null}
                                                    {p.camera && (
                                                        <button
                                                            className="voice-stream-indicator"
                                                            title="Open camera call"
                                                            onClick={() => {
                                                                if (call.channel !== p.channel)
                                                                    void call.join(p.channel);
                                                                else call.setPanelOpen(true);
                                                            }}
                                                        >
                                                            <Video size={14} /> CAM
                                                        </button>
                                                    )}
                                                    {p.shareId && (
                                                        <button
                                                            className="voice-stream-indicator"
                                                            title={
                                                                p.user === state.me.id
                                                                    ? 'Open your screen share'
                                                                    : `Watch ${displayName(user(p.user))}’s stream`
                                                            }
                                                            aria-label={
                                                                p.user === state.me.id
                                                                    ? 'Open your screen share'
                                                                    : `Watch ${displayName(user(p.user))}’s stream`
                                                            }
                                                            disabled={!permission('calls.join')}
                                                            onClick={() => {
                                                                if (p.socket === socket?.id)
                                                                    call.setPanelOpen(true);
                                                                else
                                                                    call.watchStream(
                                                                        p.channel,
                                                                        p.socket,
                                                                        p.shareId!,
                                                                    );
                                                                setNavigationOpen(false);
                                                            }}
                                                        >
                                                            <MonitorPlay size={14} /> LIVE
                                                        </button>
                                                    )}
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
                                            else {
                                                call.setPanelOpen(!call.panelOpen);
                                                if (call.panelOpen) call.setShowDetails(false);
                                            }
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
                                <button
                                    className="call-panel-toggle"
                                    aria-expanded={call.panelOpen}
                                    aria-controls="call-panel"
                                    onClick={() => {
                                        call.setPanelOpen(!call.panelOpen);
                                        if (call.panelOpen) call.setShowDetails(false);
                                        setNavigationOpen(false);
                                    }}
                                >
                                    <MonitorPlay size={15} />
                                    {call.panelOpen ? 'Hide call details' : 'Show call details'}
                                </button>
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
                                disabled={!permission('calls.speak')}
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
                            {(view === 'friends' || dmUser || currentChannel?.description) && (
                                <span className="title-divider" />
                            )}
                            <span
                                className="channel-description"
                                title={
                                    view === 'chat' && !dmUser
                                        ? currentChannel?.description
                                        : undefined
                                }
                            >
                                {view === 'friends'
                                    ? 'Better together.'
                                    : dmUser
                                      ? 'A space for the two of you.'
                                      : currentChannel?.description}
                            </span>
                        </div>
                        <div className="top-actions">
                            {call.channel && (
                                <button
                                    ref={callPanelToggle}
                                    title={
                                        call.panelOpen ? 'Hide call details' : 'Show call details'
                                    }
                                    aria-label={
                                        call.panelOpen ? 'Hide call details' : 'Show call details'
                                    }
                                    aria-expanded={call.panelOpen}
                                    aria-controls="call-panel"
                                    onClick={() => {
                                        call.setPanelOpen(!call.panelOpen);
                                        if (call.panelOpen) call.setShowDetails(false);
                                    }}
                                >
                                    <MonitorPlay size={20} />
                                </button>
                            )}
                            {view === 'chat' && (
                                <>
                                    {dmUser && (
                                        <button
                                            title="Call friend"
                                            disabled={
                                                !!call.channel ||
                                                !permission('calls.join') ||
                                                !permission('calls.start')
                                            }
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
                                    <button
                                        title={
                                            prefs.channelNotifications?.[
                                                notificationKey(url, state.me.id, room)
                                            ] === false
                                                ? 'Unmute conversation'
                                                : 'Mute conversation'
                                        }
                                        aria-label="Mute conversation"
                                        aria-pressed={
                                            prefs.channelNotifications?.[
                                                notificationKey(url, state.me.id, room)
                                            ] === false
                                        }
                                        onClick={() =>
                                            setPrefs((previous) => {
                                                const key = notificationKey(url, state.me.id, room);
                                                return {
                                                    ...previous,
                                                    channelNotifications: {
                                                        ...previous.channelNotifications,
                                                        [key]:
                                                            previous.channelNotifications?.[key] ===
                                                            false,
                                                    },
                                                };
                                            })
                                        }
                                    >
                                        {prefs.channelNotifications?.[
                                            notificationKey(url, state.me.id, room)
                                        ] === false ? (
                                            <BellOff size={19} />
                                        ) : (
                                            <Bell size={19} />
                                        )}
                                    </button>
                                    <label className="search">
                                        <span className="sr-only">Search this conversation</span>
                                        <input
                                            type="search"
                                            placeholder="Search messages (Ctrl+F)"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                        />
                                        <Search size={16} />
                                    </label>
                                </>
                            )}
                            <span
                                className={`connection-status ${connected ? '' : 'disconnected'}`}
                                title={
                                    connected ? 'Connected to server' : 'Disconnected from server'
                                }
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
                            onHide={() => {
                                call.setPanelOpen(false);
                                call.setShowDetails(false);
                                callPanelToggle.current?.focus();
                            }}
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
                                    scrollMemory={chatScrollMemory.current}
                                    scrollKey={JSON.stringify([
                                        url,
                                        state.me.id,
                                        room,
                                        search,
                                        pins,
                                    ])}
                                    onReply={setThread}
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
                                <ChatComposer
                                    canAttach={canPost && permission('files.attach')}
                                    users={state.users}
                                    emojis={state.emojis}
                                    attachments={attachments}
                                    setAttachments={setAttachments}
                                    draft={draft}
                                    setDraft={setDraft}
                                    busy={busy}
                                    canPost={canPost}
                                    connected={connected}
                                    fileInput={fileInput}
                                    lastTyping={lastTyping}
                                    addFiles={addFiles}
                                    send={send}
                                    pasteDesktop={pasteDesktop}
                                    onEmoji={() => setModal('emoji')}
                                    onTyping={() => socket?.emit('typing', room)}
                                    typing={typing}
                                    user={user}
                                    placeholder={`Message ${dmUser ? '@' + displayName(dmUser) : '#' + (currentChannel?.name || 'general')}`}
                                />
                            </section>
                        )}
                        {thread && thread.room === room && view === 'chat' && roomVisible && (
                            <ThreadPanel
                                key={`${url}:${state.me.id}:${room}:${thread.id}`}
                                parent={thread}
                                api={api}
                                socket={socket}
                                state={state}
                                permission={conversationPermission}
                                user={user}
                                color={color}
                                dm={dm}
                                download={download}
                                act={act}
                                setModal={setModal}
                                setEdit={setEdit}
                                connected={connected}
                                onClose={() => setThread(null)}
                            />
                        )}
                        {members && !thread && (
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
                            </aside>
                        )}
                    </div>
                    <footer className="status-bar">
                        <span>
                            Campfire <i /> Keep the conversation glowing
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
                                    key={modal}
                                    role={state.roles.find((r) => r.id === modal.split(':')[1])}
                                    busy={busy}
                                    state={state}
                                    canEditAccess={permission('channels.access')}
                                    owner={state.me.role === 'owner'}
                                    onSave={(data) =>
                                        act(async () => {
                                            const id = modal.split(':')[1];
                                            await api(
                                                id === 'new'
                                                    ? '/roles'
                                                    : `/roles/${id}${state.me.role === 'owner' ? '' : '/access'}`,
                                                id === 'new'
                                                    ? 'POST'
                                                    : state.me.role === 'owner'
                                                      ? 'PATCH'
                                                      : 'PUT',
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
                                            ? 'This will permanently delete the message, its thread replies, and their attachments.'
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
