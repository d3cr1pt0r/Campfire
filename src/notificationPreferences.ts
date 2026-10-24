import type { NotificationPreferences, Preferences } from './types';
import {
    explicitNotificationMode,
    notificationKey,
    serverNotificationMode,
} from './notifications.ts';

export function notificationPreferences(
    prefs: Preferences,
    server: string,
    user: string,
): NotificationPreferences {
    const scopes = (entries: Record<string, unknown> = {}) =>
        Object.fromEntries(
            Object.entries(entries).flatMap(([key, mode]) => {
                try {
                    const parsed = JSON.parse(key);
                    return Array.isArray(parsed) &&
                        parsed.length === 3 &&
                        notificationKey(server, user, parsed[2]) === key &&
                        explicitNotificationMode(mode)
                        ? [[parsed[2], mode]]
                        : [];
                } catch {
                    return [];
                }
            }),
        );
    return {
        muted: prefs.serverNotifications?.[notificationKey(server, user, '*')] === false,
        directMessages: prefs.dmNotifications !== false,
        reactions: prefs.reactionNotifications?.[notificationKey(server, user, '*')] !== false,
        defaultMode: serverNotificationMode(prefs, server, user),
        channels: scopes(prefs.channelNotifications),
        categories: scopes(prefs.categoryNotifications),
    } as NotificationPreferences;
}

export function withNotificationPreferences(
    prefs: Preferences,
    value: NotificationPreferences | null | undefined,
    server: string,
    user: string,
): Preferences {
    if (!value) return prefs;
    const replace = (previous: Record<string, unknown> = {}, entries: Record<string, unknown>) => ({
        ...Object.fromEntries(
            Object.entries(previous).filter(([key]) => {
                try {
                    const parsed = JSON.parse(key);
                    return notificationKey(server, user, parsed[2]) !== key;
                } catch {
                    return true;
                }
            }),
        ),
        ...Object.fromEntries(
            Object.entries(entries).map(([scope, mode]) => [
                notificationKey(server, user, scope),
                mode,
            ]),
        ),
    });
    return {
        ...prefs,
        dmNotifications: value.directMessages,
        reactionNotifications: {
            ...prefs.reactionNotifications,
            [notificationKey(server, user, '*')]: value.reactions !== false,
        },
        serverNotifications: {
            ...prefs.serverNotifications,
            [notificationKey(server, user, '*')]: !value.muted,
        },
        serverNotificationModes: {
            ...prefs.serverNotificationModes,
            [notificationKey(server, user, '*')]: value.defaultMode,
        },
        channelNotifications: replace(prefs.channelNotifications, value.channels),
        categoryNotifications: replace(prefs.categoryNotifications, value.categories),
    } as Preferences;
}
