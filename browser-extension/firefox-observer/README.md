# Quackdas Online Observation Extension

This Firefox extension captures browser notes and screenshot regions and sends them to a locally running Quackdas app on `http://127.0.0.1:45823`.

It is intended for social scientists doing online ethnography, supporting observation and note-taking inside the Firefox browser while keeping the resulting material in a local Quackdas project.

It does not send observation data to any remote server. The intended production distribution is a Mozilla-signed, self-distributed unlisted `.xpi`.

## Build a Signable XPI

From the repository root:

```bash
npm run pack:firefox-extension
```

This writes a package like:

```text
dist/firefox-extension/quackdas-online-observation-0.7.1.xpi
```

That `.xpi` is the upload artifact for AMO signing. It is not installable on normal Firefox builds until Mozilla signs it.

Tagged GitHub releases reuse the most recent signed `.xpi` asset from an earlier release if one exists. The first tagged release after introducing that workflow will skip the `.xpi` attachment cleanly because there is no earlier signed asset to reuse yet.

## Local Development Install

Use this only for development and testing:

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select `browser-extension/firefox-observer/manifest.json`.

Temporary add-ons are removed when Firefox restarts.

## Install a Signed Build

After AMO signs the `.xpi`:

1. Open Firefox.
2. Open `Add-ons and themes`.
3. Click the gear menu.
4. Choose `Install Add-on From File…`.
5. Select the signed `.xpi`.

## Connect to Quackdas

1. Start Quackdas.
2. Open a saved `.qdpx` project.
3. In Quackdas, open `File -> Online observations`.
4. Click `Copy extension config`.
5. In the extension, open `Settings`.
6. Paste the config and save it.
7. Use `Test connection`.

## Default Keyboard Shortcuts

- `Alt+Shift+R`: Capture region
- `Alt+Shift+N`: New note

Firefox lets users reassign extension shortcuts in the add-ons shortcut settings if these defaults conflict with anything else.

## Reviewer Notes

This extension communicates only with a locally running Quackdas desktop app:

- Local endpoint: `http://127.0.0.1:45823`
- Auth: bearer token copied from Quackdas
- No cloud sync, analytics, or remote upload
- The extension captures current-page URL/title, DOM HTML, freeform note text, and optional user-selected screenshot crops
- Quackdas must be running with a saved project open for submission to succeed

The extension requests:

- `activeTab`: capture the currently active page after an explicit user action
- `tabs`: query the active tab and capture the visible tab
- `storage`: persist extension config and sidebar cache
- `http://127.0.0.1:45823/*`: send observations to the local Quackdas app

The manifest declares `websiteActivity` and `websiteContent` because the extension transmits page metadata/content to Quackdas for local processing and storage.
