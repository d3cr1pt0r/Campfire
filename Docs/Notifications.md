# Notification settings

Open **Settings → Notifications**. **Desktop notifications** controls popups, and **Sounds** controls message and reaction audio. **Server notifications**, **Channel overrides**, and **Direct messages** choose which activity alerts you. **Reactions to your messages** has its own alert switch. These rules apply to both popups and sounds; unread badges and jump highlights stay on.

Server mute, message levels, DM rules, and the reaction switch sync across devices for your account on this server. Desktop permission, sounds, volume, and output devices remain local. Existing accounts keep reaction alerts enabled until they turn them off.

## Missed messages and unread badges

Unread badges survive app and server restarts. Each server stores pending activity and your acknowledgments; messages received while the app is closed appear in the existing channel and DM badges when you reconnect. Clearing synchronizes to your other devices. Restoring badges does not replay old sounds or desktop alerts.

Click a channel name or a user/DM with pending notifications to visit its newest pending message. Campfire loads the surrounding history, scrolls the message into view, and highlights it for two seconds. Once the jump finishes, Campfire also highlights and clears any other queued messages visible in the main chat or open thread viewport. Offscreen messages remain pending. A thread reply opens its thread and highlights both the reply and its original message. Repeated clicks visit the next newest pending message. With no pending items, clicking uses ordinary navigation. **Jump to latest** returns from an older history window without clearing pending items.

Opening or focusing a conversation does not automatically clear its backlog. New messages arriving in the currently open, visible, focused conversation stay quiet and are individually acknowledged without clearing older pending items. Replies in an unopened thread remain pending. Search and pinned-message views do not clear the backlog. Reduced-motion users receive a static highlight.

Right-click a text channel, DM row, or member to choose **Clear notifications** for that conversation. The option appears only while notifications remain. Keyboard users can press Shift+F10 or the context-menu key. Clearing includes thread replies, does not navigate away, and applies through the menu's captured snapshot so later arrivals remain pending. Removing a DM from Messages also clears its pending activity through the latest snapshot.

Reactions from other people on your messages also contribute to the existing channel and DM badges, including reactions on your thread replies. Clicking the badge jumps to your reacted message; thread replies open their thread and highlight the original message too. The specific queued reaction chips play a short punch-scale animation alongside the message highlight. The same jump animates and clears other queued reactions on messages visible in the main chat or open thread viewport; offscreen reactions remain pending. Unrelated reaction chips do not animate, and reduced-motion users receive a static chip highlight. Your own reactions and reaction removals do not create notifications. Removing a reaction also removes its pending activity. Multiple reactions to the same message are cleared together through the selected snapshot, while later reactions remain pending. Reactions received while disconnected survive restarts; reconnecting restores their badges without replaying alerts. Existing reactions from before this feature was installed are not replayed.

A reaction to a message actually visible in the focused conversation stays quiet and is acknowledged. Reactions to older, offscreen messages remain pending so the badge can take you back to them.

Unread badges are independent of alert preferences: mute and Do not disturb silence alerts while retaining missed activity. Deleted or expired messages stop contributing to badges, and inaccessible conversations are omitted.

When persistent tracking is first installed, existing message history starts as read. Subsequent activity is tracked persistently. Notification traversal uses the existing sidebar badges; there is no separate notification inbox.

## Delivery

Desktop alerts and message sounds are independent. Desktop alerts require permission and appear when Campfire is hidden or unfocused. They identify the sender/conversation without including message text. A blocked permission is explained beside the control.

The visible, focused conversation stays quiet. Other conversations can still produce sounds while Campfire is focused. Use **Audio output & volume** to adjust the device and sound-effects volume.

## Server defaults and overrides

Choose **All messages**, **Only mentions**, or **Nothing** as the default for this server's text channels. Mentions means a direct mention of your permanent username. Thread replies follow their parent channel's notification policy. Reactions to your own messages are directed at you and can alert in both All messages and Only mentions; Nothing silences them. DM reaction alerts follow the DM default and conversation override. The separate reaction switch can silence reaction alerts without changing message alerts or unread badges.

The most specific rule wins:

1. An explicit channel override.
2. An override for the channel's category.
3. The server default.

Under **Channel overrides**, categories and text channels appear in a collapsible hierarchy, with a notification dropdown beside each row. Reordering and category channel counts are omitted here. The inheritance option shows the current parent default; select it to remove an override and return to inheritance. Category notification rules apply to every text channel in that category, including channels with custom access permissions.

Existing channel choices are retained. Until you choose a new server default, the previous direct-mention preference supplies its default.

## Direct messages

DMs have a separate default and searchable conversation overrides. **All messages** explicitly enables a conversation, even when the DM default is off; **Nothing** silences it. **Use DM default** removes the conversation override. Self-messages never alert.

## Mute and Do not disturb

Server mute overrides every notification choice for that server, including DMs and incoming calls. Do not disturb also silences message alerts and incoming calls. Muting does not hide unread indicators, prevent message delivery, or change stored defaults and overrides.

Notification settings cover the features described above. They do not include mobile push, email, other activity/event alerts, role mentions, or @everyone/@here mentions.

## Verification

- `node test/reaction-notifications.test.js`: author-only live delivery, persistent reaction badges, mixed message/reaction traversal, thread parents, captured clear cutoffs, permissions, removal, and cross-device acknowledgment.
- `node test/activity.test.js`: newest-first traversal, individual acknowledgments, bounded message jumps, restart persistence, clear races, thread scopes, permissions, deletion, synced rules, and account-specific socket updates.
- `node --experimental-strip-types test/activity-client.test.js`: serialized clicks, failed/cancelled navigation, stale-response handling, focused-conversation suppression, and preference scoping.
- `node --experimental-strip-types test/mentions-notifications.test.js`: precedence, legacy defaults, DMs, threads, server/account isolation, mute, and DND.
- `node scripts/verify-notification-settings.mjs`: Electron controls, persistence, permission feedback, inheritance reset, and dark/light layouts at desktop and narrow sizes.
- `node scripts/verify-member-messaging.mjs --reactions`: focused reaction alerts, persistent badges and jumps, simultaneous main/thread reaction animations, visible batching, offscreen preservation, repeat jumps, and reduced motion. Desktop alerts use an instrumented Notification API.
- `node scripts/verify-member-messaging.mjs --sound`: real Web Audio playback, focused-conversation behavior, missed badges, newest-first sidebar traversal, old-history and thread highlighting, and conditional context menus with a clear/new-arrival race. Desktop alerts are observed through an instrumented Notification API; this does not prove native OS delivery on every platform.
