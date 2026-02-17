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
