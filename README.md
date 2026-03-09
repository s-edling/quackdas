# Quackdas

Quackdas is a qualitative data analysis app. It aims to be responsive, bloat-free, and to keep your data on your machine at all times. It uses .qdpx project files, which most comparable software (including NVivo and ATLAS.ti) can export to and import from. (Some minor aspects of an NVivo project may be lost when exporting to .qdpx, since NVivo prefers its proprietary file type.)

The main benefit compared to commercial alternatives are speed and that there are no cloud-based AI tools where data security is predicated on, e.g., NVivo saying that OpenAI says they don’t retain uploaded data. Compared to commercial alternatives, Quackdas has a smaller feature surface.

Beyond standard QDAS functionality (coding, cases, search etc.), the app has a few additional features:
- A few local AI features (Semantic search, Ask the corpus), which require a local LLM via Ollama.
- An opt-in mode for working from project data kept in an encrypted disk image, intended to reduce exposure to AI agents and other unpredictable cloud-based services with file system access (Mac only).
- A Firefox extension for taking screenshots and notes in a browser sidebar, for online observations/ethnography; this requires the app to be open and automatically creates a document for each online field site.

The app is unsigned, so you will probably need to bypass the macOS Gatekeeper or Windows equivalent to open it. To search or extract text from scanned PDFs, you will need to install Tesseract for OCR.

Quackdas was developed as a hobby project with AI-assisted coding tools. Please let me know if anything doesn’t work as intended, or if you need a feature to reach parity in usefulness with commercial alternatives.


## Development (build from source)
Quackdas is built with Electron: a desktop app using web UI (HTML/CSS/JS) with a Node.js backend.

For contributors, see `ARCHITECTURE.md` for the runtime/module map and `AGENTS.md` for the repository workflow around documentation updates.

Install Node.js (LTS), then run from the repository root:

```bash
npm install
npm start
```

For packaging (run from repository root):

```bash
npm run dist                # default: build current platform target
npm run dist -- --mac       # DMG on macOS
npm run dist -- --win       # NSIS on Windows
npm run dist -- --linux     # AppImage on Linux
```

## Firefox extension (online observations)

The Firefox extension lives in `browser-extension/firefox-observer/`.

To build the AMO upload package:

```bash
npm run pack:firefox-extension
```

That produces an unsigned `.xpi` in `dist/firefox-extension/`. Normal Firefox builds require Mozilla signing before that package can be installed outside `about:debugging`.

For extension install/setup details, see:

- `browser-extension/firefox-observer/README.md`
- `INSTALL.txt`
