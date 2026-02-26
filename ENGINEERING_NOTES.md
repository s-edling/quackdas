# Engineering Notes

Purpose: durable technical memory for Quackdas.

Use this file for long-lived engineering knowledge, not temporary scratch notes.

## How To Use

Add short, date-stamped notes under the sections below when you discover:
- an important invariant,
- a recurring bug pattern,
- an architectural decision,
- a packaged-vs-dev behavior difference,
- a performance constraint or proven optimization.

Keep entries concise and practical.

## Data Model Invariants

- (Add notes)

## Import/Export Quirks (QDPX/NVivo)

- (Add notes)

## PDF Handling

- (Add notes)

## Performance Constraints

- (Add notes)

## Packaged vs Dev Differences

- 2026-02-25: Do not use broad Electron Builder packaging globs like `build.files: ["**/*"]` after repo layout changes. Root-level archives/local artifacts (for example `*.zip`) can be silently swept into `app.asar`, causing major installer/app size regressions and potential data leakage. Keep a runtime-file allowlist in `package.json` (`index.html`, `main.js`, `preload.js`, `styles.css`, `js/**`, `assets/**`, `semantic/**`) and explicit excludes for `.env*`, secret-like filenames, tests/tools/docs, and corpus-like data files.

## UI Guardrails

- 2026-02-24: Semantic Ask loose-mode responses may arrive with citation markers as `[n]` or legacy placeholders like `@@SEMCITE0@@` / `@@SEM_CITE_0@@`. UI rendering should normalize both into clickable source chips.
- 2026-02-24: When rendering markdown-like Ask prose, use citation placeholder tokens that do not contain markdown control characters (such as `_`) to avoid accidental emphasis parsing before token replacement.
- 2026-02-25: For delegated `contextmenu` handlers, do not assume `event.currentTarget` is the interactive element; in document-level delegation it is `document`. Resolve actionable nodes from `event.target.closest(...)` before using element-only APIs like `getClientRects()`.
- 2026-02-26: In Code view (segments mode), avoid DOM-mutating in-page-search highlight wrappers around snippet text because snippet rendering depends on preserved `<br>` structure for paragraph spacing. Prefer non-mutating highlight rendering (`Range` + CSS `::highlight`) and keep a fallback path only for environments without highlight API support.
- 2026-02-26: For high-frequency coding cleanup actions (`Remove coding`, `Remove all coding`), prefer immediate execution plus reliable undo over confirmation dialogs. Confirmation prompts in this path reduce throughput and are redundant when history/undo is stable.

## High-Risk Regression Checklist

- (Add notes)
