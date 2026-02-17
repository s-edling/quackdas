Project goal:
I'm developing an html app for qualitative data coding that ideally should have all the functionality I use in NVivo but without the bloat and slowness. It's fully vibe coded and I don't understand the code myself. My aim is to make it useful for myself, and to share with a few friends and colleagues.

The current state is that it's a functional html app wrapped in electron to make a standalone app. Eventually, I want to integrate some AI functionalities drawing on a local model (semantic search, summaries, coding suggestions).

The purpose is for it to be significantly less sluggish than NVivo even with datasets comprising 100 documents or so, which should be kept in mind when designing the app.


Instructions:
Please up the version history when significant changes have been done.

Maintain a CHANGELOG.md in the app (one file, append-only), with entries like:
Version/build identifier
Date
What changed
Why (one line)
Files touched

After each change, tell me how to verify that it worked and how to test if the most likely things to have broken still work.


The following is the project Memory written by Claude, who has written the majority of the code:
Purpose & context
Staffan is developing Quackdas, a qualitative data analysis application designed for academic researchers as an alternative to traditional CAQDAS (Computer Assisted Qualitative Data Analysis Software) tools from the early 2000s. The application is built with a modular architecture and wrapped in Electron, prioritizing simplicity and shareability while providing professional-grade functionality for coding and analyzing qualitative research data. The name "Quackdas" is a clever play on the clunky CAQDAS acronym, featuring a duck-rabbit illusion logo that reflects the dual nature of qualitative interpretation.
The project emphasizes creating a tool that looks professional and intentional rather than prototype-like, with particular attention to user experience details that matter for academic research workflows. Staffan has been working with multiple AI assistants (primarily ChatGPT for initial development, now Claude for refinements) and maintains detailed records of development discussions and changelogs.
Current state
The application has evolved through multiple versions (currently around 0.3.2) with a modular codebase structure comprising 12 separate files: HTML, CSS, and 10 JavaScript modules organized by functionality (state management, UI rendering, document operations, coding, search, memos, export, and utilities). Recent development has focused on implementing hierarchical folder systems for document organization (supporting up to 5 levels of nesting), keyboard shortcut assignment for codes, and comprehensive bug fixes around critical system issues including infinite recursion problems that caused runaway processes.
Key features now include text selection and coding with proper position alignment, Boolean search functionality, analytical memos, project import/export, drag-and-drop document management between folders, and a professional interface using system fonts and SVG icons instead of emojis.
Key learnings & principles
Critical technical lessons learned include the importance of cycle detection in recursive functions to prevent system-threatening infinite loops, maintaining exact character position alignment between DOM rendering and original document text for reliable coding functionality, and the need for comprehensive testing when implementing hierarchical data structures.
Design principles that have emerged emphasize professional appearance over prototype aesthetics, with standardized header heights and system font usage for UI elements while preserving readable fonts for document content. The modular architecture with the Electron wrapper supports the goal of easy sharing among academic researchers.
Approach & patterns
Staffan demonstrates a methodical development approach, preferring to batch related improvements together and address multiple issues comprehensively in single sessions rather than piecemeal fixes. He maintains detailed documentation of changes and technical discussions, often quoting previous assessments verbatim to ensure continuity.
The development workflow involves systematic testing of new features, immediate identification and reporting of critical issues (like the runaway process problem), and iterative refinement based on user experience feedback. When encountering context window limitations with large files, the approach has evolved to use targeted text instructions for simple modifications while uploading complete files only when broader context is needed.
Tools & resources
The application is built using Electron for cross-platform desktop deployment, with a focus on macOS compatibility and standards. Development involves standard web technologies (HTML, CSS, JavaScript) organized into a modular structure for maintainability. The build process uses npm for Electron packaging and distribution.
The project leverages AI assistance strategically, with different AI tools used for different phases (ChatGPT for initial development, Claude for refinements and bug fixes), and maintains compatibility requirements for academic users who may be skeptical of AI technology.