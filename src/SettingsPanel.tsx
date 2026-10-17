import { useState, type Dispatch, type SetStateAction } from 'react';
import { AvatarCropper } from './AvatarCropper';
import { ChannelSettings } from './ChannelSettings';
import { ArrowRight, Bell, LogOut, Pencil, Plus, Trash2 } from 'lucide-react';
import type { State, Preferences, User } from './types';
import type { ApiClient } from './api';
import type { useCall } from './useCall';
import { Avatar } from './Avatar';
import { Emoji } from './ChatContent';
import { displayName } from './profiles';
import { MicrophoneMeter } from './MicrophoneMeter';
import { openMicrophone, formatMicrophoneError } from './media';
import { Toggle } from './forms';
export function SettingsPanel({
    state,
    prefs,
    setPrefs,
    settingsTab,
    setSettingsTab,
    setModal,
    logout,
    color,
    act,
    api,
    refresh,
    notify,
    busy,
    uploadAvatar,
    loadAvatar,
    url,
    devices,
    setDevices,
    call,
    uploadEmoji,
    permission,
}: {
    state: State;
    prefs: Preferences;
    setPrefs: Dispatch<SetStateAction<Preferences>>;
    settingsTab: string;
    setSettingsTab: (tab: string) => void;
    setModal: (modal: string | null) => void;
    logout: () => Promise<void>;
    color: (user?: User) => string | undefined;
    act: (action: () => Promise<unknown>) => Promise<void>;
    api: ApiClient;
    refresh: () => Promise<void>;
    notify: (message: string) => void;
    busy: boolean;
    uploadAvatar: (data: string) => Promise<void>;
    loadAvatar: () => Promise<File>;
    url: string;
    devices: MediaDeviceInfo[];
    setDevices: Dispatch<SetStateAction<MediaDeviceInfo[]>>;
    call: ReturnType<typeof useCall>;
    uploadEmoji: (event: React.FormEvent<HTMLFormElement>) => void;
    permission: (permission: string) => boolean;
}) {
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    return (
        <>
            <nav className="settings-nav">
                <span className="mini-label">SETTINGS</span>
                {[
                    ['account', 'My account'],
                    ['audio', 'Voice & video'],
                    ['notifications', 'Notifications'],
                    ['server', 'Server settings'],
                    ['roles', 'Roles & permissions'],
                    ...(permission('manage') ? [['channels', 'Channels & access']] : []),
                    ['emojis', 'Custom emojis'],
                ].map(([id, label]) => (
                    <button
                        className={settingsTab === id ? 'selected' : ''}
                        key={id}
                        onClick={() => setSettingsTab(id)}
                    >
                        {label}
                    </button>
                ))}
                <button className="danger-text" onClick={() => void logout()}>
                    <LogOut size={16} />
                    Sign out
                </button>
            </nav>
            <div className="settings-content">
                <h2>
                    {
                        (
                            {
                                account: 'My account',
                                audio: 'Voice & video',
                                notifications: 'Notifications',
                                server: 'Server settings',
                                roles: 'Roles & permissions',
                                channels: 'Channels & access',
                                emojis: 'Custom emojis',
                            } as Record<string, string>
                        )[settingsTab]
                    }
                </h2>
                {settingsTab === 'account' && (
                    <>
                        <div className="profile-card">
                            <Avatar user={state.me} color={color(state.me)} />
                            <div>
                                <h3>{displayName(state.me)}</h3>
                                <p>{state.roles.find((r) => r.id === state.me.role)?.name}</p>
                            </div>
                        </div>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                void act(async () => {
                                    await api('/profile', 'PATCH', {
                                        nickname: form.get('nickname'),
                                    });
                                    await refresh();
                                    notify('Nickname saved.');
                                });
                            }}
                        >
                            <label>
                                Username
                                <input readOnly value={state.me.username} />
                            </label>
                            <p className="muted">
                                Your account username is permanent. Use it to sign in and add
                                friends.
                            </p>
                            <label>
                                Nickname
                                <input
                                    key={state.me.nickname}
                                    name="nickname"
                                    defaultValue={state.me.nickname || state.me.username}
                                    minLength={1}
                                    maxLength={32}
                                    required
                                />
                            </label>
                            <button className="primary" disabled={busy}>
                                Save nickname
                            </button>
                        </form>
                        <label className="secondary">
                            Upload profile picture
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                disabled={busy}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) setAvatarFile(file);
                                    e.target.value = '';
                                }}
                            />
                        </label>
                        <p className="muted">
                            Choose the crop and position before saving. Saved as a 512 × 512 image.
                            Upload the original again to restore an earlier crop.
                        </p>
                        {state.me.avatar && (
                            <button
                                disabled={busy}
                                onClick={() =>
                                    void act(async () => setAvatarFile(await loadAvatar()))
                                }
                            >
                                Adjust current picture
                            </button>
                        )}
                        {state.me.avatar && (
                            <button
                                disabled={busy}
                                onClick={() =>
                                    void act(async () => {
                                        await api('/profile/avatar', 'DELETE');
                                        await refresh();
                                    })
                                }
                            >
                                Remove profile picture
                            </button>
                        )}
                        <label>
                            Connected server
                            <input value={url} readOnly />
                        </label>
                        <p className="muted">
                            Accounts and friend lists belong to this server. Sessions expire after
                            30 days.
                        </p>
                        <button className="secondary" onClick={() => setModal('switch')}>
                            Connect to another server <ArrowRight size={16} />
                        </button>
                    </>
                )}
                {settingsTab === 'audio' && (
                    <>
                        <p className="muted">
                            Device and quality changes apply to your next call or video start.
                        </p>
                        <button
                            className="secondary"
                            onClick={() =>
                                void act(async () => {
                                    try {
                                        const { stream } = await openMicrophone({
                                            input: '',
                                            noise: prefs.noise,
                                        });
                                        stream.getTracks().forEach((t) => t.stop());
                                        setDevices(await navigator.mediaDevices.enumerateDevices());
                                        notify(
                                            'Microphone access works. Choose an input device below, or keep System default.',
                                        );
                                    } catch (error) {
                                        throw new Error(formatMicrophoneError(error));
                                    }
                                })
                            }
                        >
                            Allow microphone & refresh devices
                        </button>
                        <label>
                            Input device
                            <select
                                value={prefs.input}
                                onChange={(e) =>
                                    setPrefs({
                                        ...prefs,
                                        input: e.target.value,
                                        inputLabel:
                                            devices.find(
                                                (d) =>
                                                    d.deviceId === e.target.value &&
                                                    d.kind === 'audioinput',
                                            )?.label || '',
                                    })
                                }
                            >
                                <option value="">System default</option>
                                {prefs.input &&
                                    !devices.some(
                                        (d) =>
                                            d.kind === 'audioinput' && d.deviceId === prefs.input,
                                    ) && (
                                        <option value={prefs.input}>
                                            {prefs.inputLabel || 'Saved microphone'} (unavailable)
                                        </option>
                                    )}
                                {devices
                                    .filter((d) => d.kind === 'audioinput' && d.deviceId)
                                    .map((d, i) => (
                                        <option value={d.deviceId} key={d.deviceId}>
                                            {d.label || `Microphone ${i + 1}`}
                                        </option>
                                    ))}
                            </select>
                        </label>
                        <MicrophoneMeter
                            preferences={prefs}
                            activeStream={call.channel ? call.microphone : null}
                            onInputFallback={() =>
                                notify(
                                    'Saved microphone unavailable; testing System default. Your selection is kept.',
                                )
                            }
                        />
                        <label>
                            Output device
                            <select
                                value={prefs.output}
                                onChange={(e) =>
                                    setPrefs({
                                        ...prefs,
                                        output: e.target.value,
                                        outputLabel:
                                            devices.find(
                                                (d) =>
                                                    d.deviceId === e.target.value &&
                                                    d.kind === 'audiooutput',
                                            )?.label || '',
                                    })
                                }
                            >
                                <option value="">System default</option>
                                {prefs.output &&
                                    !devices.some(
                                        (d) =>
                                            d.kind === 'audiooutput' && d.deviceId === prefs.output,
                                    ) && (
                                        <option value={prefs.output}>
                                            {prefs.outputLabel || 'Saved speaker'} (unavailable)
                                        </option>
                                    )}
                                {devices
                                    .filter((d) => d.kind === 'audiooutput' && d.deviceId)
                                    .map((d, i) => (
                                        <option value={d.deviceId} key={d.deviceId}>
                                            {d.label || `Speaker ${i + 1}`}
                                        </option>
                                    ))}
                            </select>
                        </label>
                        <label>
                            Streaming resolution
                            <select
                                value={prefs.quality}
                                onChange={(e) => setPrefs({ ...prefs, quality: e.target.value })}
                            >
                                <option value="360">360p · Save bandwidth</option>
                                <option value="720">720p · Balanced</option>
                                <option value="1080">1080p · Higher quality</option>
                            </select>
                        </label>
                        <Toggle
                            title="Noise suppression & echo cancellation"
                            value={prefs.noise}
                            set={(v) => setPrefs({ ...prefs, noise: v })}
                        />
                        <Toggle
                            title="Push-to-talk (hold Space while app is focused)"
                            value={prefs.pushToTalk}
                            set={(v) => setPrefs({ ...prefs, pushToTalk: v })}
                        />
                        <Toggle
                            title="Call connection sounds"
                            value={prefs.sounds}
                            set={(v) => setPrefs({ ...prefs, sounds: v })}
                        />
                        <p className="muted">
                            Join a voice channel to preview your camera. Screen sharing replaces
                            your outgoing camera while active. Windows screen sharing can include
                            system audio when enabled in the picker.
                        </p>
                    </>
                )}
                {settingsTab === 'emojis' && (
                    <>
                        <p>
                            Upload a custom emoji to use in messages and reactions. Images resize to
                            128 × 128; animated uploads use a still frame.
                        </p>
                        <form onSubmit={uploadEmoji}>
                            <label>
                                Name
                                <input
                                    name="name"
                                    pattern="[a-z0-9_]{2,32}"
                                    minLength={2}
                                    maxLength={32}
                                    placeholder="party_cat"
                                    required
                                />
                            </label>
                            <label>
                                Image
                                <input
                                    name="image"
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    required
                                />
                            </label>
                            <button className="primary" disabled={busy || !permission('send')}>
                                Upload emoji
                            </button>
                        </form>
                        <div className="custom-emoji-list">
                            {(state.emojis || []).map((e) => (
                                <div key={e.id}>
                                    <Emoji value={`:${e.name}:`} custom={state.emojis} />
                                    <span>:{e.name}:</span>
                                    {(e.author === state.me.id || permission('manage')) && (
                                        <button
                                            title={`Delete ${e.name}`}
                                            onClick={() =>
                                                void act(async () => {
                                                    await api(`/emojis/${e.id}`, 'DELETE');
                                                    await refresh();
                                                })
                                            }
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
                {settingsTab === 'notifications' && (
                    <>
                        <Bell className="settings-hero" size={42} />
                        <p className="muted">
                            Get a desktop notification for new messages while the app is in the
                            background. Message text stays out of notifications.
                        </p>
                        <Toggle
                            title="Desktop notifications"
                            value={prefs.notifications}
                            set={(v) =>
                                void act(async () => {
                                    if (v) {
                                        if (!('Notification' in window))
                                            throw new Error(
                                                'Desktop notifications are unavailable',
                                            );
                                        const result = await Notification.requestPermission();
                                        if (result !== 'granted')
                                            throw new Error(
                                                'Notifications were not allowed. Check your operating system settings.',
                                            );
                                    }
                                    setPrefs({ ...prefs, notifications: v });
                                })
                            }
                        />
                    </>
                )}
                {settingsTab === 'server' && (
                    <>
                        <p className="muted">
                            Server management is controlled by your role. The owner can assign roles
                            to members.
                        </p>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                const f = new FormData(e.currentTarget);
                                void act(async () => {
                                    await api('/settings', 'PATCH', { name: f.get('name') });
                                    notify('Server settings saved.');
                                });
                            }}
                        >
                            <label>
                                Server name
                                <input
                                    name="name"
                                    defaultValue={state.name}
                                    required
                                    maxLength={64}
                                    disabled={!permission('manage')}
                                />
                            </label>
                            <button className="primary" disabled={!permission('manage') || busy}>
                                Save changes
                            </button>
                        </form>
                        <label>
                            Server address
                            <input readOnly value={url} />
                        </label>
                        <p className="muted">
                            For internet calls, configure ICE_SERVERS with your own STUN/TURN
                            service. See the hosting guide.
                        </p>
                    </>
                )}
                {settingsTab === 'channels' && permission('manage') && (
                    <ChannelSettings
                        state={state}
                        api={api}
                        refresh={refresh}
                        busy={busy}
                        act={act}
                    />
                )}
                {settingsTab === 'roles' && (
                    <>
                        <p className="muted">
                            Roles define name color, chat, voice, and server management access.
                            Server owners always retain access.
                        </p>
                        {state.roles.map((r) => (
                            <div className="role-row" key={r.id}>
                                <i style={{ background: r.color }} />
                                <strong>{r.name}</strong>
                                <small>{r.permissions.join(' · ')}</small>
                                <button
                                    title="Edit role"
                                    disabled={!permission('manage') || r.id === 'owner'}
                                    onClick={() => setModal(`role:${r.id}`)}
                                >
                                    <Pencil size={15} />
                                </button>
                            </div>
                        ))}
                        {permission('manage') && (
                            <button className="secondary" onClick={() => setModal('role:new')}>
                                <Plus size={16} /> Create role
                            </button>
                        )}
                        <h3>Member roles</h3>
                        {state.users.map((u) => (
                            <div className="role-member" key={u.id}>
                                <span>{displayName(u)}</span>
                                <select
                                    value={u.role}
                                    disabled={state.me.role !== 'owner' || u.role === 'owner'}
                                    onChange={(e) =>
                                        void act(() =>
                                            api(`/users/${u.id}/role`, 'PATCH', {
                                                role: e.target.value,
                                            }),
                                        )
                                    }
                                >
                                    {state.roles
                                        .filter((r) => r.id !== 'owner' || u.role === 'owner')
                                        .map((r) => (
                                            <option key={r.id} value={r.id}>
                                                {r.name}
                                            </option>
                                        ))}
                                </select>
                            </div>
                        ))}
                    </>
                )}
            </div>
            {avatarFile && (
                <AvatarCropper
                    file={avatarFile}
                    onSave={uploadAvatar}
                    onClose={() => setAvatarFile(null)}
                />
            )}
        </>
    );
}
