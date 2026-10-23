# Notification settings

Open **Settings → Notifications**. Server mute, channel defaults, category rules, DM defaults, and conversation overrides save to your account on this server and sync across devices. Desktop-alert permission, sounds, volume, and output devices remain local. These choices do not change anyone else's settings or channel access. On first connection, existing local rules are imported only if the account has no saved rules.

## Missed messages and unread badges

Unread badges survive app and server restarts. Each server stores your read position for each conversation; messages received while the app is closed appear as unread when you reconnect. Reading or explicitly clearing a conversation synchronizes to your other devices. Restoring badges does not replay old sounds or desktop alerts.

Opening an unfiltered channel or DM while Campfire is visible and focused marks the loaded messages read. Incoming messages in that conversation stay quiet. Search and pinned-message views do not clear unread history. Thread replies remain unread until their thread is opened, and an explicit conversation clear includes its threads. Removing a DM from Messages clears its unread activity through the latest received snapshot; later arrivals remain unread.

Unread badges are independent of alert preferences: mute and Do not disturb silence alerts while retaining missed activity. Deleted or expired messages stop contributing to badges, and inaccessible conversations are omitted.

When this feature is first installed, existing message history starts as read. Subsequent activity is tracked persistently. There is no notification inbox yet.

## Delivery

Desktop alerts and message sounds are independent. Desktop alerts require permission and appear when Campfire is hidden or unfocused. They identify the sender/conversation without including message text. A blocked permission is explained beside the control.

The visible, focused conversation stays quiet. Other conversations can still produce sounds while Campfire is focused. Use **Test notification sound** to check playback, or **Audio output & volume** to adjust the device and sound-effects volume.

## Server defaults and overrides

Choose **All messages**, **Mentions only**, or **Nothing** as the default for this server's text channels. Mentions means a direct mention of your permanent username. Thread replies follow their parent channel's notification policy.

The most specific rule wins:

1. An explicit channel override.
2. An override for the channel's category.
3. The server default.

Under **Notification overrides**, categories and text channels appear in a collapsible hierarchy, with a notification dropdown beside each row. Reordering and category channel counts are omitted here. The inheritance option shows the current parent default; select it to remove an override and return to inheritance. Category notification rules apply to every text channel in that category, including channels with custom access permissions.

Existing channel choices are retained. Until you choose a new server default, the previous direct-mention preference supplies its default.

## Direct messages

DMs have a separate default and searchable conversation overrides. **All messages** explicitly enables a conversation, even when the DM default is off; **Nothing** silences it. **Use DM default** removes the conversation override. Self-messages never alert.

## Mute and Do not disturb

Server mute overrides every notification choice for that server, including DMs and incoming calls. Do not disturb also silences message alerts and incoming calls. Muting does not hide unread indicators, prevent message delivery, or change stored defaults and overrides.

Notification settings cover the features described above. They do not include mobile push, email, activity/event alerts, role mentions, or @everyone/@here mentions.

## Verification

- `node test/activity.test.js`: restart persistence, read races, thread scopes, permissions, deletion, synced rules, and account-specific socket updates.
- `node --experimental-strip-types test/activity-client.test.js`: stale-response handling, focused-conversation suppression, and preference scoping.
- `node --experimental-strip-types test/mentions-notifications.test.js`: precedence, legacy defaults, DMs, threads, server/account isolation, mute, and DND.
- `node scripts/verify-notification-settings.mjs`: Electron controls, persistence, permission feedback, inheritance reset, and dark/light layouts at desktop and narrow sizes.
- `node scripts/verify-member-messaging.mjs --sound`: real Web Audio playback and socket-message policy checks, including category inheritance and focused-conversation behavior. Desktop alerts are observed through an instrumented Notification API; this does not prove native OS delivery on every platform.
