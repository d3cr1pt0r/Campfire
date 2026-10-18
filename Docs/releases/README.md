# Historical release descriptions

These descriptions were reconstructed on 2026-10-17 from published GitHub release metadata, the release tags, commit messages, and the corresponding source/documentation changes. Published-release descriptions cover the tagged source; uploaded executable contents were not independently audited. Later work, including threads and the security report, is excluded from v0.1.0 through v0.1.4 and included in the v0.1.5 draft below.

GitHub descriptions were empty at review time. These files are prepared for publication; they have not yet been applied to GitHub. Publishing requires authenticated repository access.

| Release | Published (UTC) | Tagged commit | Prepared description |
| --- | --- | --- | --- |
| [v0.1.0](https://github.com/d3cr1pt0r/Campfire/releases/tag/v0.1.0) | 2026-10-16T21:34:10Z | `f4cf3a5` | [v0.1.0.md](v0.1.0.md) |
| [v0.1.1](https://github.com/d3cr1pt0r/Campfire/releases/tag/v0.1.1) | 2026-10-16T22:00:10Z | `d619d63` | [v0.1.1.md](v0.1.1.md) |
| [v0.1.2](https://github.com/d3cr1pt0r/Campfire/releases/tag/v0.1.2) | 2026-10-16T22:24:28Z | `896623c` | [v0.1.2.md](v0.1.2.md) |
| [v0.1.3](https://github.com/d3cr1pt0r/Campfire/releases/tag/v0.1.3) | 2026-10-16T23:21:41Z | `76dc625` | [v0.1.3.md](v0.1.3.md) |
| [v0.1.4](https://github.com/d3cr1pt0r/Campfire/releases/tag/v0.1.4) | 2026-10-17T08:07:03Z | `7332df4` | [v0.1.4.md](v0.1.4.md) |

Each release after v0.1.0 covers the commits after the preceding tag through its own tag. v0.1.0 covers the initial implementation. Tags take precedence over publication or asset-upload timing when assigning changes.

Only Windows portable executables were attached to the five releases when reviewed. The v0.1.4 Linux notes describe build support added in the tagged source, not an attached Linux download.

## v0.1.5 draft

[Prepared description](v0.1.5.md). No published v0.1.5 release was found through the GitHub API on 2026-10-17 (the release-by-tag endpoint returned 404), and the local checkout has no v0.1.5 tag. No publication date or final tagged commit is assumed.

The draft covers commits after v0.1.4 through `9286959` (the current checkout when prepared). Its changelog link uses that source cutoff until a final tag is available. Reconcile the notes and link with the actual tag before publication. This draft has not been published to GitHub.

## v0.1.6 draft

[Prepared description](v0.1.6.md). Based on the channel-management/mentions/notifications commit `12ab3a2`, the shutdown fix `78ab0e0`, and the version bump `2103793`, following the v0.1.5 notes commit `0f534d1`.

The local checkout has no v0.1.5 or v0.1.6 tag. No live release lookup was performed for this draft, and no publication date is assumed. The changelog link uses the source commits; reconcile it with the final release tags before publication. This draft has not been published to GitHub.

## v0.1.7 draft

[Prepared description](v0.1.7.md). Covers changes after the v0.1.6 source cutoff `2103793` through `2236428`: owner-controlled registration and invitations (`00ac065`), channel descriptions and interface alignment/cleanup (`d84bdaa`), and granular role permissions with role-first channel access (`2236428`).

The working `package.json` declares version 0.1.7. The local checkout has no v0.1.6 or v0.1.7 tag. No live release lookup was performed, and no publication date or uploaded assets are assumed. The changelog link uses the source commits; reconcile it with the final release tags before publication. This draft has not been published to GitHub.
