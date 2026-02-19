/**
 * Quackdas - QDPX Format Module
 * Implements REFI-QDA Project Exchange format (.qdpx)
 * 
 * A .qdpx file is a zip containing:
 *   - project.qde (XML metadata, codes, selections, notes)
 *   - sources/ (folder with original document files)
 * 
 * This enables interoperability with NVivo, MAXQDA, ATLAS.ti, etc.
 */

// Generate a GUID for QDPX compatibility
function generateGUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Mapping between Quackdas IDs and QDPX GUIDs
let idToGuid = {};
let guidToId = {};

// QDPX import safety limits (defense-in-depth for untrusted files).
const QDPX_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024; // 512 MB compressed archive
const QDPX_MAX_XML_BYTES = 25 * 1024 * 1024; // 25 MB project.qde
const QDPX_MAX_ZIP_ENTRIES = 5000;
const QDPX_MAX_SINGLE_SOURCE_BYTES = 256 * 1024 * 1024; // 256 MB per source
const QDPX_MAX_EXPANDED_READ_BYTES = 768 * 1024 * 1024; // 768 MB total decompressed read

function getBinaryByteLength(data) {
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
    return null;
}

function getStringByteLength(text) {
    const value = String(text || '');
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(value).byteLength;
    }
    // Fallback if TextEncoder is unavailable.
    return value.length * 2;
}

function getZipObjectDeclaredUncompressedBytes(zipObject) {
    const n = Number(zipObject && zipObject._data && zipObject._data.uncompressedSize);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeQdpxSourcePath(rawPath) {
    const normalized = String(rawPath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .trim();
    if (!normalized) return '';
    if (normalized.includes('..')) return '';
    if (/^[a-zA-Z]:/.test(normalized)) return '';
    return normalized;
}

function buildZipFileLookup(zipEntries) {
    const byLowerName = new Map();
    (zipEntries || []).forEach(entry => {
        if (!entry || entry.dir) return;
        const normalizedName = normalizeQdpxSourcePath(entry.name);
        if (!normalizedName) return;
        const key = normalizedName.toLowerCase();
        if (!byLowerName.has(key)) byLowerName.set(key, entry);
    });
    return { byLowerName };
}

function resolveZipSourceFile(rawPath, zipLookup) {
    const normalized = normalizeQdpxSourcePath(rawPath);
    if (!normalized) return null;

    const candidates = [];
    const addCandidate = (value) => {
        const candidate = normalizeQdpxSourcePath(value);
        if (!candidate) return;
        if (!candidates.includes(candidate)) candidates.push(candidate);
    };

    addCandidate(normalized);

    const internalPrefix = 'internal://';
    if (normalized.toLowerCase().startsWith(internalPrefix)) {
        const internalName = normalized.slice(internalPrefix.length);
        addCandidate(internalName);
        addCandidate(`sources/${internalName}`);
        addCandidate(`Sources/${internalName}`);
    }

    const normalizedNoPrefix = normalized.replace(/^sources\//i, '');
    addCandidate(`sources/${normalizedNoPrefix}`);
    addCandidate(`Sources/${normalizedNoPrefix}`);

    for (const candidate of candidates) {
        const resolved = zipLookup && zipLookup.byLowerName
            ? zipLookup.byLowerName.get(candidate.toLowerCase())
            : null;
        if (resolved) {
            return { file: resolved, path: candidate };
        }
    }

    return null;
}

function getSelectionCodeGuids(selectionEl) {
    const codeGuids = [];
    if (!selectionEl) return codeGuids;

    const codingElements = selectionEl.querySelectorAll(':scope > Coding');
    codingElements.forEach(codingEl => {
        const directGuid = getAttrFirst(codingEl, ['codeGUID', 'targetGUID']);
        if (directGuid && !codeGuids.includes(directGuid)) {
            codeGuids.push(directGuid);
        }

        const codeRefElements = codingEl.querySelectorAll(':scope > CodeRef');
        codeRefElements.forEach(codeRefEl => {
            const refGuid = getAttrFirst(codeRefEl, ['targetGUID', 'codeGUID']);
            if (refGuid && !codeGuids.includes(refGuid)) {
                codeGuids.push(refGuid);
            }
        });
    });

    return codeGuids;
}

function collectPlainTextSelections(xmlDoc) {
    const entries = [];
    const seen = new Set();

    const pushSelection = (selectionEl, sourceGuidHint = '') => {
        if (!selectionEl) return;
        const guid = getAttrFirst(selectionEl, ['guid']);
        const sourceGuid = getAttrFirst(selectionEl, ['sourceGUID']) || sourceGuidHint || '';
        const start = getAttrFirst(selectionEl, ['startPosition']);
        const end = getAttrFirst(selectionEl, ['endPosition']);
        const dedupeKey = guid || `${sourceGuid}|${start}|${end}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        entries.push({ selectionEl, sourceGuid });
    };

    xmlDoc.querySelectorAll('Selections > PlainTextSelection').forEach(selectionEl => {
        pushSelection(selectionEl);
    });

    xmlDoc.querySelectorAll('Sources > TextSource > PlainTextSelection').forEach(selectionEl => {
        const sourceEl = selectionEl.closest('TextSource');
        const sourceGuid = getAttrFirst(sourceEl, ['guid']);
        pushSelection(selectionEl, sourceGuid);
    });

    xmlDoc.querySelectorAll('Sources > PDFSource > Representation > PlainTextSelection').forEach(selectionEl => {
        const sourceEl = selectionEl.closest('PDFSource');
        const sourceGuid = getAttrFirst(sourceEl, ['guid']);
        pushSelection(selectionEl, sourceGuid);
    });

    return entries;
}

function normalizeSelectionRange(startPos, endPos, docLength) {
    if (!Number.isFinite(startPos) || !Number.isFinite(endPos) || !Number.isFinite(docLength)) return null;
    let start = Math.trunc(startPos);
    let end = Math.trunc(endPos);
    if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
    }
    start = Math.max(0, Math.min(start, docLength));
    end = Math.max(0, Math.min(end, docLength));
    if (!(end > start)) return null;
    return { start, end };
}

function getOrCreateGuid(id) {
    if (!idToGuid[id]) {
        idToGuid[id] = generateGUID();
        guidToId[idToGuid[id]] = id;
    }
    return idToGuid[id];
}

// Escape XML special characters
function escapeXml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Format date for QDPX (ISO 8601)
function formatDateTime(date) {
    if (!date) return new Date().toISOString();
    return new Date(date).toISOString();
}

// Convert hex color to QDPX format (without #)
function formatColor(hexColor) {
    if (!hexColor) return 'FF808080';
    // Remove # if present and ensure uppercase
    let color = hexColor.replace('#', '').toUpperCase();
    // Add alpha if not present (FF = fully opaque)
    if (color.length === 6) {
        color = 'FF' + color;
    }
    return color;
}

// Parse QDPX color to hex
function parseColor(qdpxColor) {
    if (!qdpxColor) return '#808080';
    const raw = String(qdpxColor).trim();

    // 1) rgb()/rgba() formats
    const rgbMatch = raw.match(/^rgba?\s*\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
    if (rgbMatch) {
        const r = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[1], 10) || 0));
        const g = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[2], 10) || 0));
        const b = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[3], 10) || 0));
        return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    }

    // 2) Comma-separated forms: "R,G,B" or "A,R,G,B"
    const csvParts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (csvParts.length === 3 || csvParts.length === 4) {
        const offset = csvParts.length === 4 ? 1 : 0;
        const r = Number.parseInt(csvParts[offset], 10);
        const g = Number.parseInt(csvParts[offset + 1], 10);
        const b = Number.parseInt(csvParts[offset + 2], 10);
        if ([r, g, b].every((v) => Number.isFinite(v))) {
            return '#' + [r, g, b]
                .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
                .join('');
        }
    }
    const wsParts = raw.split(/\s+/).map((p) => p.trim()).filter(Boolean);
    if (wsParts.length === 3 || wsParts.length === 4) {
        const offset = wsParts.length === 4 ? 1 : 0;
        const r = Number.parseInt(wsParts[offset], 10);
        const g = Number.parseInt(wsParts[offset + 1], 10);
        const b = Number.parseInt(wsParts[offset + 2], 10);
        if ([r, g, b].every((v) => Number.isFinite(v))) {
            return '#' + [r, g, b]
                .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
                .join('');
        }
    }

    // 3) Hex forms: #RRGGBB, #AARRGGBB, 0xRRGGBB, 0xAARRGGBB
    let color = raw.replace(/^#/, '').replace(/^0x/i, '');
    if (/^[0-9a-fA-F]{8}$/.test(color)) color = color.substring(2); // drop alpha (AARRGGBB -> RRGGBB)
    if (/^[0-9a-fA-F]{6}$/.test(color)) return '#' + color.toLowerCase();

    // 4) Integer forms used by some tools (including signed ARGB values from .NET/NVivo exports).
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        const n = Math.trunc(numeric);
        const unsigned = n >>> 0;
        const rgb = unsigned > 0xFFFFFF ? (unsigned & 0xFFFFFF) : unsigned;
        const hex = rgb.toString(16).padStart(6, '0').slice(-6);
        return '#' + hex.toLowerCase();
    }

    return '#808080';
}

function getCodeColorRawValue(codeEl) {
    if (!codeEl) return '';
    const direct = getAttrFirst(codeEl, [
        'color',
        'Color',
        'colour',
        'rgbColor',
        'argbColor',
        'codeColor',
        'backgroundColor'
    ]);
    if (direct) return direct;

    const colorEl = codeEl.querySelector(':scope > Color, :scope > Colour, :scope > CodeColor');
    if (colorEl) {
        const attrValue = getAttrFirst(colorEl, [
            'value',
            'color',
            'colour',
            'rgb',
            'argb',
            'hex'
        ]);
        if (attrValue) return attrValue;

        const r = getAttrFirst(colorEl, ['r', 'red']);
        const g = getAttrFirst(colorEl, ['g', 'green']);
        const b = getAttrFirst(colorEl, ['b', 'blue']);
        const a = getAttrFirst(colorEl, ['a', 'alpha']);
        if (r && g && b) return a ? `${a},${r},${g},${b}` : `${r},${g},${b}`;

        const textValue = String(colorEl.textContent || '').trim();
        if (textValue) return textValue;
    }

    return '';
}

function buildQdpxId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function getAttrFirst(el, names) {
    if (!el || !names) return '';
    for (const name of names) {
        const value = el.getAttribute(name);
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return '';
}

function applyMetadataValue(doc, key, value) {
    if (!doc || !key) return false;
    const v = (value === null || value === undefined) ? '' : String(value).trim();
    if (!v) return false;
    if (!doc.metadata || typeof doc.metadata !== 'object') doc.metadata = {};
    doc.metadata[String(key)] = v;
    return true;
}

function normalizeVariableType(rawType) {
    const value = String(rawType || '').trim().toLowerCase();
    if (value === 'integer' || value === 'int') return 'Integer';
    if (value === 'decimal' || value === 'float' || value === 'double' || value === 'numeric' || value === 'number') return 'Decimal';
    if (value === 'boolean' || value === 'bool' || value === 'logical') return 'Boolean';
    if (value === 'date' || value === 'datetime' || value === 'time') return 'DateTime';
    return 'Text';
}

function buildVariableDefinitionsForExport(project) {
    const byName = new Map();
    const addVariable = (name, type, idHint = '') => {
        const normalizedName = String(name || '').trim();
        if (!normalizedName) return;
        const key = normalizedName.toLowerCase();
        if (byName.has(key)) return;
        byName.set(key, {
            id: String(idHint || '').trim() || buildQdpxId('var'),
            name: normalizedName,
            type: normalizeVariableType(type)
        });
    };

    (Array.isArray(project.variableDefinitions) ? project.variableDefinitions : []).forEach(variableDef => {
        if (!variableDef || typeof variableDef !== 'object') return;
        addVariable(variableDef.name, variableDef.type, variableDef.id);
    });

    (Array.isArray(project.documents) ? project.documents : []).forEach(doc => {
        if (!doc || !doc.metadata || typeof doc.metadata !== 'object') return;
        Object.keys(doc.metadata).forEach(key => addVariable(key, 'Text'));
    });

    (Array.isArray(project.cases) ? project.cases : []).forEach(caseItem => {
        if (!caseItem || !caseItem.attributes || typeof caseItem.attributes !== 'object') return;
        Object.keys(caseItem.attributes).forEach(key => addVariable(key, 'Text'));
    });

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Export project to QDPX format
 * @returns {Promise<Blob>} - QDPX file as a Blob
 */
async function exportToQdpx() {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library not loaded');
    }
    
    const zip = new JSZip();
    const sourcesFolder = zip.folder('sources');
    
    // Reset GUID mappings
    idToGuid = {};
    guidToId = {};
    
    // Generate GUIDs for all entities
    const userGuid = generateGUID();
    const projectGuid = generateGUID();
    
    appData.documents.forEach(doc => getOrCreateGuid(doc.id));
    appData.codes.forEach(code => getOrCreateGuid(code.id));
    appData.segments.forEach(seg => getOrCreateGuid(seg.id));
    appData.memos.forEach(memo => getOrCreateGuid(memo.id));
    appData.folders.forEach(folder => getOrCreateGuid(folder.id));
    (Array.isArray(appData.cases) ? appData.cases : []).forEach(caseItem => getOrCreateGuid(caseItem.id));
    (Array.isArray(appData.variableDefinitions) ? appData.variableDefinitions : []).forEach(variableDef => getOrCreateGuid(variableDef.id));
    
    // Add source files and build source list
    const sources = [];
    for (const doc of appData.documents) {
        const guid = getOrCreateGuid(doc.id);
        
        if (doc.type === 'pdf' && doc.pdfData) {
            const pdfFileName = `${guid}.pdf`;
            const textFileName = `${guid}.txt`;
            const pdfBinary = base64ToArrayBuffer(doc.pdfData);
            sourcesFolder.file(pdfFileName, pdfBinary);
            sourcesFolder.file(textFileName, doc.content || '');
            
            sources.push({
                type: 'PDFSource',
                guid: guid,
                name: doc.title,
                path: `internal://${pdfFileName}`,
                representationTextPath: `internal://${textFileName}`,
                plainTextContent: doc.content, // Extracted text for searching
                created: doc.created,
                modified: doc.lastAccessed
            });
        } else {
            const textFileName = `${guid}.txt`;
            sourcesFolder.file(textFileName, doc.content || '');
            
            sources.push({
                type: 'TextSource',
                guid: guid,
                name: doc.title,
                path: `internal://${textFileName}`,
                plainTextContent: doc.content,
                created: doc.created,
                modified: doc.lastAccessed
            });
        }
    }

    // NVivo exports include this marker entry; harmless in other tools.
    zip.file('sources/.root', '');
    
    // Build XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += `<Project xmlns="urn:QDA-XML:project:1.0" `;
    xml += `name="${escapeXml(appData.projectName || 'Quackdas Project')}" `;
    xml += `origin="Quackdas" `;
    xml += `creatingUserGUID="${userGuid}" `;
    xml += `creationDateTime="${formatDateTime(appData.lastSaveTime)}" `;
    xml += `modifyingUserGUID="${userGuid}" `;
    xml += `modifiedDateTime="${formatDateTime(new Date())}">\n`;
    
    // Users
    xml += '  <Users>\n';
    xml += `    <User guid="${userGuid}" name="Quackdas User"/>\n`;
    xml += '  </Users>\n';
    
    // CodeBook
    xml += '  <CodeBook>\n';
    xml += '    <Codes>\n';
    
    // Build code hierarchy (top-level first, then children)
    const topLevelCodes = appData.codes.filter(c => !c.parentId);
    const childCodes = appData.codes.filter(c => c.parentId);
    
    function renderCode(code, indent = '      ') {
        const guid = getOrCreateGuid(code.id);
        const children = childCodes.filter(c => c.parentId === code.id);
        
        let codeXml = `${indent}<Code guid="${guid}" `;
        codeXml += `name="${escapeXml(code.name)}" `;
        codeXml += `isCodable="true" `;
        codeXml += `color="${formatColor(code.color)}" `;
        codeXml += `quackdasShortcut="${escapeXml(code.shortcut || '')}" `;
        codeXml += `quackdasNotes="${escapeXml(code.notes || '')}"`;
        
        if (code.description || children.length > 0) {
            codeXml += '>\n';
            if (code.description) {
                codeXml += `${indent}  <Description>${escapeXml(code.description)}</Description>\n`;
            }
            children.forEach(child => {
                codeXml += renderCode(child, indent + '  ');
            });
            codeXml += `${indent}</Code>\n`;
        } else {
            codeXml += '/>\n';
        }
        
        return codeXml;
    }
    
    topLevelCodes.forEach(code => {
        xml += renderCode(code);
    });
    
    xml += '    </Codes>\n';
    xml += '  </CodeBook>\n';
    
    // Sources
    xml += '  <Sources>\n';
    sources.forEach(source => {
        if (source.type === 'PDFSource') {
            xml += `    <PDFSource guid="${source.guid}" `;
            xml += `name="${escapeXml(source.name)}" `;
            xml += `path="${escapeXml(source.path)}" `;
            xml += `creatingUserGUID="${userGuid}" `;
            xml += `creationDateTime="${formatDateTime(source.created)}" `;
            xml += `modifyingUserGUID="${userGuid}" `;
            xml += `modifiedDateTime="${formatDateTime(source.modified)}">\n`;
            xml += `      <Representation guid="${source.guid}" plainTextPath="${escapeXml(source.representationTextPath)}"/>\n`;
            xml += '    </PDFSource>\n';
        } else {
            xml += `    <TextSource guid="${source.guid}" `;
            xml += `name="${escapeXml(source.name)}" `;
            xml += `plainTextPath="${escapeXml(source.path)}" `;
            xml += `creatingUserGUID="${userGuid}" `;
            xml += `creationDateTime="${formatDateTime(source.created)}" `;
            xml += `modifyingUserGUID="${userGuid}" `;
            xml += `modifiedDateTime="${formatDateTime(source.modified)}"/>\n`;
        }
    });
    xml += '  </Sources>\n';
    
    const variableDefinitions = buildVariableDefinitionsForExport(appData);
    const variableGuidByName = new Map();
    variableDefinitions.forEach(variableDef => {
        const variableGuid = getOrCreateGuid(variableDef.id);
        variableGuidByName.set(variableDef.name.toLowerCase(), variableGuid);
    });

    // Variables
    xml += '  <Variables>\n';
    variableDefinitions.forEach(variableDef => {
        const variableGuid = variableGuidByName.get(variableDef.name.toLowerCase()) || generateGUID();
        xml += `    <Variable guid="${variableGuid}" name="${escapeXml(variableDef.name)}" typeOfVariable="${escapeXml(normalizeVariableType(variableDef.type))}"/>\n`;
    });
    xml += '  </Variables>\n';

    // Cases
    xml += '  <Cases>\n';
    (Array.isArray(appData.cases) ? appData.cases : []).forEach(caseItem => {
        if (!caseItem || typeof caseItem !== 'object') return;
        const caseGuid = getOrCreateGuid(caseItem.id);
        const caseName = String(caseItem.name || '').trim() || 'Unnamed Case';
        const linkedDocumentIds = Array.isArray(caseItem.linkedDocumentIds)
            ? caseItem.linkedDocumentIds
            : (Array.isArray(caseItem.docIds) ? caseItem.docIds : []);
        const attrs = (caseItem.attributes && typeof caseItem.attributes === 'object') ? caseItem.attributes : {};
        const parentGuid = caseItem.parentId ? getOrCreateGuid(caseItem.parentId) : '';
        const caseType = String(caseItem.type || '').trim();

        xml += `    <Case guid="${caseGuid}" name="${escapeXml(caseName)}"`;
        if (parentGuid) xml += ` parentGUID="${escapeXml(parentGuid)}"`;
        if (caseType) xml += ` type="${escapeXml(caseType)}"`;
        xml += '>\n';
        if (caseItem.description) {
            xml += `      <Description>${escapeXml(caseItem.description)}</Description>\n`;
        }
        linkedDocumentIds.forEach(docId => {
            const docGuid = getOrCreateGuid(docId);
            if (docGuid) xml += `      <MemberSource targetGUID="${docGuid}"/>\n`;
        });
        Object.entries(attrs).forEach(([key, rawValue]) => {
            const value = String(rawValue == null ? '' : rawValue).trim();
            if (!value) return;
            const variableGuid = variableGuidByName.get(String(key || '').trim().toLowerCase());
            if (!variableGuid) return;
            xml += `      <VariableValue variableGUID="${escapeXml(variableGuid)}" value="${escapeXml(value)}"/>\n`;
        });
        xml += '    </Case>\n';
    });
    xml += '  </Cases>\n';
    
    // Selections (coded segments)
    xml += '  <Selections>\n';
    appData.segments.forEach(segment => {
        if (segment.pdfRegion) return;
        if (!Number.isFinite(segment.startIndex) || !Number.isFinite(segment.endIndex) || segment.endIndex <= segment.startIndex) return;
        const segGuid = getOrCreateGuid(segment.id);
        const sourceGuid = getOrCreateGuid(segment.docId);
        
        xml += `    <PlainTextSelection guid="${segGuid}" `;
        xml += `sourceGUID="${sourceGuid}" `;
        xml += `startPosition="${segment.startIndex}" `;
        xml += `endPosition="${segment.endIndex}" `;
        if (segment.created) xml += `quackdasCreated="${escapeXml(String(segment.created))}" `;
        xml += `quackdasModified="${escapeXml(String(segment.modified || segment.created || ''))}">\n`;
        
        // Each code applied to this segment
        segment.codeIds.forEach(codeId => {
            const codeGuid = getOrCreateGuid(codeId);
            const codingGuid = generateGUID();
            xml += `      <Coding guid="${codingGuid}" codeGUID="${codeGuid}"/>\n`;
        });
        
        xml += '    </PlainTextSelection>\n';
    });
    xml += '  </Selections>\n';
    
    // Notes (memos)
    xml += '  <Notes>\n';
    appData.memos.forEach(memo => {
        const memoGuid = getOrCreateGuid(memo.id);
        const targetGuid = memo.targetId ? getOrCreateGuid(memo.targetId) : null;
        const memoTag = String(memo.tag || '').trim();
        const memoEdited = memo.edited || memo.created;
        const memoCodeId = (memo.type === 'segment') ? String(memo.codeId || '').trim() : '';
        const memoCodeGuid = memoCodeId ? getOrCreateGuid(memoCodeId) : '';
        
        xml += `    <Note guid="${memoGuid}" `;
        xml += `name="${escapeXml(memo.type + ' memo')}" `;
        if (memoTag) xml += `quackdasTag="${escapeXml(memoTag)}" `;
        if (memoEdited) xml += `quackdasEdited="${escapeXml(String(memoEdited))}" `;
        if (memoCodeGuid) xml += `quackdasCodeGUID="${escapeXml(memoCodeGuid)}" `;
        xml += `creatingUserGUID="${userGuid}" `;
        xml += `creationDateTime="${formatDateTime(memo.created)}">\n`;
        xml += `      <PlainTextContent>${escapeXml(memo.content)}</PlainTextContent>\n`;
        if (targetGuid) {
            xml += `      <NoteRef targetGUID="${targetGuid}"/>\n`;
        }
        xml += '    </Note>\n';
    });
    xml += '  </Notes>\n';
    
    // Sets (folders as document sets)
    xml += '  <Sets>\n';
    appData.folders.forEach(folder => {
        const folderGuid = getOrCreateGuid(folder.id);
        const docsInFolder = appData.documents.filter(d => d.folderId === folder.id);
        
        xml += `    <Set guid="${folderGuid}" name="${escapeXml(folder.name)}">\n`;
        if (folder.description) {
            xml += `      <Description>${escapeXml(folder.description)}</Description>\n`;
        }
        docsInFolder.forEach(doc => {
            const docGuid = getOrCreateGuid(doc.id);
            xml += `      <MemberSource targetGUID="${docGuid}"/>\n`;
        });
        xml += '    </Set>\n';
    });
    xml += '  </Sets>\n';

    // Quackdas-specific extensions (portable for Quackdas round-trip, ignored by other tools)
    xml += '  <QuackdasExtensions version="1">\n';

    xml += '    <FolderHierarchy>\n';
    appData.folders.forEach(folder => {
        const folderGuid = getOrCreateGuid(folder.id);
        const parentGuid = folder.parentId ? getOrCreateGuid(folder.parentId) : '';
        xml += `      <Folder guid="${folderGuid}" `;
        if (parentGuid) xml += `parentGUID="${parentGuid}" `;
        if (folder.created) xml += `created="${escapeXml(String(folder.created))}" `;
        xml += `expanded="${folder.expanded === false ? 'false' : 'true'}"/>\n`;
    });
    xml += '    </FolderHierarchy>\n';

    xml += '    <PdfRegionSelections>\n';
    appData.segments.forEach(segment => {
        if (!segment || !segment.pdfRegion) return;
        const sourceGuid = getOrCreateGuid(segment.docId);
        const segGuid = getOrCreateGuid(segment.id);
        const r = (typeof normalizePdfRegionShape === 'function')
            ? normalizePdfRegionShape(segment.pdfRegion)
            : (segment.pdfRegion || {});
        xml += `      <PdfRegionSelection guid="${segGuid}" `;
        xml += `sourceGUID="${sourceGuid}" `;
        xml += `pageNum="${Number(r.pageNum) || 1}" `;
        xml += `x="${Number(r.xNorm) || 0}" y="${Number(r.yNorm) || 0}" `;
        xml += `width="${Number(r.wNorm) || 0}" height="${Number(r.hNorm) || 0}" `;
        xml += `xNorm="${Number(r.xNorm) || 0}" yNorm="${Number(r.yNorm) || 0}" `;
        xml += `wNorm="${Number(r.wNorm) || 0}" hNorm="${Number(r.hNorm) || 0}" `;
        if (Number.isFinite(segment.startIndex)) xml += `startPosition="${segment.startIndex}" `;
        if (Number.isFinite(segment.endIndex)) xml += `endPosition="${segment.endIndex}" `;
        if (segment.created) xml += `quackdasCreated="${escapeXml(String(segment.created))}" `;
        xml += `quackdasModified="${escapeXml(String(segment.modified || segment.created || ''))}" `;
        xml += `text="${escapeXml(segment.text || '')}">\n`;
        segment.codeIds.forEach(codeId => {
            const codeGuid = getOrCreateGuid(codeId);
            xml += `        <Coding guid="${generateGUID()}" codeGUID="${codeGuid}"/>\n`;
        });
        xml += '      </PdfRegionSelection>\n';
    });
    xml += '    </PdfRegionSelections>\n';

    xml += '    <DocumentMetadata>\n';
    appData.documents.forEach(doc => {
        if (!doc || !doc.metadata || typeof doc.metadata !== 'object') return;
        const entries = Object.entries(doc.metadata).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
        if (entries.length === 0) return;
        const sourceGuid = getOrCreateGuid(doc.id);
        xml += `      <DocumentMeta sourceGUID="${sourceGuid}">\n`;
        entries.forEach(([key, value]) => {
            xml += `        <Field key="${escapeXml(key)}" value="${escapeXml(String(value))}"/>\n`;
        });
        xml += '      </DocumentMeta>\n';
    });
    xml += '    </DocumentMetadata>\n';

    xml += '    <CodeViewPresets>\n';
    (Array.isArray(appData.codeViewPresets) ? appData.codeViewPresets : []).forEach((preset) => {
        if (!preset || !preset.id || !preset.name) return;
        const state = preset.state || {};
        xml += `      <Preset id="${escapeXml(String(preset.id))}" name="${escapeXml(String(preset.name))}" updated="${escapeXml(String(preset.updated || ''))}">\n`;
        Object.entries(state).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') return;
            xml += `        <State key="${escapeXml(String(key))}" value="${escapeXml(String(value))}"/>\n`;
        });
        xml += '      </Preset>\n';
    });
    xml += '    </CodeViewPresets>\n';

    xml += '  </QuackdasExtensions>\n';

    xml += '</Project>\n';
    
    // Add project.qde to zip
    zip.file('project.qde', xml);
    
    // Generate zip file
    const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
    return blob;
}

/**
 * Import project from QDPX format
 * @param {ArrayBuffer|Blob} qdpxData - QDPX file data
 * @returns {Promise<object>} - Imported project data
 */
async function importFromQdpx(qdpxData) {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library not loaded');
    }

    const archiveBytes = getBinaryByteLength(qdpxData);
    if (Number.isFinite(archiveBytes) && archiveBytes > QDPX_MAX_ARCHIVE_BYTES) {
        throw new Error(`Invalid QDPX file: archive exceeds ${Math.round(QDPX_MAX_ARCHIVE_BYTES / (1024 * 1024))} MB safety limit.`);
    }

    const zip = await JSZip.loadAsync(qdpxData);
    const zipEntries = Object.values(zip.files || {}).filter(file => file && !file.dir);
    const zipLookup = buildZipFileLookup(zipEntries);
    if (zipEntries.length > QDPX_MAX_ZIP_ENTRIES) {
        throw new Error(`Invalid QDPX file: too many archive entries (${zipEntries.length}).`);
    }

    // Read project.qde
    const qdeFile = zip.file('project.qde');
    if (!qdeFile) {
        throw new Error('Invalid QDPX file: missing project.qde');
    }

    const declaredQdeBytes = getZipObjectDeclaredUncompressedBytes(qdeFile);
    if (Number.isFinite(declaredQdeBytes) && declaredQdeBytes > QDPX_MAX_XML_BYTES) {
        throw new Error('Invalid QDPX file: project metadata is too large.');
    }

    const qdeContent = await qdeFile.async('string');
    const qdeBytes = getStringByteLength(qdeContent);
    if (qdeBytes > QDPX_MAX_XML_BYTES) {
        throw new Error('Invalid QDPX file: project metadata exceeds safety limit.');
    }
    let expandedReadBytes = qdeBytes;
    
    // Parse XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(qdeContent, 'text/xml');
    
    // Check for parse errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Invalid QDPX file: XML parse error');
    }
    
    const projectEl = xmlDoc.querySelector('Project');
    if (!projectEl) {
        throw new Error('Invalid QDPX file: missing Project element');
    }
    
    // Reset GUID mappings
    idToGuid = {};
    guidToId = {};
    
    // Build new project
    const project = makeEmptyProject();
    project.projectName = projectEl.getAttribute('name') || 'Imported Project';
    const docsByGuid = {};
    
    // Parse codes
    const codeElements = xmlDoc.querySelectorAll('CodeBook > Codes > Code, CodeBook > Codes Code');
    const codesByGuid = {};
    
    function parseCodeElement(codeEl, parentId = null) {
        const guid = codeEl.getAttribute('guid');
        const name = codeEl.getAttribute('name') || 'Unnamed Code';
        const color = parseColor(getCodeColorRawValue(codeEl));
        const rawShortcut = (codeEl.getAttribute('quackdasShortcut') || '').trim();
        const shortcut = /^[1-9]$/.test(rawShortcut) ? rawShortcut : '';
        const notes = codeEl.getAttribute('quackdasNotes') || '';
        const descEl = codeEl.querySelector(':scope > Description');
        const description = descEl ? descEl.textContent : '';
        
        const codeId = buildQdpxId('code');
        guidToId[guid] = codeId;
        
        const code = {
            id: codeId,
            name: name,
            color: color,
            description: description,
            notes: notes,
            parentId: parentId,
            created: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            shortcut: shortcut
        };
        
        codesByGuid[guid] = code;
        project.codes.push(code);
        
        // Parse nested codes
        const childCodes = codeEl.querySelectorAll(':scope > Code');
        childCodes.forEach(childEl => parseCodeElement(childEl, codeId));
    }
    
    // Start with top-level codes
    const topCodeElements = xmlDoc.querySelectorAll('CodeBook > Codes > Code');
    topCodeElements.forEach(codeEl => parseCodeElement(codeEl, null));
    
    // Parse sources
    const sourceElements = xmlDoc.querySelectorAll('Sources > TextSource, Sources > PDFSource');
    
    for (const sourceEl of sourceElements) {
        const guid = sourceEl.getAttribute('guid');
        const name = sourceEl.getAttribute('name') || 'Unnamed Document';
        const isPdf = sourceEl.tagName === 'PDFSource';
        const sourcePathAttr = sourceEl.getAttribute('path');
        const plainTextPathAttr = sourceEl.getAttribute('plainTextPath');
        const representationEl = sourceEl.querySelector(':scope > Representation');
        const representationTextPath = representationEl ? representationEl.getAttribute('plainTextPath') : '';
        
        const docId = buildQdpxId('doc');
        guidToId[guid] = docId;
        
        let content = '';
        let pdfData = null;
        let pdfPages = null;
        
        // Try to read content from file in zip
        if (isPdf) {
            const resolvedPdf = resolveZipSourceFile(sourcePathAttr || plainTextPathAttr, zipLookup);
            if (resolvedPdf && resolvedPdf.file) {
                const declaredBytes = getZipObjectDeclaredUncompressedBytes(resolvedPdf.file);
                if (Number.isFinite(declaredBytes) && declaredBytes > QDPX_MAX_SINGLE_SOURCE_BYTES) {
                    throw new Error(`Invalid QDPX file: source "${name}" exceeds per-file safety limit.`);
                }
                // Read PDF binary
                const pdfBinary = await resolvedPdf.file.async('arraybuffer');
                const pdfBytes = getBinaryByteLength(pdfBinary) || 0;
                if (pdfBytes > QDPX_MAX_SINGLE_SOURCE_BYTES) {
                    throw new Error(`Invalid QDPX file: source "${name}" exceeds per-file safety limit.`);
                }
                expandedReadBytes += pdfBytes;
                if (expandedReadBytes > QDPX_MAX_EXPANDED_READ_BYTES) {
                    throw new Error('Invalid QDPX file: decompressed content exceeds safety limit.');
                }
                pdfData = arrayBufferToBase64(pdfBinary);

                // Prefer representation text files when present (NVivo layout).
                const resolvedRepText = resolveZipSourceFile(representationTextPath || plainTextPathAttr, zipLookup);
                if (resolvedRepText && resolvedRepText.file) {
                    content = await resolvedRepText.file.async('string');
                    const textBytes = getStringByteLength(content);
                    if (textBytes > QDPX_MAX_SINGLE_SOURCE_BYTES) {
                        throw new Error(`Invalid QDPX file: source "${name}" exceeds per-file safety limit.`);
                    }
                    expandedReadBytes += textBytes;
                    if (expandedReadBytes > QDPX_MAX_EXPANDED_READ_BYTES) {
                        throw new Error('Invalid QDPX file: decompressed content exceeds safety limit.');
                    }
                }

                // Fallback to inline source content or extracted text.
                if (!content) {
                    const textEl = sourceEl.querySelector('PlainTextContent');
                    content = textEl ? textEl.textContent : '';
                }
                if (!content && representationEl) {
                    const textEl = representationEl.querySelector(':scope > PlainTextContent');
                    content = textEl ? textEl.textContent : '';
                }

                if (!content && typeof pdfjsLib !== 'undefined') {
                    try {
                        const extractResult = await extractPdfText(pdfBinary);
                        content = extractResult.text;
                        pdfPages = extractResult.pages;
                    } catch (e) {
                        console.warn('Could not extract PDF text:', e);
                    }
                }
            }
        } else {
            const resolvedText = resolveZipSourceFile(plainTextPathAttr || sourcePathAttr, zipLookup);
            if (resolvedText && resolvedText.file) {
                const declaredBytes = getZipObjectDeclaredUncompressedBytes(resolvedText.file);
                if (Number.isFinite(declaredBytes) && declaredBytes > QDPX_MAX_SINGLE_SOURCE_BYTES) {
                    throw new Error(`Invalid QDPX file: source "${name}" exceeds per-file safety limit.`);
                }
                content = await resolvedText.file.async('string');
                const textBytes = getStringByteLength(content);
                if (textBytes > QDPX_MAX_SINGLE_SOURCE_BYTES) {
                    throw new Error(`Invalid QDPX file: source "${name}" exceeds per-file safety limit.`);
                }
                expandedReadBytes += textBytes;
                if (expandedReadBytes > QDPX_MAX_EXPANDED_READ_BYTES) {
                    throw new Error('Invalid QDPX file: decompressed content exceeds safety limit.');
                }
            }
        }
        
        // Fallback to inline content
        if (!content) {
            const textEl = sourceEl.querySelector('PlainTextContent');
            if (textEl) {
                content = textEl.textContent;
                const inlineBytes = getStringByteLength(content);
                if (inlineBytes > QDPX_MAX_SINGLE_SOURCE_BYTES) {
                    throw new Error(`Invalid QDPX file: inline content for "${name}" exceeds safety limit.`);
                }
            }
        }
        
        const doc = {
            id: docId,
            title: name,
            content: content,
            type: isPdf ? 'pdf' : 'text',
            metadata: {},
            created: sourceEl.getAttribute('creationDateTime') || new Date().toISOString(),
            lastAccessed: sourceEl.getAttribute('modifiedDateTime') || new Date().toISOString()
        };

        const sourceAttributeExclusions = new Set([
            'guid', 'name', 'path', 'plainTextPath', 'creatingUserGUID',
            'creationDateTime', 'modifyingUserGUID', 'modifiedDateTime'
        ]);
        Array.from(sourceEl.attributes || []).forEach(attr => {
            if (!attr || sourceAttributeExclusions.has(attr.name)) return;
            if (applyMetadataValue(doc, attr.name, attr.value)) {
            }
        });
        const sourceDescEl = sourceEl.querySelector(':scope > Description');
        if (sourceDescEl && applyMetadataValue(doc, 'notes', sourceDescEl.textContent)) {
        }
        
        if (isPdf && pdfData) {
            doc.pdfData = pdfData;
            if (pdfPages) {
                doc.pdfPages = pdfPages;
            }
        }
        
        project.documents.push(doc);
        docsByGuid[guid] = doc;
    }

    // Parse variables/cases/attributes
    const variableByGuid = {};
    xmlDoc.querySelectorAll('Variables > Variable').forEach(variableEl => {
        const guid = getAttrFirst(variableEl, ['guid', 'id', 'variableGUID']);
        const name = getAttrFirst(variableEl, ['name', 'label']);
        if (!guid || !name) return;
        const type = normalizeVariableType(getAttrFirst(variableEl, ['typeOfVariable', 'type']));
        const variableId = buildQdpxId('var');
        guidToId[guid] = variableId;
        variableByGuid[guid] = { id: variableId, name, type };
        if (!Array.isArray(project.variableDefinitions)) project.variableDefinitions = [];
        project.variableDefinitions.push({ id: variableId, name, type });
    });

    const pendingCaseParents = [];
    xmlDoc.querySelectorAll('Cases Case').forEach(caseEl => {
        const caseGuid = getAttrFirst(caseEl, ['guid', 'id']);
        const caseId = buildQdpxId('case');
        if (caseGuid) guidToId[caseGuid] = caseId;
        const caseName = getAttrFirst(caseEl, ['name', 'label']) || 'Unnamed Case';
        const caseDescEl = caseEl.querySelector(':scope > Description');
        const caseDescription = caseDescEl ? caseDescEl.textContent : '';
        const memberGuids = [];
        caseEl.querySelectorAll(':scope > MemberSource, :scope > SourceRef, :scope > CaseSourceRef').forEach(memberEl => {
            const sourceGuid = getAttrFirst(memberEl, ['targetGUID', 'sourceGUID', 'guid', 'id']);
            if (sourceGuid) memberGuids.push(sourceGuid);
        });

        if (memberGuids.length === 0) {
            const sourceGuid = getAttrFirst(caseEl, ['sourceGUID', 'targetGUID']);
            if (sourceGuid) memberGuids.push(sourceGuid);
        }

        const linkedDocumentIds = [];
        memberGuids.forEach(sourceGuid => {
            const doc = docsByGuid[sourceGuid];
            if (!doc) return;
            linkedDocumentIds.push(doc.id);
            if (!Array.isArray(doc.caseIds)) doc.caseIds = [];
            if (!doc.caseIds.includes(caseId)) doc.caseIds.push(caseId);
        });

        const caseAttributes = {};

        caseEl.querySelectorAll(':scope > VariableValue, :scope > AttributeValue, :scope > CaseVariableValue').forEach(valueEl => {
            const variableGuid = getAttrFirst(valueEl, ['variableGUID', 'variableGuid', 'variableId']);
            const variableDef = variableByGuid[variableGuid];
            const key = (variableDef && variableDef.name) || getAttrFirst(valueEl, ['variableName', 'name', 'key']);
            const value = getAttrFirst(valueEl, ['value', 'text', 'content']) || (valueEl.textContent || '').trim();
            if (!key || !value) return;

            caseAttributes[key] = value;
            memberGuids.forEach(sourceGuid => {
                const doc = docsByGuid[sourceGuid];
                if (!doc) return;
                applyMetadataValue(doc, key, value);
            });
        });

        const directParentGuid = getAttrFirst(caseEl, ['parentGUID', 'parentGuid', 'parentID', 'parentId']);
        const nestedParentEl = caseEl.parentElement ? caseEl.parentElement.closest('Case') : null;
        const nestedParentGuid = nestedParentEl ? getAttrFirst(nestedParentEl, ['guid', 'id']) : null;
        const parentGuid = directParentGuid || nestedParentGuid || null;
        if (parentGuid) pendingCaseParents.push({ caseId, parentGuid });

        const typeFromAttr = getAttrFirst(caseEl, ['type', 'classification', 'class']) || '';
        const typeFromVariable = String(caseAttributes.Type || caseAttributes.type || '').trim();

        if (!Array.isArray(project.cases)) project.cases = [];
        project.cases.push({
            id: caseId,
            name: caseName,
            type: String(typeFromAttr || typeFromVariable || '').trim(),
            parentId: null,
            description: caseDescription,
            linkedDocumentIds: Array.from(new Set(linkedDocumentIds)),
            attributes: caseAttributes,
            created: new Date().toISOString(),
            modified: new Date().toISOString()
        });
    });

    pendingCaseParents.forEach(({ caseId, parentGuid }) => {
        const caseItem = project.cases.find(c => c.id === caseId);
        const parentId = guidToId[parentGuid];
        if (!caseItem || !parentId || parentId === caseId) return;
        caseItem.parentId = parentId;
    });

    // Parse Quackdas document metadata extension
    xmlDoc.querySelectorAll('QuackdasExtensions > DocumentMetadata > DocumentMeta').forEach(docMetaEl => {
        const sourceGuid = getAttrFirst(docMetaEl, ['sourceGUID', 'targetGUID']);
        const doc = docsByGuid[sourceGuid];
        if (!doc) return;
        docMetaEl.querySelectorAll(':scope > Field').forEach(fieldEl => {
            const key = getAttrFirst(fieldEl, ['key', 'name']);
            const value = getAttrFirst(fieldEl, ['value']) || (fieldEl.textContent || '').trim();
            if (!key || !value) return;
            applyMetadataValue(doc, key, value);
        });
    });

    xmlDoc.querySelectorAll('QuackdasExtensions > CodeViewPresets > Preset').forEach((presetEl) => {
        const id = getAttrFirst(presetEl, ['id']) || ('preset_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
        const name = getAttrFirst(presetEl, ['name']) || 'Preset';
        const updated = getAttrFirst(presetEl, ['updated']) || new Date().toISOString();
        const state = {};
        presetEl.querySelectorAll(':scope > State').forEach((stateEl) => {
            const key = getAttrFirst(stateEl, ['key']);
            const value = getAttrFirst(stateEl, ['value']);
            if (!key) return;
            state[key] = String(value || '');
        });
        if (!Array.isArray(project.codeViewPresets)) project.codeViewPresets = [];
        project.codeViewPresets.push({ id, name, updated, state });
    });
    
    // Parse selections (coded segments)
    const selectionEntries = collectPlainTextSelections(xmlDoc);
    
    selectionEntries.forEach(({ selectionEl: selEl, sourceGuid: sourceGuidHint }) => {
        const guid = selEl.getAttribute('guid');
        const sourceGuid = selEl.getAttribute('sourceGUID') || sourceGuidHint;
        const startPos = Number.parseInt(selEl.getAttribute('startPosition'), 10);
        const endPos = Number.parseInt(selEl.getAttribute('endPosition'), 10);
        
        const docId = guidToId[sourceGuid];
        if (!docId) return;
        
        const doc = project.documents.find(d => d.id === docId);
        if (!doc) return;
        const range = normalizeSelectionRange(startPos, endPos, doc.content.length);
        if (!range) return;
        
        const segId = buildQdpxId('seg');
        if (guid) guidToId[guid] = segId;
        
        // Get codes applied to this selection
        const codeGuids = getSelectionCodeGuids(selEl);
        const codeIds = [];
        codeGuids.forEach(codeGuid => {
            const codeId = guidToId[codeGuid];
            if (codeId && !codeIds.includes(codeId)) {
                codeIds.push(codeId);
            }
        });
        
        if (codeIds.length === 0) return;
        
        const segment = {
            id: segId,
            docId: docId,
            text: doc.content.substring(range.start, range.end),
            codeIds: codeIds,
            startIndex: range.start,
            endIndex: range.end,
            created: getAttrFirst(selEl, ['quackdasCreated', 'creationDateTime']) || doc.created || new Date().toISOString(),
            modified: getAttrFirst(selEl, ['quackdasModified', 'modifiedDateTime']) || getAttrFirst(selEl, ['quackdasCreated', 'creationDateTime']) || doc.created || new Date().toISOString()
        };
        
        project.segments.push(segment);
    });

    // Parse Quackdas PDF region extension
    xmlDoc.querySelectorAll('QuackdasExtensions > PdfRegionSelections > PdfRegionSelection').forEach(selEl => {
        const guid = getAttrFirst(selEl, ['guid']);
        const sourceGuid = getAttrFirst(selEl, ['sourceGUID']);
        const docId = guidToId[sourceGuid];
        if (!docId) return;
        const doc = project.documents.find(d => d.id === docId);
        if (!doc) return;

        const codingElements = selEl.querySelectorAll(':scope > Coding');
        const codeIds = [];
        codingElements.forEach(codingEl => {
            const codeGuid = getAttrFirst(codingEl, ['codeGUID']);
            const codeId = guidToId[codeGuid];
            if (codeId && !codeIds.includes(codeId)) codeIds.push(codeId);
        });
        if (codeIds.length === 0) return;

        const segId = buildQdpxId('seg');
        if (guid) guidToId[guid] = segId;

        const startPosition = Number.parseInt(getAttrFirst(selEl, ['startPosition']), 10);
        const endPosition = Number.parseInt(getAttrFirst(selEl, ['endPosition']), 10);
        const segment = {
            id: segId,
            docId: docId,
            text: getAttrFirst(selEl, ['text']) || '',
            codeIds,
            created: getAttrFirst(selEl, ['quackdasCreated', 'creationDateTime']) || doc.created || new Date().toISOString(),
            modified: getAttrFirst(selEl, ['quackdasModified', 'modifiedDateTime']) || getAttrFirst(selEl, ['quackdasCreated', 'creationDateTime']) || doc.created || new Date().toISOString(),
            pdfRegion: (typeof normalizePdfRegionShape === 'function' ? normalizePdfRegionShape({
                pageNum: parseInt(getAttrFirst(selEl, ['pageNum']), 10) || 1,
                xNorm: parseFloat(getAttrFirst(selEl, ['xNorm', 'x'])) || 0,
                yNorm: parseFloat(getAttrFirst(selEl, ['yNorm', 'y'])) || 0,
                wNorm: parseFloat(getAttrFirst(selEl, ['wNorm', 'width'])) || 0,
                hNorm: parseFloat(getAttrFirst(selEl, ['hNorm', 'height'])) || 0
            }) : {
                pageNum: parseInt(getAttrFirst(selEl, ['pageNum']), 10) || 1,
                xNorm: parseFloat(getAttrFirst(selEl, ['xNorm', 'x'])) || 0,
                yNorm: parseFloat(getAttrFirst(selEl, ['yNorm', 'y'])) || 0,
                wNorm: parseFloat(getAttrFirst(selEl, ['wNorm', 'width'])) || 0,
                hNorm: parseFloat(getAttrFirst(selEl, ['hNorm', 'height'])) || 0
            })
        };
        const optionalRange = normalizeSelectionRange(startPosition, endPosition, doc.content.length);
        if (optionalRange) {
            segment.startIndex = optionalRange.start;
            segment.endIndex = optionalRange.end;
        }

        project.segments.push(segment);
    });
    
    // Parse notes (memos)
    const noteElements = xmlDoc.querySelectorAll('Notes > Note');
    
    noteElements.forEach(noteEl => {
        const guid = noteEl.getAttribute('guid');
        const contentEl = noteEl.querySelector('PlainTextContent');
        const content = contentEl ? contentEl.textContent : '';
        const noteRefEl = noteEl.querySelector('NoteRef');
        const targetGuid = noteRefEl ? noteRefEl.getAttribute('targetGUID') : null;
        const memoCodeGuid = noteEl.getAttribute('quackdasCodeGUID') || '';
        const memoCodeIdLegacy = noteEl.getAttribute('quackdasCodeId') || '';
        
        const memoId = buildQdpxId('memo');
        
        // Determine memo type based on target
        let memoType = 'project';
        let targetId = null;
        
        if (targetGuid && guidToId[targetGuid]) {
            targetId = guidToId[targetGuid];
            // Check what type of entity this is
            if (project.documents.find(d => d.id === targetId)) {
                memoType = 'document';
            } else if (project.codes.find(c => c.id === targetId)) {
                memoType = 'code';
            } else if (project.segments.find(s => s.id === targetId)) {
                memoType = 'segment';
            }
        }

        let memoCodeId = '';
        if (memoType === 'segment') {
            if (memoCodeGuid && guidToId[memoCodeGuid] && project.codes.some(c => c.id === guidToId[memoCodeGuid])) {
                memoCodeId = guidToId[memoCodeGuid];
            } else if (memoCodeIdLegacy && project.codes.some(c => c.id === memoCodeIdLegacy)) {
                memoCodeId = memoCodeIdLegacy;
            }
            if (memoCodeId) {
                const segment = project.segments.find(s => s.id === targetId);
                if (!segment || !Array.isArray(segment.codeIds) || !segment.codeIds.includes(memoCodeId)) {
                    memoCodeId = '';
                }
            }
        }
        
        const memo = {
            id: memoId,
            type: memoType,
            targetId: targetId,
            content: content,
            tag: noteEl.getAttribute('quackdasTag') || '',
            created: noteEl.getAttribute('creationDateTime') || new Date().toISOString(),
            edited: noteEl.getAttribute('quackdasEdited') || noteEl.getAttribute('creationDateTime') || new Date().toISOString()
        };
        if (memoCodeId) memo.codeId = memoCodeId;
        
        project.memos.push(memo);
    });
    
    // Parse sets (as folders)
    const setElements = xmlDoc.querySelectorAll('Sets > Set');
    
    setElements.forEach(setEl => {
        const guid = setEl.getAttribute('guid');
        const name = setEl.getAttribute('name') || 'Unnamed Folder';
        const descEl = setEl.querySelector('Description');
        const description = descEl ? descEl.textContent : '';
        
        const folderId = buildQdpxId('folder');
        guidToId[guid] = folderId;
        
        const folder = {
            id: folderId,
            name: name,
            parentId: null,
            created: new Date().toISOString(),
            expanded: true,
            description: description
        };
        
        project.folders.push(folder);
        
        // Assign documents to this folder
        const memberElements = setEl.querySelectorAll('MemberSource');
        memberElements.forEach(memberEl => {
            const docGuid = memberEl.getAttribute('targetGUID');
            const docId = guidToId[docGuid];
            if (docId) {
                const doc = project.documents.find(d => d.id === docId);
                if (doc) {
                    doc.folderId = folderId;
                }
            }
        });
    });
    
    // Parse Quackdas folder hierarchy extension (parent links + metadata)
    xmlDoc.querySelectorAll('QuackdasExtensions > FolderHierarchy > Folder').forEach(folderEl => {
        const guid = getAttrFirst(folderEl, ['guid']);
        const folderId = guidToId[guid];
        if (!folderId) return;
        const folder = project.folders.find(f => f.id === folderId);
        if (!folder) return;

        const parentGuid = getAttrFirst(folderEl, ['parentGUID']);
        const parentId = parentGuid ? guidToId[parentGuid] : null;
        folder.parentId = parentId || null;

        const created = getAttrFirst(folderEl, ['created']);
        if (created) folder.created = created;

        const expanded = getAttrFirst(folderEl, ['expanded']);
        if (expanded === 'true') folder.expanded = true;
        if (expanded === 'false') folder.expanded = false;
    });

    // Set current document
    if (project.documents.length > 0) {
        project.currentDocId = project.documents[0].id;
    }
    return project;
}

/**
 * Extract text from PDF with positions
 * Helper for importing PDFs from QDPX
 */
async function extractPdfText(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js not available');
    }
    
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    
    const pages = [];
    let fullText = '';
    
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });
        
        const pageTextItems = [];
        
        for (let i = 0; i < textContent.items.length; i++) {
            const item = textContent.items[i];
            if (item.str) {
                const startPos = fullText.length;
                fullText += item.str;
                const endPos = fullText.length;
                
                pageTextItems.push({
                    text: item.str,
                    start: startPos,
                    end: endPos,
                    transform: item.transform,
                    width: item.width,
                    height: item.height
                });
            }
            
            if (item.hasEOL) {
                fullText += '\n';
            } else if (i < textContent.items.length - 1) {
                const nextItem = textContent.items[i + 1];
                if (nextItem && nextItem.str && !item.str.endsWith(' ') && !nextItem.str.startsWith(' ')) {
                    const gap = nextItem.transform ? 
                        nextItem.transform[4] - (item.transform[4] + item.width) : 0;
                    if (gap > 2) {
                        fullText += ' ';
                    }
                }
            }
        }
        
        pages.push({
            pageNum,
            width: viewport.width,
            height: viewport.height,
            textItems: pageTextItems
        });
        
        if (pageNum < pdfDoc.numPages) {
            fullText += '\n\n';
        }
    }
    
    return { text: fullText, pages };
}

/**
 * Helper: Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Helper: Convert base64 to ArrayBuffer  
 */
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
