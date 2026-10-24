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

const modeNames = { all: 'All messages', mentions: 'Mentions & reactions', muted: 'Nothing' };
type Props = {
    state: State;
    prefs: Preferences;
    setPrefs: Dispatch<SetStateAction<Preferences>>;
    url: string;
    busy: boolean;
    act: (action: () => Promise<unknown>) => Promise<void>;
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
            <section className="settings-section" aria-label="Visual alerts">
                <h3>Visual alerts</h3>
                <p className="muted">
                    Popups while Campfire is in the background. Saved on this device.
                </p>
                <Toggle
                    title="Show desktop popups"
                    value={prefs.notifications}
                    disabled={busy || permission === 'unsupported'}
                    set={(enabled) =>
                        void act(async () => {
                            if (enabled) {
                                if (typeof Notification === 'undefined')
                                    throw new Error('Desktop popups are unavailable.');
                                const result = await Notification.requestPermission();
                                setPermission(result);
                                if (result !== 'granted')
                                    throw new Error(
                                        'Allow notifications in your system or browser settings.',
                                    );
                            }
                            setPrefs((previous) => ({ ...previous, notifications: enabled }));
                        })
                    }
                />
                {permission !== 'granted' && (
                    <p className="field-help" role="status">
                        {permission === 'unsupported'
                            ? 'Unavailable in this client.'
                            : permission === 'denied'
                              ? 'Desktop popups are blocked. Allow them in system or browser settings.'
                              : 'Turn on to request permission.'}
                    </p>
                )}
            </section>
            <section className="settings-section" aria-label="Sounds">
                <h3>Sounds</h3>
                <p className="muted">Message and reaction sounds on this device.</p>
                <div className="notification-sound-row">
                    <Toggle
                        title="Play message and reaction sounds"
                        value={prefs.messageSounds !== false}
                        set={(value) =>
                            setPrefs((previous) => ({ ...previous, messageSounds: value }))
                        }
                    />
                </div>
                <div className="notification-delivery-footer">
                    <button className="permission-link" onClick={() => openSettings('audio')}>
                        Audio output &amp; volume →
                    </button>
                </div>
            </section>
            <section className="settings-section" aria-label="What triggers alerts">
                <h3>What triggers alerts</h3>
                <p className="muted">
                    These rules apply to desktop popups and sounds. They sync across devices.
                </p>
                <p className="field-help">
                    Unread badges and jump highlights stay on when alerts are off.
                </p>
                {state.me.status === 'dnd' && (
                    <p className="notification-status" role="status">
                        Do not disturb is on. Popups and sounds are paused.{' '}
                        <button className="permission-link" onClick={() => openSettings('account')}>
                            Change status →
                        </button>
                    </p>
                )}
                <section
                    className="notification-rule-group"
                    aria-label="Server notification defaults"
                >
                    <h4>{state.name}</h4>
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
                        Turns off popups and sounds for messages, DMs, and calls.
                    </p>
                    {muted && (
                        <p className="notification-status" role="status">
                            This server is muted. Unmute to receive alerts.
                        </p>
                    )}
                    <fieldset className="notification-mode-options">
                        <legend>Default channel rule</legend>
                        {(
                            [
                                ['all', 'Every message and reactions to your messages.'],
                                ['mentions', 'Direct @mentions and reactions to your messages.'],
                                ['muted', 'No popups or sounds from channels or threads.'],
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
                <section
                    className="notification-rule-group"
                    aria-label="Channel and category rules"
                >
                    <h4>Channel and category rules</h4>
                    <p className="muted">
                        Channels use their category’s rule, then the server default.
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
                <section
                    className="notification-rule-group"
                    aria-label="Direct message notifications"
                >
                    <h4>Direct messages</h4>
                    <Toggle
                        title="Alert for direct messages"
                        value={prefs.dmNotifications !== false}
                        set={(value) =>
                            setPrefs((previous) => ({ ...previous, dmNotifications: value }))
                        }
                    />
                    <p className="field-help">
                        Includes reactions to your messages. Set a different rule for any
                        conversation below.
                    </p>
                    <details className="account-details dm-notification-settings">
                        <summary>Conversation rules</summary>
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
                                            override === 'mentions'
                                                ? 'inherit'
                                                : override || 'inherit'
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
                        {!dmUsers.length && (
                            <p className="field-help">No members match your search.</p>
                        )}
                    </details>
                </section>
            </section>
        </div>
    );
}
