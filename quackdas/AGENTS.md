Project goal:
Build Quackdas as a fast, practical qualitative coding app (Electron + HTML/CSS/JS) that can handle real research datasets (around 100 documents) without NVivo-style sluggishness.

Core product direction:
- Keep the app responsive and lightweight.
- Prefer clear UX and stable behavior over feature bloat.
- Preserve compatibility with QDPX workflows.

Hard rule:
- Do not bump the app/package version number unless explicitly asked in that task.

## Documentation workflow

Use four files with clear roles:

1) `quackdas/CHANGELOG.md` (tracked)
- User-facing release notes.
- One concise entry per release batch (default).

2) `quackdas/CHANGELOG_UNRELEASED.md` (gitignored)
- Local draft notes during active work.
- Add a short user-facing summary for non-trivial changes as work progresses.
- Roll these into `CHANGELOG.md` when committing/finalizing a batch.

3) `quackdas/ENGINEERING_NOTES.md` (tracked)
- Durable technical memory.
- Keep architecture decisions, invariants, import/export quirks, PDF pitfalls, performance lessons, packaged-vs-dev differences, and regression checklists.

4) `quackdas/WORKLOG_LOCAL.md` (gitignored)
- Temporary scratchpad for hypotheses, dead ends, and in-progress diagnostics.
- Do not treat this as durable memory.
- Update this during implementation for each non-trivial change (anything beyond very small/mechanical edits).

## Changelog policy

When to update `quackdas/CHANGELOG.md`:
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

Update `quackdas/ENGINEERING_NOTES.md` when:
- a bug reveals a non-obvious invariant,
- a packaged build behaves differently from dev,
- a performance fix depends on specific constraints,
- import/export compatibility requires special handling.
- lessons learned are likely to prevent future regressions or rework.

Write short, practical notes. Prefer durable rules over long narrative.
When committing/finalizing a batch, update `ENGINEERING_NOTES.md` alongside `CHANGELOG.md` if such lessons were learned.

## Working style expectations for coding agents

- Prefer robust fixes over quick hacks.
- Keep performance in mind for large projects and PDFs.
- Minimize UI regressions; preserve established visual language unless asked to redesign.
- After changes, always report:
  - what changed,
  - how to verify,
  - what could have broken and how to test it.

## Legacy notes

Older detailed change history is in `quackdas/CHANGELOG_ARCHIVE.md`.
