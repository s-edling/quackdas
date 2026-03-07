Project goal:
Build Quackdas as a fast, practical qualitative coding app (Electron + HTML/CSS/JS) that can handle real research datasets (around 100 documents) without NVivo-style sluggishness.

Core product direction:
- Keep the app responsive and lightweight.
- Prefer clear UX and stable behavior over feature bloat.
- Preserve compatibility with QDPX workflows.

Hard rule:
- Do not bump the app/package version number unless explicitly asked in that task.

## Documentation workflow

Use five files with clear roles:

1) `CHANGELOG.md` (tracked)
- User-facing release notes.
- One concise entry per release batch (default).

2) `ARCHITECTURE.md` (tracked)
- Durable system map for contributors and coding agents.
- Read before changing app boundaries or multi-module behavior:
  - Electron main/preload/renderer responsibilities,
  - project save/load/backups,
  - QDPX import/export,
  - semantic indexing / Ask,
  - agent/CLI integration surfaces.
- Update when the structure, ownership, persistence model, or major invariants change.
- Do not update for small isolated fixes that leave the architecture intact.

3) `CHANGELOG_UNRELEASED.md` (gitignored)
- Local draft notes during active work.
- Add a short user-facing summary for non-trivial changes as work progresses.
- Roll these into `CHANGELOG.md` when committing/finalizing a batch.

4) `ENGINEERING_NOTES.md` (tracked)
- Durable technical memory.
- Keep architecture decisions, invariants, import/export quirks, PDF pitfalls, performance lessons, packaged-vs-dev differences, and regression checklists.
- Use this for narrow lessons and gotchas; use `ARCHITECTURE.md` for the higher-level system map.

5) `WORKLOG_LOCAL.md` (gitignored)
- Temporary scratchpad for hypotheses, dead ends, and in-progress diagnostics.
- Do not treat this as durable memory.
- Update this during implementation for each non-trivial change (anything beyond very small/mechanical edits).

## Changelog policy

When to update `CHANGELOG.md`:
- Update when the user explicitly asks to commit/finalize a batch.
- The agent does not auto-run on GUI commits; it only updates files when prompted in chat.
- Do not add a tracked changelog entry for every micro-change.

Build identifier policy:
- Use `YYYY.MM.DD.N`
- Use local date (user timezone) for `YYYY.MM.DD`.
- `N` = (highest existing `N` for that date in `CHANGELOG.md`) + 1.
- This build id is changelog-only and does not modify `package.json` version.

Entry template:
- Build id
- Date
- Changed (user-visible)
- Why
- Files touched
- Verification
- Regression checks

Granularity rule:
- One meaningful release batch = one changelog entry.
- Multiple small fixes to the same feature should be rolled into one batch entry, even if done across several commits.

## Engineering notes policy

Update `ENGINEERING_NOTES.md` when:
- a bug reveals a non-obvious invariant,
- a packaged build behaves differently from dev,
- a performance fix depends on specific constraints,
- import/export compatibility requires special handling.
- lessons learned are likely to prevent future regressions or rework.

Write short, practical notes. Prefer durable rules over long narrative.
When committing/finalizing a batch, update `ENGINEERING_NOTES.md` alongside `CHANGELOG.md` if such lessons were learned.

## Architecture doc policy

Consult `ARCHITECTURE.md` before:
- moving logic across main/preload/renderer,
- changing the project model or save/load path,
- introducing new cross-cutting renderer modules,
- changing semantic indexing / Ask behavior at the subsystem level,
- extending the agent or CLI surface,
- changing where durable or derived data is stored.

Update `ARCHITECTURE.md` when:
- a new subsystem or persistent store is added,
- ownership between runtime layers changes,
- renderer script loading assumptions change,
- core invariants or integration boundaries change.

If the change is architectural, update `ARCHITECTURE.md` in the same task rather than leaving it stale.

## Architecture constraints

- Do not introduce a bundler, framework, TypeScript migration, or major build-system change unless explicitly requested.
- Keep the current Electron split intact: privileged/native logic in `main.js`, explicit bridge APIs in `preload.js`, and UI/state logic in the renderer.
- Do not add direct Node.js or Electron API usage to renderer files.
- Preserve the renderer script loading model in `index.html`; load order is an architectural dependency.
- Prefer extending existing `js/*.js` domain files over adding new abstraction layers unless the task is explicitly architectural.
- Do not partially migrate the app to a new state-management or module pattern unless the task explicitly includes that refactor.
- If runtime boundaries, subsystem ownership, or core data-model invariants change, update `ARCHITECTURE.md` in the same task.

## Data safety constraints

- Treat changes to `js/state.js`, `js/qdpx.js`, save/load, import/export, normalization, and backup flows as high risk.
- Never remove, rename, or reinterpret persisted fields without adding backward-compatible normalization or migration handling.
- Prefer additive schema changes over destructive ones.
- Do not silently discard unknown or legacy project data during load unless explicitly intended and documented.
- Opening or importing a project must not rewrite the on-disk project automatically; disk mutation should happen only through an explicit save/export/restore path.
- Do not weaken backup behavior, crash-safety, or QDPX import safety checks unless explicitly requested and justified.
- If a change could plausibly cause data loss or corruption, add focused tests when practical; otherwise provide an explicit manual verification checklist.
- If a bug reveals a data-integrity invariant, record it in `ENGINEERING_NOTES.md`.

## Compatibility and privacy constraints

- Preserve `.qdpx` interoperability as a core requirement.
- Treat `.qdpx` as the authoritative portable project format; app-local stores must remain derived cache or clearly documented local state.
- Do not store new copies of user corpus/project content outside the project file unless explicitly requested and documented in `ARCHITECTURE.md`.
- Preserve local-first behavior: no cloud storage, background upload, telemetry, analytics, or external error reporting unless explicitly requested.
- Preserve local-only AI behavior; semantic model access should remain restricted to local/localhost services unless explicitly requested.
- If QDPX behavior changes, document compatibility implications in `ENGINEERING_NOTES.md`.

## Verification expectations

- Any change to `js/state.js`, `js/qdpx.js`, semantic persistence, backup flows, or import/export logic requires focused verification.
- Prefer automated tests for normalization, migration, import/export, and persistence logic when practical.
- If automated tests are not added for a material behavior change, say so clearly and provide a concrete manual verification checklist.
- For any data-risk change, include at least one round-trip, recovery-path, or backward-compatibility check.
- After non-trivial changes, always report what changed, how it was verified, and what regression scenarios still matter.

## Working style expectations for coding agents

- Prefer robust fixes over quick hacks.
- Keep performance in mind for large projects and PDFs.
- Minimize UI regressions; preserve established visual language unless asked to redesign.
- After changes, always report:
  - what changed,
  - how to verify,
  - what could have broken and how to test it.

## Legacy notes

Older detailed change history is in `CHANGELOG_ARCHIVE.md`.
