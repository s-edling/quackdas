/**
 * Quackdas - Agent API surface
 * Local, explicit primitives for scripted workflows and future tool integration.
 */

(function attachAgentApi() {
    function canonicalizeText(input) {
        return String(input == null ? '' : input).replace(/\r\n?/g, '\n');
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function ensureAppData() {
        if (!appData || typeof appData !== 'object') {
            throw new Error('Project state is not available.');
        }
    }

    function requireString(value, fieldName) {
        const out = String(value || '').trim();
        if (!out) throw new Error(`${fieldName} is required.`);
        return out;
    }

    function getTextDocuments() {
        ensureAppData();
        return (Array.isArray(appData.documents) ? appData.documents : [])
            .filter((doc) => doc && doc.id && doc.type !== 'pdf');
    }

    function findDocument(docId) {
        const id = requireString(docId, 'doc_id');
        const doc = (Array.isArray(appData.documents) ? appData.documents : []).find((row) => row && row.id === id);
        if (!doc) throw new Error(`Document not found: ${id}`);
        return doc;
    }

    function toSemanticDocuments() {
        return getTextDocuments().map((doc) => ({
            id: String(doc.id),
            title: String(doc.title || 'Untitled document'),
            type: String(doc.type || 'text'),
            content: canonicalizeText(doc.content || '')
        }));
    }

    function nextCodeId() {
        return `code_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function nextSegmentId() {
        return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function markProjectChanged(render = true) {
        saveData();
        if (render && typeof renderAll === 'function') renderAll();
    }

    window.quackdasAgent = Object.freeze({
        version: '1.0.0',
        localOnly: true,
        project: Object.freeze({
            async status() {
                ensureAppData();
                const project = await (window.electronAPI?.getProjectInfo ? window.electronAPI.getProjectInfo() : Promise.resolve({ ok: false }));
                const semanticIndexState = await (window.electronAPI?.semanticGetIndexStatus
                    ? window.electronAPI.semanticGetIndexStatus({ documents: toSemanticDocuments() })
                    : Promise.resolve({ ok: false, state: 'unknown' }));
                return {
                    ok: true,
                    hasHandle: !!project?.hasHandle,
                    path: String(project?.path || ''),
                    fileName: String(project?.fileName || ''),
                    documents: Number((appData.documents || []).length),
                    codes: Number((appData.codes || []).length),
                    segments: Number((appData.segments || []).length),
                    semanticIndexState: String(semanticIndexState?.state || 'unknown')
                };
            },
            async save(options = {}) {
                const saveAs = !!options.saveAs;
                if (typeof manualSave !== 'function') {
                    throw new Error('Save is not available in this context.');
                }
                await manualSave(saveAs);
                return { ok: true };
            }
        }),
        docs: Object.freeze({
            list(options = {}) {
                const includeContent = !!options.includeContent;
                return getTextDocuments().map((doc) => ({
                    id: String(doc.id),
                    title: String(doc.title || ''),
                    type: String(doc.type || 'text'),
                    length: String(doc.content || '').length,
                    lastAccessed: String(doc.lastAccessed || ''),
                    content: includeContent ? String(doc.content || '') : undefined
                }));
            },
            get(input = {}) {
                const doc = findDocument(input.doc_id || input.docId);
                return {
                    id: String(doc.id),
                    title: String(doc.title || ''),
                    type: String(doc.type || 'text'),
                    content: String(doc.content || ''),
                    length: String(doc.content || '').length
                };
            },
            update(input = {}) {
                const doc = findDocument(input.doc_id || input.docId);
                const nextContent = canonicalizeText(input.content);
                const expectedRevision = Number(input.revision);
                const currentRevision = Number(doc.revision || 0);
                if (Number.isFinite(expectedRevision) && expectedRevision >= 0 && expectedRevision !== currentRevision) {
                    return {
                        ok: false,
                        code: 'REVISION_MISMATCH',
                        currentRevision
                    };
                }
                doc.content = nextContent;
                doc.revision = currentRevision + 1;
                doc.modified = nowIso();
                markProjectChanged(false);
                return {
                    ok: true,
                    doc_id: doc.id,
                    revision: doc.revision,
                    length: nextContent.length
                };
            },
            jump(input = {}) {
                const doc = findDocument(input.doc_id || input.docId);
                const start = Math.max(0, Number(input.start_char ?? input.startChar ?? 0) || 0);
                const end = Math.max(start, Number(input.end_char ?? input.endChar ?? start) || start);
                if (typeof goToCharacterRangeWithHighlight === 'function') {
                    goToCharacterRangeWithHighlight(doc.id, start, end);
                } else if (typeof selectDocument === 'function') {
                    selectDocument(doc.id);
                    if (typeof scrollToCharacterPosition === 'function') {
                        setTimeout(() => scrollToCharacterPosition(start), 50);
                    }
                }
                return { ok: true, doc_id: doc.id, start_char: start, end_char: end };
            }
        }),
        codes: Object.freeze({
            list() {
                return (Array.isArray(appData.codes) ? appData.codes : []).map((code) => ({
                    id: String(code.id),
                    name: String(code.name || ''),
                    color: String(code.color || ''),
                    parentId: code.parentId ? String(code.parentId) : null
                }));
            },
            create(input = {}) {
                const name = requireString(input.name, 'name');
                const code = {
                    id: nextCodeId(),
                    name,
                    description: String(input.description || ''),
                    notes: String(input.notes || ''),
                    shortcut: '',
                    parentId: input.parentId ? String(input.parentId) : null,
                    color: String(input.color || '#5B8F5B'),
                    created: nowIso(),
                    lastUsed: nowIso()
                };
                appData.codes.push(code);
                markProjectChanged();
                return { ok: true, code };
            }
        }),
        coding: Object.freeze({
            list(input = {}) {
                const docId = input.doc_id ? String(input.doc_id) : '';
                const codeId = input.code_id ? String(input.code_id) : '';
                return (Array.isArray(appData.segments) ? appData.segments : [])
                    .filter((segment) => {
                        if (docId && segment.docId !== docId) return false;
                        if (codeId && !(Array.isArray(segment.codeIds) && segment.codeIds.includes(codeId))) return false;
                        return true;
                    })
                    .map((segment) => ({
                        id: String(segment.id),
                        doc_id: String(segment.docId),
                        start_char: Number(segment.startIndex || 0),
                        end_char: Number(segment.endIndex || 0),
                        code_ids: Array.isArray(segment.codeIds) ? segment.codeIds.slice() : [],
                        text: String(segment.text || '')
                    }));
            },
            add(input = {}) {
                const doc = findDocument(input.doc_id || input.docId);
                const codeId = requireString(input.code_id || input.codeId, 'code_id');
                if (!(Array.isArray(appData.codes) && appData.codes.some((code) => code.id === codeId))) {
                    throw new Error(`Code not found: ${codeId}`);
                }
                const start = Math.max(0, Number(input.start_char ?? input.startChar ?? 0) || 0);
                const end = Math.max(start + 1, Number(input.end_char ?? input.endChar ?? start + 1) || (start + 1));
                const safeEnd = Math.min(end, String(doc.content || '').length);
                if (safeEnd <= start) throw new Error('Invalid coding span.');

                const existing = (appData.segments || []).find((segment) =>
                    segment.docId === doc.id &&
                    Number(segment.startIndex) === start &&
                    Number(segment.endIndex) === safeEnd
                );
                if (existing) {
                    if (!Array.isArray(existing.codeIds)) existing.codeIds = [];
                    if (!existing.codeIds.includes(codeId)) existing.codeIds.push(codeId);
                    existing.modified = nowIso();
                    markProjectChanged();
                    return { ok: true, segment_id: existing.id, merged: true };
                }

                const segment = {
                    id: nextSegmentId(),
                    docId: doc.id,
                    text: String(doc.content || '').slice(start, safeEnd),
                    codeIds: [codeId],
                    startIndex: start,
                    endIndex: safeEnd,
                    created: nowIso(),
                    modified: nowIso()
                };
                appData.segments.push(segment);
                markProjectChanged();
                return { ok: true, segment_id: segment.id, merged: false };
            },
            remove(input = {}) {
                const segmentId = requireString(input.segment_id || input.segmentId, 'segment_id');
                const before = Number((appData.segments || []).length);
                appData.segments = (appData.segments || []).filter((segment) => segment.id !== segmentId);
                const removed = Number((appData.segments || []).length) !== before;
                if (removed) markProjectChanged();
                return { ok: true, removed };
            }
        }),
        semantic: Object.freeze({
            async status() {
                if (!window.electronAPI?.semanticGetAvailability) return { ok: false, error: 'Semantic API unavailable.' };
                const availability = await window.electronAPI.semanticGetAvailability({ force: true });
                const indexStatus = await (window.electronAPI.semanticGetIndexStatus
                    ? window.electronAPI.semanticGetIndexStatus({ documents: toSemanticDocuments() })
                    : Promise.resolve({ ok: false }));
                return {
                    ok: true,
                    availability,
                    index: indexStatus
                };
            },
            async models() {
                if (!window.electronAPI?.semanticGetProjectSettings) return { ok: false, models: [] };
                const settings = await window.electronAPI.semanticGetProjectSettings();
                return {
                    ok: true,
                    embeddingModel: String(settings?.modelName || ''),
                    generationModel: String(settings?.generationModel || ''),
                    models: Array.isArray(settings?.models) ? settings.models : []
                };
            },
            async indexStart(input = {}) {
                if (!window.electronAPI?.semanticStartIndexing) return { ok: false, error: 'Semantic indexing API unavailable.' };
                return window.electronAPI.semanticStartIndexing({
                    documents: toSemanticDocuments(),
                    modelName: input.modelName || undefined
                });
            },
            async indexCancel() {
                if (!window.electronAPI?.semanticCancelIndexing) return { ok: false, error: 'Semantic indexing API unavailable.' };
                return window.electronAPI.semanticCancelIndexing();
            },
            async search(input = {}) {
                if (!window.electronAPI?.semanticSearch) return { ok: false, error: 'Semantic search API unavailable.' };
                return window.electronAPI.semanticSearch({
                    query: requireString(input.query, 'query'),
                    topK: Number(input.topK) || undefined
                });
            },
            async ask(input = {}) {
                if (!window.electronAPI?.semanticStartAsk) return { ok: false, error: 'Semantic ask API unavailable.' };
                return window.electronAPI.semanticStartAsk({
                    question: requireString(input.question, 'question'),
                    outputLanguage: String(input.outputLanguage || 'en'),
                    outputMode: String(input.outputMode || 'loose'),
                    generationModel: String(input.generationModel || ''),
                    topK: Number(input.topK) || undefined,
                    documents: toSemanticDocuments()
                });
            },
            async askCancel() {
                if (!window.electronAPI?.semanticCancelAsk) return { ok: false, error: 'Semantic ask API unavailable.' };
                return window.electronAPI.semanticCancelAsk();
            },
            async askState() {
                if (!window.electronAPI?.semanticGetAskState) return { ok: false, error: 'Semantic ask API unavailable.' };
                return window.electronAPI.semanticGetAskState();
            }
        })
    });
})();
