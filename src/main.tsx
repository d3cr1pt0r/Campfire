import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { Hash, Volume2, Plus, Settings, Users, MessageCircle, Mic, MicOff, Headphones, HeadphoneOff, Video, VideoOff, MonitorUp, PhoneOff, Search, Pin, Paperclip, Send, Smile, ChevronDown, X, LogOut, Check, Download, Trash2, Pencil, Server, Shield, Bell, ArrowRight, Radio, Globe, Copy } from 'lucide-react';
import type { State, Message, Preferences, User } from './types';
import { useCall } from './useCall';
import './style.css';
const storage = window.driskord?.storage ?? localStorage;
const defaultServerUrl = import.meta.env.VITE_DEFAULT_SERVER_URL?.trim() || (window.driskord ? '' : window.location.port === '5173' ? 'http://localhost:3001' : window.location.origin);
const defaultPrefs: Preferences = { notifications: false, input: '', output: '', quality: '720', noise: true, pushToTalk: false, sounds: true };
function stored<T>(key: string, fallback: T): T {
    try {
        return JSON.parse(storage.getItem(key) || 'null') ?? fallback;
    }
    catch {
        return fallback;
    }
}
const initial = stored<{
    url: string;
    token: string;
}>('connection', { url: defaultServerUrl, token: '' });
const initials = (s: string) => s.split(/[ -]/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function Avatar({ user, color, small = false }: {
    user?: User;
    color?: string;
    small?: boolean;
}) { return <span className={`avatar ${small ? 'small' : ''}`} style={{ background: color || '#7972e8' }}>{initials(user?.username || '?')}</span>; }
function App() {
    const [url, setUrl] = useState(initial.url), [token, setToken] = useState(initial.token), [state, setState] = useState<State | null>(null), [connected, setConnected] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [register, setRegister] = useState(true);
    const [room, setRoom] = useState('general'), [view, setView] = useState<'chat' | 'friends'>('chat'), [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(''), [attachment, setAttachment] = useState<File | null>(null);
    const [search, setSearch] = useState(''), [pins, setPins] = useState(false), [members, setMembers] = useState(true), [typing, setTyping] = useState<Record<string, number>>({}), [unread, setUnread] = useState<Record<string, number>>({});
    const [prefs, setPrefs] = useState<Preferences>(() => ({ ...defaultPrefs, ...stored('preferences', {}) }));
    const viewRef = useRef(view);
    viewRef.current = view;
    const [modal, setModal] = useState<string | null>(null), [edit, setEdit] = useState<Message | null>(null), [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [settingsTab, setSettingsTab] = useState('account');
    const fileInput = useRef<HTMLInputElement>(null), bottom = useRef<HTMLDivElement>(null), roomRef = useRef(room), stateRef = useRef(state), prefsRef = useRef(prefs), searchSeq = useRef(0), lastTyping = useRef(0);
    roomRef.current = room;
    stateRef.current = state;
    prefsRef.current = prefs;
    const notify = useCallback((text: string) => setError(text), []);
    const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${url.replace(/\/$/, '')}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok)
            throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status });
        return data;
    }, [url, token]);
    const refresh = useCallback(async () => {
        try {
            setState(await api('/state'));
        }
        catch (e) {
            if ((e as Error & {
                status?: number;
            }).status === 401) {
                setToken('');
                setState(null);
                storage.removeItem('connection');
            }
            notify((e as Error).message);
        }
    }, [api, notify]);
    const call = useCall(socket, prefs, state?.iceServers || [], notify);
    useEffect(() => { storage.setItem('preferences', JSON.stringify(prefs)); }, [prefs]);
    useEffect(() => {
        if (!token)
            return;
        storage.setItem('connection', JSON.stringify({ url, token }));
        const s = io(url, { auth: { token }, reconnectionAttempts: 10 });
        setSocket(s);
        void refresh();
        s.on('connect', () => {
            setConnected(true);
            void refresh();
            const requestedRoom = roomRef.current;
            api(`/messages?room=${encodeURIComponent(requestedRoom)}`).then(data => {
                if (roomRef.current === requestedRoom)
                    setMessages(data);
            }).catch(e => notify(e.message));
        });
        s.on('disconnect', () => setConnected(false));
        s.on('connect_error', e => { setConnected(false); setError(`Connection: ${e.message}`); });
        s.on('refresh', refresh);
        s.on('calls', calls => setState(prev => prev ? { ...prev, calls } : null));
        s.on('message', (m: Message) => {
            if (m.room === roomRef.current)
                setMessages(prev => [...prev.filter(p => p.id !== m.id), m]);
            if (m.room !== roomRef.current || viewRef.current !== 'chat')
                setUnread(prev => ({ ...prev, [m.room]: (prev[m.room] || 0) + 1 }));
            if (m.author !== stateRef.current?.me.id && prefsRef.current.notifications && document.visibilityState === 'hidden' && Notification.permission === 'granted')
                new Notification(stateRef.current?.name || 'Driskord', { body: `${stateRef.current?.users.find(u => u.id === m.author)?.username || 'Someone'} sent a message`, silent: !prefsRef.current.sounds });
        });
        s.on('message:update', (m: Message) => {
            if (m.room === roomRef.current)
                setMessages(prev => prev.map(p => p.id === m.id ? m : p));
        });
        s.on('message:delete', ({ id }: {
            id: string;
        }) => setMessages(prev => prev.filter(m => m.id !== id)));
        s.on('typing', ({ room: r, user }: {
            room: string;
            user: string;
        }) => {
            if (r === roomRef.current && user !== stateRef.current?.me.id)
                setTyping(prev => ({ ...prev, [user]: Date.now() + 3500 }));
        });
        return () => { s.disconnect(); setSocket(null); setConnected(false); };
    }, [url, token, refresh]);
    useEffect(() => {
        if (!token || !state)
            return;
        const seq = ++searchSeq.current;
        api(`/messages?room=${encodeURIComponent(room)}`).then(data => {
            if (seq === searchSeq.current)
                setMessages(data);
        }).catch(e => notify(e.message));
        setUnread(prev => ({ ...prev, [room]: 0 }));
        setTyping({});
        setDraft('');
        setAttachment(null);
    }, [room, token, !!state, api, notify]);
    useEffect(() => { const t = setInterval(() => setTyping(prev => Object.fromEntries(Object.entries(prev).filter(([, expires]) => expires > Date.now()))), 1500); return () => clearInterval(t); }, []);
    useEffect(() => {
        if (view === 'chat')
            setUnread(prev => ({ ...prev, [room]: 0 }));
    }, [view, room]);
    useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, room]);
    useEffect(() => {
        if (modal !== 'settings')
            return;
        navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => { });
    }, [modal]);
    useEffect(() => {
        if (!modal)
            return;
        const previous = document.activeElement as HTMLElement | null;
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape')
                setModal(null);
            if (event.key === 'Tab') {
                const dialog = document.querySelector('[role=dialog]');
                const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []);
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        };
        document.addEventListener('keydown', key);
        const timer = setTimeout(() => { const first = document.querySelector<HTMLElement>('[role=dialog] input,[role=dialog] button'); first?.focus(); }, 0);
        return () => { clearTimeout(timer); document.removeEventListener('keydown', key); previous?.focus(); };
    }, [modal]);
    const act = async (fn: () => Promise<unknown>) => {
        try {
            setBusy(true);
            await fn();
        }
        catch (e) {
            notify((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const permission = (p: string) => !!state && (state.me.role === 'owner' || state.roles.find(r => r.id === state.me.role)?.permissions.includes(p));
    const user = (id: string) => state?.users.find(u => u.id === id);
    const color = (u?: User) => state?.roles.find(r => r.id === u?.role)?.color;
    const dm = (id: string) => {
        if (!state)
            return;
        setRoom(`dm:${[state.me.id, id].sort().join(':')}`);
        setView('chat');
        setSearch('');
        setPins(false);
    };
    const selectRoom = (id: string) => { setRoom(id); setView('chat'); setSearch(''); setPins(false); };
    const login = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await act(async () => {
            const target = String(f.get('url')).trim().replace(/\/$/, '');
            const parsed = new URL(target);
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
                throw new Error('Enter a server origin, for example https://chat.example.com');
            const response = await fetch(`${target}/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.get('username'), password: f.get('password') }) });
            const data = await response.json();
            if (!response.ok)
                throw new Error(data.error);
            setUrl(target);
            setToken(data.token);
            setError('');
        });
    };
    const send = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft.trim() && !attachment)
            return;
        const text = draft, file = attachment;
        await act(async () => {
            let payload;
            if (file) {
                if (file.size > 5 * 1024 * 1024)
                    throw new Error('Files must be 5 MB or smaller');
                const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read file')); reader.readAsDataURL(file); });
                payload = { name: file.name, data };
            }
            await api('/messages', 'POST', { room, body: text, attachment: payload });
            setDraft('');
            setAttachment(null);
        });
    };
    const download = async (id: string, name: string) => act(async () => {
        const res = await fetch(`${url}/api/attachments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok)
            throw new Error('Download failed');
        const blob = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = blob;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(blob), 10000);
    });
    const logout = async () => { await act(async () => { await api('/logout', 'POST'); call.leave(); setToken(''); setState(null); setModal(null); setMessages([]); setUnread({}); setRoom('general'); storage.removeItem('connection'); }); };
    const visibleMessages = messages.filter(m => (!pins || m.pinned) && (!search || m.body.toLowerCase().includes(search.toLowerCase())));
    const currentChannel = state?.channels.find(c => c.id === room), dmUser = room.startsWith('dm:') ? user(room.split(':').find(id => id !== state?.me.id && id !== 'dm') || '') : undefined;
    const openSettings = (tab = 'account') => { setSettingsTab(tab); setModal('settings'); };
    const showError = error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={17}/></button></div>;
    if (!token || !state)
        return <div className="auth-shell"><div className="auth-art"><div className="wordmark"><MessageCircle fill="currentColor"/> driskord<span>BETA</span></div><div className="auth-orbit"><div className="orbit-icon"><Headphones size={70}/></div><i /><i /><i /></div><h1>Your people.<br /><em>Your place.</em></h1><p>A little less noise. A lot more connection.<br />Chat, call, and hang out on a server you own.</p><div className="auth-features"><span><Shield size={17}/> Self-hosted by you</span><span><Globe size={17}/> Made for your community</span></div></div><main className="auth-form"><div className="mini-label">MAKE YOURSELF AT HOME</div><h2>{token ? 'Connecting to your server…' : register ? 'Good conversations start here.' : 'Welcome back.'}</h2><p className="muted">{token ? 'Waiting for your server to respond.' : register ? 'Create an account on your community’s server.' : 'Your people are just a sign-in away.'}</p>{token ? <><button className="primary" onClick={() => void refresh()}>Retry connection</button><button onClick={() => { setToken(''); storage.removeItem('connection'); }}>Use another server</button></> : <form onSubmit={login}><label>Server address<input name="url" type="url" defaultValue={url} required placeholder="https://chat.example.com"/></label><label>Username<input name="username" autoComplete="username" minLength={2} maxLength={32} required placeholder="What should we call you?"/></label><label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={10} maxLength={128} required placeholder="At least 10 characters"/></label><button className="primary" disabled={busy}>{busy ? 'Just a moment…' : register ? 'Create account' : 'Sign in'}<ArrowRight size={18}/></button><p className="auth-switch">{register ? 'Already have an account?' : 'New around here?'} <button type="button" onClick={() => setRegister(!register)}>{register ? 'Sign in' : 'Create account'}</button></p></form>}<div className="self-host-note"><Server size={20}/><p>The first account on a new server becomes its owner.<br />Your account and conversations stay on that server.</p></div></main>{showError}</div>;
    return <div className="app-shell"><nav className="server-rail" aria-label="Servers"><button className="brand-icon" title="Friends" onClick={() => setView('friends')}><MessageCircle size={28}/></button><div className="rail-divider"/><button className="server-icon active" title={state.name} onClick={() => selectRoom('general')}>{initials(state.name)}</button><button className="rail-add" title="Connect to another server" onClick={() => setModal('switch')}><Plus /></button><div className="rail-spacer"/><button title="Settings" onClick={() => openSettings()}><Settings size={23}/></button><span className="rail-version">v0.1</span></nav>
 <aside className="sidebar"><button className="server-heading" onClick={() => openSettings('server')}><span>{state.name}<small><i className={connected ? 'online-dot' : 'offline-dot'}/>{connected ? 'Your community, connected' : 'Reconnecting…'}</small></span><ChevronDown size={18}/></button><div className="sidebar-content"><button className={`nav-item ${view === 'friends' ? 'selected' : ''}`} onClick={() => setView('friends')}><Users size={19}/> Friends {state.friends.some(f => !f.accepted && f.recipient === state.me.id) && <span className="count">!</span>}</button><div className="category"><span>TEXT CHANNELS</span>{permission('manage') && <button title="Create text channel" onClick={() => setModal('channel:text')}><Plus size={16}/></button>}</div>{state.channels.filter(c => c.kind === 'text').map(c => <button key={c.id} className={`nav-item channel ${room === c.id && view === 'chat' ? 'selected' : ''}`} onClick={() => selectRoom(c.id)}><Hash size={20}/>{c.name}{unread[c.id] > 0 && <span className="count">{unread[c.id]}</span>}</button>)}<div className="category"><span>VOICE CHANNELS</span>{permission('manage') && <button title="Create voice channel" onClick={() => setModal('channel:voice')}><Plus size={16}/></button>}</div>{state.channels.filter(c => c.kind === 'voice').map(c => <React.Fragment key={c.id}><button className={`nav-item channel ${call.channel === c.id ? 'in-call' : ''}`} onClick={() => {
                if (call.channel !== c.id)
                    void call.join(c.id);
            }}><Volume2 size={20}/>{c.name}{call.channel === c.id && <Radio size={15}/>}</button>{state.calls.filter(p => p.channel === c.id).map(p => <div className="voice-member" key={p.socket}><Avatar user={user(p.user)} color={color(user(p.user))} small/>{user(p.user)?.username}</div>)}</React.Fragment>)}<div className="category"><span>DIRECT MESSAGES</span><button title="Start a direct message" onClick={() => setView('friends')}><Plus size={16}/></button></div>{state.friends.filter(f => f.accepted).map(f => { const id = f.sender === state.me.id ? f.recipient : f.sender; const u = user(id); const dmRoom = `dm:${[state.me.id, id].sort().join(':')}`; return <button className={`nav-item ${room === dmRoom && view === 'chat' ? 'selected' : ''}`} key={id} onClick={() => dm(id)}><Avatar user={u} color={color(u)} small/>{u?.username}{unread[dmRoom] > 0 && <span className="count">{unread[dmRoom]}</span>}</button>; })}{!state.friends.some(f => f.accepted) && <p className="sidebar-hint">Good conversations start<br />with a hello. Add a friend.</p>}</div>
 <div className="server-owned"><Shield size={15}/><span>Self-hosted. Yours to keep.</span></div>{call.channel && <div className="voice-connected"><div><Radio size={17}/><strong>Voice connected</strong><button title="Disconnect call" onClick={call.leave}><PhoneOff size={17}/></button></div><small>{state.channels.find(c => c.id === call.channel)?.name} / {state.name}</small></div>}<div className="user-bar"><Avatar user={state.me} color={color(state.me)}/><button className="user-name" onClick={() => openSettings()}><strong>{state.me.username}</strong><small>Online</small></button><button title={call.muted ? 'Unmute' : 'Mute microphone'} onClick={() => call.setMuted(!call.muted)}>{call.muted ? <MicOff size={18}/> : <Mic size={18}/>}</button><button title="Deafen" onClick={() => call.setDeafened(!call.deafened)}>{call.deafened ? <HeadphoneOff size={18}/> : <Headphones size={18}/>}</button><button title="Settings" onClick={() => openSettings()}><Settings size={18}/></button></div></aside>
 <main className="workspace"><header className="topbar"><div className="channel-title">{view === 'friends' ? <Users size={23}/> : dmUser ? <MessageCircle size={23}/> : <Hash size={25}/>}<strong>{view === 'friends' ? 'Friends' : dmUser?.username || currentChannel?.name || 'Conversation'}</strong><span className="title-divider"/><span className="channel-description">{view === 'friends' ? 'Better together.' : dmUser ? 'A space for the two of you.' : 'A place for everyday conversations.'}</span></div><div className="top-actions">{view === 'chat' && <><button title="Pinned messages" className={pins ? 'highlight' : ''} onClick={() => setPins(!pins)}><Pin size={20}/></button><button title="Toggle member list" onClick={() => setMembers(!members)}><Users size={21}/></button><label className="search"><input placeholder="Search messages" value={search} onChange={e => setSearch(e.target.value)}/><Search size={16}/></label></>}<span className={`connection-status ${connected ? '' : 'disconnected'}`} title={connected ? 'Connected' : 'Disconnected'}><i /></span></div></header>
 {call.channel && <section className="call-panel"><div className="call-heading"><span><Volume2 size={17}/>{state.channels.find(c => c.id === call.channel)?.name}<span className="live-badge">LIVE</span></span><small>{state.calls.filter(c => c.channel === call.channel).length} / 8 connected</small></div><div className="video-grid"><MediaTile stream={call.local} name={`${state.me.username} (you)`} muted preview/>{call.remote.map(p => <MediaTile key={p.id} stream={p.stream} name={user(p.user)?.username || 'Member'} muted={call.deafened} output={prefs.output}/>)}</div><div className="call-controls"><button className={call.muted ? 'danger-bg' : ''} title="Toggle microphone" onClick={() => call.setMuted(!call.muted)}>{call.muted ? <MicOff /> : <Mic />}</button><button className={call.camera ? 'enabled' : ''} title="Toggle camera / preview" onClick={() => void call.toggleCamera()}>{call.camera ? <Video /> : <VideoOff />}</button><button className={call.sharing ? 'enabled' : ''} title="Share screen or window" onClick={() => void call.toggleShare()}><MonitorUp /></button><button className="danger-bg" title="Leave call" onClick={call.leave}><PhoneOff /></button>{prefs.pushToTalk && <small>Hold Space to talk (outside text fields)</small>}</div></section>}
 <div className="main-columns">{view === 'friends' ? <section className="friends-view"><div className="friends-header"><div><span className="mini-label">YOUR PEOPLE</span><h1>Life’s better in good company.</h1><p className="muted">Find your friends and keep the conversation going.</p></div><button className="primary" onClick={() => setModal('friend')}><Plus size={17}/>Add friend</button></div><div className="section-label">FRIENDS — {state.friends.filter(f => f.accepted).length}</div>{state.friends.length === 0 && <div className="empty-state"><div className="empty-icon"><Users size={40}/></div><h2>A familiar face goes a long way.</h2><p>Add a friend using their username on this server.</p><button className="primary" onClick={() => setModal('friend')}>Find a friend <ArrowRight size={17}/></button></div>}{state.friends.map(f => { const id = f.sender === state.me.id ? f.recipient : f.sender; const u = user(id); return <div className="friend-row" key={id}><Avatar user={u} color={color(u)}/><div><strong>{u?.username}</strong><small>{f.accepted ? (state.online.includes(id) ? 'Online' : 'Offline') : f.sender === state.me.id ? 'Friend request sent' : 'Wants to be your friend'}</small></div>{f.accepted ? <button title="Message" onClick={() => dm(id)}><MessageCircle size={21}/></button> : f.recipient === state.me.id ? <button title="Accept friend request" onClick={() => void act(() => api('/friends', 'POST', { username: u?.username }))}><Check size={21}/></button> : null}<button title="Remove / decline friend" onClick={() => setModal(`remove-friend:${id}`)}><X size={20}/></button></div>; })}</section> : <section className="chat-area"><div className="messages">{!search && !pins && <div className="channel-welcome"><div className="welcome-hash">{dmUser ? <MessageCircle size={40}/> : <Hash size={43}/>}</div><span className="mini-label">THIS IS THE BEGINNING OF SOMETHING GOOD</span><h1>{dmUser ? `Say hello to ${dmUser.username}.` : `Welcome to #${currentChannel?.name || 'general'}`}</h1><p>{dmUser ? 'Your direct conversation starts here.' : 'This is your space to share ideas, catch up, and make things happen.'}</p><div className="welcome-line"><span><Shield size={14}/> Hosted on your server</span><i /> Only your community</div></div>}{pins && <div className="filter-heading"><Pin size={18}/>Pinned messages</div>}{search && <div className="filter-heading"><Search size={18}/>Results for “{search}” <small>in the latest 500 messages</small></div>}{visibleMessages.map((m, i) => {
                const u = user(m.author);
                const previous = visibleMessages[i - 1];
                const date = new Date(m.created).toDateString();
                const showDate = !previous || new Date(previous.created).toDateString() !== date;
                return <React.Fragment key={m.id}>{showDate && <div className="date-divider"><span>{new Date(m.created).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>}<article className="message"><Avatar user={u} color={color(u)}/><div className="message-body"><div className="message-meta"><button style={{ color: color(u) }} onClick={() => {
                        if (u && u.id !== state.me.id)
                            dm(u.id);
                    }}>{u?.username || 'Former member'}</button><time>{new Date(m.created).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>{m.pinned && <Pin size={12}/>}</div><p>{m.body}{m.edited && <small className="edited"> (edited)</small>}</p>{m.attachments.map(a => <button className="attachment" key={a.id} onClick={() => void download(a.id, a.name)}><Paperclip size={21}/><span>{a.name}<small>Download attachment</small></span><Download size={18}/></button>)}<div className="reactions">{[...new Set(m.reactions.map(r => r.emoji))].map(emoji => <button className={m.reactions.some(r => r.emoji === emoji && r.user === state.me.id) ? 'mine' : ''} key={emoji} onClick={() => void act(() => api(`/messages/${m.id}/reaction`, 'POST', { emoji }))}>{emoji} <span>{m.reactions.filter(r => r.emoji === emoji).length}</span></button>)}</div></div><div className="message-actions"><button title="React" onClick={() => setModal(`reaction:${m.id}`)}><Smile size={16}/></button>{m.author === state.me.id && <button title="Edit" onClick={() => { setEdit(m); setModal('edit'); }}><Pencil size={16}/></button>}{permission('manage') && <button title={m.pinned ? 'Unpin' : 'Pin'} onClick={() => void act(() => api(`/messages/${m.id}`, 'PATCH', { pinned: !m.pinned }))}><Pin size={16}/></button>}{(m.author === state.me.id || permission('manage')) && <button title="Delete" onClick={() => setModal(`delete:${m.id}`)}><Trash2 size={16}/></button>}</div></article></React.Fragment>;
            })}{(search || pins) && !visibleMessages.length && <div className="empty-state compact"><Search size={30}/><h3>{pins ? 'No pinned messages yet.' : 'No matching messages.'}</h3></div>}<div ref={bottom}/></div><div className="composer-wrap">{attachment && <div className="attachment-preview"><Paperclip size={15}/>{attachment.name}<button onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={15}/></button></div>}<form className="composer" onSubmit={send}><button type="button" title="Attach file (up to 5 MB)" disabled={!permission('send')} onClick={() => fileInput.current?.click()}><Plus size={22}/></button><input type="file" hidden ref={fileInput} onChange={e => {
                const f = e.target.files?.[0];
                if (f && f.size > 5 * 1024 * 1024)
                    notify('Files must be 5 MB or smaller');
                else
                    setAttachment(f || null);
                e.target.value = '';
            }}/><textarea aria-label="Message" placeholder={permission('send') ? `Message ${dmUser ? '@' + dmUser.username : '#' + (currentChannel?.name || 'general')}` : 'Your role cannot send messages'} value={draft} disabled={!permission('send')} maxLength={4000} rows={1} onChange={e => {
                setDraft(e.target.value);
                if (Date.now() - lastTyping.current > 2000) {
                    socket?.emit('typing', room);
                    lastTyping.current = Date.now();
                }
            }} onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy)
                        void send(e);
                }
            }}/><button type="button" title="Add emoji" onClick={() => setModal('emoji')}><Smile size={21}/></button><button className="send-button" type="submit" title="Send message" disabled={busy || !connected || !permission('send') || (!draft.trim() && !attachment)}><Send size={18}/></button></form><div className="composer-help">{Object.keys(typing).length ? <span>{Object.keys(typing).map(id => user(id)?.username).join(', ')} is typing…</span> : <span><strong>Enter</strong> to send · <strong>Shift + Enter</strong> for a new line</span>}<span>{draft.length > 3500 ? `${draft.length}/4000` : 'A little hello can go a long way.'}</span></div></div></section>}
 {members && <aside className="member-list"><div className="member-list-heading">YOUR COMMUNITY <span>{state.users.length}</span></div>{['Online', 'Offline'].map(status => {
                const group = state.users.filter(u => state.online.includes(u.id) === (status === 'Online'));
                return group.length ? <React.Fragment key={status}><div className="member-category">{status.toUpperCase()} — {group.length}</div>{group.map(u => <button className="member" key={u.id} onClick={() => {
                            if (u.id !== state.me.id)
                                dm(u.id);
                            else
                                openSettings();
                        }}><div className="avatar-status"><Avatar user={u} color={color(u)}/><i className={status === 'Online' ? 'online-dot' : 'offline-dot'}/></div><span><strong style={{ color: color(u) }}>{u.username}{u.id === state.me.id && <small>you</small>}</strong><small>{state.roles.find(r => r.id === u.role)?.name}</small></span>{u.role === 'owner' && <Shield size={14} className="owner-shield"/>}</button>)}</React.Fragment> : null;
            })}<div className="community-card"><div className="community-card-icon"><MessageCircle size={23}/><span>✦</span></div><strong>Small server. Big possibilities.</strong><p>Make a little corner of the internet feel like home.</p><button onClick={() => void act(async () => { await navigator.clipboard.writeText(url); notify('Server address copied. Share it with your friends.'); })}>Copy server address <Copy size={13}/></button></div></aside>}</div><footer className="status-bar"><span><Shield size={12}/> Your server. Your conversations.</span><span>Driskord <i /> Early access</span></footer></main>
 {modal && <div className="modal-backdrop" onMouseDown={e => {
                if (e.target === e.currentTarget)
                    setModal(null);
            }}><section className={`modal ${modal === 'settings' ? 'settings-modal' : ''}`} role="dialog" aria-modal="true" aria-label={modal === 'settings' ? 'Settings' : 'Action'}><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(null)}><X size={21}/></button>{modal === 'settings' ? <><nav className="settings-nav"><span className="mini-label">SETTINGS</span>{[['account', 'My account'], ['audio', 'Voice & video'], ['notifications', 'Notifications'], ['server', 'Server settings'], ['roles', 'Roles & permissions']].map(([id, label]) => <button className={settingsTab === id ? 'selected' : ''} key={id} onClick={() => setSettingsTab(id)}>{label}</button>)}<button className="danger-text" onClick={() => void logout()}><LogOut size={16}/>Sign out</button></nav><div className="settings-content"><h2>{({ account: 'My account', audio: 'Voice & video', notifications: 'Notifications', server: 'Server settings', roles: 'Roles & permissions' } as Record<string, string>)[settingsTab]}</h2>{settingsTab === 'account' && <><div className="profile-card"><Avatar user={state.me} color={color(state.me)}/><div><h3>{state.me.username}</h3><p>{state.roles.find(r => r.id === state.me.role)?.name}</p></div></div><label>Connected server<input value={url} readOnly/></label><p className="muted">Accounts and friend lists belong to this server. Sessions expire after 30 days.</p><button className="secondary" onClick={() => setModal('switch')}>Connect to another server <ArrowRight size={16}/></button></>}{settingsTab === 'audio' && <><p className="muted">Device and quality changes apply to your next call or video start.</p><button className="secondary" onClick={() => void act(async () => { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); setDevices(await navigator.mediaDevices.enumerateDevices()); })}>Allow microphone & refresh devices</button><label>Input device<select value={prefs.input} onChange={e => setPrefs({ ...prefs, input: e.target.value })}><option value="">System default</option>{devices.filter(d => d.kind === 'audioinput' && d.deviceId).map((d, i) => <option value={d.deviceId} key={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label><label>Output device<select value={prefs.output} onChange={e => setPrefs({ ...prefs, output: e.target.value })}><option value="">System default</option>{devices.filter(d => d.kind === 'audiooutput' && d.deviceId).map((d, i) => <option value={d.deviceId} key={d.deviceId}>{d.label || `Speaker ${i + 1}`}</option>)}</select></label><label>Streaming resolution<select value={prefs.quality} onChange={e => setPrefs({ ...prefs, quality: e.target.value })}><option value="360">360p · Save bandwidth</option><option value="720">720p · Balanced</option><option value="1080">1080p · Higher quality</option></select></label><Toggle title="Noise suppression & echo cancellation" value={prefs.noise} set={v => setPrefs({ ...prefs, noise: v })}/><Toggle title="Push-to-talk (hold Space while app is focused)" value={prefs.pushToTalk} set={v => setPrefs({ ...prefs, pushToTalk: v })}/><Toggle title="Call connection sounds" value={prefs.sounds} set={v => setPrefs({ ...prefs, sounds: v })}/><p className="muted">Join a voice channel to preview your camera. Screen sharing replaces your outgoing camera while active. System audio sharing is not included.</p></>}{settingsTab === 'notifications' && <><Bell className="settings-hero" size={42}/><p className="muted">Get a desktop notification for new messages while the app is in the background. Message text stays out of notifications.</p><Toggle title="Desktop notifications" value={prefs.notifications} set={v => void act(async () => {
                        if (v) {
                            if (!('Notification' in window))
                                throw new Error('Desktop notifications are unavailable');
                            const result = await Notification.requestPermission();
                            if (result !== 'granted')
                                throw new Error('Notifications were not allowed. Check your operating system settings.');
                        }
                        setPrefs({ ...prefs, notifications: v });
                    })}/></>}{settingsTab === 'server' && <><p className="muted">Server management is controlled by your role. The owner can assign roles to members.</p><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(async () => { await api('/settings', 'PATCH', { name: f.get('name') }); notify('Server settings saved.'); }); }}><label>Server name<input name="name" defaultValue={state.name} required maxLength={64} disabled={!permission('manage')}/></label><button className="primary" disabled={!permission('manage') || busy}>Save changes</button></form><label>Server address<input readOnly value={url}/></label><p className="muted">For internet calls, configure ICE_SERVERS with your own STUN/TURN service. See the hosting guide.</p></>}{settingsTab === 'roles' && <><p className="muted">Roles define name color, chat, voice, and server management access. Server owners always retain access.</p>{state.roles.map(r => <div className="role-row" key={r.id}><i style={{ background: r.color }}/><strong>{r.name}</strong><small>{r.permissions.join(' · ')}</small><button title="Edit role" disabled={!permission('manage') || r.id === 'owner'} onClick={() => setModal(`role:${r.id}`)}><Pencil size={15}/></button></div>)}{permission('manage') && <button className="secondary" onClick={() => setModal('role:new')}><Plus size={16}/> Create role</button>}<h3>Member roles</h3>{state.users.map(u => <div className="role-member" key={u.id}><span>{u.username}</span><select value={u.role} disabled={state.me.role !== 'owner' || u.role === 'owner'} onChange={e => void act(() => api(`/users/${u.id}/role`, 'PATCH', { role: e.target.value }))}>{state.roles.filter(r => r.id !== 'owner' || u.role === 'owner').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>)}</>}</div></> :
                modal === 'switch' ? <><Server size={35} className="settings-hero"/><h2>Connect to another server</h2><p className="muted">Sign out to enter another server address. You’ll need an account on that server. Your current messages stay on this server.</p><button className="primary" onClick={() => void act(async () => { await api('/logout', 'POST'); call.leave(); setToken(''); setState(null); setMessages([]); setUnread({}); setRoom('general'); setModal(null); storage.removeItem('connection'); })}>Sign out & connect</button></> :
                    modal === 'friend' ? <><Users size={35} className="settings-hero"/><h2>Find your people.</h2><p className="muted">Enter their exact username on this server.</p><SimpleForm label="Username" submit="Send friend request" busy={busy} onSubmit={value => act(async () => { await api('/friends', 'POST', { username: value }); setModal(null); })}/></> :
                        modal.startsWith('channel:') ? <><h2>Create a {modal.split(':')[1]} channel</h2><SimpleForm label="Channel name" submit="Create channel" busy={busy} onSubmit={value => act(async () => { await api('/channels', 'POST', { name: value, kind: modal.split(':')[1] }); setModal(null); })}/></> :
                            modal === 'edit' ? <><h2>Edit message</h2><SimpleForm label="Message" initialValue={edit?.body} submit="Save message" busy={busy} onSubmit={value => act(async () => { await api(`/messages/${edit?.id}`, 'PATCH', { body: value }); setModal(null); })}/></> :
                                modal.startsWith('role:') ? <RoleForm role={state.roles.find(r => r.id === modal.split(':')[1])} busy={busy} owner={state.me.role === 'owner'} onSave={data => act(async () => { const id = modal.split(':')[1]; await api(id === 'new' ? '/roles' : `/roles/${id}`, id === 'new' ? 'POST' : 'PATCH', data); setModal('settings'); setSettingsTab('roles'); })}/> :
                                    modal === 'emoji' || modal.startsWith('reaction:') ? <><h2>{modal === 'emoji' ? 'Say it with an emoji.' : 'Add a reaction'}</h2><div className="emoji-picker">{['👍', '❤️', '😂', '🎉', '👀'].map(emoji => <button key={emoji} onClick={() => {
                                                if (modal === 'emoji') {
                                                    setDraft(d => d + emoji);
                                                    setModal(null);
                                                }
                                                else
                                                    void act(async () => { await api(`/messages/${modal.split(':')[1]}/reaction`, 'POST', { emoji }); setModal(null); });
                                            }}>{emoji}</button>)}</div></> :
                                        <><h2>{modal.startsWith('delete:') ? 'Delete this message?' : 'Remove this friend?'}</h2><p className="muted">{modal.startsWith('delete:') ? 'This will permanently delete the message and any attachment.' : 'You can send another friend request later.'}</p><button className="primary danger-bg" disabled={busy} onClick={() => void act(async () => { const [action, id] = modal.split(':'); await api(action === 'delete' ? `/messages/${id}` : `/friends/${id}`, 'DELETE'); setModal(null); })}>Confirm</button></>}</section></div>}{showError}</div>;
}
function Toggle({ title, value, set }: {
    title: string;
    value: boolean;
    set: (v: boolean) => void;
}) { return <label className="toggle-label"><span>{title}</span><button type="button" role="switch" aria-checked={value} aria-label={title} className={`toggle ${value ? 'on' : ''}`} onClick={() => set(!value)}><i /></button></label>; }
function SimpleForm({ label, initialValue, submit, busy, onSubmit }: {
    label: string;
    initialValue?: string;
    submit: string;
    busy: boolean;
    onSubmit: (v: string) => unknown;
}) { return <form onSubmit={e => { e.preventDefault(); void onSubmit(String(new FormData(e.currentTarget).get('value'))); }}><label>{label}<input name="value" autoFocus defaultValue={initialValue} required maxLength={label === 'Message' ? 4000 : 32}/></label><button className="primary" disabled={busy}>{submit}</button></form>; }
function RoleForm({ role, busy, owner, onSave }: {
    role?: State['roles'][number];
    busy: boolean;
    owner: boolean;
    onSave: (v: unknown) => unknown;
}) { return <><h2>{role ? 'Edit role' : 'Create a role'}</h2><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void onSave({ name: f.get('name'), color: f.get('color'), permissions: f.getAll('permission') }); }}><label>Role name<input name="name" defaultValue={role?.name} maxLength={32} required/></label><label>Name color<input name="color" type="color" defaultValue={role?.color || '#8b82f6'}/></label>{[['send', 'Send messages & files'], ['voice', 'Join voice & video calls'], ['manage', 'Manage server, channels, roles & messages']].map(([p, label]) => <label className="checkbox-label" key={p}><input type="checkbox" name="permission" value={p} defaultChecked={role ? role.permissions.includes(p) : p !== 'manage'} disabled={p === 'manage' && !owner}/>{label}</label>)}<button className="primary" disabled={busy}>Save role</button></form></>; }
function MediaTile({ stream, name, muted = false, preview = false, output = '' }: {
    stream: MediaStream | null;
    name: string;
    muted?: boolean;
    preview?: boolean;
    output?: string;
}) {
    const ref = useRef<HTMLVideoElement>(null), [volume, setVolume] = useState(1), [mediaError, setMediaError] = useState(''), [hasVideo, setHasVideo] = useState(false);
    useEffect(() => {
        const video = ref.current;
        if (!video)
            return;
        video.srcObject = stream;
        const observed = new Set<MediaStreamTrack>();
        const update = () => {
            for (const track of stream?.getVideoTracks() || []) {
                if (!observed.has(track)) {
                    observed.add(track);
                    track.addEventListener('mute', update);
                    track.addEventListener('unmute', update);
                    track.addEventListener('ended', update);
                }
            }
            setHasVideo((stream?.getVideoTracks() || []).some(t => t.readyState === 'live' && !t.muted));
        };
        stream?.addEventListener('addtrack', update);
        stream?.addEventListener('removetrack', update);
        update();
        if (stream)
            video.play().catch(() => setMediaError('Click the video to play'));
        return () => {
            stream?.removeEventListener('addtrack', update);
            stream?.removeEventListener('removetrack', update);
            observed.forEach(track => { track.removeEventListener('mute', update); track.removeEventListener('unmute', update); track.removeEventListener('ended', update); });
            video.srcObject = null;
        };
    }, [stream]);
    useEffect(() => {
        const video = ref.current;
        if (video) {
            video.volume = volume;
            if ('setSinkId' in video)
                void video.setSinkId(output).catch(() => setMediaError('Output device unavailable'));
        }
    }, [output, volume]);
    return <div className={`media-tile ${preview ? 'preview' : ''}`}><div className="media-placeholder">{initials(name)}<small>{preview ? 'Your camera preview' : 'Voice connected'}</small></div><video style={{ opacity: hasVideo ? 1 : 0 }} ref={ref} autoPlay playsInline muted={muted} onClick={() => { void ref.current?.play().then(() => setMediaError('')); }}/><span className="media-name">{name}</span>{mediaError && <span className="media-error">{mediaError}</span>}{!preview && <input className="volume-slider" aria-label={`Volume for ${name}`} title="Participant volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))}/>}</div>;
}
createRoot(document.getElementById('root')!).render(<App />);
