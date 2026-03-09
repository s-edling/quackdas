# Quackdas Architecture

## Purpose

This document describes the durable structure of Quackdas: runtime boundaries, major modules, persistence rules, and the invariants that matter when changing the app. It is meant for contributors and coding agents working on non-trivial changes.

Consult this file before changing:
- project loading/saving or backup behavior,
- IPC or Electron security boundaries,
- cross-module renderer behavior,
- QDPX import/export,
- semantic indexing / Ask the corpus,
- the agent or CLI integration surface.

Update this file when those areas change in a way that affects how the system is organized, not for every bug fix.

## System overview

Quackdas is a local-first Electron desktop app for qualitative coding.

The app has three main runtime layers:

1. Main process
   - File system access, native dialogs, backups, OCR invocation, semantic worker orchestration, disk-image mount/unmount gating, online-observation sidecar watching, localhost observation ingestion, and app/window lifecycle.
   - Entry point: [main.js](/Users/st3583ed/Documents/Kodning/Quackdas/main.js)
   - Feature helpers: [electron-main/project-backups.js](/Users/st3583ed/Documents/Kodning/Quackdas/electron-main/project-backups.js), [electron-main/ocr-service.js](/Users/st3583ed/Documents/Kodning/Quackdas/electron-main/ocr-service.js), [electron-main/disk-image-storage.js](/Users/st3583ed/Documents/Kodning/Quackdas/electron-main/disk-image-storage.js), [electron-main/online-observation.js](/Users/st3583ed/Documents/Kodning/Quackdas/electron-main/online-observation.js), [electron-main/online-observation-server.js](/Users/st3583ed/Documents/Kodning/Quackdas/electron-main/online-observation-server.js)

2. Preload bridge
   - Narrow IPC wrapper exposed as `window.electronAPI`.
   - Entry point: [preload.js](/Users/st3583ed/Documents/Kodning/Quackdas/preload.js)

3. Renderer
   - Single-page HTML/CSS/JS app with global functions and shared in-memory state.
   - HTML shell: [index.html](/Users/st3583ed/Documents/Kodning/Quackdas/index.html)
   - Bootstrap: [js/app.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/app.js)
   - Shared state: [js/state.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/state.js)

There is no bundler or framework layer. Renderer scripts are loaded directly from `index.html`, so script order is an architectural dependency.
The main PDF viewer is the one deliberate exception: `js/pdf.js` embeds a same-origin iframe host under `js/pdfjs/web/` so the official PDF.js viewer DOM/CSS can run in isolation without leaking styles into the rest of the renderer.

## Runtime boundaries

### Main process

`main.js` owns the privileged side of the app:
- creates and manages the `BrowserWindow`,
- enforces navigation restrictions for the app window,
- opens/saves `.qdpx` projects through dialog-gated IPC,
- persists the "last project" pointer under Electron `userData`,
- persists app-level storage preferences under Electron `userData`,
- manages automatic project backups,
- mounts/unmounts opt-in macOS disk images and blocks auto-mount when configured local agent apps are running,
- creates and watches the hidden project-local online-observation sidecar (`.[project-name]_media/`),
- runs a localhost-only online-observation server on `127.0.0.1` and authenticates extension requests with an app-generated bearer token,
- relays accepted observation entries to the renderer,
- checks OCR availability and shells out to Tesseract,
- coordinates semantic indexing / Ask jobs in worker threads,
- mediates model access to Ollama through the semantic modules.

The main process should remain the only place that touches arbitrary file paths, child processes, worker threads, and Electron app/window APIs.
`main.js` now acts as a composition root for some privileged features: backup IPC registration and OCR image handling live in `electron-main/*`, but they still execute entirely inside the main-process boundary.

## Online observation flow

Quackdas now supports two observation-ingest paths that share the same fieldnote model:

1. Localhost extension ingest
   - The Firefox extension captures page metadata, DOM HTML, and optional PNG crops.
   - It POSTs those payloads to the main-process localhost server at `127.0.0.1`.
   - The server validates the bearer token, validates payload size/shape, writes HTML/PNG sidecar assets, and forwards the normalized observation entry to the renderer.
   - The same localhost server also serves fieldsite lists and fieldsite history back to the extension, so the sidebar can rebuild its working state from Quackdas rather than depending only on browser-local storage.

2. Sidecar watcher ingest
   - The legacy/auxiliary watcher still watches `.[project-name]_media/incoming/`.
   - It moves externally dropped JSON/HTML/PNG files into stable sidecar locations before notifying the renderer.

The localhost server is the primary path for the bundled Firefox extension. The watcher remains useful as a project-local ingest boundary and for any future external drop/import workflows.

### Preload

`preload.js` is intentionally thin. It exposes explicit methods and event subscriptions through `contextBridge`. The renderer should add capabilities here instead of reaching for Node/Electron APIs directly.

### Renderer

The renderer is a plain JavaScript SPA built around shared globals:
- `appData`: current project state object,
- `appDataRevision`: coarse revision counter for caches and backups,
- global functions loaded from `js/*.js`.

This is a pragmatic architecture rather than a modular ES-module app. Cross-file coupling is real and expected; the cost is that load order and naming discipline matter.
Renderer file splits should therefore remain plain-script additions to `index.html` with explicit ordering, rather than partial migration to a new module system.

## Renderer module map

The renderer is split by domain, not by component framework:

- [js/state.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/state.js)
  - canonical in-memory project shape,
  - normalization and migration of loaded projects,
  - undo/redo, save/load helpers, revision tracking,
  - fast lookup helpers used by rendering and search.

- [js/render.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/render.js)
  - top-level render orchestration, narrowed render entry points, and current-content/detail rendering.

- [js/render-panels.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/render-panels.js)
  - document sidebar rendering,
  - code sidebar rendering,
  - compact document-list layout helpers.

- [js/ui.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/ui.js)
  - modal/dropdown behavior, save status, backups, statistics, co-occurrence UI glue.

- [js/documents.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/documents.js)
  - document CRUD, import helpers, folder tree, metadata, drag/drop organization.

- [js/fieldnotes.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/fieldnotes.js)
  - fieldnote document normalization,
  - observation-entry ingest into project state,
  - fieldnote session/page navigation,
  - fieldnote renderer helpers and image-coding selection state.

- [js/codes.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/codes.js)
  - code CRUD and hierarchy behavior.

- [js/cases.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/cases.js)
  - case model, linking, attributes, and case analysis UI.

- [js/coding.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/coding.js)
  - text/PDF coding creation and editing, segment annotations, selection logic.

- [js/search.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/search.js)
  - global boolean search index over documents, code descriptions, and annotations.

- [js/memos.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/memos.js)
  - memo CRUD and rendering helpers.

- [js/pdf.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/pdf.js)
  - parent-side PDF controller: page/zoom state, pending navigation, coding mode, offset mapping, OCR/page metadata, thumbnails, and bridge logic to the embedded viewer host.

- [js/pdfjs/web/quackdas-viewer.html](/Users/st3583ed/Documents/Kodning/Quackdas/js/pdfjs/web/quackdas-viewer.html) and [js/pdfjs/web/quackdas-viewer.mjs](/Users/st3583ed/Documents/Kodning/Quackdas/js/pdfjs/web/quackdas-viewer.mjs)
  - same-origin iframe host around the official PDF.js viewer pipeline (`PDFSinglePageViewer` + `pdf_viewer.css`),
  - native page rendering, native text selection, in-frame region overlay drawing, OCR overlay display, and primitive events back to the parent renderer.
  - parent/host coordination now goes through a validated `postMessage` contract rather than direct parent callbacks.

- [js/qdpx.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/qdpx.js)
  - import/export implementation for REFI-QDA `.qdpx`.

- [js/export.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/export.js)
  - export of coded data and derived outputs.

- [js/semantic.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/semantic.js)
  - renderer UI for semantic search and Ask the corpus.

- [js/agent-api.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/agent-api.js)
  - local scripted API over project/docs/codes/coding/semantic functions.

- [js/app.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/app.js)
  - startup sequence, event wiring, global action dispatch, drag/drop shell behavior.

## Data model

The canonical project object is created by `makeEmptyProject()` in `js/state.js`.

Core collections:
- `documents`
- `codes`
- `segments`
- `memos`
- `folders`
- `cases`
- `variableDefinitions`

Key relationships:
- segments belong to documents and may reference multiple code IDs,
- memos can target documents, codes, or segments,
- folders organize documents,
- cases link to documents and carry free-form attributes.

Important invariants:
- loaded projects are normalized through `normaliseProject()` before use,
- segment `codeIds` is the normalized form even if older data used `codeId`,
- project state is treated as mutable in-memory state, then persisted/snapshotted,
- UI caches rely on revision-style invalidation rather than immutable updates.
- replacing the active project object must clear undo/redo history, invalidate revision-keyed caches, and reset project-local PDF/UI transient state before the new project becomes interactive.

## Persistence model

### Project files

User projects are saved as `.qdpx`, implemented in [js/qdpx.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/qdpx.js).

QDPX is the authoritative project interchange format. The app stores:
- project metadata and coding structures in `project.qde`,
- source documents under `sources/`.

Quackdas includes import hardening for untrusted archives:
- compressed/uncompressed size limits,
- entry count limits,
- source path normalization to avoid path traversal,
- XML/source size caps.

Fieldnote documents are stored in QDPX as `TextSource` entries with normal plain-text content plus Quackdas-specific metadata:
- `quackdasDocType="fieldnote"`
- `quackdasFieldnotePath="internal://...fieldnote.json"`

The sidecar media itself is not embedded during normal save/autosave. The fieldnote JSON stored inside the QDPX keeps relative `screenshots/...` and `html/...` references so normal project work stays fast.

### App-local state outside the project file

Some state intentionally lives outside the `.qdpx` file:
- last opened project pointer under Electron `userData`,
- automatic backup copies of saved/exported project snapshots,
- semantic SQLite indexes under the Quackdas app data directory,
- app preferences such as the macOS-only `Disk image storage` toggle.

Online-observation media is the other deliberate project-local store:
- each saved project may have a hidden sibling folder `.[project-name]_media/`,
- `incoming/` remains an optional project-local handoff folder for externally dropped observation bundles,
- Quackdas moves confirmed assets into `screenshots/` and `html/`,
- the renderer keeps only relative refs in fieldnote document data during ordinary save/autosave.

This split matters: semantic indexes are a derived cache, not part of project interchange.

### Optional project-local derived storage

On macOS, Quackdas supports an opt-in `Disk image storage` preference exposed in the renderer header menu.

When that preference is disabled, the default behavior remains:
- backups live under Electron `userData`,
- semantic indexes live under the Quackdas managed semantic cache directory.

When that preference is enabled and the current project has a saved path:
- backups are stored in a hidden sibling folder next to the project: `.quackdas-backups/`,
- semantic indexes are stored next to the project as a hidden SQLite dotfile,
- existing managed or older visible project-local semantic indexes are moved to the hidden project-local path on first access.

This mode exists so projects stored on mounted encrypted disk images can keep derived backups/indexes on the same mounted volume. Unsaved projects still fall back to the default app-local locations until they have a concrete project path.

The same macOS feature can also manage a configured `.sparsebundle` / `.sparseimage` / `.dmg`:
- startup auto-mount only runs when `Disk image storage` is enabled and `autoMount` is enabled,
- auto-mount is blocked when any configured local agent app/process name is detected,
- manual mount can override that block only if the user explicitly enabled `allowManualOverride`,
- quit-time auto-unmount only detaches volumes Quackdas mounted in the current session and waits for semantic jobs plus tracked project writes to settle first.

## Semantic subsystem

The semantic feature set is a separate local retrieval pipeline, not a generic search over renderer state.

Main pieces:
- [semantic/config.js](/Users/st3583ed/Documents/Kodning/Quackdas/semantic/config.js): defaults and limits.
- [semantic/indexing-core.js](/Users/st3583ed/Documents/Kodning/Quackdas/semantic/indexing-core.js): deterministic chunking + incremental embedding.
- [semantic/store.js](/Users/st3583ed/Documents/Kodning/Quackdas/semantic/store.js): SQLite WAL-backed chunk/doc/meta store.
- [semantic/ask-core.js](/Users/st3583ed/Documents/Kodning/Quackdas/semantic/ask-core.js): retrieval + prompt construction + response validation.
- [semantic/indexer-worker.js](/Users/st3583ed/Documents/Kodning/Quackdas/semantic/indexer-worker.js) and [semantic/ask-worker.js](/Users/st3583ed/Documents/Kodning/Quackdas/semantic/ask-worker.js): worker-thread entry points.
- [semantic/ollama-embeddings.js](/Users/st3583ed/Documents/Kodning/Quackdas/semantic/ollama-embeddings.js): localhost-only Ollama access.

Architectural rules:
- only non-PDF text documents are embedded for semantic indexing,
- chunk identity is deterministic so re-indexing can be incremental,
- indexes are keyed by project path and embedding model metadata,
- the semantic store path is app-local by default but may become project-local when macOS `Disk image storage` is enabled,
- Ollama access is restricted to local endpoints,
- Ask responses are validated against retrieved chunks before the UI treats them as grounded.

## Agent and automation surface

Quackdas exposes a local scripting surface in the renderer:
- [js/agent-api.js](/Users/st3583ed/Documents/Kodning/Quackdas/js/agent-api.js)
- [agent/jsonrpc-router.js](/Users/st3583ed/Documents/Kodning/Quackdas/agent/jsonrpc-router.js)

This API is intentionally explicit and project-local:
- project status/save,
- document list/get/update/jump,
- code list/create,
- coding list/add/remove,
- semantic status/search/ask operations.

Current invariants on that surface:
- `window.quackdasAgent` is the shipped in-renderer API; the JSON-RPC router is a transport adapter around it, not a separately loaded runtime today.
- document reads expose coarse `revision` plus editability metadata.
- `docs.update` is intentionally conservative: it allows plain-text document edits with optional revision checks, but rejects PDF docs, coded docs, and rich-text docs rather than trying to repair dependent state implicitly.

The CLI in [tools/quackdas-cli.js](/Users/st3583ed/Documents/Kodning/Quackdas/tools/quackdas-cli.js) is narrower. It is read-only with respect to project content and is primarily for semantic inspection/querying against an existing `.qdpx` plus its derived index.

## Startup and execution flow

Normal app startup looks like this:

1. Electron launches `main.js`.
2. `main.js` creates the browser window and loads `index.html`.
3. `preload.js` exposes `window.electronAPI`.
4. `index.html` loads renderer scripts in a fixed order.
   - `js/render.js` must load before `js/render-panels.js`, and both must load before feature files that call the render helpers.
5. On macOS with disk-image mode enabled, `main.js` may auto-mount the configured disk image before the renderer asks to reopen the last project path.
5. `js/app.js` runs on `DOMContentLoaded`.
6. The renderer calls `loadData()` and then tries to reopen the last project through IPC.
7. If a project opens, the renderer imports the QDPX first and only then commits the project path/last-project pointer back through IPC; otherwise the empty/default project is rendered.
8. Renderer actions mutate `appData`, call `saveData()`, and re-render affected UI.
9. Explicit save/export writes a `.qdpx`; background backup uses an exported base64 QDPX snapshot.

## Testing strategy

Automated tests currently focus on logic-heavy modules rather than full UI flows:
- semantic retrieval / validation logic,
- agent JSON-RPC routing,
- state normalization and undo/redo safety paths,
- QDPX round-trip / compatibility coverage,
- extracted main-process backup handlers.
- semantic chunking/indexing/validation/integration,
- JSON-RPC router behavior,
- model profile and reranking logic.

See [tests](/Users/st3583ed/Documents/Kodning/Quackdas/tests).

This means renderer regressions are still largely protected by discipline, targeted manual checks, and durable notes in `ENGINEERING_NOTES.md`.

## Change guidance

Consult this document before making changes that span runtime boundaries or multiple domains.

Update this document when:
- a new persistent store or derived cache is introduced,
- responsibility moves between main/preload/renderer,
- the renderer script loading model changes,
- a new subsystem becomes first-class (for example, agent tooling, OCR, semantic features),
- the canonical project model or key invariants change,
- build/runtime behavior changes in a way future contributors need to know.

Do not update it for:
- cosmetic UI tweaks,
- isolated bug fixes that do not alter structure,
- wording-only documentation changes,
- one-off release notes.
