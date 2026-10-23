# Save and restore the server setup

The setup snapshot keeps usernames and password hashes, ownership, bans, role
assignments, role names/colors/order/permissions, server settings (including the
attachment storage limit), message retention, nicknames, profile frames, and saved
presence preferences, channels, channel order, names, descriptions, privacy, reaction-author
visibility, role permission overrides, and per-channel retention. Appearance, audio, and desktop-alert
preferences saved on clients remain on those clients. Personal server notification rules and read
positions are not included in setup snapshots; a reset clears them along with message history.

The current local setup is saved in `.private/server-setup.json`. Keep a private
backup of that file: it contains password hashes and configuration, and is ignored
by Git. The reset always uses this saved baseline, not the latest database state.

## Reset the database

Stop the server and any service that automatically restarts it, then run from the
project directory:

```bash
npm run setup:reset
npm run server
```

The tool creates a fresh database through normal server initialization, starts a
temporary API server on an automatically chosen `127.0.0.1` port, and populates it
through the existing role, assignment, registration settings, server settings,
profile, presence, member access, channel, and channel retention APIs. No migrations are run.

A private, randomly generated restore token enables account creation from stored
password hashes, editing the Owner role, and restoring the recorded server identity.
This mode requires an empty community, accepts only loopback requests, and blocks
requests without its token. Normal server startup does not enable it. Account creation
shares the same account creation function used by ordinary registration.

Account, custom role, and custom channel IDs are newly generated. Protected channels
are matched by type and retain their protection. Snapshot role keys only connect
the saved assignments to their new roles. Role order is preserved, with positions
normalized by the normal role API. The Owner role retains its name and color and receives every current permission,
matching ownership behavior. Retired permission names in its old row are omitted;
unknown permissions on other roles cause the restore to fail.

Only after every API call succeeds, the temporary server closes, and database
integrity checks pass does the script replace `data/campfire.sqlite`. The old
database, including committed WAL contents, is saved in
`data/before-reset-<unique suffix>/campfire.sqlite`. Backups contain the old messages
and files too; remove them manually when no longer needed. An open WAL connection
to the original database makes the script refuse replacement.

Messages, uploads, avatars, custom emojis, GIF favorites, sessions, invitations,
and password-reset tokens are discarded. Channels and their settings are restored from the snapshot, replacing the default
channel list. Older version 1 snapshots without channels still create the default
channels; capture a new baseline to include channels before resetting.

Retention keeps the channel default, the direct-message period and whether only
files are removed, as the owner last chose them. A change still waiting out its
notice week is restored as made, since the reset community has no messages yet.
Snapshots taken from a database without retention restore the defaults: messages
kept forever.
Server icons stored in settings are preserved. Users sign in again with their
existing usernames and passwords.

The tool only replaces the database. Keep `.env` and `data/identity/`: networking,
API keys, TLS keys, and certificates are not included in the JSON. When moving to a
different host, copy the original identity folder too if using self-managed HTTPS.

## Save a different baseline

```bash
npm run setup:capture -- --snapshot .private/new-setup.json
npm run setup:reset -- --snapshot .private/new-setup.json
```

Capture reads a consistent transaction, including committed WAL data. It never
overwrites an existing snapshot; use a new filename for a new baseline.
The source database must still have the account/settings tables understood by
the capture tool, so save the snapshot before changing an incompatible schema.

Both commands load `.env`, honor `DATA_DIR` (default `data`), and accept
`--data-dir /path/to/data`. Relative paths resolve from the working directory.
The default snapshot is `.private/server-setup.json`, outside the data folder.

## Future changes

The JSON describes setup operations rather than SQL rows. Restore goes through
current API validation, including password hash format, permission identifiers,
and profile settings. Incompatible values fail before replacing the old database.
Unknown server settings also fail capture rather than being silently dropped.
API or password-format changes may still require updating the restore tool or its
account import operation; using APIs does not make arbitrary future changes compatible.
