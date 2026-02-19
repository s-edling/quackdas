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
