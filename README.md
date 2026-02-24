# Quackdas

Quackdas is a qualitative data analysis app. It aims to be responsive, bloat-free, and to keep your data on your machine at all times. It uses .qdpx project files, which most comparable software (including NVivo and ATLAS.ti) can export to and import from. (Some minor aspects of an NVivo project may be lost when exporting to .qdpx, since NVivo prefers its proprietary file type.)

Compared to commercial alternatives, the main drawback is that Quackdas doesn’t support text selection in PDFs. PDF coding is instead done by selecting a region of a page by click-and-dragging. Alternatively, Quackdas can extract a PDF’s text to a plain-text document. The main benefit compared to commercial alternatives are speed and that there are no cloud-based AI tools where data security is predicated on, e.g., NVivo saying that OpenAI says they don’t retain uploaded data.

To search or extract text from scanned PDFs, install Tesseract for OCR. Quackdas also includes a few local AI features (Semantic search, Ask the corpus), which require a local LLM via Ollama. The app is unsigned, so you will probably need to bypass the macOS Gatekeeper or Windows equivalent to open it.

Quackdas was developed as a hobby project with AI-assisted coding tools. Please let me know if anything doesn’t work as intended, or if you need a feature to reach parity in usefulness with commercial alternatives.


## Development (build from source)
Quackdas is built with Electron: a desktop app using web UI (HTML/CSS/JS) with a Node.js backend.

Install Node.js (LTS), then run from the repository root:

npm install
npm start

For packaging (run from repository root):

npm run dist                # default: build current platform target
npm run dist -- --mac       # DMG on macOS
npm run dist -- --win       # NSIS on Windows
npm run dist -- --linux     # AppImage on Linux