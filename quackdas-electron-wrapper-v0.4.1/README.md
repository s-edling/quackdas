# Quackdas (Electron wrapper)

A qualitative data analysis application using the REFI-QDA standard (.qdpx) for project files.

## Setup
1. Install Node.js (LTS).
2. Install dependencies and run:
   ```
   npm install
   npm start
   ```

All required libraries (PDF.js, JSZip, Mammoth) are bundled.

## Packaging
- macOS DMG: `npm run dist`
- Windows NSIS: `npm run dist`
- Linux AppImage: `npm run dist`

## File Format

Quackdas uses the **QDPX** format (REFI-QDA Project Exchange standard), enabling interoperability with:
- NVivo
- MAXQDA  
- ATLAS.ti
- QDA Miner
- Other REFI-QDA compatible software

A `.qdpx` file is a zip containing:
- `project.qde` — XML file with codes, coded segments, and memos
- `Sources/` — folder with original documents (PDFs, text files)

Legacy `.json` projects can still be imported for backwards compatibility.

## Features
- **PDF support**: Import PDFs with selectable, codable text
- **Autosave**: Every 30 seconds when working with a saved project
- **QDPX export/import**: Share projects with other QDA software
