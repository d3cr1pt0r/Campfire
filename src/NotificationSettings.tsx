import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Hash, Lock } from 'lucide-react';
import { ChannelTree } from './ChannelTree';
import { MemberIdentity } from './MemberIdentity';
import type { ApiClient } from './api';
import type { ChannelNotificationMode, Preferences, State } from './types';
import { Toggle } from './forms';
import { ChannelNotificationSelect } from './ChannelNotificationSelect';
import {
    effectiveChannelNotificationMode,
    explicitNotificationMode,
    notificationKey,
    serverNotificationMode,
} from './notifications';
import { canonicalRoom } from '../shared/rooms.js';
import { displayName } from './profiles';

const modeNames = { all: 'All messages', mentions: 'Mentions only', muted: 'Nothing' };
type Props = {
    state: State;
    prefs: Preferences;
    setPrefs: Dispatch<SetStateAction<Preferences>>;
    url: string;
    busy: boolean;
    act: (action: () => Promise<unknown>) => Promise<void>;
    testSound: () => Promise<void>;
    openSettings: (section: string) => void;
    api: ApiClient;
    refresh: () => Promise<void>;
    permission: (id: string) => boolean;
};
export function NotificationSettings({
    state,
    prefs,
    setPrefs,
    url,
    busy,
    act,
    testSound,
    openSettings,
    api,
    refresh,
    permission: can,
}: Props) {
    const [permission, setPermission] = useState(
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    );
    const [dmQuery, setDmQuery] = useState('');
    useEffect(() => {
        const update = () =>
            setPermission(
                typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
            );
        window.addEventListener('focus', update);
        return () => window.removeEventListener('focus', update);
    }, []);
    const key = (scope: string) => notificationKey(url, state.me.id, scope);
    const muted = prefs.serverNotifications?.[key('*')] === false;
    const serverMode = serverNotificationMode(prefs, url, state.me.id);
    const updateOverride = (
        field: 'channelNotifications' | 'categoryNotifications',
        scope: string,
        value: ChannelNotificationMode | 'inherit',
    ) =>
        setPrefs((previous) => {
            const overrides = { ...previous[field] };
            if (value === 'inherit') delete overrides[key(scope)];
            else overrides[key(scope)] = value;
            return { ...previous, [field]: overrides };
        });
    const notificationMode = (
        kind: 'category' | 'channel',
        id: string,
        name: string,
        category?: string | null,
    ) => {
        const field = kind === 'category' ? 'categoryNotifications' : 'channelNotifications';
        const inherited =
            kind === 'category'
                ? serverMode
                : effectiveChannelNotificationMode(
                      { ...prefs, channelNotifications: {} },
                      url,
                      state.me.id,
                      id,
                      category,
                  );
        const categoryOverride =
            kind === 'channel' &&
            category &&
            explicitNotificationMode(prefs.categoryNotifications?.[key(category)]);
        return (
            <ChannelNotificationSelect
                label={
                    kind === 'category'
                        ? name + ' category notifications'
                        : '#' + name + ' notifications'
                }
                mode={explicitNotificationMode(prefs[field]?.[key(id)]) || 'inherit'}
                inheritLabel={
                    'Use ' +
                    (categoryOverride ? 'category' : 'server') +
                    ' default · ' +
                    modeNames[inherited]
                }
                onChange={(value) => updateOverride(field, id, value)}
            />
        );
    };
    const dmUsers = state.users.filter(
        (user) =>
            user.id !== state.me.id &&
            (displayName(user) + ' ' + user.username)
                .toLowerCase()
                .includes(dmQuery.trim().toLowerCase()),
    );
    return (
        <div className="settings-page notification-settings">
            <section className="settings-section" aria-label="Notification delivery">
                <h3>Notification delivery</h3>
                <p className="muted">
                    Desktop alerts and sound settings are saved on this device. Server and
                    conversation notification choices sync across devices for this account.
                </p>
                <Toggle
                    title="Desktop notifications"
                    value={prefs.notifications}
                    disabled={busy || permission === 'unsupported'}
                    set={(enabled) =>
                        void act(async () => {
                            if (enabled) {
                                if (typeof Notification === 'undefined')
                                    throw new Error('Desktop notifications are unavailable.');
                                const result = await Notification.requestPermission();
                                setPermission(result);
                                if (result !== 'granted')
                                    throw new Error(
                                        'Notifications were not allowed. Check your operating system or browser settings.',
                                    );
                            }
                            setPrefs((previous) => ({ ...previous, notifications: enabled }));
                        })
                    }
                />
                <p className="field-help" role="status">
                    {permission === 'unsupported'
                        ? 'Desktop alerts are unavailable in this client.'
                        : permission === 'denied'
                          ? 'Desktop alerts are blocked. Allow them in your operating system or browser settings.'
                          : permission === 'granted'
                            ? 'Desktop permission is allowed. Alerts appear while Campfire is in the background.'
                            : 'Enable desktop notifications to request permission.'}{' '}
                    Message text stays out of desktop alerts.
                </p>
                <div className="notification-sound-row">
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
                        onClick={() => void act(testSound)}
                    >
                        Test notification sound
                    </button>
                </div>
                <div className="notification-delivery-footer">
                    <p className="field-help">
                        The open conversation stays quiet while the window is visible and focused.
                        Other conversations can still sound.
                    </p>
                    <button className="permission-link" onClick={() => openSettings('audio')}>
                        Audio output &amp; volume →
                    </button>
                </div>
                {state.me.status === 'dnd' && (
                    <p className="notification-status" role="status">
                        Do not disturb is active. Message alerts and incoming calls are silent.{' '}
                        <button className="permission-link" onClick={() => openSettings('account')}>
                            Change status →
                        </button>
                    </p>
                )}
            </section>
            <section className="settings-section" aria-label="Server notification defaults">
                <h3>{state.name}</h3>
                <Toggle
                    title={'Mute ' + state.name}
                    value={muted}
                    set={(value) =>
                        setPrefs((previous) => ({
                            ...previous,
                            serverNotifications: {
                                ...previous.serverNotifications,
                                [key('*')]: !value,
                            },
                        }))
                    }
                />
                <p className="field-help">
                    Mute silences this server’s messages, direct messages, and incoming calls.
                    Unread indicators stay visible.
                </p>
                {muted && (
                    <p className="notification-status" role="status">
                        This server is muted. Your choices below apply when you unmute it.
                    </p>
                )}
                <fieldset className="notification-mode-options">
                    <legend>Default channel notifications</legend>
                    {(
                        [
                            ['all', 'Every message in channels and their threads.'],
                            ['mentions', 'Only messages that directly @mention you.'],
                            ['muted', 'No channel alerts, including mentions.'],
                        ] as const
                    ).map(([mode, description]) => (
                        <label
                            className={
                                'notification-mode-option ' +
                                (serverMode === mode ? 'is-selected' : '')
                            }
                            key={mode}
                        >
                            <input
                                type="radio"
                                name="server-notification-mode"
                                value={mode}
                                checked={serverMode === mode}
                                onChange={() =>
                                    setPrefs((previous) => ({
                                        ...previous,
                                        serverNotificationModes: {
                                            ...previous.serverNotificationModes,
                                            [key('*')]: mode,
                                        },
                                    }))
                                }
                            />
                            <span>
                                <strong>{modeNames[mode]}</strong>
                                <small>{description}</small>
                            </span>
                        </label>
                    ))}
                </fieldset>
            </section>
            <section className="settings-section" aria-label="Notification overrides">
                <h3>Notification overrides</h3>
                <p className="muted">
                    Text channels follow their category, then the server default. Choose an option
                    on the right, or return to the inherited default. These choices do not change
                    channel access.
                </p>
                <ChannelTree
                    mode="notifications"
                    state={{
                        ...state,
                        channels: state.channels.filter((channel) => channel.kind === 'text'),
                    }}
                    api={api}
                    refresh={refresh}
                    permission={can}
                    busy={busy}
                    renderCategoryControl={(category) =>
                        notificationMode('category', category.id, category.name)
                    }
                    renderChannel={(channel) => (
                        <>
                            <span className="notification-channel-name">
                                <Hash size={15} />
                                <span>{channel.name}</span>
                                {channel.private && <Lock size={11} />}
                            </span>
                            {notificationMode(
                                'channel',
                                channel.id,
                                channel.name,
                                channel.category,
                            )}
                        </>
                    )}
                />
            </section>
            <section className="settings-section" aria-label="Direct message notifications">
                <h3>Direct messages</h3>
                <Toggle
                    title="Notify for direct messages"
                    value={prefs.dmNotifications !== false}
                    set={(value) =>
                        setPrefs((previous) => ({ ...previous, dmNotifications: value }))
                    }
                />
                <p className="field-help">
                    Default for conversations without an override. Channel and category notification
                    levels do not apply to DMs. Server mute and Do not disturb still silence them.
                </p>
                <details className="account-details dm-notification-settings">
                    <summary>Conversation overrides</summary>
                    <label className="notification-search">
                        Find a member
                        <input
                            type="search"
                            value={dmQuery}
                            onChange={(event) => setDmQuery(event.target.value)}
                            placeholder="Name or username"
                        />
                    </label>
                    {dmUsers.map((user) => {
                        const room = canonicalRoom('dm:' + state.me.id + ':' + user.id);
                        const override = explicitNotificationMode(
                            prefs.channelNotifications?.[key(room)],
                        );
                        return (
                            <div className="member-preference-row" key={user.id}>
                                <MemberIdentity user={user} state={state} />
                                <ChannelNotificationSelect
                                    label={displayName(user) + ' DM notifications'}
                                    mode={
                                        override === 'mentions' ? 'inherit' : override || 'inherit'
                                    }
                                    directMessage
                                    inheritLabel={
                                        'Use DM default · ' +
                                        (prefs.dmNotifications === false
                                            ? 'Nothing'
                                            : 'All messages')
                                    }
                                    onChange={(value) =>
                                        updateOverride('channelNotifications', room, value)
                                    }
                                />
                            </div>
                        );
                    })}
                    {!dmUsers.length && <p className="field-help">No members match your search.</p>}
                </details>
            </section>
        </div>
    );
}
