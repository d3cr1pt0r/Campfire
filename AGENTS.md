# Project instructions

## Proportionate testing

Match validation effort to the risk and scope of the change. Avoid broad test runs,
repeated builds, and full Electron or visual suites for small changes.

- **Documentation, copy, spacing, colors, and simple layout changes:** review the
  affected text or UI area. Check formatting or links where relevant. Do not add
  tests or run broad suites. Documentation-only edits do not need an application
  build, type check, or Electron run.
- **Small UI behavior changes:** type-check when relevant and perform one focused
  interaction check. Reuse an existing check where practical.
- **Server logic, permissions, authentication, deletion, and persistence:** run
  the relevant regression tests. Add coverage when it protects meaningful behavior
  or data integrity.
- **Large redesigns and releases:** run the broader applicable suite and visual
  checks across affected areas.

Once the relevant checks pass, stop testing. Repeat or broaden validation only
after another change, a failure, or an unresolved concern justifies it. Batch
related edits before validating them.

Every test has a maintenance cost. Do not add tests that merely mirror the
implementation, assert incidental styling, or duplicate existing coverage. Avoid
creating a new visual harness for routine UI polish. Keep validation reports
brief and state any material limits honestly.

Treat cleanup of accumulated tests as a separate, explicitly scoped task. Review
duplicates, brittle visual assertions, and expensive scripts before removing
them; preserve meaningful coverage for permissions, data integrity,
authentication, and core messaging.
