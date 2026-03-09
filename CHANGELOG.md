# Changelog

This changelog tracks user-facing release batches for Quackdas.
It is intentionally concise and does not list every micro-change.

## Format

Use one entry per commit/release batch:

### Build YYYY.MM.DD.N
Date: YYYY-MM-DD

Changed:
- ...

Why:
- ...

Files touched:
- `path/to/file`

Verification:
- ...

Regression checks:
- ...

### Build 2026.03.09.1
Date: 2026-03-09

Changed:
- Added the Firefox online-observation extension plus the in-app `Online observations` setup flow, so researchers can capture browser screenshots and notes directly into Quackdas fieldsite documents.
- Added fieldnote/online-observation persistence, localhost ingest, QDPX pack/export support, and continuation workflows so online observations remain portable and resumable across sessions and machines.
- Hardened fieldnote coding and media behavior: online-note text selections now code accurately, coded screenshots are selectable and have the correct context menu, fieldnote history reloads back into the extension, and multiple extension UI/performance regressions were fixed.
- Hardened related data-safety paths: semantic indexing now drops deleted documents, backups use atomic writes, imported packed fieldnote media survives normal saves, and delete-document/history behavior is clearer and safer.
- Bumped the app version to `0.7.1`.

Why:
- This batch turns online observation into a usable end-to-end workflow while tightening the persistence, export, and coding paths that could otherwise risk data loss, stale state, or misleading behavior.

Files touched:
- `browser-extension/**/*`
- `electron-main/online-observation*.js`
- `main.js`
- `preload.js`
- `index.html`
- `js/app.js`
- `js/codes.js`
- `js/coding.js`
- `js/documents.js`
- `js/export.js`
- `js/fieldnotes.js`
- `js/pdf.js`
- `js/qdpx.js`
- `js/render*.js`
- `js/semantic.js`
- `js/state.js`
- `js/ui.js`
- `semantic/indexing-core.js`
- `styles.css`
- `tests/*.test.js`
- `ARCHITECTURE.md`
- `ENGINEERING_NOTES.md`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

Verification:
- `npm test`
- `node --check js/coding.js`
- `node --check js/render.js`
- `node --check js/fieldnotes.js`
- `node --check electron-main/online-observation-server.js`
- `node --check browser-extension/firefox-observer/sidebar.js`
- Manual smoke tests for Firefox extension setup, note/screenshot capture, fieldsite history restore, online fieldnote coding, screenshot coding/context menus, and marker alignment.

Regression checks:
- Open Quackdas, connect the Firefox extension from `File -> Online observations`, and verify captures and notes appear in the correct fieldsite/session.
- Restart Quackdas and reload the extension, then confirm fieldsite history reloads into the sidebar and existing notes continue updating correctly.
- In online fieldnotes, code short one-line notes, longer notes, and screenshots; verify context menus, selection accuracy, and rendered layout stay stable.
- Use `Pack for export`, move/open the project again, and confirm online observations still render and new observations can be added.
- Delete a note-only extension entry and confirm the corresponding project note disappears without disturbing later fieldnote codings.

### Build 2026.03.07.1
Date: 2026-03-07

Changed:
- Hardened project open/save safety so QDPX paths are committed only after import succeeds, backup restore uses the same size guard as normal opens, and project saves use an atomic temp-write/rename path.
- Reset undo/history plus project-local PDF/UI transients whenever the active project is replaced, preventing cross-project state leakage after open, restore, or new-project flows.
- Hardened the intentional agent/PDF surfaces by making `window.quackdasAgent.docs.update` reject unsafe document types, exposing revision/editability metadata, and moving PDF host communication onto a validated `postMessage` contract.
- Improved PDF handling substantially: born-digital PDFs now support practical text selection/coding, scanned-PDF OCR data persists across save/load, scanned PDFs render immediately while OCR continues in the background in normal cases, and multiple page-jump/page-reset regressions were fixed.
- Cleaned up repo hygiene by removing the tracked local Node toolchain from version control and bumped the app version to `0.7.0`.

Why:
- This batch closes multiple high-risk data-loss and wrong-file-save paths, makes PDF workflows materially more usable, and aligns the release metadata/docs with the new behavior.

Files touched:
- `main.js`
- `preload.js`
- `electron-main/project-backups.js`
- `electron-main/project-files.js`
- `js/app.js`
- `js/export.js`
- `js/state.js`
- `js/ui.js`
- `js/qdpx.js`
- `js/pdf.js`
- `js/agent-api.js`
- `js/pdfjs/web/quackdas-viewer.mjs`
- `tests/*.test.js`
- `package.json`
- `package-lock.json`
- `README.md`
- `ARCHITECTURE.md`
- `ENGINEERING_NOTES.md`
- `.gitignore`
- `CHANGELOG.md`

Verification:
- `npm test`
- `npm run check:syntax`
- `npm run check:lint`
- Manual smoke tests across open/import/save/restore flows, PDF text selection/coding, scanned-PDF OCR reopen behavior, and PDF go-to-location.

Regression checks:
- Open a corrupt or invalid `.qdpx` and confirm the current project/save handle stays unchanged.
- Open project B after editing project A and confirm `Undo`/`Redo` do not affect project B.
- Save and reopen a scanned PDF project after OCR and confirm OCR does not rerun.
- Verify born-digital PDF text selection/coding, region coding, context menus, and page navigation still behave correctly.

### Build 2026.02.26.1
Date: 2026-02-26

Changed:
- Fixed Code view in-page find navigation so `Enter`/next reliably advances matches even when viewport movement is required.
- Fixed in-page find reopen behavior so previous query is retained without auto-jumping viewport until explicit navigation.
- Fixed Code view in-page find rendering side-effects in multiline snippets by using non-mutating search highlights (`Range` + `::highlight`) when supported.
- Stabilized highlight styling to avoid layout-affecting inline spacing.
- Removed confirmation pop-ups for `Remove coding` / `Remove all coding` actions in Document viewer and Code view context menus; removals now happen immediately and remain undoable.
- No app/package version bump in this batch.

Why:
- Code view virtualization and DOM-mutating highlights could desync search state during scroll-driven rerenders, causing next/Enter failures.
- DOM wrapping highlights could alter snippet markup flow around paragraph line breaks in Code view; non-mutating highlights preserve rendered text structure.
- Confirmation prompts in high-frequency coding cleanup actions added friction without meaningful safety because undo is available.

Files touched:
- `js/search.js`
- `js/render.js`
- `js/coding.js`
- `styles.css`
- `CHANGELOG.md`
- `ENGINEERING_NOTES.md`

Verification:
- `node --check js/search.js`
- `node --check js/render.js`
- `node --check js/coding.js`
- In Code view, search for multi-hit terms and verify repeated `Enter`/next navigation works across off-screen matches.
- Reopen in-page find (`Cmd/Ctrl+F`) and verify old query remains without immediate viewport movement.
- In multiline Code view snippets, verify line breaks/paragraph gaps remain unchanged while search highlights are active.
- In both Document viewer and Code view context menus, click `Remove coding` (and `Remove all coding` where available) and verify removal is immediate with no confirmation dialog.

Regression checks:
- Confirm Document viewer in-page find behavior remains unchanged.
- Confirm closing/clearing search in Code view restores normal scrolling/performance.
- Confirm active/inactive highlight visuals are still distinguishable.
- Confirm undo restores codings removed via immediate (no-confirmation) context-menu actions.

### Build 2026.02.25.1
Date: 2026-02-25

Changed:
- Fixed coded-text context-menu targeting for overlapping/multi-code snippets so right-click actions follow the clicked code color.
- Added explicit multi-code context-menu actions to separate single-code removal (`Remove coding • <clicked code>`) from full removal (`Remove all coding`).
- Fixed packaging size regression by replacing broad Electron Builder file globbing with a runtime-file allowlist and explicit excludes for local archives/data/secrets/docs/tests/tools.
- Updated README wording for local AI feature description.
- Bumped app version to `0.6.9`.

Why:
- Restores precise coding workflows in dense coded passages and avoids accidental over-deletion in multi-code snippets.
- Prevents accidental inclusion of large local artifacts (for example root `*.zip`) and sensitive/local files in packaged builds, reducing both release size and leakage risk.

Files touched:
- `js/coding.js`
- `package.json`
- `package-lock.json`
- `ENGINEERING_NOTES.md`
- `README.md`
- `CHANGELOG.md`

Verification:
- `npm run check:syntax`
- `npm run check:lint`
- `npm run pack`
- `npm run dist`
- Inspected packaged `app.asar` contents to confirm no `.env*`, token/secret-like files, corpus-like data files, or `quackdas.zip` were bundled.

Regression checks:
- Right-click different color spans in overlapping coded text and confirm menu context/action labels follow the clicked code.
- In multi-code snippets, verify both `Remove coding • <clicked code>` and `Remove all coding` are shown and behave distinctly.
- Confirm single-code snippet context-menu remove action still removes coding as before.
- Confirm packaged app still loads core UI flows (documents, coding, PDF coding, semantic features) after packaging rule tightening.

### Build 2026.02.24.1
Date: 2026-02-24

Changed:
- Hid the entire Semantic tools dock in the left sidebar when Semantic tools are unavailable, instead of leaving an empty panel title visible.
- Set Ask mode recommendation to default to `Loose` regardless of model size.
- Fixed Ask citation rendering so loose-mode tokens like `@@SEMCITE0@@` / `@@SEM_CITE_0@@` render as clickable citation chips.
- Improved Ask prose markdown rendering visibility for heading levels and emphasis (`strong`/`em`).

Why:
- To remove a confusing empty UI affordance when local semantic models are unavailable and restore reliable, readable Ask output/citation navigation.

Files touched:
- `index.html`
- `js/semantic.js`
- `styles.css`
- `CHANGELOG.md`
- `ENGINEERING_NOTES.md`

Verification:
- `npm run check:syntax`
- `npm run check:lint`

Regression checks:
- With semantic availability unavailable, confirm both the Semantic tools button and dock panel are hidden.
- In Ask, switch generation models and confirm default mode remains `Loose` unless manually changed.
- In Ask output, verify `[n]` citations and `@@SEMCITE...@@` citations render as clickable source chips.
- Verify markdown headings and bold/italic emphasis are visibly distinct in Ask output.

### Build 2026.02.23.1
Date: 2026-02-23

Changed:
- Hardened main-process IPC sends to avoid `Object has been destroyed` crashes during quit/close races.
- Hardened semantic worker shutdown:
  - cancel now marks jobs as `cancelling`,
  - workers are force-terminated after a short grace timeout if they do not exit.
- Added strict base64 validation and decoded-size limits for project save and backup payloads.
- Normalized segment shape during project load (`codeIds`, index bounds, text coercion) to prevent malformed project crashes.
- Improved global-search performance by replacing repeated `.find(...)` lookups with precomputed id maps.
- Updated OCR availability notice refresh logic in global search to use a timed refresh window.
- Removed dead unused semantic-store prepared statement.
- Bumped app version to `0.6.7`.

Why:
- To eliminate high-severity quit-time crashes, reduce silent corruption risk on save/backup payload handling, and improve stability/performance on large projects.

Files touched:
- `main.js`
- `js/state.js`
- `js/search.js`
- `semantic/store.js`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

Verification:
- `npm run check:syntax`
- `npm run check:lint`
- `node --test tests/*.test.js`

Regression checks:
- Existing syntax/lint/test suite passes.
- Save/backup/import code paths remain operational with stricter payload validation.
- Semantic indexing/ask event handling remains functional with guarded sends and worker termination fallback.

### Build 2026.02.19.1
Date: 2026-02-19

Changed:
- Reduced folder/subfolder row height in the right document panels by tightening vertical padding/gaps (without reducing icon or font size).
- Improved drag-and-drop to root level:
  - dropping on the all-documents panel background now moves dragged documents to root,
  - root separator now accepts drops to move documents to root more reliably.
- Added undo/redo support for document folder moves by snapshotting/restoring each document’s `folderId` in history.
- Made Recent Documents panel fixed height (~three two-line compact cards), instead of dynamically resizing to measured card heights.

Why:
- To make right-panel navigation denser and document moves more reliable/reversible while keeping predictable panel layout.

Files touched:
- `index.html`
- `styles.css`
- `js/documents.js`
- `js/render.js`
- `js/state.js`

Verification:
- Create nested folders/subfolders and confirm folder rows are visibly denser than before while icon/text size is unchanged.
- Drag a document from a folder and drop it on empty area in All Documents; confirm it moves to root.
- Drag a document from folder and drop on root separator; confirm it moves to root.
- Move a document between folders/root, press Undo then Redo; confirm folder location is reversed/restored correctly.
- Confirm Recent Documents panel keeps a fixed height regardless of having 0, 1, or 5 items.

Regression checks:
- Folder-to-folder drag and drop still works.
- Folder drag-and-drop reparenting still works and respects depth limits.
- Document multi-select drag-and-drop still moves all selected documents.
