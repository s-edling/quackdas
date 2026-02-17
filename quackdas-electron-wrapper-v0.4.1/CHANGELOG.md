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

## Version 0.4.2-build-2026-02-17aa
Date: 2026-02-17

What changed:
- Added virtualized rendering for `Code view -> Segments`:
  - rows are now windowed based on viewport + overscan
  - only near-viewport snippets/thumbnails are mounted in the DOM
  - dynamic row-height measurement keeps mixed text/PDF rows aligned
  - scroll listener is attached only while in segmented Code view and cleaned up outside it
- Updated PDF region preview hydration to work with virtualized containers and avoid rehydrating already-rendered previews.

Why (one line):
- To keep Code view smooth on large projects by reducing DOM size and render work during scrolling.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17ab
Date: 2026-02-17

What changed:
- Added incremental global search indexing:
  - in-memory search index now stores normalized entries for documents, code descriptions, and annotations
  - lazy index reconciliation runs only when state is marked dirty
  - add/update/remove reconciliation is key-based, so unchanged entries are retained
- Global search now queries indexed entries instead of rebuilding source lists on every query.
- Wired index invalidation into state lifecycle:
  - marked dirty on project load/reset paths
  - marked dirty on `saveData()` updates.

Why (one line):
- To improve repeated-search responsiveness while keeping search results current after edits/imports.

Files touched:
- `js/search.js`
- `js/state.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17ac
Date: 2026-02-17

What changed:
- Added a bounded background PDF thumbnail generation queue:
  - priority-based scheduling (visible previews first, background precompute after)
  - limited worker concurrency to reduce UI blocking
  - shared inflight de-duplication and cache reuse
- Added lightweight per-project thumbnail manifest metadata in localStorage:
  - tracks recently generated thumbnail keys by project name
  - retained with size cap and debounced writes
- Updated Code view PDF preview hydration:
  - requests high-priority thumbnails for near-viewport items
  - enqueues offscreen thumbnails as low-priority background work
  - avoids blocking render on serial thumbnail generation.

Why (one line):
- To improve perceived smoothness in Code view with many PDF region codings while keeping background work bounded.

Files touched:
- `js/pdf.js`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17ad
Date: 2026-02-17

What changed:
- Added a lightweight Coding Inspector panel (Code view / Segments mode):
  - appears when a snippet/region is selected
  - quick code assignment toggles
  - annotation history list
  - source location + created/modified timestamps
  - quick add-annotation input
- Added Retrieval Presets in Code view:
  - save/load named presets
  - preset state includes mode + segment filters/sorts + annotation filters
  - added practical segment retrieval controls (document filter, with/without annotation, sort by document/date/metadata)
- Added Code Co-occurrence tools:
  - new `Code co-occurrence` modal from `More`
  - code-by-code matrix (top-used codes)
  - clickable cells to open overlap retrieval list
  - overlap list jumps directly to source segment location
- Added QDPX round-trip support for retrieval presets in Quackdas extension block.

Why (one line):
- To add high-impact analytical tooling (compare/retrieve/inspect) while keeping advanced UI surfaces optional and compact.

Files touched:
- `index.html`
- `styles.css`
- `js/render.js`
- `js/ui.js`
- `js/state.js`
- `js/qdpx.js`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17ae
Date: 2026-02-17

What changed:
- Compactness pass for Code view:
  - reduced vertical spacing/padding across code banners
  - tightened Description/notes block spacing
  - compacted document headers/snippet row spacing
  - reduced PDF preview footprint in snippet rows
  - lowered virtual row height estimates to reduce oversized gaps
- Retrieval presets panel is now collapsible:
  - replaced always-open controls with a single-row toggle (`▸ / ▾`)
  - expanded controls appear only when opened
- Updated Code-view header label from `All documents · CODE` to `Code view · CODE`.
- In-page find behavior in Code view is now scoped to visible snippet content only:
  - searches coded snippet text and visible snippet annotation text
  - excludes banner/header/meta UI text.
- Coding inspector annotation input typography now matches saved annotation text size.

Why (one line):
- To improve scan density and readability in Code view while keeping advanced controls discoverable but unobtrusive.

Files touched:
- `js/render.js`
- `js/search.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.2-build-2026-02-17af
Date: 2026-02-17

What changed:
- Tightened Code view top-stack spacing further:
  - reduced vertical gaps between banner, mode switch, presets row, and description row
  - made closed-state spacing visually even between the top rows
- Updated Retrieval presets expansion behavior:
  - expanded preset controls now open inside the same presets box (no separate box below)
- Compacted Code view snippet density further:
  - reduced PDF preview row gaps, preview footprint, and memo spacing
  - lowered virtualized row height estimates to reduce excess blank space between items
- Removed the per-thumbnail three-dots button for PDF snippets in Code view.
- Updated remove-coding confirmation copy to: `Remove this coding?`

Why (one line):
- To improve scan density and visual consistency in Code view while keeping interactions unchanged.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ag
Date: 2026-02-17

What changed:
- Increased app version from `0.4.2` to `0.4.3`.
- Code view compactness pass (stronger):
  - reduced vertical spacing between top banners/rows
  - tightened spacing for description row and document headers
  - removed extra vertical spacing in snippet rows
- Fixed Code view layout whitespace behavior:
  - added `#documentContent.code-view-mode` to disable global `pre-wrap` spacing artifacts in Code view
  - this removes unintended blank vertical gaps between UI rows/snippets
- Retrieval presets panel behavior:
  - collapsed state is now a single compact row
  - expanded controls open vertically inside the same box
- Further tightened virtual row height estimates for denser snippet rendering.

Why (one line):
- To make Code view materially denser and remove wasted vertical space while keeping retrieval controls compact.

Files touched:
- `package.json`
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ah
Date: 2026-02-17

What changed:
- Reordered top Code view boxes to:
  - `Code: ...`
  - `Description and notes`
  - `Retrieval presets`
  - `Segments / Annotations`
- Aggressively reduced Code view vertical spacing:
  - tighter top box padding/margins
  - tighter document headers, snippet rows, and memo spacing
  - lower virtual row height estimates for denser rendering
  - Code view now uses a dedicated compact container (`code-view-content`)
- Made Retrieval presets collapsed state a true single-row box:
  - compact row height when closed
  - vertical in-box expansion when opened
- Header stability/UI tweaks:
  - fixed save button width so global search does not shift when save text changes
  - increased top-left logo size to 78x78 and raised header height to preserve border/layout integrity.

Why (one line):
- To make Code view substantially denser and stabilize top-header alignment while enlarging branding safely.

Files touched:
- `js/render.js`
- `styles.css`
- `index.html`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ai
Date: 2026-02-17

What changed:
- Rebalanced Code view density after the aggressive compact pass:
  - increased spacing between top boxes for clearer separation
  - increased snippet/document row spacing and typography line-height for readability
  - increased thumbnail and annotation spacing so PDF region rows are easier to scan
- Kept the fundamental Code-view whitespace fix (`code-view-mode`) in place to avoid the old inflated gaps.

Why (one line):
- To restore clear visual grouping in Code view while preserving the fixed spacing model.

Files touched:
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17aj
Date: 2026-02-17

What changed:
- Added more breathing room in Code view:
  - increased spacing between top boxes
  - increased spacing between snippets and document section headers
  - slightly increased line-height for snippet/annotation readability
- Rescaled top-left logo to 80% of prior enlarged size:
  - logo changed from 78x78 to 62x62
  - reduced header height from 84px to 68px to avoid an oversized top bar.

Why (one line):
- To keep Code view readable without the cramped look and restore a better header proportion.

Files touched:
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ak
Date: 2026-02-17

What changed:
- Increased Code view spacing by another full step:
  - larger separation between top boxes
  - larger spacing between snippet blocks and PDF thumbnail rows
  - increased text line-height/size for snippet readability
- Fixed PDF thumbnail overlap in virtualized Code view:
  - increased estimated row heights for safer initial layout
  - trigger virtual-list remeasure when preview images load so row heights update immediately.

Why (one line):
- To make Code view clearly separated (not cramped) and prevent thumbnails from intruding into the next row.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17al
Date: 2026-02-17

What changed:
- Code view presets row sizing:
  - reduced closed-state presets row vertical footprint to match other one-row top boxes more closely
- Snippet spacing refinement:
  - moved snippet vertical spacing from external margins to internal padding so virtualized row measurement includes spacing
  - preserves balanced space above and below snippet content/underline separators
- PDF thumbnail overlap fix:
  - this spacing change prevents virtualized row overlap from margin under-measurement
  - increased Code view thumbnail render/display size by ~20% (`250px` preview width, `312px` generation width)

Why (one line):
- To keep top controls visually consistent, improve snippet rhythm, and prevent thumbnail overflow into subsequent rows.

Files touched:
- `styles.css`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17am
Date: 2026-02-17

What changed:
- Fixed virtualized Code-view PDF row remeasurement:
  - thumbnail image load now forces a virtual-list rerender/re-measure pass
  - prevents stale pre-image row heights from causing separator/row collisions
- Refined snippet separator layout:
  - replaced absolute pseudo-line with real row `border-bottom`
  - added explicit bottom spacing in snippet and PDF row blocks so text/thumbnail content no longer sits on the separator.

Why (one line):
- To stop PDF snippet separators from overlapping thumbnail/content rows and restore visible space below snippets.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17an
Date: 2026-02-17

What changed:
- Fixed virtualized snippet spacing math:
  - removed external bottom margin from snippet separator rows (not counted by virtual row measurement)
  - moved spacing into internal padding/margins so measured row height matches visual height
- Added extra thumbnail remeasure pass for cached-image cases:
  - after inserting preview image, if `img.complete` is already true, queue an additional forced virtual rerender
- Normalized closed Retrieval presets row height:
  - restored presets box vertical size to match other one-row Code view boxes.

Why (one line):
- To eliminate separator overlap artifacts in Code view and keep the closed presets row visually consistent.

Files touched:
- `styles.css`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ao
Date: 2026-02-17

What changed:
- Switched Code-view snippet separation to use the code-colored snippet underline only:
  - removed extra gray per-row border separator in filtered snippets
  - added explicit bottom padding/margin on `.coded-segment` so text sits above the underline with visible gap below
- Added PDF-specific snippet spacing:
  - introduced `pdf-snippet` row class in render output
  - increased spacing below PDF preview rows and below PDF snippet underlines.

Why (one line):
- To fix persistent “line touching/cutting content” issues by separating snippet content from its underline and giving PDF rows dedicated vertical breathing room.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ap
Date: 2026-02-17

What changed:
- Increased snippet underline spacing in Code view:
  - more gap between snippet text and its underline
  - more gap under underline before the next snippet block
- Hardened PDF region row layout against line collisions:
  - clamped preview height (`max-height: 220px`) to keep row geometry bounded
  - increased virtualized PDF row initial estimate from `120` to `320` to avoid under-allocation before remeasure.

Why (one line):
- To make snippet line spacing visibly balanced and prevent PDF thumbnails from breaking separator lines.

Files touched:
- `styles.css`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17aq
Date: 2026-02-17

What changed:
- Fixed persistent PDF thumbnail overlap in Code view by changing rendering strategy:
  - when segmented Code view contains PDF-region rows, rendering now uses normal DOM flow (non-virtualized list)
  - virtualization remains in use for text-only segment lists
- PDF previews in non-virtual mode are still hydrated lazily via existing preview hydration logic.

Why (one line):
- Absolute-position virtualization was still producing row collisions for mixed-height PDF previews; normal flow guarantees correct stacking.

Files touched:
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ar
Date: 2026-02-17

What changed:
- Adjusted Code view annotation placement for text snippets:
  - snippet annotations are now rendered inside the coded snippet block (above the snippet underline)
  - annotation text is right-aligned with a right-side accent marker for clearer “data vs annotation” distinction
- Kept PDF snippet annotation layout unchanged (right-side column next to thumbnail).

Why (one line):
- To make annotations visually distinct while preserving clear linkage to their snippet.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17as
Date: 2026-02-17

What changed:
- Removed inline three-dots annotation button from Code view snippets:
  - annotation access in Code view is now via right-click/context menu only
  - removed related render path and unused helper/CSS for that inline button
- Aligned PDF-region annotations to match text-snippet annotation style:
  - region annotations (shown beside thumbnails) are now right-aligned with right-side accent marker.

Why (one line):
- To declutter snippet UI and make annotation presentation consistent across text and PDF region codings.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17at
Date: 2026-02-17

What changed:
- Added centralized `Esc` close handling for open UI layers:
  - closes (in priority order): context menu, in-page find, PDF region preview, Annotations modal, Statistics, Code co-occurrence, Project health, Global search, text prompt, and Coding inspector
  - includes a safe fallback to close the topmost `.modal.show` dialog if a specific closer is not mapped
- Replaced prior narrow Esc handling (find bar + PDF preview only) with the new shared close dispatcher.

Why (one line):
- To make Escape consistently close open windows/panels across the app.

Files touched:
- `js/app.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17au
Date: 2026-02-17

What changed:
- Recent documents panel sizing:
  - removed hardcoded `180px` inline max-height
  - added dynamic sizing to show exactly three full recent-document cards (and no partial fourth) when four or more recents exist
- Annotation list layout in document annotation modal:
  - forced existing-annotation items/content to top-left alignment
  - removed implicit fixed-height behavior so annotation card height follows text content
- Escape behavior fix for annotation overlay/modal:
  - Esc close stack now runs before PDF-selection Esc handling, so open annotation windows close reliably on Esc.

Why (one line):
- To make the right sidebar look orderly, improve annotation readability, and ensure Esc closes annotation UI consistently.

Files touched:
- `index.html`
- `styles.css`
- `js/render.js`
- `js/app.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17av
Date: 2026-02-17

What changed:
- Recent documents viewport now targets the exact bottom of the 3rd card:
  - switched sizing logic from summed margins to `thirdCard.offsetTop + offsetHeight`
  - removes the remaining visible sliver of card #4 at top scroll position
- Inline annotation overlay layout refinement:
  - forced existing annotation items to true block/top-left flow (`height:auto`, `text-align:left`, `word-break`)
  - removed template whitespace around annotation text during rendering to prevent awkward placement
- Esc close behavior for inline annotation overlay:
  - added explicit close step in global Esc close stack
  - added textarea-level Esc handling inside inline annotation panel.

Why (one line):
- To make the recent list exactly three cards tall, clean up annotation text placement, and ensure Esc closes inline annotation UI consistently.

Files touched:
- `js/render.js`
- `styles.css`
- `js/coding.js`
- `js/app.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17aw
Date: 2026-02-17

What changed:
- Recent documents exact-3 sizing refinement:
  - switched from `offsetTop`-based measurement to `getBoundingClientRect()` delta (list top -> third-card bottom)
  - avoids offset-parent/header contamination that could oversize the recent list viewport
- Inline annotation card alignment hardening:
  - set annotation items to explicit top-left flex layout (`justify-content:flex-start`, `align-items:flex-start`)
- Esc close reliability hardening:
  - added capture-phase Escape fallback that runs `closeUiOnEscape()` before bubbling handlers
  - ensures overlay/modal close works even when focused controls intercept key events.

Why (one line):
- To make the recent list clamp to exactly three cards and make annotation/Esc behavior robust under real runtime focus/layout conditions.

Files touched:
- `js/render.js`
- `styles.css`
- `js/app.js`
- `CHANGELOG.md`
