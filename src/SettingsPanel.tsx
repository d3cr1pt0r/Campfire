import { RolesSettings } from './RolesSettings';
import { highestPosition } from '../shared/permissions.js';
import { RegistrationSettings } from './RegistrationSettings';
import { notificationKey, channelNotificationMode } from './notifications';
import { ChannelNotificationSelect } from './ChannelNotificationSelect';
import { canonicalRoom } from '../shared/rooms.js';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { formatFingerprint, serverLink } from './serverLink';
import { pinsFor } from './serverTrust';
import { AvatarCropper } from './AvatarCropper';
import { ChannelSettings } from './ChannelSettings';
import { ArrowRight, Bell, LogOut, Trash2, X } from 'lucide-react';
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
    testNotificationSound,
}: {
    testNotificationSound: () => Promise<void>;
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
    const [serverIconFile, setServerIconFile] = useState<File | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [removeUser, setRemoveUser] = useState<string | null>(null);
    const [deleteEmoji, setDeleteEmoji] = useState<string | null>(null);
    // The fingerprint this desktop app verified; links built from it protect new members.
    const [pin, setPin] = useState<string | null>(null);
    useEffect(() => {
        let current = true;
        void pinsFor(url)
            ?.get(url)
            .then((value) => current && setPin(value))
            .catch(() => {});
        return () => {
            current = false;
        };
    }, [url]);
    const reportedPin = state.identity?.fingerprint;
    const copyServerLink = () =>
        void act(async () => {
            await navigator.clipboard.writeText(serverLink(url, { pin: pin ?? undefined }));
            notify('Server link copied.');
        });
    const sections = [
        ['account', 'My account'],
        ['appearance', 'Appearance'],
        ['audio', 'Voice & video'],
        ['notifications', 'Notifications'],
        ['server', 'Server settings'],
        ['roles', 'Roles & permissions'],
        ...(['channels.edit', 'channels.create', 'channels.delete', 'channels.reorder'].some(
            permission,
        )
            ? [['channels', 'Channels']]
            : []),
        ['emojis', 'Custom emojis'],
    ];
    return (
        <>
            <header className="settings-header">
                <h2>{sections.find(([id]) => id === settingsTab)?.[1]}</h2>
                <div className="settings-mobile-header">
                    <label className="sr-only" htmlFor="settings-section">
                        Settings section
                    </label>
                    <select
                        id="settings-section"
                        value={settingsTab}
                        onChange={(event) => setSettingsTab(event.target.value)}
                    >
                        {sections.map(([id, label]) => (
                            <option key={id} value={id}>
                                {label}
                            </option>
                        ))}
                    </select>
                </div>
                <button
                    className="modal-close"
                    aria-label="Close dialog"
                    disabled={busy}
                    onClick={() => setModal(null)}
                >
                    <X size={21} />
                </button>
            </header>
            <nav className="settings-nav" aria-label="Settings sections">
                <span className="mini-label">SETTINGS</span>
                {sections.map(([id, label]) => (
                    <button
                        className={settingsTab === id ? 'selected' : ''}
                        aria-current={settingsTab === id ? 'page' : undefined}
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
            <div className="settings-content" key={settingsTab}>
                {['appearance', 'audio', 'notifications'].includes(settingsTab) && (
                    <p className="field-help">Preferences save automatically on this device.</p>
                )}
                {settingsTab === 'appearance' && (
                    <>
                        <h3>Make yourself at home</h3>
                        <p className="muted">
                            Choose the light around your Campfire. System follows your device’s
                            light or dark appearance.
                        </p>
                        <fieldset className="theme-options">
                            <legend className="sr-only">Color theme</legend>
                            {(
                                [
                                    ['system', 'System', 'Follow your device'],
                                    ['dark', 'Dark', 'Ember · charcoal & amber'],
                                    ['light', 'Light', 'Canvas · warm cream'],
                                ] as const
                            ).map(([value, title, description]) => (
                                <label className="theme-choice" key={value}>
                                    <span
                                        className={`theme-preview theme-preview-${value}`}
                                        aria-hidden="true"
                                    >
                                        <i />
                                        <span>
                                            <b />
                                            <b />
                                            <b />
                                        </span>
                                    </span>
                                    <span className="theme-choice-label">
                                        <strong>{title}</strong>
                                        <small>{description}</small>
                                    </span>
                                    <input
                                        type="radio"
                                        name="theme"
                                        value={value}
                                        checked={(prefs.theme ?? 'system') === value}
                                        onChange={() =>
                                            setPrefs((previous) => ({ ...previous, theme: value }))
                                        }
                                    />
                                </label>
                            ))}
                        </fieldset>
                        <p className="field-help">
                            This preference applies only to this client, including the sign-in
                            screen.
                        </p>
                    </>
                )}
                {settingsTab === 'account' && (
                    <>
                        <label>
                            Status
                            <select
                                value={state.me.status || 'online'}
                                disabled={busy}
                                onChange={(event) => {
                                    const status = event.target.value;
                                    void act(async () => {
                                        await api('/presence', 'PATCH', { status });
                                        await refresh();
                                    });
                                }}
                            >
                                <option value="online">Online</option>
                                <option value="idle">Idle</option>
                                <option value="dnd">Do not disturb</option>
                            </select>
                        </label>
                        <p className="field-help">
                            Do not disturb silences message sounds and desktop notifications. You
                            can still receive messages and join calls.
                        </p>
                        <Toggle
                            title="Set Idle automatically when I’m away"
                            value={!!prefs.autoIdle}
                            set={(autoIdle) => setPrefs({ ...prefs, autoIdle })}
                        />
                        {prefs.autoIdle && (
                            <label>
                                Idle after
                                <select
                                    value={prefs.idleMinutes || 5}
                                    onChange={(event) =>
                                        setPrefs({
                                            ...prefs,
                                            idleMinutes: Number(event.target.value),
                                        })
                                    }
                                >
                                    {[1, 5, 10, 15, 30].map((minutes) => (
                                        <option key={minutes} value={minutes}>
                                            {minutes} {minutes === 1 ? 'minute' : 'minutes'}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <p className="field-help">
                            Automatically returns to Online when activity resumes. Manual Idle and
                            Do not disturb stay selected. The desktop app uses computer activity
                            where supported; the browser and unsupported desktops use activity in
                            this app. This preference saves on this device.
                        </p>
                        <div className="profile-card">
                            <Avatar user={state.me} color={color(state.me)} />
                            <div>
                                <h3>{displayName(state.me)}</h3>
                                <p>
                                    {state.me.owner
                                        ? 'Owner'
                                        : state.roles
                                              .filter((role) => state.me.roles.includes(role.id))
                                              .map((role) => role.name)
                                              .join(' · ') ||
                                          state.roles.find((role) => role.id === 'everyone')
                                              ?.name ||
                                          'Default'}
                                </p>
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
                                Your account username is permanent. Use it to sign in.
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
                                className="secondary"
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
                                className="secondary danger-text"
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
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                const form = event.currentTarget;
                                const data = new FormData(form);
                                void act(async () => {
                                    if (data.get('password') !== data.get('confirm'))
                                        throw new Error('The new passwords don’t match.');
                                    await api('/account/password', 'POST', {
                                        current: data.get('current'),
                                        password: data.get('password'),
                                    });
                                    form.reset();
                                    notify('Password changed. Your other devices were signed out.');
                                });
                            }}
                        >
                            <h3>Change password</h3>
                            <label>
                                Current password
                                <input
                                    name="current"
                                    type="password"
                                    autoComplete="current-password"
                                    maxLength={128}
                                    required
                                />
                            </label>
                            <label>
                                New password
                                <input
                                    name="password"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={10}
                                    maxLength={128}
                                    required
                                    placeholder="At least 10 characters"
                                />
                            </label>
                            <label>
                                Confirm new password
                                <input
                                    name="confirm"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={10}
                                    maxLength={128}
                                    required
                                />
                            </label>
                            <p className="muted">
                                Changing your password signs out every other device.
                            </p>
                            <button className="primary" disabled={busy}>
                                Change password
                            </button>
                        </form>
                        <label>
                            Connected server
                            <input value={url} readOnly />
                        </label>
                        <p className="muted">
                            Accounts and messages belong to this server. Sessions expire after 30
                            days.
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
                            title="Built-in noise suppression, echo cancellation & auto gain"
                            value={prefs.noise}
                            set={(v) => setPrefs({ ...prefs, noise: v })}
                        />
                        <p className="muted">
                            Uses Chromium’s built-in WebRTC audio processing. No separate RNNoise or
                            AI denoiser is installed. Quality depends on your microphone and audio
                            backend; rejoin the call after changing this setting.
                        </p>
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
                            <button
                                className="primary"
                                disabled={busy || !permission('emojis.upload')}
                            >
                                Upload emoji
                            </button>
                        </form>
                        <div className="custom-emoji-list">
                            {(state.emojis || []).map((e) => (
                                <div key={e.id}>
                                    <Emoji value={`:${e.name}:`} custom={state.emojis} />
                                    <span>:{e.name}:</span>
                                    {(e.author === state.me.id ||
                                        permission('emojis.deleteOthers')) &&
                                        (deleteEmoji === e.id ? (
                                            <div className="emoji-delete-actions">
                                                <span>Delete :{e.name}:?</span>
                                                <button
                                                    className="secondary"
                                                    disabled={busy}
                                                    onClick={() => setDeleteEmoji(null)}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    className="secondary danger-text"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void act(async () => {
                                                            await api(`/emojis/${e.id}`, 'DELETE');
                                                            setDeleteEmoji(null);
                                                            await refresh();
                                                        })
                                                    }
                                                >
                                                    Delete emoji
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                title={`Delete ${e.name}`}
                                                disabled={busy}
                                                onClick={() => setDeleteEmoji(e.id)}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        ))}
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
                            background for DMs and channel activity you choose below. Message text
                            stays out of notifications.
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
                        <Toggle
                            title="Soft message notification sound"
                            value={prefs.messageSounds !== false}
                            set={(value) =>
                                setPrefs((previous) => ({ ...previous, messageSounds: value }))
                            }
                        />
                        <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => void act(testNotificationSound)}
                        >
                            Test notification sound
                        </button>
                        <Toggle
                            title="Notify for direct messages"
                            value={prefs.dmNotifications !== false}
                            set={(value) =>
                                setPrefs((previous) => ({ ...previous, dmNotifications: value }))
                            }
                        />
                        <Toggle
                            title="Notify for direct @mentions"
                            value={prefs.mentionNotifications !== false}
                            set={(value) =>
                                setPrefs((previous) => ({
                                    ...previous,
                                    mentionNotifications: value,
                                }))
                            }
                        />
                        <p className="muted">
                            Do not disturb silences message sounds and desktop notifications. Sounds
                            use your selected audio output. Browser clients may require an initial
                            click; use Test notification sound to check playback. These preferences
                            are saved on this device; conversation overrides below apply to your
                            current account on this server.
                        </p>
                        <Toggle
                            title={`Mute ${state.name}`}
                            value={
                                prefs.serverNotifications?.[
                                    notificationKey(url, state.me.id, '*')
                                ] === false
                            }
                            set={(muted) =>
                                setPrefs((previous) => ({
                                    ...previous,
                                    serverNotifications: {
                                        ...previous.serverNotifications,
                                        [notificationKey(url, state.me.id, '*')]: !muted,
                                    },
                                }))
                            }
                        />
                        <p className="muted">
                            Server mute silences message sounds and desktop alerts, including direct
                            messages. Unread indicators remain visible.
                        </p>
                        <h3>Text channels</h3>
                        <p className="muted">
                            Choose All messages, Mentions only, or Muted for each channel. These
                            choices include thread replies. Mentions only uses the @mention
                            preference above; All messages includes every message. Server mute and
                            Do not disturb silence all modes. Unread indicators remain visible.
                        </p>
                        {state.channels
                            .filter((channel) => channel.kind === 'text')
                            .map((channel) => {
                                const key = notificationKey(url, state.me.id, channel.id);
                                return (
                                    <ChannelNotificationSelect
                                        key={key}
                                        label={`#${channel.name} notifications`}
                                        mode={channelNotificationMode(
                                            prefs.channelNotifications?.[key],
                                        )}
                                        onChange={(value) =>
                                            setPrefs((previous) => ({
                                                ...previous,
                                                channelNotifications: {
                                                    ...previous.channelNotifications,
                                                    [key]: value,
                                                },
                                            }))
                                        }
                                    />
                                );
                            })}
                        <details className="dm-notification-settings">
                            <summary>Individual direct messages</summary>
                            {state.users
                                .filter((candidate) => candidate.id !== state.me.id)
                                .map((candidate) => {
                                    const key = notificationKey(
                                        url,
                                        state.me.id,
                                        canonicalRoom(`dm:${state.me.id}:${candidate.id}`),
                                    );
                                    return (
                                        <Toggle
                                            key={key}
                                            title={`@${candidate.username} notifications`}
                                            value={
                                                channelNotificationMode(
                                                    prefs.channelNotifications?.[key],
                                                ) !== 'muted'
                                            }
                                            set={(value) =>
                                                setPrefs((previous) => ({
                                                    ...previous,
                                                    channelNotifications: {
                                                        ...previous.channelNotifications,
                                                        [key]: value,
                                                    },
                                                }))
                                            }
                                        />
                                    );
                                })}
                        </details>
                    </>
                )}
                {settingsTab === 'account' && (
                    <p className="muted">
                        Shortcuts: Ctrl/Cmd + F searches messages · Ctrl/Cmd + , opens settings ·
                        Ctrl/Cmd + Shift + M mutes your microphone · Ctrl/Cmd + Shift + D deafens.
                        Type : for emoji suggestions; use arrows and Enter or Tab to choose.
                    </p>
                )}
                {settingsTab === 'account' && window.campfire && (
                    <Toggle
                        title="Close to system tray"
                        value={prefs.closeToTray !== false}
                        set={(value) =>
                            setPrefs((previous) => ({ ...previous, closeToTray: value }))
                        }
                    />
                )}
                {settingsTab === 'server' && (
                    <>
                        <p className="muted">
                            Server management follows your combined role permissions. Role
                            assignments and member moderation can be delegated independently.
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
                                    disabled={!permission('server.edit')}
                                />
                            </label>
                            <button
                                className="primary"
                                disabled={!permission('server.edit') || busy}
                            >
                                Save changes
                            </button>
                        </form>
                        {permission('server.edit') && (
                            <>
                                <label>
                                    Server icon
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp,image/gif"
                                        disabled={busy}
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            event.target.value = '';
                                            if (file) setServerIconFile(file);
                                        }}
                                    />
                                </label>
                                {state.icon && (
                                    <>
                                        <img
                                            className="server-icon-preview"
                                            src={`data:image/png;base64,${state.icon}`}
                                            alt="Server icon"
                                        />
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                const bytes = Uint8Array.from(
                                                    atob(state.icon!),
                                                    (character) => character.charCodeAt(0),
                                                );
                                                setServerIconFile(
                                                    new File([bytes], 'server-icon.png', {
                                                        type: 'image/png',
                                                    }),
                                                );
                                            }}
                                        >
                                            Adjust server icon
                                        </button>
                                        <button
                                            disabled={busy}
                                            onClick={() =>
                                                void act(async () => {
                                                    await api('/settings', 'PATCH', { icon: null });
                                                    await refresh();
                                                })
                                            }
                                        >
                                            Remove icon
                                        </button>
                                    </>
                                )}
                                <Toggle
                                    title="Show who reacted to messages"
                                    value={state.reactionAuthors !== false}
                                    set={(value) =>
                                        void act(async () => {
                                            await api('/settings', 'PATCH', {
                                                reactionAuthors: value,
                                            });
                                            await refresh();
                                        })
                                    }
                                />
                                <p className="muted">
                                    Show who reacted in a popup on hover or keyboard focus. Each
                                    text channel can also disable names in Channels. This controls
                                    display for everyone on this server.
                                </p>
                            </>
                        )}
                        {(state.me.owner ||
                            permission('invitations.create') ||
                            permission('invitations.manage')) && (
                            <RegistrationSettings
                                api={api}
                                url={url}
                                pin={pin}
                                owner={state.me.owner}
                                canCreate={permission('invitations.create')}
                                canManage={permission('invitations.manage')}
                            />
                        )}
                        {(permission('members.ban') || permission('members.restore')) && (
                            <section className="server-members">
                                <h3>Manage members</h3>
                                {state.users
                                    .filter(
                                        (u) =>
                                            !u.owner &&
                                            u.id !== state.me.id &&
                                            highestPosition(state.me, state.roles) >
                                                highestPosition(u, state.roles),
                                    )
                                    .map((u) => (
                                        <div key={u.id} className="server-member-row">
                                            <span>{displayName(u)}</span>
                                            {removeUser !== u.id ? (
                                                <button
                                                    className="danger-text"
                                                    disabled={busy || !permission('members.ban')}
                                                    onClick={() => setRemoveUser(u.id)}
                                                >
                                                    Remove member
                                                </button>
                                            ) : (
                                                <div role="alert">
                                                    <p>
                                                        Remove {displayName(u)} from this server?
                                                        Their messages remain, all sessions end, and
                                                        access is blocked until you restore it.
                                                    </p>
                                                    <button
                                                        disabled={busy}
                                                        onClick={() => setRemoveUser(null)}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        className="danger-bg"
                                                        disabled={busy}
                                                        onClick={() =>
                                                            void act(async () => {
                                                                await api(
                                                                    `/users/${u.id}/access`,
                                                                    'POST',
                                                                    { enabled: false },
                                                                );
                                                                setRemoveUser(null);
                                                                await refresh();
                                                            })
                                                        }
                                                    >
                                                        Confirm removal
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                {state.removedUsers
                                    ?.filter(
                                        (u) =>
                                            highestPosition(state.me, state.roles) >
                                            highestPosition(u, state.roles),
                                    )
                                    .map((u) => (
                                        <div key={u.id} className="server-member-row">
                                            <span>{displayName(u)} · Removed</span>
                                            <button
                                                disabled={busy || !permission('members.restore')}
                                                onClick={() =>
                                                    void act(async () => {
                                                        await api(`/users/${u.id}/access`, 'POST', {
                                                            enabled: true,
                                                        });
                                                        await refresh();
                                                    })
                                                }
                                            >
                                                Restore access
                                            </button>
                                        </div>
                                    ))}
                            </section>
                        )}
                        <label>
                            Server address
                            <input readOnly value={url} />
                        </label>
                        {(pin || reportedPin) && (
                            <div className="server-identity">
                                <span className="field-help">
                                    {pin
                                        ? 'Server fingerprint, verified by this device'
                                        : 'Server fingerprint reported by the server. Compare it with the server console before sharing it.'}
                                </span>
                                <code className="fingerprint">
                                    {formatFingerprint(pin || reportedPin!)}
                                </code>
                            </div>
                        )}
                        {pin && reportedPin && pin !== reportedPin && (
                            <p role="alert">
                                The server reports a different fingerprint than the one this device
                                verified. Don’t share links until the owner has checked the server.
                            </p>
                        )}
                        <button className="secondary" disabled={busy} onClick={copyServerLink}>
                            Copy server link
                        </button>
                        <p className="muted">
                            {pin
                                ? 'The link includes the server fingerprint, so the desktop app verifies this server from the first connection.'
                                : url.startsWith('http:')
                                  ? 'This is a local development server; its connection is not encrypted.'
                                  : window.campfire
                                    ? 'This server uses a certificate from a trusted authority, so its link needs no fingerprint.'
                                    : 'Links copied in a browser don’t include the fingerprint. Copy links from the desktop app or the server console so new members are protected from their first connection.'}
                        </p>
                        <p className="muted">
                            For calls over the internet, your server may need a relay service. See
                            the hosting guide.
                        </p>
                    </>
                )}
                {settingsTab === 'channels' &&
                    [
                        'channels.edit',
                        'channels.access',
                        'channels.create',
                        'channels.delete',
                        'channels.reorder',
                    ].some(permission) && (
                        <ChannelSettings
                            permission={permission}
                            state={state}
                            api={api}
                            refresh={refresh}
                            busy={busy}
                            act={act}
                        />
                    )}
                {settingsTab === 'roles' && (
                    <RolesSettings
                        state={state}
                        api={api}
                        busy={busy}
                        act={act}
                        refresh={refresh}
                        edit={(id) => setModal(`role:${id}`)}
                    />
                )}

                <button
                    className="settings-mobile-signout secondary danger-text"
                    onClick={() => void logout()}
                >
                    <LogOut size={16} /> Sign out
                </button>
            </div>
            {serverIconFile && (
                <AvatarCropper
                    file={serverIconFile}
                    size={256}
                    variant="server"
                    onSave={async (icon) => {
                        await api('/settings', 'PATCH', { icon });
                        await refresh();
                    }}
                    onClose={() => setServerIconFile(null)}
                />
            )}
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
