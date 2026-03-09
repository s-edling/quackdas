(function() {
    const DEFAULT_SETTINGS = ObserverStorage.DEFAULT_SETTINGS;
    const NEW_FIELDSITE_VALUE = '__new__';
    const PENDING_COMMAND_KEY = 'quackdasObserver.pendingCommand';
    const state = {
        settings: DEFAULT_SETTINGS,
        fieldsiteHistory: {},
        entries: [],
        fieldsites: [],
        currentFieldsite: '',
        lastSession: null,
        activeSessionStartedAt: '',
        pendingManualSession: false,
        noteCreating: false,
        historyPersistTimer: 0,
        historyPersistFieldsite: '',
        statusClearTimer: 0
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        await reloadSettings({ refreshFieldsitesAfter: false });
        state.fieldsiteHistory = await ObserverStorage.getFieldsiteHistoryMap();
        await refreshFieldsites();
        if (state.currentFieldsite) {
            await syncFieldsiteHistoryFromQuackdas(state.currentFieldsite, { showErrors: false });
        }
        bindEvents();
        renderEntries();
        await runPendingShortcutIfAny();
    }

    function bindEvents() {
        document.getElementById('fieldsiteSelect').addEventListener('change', onFieldsiteChange);
        document.getElementById('newFieldsiteInput').addEventListener('change', onNewFieldsiteCommit);
        document.getElementById('captureButton').addEventListener('click', onCaptureRegion);
        document.getElementById('newNoteButton').addEventListener('click', onNewNote);
        document.getElementById('startSessionButton').addEventListener('click', onStartNewSession);
        document.getElementById('openSettingsButton').addEventListener('click', () => browser.runtime.openOptionsPage());
        window.addEventListener('focus', () => {
            reloadSettings({ refreshFieldsitesAfter: true }).catch(() => {});
        });
        browser.runtime.onMessage.addListener(onRuntimeMessage);
    }

    async function reloadSettings(options) {
        const settings = ObserverStorage.normalizeSettings(await ObserverStorage.get(ObserverStorage.KEYS.settings, DEFAULT_SETTINGS));
        const changedConnection = settings.serverUrl !== state.settings.serverUrl || settings.authToken !== state.settings.authToken;
        state.settings = settings;
        if (options && options.refreshFieldsitesAfter && changedConnection) {
            await refreshFieldsites();
        }
    }

    function getKnownFieldsiteNames() {
        return Object.keys(state.fieldsiteHistory || {});
    }

    function getFieldsiteHistoryRecord(fieldsite) {
        const normalized = ObserverStorage.normalizeFieldsiteName(fieldsite);
        if (!normalized) {
            return {
                fieldsite: '',
                entries: [],
                lastSession: null,
                activeSessionStartedAt: ''
            };
        }
        if (!state.fieldsiteHistory[normalized]) {
            state.fieldsiteHistory[normalized] = {
                fieldsite: normalized,
                entries: [],
                lastSession: null,
                activeSessionStartedAt: ''
            };
        }
        return state.fieldsiteHistory[normalized];
    }

    function applyFieldsiteState(fieldsite) {
        const record = getFieldsiteHistoryRecord(fieldsite);
        state.entries = Array.isArray(record.entries) ? record.entries : [];
        state.lastSession = record.lastSession || null;
        state.activeSessionStartedAt = String(record.activeSessionStartedAt || (state.lastSession && state.lastSession.sessionStartedAt) || '').trim();
        state.pendingManualSession = false;
    }

    function entryHasCapture(entry) {
        return !!(entry && (entry.imageDataUrl || entry.screenshotPath));
    }

    function canDeleteEmptyEntry(entry) {
        if (!entry) return false;
        return !String(entry.note || '').trim();
    }

    function setDeleteNoteVisibility(deleteRow, deleteLink, entry) {
        if (!deleteRow) return;
        deleteRow.hidden = !canDeleteEmptyEntry(entry);
        if (!deleteLink) return;
        deleteLink.textContent = entryHasCapture(entry) ? 'Delete screenshot' : 'Delete note';
    }

    function clearPendingNoteUpdate(uuid) {
        if (!onNoteChanged._timers) return;
        const timer = onNoteChanged._timers[uuid];
        if (!timer) return;
        window.clearTimeout(timer);
        delete onNoteChanged._timers[uuid];
    }

    function mergeSyncedEntriesWithDirtyLocalEntries(remoteEntries, localEntries) {
        const dirtyByUuid = new Map();
        (Array.isArray(localEntries) ? localEntries : []).forEach((entry) => {
            const uuid = String(entry && entry.uuid || '').trim();
            if (!uuid || !entry.noteDirty) return;
            dirtyByUuid.set(uuid, entry);
        });
        if (!dirtyByUuid.size) return Array.isArray(remoteEntries) ? remoteEntries : [];

        const merged = [];
        const seen = new Set();
        (Array.isArray(remoteEntries) ? remoteEntries : []).forEach((entry) => {
            const uuid = String(entry && entry.uuid || '').trim();
            const dirtyEntry = dirtyByUuid.get(uuid);
            if (dirtyEntry) {
                merged.push(Object.assign({}, entry, {
                    note: dirtyEntry.note,
                    noteDirty: true
                }));
                seen.add(uuid);
                return;
            }
            merged.push(entry);
            if (uuid) seen.add(uuid);
        });

        dirtyByUuid.forEach((entry, uuid) => {
            if (!seen.has(uuid)) merged.push(entry);
        });
        return merged;
    }

    function buildFieldsiteHistoryRecord(fieldsite) {
        const normalized = ObserverStorage.normalizeFieldsiteName(fieldsite);
        if (!normalized) return null;
        return {
            fieldsite: normalized,
            entries: Array.isArray(state.entries)
                ? state.entries.map((entry) => compactEntryForStorage(Object.assign({}, entry, { fieldsite: normalized })))
                : [],
            lastSession: state.lastSession ? Object.assign({}, state.lastSession) : null,
            activeSessionStartedAt: String(state.activeSessionStartedAt || '').trim()
        };
    }

    function compactEntryForStorage(entry) {
        const next = Object.assign({}, entry || {});
        next.imageDataUrl = '';
        next.html = '';
        return next;
    }

    async function persistFieldsiteHistory(fieldsite) {
        const normalized = ObserverStorage.normalizeFieldsiteName(fieldsite);
        const record = buildFieldsiteHistoryRecord(normalized);
        if (!normalized || !record) return;
        state.fieldsiteHistory[normalized] = record;
        const compactMap = {};
        Object.keys(state.fieldsiteHistory || {}).forEach((key) => {
            const fieldsiteRecord = state.fieldsiteHistory[key];
            compactMap[key] = {
                fieldsite: String(fieldsiteRecord && fieldsiteRecord.fieldsite || key).trim(),
                entries: Array.isArray(fieldsiteRecord && fieldsiteRecord.entries)
                    ? fieldsiteRecord.entries.map((entry) => compactEntryForStorage(entry))
                    : [],
                lastSession: fieldsiteRecord && fieldsiteRecord.lastSession ? Object.assign({}, fieldsiteRecord.lastSession) : null,
                activeSessionStartedAt: String(fieldsiteRecord && fieldsiteRecord.activeSessionStartedAt || '').trim()
            };
        });
        state.fieldsiteHistory = await ObserverStorage.setFieldsiteHistoryMap(compactMap);
    }

    function queueFieldsiteHistoryPersist(fieldsite, delayMs) {
        const normalized = ObserverStorage.normalizeFieldsiteName(fieldsite);
        if (!normalized) return;
        if (state.historyPersistTimer) {
            window.clearTimeout(state.historyPersistTimer);
        }
        state.historyPersistFieldsite = normalized;
        state.historyPersistTimer = window.setTimeout(() => {
            const targetFieldsite = state.historyPersistFieldsite;
            state.historyPersistTimer = 0;
            state.historyPersistFieldsite = '';
            persistFieldsiteHistory(targetFieldsite).catch(() => {});
        }, Math.max(0, Number(delayMs) || 0));
    }

    async function flushQueuedFieldsiteHistoryPersist() {
        if (!state.historyPersistTimer) return;
        const targetFieldsite = state.historyPersistFieldsite;
        window.clearTimeout(state.historyPersistTimer);
        state.historyPersistTimer = 0;
        state.historyPersistFieldsite = '';
        if (!targetFieldsite) return;
        await persistFieldsiteHistory(targetFieldsite);
    }

    async function persistSelectedFieldsite(fieldsite) {
        const normalized = ObserverStorage.normalizeFieldsiteName(fieldsite);
        if (state.settings.lastFieldsite === normalized) return;
        state.settings = Object.assign({}, state.settings, { lastFieldsite: normalized });
        await ObserverStorage.set(ObserverStorage.KEYS.settings, state.settings);
    }

    async function switchToFieldsite(fieldsite, options) {
        await flushQueuedFieldsiteHistoryPersist();
        const normalized = ObserverStorage.normalizeFieldsiteName(fieldsite);
        state.currentFieldsite = normalized;
        applyFieldsiteState(normalized);
        if (!(options && options.skipPersistSelection)) {
            await persistSelectedFieldsite(normalized);
        }
        renderFieldsites();
        renderEntries();
        if (!(options && options.skipRemoteSync)) {
            await syncFieldsiteHistoryFromQuackdas(normalized, { showErrors: false });
        }
    }

    async function refreshFieldsites() {
        let projectFieldsites = [];
        if (state.settings.serverUrl && state.settings.authToken) {
            try {
                const result = await ObserverConnectionClient.listFieldsites(state.settings);
                if (result && result.ok && Array.isArray(result.fieldsites)) {
                    projectFieldsites = result.fieldsites;
                    clearStatusIfConnectionError();
                }
            } catch (err) {
                showStatus(err && err.message ? err.message : 'Could not load fieldsites from Quackdas.', 'error');
            }
        }
        state.fieldsites = ObserverFieldsites.mergeFieldsites(
            ObserverFieldsites.mergeFieldsites(state.settings.storedFieldsites, getKnownFieldsiteNames()),
            projectFieldsites
        );
        if (!state.currentFieldsite || !state.fieldsites.includes(state.currentFieldsite)) {
            state.currentFieldsite = state.fieldsites.includes(state.settings.lastFieldsite)
                ? state.settings.lastFieldsite
                : (state.currentFieldsite && getKnownFieldsiteNames().includes(state.currentFieldsite) ? state.currentFieldsite : (state.fieldsites[0] || ''));
        }
        applyFieldsiteState(state.currentFieldsite);
        renderFieldsites();
    }

    async function syncFieldsiteHistoryFromQuackdas(fieldsite, options) {
        const normalized = ObserverStorage.normalizeFieldsiteName(fieldsite);
        if (!normalized || !state.settings.serverUrl || !state.settings.authToken) return false;
        try {
            const result = await ObserverConnectionClient.getFieldsiteHistory(state.settings, normalized);
            if (!result || !result.ok) return false;
            if (state.currentFieldsite !== normalized) return true;
            const entries = mergeSyncedEntriesWithDirtyLocalEntries(result.entries, state.entries);
            state.entries = entries;
            state.lastSession = result.lastSession || deriveLastSessionFromEntries(entries);
            const knownSessionIds = new Set(entries.map((entry) => String(entry.sessionStartedAt || '').trim()).filter(Boolean));
            const preferredActiveSession = String(state.activeSessionStartedAt || '').trim();
            state.activeSessionStartedAt = knownSessionIds.has(preferredActiveSession)
                ? preferredActiveSession
                : String(result.activeSessionStartedAt || (state.lastSession && state.lastSession.sessionStartedAt) || '').trim();
            state.pendingManualSession = false;
            await persistFieldsiteHistory(normalized);
            renderEntries();
            clearStatusIfConnectionError();
            return true;
        } catch (err) {
            if (options && options.showErrors) {
                showStatus(err && err.message ? err.message : 'Could not load fieldsite history from Quackdas.', 'error');
            }
            return false;
        }
    }

    function renderFieldsites() {
        const select = document.getElementById('fieldsiteSelect');
        select.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = state.fieldsites.length ? 'Select fieldsite' : 'Choose or create fieldsite';
        select.appendChild(placeholder);

        state.fieldsites.forEach((fieldsite) => {
            const option = document.createElement('option');
            option.value = fieldsite;
            option.textContent = fieldsite;
            select.appendChild(option);
        });

        const newOption = document.createElement('option');
        newOption.value = NEW_FIELDSITE_VALUE;
        newOption.textContent = 'New fieldsite…';
        select.appendChild(newOption);

        select.value = state.currentFieldsite || '';
    }

    function renderEntries() {
        const container = document.getElementById('entriesContainer');
        Array.from(container.querySelectorAll('.entry-card, .empty-state')).forEach((node) => node.remove());
        if (!state.entries.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = state.currentFieldsite
                ? `No observation history yet for ${state.currentFieldsite}.`
                : 'Choose or create a fieldsite to start taking notes.';
            container.appendChild(empty);
            return;
        }

        const template = document.getElementById('entryTemplate');
        const renderedSessionHeadings = new Set();
        state.entries.forEach((entry) => {
            const fragment = template.content.cloneNode(true);
            const card = fragment.querySelector('.entry-card');
            const headingRow = fragment.querySelector('.session-heading-row');
            const heading = fragment.querySelector('.session-heading');
            const headingButton = fragment.querySelector('.session-target-button');
            const metadata = fragment.querySelector('.metadata-box');
            const url = fragment.querySelector('.entry-url');
            const title = fragment.querySelector('.entry-title');
            const stamp = fragment.querySelector('.entry-timestamp');
            const deleteRow = fragment.querySelector('.entry-delete-row');
            const deleteLink = fragment.querySelector('.entry-delete-link');
            const note = fragment.querySelector('.entry-note');
            const imageWrap = fragment.querySelector('.entry-image-wrap');
            const image = fragment.querySelector('.entry-image');

            card.dataset.uuid = entry.uuid;
            const shouldRenderSessionHeading = !!entry.sessionHeadingLabel && !!entry.sessionStartedAt && !renderedSessionHeadings.has(entry.sessionStartedAt);
            if (shouldRenderSessionHeading) {
                renderedSessionHeadings.add(entry.sessionStartedAt);
                headingRow.hidden = false;
                heading.textContent = entry.sessionHeadingLabel;
                headingButton.dataset.active = entry.sessionStartedAt === state.activeSessionStartedAt ? 'true' : 'false';
                headingButton.textContent = entry.sessionStartedAt === state.activeSessionStartedAt ? 'Adding here' : 'Add to session';
                headingButton.addEventListener('click', () => onSelectSession(entry.sessionStartedAt));
            }
            if (entry.metadataVisible) {
                metadata.hidden = false;
                url.href = entry.url;
                url.textContent = entry.url;
                title.textContent = `${safeHost(entry.url)} \u2014 ${entry.pageTitle}`;
                stamp.textContent = ObserverSerialize.formatLocalTimestamp(entry.timestamp);
            }
            note.value = entry.note || '';
            note.addEventListener('input', (event) => onNoteChanged(entry.uuid, event.target.value));
            note.addEventListener('input', () => resizeNoteTextarea(note, 0, 50));
            note.addEventListener('input', () => setDeleteNoteVisibility(deleteRow, deleteLink, entry));
            if (deleteLink) {
                deleteLink.addEventListener('click', () => onDeleteNote(entry.uuid));
            }
            setDeleteNoteVisibility(deleteRow, deleteLink, entry);

            if (entry.imageDataUrl) {
                imageWrap.hidden = false;
                image.src = entry.imageDataUrl;
            }

            container.appendChild(fragment);
            resizeNoteTextarea(note, 0, 50);
        });
    }

    async function onFieldsiteChange(event) {
        const next = event.target.value;
        const newFieldsiteRow = document.getElementById('newFieldsiteRow');
        if (next === NEW_FIELDSITE_VALUE) {
            newFieldsiteRow.hidden = false;
            document.getElementById('newFieldsiteInput').focus();
            return;
        }
        newFieldsiteRow.hidden = true;
        await switchToFieldsite(next);
    }

    async function onNewFieldsiteCommit(event) {
        const normalized = ObserverFieldsites.normalizeFieldsiteName(event.target.value);
        if (!normalized) return;
        if (!state.fieldsites.includes(normalized)) {
            state.fieldsites.push(normalized);
            state.fieldsites.sort((a, b) => a.localeCompare(b));
            state.settings.storedFieldsites = ObserverFieldsites.mergeFieldsites(state.settings.storedFieldsites, [normalized]);
            await ObserverStorage.set(ObserverStorage.KEYS.settings, state.settings);
        }
        event.target.value = '';
        document.getElementById('newFieldsiteRow').hidden = true;
        await switchToFieldsite(normalized);
    }

    async function onCaptureRegion(options) {
        if (!(await ensureObservationHostPermission({ canPrompt: !(options && options.fromShortcut) }))) return;
        if (!(await ensureReady())) return;
        try {
            const captureButton = document.getElementById('captureButton');
            const result = await sendRuntimeMessage({ type: 'observer:captureRegion' });
            if (!result || !result.ok) {
                if (result && result.cancelled) return;
                throw new Error('Capture failed.');
            }
            const cropRect = scaleRectToBitmap(result.selection.rect, result.page.devicePixelRatio || 1);
            const imageDataUrl = await ObserverCapture.cropVisibleCapture(result.captureDataUrl, cropRect);
            await appendEntry({
                page: result.page,
                imageDataUrl,
                focusAnchor: captureButton
            });
        } catch (err) {
            showStatus(err && err.message ? err.message : 'Could not capture region.', 'error');
        }
    }

    async function onStartNewSession() {
        state.pendingManualSession = true;
        state.activeSessionStartedAt = '';
        await persistFieldsiteHistory(state.currentFieldsite);
        renderEntries();
        showStatus('The next note or capture will start a new session.', 'success', { autoHideMs: 1800 });
    }

    async function onNewNote(options) {
        if (state.noteCreating) return;
        if (!(await ensureObservationHostPermission({ canPrompt: !(options && options.fromShortcut) }))) return;
        if (!(await ensureReady())) return;
        state.noteCreating = true;
        try {
            const result = await sendRuntimeMessage({ type: 'observer:getPageContext' });
            if (!result || !result.ok || !result.page) {
                throw new Error('Could not read page context.');
            }
            const button = document.getElementById('newNoteButton');
            await appendEntry({
                page: result.page,
                imageDataUrl: '',
                forceMetadataBox: true,
                initialNote: '',
                focusAnchor: button,
                forceFocus: true
            });
        } catch (err) {
            showStatus(err && err.message ? err.message : 'Could not create note entry.', 'error');
        } finally {
            state.noteCreating = false;
        }
    }

    async function appendEntry(input) {
        const nowIso = new Date().toISOString();
        const sessionEval = ObserverSession.evaluateSession({
            mode: state.settings.sessionMode,
            rolloverHour: Number.isFinite(state.settings.rolloverHour) ? state.settings.rolloverHour : 4,
            gapMinutes: 120,
            previousSession: state.lastSession,
            fieldsite: state.currentFieldsite,
            forceManual: false,
            nowIso
        });
        const sessions = listSessions();
        const targetedSession = state.activeSessionStartedAt
            ? sessions.find((session) => session.startedAt === state.activeSessionStartedAt)
            : null;

        let sessionStartedAt = '';
        let sessionDate = sessionEval.sessionDate;
        let sessionNumber = 1;
        let sessionHeading = false;

        if (state.pendingManualSession || (!targetedSession && sessionEval.sessionHeading)) {
            sessionStartedAt = nowIso;
            sessionDate = sessionEval.sessionDate;
            sessionNumber = sessions.length + 1;
            sessionHeading = true;
            state.pendingManualSession = false;
            state.activeSessionStartedAt = sessionStartedAt;
        } else if (targetedSession) {
            sessionStartedAt = targetedSession.startedAt;
            sessionDate = targetedSession.sessionDate;
            sessionNumber = targetedSession.number;
            state.activeSessionStartedAt = sessionStartedAt;
        } else if (state.lastSession && state.lastSession.sessionStartedAt) {
            sessionStartedAt = state.lastSession.sessionStartedAt;
            sessionDate = state.lastSession.sessionDate || sessionEval.sessionDate;
            sessionNumber = Number(state.lastSession.sessionNumber) || Math.max(1, sessions.length);
            state.activeSessionStartedAt = sessionStartedAt;
        } else {
            sessionStartedAt = nowIso;
            sessionDate = sessionEval.sessionDate;
            sessionNumber = sessions.length + 1;
            sessionHeading = true;
            state.activeSessionStartedAt = sessionStartedAt;
        }

        const activeTab = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = activeTab[0] || {};
        const tabStateResult = await sendRuntimeMessage({
            type: 'observer:getTabSessionState',
            tabId: tab.id
        });
        const tabState = tabStateResult && tabStateResult.state ? tabStateResult.state : null;
        const metadataVisible = !!input.forceMetadataBox || !tabState || tabState.lastUrl !== input.page.url || !tabState.metadataSeenForPage;
        const metadataSeenForPage = !!(metadataVisible || (tabState && tabState.metadataSeenForPage));

        const draft = {
            uuid: ObserverSerialize.createUuid(),
            fieldsite: state.currentFieldsite,
            url: input.page.url,
            pageTitle: input.page.title,
            timestamp: nowIso,
            note: input.initialNote || '',
            imageDataUrl: input.imageDataUrl || '',
            noteDirty: false,
            metadataVisible,
            html: input.page.html,
            sessionDate,
            sessionStartedAt,
            sessionHeading,
            sessionNumber,
            sessionHeadingLabel: sessionHeading ? `${state.currentFieldsite} \u2014 ${ObserverSession.formatHeadingTimestamp(sessionStartedAt)} \u2014 Session ${sessionNumber}` : ''
        };

        const payload = ObserverSerialize.buildObservationPayload(draft);
        const submitResult = await ObserverConnectionClient.submitObservation(state.settings, payload.payload);
        if (!submitResult || !submitResult.ok) {
            throw new Error((submitResult && submitResult.error) || 'Quackdas did not accept the observation.');
        }

        state.entries.push(draft);
        state.lastSession = {
            sessionDate,
            lastCaptureAt: nowIso,
            sessionStartedAt,
            sessionNumber
        };
        await persistFieldsiteHistory(state.currentFieldsite);
        await sendRuntimeMessage({
            type: 'observer:setTabSessionState',
            tabId: tab.id,
            lastUrl: input.page.url,
            lastCaptureAt: nowIso,
            navigationId: tabState && tabState.navigationId ? tabState.navigationId : `${Date.now()}`,
            metadataSeenForPage
        });
        const entriesContainer = document.getElementById('entriesContainer');
        const preservedScrollTop = entriesContainer ? entriesContainer.scrollTop : 0;
        renderEntries();
        if (input.forceFocus || shouldAutoFocusNewEntry(input.focusAnchor)) {
            focusEntryByUuid(draft.uuid);
        } else if (entriesContainer) {
            entriesContainer.scrollTop = preservedScrollTop;
        }
    }

    async function onNoteChanged(uuid, nextNote) {
        const entry = state.entries.find((item) => item.uuid === uuid);
        if (!entry) return;
        entry.note = nextNote;
        entry.noteDirty = true;
        queueFieldsiteHistoryPersist(state.currentFieldsite, 1000);
        window.clearTimeout(onNoteChanged._timers && onNoteChanged._timers[uuid]);
        onNoteChanged._timers = onNoteChanged._timers || {};
        onNoteChanged._timers[uuid] = window.setTimeout(async () => {
            try {
                const payload = ObserverSerialize.buildObservationPayload(entry, {
                    includeHtml: false,
                    includeImage: false,
                    preserveExistingAssets: true
                });
                const result = await ObserverConnectionClient.submitObservation(state.settings, payload.payload);
                if (!result || !result.ok) {
                    showStatus((result && result.error) || 'Could not update the observation.', 'error');
                    return;
                }
                entry.noteDirty = false;
                queueFieldsiteHistoryPersist(state.currentFieldsite, 100);
            } catch (err) {
                showStatus(err && err.message ? err.message : 'Could not update the observation.', 'error');
            }
        }, 500);
    }

    async function onDeleteNote(uuid) {
        const entry = state.entries.find((item) => item.uuid === uuid);
        if (!entry || !canDeleteEmptyEntry(entry)) return;
        clearPendingNoteUpdate(uuid);
        const entriesContainer = document.getElementById('entriesContainer');
        const preservedScrollTop = entriesContainer ? entriesContainer.scrollTop : 0;
        try {
            const result = await ObserverConnectionClient.deleteObservation(state.settings, {
                uuid: entry.uuid,
                fieldsite: state.currentFieldsite
            });
            if (!result || !result.ok) {
                showStatus((result && result.error) || 'Could not delete the note.', 'error');
                return;
            }
            await syncFieldsiteHistoryFromQuackdas(state.currentFieldsite, { showErrors: false });
            if (entriesContainer) {
                entriesContainer.scrollTop = preservedScrollTop;
            }
            showStatus('Note deleted.', 'success', { autoHideMs: 1600 });
        } catch (err) {
            showStatus(err && err.message ? err.message : 'Could not delete the note.', 'error');
        }
    }

    async function ensureReady() {
        await reloadSettings({ refreshFieldsitesAfter: false });
        if (!state.currentFieldsite) {
            showStatus('Choose a fieldsite before capturing.', 'error');
            return false;
        }
        if (!state.settings.serverUrl || !state.settings.authToken) {
            showStatus('Open Settings and paste the Quackdas config first.', 'error');
            return false;
        }
        try {
            const status = await ObserverConnectionClient.getStatus(state.settings);
            if (!status || !status.ok) {
                showStatus((status && status.error) || 'Could not reach Quackdas.', 'error');
                return false;
            }
            if (!status.hasActiveProject) {
                showStatus('Quackdas is connected, but no saved project is open.', 'error');
                return false;
            }
            clearStatusIfConnectionError();
        } catch (err) {
            showStatus(err && err.message ? err.message : 'Could not reach Quackdas.', 'error');
            return false;
        }
        return true;
    }

    async function ensureObservationHostPermission(options) {
        const canPrompt = !options || options.canPrompt !== false;
        try {
            const permission = {
                origins: ['<all_urls>']
            };
            if (!canPrompt) {
                const alreadyGranted = await browser.permissions.contains(permission);
                if (alreadyGranted) {
                    return true;
                }
                showStatus('Grant Firefox page access once from the Capture region or New note button in the sidebar.', 'error');
                return false;
            }
            const granted = await browser.permissions.request(permission);
            if (!granted) {
                showStatus('Firefox needs page-access permission before Quackdas can capture notes or screenshots.', 'error');
                return false;
            }
            return true;
        } catch (err) {
            const text = err && err.message ? err.message : String(err || '');
            if (/user input handler/i.test(text)) {
                showStatus('Grant page access from the Capture region or New note button in the sidebar.', 'error');
                return false;
            }
            throw err;
        }
    }

    async function onSelectSession(sessionStartedAt) {
        state.activeSessionStartedAt = String(sessionStartedAt || '');
        state.pendingManualSession = false;
        await persistFieldsiteHistory(state.currentFieldsite);
        renderEntries();
        showStatus('New notes and captures will be added to the selected session.', 'success', { autoHideMs: 1800 });
    }

    async function onRuntimeMessage(message) {
        if (!message || typeof message !== 'object') return undefined;
        if (message.type !== 'observer:runPendingShortcut') return undefined;
        await runPendingShortcutIfAny();
        return { ok: true };
    }

    async function runPendingShortcutIfAny() {
        const pending = await ObserverStorage.get(PENDING_COMMAND_KEY, null);
        if (!pending || typeof pending !== 'object' || !pending.command) return false;
        await ObserverStorage.remove(PENDING_COMMAND_KEY);
        if (pending.command === 'capture-region') {
            await onCaptureRegion({ fromShortcut: true });
            return true;
        }
        if (pending.command === 'new-note') {
            await onNewNote({ fromShortcut: true });
            return true;
        }
        return false;
    }

    function listSessions() {
        const seen = new Set();
        const sessions = [];
        state.entries.forEach((entry) => {
            const startedAt = String(entry.sessionStartedAt || '').trim();
            if (!startedAt || seen.has(startedAt)) return;
            seen.add(startedAt);
            sessions.push({
                startedAt,
                sessionDate: entry.sessionDate,
                number: Number(entry.sessionNumber) || (sessions.length + 1)
            });
        });
        return sessions;
    }

    function deriveLastSessionFromEntries(entries) {
        const list = Array.isArray(entries) ? entries : [];
        const lastEntry = list[list.length - 1];
        if (!lastEntry) return null;
        return {
            sessionDate: String(lastEntry.sessionDate || '').trim(),
            lastCaptureAt: String(lastEntry.timestamp || '').trim(),
            sessionStartedAt: String(lastEntry.sessionStartedAt || '').trim(),
            sessionNumber: Number(lastEntry.sessionNumber) || 1
        };
    }

    function resizeNoteTextarea(textarea, minHeight, maxLines) {
        if (!textarea) return;
        const computed = window.getComputedStyle(textarea);
        const fontSize = Number.parseFloat(computed.fontSize);
        const rawLineHeight = String(computed.lineHeight || '').trim();
        let lineHeight = Number.NaN;
        if (rawLineHeight.endsWith('px')) {
            lineHeight = Number.parseFloat(rawLineHeight);
        } else {
            const parsedLineHeight = Number.parseFloat(rawLineHeight);
            if (Number.isFinite(parsedLineHeight) && parsedLineHeight > 0) {
                lineHeight = parsedLineHeight <= 4 && Number.isFinite(fontSize) && fontSize > 0
                    ? parsedLineHeight * fontSize
                    : parsedLineHeight;
            }
        }
        if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
            lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.6 : 22.4;
        }
        const floor = Number(minHeight) > 0 ? Number(minHeight) : lineHeight;
        const maxHeight = Number(maxLines) > 0 ? lineHeight * Number(maxLines) : Infinity;
        textarea.style.height = 'auto';
        const nextHeight = Math.max(floor, Math.min(textarea.scrollHeight, maxHeight));
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    function shouldAutoFocusNewEntry(anchor) {
        const activeElement = document.activeElement;
        if (!anchor) {
            return !activeElement || activeElement === document.body;
        }
        return activeElement === anchor || activeElement === document.body;
    }

    function focusEntryByUuid(uuid) {
        const target = document.querySelector(`.entry-card[data-uuid="${CSS.escape(String(uuid || ''))}"] .entry-note`);
        if (!target) return;
        resizeNoteTextarea(target, 0, 50);
        target.focus();
        target.setSelectionRange(target.value.length, target.value.length);
        target.scrollIntoView({ block: 'nearest' });
    }

    function scaleRectToBitmap(rect, pixelRatio) {
        const ratio = Number(pixelRatio) > 0 ? Number(pixelRatio) : 1;
        return {
            left: rect.left * ratio,
            top: rect.top * ratio,
            width: rect.width * ratio,
            height: rect.height * ratio
        };
    }

    function showStatus(message, status, options) {
        const banner = document.getElementById('statusBanner');
        if (state.statusClearTimer) {
            window.clearTimeout(state.statusClearTimer);
            state.statusClearTimer = 0;
        }
        banner.hidden = !message;
        banner.innerHTML = '';
        banner.dataset.status = status || '';
        if (message) {
            const text = document.createElement('div');
            text.className = 'status-banner-message';
            text.textContent = message;
            banner.appendChild(text);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'status-banner-close';
            close.setAttribute('aria-label', 'Dismiss message');
            close.textContent = '×';
            close.addEventListener('click', () => showStatus('', ''));
            banner.appendChild(close);
        }
        const autoHideMs = Number(options && options.autoHideMs);
        if (message && Number.isFinite(autoHideMs) && autoHideMs > 0) {
            const expectedMessage = String(message);
            state.statusClearTimer = window.setTimeout(() => {
                const current = banner.querySelector('.status-banner-message');
                if (String(current && current.textContent || '') !== expectedMessage) return;
                showStatus('', '');
            }, autoHideMs);
        }
    }

    function clearStatusIfConnectionError() {
        const banner = document.getElementById('statusBanner');
        if (!banner || banner.hidden) return;
        const current = banner.querySelector('.status-banner-message');
        const message = String(current && current.textContent || '');
        if (!/Quackdas|localhost|server URL|Unauthorized|saved project/i.test(message)) return;
        showStatus('', '');
    }

    async function sendRuntimeMessage(message) {
        try {
            return await browser.runtime.sendMessage(message);
        } catch (err) {
            const text = err && err.message ? err.message : String(err || '');
            if (/Receiving end does not exist|Could not establish connection/i.test(text)) {
                showStatus('The extension reloaded. Reopening the sidebar now.', 'error');
                window.setTimeout(() => window.location.reload(), 60);
                throw new Error('The extension was reloaded. Please retry after the sidebar refreshes.');
            }
            throw err;
        }
    }

    function safeHost(url) {
        try {
            return new URL(url).host || url;
        } catch (err) {
            return url;
        }
    }
})();
