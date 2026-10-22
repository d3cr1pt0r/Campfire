import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Hash, Folder, X } from 'lucide-react';
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
}: Props) {
    const [permission, setPermission] = useState(
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    );
    const addRef = useRef<HTMLSelectElement>(null);
    const [added, setAdded] = useState<string[]>([]);
    const [query, setQuery] = useState('');
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
    const targets = [
        ...(state.categories || []).map((category) => ({
            id: 'category:' + category.id,
            scope: category.id,
            name: category.name,
            label: 'Category · ' + category.name,
            category: null,
            kind: 'category' as const,
        })),
        ...state.channels
            .filter((channel) => channel.kind === 'text')
            .map((channel) => ({
                id: 'channel:' + channel.id,
                scope: channel.id,
                name: channel.name,
                label:
                    '#' +
                    channel.name +
                    (channel.category
                        ? ' · ' +
                          (state.categories?.find((category) => category.id === channel.category)
                              ?.name || 'Category')
                        : ''),
                category: channel.category,
                kind: 'channel' as const,
            })),
    ];
    const fieldFor = (kind: 'category' | 'channel') =>
        kind === 'category' ? 'categoryNotifications' : 'channelNotifications';
    const configured = targets.filter(
        (target) =>
            explicitNotificationMode(prefs[fieldFor(target.kind)]?.[key(target.scope)]) ||
            added.includes(target.id),
    );
    const available = targets.filter(
        (target) => !configured.some((entry) => entry.id === target.id),
    );
    const visible = configured.filter((target) =>
        target.label.toLowerCase().includes(query.trim().toLowerCase()),
    );
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
                    Saved on this device. Server and conversation choices are separate for each
                    account and server.
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
                    Channels follow their category, then the server default. Add an override only
                    where you want different alerts. These choices do not change channel access.
                </p>
                <label className="notification-add">
                    Add a channel or category
                    <select
                        ref={addRef}
                        aria-label="Add notification override"
                        value=""
                        onChange={(event) => {
                            const id = event.target.value;
                            if (id) setAdded((previous) => [...previous, id]);
                        }}
                        disabled={!available.length}
                    >
                        <option value="">
                            {available.length
                                ? 'Choose a channel or category…'
                                : 'All channels and categories are listed'}
                        </option>
                        {available.map((target) => (
                            <option key={target.id} value={target.id}>
                                {target.label}
                            </option>
                        ))}
                    </select>
                </label>
                {(configured.length > 3 || query) && (
                    <label className="notification-search">
                        Filter overrides
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Channel or category name"
                        />
                    </label>
                )}
                <div className="notification-overrides">
                    {!configured.length && (
                        <p className="field-help">
                            No overrides. All channels use the server default.
                        </p>
                    )}
                    {!!configured.length && !visible.length && (
                        <p className="field-help">No overrides match your search.</p>
                    )}
                    {visible.map((target) => {
                        const field = fieldFor(target.kind);
                        const inherited =
                            target.kind === 'category'
                                ? serverMode
                                : effectiveChannelNotificationMode(
                                      { ...prefs, channelNotifications: {} },
                                      url,
                                      state.me.id,
                                      target.scope,
                                      target.category,
                                  );
                        const categoryOverride =
                            target.kind === 'channel' &&
                            target.category &&
                            explicitNotificationMode(
                                prefs.categoryNotifications?.[key(target.category)],
                            );
                        return (
                            <div className="notification-override" key={target.id}>
                                <div className="notification-override-title">
                                    {target.kind === 'category' ? (
                                        <Folder size={15} />
                                    ) : (
                                        <Hash size={15} />
                                    )}
                                    <div>
                                        <strong>{target.name}</strong>
                                        <small>
                                            {target.kind === 'category'
                                                ? 'Category · Applies to its channels'
                                                : target.category
                                                  ? state.categories?.find(
                                                        (entry) => entry.id === target.category,
                                                    )?.name
                                                  : 'Uncategorized'}
                                        </small>
                                    </div>
                                </div>
                                <ChannelNotificationSelect
                                    label={
                                        target.kind === 'category'
                                            ? target.name + ' category notifications'
                                            : '#' + target.name + ' notifications'
                                    }
                                    mode={
                                        explicitNotificationMode(
                                            prefs[field]?.[key(target.scope)],
                                        ) || 'inherit'
                                    }
                                    inheritLabel={
                                        'Use ' +
                                        (categoryOverride ? 'category' : 'server') +
                                        ' default · ' +
                                        modeNames[inherited]
                                    }
                                    onChange={(value) => updateOverride(field, target.scope, value)}
                                />
                                <button
                                    className="notification-remove"
                                    aria-label={'Remove ' + target.label + ' override'}
                                    title="Remove override"
                                    onClick={() => {
                                        updateOverride(field, target.scope, 'inherit');
                                        setAdded((previous) =>
                                            previous.filter((id) => id !== target.id),
                                        );
                                        addRef.current?.focus();
                                    }}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        );
                    })}
                </div>
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
                            <ChannelNotificationSelect
                                key={user.id}
                                label={displayName(user) + ' DM notifications'}
                                mode={override === 'mentions' ? 'inherit' : override || 'inherit'}
                                directMessage
                                inheritLabel={
                                    'Use DM default · ' +
                                    (prefs.dmNotifications === false ? 'Nothing' : 'All messages')
                                }
                                onChange={(value) =>
                                    updateOverride('channelNotifications', room, value)
                                }
                            />
                        );
                    })}
                    {!dmUsers.length && <p className="field-help">No members match your search.</p>}
                </details>
            </section>
        </div>
    );
}
