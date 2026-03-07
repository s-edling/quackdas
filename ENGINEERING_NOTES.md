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

- 2026-03-07: Treat project replacement (`Open`, `Open last used`, `Restore backup`, `New project`) as a state-boundary transition, not a plain `appData = ...` assignment. Clear undo/redo, bump `appDataRevision`, and reset project-local PDF/UI transients before the new project becomes interactive, or caches/history can leak across projects.
- 2026-03-07: Do not commit `currentProjectPath` or the remembered last-project pointer before QDPX import succeeds in the renderer. The save handle must only move after the new project has replaced the current in-memory project, or a failed open can redirect later saves/autosaves into the wrong file.

## Agent/API Surface

- 2026-03-07: `window.quackdasAgent` is an intentional shipped automation surface. Keep it explicit and conservative: document reads should expose revision/editability state, and `docs.update` should reject PDF docs, coded docs, and rich-text docs instead of silently invalidating coded offsets or leaving stale `richContentHtml`.

## Import/Export Quirks (QDPX/NVivo)

- 2026-03-06: Keep QDPX import/export testable without changing the browser-global runtime model. For `js/qdpx.js`, prefer guarded CommonJS exports plus a narrow test-only DOM shim over introducing a renderer bundler/module rewrite.
- 2026-03-07: Persist OCR-derived PDF page geometry in QDPX alongside the PDF source, not just the extracted plain text. Reopened scanned PDFs need `doc.pdfPages` word boxes to avoid rerunning OCR and to preserve PDF text-coding/go-to-location behavior across save/load and backup restore.

## PDF Handling

- 2026-03-06: Treat the PDF.js DOM text layer as a visual affordance, not the canonical source of persisted offsets. Reliable PDF coding needs a Quackdas-owned page text geometry model keyed to document offsets; DOM span structure is too unstable across PDFs/render passes to serve as the primary anchor.
- 2026-03-06: Keep PDF rendering split between the parent renderer and the iframe host. `js/pdf.js` should own coding state, offsets, page navigation, and persistence-facing logic; `js/pdfjs/web/quackdas-viewer.*` should stay a same-origin rendering/input surface built on the official PDF.js viewer pipeline.
- 2026-03-07: Keep the PDF iframe host on an explicit message contract. Parent/host communication should go through validated `postMessage` payloads with per-render session IDs, not direct parent callbacks, so stale events are dropped and the trust boundary stays documented.
- 2026-03-07: Do not block normal scanned-PDF opening on full-document OCR. Render the PDF immediately and continue OCR in the background unless Quackdas needs OCR synchronously to resolve a pending character-offset jump; otherwise large scanned PDFs feel frozen on every open.
- 2026-03-06: For legacy PDFs loaded from older projects, do not assume `pdfPages[*].textItems[*]` already have absolute `start`/`end` offsets. Reconstruct them against `doc.content` at runtime before deciding whether PDF text mode is available, or older PDFs will be stuck in region-only mode.
- 2026-03-06: Reopened projects may also be missing `doc.pdfPages` entirely even when the PDF binary is still present. Lazily rebuild page geometry from the live PDF on first open, then let OCR upgrade image-only pages when needed.
- 2026-03-06: After coding a PDF text selection, do not re-run `renderCurrentDocument()`. Refresh the sidebars plus iframe page decorations in place; a full document render resets the embedded PDF viewer to page 1 and drops text-coded overlays/flash navigation.
- 2026-03-06: For OCR/scanned PDFs, do not rely on native browser selection over transparent absolutely positioned OCR words. Use the OCR geometry/offset model for drag selection and draw the active selection overlay yourself, or selection ranges and scroll behavior become unstable.
- 2026-03-06: PDF text selections inside the iframe must survive transient browser `selectionchange` collapse/blur events long enough for sidebar code clicks and shortcuts to consume them. Clear stored PDF selections only on explicit clear, page change, or mode change, not every empty selection event.
- 2026-03-06: When validating born-digital PDF selections against `doc.content`, normalize line-wrap hyphenation before comparing. Browser-native selection may preserve forms like `Sve-\nrige` while imported/plain-text content has `Sverige`, and treating those as different causes false selection rejection on some regions/pages.
- 2026-03-06: Do not snap PDF text selections to nearby existing coded segment boundaries before applying/removing codes. PDF selections already come from the geometry/offset model; snapping can over-extend coding or uncoding into adjacent same-code passages on the same page.
- 2026-03-06: Treat PDF zoom in Quackdas as a relative multiplier over a fit-width baseline, not as raw PDF.js scale units. The toolbar’s `100%` should mean “current page fits the viewer width without horizontal scrolling,” even when different PDFs/pages have different native widths.
- 2026-03-06: The coding inspector should be a document-side overlay, not something coupled to Code view. Context-menu inspector actions from text documents or PDFs should keep the user in the current document and open the inspector in the right panel.
- 2026-03-06: Born-digital PDF selection mapping should not stop at “all chars whose rect intersects the browser selection.” Small rect overshoot can widen the range. After geometry hit-testing, refine the approximate range against the browser-selected text in a small local window before storing offsets/applying codes.
- 2026-03-06: Any PDF mutation path that still re-renders the current document must queue `currentPdfState.pendingGoToPage` first if it intends to keep the user on the same PDF page. Otherwise `renderPdfDocument(...)` will reopen the embedded viewer on page 1 before navigation state is reapplied.
- 2026-03-07: Editing boundaries of a PDF text-coded segment is also a PDF mutation path. Treat it like code apply/remove: refresh sidebars plus PDF decorations in place when the edited segment belongs to the currently open PDF, or the boundary-save flow will still reopen the viewer on page 1.
- 2026-03-06: For Quackdas PDF zoom, a raw viewport-based fit-width estimate is not enough on its own. Calibrate the initial fit-width scale against the actual rendered page width after PDF.js applies layout/rounding, or `100%` can still overflow horizontally on some PDFs.
- 2026-03-06: Disk-image startup auto-mount failures caused by blocked local agent apps should not be silent. Even when Quackdas can continue without mounting the image, surface a startup warning in the renderer so the user knows disk-image mode did not activate as configured.
- 2026-03-06: Startup disk-image warnings should key off the recorded `prepareStartupMount()` result, not only live status polling. By the time the renderer asks for status, blocked-app process detection can differ from the startup attempt; preserve the startup result in main-process runtime state and expose it through `diskImage:getSettings`.
- 2026-03-07: For the user-facing disk-image warning, checking only a failed auto-mount attempt is too narrow. Startup warning logic should look at the active disk-image status plus current blocked apps, so it also warns when the configured image was already mounted before launch.
- 2026-03-06: For embedded PDFs, do not leave the iframe host as a centered auto-sized flex item. Make the parent `.pdf-container` and `.pdf-container-host` fill the content pane, or the viewer ends up framed by extra blank space even when fit-width zoom is correct.
- 2026-03-06: PDF mode must also clear the normal document-text column constraint on `#documentContent`. If `.document-text` keeps its `max-width: 680px; margin: 0 auto;` in PDF mode, every embedded PDF viewer will be rendered inside a narrow centered text column regardless of its own internal sizing.
- 2026-03-06: For blocked disk-image auto-mount at startup, prefer a main-process warning dialog tied directly to the startup mount result. A renderer-only alert path is too easy to miss due to load timing, focus, or later state refresh.
- 2026-03-07: Reopening the last project from a just-mounted disk image can race the volume becoming readable. In the startup `project:openLastUsed` path, add a short access retry before declaring the remembered project “missing,” or Quackdas can mount the image successfully and still fail to reopen the last project on that volume.
- (Add notes)

## Performance Constraints

- 2026-03-06: Avoid defaulting to `renderAll()` for common code/case/memo edit paths. Refreshing only the affected sidebars plus the current content pane materially reduces redraw cost on larger projects without changing the renderer architecture.

## Packaged vs Dev Differences

- 2026-02-25: Do not use broad Electron Builder packaging globs like `build.files: ["**/*"]` after repo layout changes. Root-level archives/local artifacts (for example `*.zip`) can be silently swept into `app.asar`, causing major installer/app size regressions and potential data leakage. Keep a runtime-file allowlist in `package.json` (`index.html`, `main.js`, `preload.js`, `styles.css`, `js/**`, `assets/**`, `semantic/**`) and explicit excludes for `.env*`, secret-like filenames, tests/tools/docs, and corpus-like data files.
- 2026-03-06: When splitting main-process code out of `main.js`, remember that Electron Builder packaging is allowlist-based here. Add any new privileged helper directory (for example `electron-main/**`) to `build.files`, or packaged builds can succeed in dev but fail after packaging.
- 2026-03-06: macOS `Disk image storage` is an opt-in derived-storage mode, not a new persistence default. When enabled, backups and semantic indexes should follow the saved project path; unsaved projects still need app-local fallback until a concrete `.qdpx` path exists.
- 2026-03-06: macOS auto-unmount should only target disk images Quackdas mounted in the current session. Do not auto-detach a volume that was already mounted before launch unless there is an explicit future setting for that behavior.
- 2026-03-06: Do not assume Electron dev runs inherit a shell `PATH` that includes Homebrew binaries. OCR/Tesseract lookup should probe explicit env overrides plus common install paths like `/opt/homebrew/bin/tesseract`, not only `execFile('tesseract', ...)`.

## Disk Image Mode

- 2026-03-06: Agent-app detection for disk-image auto-mount is inherently a curated denylist, not a universal detector. Keep it macOS-only, use exact configured app/process-name substrings, and make the list user-editable.
- 2026-03-07: For disk-image blocked-app detection, do not substring-match arbitrary `ps` command lines. Match exact primary app names from the launched executable path instead, or helper processes and unrelated system services like `CursorUIViewService` will show up as false-positive “blocked apps.”
- 2026-03-06: Quit-time detach must wait for semantic workers and tracked project writes to settle. Otherwise the semantic SQLite store or backup writes can be interrupted during unmount.
- 2026-03-06: Project-local semantic indexes for disk-image mode should be hidden by default. Migrate older visible `project.semantic.sqlite` files to the hidden dotfile path when the project is reopened.

## UI Guardrails

- 2026-02-24: Semantic Ask loose-mode responses may arrive with citation markers as `[n]` or legacy placeholders like `@@SEMCITE0@@` / `@@SEM_CITE_0@@`. UI rendering should normalize both into clickable source chips.
- 2026-02-24: When rendering markdown-like Ask prose, use citation placeholder tokens that do not contain markdown control characters (such as `_`) to avoid accidental emphasis parsing before token replacement.
- 2026-02-25: For delegated `contextmenu` handlers, do not assume `event.currentTarget` is the interactive element; in document-level delegation it is `document`. Resolve actionable nodes from `event.target.closest(...)` before using element-only APIs like `getClientRects()`.
- 2026-02-26: In Code view (segments mode), avoid DOM-mutating in-page-search highlight wrappers around snippet text because snippet rendering depends on preserved `<br>` structure for paragraph spacing. Prefer non-mutating highlight rendering (`Range` + CSS `::highlight`) and keep a fallback path only for environments without highlight API support.
- 2026-02-26: For high-frequency coding cleanup actions (`Remove coding`, `Remove all coding`), prefer immediate execution plus reliable undo over confirmation dialogs. Confirmation prompts in this path reduce throughput and are redundant when history/undo is stable.

## High-Risk Regression Checklist

- (Add notes)
