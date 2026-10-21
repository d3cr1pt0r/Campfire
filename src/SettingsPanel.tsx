import { MessageAppearanceSettings } from './MessageAppearanceSettings';
import { RolesSettings } from './RolesSettings';
import { MemberManagement } from './MemberManagement';
import { RegistrationSettings } from './RegistrationSettings';
import { notificationKey, channelNotificationMode } from './notifications';
import { ChannelNotificationSelect } from './ChannelNotificationSelect';
import { canonicalRoom } from '../shared/rooms.js';
import { formatUploadLimit, uploadLimitCeiling } from '../shared/uploads.js';
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
import { AudioVideoSettings } from './AudioVideoSettings';
import { Toggle } from './forms';
import type { AvatarFrame } from '../shared/frames.js';
// None leads the static frames so "no frame" stays the first choice.
const frameGroups: [string, [AvatarFrame | null, string][]][] = [
    [
        'Static',
        [
            [null, 'None'],
            ['gold', 'Gold'],
            ['silver', 'Silver'],
            ['rosegold', 'Rose gold'],
            ['obsidian', 'Obsidian'],
            ['pearl', 'Pearl'],
            ['jade', 'Jade'],
            ['sunset', 'Sunset'],
            ['spectrum', 'Spectrum'],
        ],
    ],
    [
        'Animated',
        [
            ['ember', 'Ember'],
            ['fireflies', 'Fireflies'],
            ['aurora', 'Aurora'],
            ['gilded', 'Gilded'],
            ['frost', 'Frost'],
            ['storm', 'Storm'],
            ['tide', 'Tide'],
            ['lanterns', 'Lanterns'],
            ['breath', 'Breath'],
            ['stardust', 'Stardust'],
            ['bubbles', 'Bubbles'],
            ['wisps', 'Wisps'],
            ['dandelion', 'Dandelion'],
            ['smoke', 'Smoke'],
            ['magma', 'Magma'],
            ['autumn', 'Autumn'],
            ['meteors', 'Meteors'],
            ['honey', 'Honey'],
        ],
    ],
];
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
        ['audio', 'Audio & Video'],
        ['notifications', 'Notifications'],
        ['server', 'Server settings'],
        ['roles', 'Roles & permissions'],
        ...([
            'channels.edit',
            'channels.access',
            'channels.create',
            'channels.delete',
            'channels.reorder',
        ].some(permission)
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
                        <MessageAppearanceSettings
                            prefs={prefs}
                            setPrefs={setPrefs}
                            user={state.me}
                            color={color(state.me)}
                        />
                    </>
                )}
                {settingsTab === 'account' && (
                    <div className="account-settings">
                        <section className="account-section account-profile" aria-label="Profile">
                            <div className="account-profile-overview">
                                <div className="profile-card">
                                    <Avatar
                                        user={state.me}
                                        color={color(state.me)}
                                        frame={state.me.frame}
                                    />
                                    <div>
                                        <h3>{displayName(state.me)}</h3>
                                        <p>
                                            {state.me.owner
                                                ? 'Owner'
                                                : state.roles
                                                      .filter((role) =>
                                                          state.me.roles.includes(role.id),
                                                      )
                                                      .map((role) => role.name)
                                                      .join(' · ') ||
                                                  state.roles.find((role) => role.id === 'everyone')
                                                      ?.name ||
                                                  'Default'}
                                        </p>
                                    </div>
                                </div>
                                <label className="account-status">
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
                            </div>
                            <p className="field-help">
                                Do not disturb silences message sounds and desktop alerts.
                            </p>
                            <form
                                className="account-nickname-form"
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
                                    <small className="field-help">Permanent sign-in name.</small>
                                </label>
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
                            <div className="account-picture-actions">
                                <label className="secondary account-picture-upload">
                                    Upload profile picture
                                    <input
                                        type="file"
                                        className="sr-only"
                                        accept="image/png,image/jpeg,image/webp,image/gif"
                                        disabled={busy}
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) setAvatarFile(file);
                                            e.target.value = '';
                                        }}
                                    />
                                </label>
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
                            </div>
                            <p className="field-help">
                                Choose your crop before saving. Upload the original again to restore
                                an earlier crop.
                            </p>{' '}
                            {state.profileFrames === false ? (
                                <p className="muted">
                                    Profile frames are turned off on this server.
                                </p>
                            ) : (
                                <details className="account-details account-frames">
                                    <summary>
                                        <span>Profile frame</span>
                                        <small>
                                            {frameGroups
                                                .flatMap(([, frames]) => frames)
                                                .find(
                                                    ([frame]) => frame === (state.me.frame ?? null),
                                                )?.[1] || 'None'}
                                        </small>
                                    </summary>
                                    <fieldset className="frame-options">
                                        <legend>Profile frame</legend>
                                        {frameGroups.map(([group, frames]) => (
                                            <div className="frame-group" key={group}>
                                                <h4>{group}</h4>
                                                <div className="frame-grid">
                                                    {frames.map(([frame, title]) => (
                                                        <label className="frame-choice" key={title}>
                                                            <Avatar
                                                                user={state.me}
                                                                color={color(state.me)}
                                                                frame={frame}
                                                            />
                                                            <strong>{title}</strong>
                                                            <input
                                                                type="radio"
                                                                name="frame"
                                                                checked={
                                                                    (state.me.frame ?? null) ===
                                                                    frame
                                                                }
                                                                disabled={busy}
                                                                onChange={() =>
                                                                    void act(async () => {
                                                                        await api(
                                                                            '/profile',
                                                                            'PATCH',
                                                                            {
                                                                                frame,
                                                                            },
                                                                        );
                                                                        await refresh();
                                                                    })
                                                                }
                                                            />
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </fieldset>
                                    <p className="muted">
                                        Everyone sees your frame in the member list. Animated frames
                                        move there when someone hovers over you.
                                    </p>
                                </details>
                            )}
                        </section>
                        <section
                            className="account-section account-behavior"
                            aria-labelledby="account-behavior-title"
                        >
                            <h3 id="account-behavior-title">Behavior</h3>
                            <p className="field-help">Saved automatically on this device.</p>
                            {window.campfire && (
                                <Toggle
                                    title="Close to system tray"
                                    value={prefs.closeToTray !== false}
                                    set={(value) =>
                                        setPrefs((previous) => ({
                                            ...previous,
                                            closeToTray: value,
                                        }))
                                    }
                                />
                            )}
                            <Toggle
                                title="Set Idle automatically when I’m away"
                                value={!!prefs.autoIdle}
                                set={(autoIdle) =>
                                    setPrefs((previous) => ({ ...previous, autoIdle }))
                                }
                            />
                            {prefs.autoIdle && (
                                <label className="account-idle-delay">
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
                                Returns to Online when activity resumes. Manual Idle and Do not
                                disturb stay selected. Uses computer activity when supported,
                                otherwise activity in this app.
                            </p>
                        </section>
                        <section className="account-section">
                            <details className="account-details account-security">
                                <summary>
                                    <span>Password & security</span>
                                    <small>Change password</small>
                                </summary>
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
                                            notify(
                                                'Password changed. Your other devices were signed out.',
                                            );
                                        });
                                    }}
                                >
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
                                            minLength={8}
                                            maxLength={128}
                                            required
                                            placeholder="At least 8 characters"
                                        />
                                    </label>
                                    <label>
                                        Confirm new password
                                        <input
                                            name="confirm"
                                            type="password"
                                            autoComplete="new-password"
                                            minLength={8}
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
                            </details>
                        </section>
                        <section
                            className="account-section account-connection"
                            aria-labelledby="account-connection-title"
                        >
                            <h3 id="account-connection-title">Connection</h3>
                            <label>
                                Server address
                                <input value={url} readOnly />
                            </label>
                            <p className="muted">
                                Accounts and messages belong to this server. Sessions expire after
                                30 days.
                            </p>
                            <button className="secondary" onClick={() => setModal('switch')}>
                                Connect to another server <ArrowRight size={16} />
                            </button>
                        </section>
                        <details className="account-section account-details account-shortcuts">
                            <summary>Keyboard shortcuts</summary>
                            <p className="muted">
                                Shortcuts: Ctrl/Cmd + F searches messages · Ctrl/Cmd + , opens
                                settings · Ctrl/Cmd + Shift + M mutes your microphone · Ctrl/Cmd +
                                Shift + D deafens. Type : for emoji suggestions; use arrows and
                                Enter or Tab to choose.
                            </p>{' '}
                        </details>
                    </div>
                )}
                {settingsTab === 'audio' && (
                    <AudioVideoSettings
                        prefs={prefs}
                        setPrefs={setPrefs}
                        devices={devices}
                        setDevices={setDevices}
                        notify={notify}
                        inCall={!!call.channel}
                        activeStream={call.channel ? call.microphonePreview : null}
                    />
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
                            title="Message notification sound"
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
                                    await api('/settings', 'PATCH', {
                                        name: f.get('name'),
                                        // Servers from before the setting do not report a limit.
                                        ...(state.maxUploadBytes === undefined
                                            ? {}
                                            : {
                                                  maxUploadBytes:
                                                      Number(f.get('maxUploadMegabytes')) *
                                                      1024 *
                                                      1024,
                                              }),
                                    });
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
                            {state.maxUploadBytes !== undefined && (
                                <label>
                                    Maximum upload size (MB)
                                    <input
                                        key={state.maxUploadBytes}
                                        name="maxUploadMegabytes"
                                        type="number"
                                        min={1}
                                        max={uploadLimitCeiling / (1024 * 1024)}
                                        step={1}
                                        required
                                        defaultValue={state.maxUploadBytes / (1024 * 1024)}
                                        disabled={!permission('server.edit')}
                                    />
                                    <small className="field-help">
                                        Combined size of the files in one message, up to{' '}
                                        {formatUploadLimit(uploadLimitCeiling)}. Larger uploads use
                                        more server memory and storage.
                                    </small>
                                </label>
                            )}
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
                                <h3>Features</h3>
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
                                <Toggle
                                    title="Profile frames"
                                    value={state.profileFrames !== false}
                                    set={(value) =>
                                        void act(async () => {
                                            await api('/settings', 'PATCH', {
                                                profileFrames: value,
                                            });
                                            await refresh();
                                        })
                                    }
                                />
                                <p className="muted">
                                    Let members decorate their profile picture with a frame. Turn
                                    this off for a more formal server. Members keep their choice,
                                    and it returns if you turn frames back on.
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
                        {[
                            'members.ban',
                            'members.restore',
                            'members.resetPassword',
                            'members.delete',
                        ].some(permission) && (
                            <MemberManagement
                                state={state}
                                permission={permission}
                                busy={busy}
                                act={act}
                                api={api}
                                refresh={refresh}
                                notify={notify}
                            />
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
                            create={(kind) => setModal(`channel:${kind}`)}
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
