# Desktop updates

Campfire checks GitHub Releases shortly after startup and every four hours. Stable
Windows installer builds and Linux AppImages download newer stable releases in
the background. **Settings → My account → Client updates** also offers a manual
check, download progress, and retry after a failure.

When the download is ready, a banner offers **Restart to update**. Restarting
requires confirmation and ends active calls and screen sharing. A downloaded
update also installs when you fully quit Campfire. Closing to the tray keeps the
app running and does not install it.

## Downloads

- **Windows Setup.exe:** recommended, per-user installation without an administrator
  prompt under normal conditions. Future versions update automatically.
- **Linux AppImage:** recommended. Keep it in a directory your user can write to
  so the updater can replace it. Run the AppImage itself, rather than extracting it.
- **Windows Portable.exe / Linux tar.gz:** manual updates. These builds explain
  that automatic updating requires the installer or AppImage.

Users of older clients must download and install the first updater-enabled release
manually. The app identity and user data location are unchanged, so an existing
Campfire profile remains available. Community servers are updated separately by
their owners; the desktop updater does not update servers.

## Preparing a release

1. Bump `package.json` and `package-lock.json` together, and prepare
   `Docs/releases/vX.Y.Z.md`.
2. Commit and push the changes, then create and push the matching `vX.Y.Z` tag.
3. Run **Actions → Prepare desktop release** with that existing tag. The tag must
   match the package version and the workflow repository must match the update feed.
4. The workflow creates a **draft** GitHub release with the notes, then runs
   Windows and Linux checks and builds. Each platform attaches its packages and
   update metadata directly to the draft: installer, portable executable, AppImage,
   tarball, blockmaps, and `latest.yml` / `latest-linux.yml`. Both builds must succeed.
5. Review the draft and its files, then publish it as the latest stable release.
   Clients only receive published releases. Do not publish the draft until both
   platform packages and metadata are present.

The workflow uses the repository's built-in `GITHUB_TOKEN` for draft creation
and asset uploads. Build and test steps are not given the token in their environment,
and checkouts do not persist credentials. No token is shipped to clients. An existing release is
not overwritten; if a preparation run needs replacing, remove its draft explicitly
before rerunning the whole workflow. A failed build leaves an incomplete draft; do
not publish it. Release builds upload directly to Releases to avoid consuming
Actions artifact storage. Temporary standalone-build artifacts expire after one day.

`npm run dist:win` and `npm run dist:linux` also build local packages and update
metadata without publishing. Standalone build workflows remain available for
preview downloads. Never attach preview builds to a stable release: clients use
that release's metadata as their update source. Keep optional default-server
configuration consistent between releases.

The update feed is fixed in `electron-builder.cjs` to the public Campfire GitHub
repository. Community server responses cannot change it. HTTPS and the generated
SHA-512 metadata protect transport and downloaded-file integrity. Windows signing
can be configured through Electron Builder's signing environment variables; the
current workflows do not provide a signing certificate.

Before distributing the first updater-enabled release, verify on Windows that
Setup installs, retains an existing profile, updates to a newer packaged version,
and restarts. Repeat the two-version update on Linux with a writable AppImage,
including full quit and closing to the tray. Source tests and local package builds
do not prove either native installation flow.

See [Electron Builder's updater documentation](https://www.electron.build/v26/docs/features/auto-update/).
