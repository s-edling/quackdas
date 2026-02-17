# Quackdas Changelog

## Version 0.4.2
Date: 2026-02-17

What changed:
- Improved PDF coding flow and stability for region-based coding.
- Integrated PDF page navigation with keyboard behavior and main toolbar controls.
- Added OCR fallback plumbing for scanned PDFs (using local tesseract via Electron IPC where available).
- Added PDF region coding workflow with region overlays and region previews in code view.
- Added non-blocking PDF region annotation field and improved selection-status messaging.
- Added code-view improvements: description block, memo affordances, and layout updates.
- Added context actions for PDF text extraction into a sibling text document (`OLDNAME_text`) in the same folder.
- Updated UI polish: larger logo, folder/root document separation spacing, and filter/code view banner refinements.
- Fixed code-view/memo interactions and inline memo visibility behavior.

Why (one line):
- To make PDF coding and navigation reliable, reduce accidental actions, and improve analysis workflow usability/performance.

Files touched:
- `index.html`
- `package.json`
- `styles.css`
- `main.js`
- `preload.js`
- `js/app.js`
- `js/codes.js`
- `js/coding.js`
- `js/documents.js`
- `js/export.js`
- `js/memos.js`
- `js/pdf.js`
- `js/qdpx.js`
- `js/render.js`

## Version 0.4.2-build-2026-02-17b
Date: 2026-02-17

What changed:
- Removed the "Project imported successfully" pop-up after opening/importing projects.
- Updated header project actions:
  - Primary header button is now `+ Open project` and is shown only when no project data is loaded.
  - Moved `+ New project` into the header dropdown and styled it as a white action row.
  - Renamed dropdown `Import project…` to `Open project…`.
- Increased the top-left rabbit-duck logo size again without changing header height.
- Replaced segment "Add memo" interaction (document/segment context paths) with the non-blocking inline annotation panel.
- Inline annotation panel now shows existing annotations below the input and closes on outside click, including clicks inside PDF content.
- Kept the Code view three-dots annotation modal, renamed modal language from memo -> annotation, and reduced input height to give more space to existing annotations.
- Added macOS-style multi-select behavior in document lists:
  - Shift-click selects a range
  - Cmd-click toggles individual documents
  - Selection highlighting is now visible in the list.
- Reduced vertical spacing between Code view document headers and snippets.

Why (one line):
- To reduce repetitive friction in project/document workflows and make annotation + navigation behavior clearer and faster in daily qualitative coding.

Files touched:
- `index.html`
- `styles.css`
- `js/coding.js`
- `js/documents.js`
- `js/export.js`
- `js/memos.js`
- `js/render.js`
- `js/state.js`
- `js/ui.js`

## Version 0.4.2-build-2026-02-17c
Date: 2026-02-17

What changed:
- Softened active document selection styling to be less red/pink while preserving contrast.
- Updated annotation interaction labels to consistently use `Annotations` in segment context menus.
- Inline annotation panel behavior updated:
  - input starts empty (no carry-over from prior text)
  - `Enter` saves + closes
  - `Shift+Enter` inserts line break.
- Added `Annotations` option in Code view snippet right-click menu (opens same annotation modal as snippet three-dots).
- Reduced annotation modal input height further to increase space for existing annotations.
- Moved PDF snippet three-dots button to the thumbnail row (instead of beside the location text line).
- Tightened Code view vertical spacing between document headers/snippets and between snippets.
- Removed `+` from the empty-state header action label (`Open project`).

Why (one line):
- To make selection/annotation UX clearer, faster, and visually calmer during coding-heavy workflows.

Files touched:
- `index.html`
- `styles.css`
- `js/coding.js`
- `js/render.js`
- `js/ui.js`

## Version 0.4.2-build-2026-02-17d
Date: 2026-02-17

What changed:
- Fixed code shortcut persistence in QDPX project files.
- QDPX export now writes each code shortcut to a Quackdas-specific XML attribute (`quackdasShortcut`).
- QDPX import now restores shortcuts from that attribute (validated to digits 1-9).

Why (one line):
- So shortcut mappings survive save/open cycles instead of resetting after reopening projects.

Files touched:
- `js/qdpx.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17e
Date: 2026-02-17

What changed:
- Fixed XSS-prone code-name rendering points by escaping code names before HTML insertion in:
  - code selection modal
  - code-view banner title
  - statistics chart labels
- Tightened CSP by removing `unsafe-eval` from `script-src`.
- Refactored OCR process invocation in Electron main process from synchronous to asynchronous (`execFile` + Promise), reducing UI blocking risk.
- Added guaranteed OCR temp directory cleanup in a `finally` block so temp files are removed on both success and failure.

Why (one line):
- To reduce script-injection risk, harden renderer policy, and improve OCR runtime stability/responsiveness.

Files touched:
- `index.html`
- `main.js`
- `js/coding.js`
- `js/render.js`
- `js/ui.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17f
Date: 2026-02-17

What changed:
- Improved scanned-PDF OCR failure diagnostics.
- OCR IPC now returns structured error details for common causes:
  - Tesseract missing (`ENOENT`)
  - language model missing
  - OCR timeout
- PDF viewer now shows the concrete OCR failure reason instead of a generic fallback message.
- OCR failure notice rendering now uses safe text nodes (no HTML injection surface from error strings).

Why (one line):
- To make OCR failures actionable for users and reduce false ambiguity when scanned PDFs cannot be text-recognized.

Files touched:
- `main.js`
- `js/pdf.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17g
Date: 2026-02-17

What changed:
- Added an in-app OCR setup help modal with platform-aware install guidance.
- Added `OCR setup help` to the header `More` dropdown for manual access at any time.
- Added an `OCR setup help` button in scanned-PDF OCR failure notices in the PDF viewer.

Why (one line):
- To make OCR dependency setup self-serve for end users when scanned PDF text extraction is unavailable.

Files touched:
- `index.html`
- `js/ui.js`
- `js/pdf.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17h
Date: 2026-02-17

What changed:
- Fixed import/open project flows so they no longer appear unsaved immediately after loading.
- Added `saveData({ markUnsaved: false })` support and applied it in import paths.
- Added lightweight, debounced persistence for document `lastAccessed` metadata in a separate localStorage key.
- Removed full snapshot writes on each document click and flush access metadata on window unload.

Why (one line):
- To prevent false dirty-state signals on freshly imported projects and reduce unnecessary large localStorage writes during document navigation.

Files touched:
- `js/state.js`
- `js/export.js`
- `js/documents.js`
- `js/app.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17i
Date: 2026-02-17

What changed:
- Extended QDPX export with a `QuackdasExtensions` block to preserve:
  - PDF region codings (`PdfRegionSelection` with region geometry + code links)
  - document metadata key/value fields
- Extended QDPX import to restore the same Quackdas extension data.
- Added best-effort cross-tool metadata mapping on import:
  - reads source-level custom attributes and source descriptions into document metadata
  - reads `Variables` + `Cases`/value nodes where present and applies values to member documents
- Added compatibility reporting for QDPX import/export:
  - `summarizeQdpxCompatibilityReport(...)` in QDPX module
  - import/export flows now show a short summary alert of transferred data and portability notes.

Why (one line):
- To improve NVivo/REFI interoperability while preserving Quackdas-specific fidelity (PDF region coding + metadata) in round-trips.

Files touched:
- `js/qdpx.js`
- `js/export.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17j
Date: 2026-02-17

What changed:
- UI consistency pass for terminology and affordances:
  - standardized `memo(s)` tooltips to `annotation(s)`
  - changed PDF preview side labels from `Note N` to `Annotation N`
- Clarified PDF import guidance text in drag/drop and import modal labels (PDF now listed explicitly anywhere file type lists are shown).
- Reduced duplicate project-open affordance noise:
  - header dropdown `Open project` item now hides when the primary `Open project` button is visible.
- Reduced inline style usage in key modals by moving layout styling into reusable CSS utility classes.

Why (one line):
- To make UI language and interaction cues more coherent and reduce avoidable confusion in core workflows.

Files touched:
- `index.html`
- `styles.css`
- `js/ui.js`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17k
Date: 2026-02-17

What changed:
- Adjusted document selection styling in the right document panel:
  - active selection is now slightly lighter and warmer (brown/red tint)
  - non-active multi-selection is also warmed and softened.
- Refined toolbar/dropdown button visuals to blend better with app chrome while keeping icon + text:
  - introduced a softer “tonal chip” treatment for Save/Import/Paste/More buttons
  - reduced high-contrast outlines and moved to warmer neutral tones
  - refined dropdown item tone, spacing, icon emphasis, and divider subtlety.

Why (one line):
- To reduce visual clunkiness in action controls and make selection state feel clearer and more consistent with the app’s warm visual language.

Files touched:
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17l
Date: 2026-02-17

What changed:
- Reverted toolbar/dropdown action controls to the previous button shape (from the tonal-chip experiment).
- Tuned action-button text size in `.doc-actions` to `14px` so it sits closer to `+ New Code` sizing while still reading slightly larger.

Why (one line):
- To keep the familiar control silhouette while improving visual size balance against the rest of the interface.

Files touched:
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17m
Date: 2026-02-17

What changed:
- Added broader search coverage:
  - search now includes document text, code descriptions, and annotations
  - results are labeled by source type (`Document`, `Code description`, `Annotation`)
  - clicking results navigates appropriately (document, code view, or annotation location target)
- Added `Project health check` in the `More` menu.
  - reports common data integrity/workflow issues (empty codes, orphan segments, unknown code refs, duplicate code names, missing core metadata, annotations linked to missing targets)

Why (one line):
- To improve analytical retrieval and provide quick project-quality diagnostics without leaving the core workflow.

Files touched:
- `index.html`
- `js/search.js`
- `js/ui.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17n
Date: 2026-02-17

What changed:
- Added automatic versioned project backups for Electron builds:
  - async snapshot backups stored in app-internal data (`userData/project-backups`)
  - debounced backups on project state changes
  - periodic backup attempts every 10 minutes
  - backup creation on manual save and autosave
- Added backup retention policy:
  - keep the latest 20 snapshots
  - keep up to one daily snapshot for the last 14 days
- Added `Restore backup…` action in `More` and a restore modal listing available snapshots.
- Added one-click restore per snapshot (loads snapshot QDPX back into the app).
- Aligned native Open Project flow to set the current project path so in-place save/backup bucketing stays consistent.

Why (one line):
- To add low-friction recovery against accidental loss/corruption without cluttering user project folders or slowing normal coding workflows.

Files touched:
- `index.html`
- `styles.css`
- `main.js`
- `preload.js`
- `js/app.js`
- `js/state.js`
- `js/ui.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17o
Date: 2026-02-17

What changed:
- Fixed startup PDF-loss workflow by auto-reopening the last used project file in Electron on app launch.
  - Startup now loads the remembered project path (QDPX/JSON) instead of relying only on local cache state.
  - Last used project path is persisted and updated on open/save, and cleared on new project.
- Added IPC bridge for renderer startup reopen (`project:openLastUsed`).
- Added a startup save guard so manual save is temporarily blocked while automatic last-project reopen is still in progress.
- Improved first-page PDF render reliability:
  - added immediate one-shot rerender pass after initial page 1 paint to avoid intermittent blank first page.
  - adjusted PDF import flow to close the import modal before triggering document rerender.

Why (one line):
- To prevent accidental overwrite of PDF-bearing projects from cache-only state and remove the blank-first-page PDF import glitch.

Files touched:
- `main.js`
- `preload.js`
- `js/app.js`
- `js/pdf.js`
- `js/documents.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17p
Date: 2026-02-17

What changed:
- Removed Electron reliance on localStorage project snapshots.
  - `loadData()` now skips localStorage project restore in Electron and starts from empty in-memory state before file reopen.
  - `saveData()` no longer writes project snapshots to localStorage in Electron.
  - localStorage project/doc-access persistence is now browser-only fallback behavior.
- Cleaned state-management comments and key naming to reflect storage behavior (`PROJECT_CACHE_KEY`, `shouldUseLocalProjectCache()`).

Why (one line):
- To ensure Electron behavior is unambiguous and file-backed, avoiding cache/state confusion around PDF-containing projects.

Files touched:
- `js/state.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17q
Date: 2026-02-17

What changed:
- Removed QDPX import summary popups from all import/open paths (including startup auto-reopen of last project).
- Kept export compatibility summary popup behavior unchanged.

Why (one line):
- To avoid noisy alerts during normal project open/import flows while preserving optional export feedback.

Files touched:
- `js/export.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17r
Date: 2026-02-17

What changed:
- Added lightweight annotation metadata:
  - annotations now support optional `tag`
  - annotations now track `edited` timestamp (alongside `created`)
  - metadata normalization added for older projects
- Enhanced annotation editing modal:
  - optional tag input
  - inline edit action for existing annotations
  - richer existing annotation display with created/edited metadata
- Added an `Annotations` mode in Code view (next to `Segments`):
  - filters for code, document, and date range
  - direct annotation search field
  - click any annotation to jump to source (snippet/PDF region/document/code)
  - annotations grouped by document, sorted by in-document location within each document
- Improved annotation search coverage:
  - global search now includes annotation tags and displays them in annotation results
- Preserved annotation metadata in QDPX round-trips via Quackdas extension attributes:
  - `quackdasTag`
  - `quackdasEdited`

Why (one line):
- To make annotation-heavy analysis easier to review and retrieve while keeping the UI lightweight and source-linked.

Files touched:
- `index.html`
- `styles.css`
- `js/memos.js`
- `js/coding.js`
- `js/render.js`
- `js/search.js`
- `js/state.js`
- `js/qdpx.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17s
Date: 2026-02-17

What changed:
- Added in-page find (browser-style) for the currently visible page/view:
  - find bar with live match highlighting, count, next/previous navigation, and close
  - works in both document view and Code view
  - preserves/reapplies highlights after rerendering current view
  - positioned in bottom-left and hidden by default; appears only when find is opened
- Remapped search shortcuts:
  - `Cmd/Ctrl+F` now opens in-page find
  - `Shift+Cmd/Ctrl+F` now opens global search modal
- Updated header search hint/shortcut display to reflect global search shortcut.

Why (one line):
- To separate quick local reading/navigation search from project-wide search and align behavior with common editor/browser patterns.

Files touched:
- `index.html`
- `styles.css`
- `js/search.js`
- `js/app.js`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17t
Date: 2026-02-17

What changed:
- Hid document zoom controls while in Code view (filtered code mode), where they do not affect displayed content.
- Kept zoom controls visible for regular document and PDF views.

Why (one line):
- To remove non-functional UI controls in Code view and reduce visual clutter.

Files touched:
- `index.html`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17u
Date: 2026-02-17

What changed:
- Fixed PDF region geometry compatibility across sessions/QDPX round-trips:
  - added region normalization (`x/y/width/height` <-> `xNorm/yNorm/wNorm/hNorm`)
  - normalized PDF region geometry on project load
  - QDPX export now writes normalized coordinates reliably (and includes norm attributes)
  - QDPX import now accepts both legacy and normalized coordinate attributes
- Fixed `Go to location` reliability for PDF-coded segments:
  - added pending PDF-region navigation when renderer is not ready yet
  - region jump now executes after PDF load and waits for page render before focusing the target overlay

Why (one line):
- To restore older PDF region thumbnails/navigation after reopening projects and make PDF location jumps consistently land on the correct page/region.

Files touched:
- `js/state.js`
- `js/qdpx.js`
- `js/pdf.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17v
Date: 2026-02-17

What changed:
- Fixed PDF navigation regressions:
  - preserved pending PDF region jumps across PDF cleanup/reload (prevents lost `Go to location` requests)
  - region coding now preserves/uses the selected region page directly when re-rendering after apply
  - PDF container scroll restoration improved after applying region codes
- Removed speech-bubble prefix from Code view annotation text beside PDF region thumbnails.
- Updated PDF region preview modal close button styling to match in-page find close button style.
- Added `Esc` support to close the PDF region preview modal.

Why (one line):
- To make PDF region navigation and coding location retention reliable while cleaning up annotation/preview UI consistency.

Files touched:
- `index.html`
- `styles.css`
- `js/app.js`
- `js/coding.js`
- `js/render.js`
- `js/pdf.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17w
Date: 2026-02-17

What changed:
- Fixed PDF jump regression when saving inline region annotations:
  - saving annotation from the inline PDF panel no longer triggers a PDF page re-render
  - document/code sidebars still refresh so annotation counts stay current
- Added `Delete coding` to Code view snippet/thumbnail right-click menu.
  - removes the selected coding segment directly from filtered Code view

Why (one line):
- To keep PDF coding position stable during annotation and speed up correction workflows in Code view.

Files touched:
- `js/coding.js`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17x
Date: 2026-02-17

What changed:
- Renamed Code view context action from `Delete coding` to `Remove coding`.
- Updated destructive context-menu styling to a more muted red tone for better UI blend.
- Refreshed undo/redo buttons with cleaner inline SVG icons (no extra assets required).
- Fixed undo/redo hover tooltips to show Mac-native shortcuts on macOS (`Cmd+Z`, `Cmd+Shift+Z`).
- Added an inset gray divider between folder content and root-level documents in the documents list.

Why (one line):
- To improve clarity and visual consistency in common editing/navigation interactions.

Files touched:
- `index.html`
- `styles.css`
- `js/app.js`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17y
Date: 2026-02-17

What changed:
- Upgraded `Project health check` from alert-only output to an integrated modal with:
  - findings panel
  - suggested fixes panel with checkboxes
  - `Apply selected` action for one-click repair.
- Added automatic fix actions for common issues:
  - remove orphan segments
  - remove segments with no codes
  - strip unknown code references
  - auto-rename duplicate code names
  - remove annotations linked to missing targets
  - normalize PDF region geometry
  - fill missing annotation `edited` timestamps
- Reduced Statistics dashboard card footprint:
  - smaller card padding/height
  - smaller label/value typography
  - tighter spacing between summary cards and charts.

Why (one line):
- To make project integrity maintenance actionable in-app while reducing visual bloat in the statistics summary area.

Files touched:
- `index.html`
- `styles.css`
- `js/ui.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17z
Date: 2026-02-17

What changed:
- Reduced Statistics summary cards significantly:
  - tighter grid spacing
  - much lower card min-height
  - smaller card padding
  - smaller label and number typography
  - reduced spacing above charts

Why (one line):
- To prevent metric cards from dominating vertical space in the Statistics modal.

Files touched:
- `styles.css`
- `CHANGELOG.md`
