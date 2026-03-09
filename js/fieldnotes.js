let currentFieldnoteState = {
    docId: null,
    pageIndex: 0,
    totalPages: 0
};

const FIELDNOTE_DOC_TYPE = 'fieldnote';
const FIELDNOTE_DOC_TYPE_ATTR = 'quackdasDocType';
const FIELDNOTE_PATH_ATTR = 'quackdasFieldnotePath';

function makeEmptyFieldnoteData() {
    return {
        version: 1,
        sessions: []
    };
}

function normalizeFieldnoteRelativeAssetPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const normalized = raw.replace(/\\/g, '/');
    if (
        normalized.startsWith('/') ||
        normalized.startsWith('//') ||
        /^[a-zA-Z]:/.test(normalized) ||
        /^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(normalized)
    ) {
        return '';
    }

    const parts = normalized.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) {
        return '';
    }

    return normalized;
}

function normalizePackedFieldnoteScreenshotDataUrl(value) {
    const normalized = String(value || '').trim();
    return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(normalized) ? normalized : '';
}

function normalizeFieldnoteEntry(rawEntry) {
    const entry = (rawEntry && typeof rawEntry === 'object') ? rawEntry : {};
    return {
        id: String(entry.id || `fieldnote_entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
        uuid: String(entry.uuid || '').trim(),
        url: String(entry.url || '').trim(),
        pageTitle: String(entry.pageTitle || entry.page_title || '').trim(),
        timestamp: String(entry.timestamp || new Date().toISOString()),
        note: canonicalizeDocumentContent(entry.note || ''),
        screenshotPath: String(entry.screenshotPath || '').trim(),
        htmlPath: String(entry.htmlPath || '').trim(),
        packedScreenshotDataUrl: normalizePackedFieldnoteScreenshotDataUrl(entry.packedScreenshotDataUrl),
        packedHtmlContent: String(entry.packedHtmlContent || '')
    };
}

function normalizeFieldnoteSession(rawSession, fieldsite) {
    const session = (rawSession && typeof rawSession === 'object') ? rawSession : {};
    const startedAt = String(session.startedAt || session.timestamp || new Date().toISOString());
    const sessionDate = String(session.sessionDate || startedAt.slice(0, 10));
    const heading = String(session.heading || `${fieldsite || 'Fieldsite'} \u2014 ${formatFieldnoteHeadingTimestamp(startedAt)}`);
    const entries = Array.isArray(session.entries) ? session.entries.map(normalizeFieldnoteEntry) : [];
    return {
        id: String(session.id || `fieldnote_session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
        sessionDate,
        startedAt,
        heading,
        entries
    };
}

function normalizeFieldnoteDocument(doc) {
    if (!doc || doc.type !== FIELDNOTE_DOC_TYPE) return doc;
    const fieldsite = String(doc.title || 'Fieldsite');
    const data = (doc.fieldnoteData && typeof doc.fieldnoteData === 'object') ? doc.fieldnoteData : makeEmptyFieldnoteData();
    doc.fieldnoteData = {
        version: 1,
        sessions: Array.isArray(data.sessions) ? data.sessions.map((session) => normalizeFieldnoteSession(session, fieldsite)) : []
    };
    refreshFieldnoteDerivedData(doc);
    return doc;
}

function refreshFieldnoteDerivedData(doc) {
    if (!doc || doc.type !== FIELDNOTE_DOC_TYPE) return doc;
    const sessions = Array.isArray(doc.fieldnoteData?.sessions) ? doc.fieldnoteData.sessions : [];
    const contentParts = [];
    const textRangesByEntryId = {};
    const imageEntryIds = new Set();
    let cursor = 0;

    sessions.forEach((session) => {
        (session.entries || []).forEach((entry) => {
            const note = canonicalizeDocumentContent(entry.note || '');
            if (note.length > 0) {
                if (contentParts.length > 0) {
                    contentParts.push('\n\n');
                    cursor += 2;
                }
                const start = cursor;
                contentParts.push(note);
                cursor += note.length;
                textRangesByEntryId[entry.id] = {
                    start,
                    end: start + note.length
                };
            }
            if (entry.packedScreenshotDataUrl || normalizeFieldnoteRelativeAssetPath(entry.screenshotPath)) {
                imageEntryIds.add(entry.id);
            }
        });
    });

    doc.content = contentParts.join('');
    doc._fieldnoteTextRangesByEntryId = textRangesByEntryId;
    doc._fieldnoteImageEntryIds = imageEntryIds;
    return doc;
}

function formatFieldnoteHeadingTimestamp(iso) {
    const date = new Date(iso);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function createFieldnoteDocument(fieldsite, options = {}) {
    const doc = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: String(fieldsite || 'Fieldsite').trim() || 'Fieldsite',
        content: '',
        type: FIELDNOTE_DOC_TYPE,
        metadata: Object.assign({}, options.metadata || {}),
        caseIds: [],
        created: options.created || new Date().toISOString(),
        lastAccessed: options.modified || options.created || new Date().toISOString(),
        fieldnoteData: makeEmptyFieldnoteData()
    };
    normalizeFieldnoteDocument(doc);
    return doc;
}

function getFieldnoteDocByFieldsite(fieldsite) {
    const label = String(fieldsite || '').trim();
    if (!label) return null;
    return (appData.documents || []).find((doc) => doc && doc.type === FIELDNOTE_DOC_TYPE && doc.title === label) || null;
}

function findFieldnoteSessionByDate(doc, sessionDate) {
    if (!doc || doc.type !== FIELDNOTE_DOC_TYPE) return null;
    return (doc.fieldnoteData?.sessions || []).find((session) => session.sessionDate === sessionDate) || null;
}

function findFieldnoteSessionByStartedAt(doc, startedAt) {
    if (!doc || doc.type !== FIELDNOTE_DOC_TYPE) return null;
    const normalized = String(startedAt || '').trim();
    if (!normalized) return null;
    return (doc.fieldnoteData?.sessions || []).find((session) => String(session.startedAt || '').trim() === normalized) || null;
}

function findFieldnoteEntryByUuid(doc, uuid) {
    if (!doc || doc.type !== FIELDNOTE_DOC_TYPE) return null;
    const normalized = String(uuid || '').trim();
    if (!normalized) return null;
    for (const session of (doc.fieldnoteData?.sessions || [])) {
        const entry = (session.entries || []).find((item) => item.uuid === normalized);
        if (entry) return { session, entry };
    }
    return null;
}

function applyObservationEntryToProject(observation) {
    if (!observation || typeof observation !== 'object') return null;
    const fieldsite = String(observation.fieldsite || '').trim();
    if (!fieldsite) return null;

    saveHistory();

    let doc = getFieldnoteDocByFieldsite(fieldsite);
    if (!doc) {
        doc = createFieldnoteDocument(fieldsite, {
            created: observation.timestamp,
            modified: observation.timestamp
        });
        appData.documents.push(doc);
    }

    normalizeFieldnoteDocument(doc);
    const existing = findFieldnoteEntryByUuid(doc, observation.uuid);
    if (existing) {
        existing.entry.url = String(observation.url || existing.entry.url || '');
        existing.entry.pageTitle = String(observation.pageTitle || existing.entry.pageTitle || '');
        existing.entry.timestamp = String(observation.timestamp || existing.entry.timestamp || new Date().toISOString());
        existing.entry.note = canonicalizeDocumentContent(observation.note || '');
        existing.entry.screenshotPath = String(observation.screenshotPath || existing.entry.screenshotPath || '');
        existing.entry.htmlPath = String(observation.htmlPath || existing.entry.htmlPath || '');
        existing.session.startedAt = existing.session.startedAt || existing.entry.timestamp;
        existing.session.heading = existing.session.heading || `${fieldsite} \u2014 ${formatFieldnoteHeadingTimestamp(existing.session.startedAt)}`;
    } else {
        let session = findFieldnoteSessionByStartedAt(doc, observation.sessionStartedAt) || findFieldnoteSessionByDate(doc, observation.sessionDate);
        if (!session || observation.sessionHeading) {
            session = normalizeFieldnoteSession({
                sessionDate: observation.sessionDate,
                startedAt: observation.sessionStartedAt || observation.timestamp,
                heading: `${fieldsite} \u2014 ${formatFieldnoteHeadingTimestamp(observation.timestamp)}`,
                entries: []
            }, fieldsite);
            doc.fieldnoteData.sessions.push(session);
            doc.fieldnoteData.sessions.sort((a, b) => Date.parse(a.startedAt || '') - Date.parse(b.startedAt || ''));
        }
        session.entries.push(normalizeFieldnoteEntry({
            uuid: observation.uuid,
            url: observation.url,
            pageTitle: observation.pageTitle,
            timestamp: observation.timestamp,
            note: observation.note,
            screenshotPath: observation.screenshotPath,
            htmlPath: observation.htmlPath
        }));
        session.entries.sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));
    }

    refreshFieldnoteDerivedData(doc);
    doc.lastAccessed = observation.timestamp || new Date().toISOString();
    appData.currentDocId = doc.id;
    appData.selectedCaseId = null;
    appData.filterCodeId = null;
    saveData();
    return doc;
}

function deleteObservationEntryFromProject(observation) {
    if (!observation || typeof observation !== 'object') return null;
    const fieldsite = String(observation.fieldsite || '').trim();
    const uuid = String(observation.uuid || '').trim();
    if (!fieldsite || !uuid) return null;

    const doc = getFieldnoteDocByFieldsite(fieldsite);
    if (!doc) return null;
    normalizeFieldnoteDocument(doc);

    const existing = findFieldnoteEntryByUuid(doc, uuid);
    if (!existing || !existing.entry) return null;

    saveHistory();

    const deletedEntryId = String(existing.entry.id || '').trim();
    const deletedRange = doc._fieldnoteTextRangesByEntryId ? doc._fieldnoteTextRangesByEntryId[deletedEntryId] : null;
    const oldRanges = Object.assign({}, doc._fieldnoteTextRangesByEntryId || {});

    existing.session.entries = (existing.session.entries || []).filter((entry) => entry !== existing.entry);
    if ((existing.session.entries || []).length === 0) {
        doc.fieldnoteData.sessions = (doc.fieldnoteData.sessions || []).filter((session) => session !== existing.session);
    }

    refreshFieldnoteDerivedData(doc);
    const nextRanges = Object.assign({}, doc._fieldnoteTextRangesByEntryId || {});

    appData.segments = (appData.segments || []).filter((segment) => {
        if (!segment || segment.docId !== doc.id) return true;
        if (segment.fieldnoteImageId) {
            return String(segment.fieldnoteImageId || '').trim() !== deletedEntryId;
        }
        if (segment.pdfRegion) return false;

        const start = Number(segment.startIndex);
        const end = Number(segment.endIndex);
        if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return false;

        const oldEntryId = Object.keys(oldRanges).find((entryId) => {
            const range = oldRanges[entryId];
            return range && start >= range.start && end <= range.end;
        });
        if (!oldEntryId || oldEntryId === deletedEntryId) return false;

        const oldRange = oldRanges[oldEntryId];
        const nextRange = nextRanges[oldEntryId];
        if (!oldRange || !nextRange) return false;

        const relativeStart = start - oldRange.start;
        const relativeEnd = end - oldRange.start;
        const nextStart = nextRange.start + relativeStart;
        const nextEnd = nextRange.start + relativeEnd;
        if (!(nextEnd > nextStart)) return false;

        segment.startIndex = nextStart;
        segment.endIndex = nextEnd;
        segment.text = doc.content.substring(nextStart, nextEnd);
        segment.modified = new Date().toISOString();
        return true;
    });

    if (typeof pruneInvalidSegmentCodeMemos === 'function') {
        pruneInvalidSegmentCodeMemos();
    }
    doc.lastAccessed = new Date().toISOString();
    appData.currentDocId = doc.id;
    appData.selectedCaseId = null;
    appData.filterCodeId = null;
    saveData();
    return doc;
}

function isFieldnoteDoc(doc) {
    return !!(doc && doc.type === FIELDNOTE_DOC_TYPE);
}

function isFieldnoteDocumentActive() {
    const doc = appData.documents.find((item) => item && item.id === appData.currentDocId);
    return isFieldnoteDoc(doc);
}

function getFieldnotePageCount(doc) {
    if (!isFieldnoteDoc(doc)) return 0;
    return Math.max(1, (doc.fieldnoteData?.sessions || []).length || 0);
}

function ensureFieldnotePageIndex(doc, requestedIndex) {
    const total = getFieldnotePageCount(doc);
    if (total <= 0) return 0;
    const next = Number.isFinite(Number(requestedIndex)) ? Number(requestedIndex) : 0;
    return Math.max(0, Math.min(total - 1, next));
}

function setCurrentFieldnotePage(docId, pageIndex) {
    const doc = appData.documents.find((item) => item && item.id === docId);
    if (!isFieldnoteDoc(doc)) return;
    currentFieldnoteState.docId = docId;
    currentFieldnoteState.totalPages = getFieldnotePageCount(doc);
    currentFieldnoteState.pageIndex = ensureFieldnotePageIndex(doc, pageIndex);
}

function getCurrentFieldnotePageIndex(doc) {
    if (!isFieldnoteDoc(doc)) return 0;
    if (currentFieldnoteState.docId !== doc.id) {
        setCurrentFieldnotePage(doc.id, 0);
    }
    return ensureFieldnotePageIndex(doc, currentFieldnoteState.pageIndex);
}

function fieldnotePrevPage() {
    const doc = appData.documents.find((item) => item && item.id === appData.currentDocId);
    if (!isFieldnoteDoc(doc)) return;
    setCurrentFieldnotePage(doc.id, getCurrentFieldnotePageIndex(doc) - 1);
    renderCurrentDocumentView();
}

function fieldnoteNextPage() {
    const doc = appData.documents.find((item) => item && item.id === appData.currentDocId);
    if (!isFieldnoteDoc(doc)) return;
    setCurrentFieldnotePage(doc.id, getCurrentFieldnotePageIndex(doc) + 1);
    renderCurrentDocumentView();
}

function getFieldnoteSegmentsForEntry(doc, entry) {
    if (!isFieldnoteDoc(doc) || !entry) return [];
    const range = doc._fieldnoteTextRangesByEntryId ? doc._fieldnoteTextRangesByEntryId[entry.id] : null;
    return (appData.segments || []).filter((segment) => {
        if (!segment || segment.docId !== doc.id) return false;
        if (segment.fieldnoteImageId) return segment.fieldnoteImageId === entry.id;
        if (segment.pdfRegion) return false;
        if (!range) return false;
        const start = Number(segment.startIndex);
        const end = Number(segment.endIndex);
        return Number.isFinite(start) && Number.isFinite(end) && end > range.start && start < range.end;
    });
}

function getFieldnoteSessionHasCoding(doc, session) {
    if (!isFieldnoteDoc(doc) || !session) return false;
    return (session.entries || []).some((entry) => getFieldnoteSegmentsForEntry(doc, entry).length > 0);
}

function getFieldnoteSessionRange(doc, session) {
    const entries = Array.isArray(session?.entries) ? session.entries : [];
    let start = Infinity;
    let end = -Infinity;
    entries.forEach((entry) => {
        const range = doc._fieldnoteTextRangesByEntryId ? doc._fieldnoteTextRangesByEntryId[entry.id] : null;
        if (!range) return;
        start = Math.min(start, range.start);
        end = Math.max(end, range.end);
    });
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function renderFieldnoteDocument(doc, contentElement) {
    if (!isFieldnoteDoc(doc) || !contentElement) return;
    normalizeFieldnoteDocument(doc);

    const sessions = doc.fieldnoteData?.sessions || [];
    const pageIndex = ensureFieldnotePageIndex(doc, getCurrentFieldnotePageIndex(doc));
    setCurrentFieldnotePage(doc.id, pageIndex);
    const session = sessions[pageIndex] || null;
    const segments = getSegmentsForDoc(doc.id);

    const html = session ? renderFieldnoteSessionHtml(doc, session, segments) : '<div class="empty-state"><p style="font-size: 13px;">No fieldnote entries yet</p></div>';
    contentElement.classList.add('fieldnote-document');
    contentElement.innerHTML = html;
    contentElement.onmouseup = (event) => {
        const targetEl = event && event.target && event.target.nodeType === 1
            ? event.target
            : (event && event.target && event.target.parentElement ? event.target.parentElement : null);
        if (targetEl && targetEl.closest && targetEl.closest('[data-fieldnote-image-id]')) return;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => handleTextSelection());
            return;
        }
        window.setTimeout(() => handleTextSelection(), 0);
    };
    contentElement.onkeyup = () => {
        handleTextSelection();
    };
    bindFieldnoteInteractions(doc, contentElement);
    updateFieldnoteNavigation(doc);
    renderDocumentSegmentMarkers(contentElement);
}

function renderFieldnoteSessionHtml(doc, session, segments) {
    const safeHeading = escapeHtml(session.heading || `${doc.title} \u2014 ${session.sessionDate || ''}`);
    const entriesHtml = (session.entries || []).map((entry) => renderFieldnoteEntryHtml(doc, entry, segments)).join('');
    return `
        <div class="fieldnote-session" data-session-id="${escapeHtmlAttrValue(session.id)}">
            <div class="fieldnote-session-heading">${safeHeading}</div>
            ${entriesHtml}
        </div>
    `;
}

function renderFieldnoteEntryHtml(doc, entry, segments) {
    const range = doc._fieldnoteTextRangesByEntryId ? doc._fieldnoteTextRangesByEntryId[entry.id] : null;
    const noteSegments = range
        ? (segments || []).filter((segment) => !segment.pdfRegion && !segment.fieldnoteImageId && segment.docId === doc.id && Number(segment.endIndex) > range.start && Number(segment.startIndex) < range.end)
        : [];
    const imageSegments = (segments || []).filter((segment) => segment && segment.docId === doc.id && segment.fieldnoteImageId === entry.id);
    const noteHtml = renderFieldnoteNoteHtml(doc, entry, range, noteSegments);
    const screenshotSrc = getRenderableFieldnoteScreenshotPath(doc, entry);
    const imageHtml = screenshotSrc
        ? renderFieldnoteImageHtml(doc, entry, imageSegments, screenshotSrc)
        : '';
    return `
        <article class="fieldnote-entry" data-fieldnote-entry-id="${escapeHtmlAttrValue(entry.id)}">
            <div class="fieldnote-metadata-box">
                <a class="fieldnote-entry-url" href="${escapeHtmlAttrValue(entry.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(formatFieldnoteMetadataLabel(entry))}</a>
                <div class="fieldnote-entry-timestamp">${escapeHtml(formatFieldnoteHeadingTimestamp(entry.timestamp))}</div>
            </div>
            ${noteHtml}
            ${imageHtml}
        </article>
    `;
}

function formatFieldnoteMetadataLabel(entry) {
    const host = (() => {
        try {
            return new URL(entry.url).host || entry.url;
        } catch (_) {
            return entry.url;
        }
    })();
    return `${host} \u2014 ${entry.pageTitle || entry.url}`;
}

function renderFieldnoteNoteHtml(doc, entry, range, segments) {
    const noteText = String(entry.note || '');
    if (!noteText) return '';
    if (!range || !segments || segments.length === 0) {
        return `<div class="fieldnote-note" data-fieldnote-note-entry-id="${escapeHtmlAttrValue(entry.id)}">${preserveLineBreaks(escapeHtml(noteText))}</div>`;
    }

    const events = [];
    segments.forEach((segment) => {
        const start = Math.max(range.start, Number(segment.startIndex));
        const end = Math.min(range.end, Number(segment.endIndex));
        if (!(end > start)) return;
        events.push({ pos: start - range.start, type: 'start', segment });
        events.push({ pos: end - range.start, type: 'end', segment });
    });
    events.sort((a, b) => a.pos !== b.pos ? a.pos - b.pos : (a.type === 'end' ? -1 : 1));

    let html = '';
    let cursor = 0;
    const active = new Set();
    events.forEach((event) => {
        if (event.pos > cursor) {
            const text = noteText.slice(cursor, event.pos);
            html += active.size > 0
                ? renderCodedSpan(text, Array.from(active))
                : preserveLineBreaks(escapeHtml(text));
            cursor = event.pos;
        }
        if (event.type === 'start') active.add(event.segment);
        else active.delete(event.segment);
    });
    if (cursor < noteText.length) {
        const text = noteText.slice(cursor);
        html += active.size > 0
            ? renderCodedSpan(text, Array.from(active))
            : preserveLineBreaks(escapeHtml(text));
    }
    return `<div class="fieldnote-note" data-fieldnote-note-entry-id="${escapeHtmlAttrValue(entry.id)}">${html}</div>`;
}

function renderFieldnoteImageHtml(doc, entry, imageSegments, screenshotSrc) {
    const codes = collectCodesForSegments(imageSegments);
    const style = buildSegmentVisualStyleFromCodes(codes);
    const selected = appData.selectedText && appData.selectedText.kind === 'fieldnoteImage' && appData.selectedText.fieldnoteImageId === entry.id;
    const markerAttrs = codes.length > 0
        ? ` data-fieldnote-marker="true" style="${escapeHtmlAttrValue(style)}"`
        : '';
    return `
        <div class="fieldnote-image-wrap ${selected ? 'fieldnote-image-selected' : ''}" data-fieldnote-image-id="${escapeHtmlAttrValue(entry.id)}" tabindex="0" role="button" aria-label="Select screenshot for coding"${markerAttrs}>
            <img class="fieldnote-image" src="${escapeHtmlAttrValue(screenshotSrc)}" alt="Fieldnote screenshot">
        </div>
    `;
}

function collectCodesForSegments(segments) {
    const codeById = getCodeLookupMap();
    const codes = [];
    const seen = new Set();
    (segments || []).forEach((segment) => {
        (segment.codeIds || []).forEach((codeId) => {
            if (seen.has(codeId)) return;
            const code = codeById.get(codeId);
            if (!code) return;
            seen.add(codeId);
            codes.push(code);
        });
    });
    return codes;
}

function resolveFieldnoteAssetPath(doc, relativePath) {
    const normalized = normalizeFieldnoteRelativeAssetPath(relativePath);
    if (!normalized) return '';
    const basePath = String(doc?.metadata?.quackdasProjectPath || '').trim();
    if (!basePath) return normalized;
    const normalizedProjectPath = basePath.replace(/\\/g, '/');
    const projectDir = normalizedProjectPath.split('/').slice(0, -1).join('/');
    const parsedName = normalizedProjectPath.split('/').pop() || '';
    const baseName = parsedName.replace(/\.qdpx$/i, '') || doc.metadata?.quackdasProjectName || 'project';
    const sidecarRoot = `${projectDir}/.${sanitizeFieldnoteBaseName(baseName)}_media`;
    const absolutePath = `${sidecarRoot}/${normalized}`.replace(/\\/g, '/');
    return encodeURI(`file://${absolutePath.startsWith('/') ? '' : '/'}${absolutePath}`);
}

function getRenderableFieldnoteScreenshotPath(doc, entry) {
    if (entry && entry.packedScreenshotDataUrl) return entry.packedScreenshotDataUrl;
    return resolveFieldnoteAssetPath(doc, entry ? entry.screenshotPath : '');
}

function sanitizeFieldnoteBaseName(value) {
    const baseName = String(value || 'project').trim() || 'project';
    return baseName.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, '-');
}

function serializeFieldnoteDataForStorage(fieldnoteData) {
    const data = (fieldnoteData && typeof fieldnoteData === 'object') ? fieldnoteData : makeEmptyFieldnoteData();
    return {
        version: 1,
        sessions: (Array.isArray(data.sessions) ? data.sessions : []).map((session) => ({
            id: String(session.id || ''),
            sessionDate: String(session.sessionDate || ''),
            startedAt: String(session.startedAt || ''),
            heading: String(session.heading || ''),
            entries: (Array.isArray(session.entries) ? session.entries : []).map((entry) => ({
                id: String(entry.id || ''),
                uuid: String(entry.uuid || ''),
                url: String(entry.url || ''),
                pageTitle: String(entry.pageTitle || ''),
                timestamp: String(entry.timestamp || ''),
                note: String(entry.note || ''),
                screenshotPath: String(entry.screenshotPath || ''),
                htmlPath: String(entry.htmlPath || '')
            }))
        }))
    };
}

function syncFieldnoteProjectMetadata(projectPath) {
    const normalizedPath = String(projectPath || '').trim();
    const fileName = normalizedPath ? normalizedPath.split(/[\\/]/).pop() || '' : '';
    const projectName = fileName.replace(/\.qdpx$/i, '');
    (appData.documents || []).forEach((doc) => {
        if (!isFieldnoteDoc(doc)) return;
        if (!doc.metadata || typeof doc.metadata !== 'object') doc.metadata = {};
        doc.metadata.quackdasProjectPath = normalizedPath;
        doc.metadata.quackdasProjectFileName = fileName;
        doc.metadata.quackdasProjectName = projectName;
    });
}

function bindFieldnoteInteractions(doc, contentElement) {
    updateFieldnoteImageSelectionVisual(contentElement);
    Array.from(contentElement.querySelectorAll('[data-fieldnote-image-id]')).forEach((el) => {
        const imageId = String(el.dataset.fieldnoteImageId || '').trim();
        if (!imageId) return;
        const selectImage = (event) => {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            appData.selectedText = {
                kind: 'fieldnoteImage',
                fieldnoteImageId: imageId,
                text: `[Fieldnote image: ${imageId}]`
            };
            if (window.getSelection) {
                const selection = window.getSelection();
                if (selection) selection.removeAllRanges();
            }
            if (typeof el.focus === 'function') {
                try {
                    el.focus({ preventScroll: true });
                } catch (_) {
                    el.focus();
                }
            }
            updateFieldnoteImageSelectionVisual(contentElement);
            if (typeof renderCodes === 'function') renderCodes();
        };
        el.addEventListener('pointerdown', selectImage);
        el.addEventListener('mouseup', (event) => {
            event.stopPropagation();
        });
        el.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        el.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                selectImage(event);
            }
        });
        el.addEventListener('contextmenu', (event) => {
            selectImage(event);
            const entry = findFieldnoteEntryRecord(doc, imageId);
            if (!entry) return;
            const imageSegments = getFieldnoteSegmentsForEntry(doc, entry)
                .filter((segment) => segment && String(segment.fieldnoteImageId || '').trim() === imageId);
            if (!imageSegments.length || typeof showSegmentContextMenu !== 'function') return;
            showSegmentContextMenu(imageSegments.map((segment) => segment.id).join(','), event);
        });
    });
}

function updateFieldnoteImageSelectionVisual(contentElement) {
    if (!contentElement) return;
    const selectedImageId = appData.selectedText && appData.selectedText.kind === 'fieldnoteImage'
        ? String(appData.selectedText.fieldnoteImageId || '').trim()
        : '';
    Array.from(contentElement.querySelectorAll('[data-fieldnote-image-id]')).forEach((el) => {
        const imageId = String(el.dataset.fieldnoteImageId || '').trim();
        el.classList.toggle('fieldnote-image-selected', !!selectedImageId && imageId === selectedImageId);
    });
}

function updateFieldnoteNavigation(doc) {
    const nav = document.getElementById('pdfNavControls');
    const pageEl = document.getElementById('pdfCurrentPage');
    const totalEl = document.getElementById('pdfTotalPages');
    const prevBtn = document.getElementById('pdfPrevBtn');
    const nextBtn = document.getElementById('pdfNextBtn');
    if (!nav || !pageEl || !totalEl || !prevBtn || !nextBtn) return;

    const total = getFieldnotePageCount(doc);
    const pageIndex = getCurrentFieldnotePageIndex(doc);
    nav.hidden = false;
    pageEl.textContent = String(pageIndex + 1);
    totalEl.textContent = String(total);
    prevBtn.disabled = pageIndex <= 0;
    nextBtn.disabled = pageIndex >= total - 1;
    prevBtn.dataset.fieldnoteNav = '1';
    nextBtn.dataset.fieldnoteNav = '1';
  }

function getCurrentFieldnoteSession(doc) {
    if (!isFieldnoteDoc(doc)) return null;
    const sessions = doc.fieldnoteData?.sessions || [];
    return sessions[getCurrentFieldnotePageIndex(doc)] || null;
}

function findNextUncodedFieldnotePage(doc, direction) {
    if (!isFieldnoteDoc(doc)) return -1;
    const sessions = doc.fieldnoteData?.sessions || [];
    const current = getCurrentFieldnotePageIndex(doc);
    const step = direction < 0 ? -1 : 1;
    for (let idx = current + step; idx >= 0 && idx < sessions.length; idx += step) {
        if (!getFieldnoteSessionHasCoding(doc, sessions[idx])) {
            return idx;
        }
    }
    return -1;
}

function goToAdjacentUncodedFieldnotePage(direction) {
    const doc = appData.documents.find((item) => item && item.id === appData.currentDocId);
    if (!isFieldnoteDoc(doc)) return false;
    const nextIndex = findNextUncodedFieldnotePage(doc, direction);
    if (nextIndex < 0) return false;
    setCurrentFieldnotePage(doc.id, nextIndex);
    renderCurrentDocumentView();
    return true;
}

function openFieldnoteNavContextMenu(event) {
    const doc = appData.documents.find((item) => item && item.id === appData.currentDocId);
    if (!isFieldnoteDoc(doc) || typeof showContextMenu !== 'function') return;
    event.preventDefault();
    showContextMenu([
        { label: 'Next uncoded page', onClick: () => goToAdjacentUncodedFieldnotePage(1) },
        { label: 'Previous uncoded page', onClick: () => goToAdjacentUncodedFieldnotePage(-1) }
    ], event.clientX, event.clientY);
}

function getObservationHistoryForFieldsite(fieldsite) {
    const normalizedFieldsite = String(fieldsite || '').trim();
    if (!normalizedFieldsite) {
        return {
            fieldsite: '',
            entries: [],
            lastSession: null,
            activeSessionStartedAt: ''
        };
    }

    const doc = getFieldnoteDocByFieldsite(normalizedFieldsite);
    if (!isFieldnoteDoc(doc)) {
        return {
            fieldsite: normalizedFieldsite,
            entries: [],
            lastSession: null,
            activeSessionStartedAt: ''
        };
    }

    normalizeFieldnoteDocument(doc);

    const entries = [];
    (doc.fieldnoteData?.sessions || []).forEach((session, sessionIndex) => {
        const sessionNumber = sessionIndex + 1;
        const sessionStartedAt = String(session.startedAt || '').trim();
        const sessionHeadingLabel = `${normalizedFieldsite} — ${formatFieldnoteHeadingTimestamp(sessionStartedAt || new Date().toISOString())} — Session ${sessionNumber}`;
        (session.entries || []).forEach((entry, entryIndex) => {
            entries.push({
                uuid: String(entry.uuid || '').trim(),
                fieldsite: normalizedFieldsite,
                url: String(entry.url || '').trim(),
                pageTitle: String(entry.pageTitle || '').trim(),
                timestamp: String(entry.timestamp || '').trim(),
                note: String(entry.note || ''),
                imageDataUrl: String(entry.packedScreenshotDataUrl || '').trim(),
                screenshotPath: String(entry.screenshotPath || '').trim(),
                metadataVisible: true,
                html: String(entry.packedHtmlContent || ''),
                htmlPath: String(entry.htmlPath || '').trim(),
                sessionDate: String(session.sessionDate || '').trim(),
                sessionStartedAt,
                sessionHeading: entryIndex === 0,
                sessionNumber,
                sessionHeadingLabel: entryIndex === 0 ? sessionHeadingLabel : ''
            });
        });
    });

    const lastEntry = entries[entries.length - 1] || null;
    const lastSession = lastEntry ? {
        sessionDate: String(lastEntry.sessionDate || '').trim(),
        lastCaptureAt: String(lastEntry.timestamp || '').trim(),
        sessionStartedAt: String(lastEntry.sessionStartedAt || '').trim(),
        sessionNumber: Number(lastEntry.sessionNumber) || 1
    } : null;

    return {
        fieldsite: normalizedFieldsite,
        entries,
        lastSession,
        activeSessionStartedAt: lastSession ? String(lastSession.sessionStartedAt || '').trim() : ''
    };
}

function getAllObservationHistorySnapshot() {
    const byFieldsite = {};
    (appData.documents || []).forEach((doc) => {
        if (!isFieldnoteDoc(doc)) return;
        const fieldsite = String(doc.title || '').trim();
        if (!fieldsite) return;
        byFieldsite[fieldsite] = getObservationHistoryForFieldsite(fieldsite);
    });
    return { byFieldsite };
}

if (typeof globalThis !== 'undefined') {
    globalThis.__quackdasObservationBridge = globalThis.__quackdasObservationBridge || {};
    globalThis.__quackdasObservationBridge.getFieldsiteHistory = getObservationHistoryForFieldsite;
    globalThis.__quackdasObservationBridge.getAllHistory = getAllObservationHistorySnapshot;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        FIELDNOTE_DOC_TYPE,
        FIELDNOTE_DOC_TYPE_ATTR,
        FIELDNOTE_PATH_ATTR,
        makeEmptyFieldnoteData,
        normalizeFieldnoteEntry,
        normalizeFieldnoteDocument,
        normalizeFieldnoteRelativeAssetPath,
        normalizePackedFieldnoteScreenshotDataUrl,
        createFieldnoteDocument,
        applyObservationEntryToProject,
        deleteObservationEntryFromProject,
        findFieldnoteEntryByUuid,
        formatFieldnoteHeadingTimestamp,
        getAllObservationHistorySnapshot,
        getObservationHistoryForFieldsite,
        resolveFieldnoteAssetPath,
        syncFieldnoteProjectMetadata,
        serializeFieldnoteDataForStorage
    };
}
