# Quackdas Changelog

## Version 0.4.3-build-2026-02-18bu
Date: 2026-02-18

What changed:
- Restored right-click behavior on coded text segments in document view by making the document marker overlay layer non-interactive again (`pointer-events: none`).
- Keeps the new gutter annotation indicator visible while no longer blocking segment context-menu interactions.

Why (one line):
- To fix regression where the marker overlay intercepted right-clicks meant for coded text segments.

Files touched:
- `styles.css`

## Version 0.4.3-build-2026-02-18bt
Date: 2026-02-18

What changed:
- Removed inline annotation icon rendering inside coded document text spans.
- Added a dedicated annotation indicator in the right-side segment-marker gutter:
  - appears next to code marker lines when the coded span has annotations,
  - uses a higher-contrast ring style for better visibility,
  - clicking it opens segment annotations for that coded span.

Why (one line):
- To keep document text visually clean while preserving visible, direct access to annotations in a less intrusive location.

Files touched:
- `js/render.js`
- `styles.css`

## Version 0.4.3-build-2026-02-18bs
Date: 2026-02-18

What changed:
- Enforced explicit serif font on Code-view analytic input fields to remove remaining input rendering inconsistencies:
  - `Description` and `Notes` inputs in code description editor,
  - `Annotation` and `Tag` inputs in Code-view annotation flows (modal/inspector/PDF inline annotation panel).
- Added a visual spacer between nested subfolder content and parent-folder documents:
  - when a folder contains both subfolders and direct documents, a small vertical gap is rendered before the parent-folder document list.

Why (one line):
- To fully eliminate residual typography mismatches in Code view and improve visual hierarchy between subfolder and parent-folder document groups.

Files touched:
- `styles.css`
- `js/render.js`

## Version 0.4.3-build-2026-02-18br
Date: 2026-02-18

What changed:
- Fixed remaining typography inconsistencies for user-entered description/notes/tag content:
  - Code view `Description and notes` text now renders in serif.
  - Annotation text and tag badges in Code view and annotation lists now render in serif.
  - Folder description field now uses serif input text.
  - PDF annotation preview/inline annotation list text now renders in serif.
- Updated Coding inspector:
  - moved inspector to a fixed right-side overlay so it sits over the right document panels rather than over coded text,
  - added `Tag (optional)` input when adding an annotation from inspector,
  - added tag display in existing inspector annotation items,
  - inspector annotation input/tag text now renders in serif.
- Folder tree ordering update:
  - subfolders now render above documents at the same level inside each folder.

Why (one line):
- To complete typography consistency for analytic text, reduce inspector occlusion of coded content, and improve folder tree ordering clarity.

Files touched:
- `styles.css`
- `js/render.js`

## Version 0.4.3-build-2026-02-18bq
Date: 2026-02-18

What changed:
- Unified serif typography for Code description editor inputs:
  - `Description` single-line input now uses the same serif text style as `Notes`.
- Unified serif typography in the Code view segment-annotation modal:
  - `Tag (optional)` input now uses serif text styling to match annotation text.
- Updated the in-document annotation overlay:
  - annotation input now uses serif text styling,
  - added a small `Tag (optional)` input for parity with Code view annotation editing,
  - saving now persists optional tags for in-document annotations.

Why (one line):
- To make annotation/description editing visually consistent and keep tag behavior aligned across annotation entry points.

Files touched:
- `index.html`
- `styles.css`
- `js/coding.js`

## Version 0.4.3-build-2026-02-18bp
Date: 2026-02-18

What changed:
- Replaced Code view description editing prompt with a dedicated modal editor containing:
  - a short single-line `Description` input,
  - a larger resizable `Notes` textarea.
- Updated Code view description bar behavior:
  - description is always shown directly in Code view,
  - added `Show notes` / `Hide notes` toggle in the same text-link style as other Code view actions,
  - edit link now reads `Add description and notes`.
- Added keyboard behavior for the new editor:
  - `Enter` saves,
  - `Shift+Enter` inserts line breaks in the notes textarea.
- Added persistence support for code notes:
  - new `code.notes` field in app state normalization and code creation defaults,
  - QDPX export/import now round-trips notes via `quackdasNotes` code attribute.
- Added Escape close support for the new code description modal.

Why (one line):
- To support separated short descriptions and longer analytic notes while keeping Code view compact by default.

Files touched:
- `index.html`
- `styles.css`
- `js/render.js`
- `js/app.js`
- `js/codes.js`
- `js/state.js`
- `js/qdpx.js`

## Version 0.4.3-build-2026-02-18bo
Date: 2026-02-18

What changed:
- Reduced coded-text underline thickness from 2px to 1px.
- Adjusted tiny-range coding guard:
  - 1-2 character text selections are still blocked for adding new coding,
  - but 1-2 character selections now work for removing an already applied code (fine boundary adjustment).

Why (one line):
- To improve visual subtlety and allow precise uncoding edits at segment edges without permitting accidental tiny new codings.

Files touched:
- `styles.css`
- `js/coding.js`

## Version 0.4.3-build-2026-02-18bn
Date: 2026-02-18

What changed:
- Reworked text coding to true binary toggle semantics by range:
  - re-applying the same code to a subrange now removes that code from that subrange (with boundary splits as needed),
  - applying to uncoded portions adds the code only where absent.
- Added near-match selection snapping for text coding:
  - if a text selection is close to an existing segment boundary (roughly 90-110% style near-hit), coding actions snap to that existing segment range.
- Added minimum text coding length rule:
  - text codings of 1-2 characters are not applied,
  - tiny text segments are pruned from stored segments.
- Added exact-range coalescing for text segments:
  - merges duplicate text segments with identical boundaries to avoid duplicate code application artifacts.
- Unified shortcut coding behavior:
  - keyboard shortcut flow now routes through the same stored-selection toggle path as click-to-code for consistent behavior.

Why (one line):
- To make text coding predictable and reversible at any subrange while preventing accidental tiny codings and duplicate same-code overlays.

Files touched:
- `js/coding.js`

## Version 0.4.3-build-2026-02-18bm
Date: 2026-02-18

What changed:
- Fixed single-code highlight rendering regression:
  - coded spans with one code now use a valid single-color `linear-gradient(...)` layer instead of a raw color token in `background-image`,
  - restores highlight fill/underline visibility for one-code segments.

Why (one line):
- To ensure single-code and multi-code segments both render highlighted consistently.

Files touched:
- `js/render.js`

## Version 0.4.3-build-2026-02-18bl
Date: 2026-02-18

What changed:
- Fixed coded-text rendering so coding no longer changes paragraph flow:
  - removed inline-flex marker layout from document coded spans,
  - restored inline text flow for coded spans.
- Reworked right-side coded marker rendering in document view:
  - markers now render in a dedicated right-gutter overlay layer after text render,
  - marker bands are computed from coded span client rects and split by large vertical gaps,
  - whitespace-only coded fragments no longer emit marker lines.
- Removed inline marker element from document coded-span HTML output (markers are now overlay-only).

Why (one line):
- To ensure coding never alters text layout and to prevent marker leaks/stray marker placement in document text.

Files touched:
- `js/render.js`
- `styles.css`

## Version 0.4.3-build-2026-02-17bk
Date: 2026-02-17

What changed:
- Replaced folder emoji icon with a stylized SVG folder icon in:
  - document/folder sidebar tree,
  - move-to-folder modal list.
- Added folder drag-and-drop support:
  - folders can now be dragged onto folders to become subfolders,
  - folders can be dragged to root drop zone to move back to root,
  - includes safety checks for self-drop, cyclic nesting, and max folder depth.
- Code view header cleanup:
  - removed shortcut text in brackets after code name in `Code: ...` row,
  - kept the existing `Shortcut:` control/action on the same row.

Why (one line):
- To improve icon consistency, make folder organization more direct, and reduce duplicate shortcut labeling in Code view.

Files touched:
- `js/render.js`
- `js/documents.js`
- `js/ui.js`
- `styles.css`

## Version 0.4.3-build-2026-02-17bj
Date: 2026-02-17

What changed:
- Updated Code view subcode control styling/behavior:
  - removed checkbox UI, now a text toggle that flips between `Show subcodes` and `Hide subcodes`.
- Fixed click-to-code + shortcut selection behavior:
  - click-applied coding now clears text selection (no reselect after apply),
  - shortcut-applied coding already clears selection and now also clears stored selection state reliably,
  - multi-code modal close now clears stored selection state too.

Why (one line):
- To keep coding interactions predictable: applying a code always deselects text and subcode toggling uses cleaner text controls.

Files touched:
- `js/render.js`
- `js/coding.js`
- `js/codes.js`

## Version 0.4.3-build-2026-02-17bi
Date: 2026-02-17

What changed:
- Code view subcode toggle UI changed from checkbox to text action:
  - now shows `Show subcodes` or `Hide subcodes` and toggles on click.
- Fixed stale hidden text-selection state after shortcut coding:
  - shortcut coding now clears both native browser selection and stored `appData.selectedText`.
  - code-click apply path now ignores stale stored text selections when no live native selection exists.

Why (one line):
- To make the subcode control visually cleaner and ensure click-to-code only uses real/visible text selections.

Files touched:
- `js/render.js`
- `js/codes.js`
- `js/coding.js`

## Version 0.4.3-build-2026-02-17bh
Date: 2026-02-17

What changed:
- Removed automatic parent-code propagation when applying a subcode:
  - click-to-code (`applyCodeToStoredSelection`),
  - multi-code apply (`applySelectedCodes`),
  - shortcut coding (`quickApplyCode`).
- Added Code view controls for hierarchical navigation:
  - `Show subcodes` toggle (includes descendant subcode segments in parent code view),
  - `Go to parent code` action when viewing a subcode.
- Included the `Show subcodes` flag in retrieval preset save/load state.
- Sorted documents alphabetically by title within each folder and for root-level documents in:
  - sidebar rendering,
  - visible document order used for shift-range selection.

Why (one line):
- To make code application behavior explicit (no implicit parent coding) and improve navigation/order consistency in daily coding workflows.

Files touched:
- `js/coding.js`
- `js/codes.js`
- `js/render.js`
- `js/documents.js`

## Version 0.4.3-build-2026-02-17bg
Date: 2026-02-17

What changed:
- Started Set 6 code-quality/clutter cleanup (behavior-preserving).
- Removed a redundant Escape key listener in `setupContextMenuDismissal()` and kept centralized Escape closing via `closeUiOnEscape()`.
- Removed dead `projectFileHandle` remnants from renderer state/reset path.
- Removed a leftover PDF initialization debug log line.

Why (one line):
- To reduce event wiring duplication and dead state noise without changing user-visible behavior.

Files touched:
- `js/app.js`
- `js/state.js`
- `js/export.js`
- `js/pdf.js`

## Version 0.4.3-build-2026-02-17bf
Date: 2026-02-17

What changed:
- Started Set 5 performance pass.
- Replaced synchronous file I/O with async `fs.promises` in main project open/save/import paths:
  - open project (`openProject`, `file:openProjectFile`),
  - save project (`project:save`),
  - reopen last used project (`project:openLastUsed`),
  - document import (`file:openDocumentFile`),
  - persisted last-project metadata read/write helpers.
- Optimized document/folder tree rendering in `renderDocuments()` by pre-grouping:
  - folders by parent id,
  - documents by folder id,
  then reusing these maps during recursive render instead of repeated `.filter(...)` calls.

Why (one line):
- To reduce main-process blocking during file operations and improve document panel responsiveness on larger projects.

Files touched:
- `main.js`
- `js/render.js`

## Version 0.4.3-build-2026-02-17be
Date: 2026-02-17

What changed:
- Continued Set 4 hardening for static UI wiring in `index.html`.
- Removed remaining static inline event handlers from markup and replaced them with `data-action` attributes.
- Added centralized delegated bindings in `js/app.js` (`setupStaticActionBindings`) for:
  - header actions and toolbar actions,
  - modal button actions,
  - form submit handlers,
  - select/input change handlers.
- Replaced inline PDF.js bootstrap module script with external `js/pdfjs-bootstrap.js`.
- Verified all `data-action` values in `index.html` are mapped in `js/app.js`.

Why (one line):
- To further reduce inline-script exposure and make UI event wiring auditable in one place without changing user behavior.

Files touched:
- `index.html`
- `js/app.js`
- `js/pdfjs-bootstrap.js`

## Version 0.4.3-build-2026-02-17bd
Date: 2026-02-17

What changed:
- Started Set 4 hardening (incremental, low-break-risk):
  - Added stricter CSP directives without removing inline allowances yet:
    - `object-src 'none'`
    - `base-uri 'self'`
    - `frame-ancestors 'none'`
    - `form-action 'self'`
- Replaced high-risk dynamic inline click handlers with delegated listeners in key views:
  - Code view results area (`#documentContent`) for:
    - document-group header open,
    - segment row select/context menu,
    - annotation-card jump,
    - PDF preview button open.
  - Global search results list (`#searchResultsList`) for result activation.
  - Co-occurrence matrix/overlaps for pair selection and jump-to-location.
- Removed inline `onkeydown` from the search summary input and bound it programmatically.

Why (one line):
- To reduce CSP/inline-handler risk in the highest-exposure dynamic views while preserving current UI behavior.

Files touched:
- `index.html`
- `js/app.js`
- `js/render.js`
- `js/search.js`
- `js/ui.js`

## Version 0.4.3-build-2026-02-17bc
Date: 2026-02-17

What changed:
- Completed a broader Set 3 UI sanitization sweep for dynamic HTML rendering paths.
- Added shared escaping helpers for:
  - HTML attribute values (`escapeHtmlAttrValue`)
  - single-quoted inline JS string arguments (`escapeJsForSingleQuotedString`)
- Applied escaping to remaining high-risk inline-handler/attribute interpolations across:
  - document/folder/code list rendering,
  - code view filters/options and snippet actions,
  - co-occurrence matrix/overlap rows,
  - global search result click targets,
  - annotation modal/edit actions,
  - code-selection modal values/styles,
  - PDF preview image `src` assignment in HTML templates.

Why (one line):
- To reduce residual XSS/injection surface in `innerHTML` templates while preserving existing behavior and UI structure.

Files touched:
- `js/state.js`
- `js/render.js`
- `js/ui.js`
- `js/search.js`
- `js/memos.js`
- `js/coding.js`

## Version 0.4.3-build-2026-02-17bb
Date: 2026-02-17

What changed:
- Removed residual QDPX compatibility-report plumbing from `js/qdpx.js` (no export/import summary state retained in `window`).
- Removed now-unused QDPX summary helper functions from `js/qdpx.js`.
- Kept Save/Save As behavior as native QDPX-only persistence path.
- Updated stale persistence comment to reflect QDPX-only save format.

Why (one line):
- To fully retire legacy export-summary behavior and reduce dead compatibility code paths.

Files touched:
- `js/qdpx.js`
- `js/state.js`

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

## Version 0.4.3-build-2026-02-18aa
Date: 2026-02-18

What changed:
- Applied targeted attribute-escaping hardening in dynamic HTML templates:
  - replaced attribute-context `escapeHtml(...)` usage with `escapeHtmlAttrValue(...)` in search modal input values, code view/filter inputs, select option values, and title/data-tooltip attributes.
- Added QDPX import safety guardrails for untrusted archives:
  - archive size limit before unzip,
  - zip entry-count limit,
  - `project.qde` size limit,
  - per-source and total decompressed-read safety limits,
  - path normalization for source paths referenced from XML to reject unsafe paths.
- Added strict range validation for imported coded selections:
  - plain-text selections are now ignored when range bounds are invalid,
  - imported bounds are normalized/clamped to document content length.
- Added main-process file-size preflight checks for project/document imports:
  - `.qdpx` open/import now rejects overly large files before reading into memory,
  - document import (`.txt/.docx/.pdf`) now rejects overly large files before loading.

Why (one line):
- To reduce injection and denial-of-service risk from untrusted imported data while keeping behavior and UI flows unchanged.

Files touched:
- `main.js`
- `js/qdpx.js`
- `js/search.js`
- `js/render.js`
- `js/ui.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bf
Date: 2026-02-17

What changed:
- Added code color editing from code right-click menu:
  - new `Change colour` action in code context menu,
  - opens a color palette modal with 16 default dusty/saturated colors.
- Added high-contrast palette toggle:
  - `High contrast colours` option in the modal corner switches to an alternate 16-color palette.
- Updated default new-code color cycling to the same 16-color dusty palette.

Why (one line):
- To make code-color management faster and clearer while offering both UI-friendly and high-contrast color sets.

Files touched:
- `index.html`
- `styles.css`
- `js/ui.js`
- `js/app.js`
- `js/state.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bg
Date: 2026-02-17

What changed:
- Removed the palette-mode text indicator from the code color modal meta line.
- Modal now shows only the code name there.

Why (one line):
- To simplify the color modal header and reduce visual clutter.

Files touched:
- `js/ui.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bh
Date: 2026-02-17

What changed:
- Updated the default 16-color “dusty” code palette to a less muted, more saturated set.
- Kept the high-contrast palette unchanged.
- Synced the same updated palette for new-code default color assignment.

Why (one line):
- To improve code-color clarity while still keeping colors softer than pure primaries.

Files touched:
- `js/ui.js`
- `js/state.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bi
Date: 2026-02-17

What changed:
- Updated coded-segment visual treatment from heavy underline to a highlighted mark style:
  - tinted highlight fill in the code color,
  - 2px underline in a darker shade of the same color,
  - right-edge vertical marker in the same darker shade.
- Applied to both in-document coded spans and Code view snippet spans.

Why (one line):
- To make coded text blocks easier to parse visually while preserving strong code-color identity.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bj
Date: 2026-02-17

What changed:
- Fixed co-coding visual regression in coded spans:
  - multi-code spans now render as multi-color highlights instead of collapsing to one color,
  - removed inline-block behavior that caused unwanted line-wrap breaks after co-coding.
- Updated right-side code markers:
  - moved markers slightly outside the text block,
  - multiple codes now render as parallel vertical lines (one per code), making overlap depth visually clear.

Why (one line):
- To preserve readable co-coding visuals and show overlapping code structure without disrupting text flow.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17be
Date: 2026-02-17

What changed:
- Improved hover feedback in Code view for controls that previously had weak/no visible hover state:
  - `Add description` in Description and notes bar,
  - Retrieval presets expand/collapse toggle row,
  - `Segments` / `Annotations` switch buttons.

Why (one line):
- To keep click affordance clear after switching to default-arrow cursors across the UI.

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

## Version 0.4.3-build-2026-02-17ax
Date: 2026-02-17

What changed:
- Hardened Electron save format handling to prevent extension/content mismatches:
  - `project:save` now enforces `.json` -> JSON text writes and `.qdpx` -> binary QDPX writes.
  - save payload now supports structured data (`{ qdpxBase64, jsonText }`) and validates JSON before writing.
  - extensionless save paths are normalized using the requested format hint.
- Updated manual save and autosave callers to send both QDPX and JSON payloads so legacy `.json` projects remain valid on save/autosave.
- Fixed QDPX export source-file collision risk:
  - added unique source filename generation per document (case-insensitive collision tracking),
  - prevents duplicate-titled documents from overwriting each other inside `Sources/`.

Why (one line):
- To eliminate a high-risk data corruption path during save/autosave and prevent silent data loss in QDPX exports with duplicate document titles.

Files touched:
- `preload.js`
- `main.js`
- `js/ui.js`
- `js/app.js`
- `js/qdpx.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ay
Date: 2026-02-17

What changed:
- Removed legacy JSON project compatibility and made project I/O QDPX-only:
  - Open project dialogs now accept `.qdpx` only.
  - Save/Save As now writes `.qdpx` only and rejects non-QDPX project extensions.
  - Startup reopen now only restores `.qdpx` paths; unsupported remembered paths are cleared.
  - Native project import now accepts `.qdpx` only.
- Removed renderer-side JSON project import/export branches and old helper code:
  - removed legacy JSON branch in hidden-file-input project import.
  - removed native import JSON fallback branch.
  - removed unused legacy JSON project detection helper.
  - removed legacy JSON open IPC bridge hook (`project:openData` listener).
- Updated project file input accept filter and README to reflect QDPX-only behavior.

Why (one line):
- To simplify and harden project persistence around a single canonical format, reducing complexity and risk of format regressions.

Files touched:
- `main.js`
- `preload.js`
- `js/app.js`
- `js/ui.js`
- `js/export.js`
- `js/qdpx.js`
- `index.html`
- `README.md`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17az
Date: 2026-02-17

What changed:
- Removed the old export-style Save As flow and popup summary:
  - header dropdown “Save as…” now calls native `manualSave(true)` directly,
  - removed obsolete `exportProject()` and compatibility-summary alert helpers.
- Removed remaining browser JSON fallback in `manualSave()`:
  - browser fallback is now QDPX-only and errors clearly if QDPX export is unavailable.

Why (one line):
- To make Save As behavior consistent (native Save As only) and eliminate leftover export UI that looked like a separate export function.

Files touched:
- `index.html`
- `js/export.js`
- `js/ui.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17ba
Date: 2026-02-17

What changed:
- Applied targeted XSS-hardening to remaining high-risk UI interpolation points:
  - escaped document titles in Statistics chart rendering before `innerHTML` injection,
  - escaped code IDs and names when rendering `<option>` nodes in code-related selects,
  - escaped code color values used in inline `style` attributes for Code view snippets.

Why (one line):
- To reduce injection risk from imported/project data while keeping UI behavior unchanged.

Files touched:
- `js/ui.js`
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bb
Date: 2026-02-17

What changed:
- Improved document drag/drop behavior for multi-selection:
  - dragging a selected document now carries the full multi-selection,
  - dropping onto a folder moves all selected documents together in one operation.
- Added Enter-to-save behavior in segment annotation modal:
  - in “Annotations for Segment”, pressing `Enter` saves the annotation,
  - `Shift+Enter` still inserts a new line.

Why (one line):
- To speed up high-volume coding workflows by reducing repetitive folder moves and annotation clicks.

Files touched:
- `js/documents.js`
- `js/memos.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bc
Date: 2026-02-17

What changed:
- Fixed subfolder persistence in project save/open:
  - added a Quackdas folder-hierarchy extension in QDPX export,
  - restore folder parent links/metadata from that extension during QDPX import.
- Updated segment interaction behavior:
  - removed left-click Segment Options modal for coded text/PDF regions,
  - added `Edit boundaries` to segment right-click menu (non-PDF segments).

Why (one line):
- To preserve folder structure reliably across project reloads and streamline coded-segment interactions around right-click actions only.

Files touched:
- `js/qdpx.js`
- `js/render.js`
- `js/pdf.js`
- `js/coding.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-17bd
Date: 2026-02-17

What changed:
- Added a global cursor override to use the default arrow everywhere in the app UI.

Why (one line):
- To support a consistency test run with no special pointer/text/drag cursor states.

Files touched:
- `styles.css`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-18bv
Date: 2026-02-18

What changed:
- Added code-scoped segment annotations (`memo.codeId`) so annotations on multi-coded text can be attached to a specific code instead of implicitly applying to every code on that segment.
- Updated coded-text right-click behavior:
  - right-click now resolves the clicked color lane in a multi-code span,
  - the annotation action opens in that selected code context,
  - saved annotations keep the code linkage.
- Updated annotation rendering/counting:
  - coded-span metadata now includes code IDs and segment IDs,
  - right-gutter annotation dots are computed from current memo state,
  - annotation dots render in a fixed horizontal lane (independent of marker-line count/width).
- Fixed stale annotation-dot behavior after deleting annotations from the annotation modal by forcing immediate document/codes re-render.
- Updated code-view and search linkage for segment annotations so code-specific memos are treated as linked to their explicit code.
- Added QDPX round-trip support for code-scoped segment annotations via `quackdasCodeGUID` on notes.
- Added health-check validation/fix coverage for segment annotations whose code linkage becomes invalid.

Why (one line):
- To make multi-code annotation workflows precise and manageable, while fixing lingering marker visibility/placement issues and preserving annotation scope across saves/imports.

Files touched:
- `js/coding.js`
- `js/render.js`
- `js/state.js`
- `js/memos.js`
- `js/search.js`
- `js/ui.js`
- `js/qdpx.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-18bw
Date: 2026-02-18

What changed:
- Fixed HTML attribute escaping to correctly escape quotes/apostrophes in `escapeHtmlAttrValue`, closing attribute-breakout injection paths in dynamic UI markup.
- Hardened segment-annotation integrity rules:
  - segment memos are now pruned if their target segment no longer exists,
  - orphaned code parent links are normalized to top-level on project normalization.
- Fixed document deletion cleanup:
  - deleting a document now also deletes segment memos linked to segments in that document,
  - delete confirmation memo count now includes those segment memos.
- Fixed recursive code deletion:
  - deleting a code now deletes all descendant codes (not only direct children),
  - removes descendant codings from segments and clears active code filter if deleted.
- Fixed coded-span annotation indicator mismatch:
  - memo indicator count now matches the segment opened by indicator click.
- Added menu-open error handling in Electron main process:
  - File -> Open Project now catches failures and shows a native error dialog.

Why (one line):
- To address Batch 1 high-risk safety and data-integrity issues with minimal behavior change and low regression risk.

Files touched:
- `js/state.js`
- `js/documents.js`
- `js/codes.js`
- `js/render.js`
- `main.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-18bx
Date: 2026-02-18

What changed:
- Added one more data-integrity cleanup to code deletion:
  - when deleting a code subtree, remove `code` annotations targeting deleted code IDs,
  - remove code-scoped `segment` annotations (`memo.codeId`) that point to deleted code IDs.

Why (one line):
- To prevent orphan annotations after recursive code deletion and keep annotation counts/search results consistent.

Files touched:
- `js/codes.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-18by
Date: 2026-02-18

What changed:
- Added a lightweight QDPX serialization cache keyed by project object + revision, and reused it across save/backup paths to avoid repeated full `exportToQdpx()` work for unchanged state.
- Updated backup creation to use the shared cached serialization helper when no payload is provided.
- Updated Electron autosave to use cached QDPX payload generation and removed forced duplicate backup writes:
  - autosave now attempts a normal backup (revision-aware dedupe) instead of `force: true`.
- Updated manual save to use cached QDPX payload generation and switched backup call to revision-aware dedupe (non-forced).
- Optimized coded-span rendering hot path by replacing repeated `Array.find()` calls with per-render `Map`/`Set` lookups in `renderCodedSpan`.
- Added an early return in global search for empty/whitespace queries to avoid unnecessary full-index scans.

Why (one line):
- To reduce repeated heavy work (QDPX serialization, duplicate backups, and hot-path lookups) while preserving existing UI and save semantics.

Files touched:
- `js/ui.js`
- `js/app.js`
- `js/render.js`
- `js/search.js`
- `CHANGELOG.md`

## Version 0.4.3-build-2026-02-18bz
Date: 2026-02-18

What changed:
- Patched a Batch 2 regression risk in coded-text rendering hot path:
  - replaced per-span code-map rebuilding with a cached code lookup map keyed by project + revision,
  - keeps render behavior identical while removing repeated full-map allocations inside `renderCodedSpan`.

Why (one line):
- To avoid performance backsliding on heavily coded documents during repeated span rendering.

Files touched:
- `js/render.js`
- `CHANGELOG.md`

## Version 0.4.4-build-2026-02-19ca
Date: 2026-02-19

What changed:
- Reworked QDPX import to prioritize NVivo-style package layout and coding structure.
- Added source-file path resolution for NVivo `internal://...` references with archive lookup fallbacks (including `sources/`/`Sources/` handling).
- Updated PDF import to prefer NVivo representation text (`Representation plainTextPath`) for content offsets before falling back to inline/extracted text.
- Extended coded-segment import to support both top-level `Selections > PlainTextSelection` and NVivo nested source selections (`TextSource` / `PDFSource > Representation`).
- Added support for NVivo coding references via `CodeRef targetGUID` in addition to direct `Coding codeGUID`.

Why (one line):
- To fix empty NVivo-imported documents and missing coded segments by aligning importer behavior to NVivo QDPX conventions.

Files touched:
- `js/qdpx.js`
- `package.json`
- `index.html`
- `CHANGELOG.md`

## Version 0.4.5-build-2026-02-19cb
Date: 2026-02-19

What changed:
- Fixed NVivo code color parsing so `#RRGGBB` colors now import correctly instead of falling back to grey.
- Extended project state schema with NVivo-like entities:
  - `cases` collection (case name/description/member documents/attributes),
  - `variableDefinitions` collection (variable names/types).
- Updated QDPX export to be closer to NVivo package structure:
  - source files now written under lowercase `sources/`,
  - added `sources/.root` marker,
  - source XML paths now use `internal://...` references,
  - PDF exports now include `Representation plainTextPath` text references.
- Extended QDPX export/import for cases/variables:
  - export now writes `<Variables>` from project definitions + document/case attributes,
  - export now writes `<Cases>` with `MemberSource` and `VariableValue`,
  - import now restores variable definitions and case entities (plus document case links) while preserving current folder/document workflow.

Why (one line):
- To move Quackdas project structure closer to NVivo-style QDPX interoperability without forcing a UI redesign away from your folder-first analysis workflow.

Files touched:
- `js/qdpx.js`
- `js/state.js`
- `package.json`
- `index.html`
- `CHANGELOG.md`

## Version 0.5.0-build-2026-02-19cc
Date: 2026-02-19

What changed:
- Added a full Cases feature set distinct from thematic Codes:
  - new CASES section in the left sidebar below CODES with its own header and `+ New Case`,
  - case hierarchy rendering (parent/child, expand/collapse) with per-row linked-document count badges,
  - case selection behavior that opens a dedicated Case Sheet in the center panel.
- Implemented Case Sheet editing:
  - editable case name, parent, and type,
  - attribute key/value table editor with add/edit/delete and duplicate-key merge warnings,
  - linked-document management (open linked doc, unlink, add documents via multi-select modal).
- Added document header Cases integration:
  - `Cases:` pills for assigned cases,
  - `+` searchable picker with checkbox link/unlink behavior,
  - `Create new case...` flow from the picker.
- Implemented case operations and safeguards:
  - parent reassignment with cycle prevention,
  - delete-case flow with two options:
    - delete case only (children move to deleted case's parent),
    - delete case + descendants,
  - deletion/unlink logic preserves documents and thematic codes.
- Upgraded state model + normalization for cases:
  - canonical case shape now supports `type`, `parentId`, `attributes`, `linkedDocumentIds`,
  - migration support for legacy `docIds`/document-side links,
  - consistency sync between `case.linkedDocumentIds` and `document.caseIds`,
  - persisted `selectedCaseId` in undo/redo snapshots.
- Extended QDPX compatibility hooks for cases:
  - export/import now maps case hierarchy (`parentGUID`) and case type (`type`),
  - importer now handles nested/flat case structures and explicit source-case links into `linkedDocumentIds`.
- Updated project version to `0.5.0` and added responsive + visual styles for case UI elements.

Why (one line):
- To establish NVivo-like foundational Cases functionality (entity hierarchy + attributes + document links) with persistent storage and integrated workflow UI.

Files touched:
- `index.html`
- `styles.css`
- `js/cases.js`
- `js/render.js`
- `js/documents.js`
- `js/codes.js`
- `js/state.js`
- `js/qdpx.js`
- `js/ui.js`
- `js/app.js`
- `js/export.js`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.1-build-2026-02-19cd
Date: 2026-02-19

What changed:
- Renamed visible “Case sheet” labeling to “Case view” in the center-panel title and case context-menu action text.
- Made Case view layout density match Code view more closely:
  - Case view now uses compact `code-view-mode` content padding.
  - Case sections now use Code-view banner/card spacing patterns.
  - Reduced internal paddings/gaps in Case cards, grid rows, tables, and linked-document rows.
  - Removed the extra centered/narrow container feel by making Case view full-width within the content area.

Why (one line):
- To improve visual consistency and reduce excess whitespace so Case view feels as compact and usable as Code view.

Files touched:
- `js/render.js`
- `js/cases.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.5.2-build-2026-02-19ce
Date: 2026-02-19

What changed:
- Case view simplification:
  - removed rename and parent reassignment fields from Case view's main Case section,
  - replaced them with read-only Name/Parent display in Case view.
- Added a Case-view description and notes bar modeled on Code view:
  - same compact bar style/pattern,
  - show/hide notes toggle,
  - inline edit mode for description + notes with save/cancel.
- Fixed linked-documents empty-state overflow:
  - `No linked documents yet.` now wraps safely inside its container.
- Added hierarchy drag-and-drop parenting in both left panels:
  - codes: drag one code onto another to make it a child code (cycle-protected),
  - cases: drag one case onto another to make it a child case (cycle-protected).
- Added document context-menu action:
  - `Assign to case...` with a checkbox modal to assign/unassign the selected document to multiple cases.

Why (one line):
- To reduce friction in Case view editing, improve layout robustness, and bring hierarchy/document-case operations in line with expected NVivo-style workflows.

Files touched:
- `js/cases.js`
- `js/codes.js`
- `js/render.js`
- `js/ui.js`
- `index.html`
- `styles.css`
- `js/state.js`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.3-build-2026-02-19cf
Date: 2026-02-19

What changed:
- Extended code/case drag-and-drop to support level-aware hierarchy placement:
  - dropping in the middle of a row keeps “make child of target” behavior,
  - dropping near the top/bottom of a row moves to that row’s level (sibling level),
  - dropping on empty list background moves item to root level.
- Applied this behavior to both trees:
  - CODES panel (`code -> code`),
  - CASES panel (`case -> case`).

Why (one line):
- To make hierarchy editing predictable so users can move items back to root or to the correct level directly via drag-and-drop.

Files touched:
- `js/codes.js`
- `js/cases.js`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.4-build-2026-02-19cg
Date: 2026-02-19

What changed:
- Improved drag-and-drop hierarchy behavior for both CODES and CASES across all nesting levels:
  - row-middle drop => make dragged item a child of target,
  - row-edge drop (top/bottom) => move dragged item to target's level and reorder as sibling (before/after target),
  - list-background drop => move dragged item to root level.
- Added consistent sibling-level ordering updates by reindexing `sortOrder` for the affected level(s) after each move.
- Updated drag hover visuals:
  - removed confusing red insertion line when drop intent is “make child,”
  - kept insertion-line indicator for sibling-level reorder drops,
  - added child-intent highlight without insertion line.

Why (one line):
- To make drag-and-drop hierarchy editing fully level-aware and visually unambiguous at any depth.

Files touched:
- `js/codes.js`
- `js/cases.js`
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.5-build-2026-02-19ch
Date: 2026-02-19

What changed:
- Updated Case view information layout:
  - removed Name and Parent fields from the in-box Case section,
  - added a dedicated top banner (styled like the top Code view box) with case-relevant summary only:
    - case name,
    - parent case,
    - type,
    - linked document count.
- Kept editable Type field in the Case section for direct case metadata editing.

Why (one line):
- To reduce duplication and match the requested information hierarchy by showing case identity context in a concise top summary box.

Files touched:
- `js/cases.js`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.6-build-2026-02-19ci
Date: 2026-02-19

What changed:
- Fixed Case view Attributes section heading alignment:
  - ensured case cards use block layout instead of the center-aligned flex layout inherited from `code-view-banner`,
  - this keeps `ATTRIBUTES` pinned to the top of its box rather than vertically centering beside the table.

Why (one line):
- To match expected section-header positioning and improve visual clarity in Case view.

Files touched:
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.7-build-2026-02-19cj
Date: 2026-02-19

What changed:
- Fixed Case view section layout inheritance issue:
  - removed `code-view-banner` class from Case section cards (`Case`, `Attributes`, `Linked Documents`) so they no longer inherit flex-row layout.
- Result:
  - section titles (including `ATTRIBUTES`) now render above section content as intended.

Why (one line):
- To ensure Case view section headings are top-aligned and not vertically centered beside their content.

Files touched:
- `js/cases.js`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.8-build-2026-02-19ck
Date: 2026-02-19

What changed:
- Updated Case view section label capitalization and wording:
  - `Case` -> `Case type`
  - `Attributes` kept with initial-cap style
  - `Linked Documents` -> `Linked documents`
- Removed uppercase transform from Case view section titles so labels render with initial-letter capitalization as written.

Why (one line):
- To match requested label style and improve wording consistency in Case view headings.

Files touched:
- `js/cases.js`
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.5.9-build-2026-02-19cl
Date: 2026-02-19

What changed:
- Removed the inline `TYPE` label from the `Case type` section in Case view.
- Kept only the type input + save action, and adjusted layout so this row spans the full section width cleanly.

Why (one line):
- To simplify the Case type box UI and match the requested label-free presentation.

Files touched:
- `js/cases.js`
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.0-build-2026-02-19cm
Date: 2026-02-19

What changed:
- Extended the Statistics Dashboard with a new **Case Analysis** section containing three collapsible panels:
  - `Filter coded references`
  - `Case summary`
  - `Code × Case matrix`
- Implemented NVivo-like retrieval semantics using case-document links:
  - Code retrieval filtered by specific cases and/or case attribute exact match.
  - Case + attribute filters are intersected when both are set.
  - No case/attribute filter falls back to normal code retrieval behaviour.
- Added click-through results list in the filter panel:
  - shows document, snippet, code, and `Go to` action opening the exact coded segment.
- Added case summary tooling:
  - searchable hierarchical case selector,
  - case metadata header (name/type/attributes preview),
  - linked document + coded segment totals,
  - top codes list with click-to-prefill retrieval filtering.
- Added Code × Case matrix tooling:
  - rows by individual cases or grouped by case attribute value (with `(missing)` bucket),
  - columns by selected codes or a code group (hierarchy-based),
  - clickable cells that prefill the retrieval panel for underlying extracts,
  - totals row/column.
- Added lightweight indexing/caching for case analysis:
  - cached case/doc/attribute mappings per revision,
  - cached `(caseId, codeId)` reference counts with automatic invalidation on state revision changes.
- Added dedicated stats modal container and new styles for pickers, result lists, and matrix tables while preserving existing dashboard cards/charts.

Why (one line):
- To turn Statistics into a practical NVivo-like analysis/query surface where aggregated case/code counts always drill through to underlying coded extracts.

Files touched:
- `index.html`
- `js/ui.js`
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.1-build-2026-02-19cn
Date: 2026-02-19

What changed:
- Increased Statistics Dashboard usable width and viewport use:
  - `#statsModal` now opens at near-full width (`96vw`, max `1560px`) with scrollable height (`92vh`).
- Resized dashboard contents for medium/large datasets:
  - summary cards now render in a wider five-column layout on desktop,
  - chart label column widened substantially to reduce truncation and improve readability.
- Improved Case Analysis panel usability in the Statistics view:
  - controls grid now auto-fits with sensible minimum widths,
  - picker list height increased for longer code/case lists,
  - results list height increased to show more rows per panel.
- Added responsive fallbacks for smaller screens so the expanded desktop layout still degrades cleanly.

Why (one line):
- To make the Statistics and Case Analysis tools practically usable with medium-sized datasets by reducing cramped layouts and truncation.

Files touched:
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.2-build-2026-02-19co
Date: 2026-02-19

What changed:
- Updated Statistics dashboard chart lists to show only top 4 items by default:
  - `Most used codes` now shows top 4 entries initially.
  - `Coding progress by document` now shows top 4 entries initially.
- Added a toggle button under each chart list:
  - `Show more` expands to full list.
  - `Show less` collapses back to top 4.
- Updated Statistics dashboard heading and label capitalisation to initial-letter style:
  - modal title, chart headings, and Case analysis heading text updated,
  - stats card labels now use sentence-style casing,
  - form labels inside the Statistics dashboard no longer force uppercase.

Why (one line):
- To reduce visual overload in stats lists and align heading/label casing with the requested initial-letter style.

Files touched:
- `index.html`
- `js/ui.js`
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.3-build-2026-02-19cp
Date: 2026-02-19

What changed:
- Renamed the Statistics dashboard modal title to `Analysis dashboard`.
- Renamed the corresponding header dropdown menu item from `Statistics` to `Analysis`.
- Removed the leading `+` character from `New project` in the same header dropdown menu.

Why (one line):
- To align naming with the new analysis-focused dashboard purpose and simplify the menu label styling.

Files touched:
- `index.html`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.4-build-2026-02-19cq
Date: 2026-02-19

What changed:
- Moved `Code co-occurrence` into the `Analysis dashboard` as an embedded collapsible panel under Case analysis.
- Removed `Code co-occurrence` as a separate header menu option.
- Removed the standalone Code Co-occurrence modal/overlay from the app shell.
- Updated co-occurrence interactions to work inline in Analysis dashboard:
  - matrix cell click selects code pairs directly,
  - overlap rows click through to source segment via existing `Go to` behaviour.
- Removed now-obsolete app action bindings for opening/closing separate co-occurrence modal.

Why (one line):
- To consolidate analysis workflows in one place and eliminate duplicate modal navigation.

Files touched:
- `index.html`
- `js/ui.js`
- `js/app.js`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.5-build-2026-02-19cr
Date: 2026-02-19

What changed:
- Compacted document cards in the right-hand panel lists (`Recent` and `All documents`) to show more items at once:
  - reduced list padding,
  - reduced card internal padding and inter-card spacing,
  - tightened title/meta line spacing.
- Reduced document card text size by roughly one point:
  - title font size from `13px` to `12px`,
  - meta font size from `11px` to `10px`.

Why (one line):
- To maximize visible document count per viewport and minimize wasted vertical space in the right-side document panels.

Files touched:
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19cs
Date: 2026-02-19

What changed:
- Changed folder/subfolder document indentation to apply to the full card footprint instead of text inside the card:
  - document tree cards now use left `margin` indentation by depth,
  - internal card content no longer gets extra left padding from folder depth.
- Removed bold styling from document names in document cards:
  - title font weight changed to normal (`400`).

Why (one line):
- To make hierarchy visually cleaner by offsetting card boundaries themselves and to reduce visual heaviness in document titles.

Files touched:
- `js/render.js`
- `styles.css`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19ct
Date: 2026-02-19

What changed:
- Fixed global search navigation for PDF document results so opening a result jumps to the page containing the first match instead of always landing on page 1.
- Disabled the in-page find bar for PDF documents (including `Cmd/Ctrl+F` opening), because PDF text-layer highlighting is unreliable.
- Changed Code view snippet/region ordering (default `Sort: document`) to follow coding order using segment `created` timestamps, with stable location fallback.
- Fixed segment timestamp persistence across project close/reopen by round-tripping segment `created`/`modified` metadata in QDPX export/import:
  - plain text selections now write/read `quackdasCreated` and `quackdasModified`,
  - PDF region selections now write/read `quackdasCreated` and `quackdasModified`.
- Added segment timestamp normalization so missing `modified` falls back to `created` during project normalization.

Why (one line):
- To make search/navigation and code inspection timestamps trustworthy for PDFs and persisted projects, and to align Code view ordering with coding chronology.

Files touched:
- `js/search.js`
- `js/render.js`
- `js/qdpx.js`
- `js/state.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19cu
Date: 2026-02-19

What changed:
- Fixed pending PDF global-search navigation so PDF page jumps are applied after PDF renderer readiness (no more dropped jump that left you on page 1).
- Improved PDF page resolution for global-search character positions by mapping against page text offsets.
- Changed global-search result output for document content from one aggregated row per document to separate hit rows per mention.
- Grouped document hit rows under per-document headers with hit counts, while keeping non-document matches in a separate "Other matches" group.
- Added search-result group header styles for readability.

Why (one line):
- To make PDF global-search navigation reliable and to expose each mention as a directly navigable result while keeping results organized by source document.

Files touched:
- `js/pdf.js`
- `js/search.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19cv
Date: 2026-02-19

What changed:
- Fixed PDF global-search page targeting by mapping hit positions to pages using absolute `textItems[].start` offsets (aligned with `doc.content`) with legacy fallback.
- Kept deferred PDF page navigation handling so jumps requested before PDF readiness are still applied once rendering initializes.
- Blocked single-letter global searches (including wildcard variants like `a*`) to prevent high-hit freezes on large datasets.
- Added inline validation feedback in the global search results panel when a blocked one-letter query is submitted.

Why (one line):
- To make PDF search navigation land on the correct page consistently and to prevent expensive one-character searches from freezing large projects.

Files touched:
- `js/pdf.js`
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19cw
Date: 2026-02-19

What changed:
- Fixed a PDF navigation race in global-search flow where first-page render retry could override pending hit navigation and send users back to page 1.
- Applied pending PDF hit/region navigation before first-page stabilization retry and skipped retry when explicit navigation exists.
- Shortened one-letter search validation text to only: `Search must be at least 2 characters.`

Why (one line):
- To prevent page-1 fallback after clicking PDF hits and keep validation copy concise.

Files touched:
- `js/pdf.js`
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19cx
Date: 2026-02-19

What changed:
- Reworked PDF global-search page mapping to use robust per-page character ranges instead of a single heuristic:
  - uses stored absolute offsets when available,
  - falls back to rebuilding page ranges from live PDF text content (`getTextContent`) using the same spacing/newline logic as import,
  - falls back again to legacy cumulative text-length mapping for old data.
- Added cached page-range reuse tied to current document content length to avoid repeated recomputation.
- Kept one-letter global-search validation copy concise (`Search must be at least 2 characters.`).

Why (one line):
- To eliminate remaining PDF hit-to-page mismatches across both new and legacy PDF project data while keeping search guardrails clear.

Files touched:
- `js/pdf.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19cy
Date: 2026-02-19

What changed:
- Removed timer-based PDF jump dispatch in global search result navigation and switched to deterministic immediate dispatch right after `selectDocument(...)`.
- Cleared stale `pendingGoToRegion` and `pendingGoToCharPos` values during PDF cleanup to avoid previous attempts influencing subsequent attempts.
- Kept one-letter global-search validation as: `Search must be at least 2 characters.`

Why (one line):
- To eliminate timing-dependent PDF hit navigation behavior that could work on first attempt and fail on repeated attempts.

Files touched:
- `js/search.js`
- `js/pdf.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19cz
Date: 2026-02-19

What changed:
- Fixed intermittent PDF search-hit jumps by preserving pending PDF navigation during cleanup when it targets the currently selected document.
- Avoided unnecessary full PDF re-render when clicking multiple global-search hits in the same already-open PDF context.
- Kept deterministic immediate hit dispatch (no delay timer) for PDF global-search navigation.

Why (one line):
- To address repeat-click instability where the first PDF hit navigation could work but subsequent attempts were lost.

Files touched:
- `js/pdf.js`
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19da
Date: 2026-02-19

What changed:
- Changed PDF initial render behavior for pending global-search navigation to render the target page first (instead of rendering page 1 and then jumping).
- Preserved region-hit highlight behavior without forcing an unnecessary second render when initial target page already matches.
- Limited first-page stabilization retry to true default page-1 initial render only (no retry when navigation target page is explicit).

Why (one line):
- To remove the visible page-1 flash before jump and make global-search PDF navigation feel immediate.

Files touched:
- `js/pdf.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19db
Date: 2026-02-19

What changed:
- Added quoted-phrase support in global search parsing so multi-word queries in quotes are treated as a single term.
- Updated boolean parsing to recognize `AND`, `OR`, and `NOT` operators outside quotes while preserving quoted text literally.
- Updated one-letter-query detection to use the same tokenizer, so quoted one-letter queries (for example `"a"`) are still blocked.

Why (one line):
- To make global search support precise multi-word phrase matching without breaking existing boolean search behavior.

Files touched:
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dc
Date: 2026-02-19

What changed:
- Added page-number display for PDF document hits in global search result rows.
- Mapped each PDF hit index to a page using stored text offsets when available, with fallback to legacy cumulative text-length mapping.
- Updated PDF hit result labels to include page number (for example, `Document · page 7 · hit 2/9`).

Why (one line):
- To make multi-hit PDF global search easier to scan by showing where each hit is located before clicking.

Files touched:
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dd
Date: 2026-02-19

What changed:
- Compacted document cards in both right-hand document lists (`Recent` and `All`) by tightening vertical padding, reducing card gaps, and keeping the existing rounded/selected look.
- Added a compact card structure with a dense title row:
  - title clamped to 2 lines with ellipsis (`-webkit-line-clamp`),
  - full title exposed via browser tooltip (`title` attribute),
  - right-aligned codes-count badge shown by default.
- Kept the PDF badge inline with the title row and aligned it for compact height.
- Changed metadata visibility behavior:
  - by default, only the codes-count badge is shown,
  - chars/pages (+ participant ID when present) are hidden by default and revealed on hover, active/selected state, or focus-within (accessibility).
- Kept metadata/settings affordances compact and discoverable by revealing the metadata button on hover/active/selected/focus.

Why (one line):
- To fit significantly more document items in the same viewport while preserving readable titles and surfacing secondary metadata only when context demands it.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19de
Date: 2026-02-19

What changed:
- Removed the inserted separator gap between a folder’s subfolder block and that same folder’s own document items, so parent documents now follow directly after the last subfolder document.
- Restored bold document title text in compact document cards.

Why (one line):
- To reduce unnecessary vertical whitespace in nested folder views and improve document title scannability.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19df
Date: 2026-02-19

What changed:
- Removed bold styling from compact document title text.
- Increased compact document title font size by 1px (from `12px` to `13px`).

Why (one line):
- To restore regular title weight while keeping readability higher in compact lists.

Files touched:
- `styles.css`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dg
Date: 2026-02-19

What changed:
- Fixed global-search PDF hit page labels showing `page 0` by normalizing page numbers to valid 1-based values.
- Updated page-label rendering to only show page text when a valid page number exists.
- Added safer fallbacks in PDF hit page mapping for missing/invalid page metadata.

Why (one line):
- To ensure PDF search results display correct page labels and never show invalid `page 0`.

Files touched:
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dh
Date: 2026-02-19

What changed:
- Fixed global-search PDF page labels that were collapsing to page 1 by improving page-number resolution for legacy page metadata.
- Added support for multiple page-number field names and 0-based legacy page numbering, with deterministic fallback to page array order.
- Updated PDF page-range sorting for label mapping to use character start offset ordering when offset data exists.

Why (one line):
- To make PDF hit labels reflect the correct page across both current and older stored PDF page schemas.

Files touched:
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19di
Date: 2026-02-19

What changed:
- Fixed PDF global-search page labels always showing page 1 by prioritizing `pdfTextPositions` absolute offsets for hit-to-page mapping.
- Added compatibility fallbacks for legacy text item schemas in page mapping:
  - supports `start/end` and `startIndex/endIndex`,
  - supports text fields `text` and `str` when estimating page lengths.

Why (one line):
- To produce accurate per-hit PDF page labels across both current and legacy project formats.

Files touched:
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dj
Date: 2026-02-19

What changed:
- Implemented a shared PDF hit-to-page resolver function (`pdfResolvePageForCharPos`) in `pdf.js` and used it for both:
  - actual navigation (`pdfGoToPosition`), and
  - global-search PDF page labels.
- Extended resolver fallbacks to support unopened PDFs by optionally reading text directly from stored PDF binary data and caching computed page ranges.
- Updated global search flow to await async page-resolution so labels reflect the same mapping logic used for navigation.

Why (one line):
- To ensure PDF page labels in global search are derived from the exact same resolver as navigation, eliminating inconsistent page reporting.

Files touched:
- `js/pdf.js`
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dk
Date: 2026-02-19

What changed:
- Added persistence for the last global-search session (query + result list) so reopening the app/project restores the previous global-search view.
- Restored the saved global-search state when opening the global search modal, instead of always starting from an empty prompt.
- Scoped persisted search state by current project signature to avoid showing unrelated results across projects.

Why (one line):
- To keep global-search context available across window closes so users can continue where they left off.

Files touched:
- `js/search.js`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dl
Date: 2026-02-19

What changed:
- Added post-render single-line detection for compact document card titles in both right-hand document lists.
- Applied a dedicated class (`document-item-single-line-title`) to cards whose titles render on one line.
- Vertically centered title-row content only for those single-line cards (title row elements, code badge, PDF/memo badges, metadata button).

Why (one line):
- To improve visual balance and readability by centering short document titles without affecting two-line title cards.

Files touched:
- `js/render.js`
- `styles.css`
- `CHANGELOG.md`

## Version 0.6.6-build-2026-02-19dm
Date: 2026-02-19

What changed:
- Standardized compact document-card PDF badge vertical alignment so it is always centered in the title row.
- Removed the PDF badge top-offset style that caused inconsistent positioning between cards.

Why (one line):
- To ensure consistent, predictable badge alignment across document cards regardless of title wrapping.

Files touched:
- `styles.css`
- `CHANGELOG.md`
