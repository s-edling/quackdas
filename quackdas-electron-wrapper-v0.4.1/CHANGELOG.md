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
