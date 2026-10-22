# Channel categories

Open **Settings → Channels** to create, rename, reorder, and delete categories. Text and voice channels can share a category. Existing channels stay uncategorized with their existing permissions.

Settings uses a nested tree on the left and an editor for the selected item on the right. Drag channels onto category headings to assign them, between channels to reorder them, or onto Uncategorized to remove them from a category. Text and voice channels can be freely interleaved. Drag category headings to reorder categories. Alt + Arrow keys on a focused channel or category provide keyboard reordering.

Moving into another category opens a permission choice: **Use category permissions** replaces the channel policy and follows future category changes; **Keep current permissions** preserves access and manages the channel separately. Dropping out of a category preserves its current access. Ordering and membership changes save atomically.

Select a category and choose **New** to create a channel directly inside it with synced permissions. The same menu creates top-level channels and categories.

Select **Permissions** to see the policy’s source. Synced channels show a read-only view of their category’s permissions, a link to edit that category, and **Customize this channel’s permissions**. Custom channels show **Replace with [category] permissions** to resync.

The permission editor has a role list and grouped **Deny / Inherit / Allow** controls. Each permission states whether the selected server role grants it. Drafts remain intact when changing roles; a visible save bar saves all role edits, and switching items or tabs protects unsaved changes. Private categories hide synced channels until an assigned role explicitly allows View channels. Default applies only to members without assigned roles. Allows from assigned roles win over denies. Server ownership always retains access.

The sidebar places Messages first, then uncategorized channels, followed by categories with mixed text and voice rows. Category names use quiet labels with adjacent collapse chevrons. Create, edit, and reorder channels and categories under **Settings → Channels**; the sidebar has no settings shortcuts or reordering controls. Voice-channel invite icons appear beside voice-channel names on hover or keyboard focus.

Category management uses the corresponding channel creation, editing, ordering, deletion, and permission-management privileges. Delegates can change permissions only for lower roles and permissions they have, and category-wide edits require access to every child channel. Moving a channel between categories requires reordering, channel editing, and permission-management privileges. Permission changes immediately update connected clients and enforce call access.

Click the chevron beside a sidebar category to collapse or expand it. A category header displays the combined unread count of its visible child channels, including while collapsed. Personal [notification settings](Notifications.md) let channels inherit category and server defaults, with individual channel overrides. Notification choices are independent of access-permission sync. Collapse preferences are stored separately for each server and account, including in Electron.

Deleting a category requires confirmation. Its channels become uncategorized, keep their messages, and retain their effective permissions. Protected text and voice channels remain protected. Setup capture/reset includes categories, role overrides, membership, and sync choices.

The category tables are additive to the currently supported database schema; no existing channel is moved or rewritten on startup. The existing refusal of databases from unsupported older Campfire versions remains in effect.

Discord’s [category guide](https://support.discord.com/hc/en-us/articles/115001580171-Channel-Categories-101) and [permission syncing reference](https://support.discord.com/hc/en-us/articles/206029707-Setting-Up-Permissions-FAQ) informed the synced/custom model. Campfire displays an aggregate unread badge on a collapsed category instead of exposing its channel rows.

## Verification

- `node test/categories.test.js`: text/voice inheritance, custom exceptions, private visibility, resync, deletion, role combinations, inspector explanations, hierarchy, and delegated privilege boundaries.
- `node test/category-server.test.js`: real Socket.IO call revocation and filtered channel/message events.
- `node test/server-setup.test.js`: category and membership capture/reset round-trip.
- `node scripts/verify-categories.mjs`: two isolated Electron windows using a production build; tests mouse-initiated Chromium dragging and edge scrolling in settings, nested channel/category ordering, creation inside categories, explicit permission choices, unsaved drafts, cross-window permission updates, collapsed unread counts, persistence, custom policies, and disabled sidebar reordering. Screenshots are written to `/tmp/campfire-organizer-review`.
