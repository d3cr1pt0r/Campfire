import { CallInvite } from './CallInvite';
import { VoiceChannelInvite } from './VoiceChannelInvite';
import { ParticipantAudio, MediaContexts } from './ParticipantAudio';
import { audioLevel, participantLevels, participantVolumeKey } from './audioPreferences';
import {
    hasPermission,
    roleColor,
    channelPermissionIds,
    canManageRole,
} from '../shared/permissions.js';
import {
    shouldNotify,
    createNotificationSound,
    notificationSound,
    callsRing,
    callRinging,
    callDeclined,
} from './notifications';
import {
    formatFingerprint,
    isLoopbackHost,
    parseServerLink,
    restoreConnection,
    type ServerLink,
} from './serverLink';
import { connectionHint, pinsFor, trustStep } from './serverTrust';
import { version as appVersion } from '../package.json';
import { ChatComposer } from './ChatComposer';
import { ThreadPanel } from './ThreadPanel';
import { PollDialog, type PollTarget } from './PollDialog';
import { ChatMessages } from './ChatMessages';
import type { ChatScrollPosition } from './chatScroll';
import { CallPanel, type CallAreaMode } from './CallPanel';
import { ConversationSection } from './ConversationSection';
import { MemberList } from './MemberList';
import { DirectMessages } from './DirectMessages';
import { SettingsPanel } from './SettingsPanel';
import { SimpleForm, RoleForm, MessageForm } from './forms';
import { appendText } from './richText';
import { Avatar, initials } from './Avatar';
import { createStateRefresh } from './stateRefresh';
import { useDialog } from './useDialog';
import { useModalNavigation } from './modalNavigation';
import { createApiClient } from './api';
import { useConversation } from './useConversation';
import { canonicalRoom, dmParticipant } from '../shared/rooms.js';
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
    Maximize2,
} from 'lucide-react';
import type { State, Message, Preferences, User } from './types';
import { useCall } from './useCall';
import { displayName } from './profiles';
import { PresenceDot } from './PresenceDot';
import { userStatus } from './presence';
import { usePresence } from './usePresence';

import { Emoji } from './ChatContent';
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
import {
    ServerAddressInput,
    splitServerAddress,
    serverAddressUrl,
    type ServerAddress,
} from './ServerAddressInput';
function CampfireMark() {
    return <img className="campfire-mark" src={campfireIcon} alt="" />;
}
const storage = window.campfire?.storage ?? localStorage;
const defaultServerUrl =
    import.meta.env.VITE_DEFAULT_SERVER_URL?.trim() ||
    (window.campfire
        ? ''
        : window.location.port === '5173'
          ? 'http://localhost:3001'
          : window.location.origin);
const defaultPrefs: Preferences = {
    theme: 'system',
    messageAvatars: 'compact',
    autoIdle: false,
    idleMinutes: 5,
    notifications: false,
    input: '',
    output: '',
    quality: '720',
    microphoneVolume: 1,
    outputVolume: 1,
    soundEffectsVolume: 1,
    voiceActivation: false,
    voiceThreshold: -45,
    noise: true,
    pushToTalk: false,
    sounds: true,
    closeToTray: true,
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
const insecureHttpAllowed = (origin: string) =>
    window.campfire?.insecureHttp?.isAllowed(origin) === true;
function remoteHttpOrigin(input: string) {
    try {
        const { origin } = parseServerLink(input, true);
        const parsed = new URL(origin);
        return parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname) ? origin : null;
    } catch {
        return null;
    }
}
function parseConnectionLink(input: string) {
    const candidate = remoteHttpOrigin(input);
    return parseServerLink(input, candidate !== null && insecureHttpAllowed(candidate));
}
const initial = restoreConnection(
    stored<unknown>('connection', null),
    defaultServerUrl,
    insecureHttpAllowed,
);
// Browser links: https://server/#invite=…&setup=… (#pin= is only used by the desktop app).
const hashLink = new URLSearchParams(window.location.hash.slice(1));
const invitationFromLink = hashLink.get('invite') || '';
const setupFromLink = hashLink.get('setup') || '';
if (['invite', 'pin', 'setup'].some((key) => hashLink.has(key)))
    history.replaceState(null, '', window.location.pathname + window.location.search);
type TrustPrompt = {
    kind: 'confirm' | 'changed';
    origin: string;
    fingerprint: string;
    resume?: () => void;
};
function App() {
    const chatScrollMemory = useRef(new Map<string, ChatScrollPosition>());
    const [url, setUrl] = useState(initial.url),
        [token, setToken] = useState(initial.token),
        [state, setState] = useState<State | null>(null),
        [connected, setConnected] = useState(false);
    const [socket, setSocket] = useState<AppSocket | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [register, setRegister] = useState(false);
    const [serverAddress, setServerAddress] = useState(() =>
        splitServerAddress(
            invitationFromLink || setupFromLink ? window.location.origin : initial.url,
        ),
    );
    const authUrl = serverAddressUrl(serverAddress);
    const setAuthUrl = (value: string) => setServerAddress(splitServerAddress(value));
    const [resetPassword, setResetPassword] = useState(false);
    const [inviteCode, setInviteCode] = useState(invitationFromLink);
    const [setupCode, setSetupCode] = useState(setupFromLink);
    // Fingerprint carried by a pasted link, kept while the address field shows its origin.
    const [linkPin, setLinkPin] = useState<{ origin: string; pin: string } | null>(null);
    const [trustPrompt, setTrustPrompt] = useState<TrustPrompt | null>(null);
    const [verifiedUrl, setVerifiedUrl] = useState<string | null>(null);
    const [probe, setProbe] = useState(0);
    const [requestedAddress, setRequestedAddress] = useState<string | null>(null);
    const [httpBusy, setHttpBusy] = useState(false);
    const httpTarget = remoteHttpOrigin(authUrl);
    const httpApproved = httpTarget !== null && insecureHttpAllowed(httpTarget);
    const showHttpApproval = requestedAddress === authUrl && httpTarget !== null;
    const setHttpApproval = async (enabled: boolean) => {
        if (!httpTarget || httpBusy || !window.campfire?.insecureHttp) return;
        setServerInfo(null);
        setHttpBusy(true);
        try {
            await window.campfire.insecureHttp.setAllowed(httpTarget, enabled);
            setProbe((n) => n + 1);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setHttpBusy(false);
        }
    };
    const [infoNote, setInfoNote] = useState('');
    const pinFor = (link: ServerLink) =>
        link.pin ?? (linkPin?.origin === link.origin ? linkPin.pin : undefined);
    // Resolves whether the desktop app may talk to a server: true to continue, false when the
    // user must first answer a trust prompt (resume then continues), or throws on refusal.
    const ensureTrusted = async (origin: string, pin?: string, resume?: () => void) => {
        const pins = pinsFor(origin);
        if (!pins) return true;
        const step = trustStep(await pins.check(origin), pin);
        if (step.kind === 'ready') return true;
        if (step.kind === 'pin' || step.kind === 'replace') {
            const result = await pins.trust(origin, step.fingerprint);
            if (!result.ok)
                throw new Error(
                    result.reason === 'cancelled'
                        ? 'The saved server identity was kept.'
                        : result.reason || 'Could not save the server identity.',
                );
            return !result.restarting;
        }
        if (step.kind === 'confirm' || step.kind === 'changed') {
            setTrustPrompt({ kind: step.kind, origin, fingerprint: step.fingerprint, resume });
            return false;
        }
        if (step.kind === 'mismatch')
            throw new Error(
                'This server’s identity doesn’t match the link you used. Don’t sign in; ask the server owner for a new link.',
            );
        throw new Error(`Could not reach the server: ${step.message}`);
    };
    const [serverInfo, setServerInfo] = useState<{
        address: string;
        registrationMode: 'open' | 'invite';
        setupRequired: boolean;
    } | null>(null);
    const resolvedServerInfo = serverInfo?.address === authUrl ? serverInfo : null;
    const [infoChecking, setInfoChecking] = useState(false);
    const [infoError, setInfoError] = useState('');
    useEffect(() => {
        if (token || requestedAddress === null || requestedAddress !== authUrl) return;
        setServerInfo(null);
        setInfoError('');
        setInfoNote('');
        setInfoChecking(!!authUrl.trim());
        const controller = new AbortController();
        const timer = setTimeout(() => {
            if (httpTarget && !httpApproved) {
                setInfoChecking(false);
                return;
            }
            let link: ServerLink;
            try {
                link = parseConnectionLink(authUrl);
            } catch (e) {
                if (authUrl.trim()) setInfoError((e as Error).message);
                setInfoChecking(false);
                return;
            }
            const pins = pinsFor(link.origin);
            void (async () => {
                // The desktop app checks the identity before any request reaches the server.
                const step = pins
                    ? trustStep(await pins.check(link.origin), pinFor(link))
                    : ({ kind: 'ready' } as const);
                if (controller.signal.aborted) return;
                if (step.kind === 'pin') {
                    const result = await pins!.trust(link.origin, step.fingerprint);
                    if (!result.ok) throw new Error(result.reason);
                } else if (step.kind === 'confirm') {
                    setInfoNote(
                        'You’ll be asked to confirm this server’s identity when you continue.',
                    );
                    return;
                } else if (step.kind === 'replace') {
                    setInfoNote(
                        'This link carries a new identity for this server. You’ll be asked to confirm it when you continue.',
                    );
                    return;
                } else if (step.kind === 'changed' || step.kind === 'mismatch') {
                    setInfoError(
                        step.kind === 'changed'
                            ? 'This server’s identity changed since you last connected. Campfire won’t connect to it.'
                            : 'This server’s identity doesn’t match the link you used.',
                    );
                    return;
                } else if (step.kind === 'unreachable') throw new Error(step.message);
                const info = await createApiClient(link.origin, '').json<{
                    registrationMode: 'open' | 'invite';
                    setupRequired: boolean;
                }>(
                    '/info',
                    'GET',
                    undefined,
                    AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
                );
                if (
                    !info ||
                    !['open', 'invite'].includes(info.registrationMode) ||
                    typeof info.setupRequired !== 'boolean'
                )
                    throw new Error('This address is not a Campfire server.');
                if (!controller.signal.aborted) setServerInfo({ ...info, address: authUrl });
            })()
                .catch((e) => {
                    if (!controller.signal.aborted)
                        setInfoError(
                            `Could not connect: ${connectionHint(e, link.origin, window.location.origin, !!window.campfire)}`,
                        );
                })
                .finally(() => {
                    if (!controller.signal.aborted) setInfoChecking(false);
                });
        }, 0);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [authUrl, token, linkPin, probe, requestedAddress, httpTarget, httpApproved]);
    const changeServerAddress = (address: ServerAddress) => {
        setRequestedAddress(null);
        setServerInfo(null);
        setInfoError('');
        setInfoNote('');
        setInfoChecking(false);
        setRegister(false);
        setResetPassword(false);
        setLinkPin(null);
        setServerAddress(address);
    };
    const pasteServerLink = (text: string) => {
        try {
            const link = parseServerLink(text, true);
            changeServerAddress(splitServerAddress(link.origin));
            setLinkPin(link.pin ? { origin: link.origin, pin: link.pin } : null);
            if (link.invite) setInviteCode(link.invite);
            if (link.setup) setSetupCode(link.setup);
            setError('');
        } catch (e) {
            setError((e as Error).message);
        }
    };
    const [room, setRoom] = useState('general'),
        [draft, setDraft] = useState(''),
        [attachments, setAttachments] = useState<File[]>([]);
    const [thread, setThread] = useState<Message | null>(null);
    const [composerFocus, setComposerFocus] = useState(0);
    const [threadFocus, setThreadFocus] = useState(0);
    useEffect(() => setThread(null), [room, url, token]);
    const [search, setSearch] = useState(''),
        [pins, setPins] = useState(false),
        [members, setMembers] = useState(() => window.innerWidth > 1100),
        [typing, setTyping] = useState<Record<string, number>>({}),
        [unread, setUnread] = useState<Record<string, number>>({});
    const [prefs, setPrefs] = useState<Preferences>(initialPreferences);
    const formattingToolbar = prefs.formattingToolbar !== false;
    const setFormattingToolbar = (shown: boolean) =>
        setPrefs((previous) => ({ ...previous, formattingToolbar: shown }));
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
    const { modal, setModal, resetModals } = useModalNavigation();
    const [pollTarget, setPollTarget] = useState<PollTarget | null>(null);
    const openPoll = (target: PollTarget) => {
        setPollTarget(target);
        setModal('poll');
    };
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
    const messageSoundRef = useRef<ReturnType<typeof createNotificationSound> | null>(null);
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
    const activeCallChannel = useRef<string | null>(null);
    const call = useCall(
        socket,
        prefs,
        state?.iceServers || [],
        notify,
        () =>
            notify(
                'Saved microphone unavailable; using System default for this call. Your selection is kept for next time.',
            ),
        (p, targetChannel) => {
            if (!state) return false;
            const id = targetChannel ?? activeCallChannel.current;
            const channel = state.channels.find((entry) => entry.id === id);
            if (id && !id.startsWith('private:') && !channel) return false;
            return hasPermission(state.me, state.roles, p, channel);
        },
    );
    activeCallChannel.current = call.channel;
    // Invitations ring and your own unanswered call plays a ringback, each for up to 45
    // seconds; an invitation someone declines plays its own cue.
    const ringStarted = useRef(new Map<string, number>());
    const [ringCheck, setRingCheck] = useState(0);
    const directCalls = state?.directCalls;
    useEffect(() => {
        const player = messageSoundRef.current;
        if (!player) return;
        if (!state) {
            player.stopLoop('incomingCall');
            player.stopLoop('outgoingCall');
            return;
        }
        const now = Date.now();
        const rings = callRinging(directCalls || [], state.me.id, call.channel);
        const ringing = [...rings.incoming, ...(rings.outgoing ? [rings.outgoing] : [])];
        for (const id of ringStarted.current.keys())
            if (!ringing.includes(id)) ringStarted.current.delete(id);
        for (const id of ringing)
            if (!ringStarted.current.has(id)) ringStarted.current.set(id, now);
        const fresh = (id: string) => now - (ringStarted.current.get(id) ?? now) < 45000;
        if (rings.incoming.some(fresh) && callsRing(state.me, prefs, url))
            void player.startLoop('incomingCall');
        else player.stopLoop('incomingCall');
        if (rings.outgoing && fresh(rings.outgoing) && prefs.sounds)
            void player.startLoop('outgoingCall');
        else player.stopLoop('outgoingCall');
        const expiry = Math.min(
            ...[...ringStarted.current.values()]
                .map((at) => at + 45000 - now)
                .filter((ms) => ms > 0),
        );
        if (!Number.isFinite(expiry)) return;
        const timer = setTimeout(() => setRingCheck((count) => count + 1), expiry + 50);
        return () => clearTimeout(timer);
    }, [
        directCalls,
        state?.me,
        call.channel,
        prefs.serverNotifications,
        prefs.sounds,
        url,
        ringCheck,
    ]);
    const previousCalls = useRef<NonNullable<typeof directCalls>>([]);
    useEffect(() => {
        const calls = directCalls || [];
        if (prefs.sounds && callDeclined(previousCalls.current, calls, call.channel))
            void messageSoundRef.current?.play('callDeclined');
        previousCalls.current = calls;
    }, [directCalls]);
    const callCan = (p: string) =>
        !!state &&
        (!call.channel ||
            call.channel.startsWith('private:') ||
            state.channels.some((entry) => entry.id === call.channel)) &&
        hasPermission(
            state.me,
            state.roles,
            p,
            state.channels.find((entry) => entry.id === call.channel),
        );
    const speaking = useSpeaking(socket, call.microphone, state?.me.id || '', call.channel);
    const [callAreaMode, setCallAreaMode] = useState<CallAreaMode>('split');
    useEffect(() => setCallAreaMode('split'), [call.channel, url, token]);
    const toggleCallPanel = () => {
        const open = callAreaMode === 'call' || (callAreaMode === 'split' && call.panelOpen);
        setCallAreaMode('split');
        call.setPanelOpen(!open);
        if (open) call.setShowDetails(false);
    };
    useEffect(() => {
        storage.setItem('preferences', JSON.stringify(prefs));
    }, [prefs]);
    // A saved session reconnects only after the desktop app has re-checked the server identity.
    const verify = useCallback(async () => {
        if (!token) return;
        try {
            if (await ensureTrusted(url, undefined, () => setVerifiedUrl(url))) setVerifiedUrl(url);
        } catch (e) {
            notify((e as Error).message);
        }
    }, [url, token, notify]);
    useEffect(() => {
        setVerifiedUrl(null);
        void verify();
    }, [verify]);
    useEffect(() => {
        if (!token || verifiedUrl !== url) return;
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
            // A reconnect failure may mean the server now presents a different identity.
            void pinsFor(url)
                ?.check(url)
                .then((check) => {
                    if (check.state !== 'changed') return;
                    setVerifiedUrl(null);
                    setTrustPrompt({
                        kind: 'changed',
                        origin: url,
                        fingerprint: check.fingerprint,
                    });
                })
                .catch(() => {});
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
        s.on('call:invite', ({ from }: { from: string }) => {
            const caller = displayName(
                stateRef.current?.users.find((u) => u.id === from),
                'A member',
            );
            notify(`${caller} invited you to a call. Open the call invitation to join.`);
            const me = stateRef.current?.me;
            const preferences = prefsRef.current;
            if (
                me &&
                callsRing(me, preferences, url) &&
                preferences.notifications &&
                (document.visibilityState === 'hidden' || !document.hasFocus()) &&
                'Notification' in window &&
                Notification.permission === 'granted'
            ) {
                try {
                    // The ringtone is the sound; the system notification stays silent.
                    new Notification(stateRef.current?.name || 'Campfire', {
                        body: `${caller} is calling you`,
                        silent: true,
                    });
                } catch {
                    /* OS notifications are optional. */
                }
            }
        });
        s.on('calls', (calls) => setState((prev) => (prev ? { ...prev, calls } : null)));
        const messageSound = createNotificationSound(() => prefsRef.current);
        messageSoundRef.current = messageSound;
        const seenMessages = new Set<string>();
        s.on('message', (m: Message) => {
            if (seenMessages.has(m.id)) return;
            seenMessages.add(m.id);
            if (seenMessages.size > 1000) seenMessages.delete(seenMessages.values().next().value!);
            if (
                m.author !== stateRef.current?.me.id &&
                (m.room !== roomRef.current ||
                    !document.hasFocus() ||
                    document.visibilityState === 'hidden')
            )
                setUnread((prev) => ({ ...prev, [m.room]: (prev[m.room] || 0) + 1 }));
            const me = stateRef.current?.me;
            const preferences = prefsRef.current;
            if (!me || !shouldNotify(m, me, preferences, url, stateRef.current?.users)) return;
            if (
                preferences.messageSounds !== false &&
                (m.room !== roomRef.current ||
                    document.visibilityState !== 'visible' ||
                    !document.hasFocus())
            )
                void messageSound.play(notificationSound(m, me, stateRef.current?.users));
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
                            : `${sender} ${m.thread ? 'replied' : 'posted'} in #${stateRef.current?.channels.find((channel) => channel.id === m.room)?.name || 'channel'}`,
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
            messageSoundRef.current = null;
            messageSound.close();
            s.disconnect();
            setSocket(null);
            setConnected(false);
        };
    }, [url, token, refresh, verifiedUrl]);
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
    }, [room]);
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
        const markRead = () => {
            if (document.visibilityState === 'visible' && document.hasFocus()) {
                setUnread((previous) => ({ ...previous, [roomRef.current]: 0 }));
            }
        };
        window.addEventListener('focus', markRead);
        document.addEventListener('visibilitychange', markRead);
        return () => {
            window.removeEventListener('focus', markRead);
            document.removeEventListener('visibilitychange', markRead);
        };
    }, []);
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
    const channelNameInput = useRef<HTMLInputElement>(null);
    const inviteSearch = useRef<HTMLInputElement>(null);
    useDialog(
        modalContainer,
        () => {
            if (!busy) setModal(null);
        },
        !!modal,
        modal?.startsWith('channel:')
            ? channelNameInput
            : modal === 'invite-call'
              ? inviteSearch
              : undefined,
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
    const permission = (p: string) => !!state && hasPermission(state.me, state.roles, p);
    const conversationPermission = (name: string) => {
        if (!state || !roomVisible) return false;
        if (room.startsWith('dm:') && channelPermissionIds('text').includes(name))
            return name !== 'messages.deleteOthers';
        return hasPermission(
            state.me,
            state.roles,
            name,
            state.channels.find((channel) => channel.id === room),
        );
    };
    const canPost = conversationPermission('messages.send');
    useEffect(() => {
        if (!roomVisible)
            setModal((previous) =>
                previous === 'edit' ||
                previous === 'poll' ||
                previous?.startsWith('reaction:') ||
                previous?.startsWith('delete:') ||
                previous?.startsWith('end-poll:')
                    ? null
                    : previous,
            );
        if (!roomVisible) setEdit(null);
    }, [roomVisible]);
    const user = (id: string) => state?.users.find((u) => u.id === id);
    const color = (u?: User) => (state ? roleColor(u, state.roles) : undefined);
    const dm = (id: string) => {
        if (!state) return;
        setComposerFocus((request) => request + 1);
        const destination = canonicalRoom(`dm:${state.me.id}:${id}`);
        setUnread((previous) => ({ ...previous, [destination]: 0 }));
        setRoom(destination);
        setNavigationOpen(false);
        setSearch('');
        setPins(false);
    };
    const selectRoom = (id: string) => {
        setComposerFocus((request) => request + 1);
        setRoom(id);
        setNavigationOpen(false);
        setSearch('');
        setPins(false);
    };
    const submitLogin = async (f: FormData) => {
        await act(async () => {
            const link = parseConnectionLink(String(f.get('url')));
            const resume = () => {
                setProbe((n) => n + 1);
                void submitLogin(f);
            };
            if (!(await ensureTrusted(link.origin, pinFor(link), resume))) return;
            let data: { token: string };
            try {
                data = await createApiClient(link.origin, '').json<{ token: string }>(
                    `/auth/${resetPassword ? 'reset' : register ? 'register' : 'login'}`,
                    'POST',
                    {
                        username: f.get('username'),
                        password: f.get('password'),
                        ...(resetPassword
                            ? { resetToken: String(f.get('resetToken')).trim() }
                            : {}),
                        ...(register
                            ? {
                                  inviteCode: (link.invite ?? inviteCode).trim(),
                                  setupCode: (link.setup ?? setupCode).trim(),
                              }
                            : {}),
                    },
                );
            } catch (e) {
                throw new Error(
                    connectionHint(
                        e as Error,
                        link.origin,
                        window.location.origin,
                        !!window.campfire,
                    ),
                );
            }
            setUrl(link.origin);
            setToken(data.token);
            setError('');
        });
    };
    const login = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!resolvedServerInfo) {
            if (busy || httpBusy || infoChecking) return;
            if (httpTarget && !httpApproved) {
                setRequestedAddress(authUrl);
                return;
            }
            void act(async () => {
                const link = parseConnectionLink(authUrl);
                const retry = () => {
                    setRequestedAddress(authUrl);
                    setProbe((n) => n + 1);
                };
                if (await ensureTrusted(link.origin, pinFor(link), retry)) retry();
            });
            return;
        }
        void submitLogin(new FormData(e.currentTarget));
    };
    const trustServer = async () => {
        const prompt = trustPrompt;
        if (!prompt) return;
        let trustedNow = false;
        await act(async () => {
            const result = await pinsFor(prompt.origin)!.trust(prompt.origin, prompt.fingerprint);
            if (!result.ok) throw new Error(result.reason || 'Could not save the server identity.');
            trustedNow = true;
        });
        if (!trustedNow) return;
        setTrustPrompt(null);
        prompt.resume?.();
    };
    const attachmentsRef = useRef(attachments);
    attachmentsRef.current = attachments;
    const uploadBusy = useRef(busy);
    uploadBusy.current = busy;
    const addFiles = (files: File[]) => {
        if (!canPost || !conversationPermission('files.attach')) {
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
    const pasteDesktop = async (target: HTMLElement, insertText: (text: string) => void) => {
        if (!window.campfire?.readClipboardAttachments || !canPost) return;
        const targetRoom = room;
        const account = state?.me.id;
        try {
            const clipboard = await window.campfire.readClipboardAttachments();
            if (
                !target.isConnected ||
                document.activeElement !== target ||
                !target.isContentEditable ||
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
            } else if (clipboard.text) insertText(clipboard.text);
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
            if (id === state?.me.id) throw new Error('You cannot call yourself.');
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
        dmUser = room.startsWith('dm:') ? user(dmParticipant(room, state?.me.id) || '') : undefined;
    const selfDm = !!dmUser && dmUser.id === state?.me.id;
    const openSettings = (tab = 'account') => {
        setSettingsTab(tab);
        setModal('settings');
    };
    const showError = error && (
        <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss notification">
                <X size={17} />
            </button>
        </div>
    );
    if (!token || !state || trustPrompt)
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
                    {(trustPrompt || token) && (
                        <h2>{trustPrompt ? 'Check server' : 'Connecting…'}</h2>
                    )}
                    {trustPrompt ? (
                        trustPrompt.kind === 'confirm' ? (
                            <div
                                className="trust-prompt"
                                role="group"
                                aria-labelledby="trust-title"
                            >
                                <h3 id="trust-title">Confirm this server</h3>
                                <p>
                                    This is your first connection to{' '}
                                    <strong>{new URL(trustPrompt.origin).host}</strong>.
                                </p>
                                <p className="muted">
                                    If the owner gave you a server link, paste that instead: it
                                    carries the server’s identity. Otherwise check that this
                                    fingerprint matches the one the owner shared:
                                </p>
                                <code className="fingerprint">
                                    {formatFingerprint(trustPrompt.fingerprint)}
                                </code>
                                <button
                                    className="primary"
                                    disabled={busy}
                                    onClick={() => void trustServer()}
                                >
                                    Trust this server
                                    <ArrowRight size={18} />
                                </button>
                                <button disabled={busy} onClick={() => setTrustPrompt(null)}>
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <div className="trust-prompt trust-changed" role="alert">
                                <h3>Server identity changed</h3>
                                <p>
                                    <strong>{new URL(trustPrompt.origin).host}</strong> is
                                    presenting a different identity than the one saved on this
                                    computer. Someone may be intercepting your connection, so
                                    Campfire won’t connect.
                                </p>
                                <p className="muted">
                                    If the owner reinstalled the server, ask them for a new server
                                    link and paste it into the sign-in form.
                                </p>
                                <button
                                    className="primary"
                                    onClick={() => {
                                        setTrustPrompt(null);
                                        setToken('');
                                        setAuthUrl(trustPrompt.origin);
                                        setLinkPin(null);
                                        storage.removeItem('connection');
                                    }}
                                >
                                    Use a new server link
                                    <ArrowRight size={18} />
                                </button>
                                <button
                                    className="danger-text"
                                    disabled={busy}
                                    onClick={() =>
                                        void act(async () => {
                                            await pinsFor(trustPrompt.origin)?.forget(
                                                trustPrompt.origin,
                                            );
                                        })
                                    }
                                >
                                    Forget saved identity…
                                </button>
                            </div>
                        )
                    ) : token ? (
                        <>
                            <button
                                className="primary"
                                onClick={() => void (verifiedUrl === url ? refresh() : verify())}
                            >
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
                            <ServerAddressInput
                                value={serverAddress}
                                onChange={changeServerAddress}
                                onPasteLink={pasteServerLink}
                                disabled={busy}
                            />
                            {showHttpApproval && !window.campfire?.insecureHttp && (
                                <p className="field-help" role="alert">
                                    Use HTTPS in your browser. Remote HTTP requires an explicit
                                    opt-in in the Campfire desktop app.
                                </p>
                            )}
                            {window.campfire?.insecureHttp && showHttpApproval && (
                                <div className="http-approval">
                                    <label className="http-approval-toggle">
                                        <input
                                            type="checkbox"
                                            checked={httpApproved}
                                            disabled={busy || httpBusy}
                                            onChange={(event) =>
                                                void setHttpApproval(event.target.checked)
                                            }
                                        />
                                        Allow insecure HTTP for this server
                                    </label>
                                    <p className="field-help">
                                        HTTP exposes passwords, messages and files in transit.
                                        Server identity cannot be verified. This choice applies only
                                        to {httpTarget}.
                                    </p>
                                </div>
                            )}
                            {infoNote && <p className="field-help">{infoNote}</p>}
                            {infoError && (
                                <p className="field-help" role="alert">
                                    {infoError}
                                </p>
                            )}
                            {!resolvedServerInfo ? (
                                <button
                                    className="primary"
                                    disabled={
                                        busy ||
                                        httpBusy ||
                                        infoChecking ||
                                        !authUrl.trim() ||
                                        (showHttpApproval && !httpApproved)
                                    }
                                >
                                    {infoChecking ? 'Checking server…' : 'Continue'}
                                    <ArrowRight size={18} />
                                </button>
                            ) : (
                                <div className="auth-credentials">
                                    <h2>
                                        {resetPassword
                                            ? 'Reset password'
                                            : register
                                              ? 'Create account'
                                              : 'Sign in'}
                                    </h2>
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
                                            Your username is permanent. You can change your display
                                            nickname later.
                                        </p>
                                    )}
                                    {resetPassword && (
                                        <label>
                                            Reset token
                                            <input
                                                name="resetToken"
                                                required
                                                autoComplete="off"
                                                maxLength={64}
                                                spellCheck={false}
                                            />
                                        </label>
                                    )}
                                    <label>
                                        {resetPassword ? 'New password' : 'Password'}
                                        <input
                                            name="password"
                                            type="password"
                                            autoComplete={
                                                register || resetPassword
                                                    ? 'new-password'
                                                    : 'current-password'
                                            }
                                            minLength={8}
                                            maxLength={128}
                                            required
                                            placeholder="Enter your password"
                                        />
                                    </label>
                                    {register && resolvedServerInfo?.setupRequired && (
                                        <label>
                                            Owner setup code
                                            <input
                                                name="setupCode"
                                                value={setupCode}
                                                onChange={(e) => setSetupCode(e.target.value)}
                                                required
                                                autoComplete="off"
                                                maxLength={256}
                                            />
                                            <span className="field-help">
                                                Find this one-time code in your server console. This
                                                account becomes the owner.
                                            </span>
                                        </label>
                                    )}
                                    {register &&
                                        !resolvedServerInfo?.setupRequired &&
                                        resolvedServerInfo?.registrationMode !== 'open' && (
                                            <label>
                                                Invitation code
                                                <input
                                                    value={inviteCode}
                                                    onChange={(e) => setInviteCode(e.target.value)}
                                                    required={
                                                        resolvedServerInfo?.registrationMode ===
                                                        'invite'
                                                    }
                                                    autoComplete="off"
                                                    maxLength={64}
                                                    spellCheck={false}
                                                />
                                                <span className="field-help">
                                                    {resolvedServerInfo?.registrationMode ===
                                                    'invite'
                                                        ? 'This server is invite only. Ask its owner for an invitation.'
                                                        : 'Enter an invitation if required by this server.'}
                                                </span>
                                            </label>
                                        )}
                                    <button
                                        className="primary"
                                        disabled={
                                            busy || httpBusy || (!!httpTarget && !httpApproved)
                                        }
                                    >
                                        {busy
                                            ? 'Just a moment…'
                                            : resetPassword
                                              ? 'Reset password & sign in'
                                              : register
                                                ? 'Create account'
                                                : 'Sign in'}
                                        <ArrowRight size={18} />
                                    </button>
                                    {!register && !resetPassword && (
                                        <p className="auth-switch">
                                            <button
                                                type="button"
                                                onClick={() => setResetPassword(true)}
                                            >
                                                Reset password
                                            </button>
                                        </p>
                                    )}
                                    <p className="auth-switch">
                                        {register || resetPassword
                                            ? 'Already have an account?'
                                            : 'Need an account?'}{' '}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setResetPassword(false);
                                                setRegister(resetPassword ? false : !register);
                                            }}
                                        >
                                            {register || resetPassword
                                                ? 'Sign in'
                                                : 'Create account'}
                                        </button>
                                    </p>
                                </div>
                            )}
                        </form>
                    )}
                </main>
                {showError}
            </div>
        );
    return (
        <MediaContexts
            assets={{ url, token, account: state.me.id }}
            audio={{
                outputVolume: audioLevel(prefs.outputVolume),
                levels: (id) =>
                    participantLevels(prefs, participantVolumeKey(url, state.me.id, id)),
                change: (id, kind, value) =>
                    setPrefs((previous) => {
                        const key = participantVolumeKey(url, state.me.id, id);
                        return {
                            ...previous,
                            participantVolumes: {
                                ...previous.participantVolumes,
                                [key]: {
                                    ...participantLevels(previous, key),
                                    [kind]: audioLevel(value),
                                },
                            },
                        };
                    }),
            }}
        >
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
                        if ((event.target as HTMLElement).closest('.nav-item, .server-icon'))
                            setNavigationOpen(false);
                    }}
                >
                    <nav className="server-rail" aria-label="Servers">
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
                                <small
                                    className={`connection-status ${connected ? '' : 'disconnected'}`}
                                    role="status"
                                    title={
                                        connected
                                            ? 'Connected to server'
                                            : 'Disconnected from server; reconnecting'
                                    }
                                >
                                    <i aria-hidden="true" />
                                    {connected
                                        ? remoteHttpOrigin(url)
                                            ? 'Connected · Insecure HTTP'
                                            : 'Connected to server'
                                        : 'Reconnecting…'}
                                </small>
                            </span>
                            <ChevronDown size={18} />
                        </button>
                        <div className="sidebar-content">
                            <DirectMessages
                                key={`${url}:${state.me.id}`}
                                storageKey={`direct-messages:${url}:${state.me.id}`}
                                storage={storage}
                                state={state}
                                socket={socket}
                                room={room}
                                unread={unread}
                                color={color}
                                dm={dm}
                                close={(destination) => {
                                    setUnread((previous) => ({
                                        ...previous,
                                        [destination]: 0,
                                    }));
                                    if (room === destination)
                                        selectRoom(
                                            state.channels.find(
                                                (channel) => channel.kind === 'text',
                                            )?.id || '',
                                        );
                                }}
                            />
                            <div className="category">
                                <span>TEXT CHANNELS</span>
                                {[
                                    'channels.create',
                                    'channels.edit',
                                    'channels.reorder',
                                    'channels.delete',
                                    'channels.access',
                                ].some(permission) && (
                                    <button
                                        title="Manage channels"
                                        aria-label="Text channel settings"
                                        onClick={() => openSettings('channels')}
                                    >
                                        <Settings size={15} />
                                    </button>
                                )}
                            </div>
                            {state.channels
                                .filter((c) => c.kind === 'text')
                                .map((c) => (
                                    <button
                                        key={c.id}
                                        className={`nav-item channel ${room === c.id ? 'selected' : ''}`}
                                        aria-current={room === c.id ? 'page' : undefined}
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
                                {[
                                    'channels.create',
                                    'channels.edit',
                                    'channels.reorder',
                                    'channels.delete',
                                    'channels.access',
                                ].some(permission) && (
                                    <button
                                        title="Manage voice channels"
                                        aria-label="Voice channel settings"
                                        onClick={() => openSettings('channels')}
                                    >
                                        <Settings size={15} />
                                    </button>
                                )}
                            </div>
                            {state.channels
                                .filter((c) => c.kind === 'voice')
                                .map((c) => (
                                    <React.Fragment key={c.id}>
                                        <VoiceChannelInvite
                                            channel={c}
                                            state={state}
                                            api={api}
                                            color={color}
                                            disabled={
                                                !connected ||
                                                !hasPermission(
                                                    state.me,
                                                    state.roles,
                                                    'calls.join',
                                                    c,
                                                ) ||
                                                !permission('calls.start')
                                            }
                                        >
                                            <button
                                                className={`nav-item channel ${call.channel === c.id ? 'in-call' : ''}`}
                                                disabled={
                                                    !hasPermission(
                                                        state.me,
                                                        state.roles,
                                                        'calls.join',
                                                        c,
                                                    )
                                                }
                                                onClick={() => {
                                                    if (call.channel !== c.id) void call.join(c.id);
                                                    else toggleCallPanel();
                                                }}
                                            >
                                                <Volume2 size={20} />
                                                {c.name}
                                                {call.channel === c.id && <Radio size={15} />}
                                            </button>
                                        </VoiceChannelInvite>
                                        {state.calls
                                            .filter((p) => p.channel === c.id)
                                            .map((p) => (
                                                <ParticipantAudio
                                                    key={p.socket}
                                                    user={p.user}
                                                    name={displayName(user(p.user))}
                                                    self={p.user === state.me.id}
                                                >
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
                                                                if (callAreaMode === 'conversation')
                                                                    setCallAreaMode('split');
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
                                                            disabled={
                                                                !hasPermission(
                                                                    state.me,
                                                                    state.roles,
                                                                    'calls.join',
                                                                    c,
                                                                )
                                                            }
                                                            onClick={() => {
                                                                if (callAreaMode === 'conversation')
                                                                    setCallAreaMode('split');
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
                                                </ParticipantAudio>
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
                                            else toggleCallPanel();
                                        }}
                                    >
                                        <Phone size={18} />
                                        Private call ·{' '}
                                        {state.calls.filter((p) => p.channel === c.id).length}{' '}
                                        connected
                                    </button>
                                ))}
                        </div>
                        {call.channel && (
                            <div className="voice-connected">
                                <Radio size={17} />
                                <div className="voice-connection-copy">
                                    <strong>Voice connected</strong>
                                    <small title={`${callName} / ${state.name}`}>
                                        {callName} / {state.name}
                                    </small>
                                </div>
                                <button title="Disconnect call" onClick={call.leave}>
                                    <PhoneOff size={17} />
                                </button>
                            </div>
                        )}
                        <div className="user-bar">
                            <div className="avatar-status self-avatar">
                                <Avatar
                                    user={state.me}
                                    color={color(state.me)}
                                    frame={state.me.frame}
                                />
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
                                disabled={!callCan('calls.speak')}
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
                    {call.channel && (
                        <CallPanel
                            areaMode={callAreaMode}
                            onAreaModeChange={setCallAreaMode}
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
                    <ConversationSection
                        activeCall={!!call.channel}
                        header={
                            <header className="topbar">
                                <button
                                    className="navigation-toggle"
                                    title="Channels and members"
                                    aria-label="Open navigation"
                                    aria-expanded={navigationOpen}
                                    onClick={() => setNavigationOpen(true)}
                                >
                                    <Menu size={22} />
                                </button>
                                <div className="channel-title">
                                    {dmUser ? <MessageCircle size={23} /> : <Hash size={25} />}
                                    <strong>
                                        {displayName(dmUser, '') ||
                                            currentChannel?.name ||
                                            'Conversation'}
                                    </strong>
                                    {(dmUser || currentChannel?.description) && (
                                        <span className="title-divider" />
                                    )}
                                    <span
                                        className="channel-description"
                                        title={!dmUser ? currentChannel?.description : undefined}
                                    >
                                        {dmUser
                                            ? selfDm
                                                ? 'Your private space for notes and files.'
                                                : 'A space for the two of you.'
                                            : currentChannel?.description}
                                    </span>
                                </div>
                                <div className="top-actions">
                                    <>
                                        {dmUser && (
                                            <button
                                                title={
                                                    selfDm
                                                        ? 'You cannot call yourself'
                                                        : 'Call member'
                                                }
                                                aria-label="Call member"
                                                disabled={
                                                    selfDm ||
                                                    !!call.channel ||
                                                    !permission('calls.join') ||
                                                    !permission('calls.start') ||
                                                    !state.online.includes(dmUser.id) ||
                                                    !hasPermission(
                                                        dmUser,
                                                        state.roles,
                                                        'calls.join',
                                                    )
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
                                            aria-expanded={members && !thread}
                                            aria-controls="community-members"
                                            onClick={() => {
                                                if (thread) {
                                                    setThread(null);
                                                    setMembers(true);
                                                } else setMembers(!members);
                                            }}
                                        >
                                            <Users size={21} />
                                        </button>
                                        <label className="search">
                                            <span className="sr-only">
                                                Search this conversation
                                            </span>
                                            <input
                                                type="search"
                                                placeholder="Search messages (Ctrl+F)"
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                            />
                                            <Search size={16} />
                                        </label>
                                    </>
                                    {call.channel && (
                                        <button
                                            className="panel-expand"
                                            title="Expand conversation"
                                            aria-label="Expand conversation"
                                            aria-controls="conversation-section"
                                            onClick={() => setCallAreaMode('conversation')}
                                        >
                                            <Maximize2 size={18} />
                                        </button>
                                    )}
                                </div>
                            </header>
                        }
                    >
                        {!connected && (
                            <div className="connection-banner" role="status">
                                Connection lost. Reconnecting… Messages will be available when the
                                server returns.
                            </div>
                        )}
                        <div className="call-invitations">
                            {(state.directCalls || [])
                                .filter((c) => c.invited.includes(state.me.id))
                                .map((c) => (
                                    <div key={c.id}>
                                        <span>
                                            {displayName(user(c.creator)) || 'A member'} invited you
                                            to a private call
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
                                                void act(() =>
                                                    api(`/calls/${c.id}/decline`, 'POST'),
                                                )
                                            }
                                        >
                                            Decline
                                        </button>
                                    </div>
                                ))}
                        </div>
                        <div className="main-columns">
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
                                    messageAvatars={prefs.messageAvatars}
                                    currentVoiceChannel={call.channel}
                                    onJoinVoice={(channel) => void call.join(channel)}
                                    key={`${url}:${state.me.id}:${room}:${search}:${pins}`}
                                    scrollMemory={chatScrollMemory.current}
                                    scrollKey={JSON.stringify([
                                        url,
                                        state.me.id,
                                        room,
                                        search,
                                        pins,
                                    ])}
                                    onReply={(message) => {
                                        setThread(message);
                                        setThreadFocus((request) => request + 1);
                                    }}
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
                                    focusRequest={composerFocus}
                                    canAttach={canPost && conversationPermission('files.attach')}
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
                                    onPoll={(question) => openPoll({ room, question })}
                                    formattingToolbar={formattingToolbar}
                                    setFormattingToolbar={setFormattingToolbar}
                                />
                            </section>
                            {thread && thread.room === room && roomVisible && (
                                <ThreadPanel
                                    messageAvatars={prefs.messageAvatars}
                                    currentVoiceChannel={call.channel}
                                    onJoinVoice={(channel) => void call.join(channel)}
                                    focusRequest={threadFocus}
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
                                    openPoll={openPoll}
                                    connected={connected}
                                    onClose={() => setThread(null)}
                                    formattingToolbar={formattingToolbar}
                                    setFormattingToolbar={setFormattingToolbar}
                                />
                            )}
                            {members && !thread && (
                                <MemberList
                                    state={state}
                                    color={color}
                                    dm={dm}
                                    startCall={startDirectCall}
                                    callActive={!!call.channel}
                                    busy={busy}
                                    onClose={() => setMembers(false)}
                                />
                            )}
                        </div>
                    </ConversationSection>
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
                                    testNotificationSound={async () => {
                                        const played = await messageSoundRef.current?.play();
                                        if (!played)
                                            throw new Error(
                                                'Notification audio could not play. Check your output device and try again.',
                                            );
                                    }}
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
                                <CallInvite
                                    state={state}
                                    channel={call.channel}
                                    api={api}
                                    color={color}
                                    disabled={busy}
                                    searchRef={inviteSearch}
                                />
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
                            ) : modal.startsWith('channel:') ? (
                                <>
                                    <h2 id="action-dialog-title">
                                        Create a {modal.split(':')[1]} channel
                                    </h2>
                                    <p className="muted">
                                        {modal === 'channel:text'
                                            ? 'Text channel names convert to lowercase with hyphens, e.g. project-updates.'
                                            : 'Voice channel names can include capitals and spaces, e.g. Game Night.'}
                                    </p>
                                    <SimpleForm
                                        label="Channel name"
                                        inputRef={channelNameInput}
                                        submit="Create channel"
                                        busy={busy}
                                        onSubmit={(value) =>
                                            act(async () => {
                                                await api('/channels', 'POST', {
                                                    name: value,
                                                    kind: modal.split(':')[1],
                                                });
                                                await refresh();
                                                setModal(null);
                                            })
                                        }
                                    />
                                </>
                            ) : modal === 'edit' ? (
                                <>
                                    <h2 id="action-dialog-title">Edit message</h2>
                                    <MessageForm
                                        initialValue={edit?.body || ''}
                                        busy={busy}
                                        formattingToolbar={formattingToolbar}
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
                                    canEditRole={
                                        permission('roles.manage') &&
                                        (!state.roles.find((r) => r.id === modal.split(':')[1]) ||
                                            canManageRole(
                                                state.me,
                                                state.roles,
                                                state.roles.find(
                                                    (r) => r.id === modal.split(':')[1],
                                                )!,
                                            ))
                                    }
                                    onSave={(data) =>
                                        act(async () => {
                                            const id = modal.split(':')[1];
                                            await api(
                                                id === 'new'
                                                    ? '/roles'
                                                    : `/roles/${id}${permission('roles.manage') ? '' : '/access'}`,
                                                id === 'new'
                                                    ? 'POST'
                                                    : permission('roles.manage')
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
                                                        setDraft((d) => appendText(d, emoji));
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
                            ) : modal === 'poll' && pollTarget ? (
                                <PollDialog
                                    key={`${pollTarget.room}:${pollTarget.thread}`}
                                    initialQuestion={pollTarget.question}
                                    busy={busy}
                                    onCancel={() => setModal(null)}
                                    onSubmit={(poll) =>
                                        void act(async () => {
                                            await api('/messages', 'POST', {
                                                room: pollTarget.room,
                                                thread: pollTarget.thread,
                                                poll,
                                            });
                                            setModal(null);
                                        })
                                    }
                                />
                            ) : modal.startsWith('end-poll:') ? (
                                <>
                                    <h2 id="action-dialog-title">End this poll now?</h2>
                                    <p className="muted">
                                        Voting closes for everyone and the final results are shown.
                                        This can’t be undone.
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
                                            className="primary"
                                            disabled={busy}
                                            onClick={() =>
                                                void act(async () => {
                                                    const [, id] = modal.split(':');
                                                    await api(`/messages/${id}/poll/end`, 'POST');
                                                    setModal(null);
                                                })
                                            }
                                        >
                                            {busy ? 'Working…' : 'End poll'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h2 id="action-dialog-title">Delete this message?</h2>
                                    <p className="muted">
                                        This will permanently delete the message, its thread
                                        replies, and their attachments.
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
                                                    const [, id] = modal.split(':');
                                                    await api(`/messages/${id}`, 'DELETE');
                                                    setModal(null);
                                                })
                                            }
                                        >
                                            {busy ? 'Working…' : 'Delete message'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </section>
                    </div>
                )}
                {showError}
            </div>
        </MediaContexts>
    );
}
createRoot(document.getElementById('root')!).render(<App />);
