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
    // Remove alpha channel if present (first 2 chars)
    let color = qdpxColor;
    if (color.length === 8) {
        color = color.substring(2);
    }
    return '#' + color.toLowerCase();
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

function setQdpxReport(direction, report) {
    if (typeof window === 'undefined' || !window) return;
    if (direction === 'export') window.lastQdpxExportReport = report;
    if (direction === 'import') window.lastQdpxImportReport = report;
}

function summarizeQdpxCompatibilityReport(report) {
    if (!report || typeof report !== 'object') return '';
    const lines = [];
    const label = report.direction === 'export' ? 'QDPX export' : 'QDPX import';
    lines.push(`${label} summary:`);

    if (report.direction === 'export') {
        lines.push(`- Plain-text selections exported: ${report.exportedPlainTextSelections || 0}`);
        if ((report.exportedPdfRegionSelections || 0) > 0) {
            lines.push(`- PDF region codings preserved via Quackdas extension: ${report.exportedPdfRegionSelections}`);
        }
        if ((report.exportedMetadataFields || 0) > 0) {
            lines.push(`- Document metadata fields preserved via Quackdas extension: ${report.exportedMetadataFields}`);
        }
    } else {
        lines.push(`- Sources imported: ${report.importedSources || 0}`);
        lines.push(`- Selections imported: ${report.importedPlainTextSelections || 0}`);
        if ((report.importedPdfRegionSelections || 0) > 0) {
            lines.push(`- PDF region codings restored from Quackdas extension: ${report.importedPdfRegionSelections}`);
        }
        if ((report.importedMetadataFields || 0) > 0) {
            lines.push(`- Metadata fields mapped/imported: ${report.importedMetadataFields}`);
        }
    }

    if (Array.isArray(report.warnings) && report.warnings.length > 0) {
        lines.push('');
        lines.push('Compatibility notes:');
        report.warnings.slice(0, 5).forEach(w => lines.push(`- ${w}`));
    }
    return lines.join('\n');
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
    const sourcesFolder = zip.folder('Sources');
    
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
    
    const exportReport = {
        direction: 'export',
        exportedPlainTextSelections: 0,
        exportedPdfRegionSelections: 0,
        exportedMetadataFields: 0,
        warnings: []
    };

    // Add source files and build source list
    const sources = [];
    for (const doc of appData.documents) {
        const guid = getOrCreateGuid(doc.id);
        const safeFileName = doc.title.replace(/[<>:"/\\|?*]/g, '_');
        
        if (doc.type === 'pdf' && doc.pdfData) {
            // PDF document - store original PDF
            const fileName = `${safeFileName}.pdf`;
            const pdfBinary = base64ToArrayBuffer(doc.pdfData);
            sourcesFolder.file(fileName, pdfBinary);
            
            sources.push({
                type: 'PDFSource',
                guid: guid,
                name: doc.title,
                path: `Sources/${fileName}`,
                plainTextContent: doc.content, // Extracted text for searching
                created: doc.created,
                modified: doc.lastAccessed
            });
        } else {
            // Text document - store as plain text
            const fileName = `${safeFileName}.txt`;
            sourcesFolder.file(fileName, doc.content || '');
            
            sources.push({
                type: 'TextSource',
                guid: guid,
                name: doc.title,
                path: `Sources/${fileName}`,
                plainTextContent: doc.content,
                created: doc.created,
                modified: doc.lastAccessed
            });
        }
    }
    
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
        codeXml += `quackdasShortcut="${escapeXml(code.shortcut || '')}"`;
        
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
            // Include plain text representation for text-based operations
            xml += `      <PlainTextContent>${escapeXml(source.plainTextContent)}</PlainTextContent>\n`;
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
    
    // Variables (document metadata keys as variable definitions)
    xml += '  <Variables>\n';
    const metadataKeys = new Set();
    appData.documents.forEach(doc => {
        if (!doc.metadata || typeof doc.metadata !== 'object') return;
        Object.keys(doc.metadata).forEach(key => {
            const value = doc.metadata[key];
            if (value !== null && value !== undefined && String(value).trim() !== '') {
                metadataKeys.add(key);
            }
        });
    });
    Array.from(metadataKeys).sort().forEach(varName => {
        xml += `    <Variable guid="${generateGUID()}" name="${escapeXml(varName)}" typeOfVariable="Text"/>\n`;
    });
    xml += '  </Variables>\n';
    
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
        xml += `endPosition="${segment.endIndex}">\n`;
        
        // Each code applied to this segment
        segment.codeIds.forEach(codeId => {
            const codeGuid = getOrCreateGuid(codeId);
            const codingGuid = generateGUID();
            xml += `      <Coding guid="${codingGuid}" codeGUID="${codeGuid}"/>\n`;
        });
        
        xml += '    </PlainTextSelection>\n';
        exportReport.exportedPlainTextSelections += 1;
    });
    xml += '  </Selections>\n';
    
    // Notes (memos)
    xml += '  <Notes>\n';
    appData.memos.forEach(memo => {
        const memoGuid = getOrCreateGuid(memo.id);
        const targetGuid = memo.targetId ? getOrCreateGuid(memo.targetId) : null;
        const memoTag = String(memo.tag || '').trim();
        const memoEdited = memo.edited || memo.created;
        
        xml += `    <Note guid="${memoGuid}" `;
        xml += `name="${escapeXml(memo.type + ' memo')}" `;
        if (memoTag) xml += `quackdasTag="${escapeXml(memoTag)}" `;
        if (memoEdited) xml += `quackdasEdited="${escapeXml(String(memoEdited))}" `;
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
        xml += `text="${escapeXml(segment.text || '')}">\n`;
        segment.codeIds.forEach(codeId => {
            const codeGuid = getOrCreateGuid(codeId);
            xml += `        <Coding guid="${generateGUID()}" codeGUID="${codeGuid}"/>\n`;
        });
        xml += '      </PdfRegionSelection>\n';
        exportReport.exportedPdfRegionSelections += 1;
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
            exportReport.exportedMetadataFields += 1;
        });
        xml += '      </DocumentMeta>\n';
    });
    xml += '    </DocumentMetadata>\n';

    xml += '  </QuackdasExtensions>\n';

    if (exportReport.exportedPdfRegionSelections > 0) {
        exportReport.warnings.push('Some tools may ignore Quackdas PDF region extensions and only import plain-text selections.');
    }
    if (exportReport.exportedMetadataFields > 0) {
        exportReport.warnings.push('Document metadata is preserved in a Quackdas extension block for round-trip fidelity.');
    }
    
    xml += '</Project>\n';
    
    // Add project.qde to zip
    zip.file('project.qde', xml);
    
    // Generate zip file
    const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
    setQdpxReport('export', exportReport);
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
    
    const zip = await JSZip.loadAsync(qdpxData);
    
    // Read project.qde
    const qdeFile = zip.file('project.qde');
    if (!qdeFile) {
        throw new Error('Invalid QDPX file: missing project.qde');
    }
    
    const qdeContent = await qdeFile.async('string');
    
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
    const importReport = {
        direction: 'import',
        importedSources: 0,
        importedPlainTextSelections: 0,
        importedPdfRegionSelections: 0,
        importedMetadataFields: 0,
        warnings: []
    };
    const docsByGuid = {};
    
    // Parse codes
    const codeElements = xmlDoc.querySelectorAll('CodeBook > Codes > Code, CodeBook > Codes Code');
    const codesByGuid = {};
    
    function parseCodeElement(codeEl, parentId = null) {
        const guid = codeEl.getAttribute('guid');
        const name = codeEl.getAttribute('name') || 'Unnamed Code';
        const color = parseColor(codeEl.getAttribute('color'));
        const rawShortcut = (codeEl.getAttribute('quackdasShortcut') || '').trim();
        const shortcut = /^[1-9]$/.test(rawShortcut) ? rawShortcut : '';
        const descEl = codeEl.querySelector(':scope > Description');
        const description = descEl ? descEl.textContent : '';
        
        const codeId = buildQdpxId('code');
        guidToId[guid] = codeId;
        
        const code = {
            id: codeId,
            name: name,
            color: color,
            description: description,
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
        const path = sourceEl.getAttribute('path') || sourceEl.getAttribute('plainTextPath');
        
        const docId = buildQdpxId('doc');
        guidToId[guid] = docId;
        
        let content = '';
        let pdfData = null;
        let pdfPages = null;
        
        // Try to read content from file in zip
        if (path) {
            const sourceFile = zip.file(path);
            if (sourceFile) {
                if (isPdf) {
                    // Read PDF binary
                    const pdfBinary = await sourceFile.async('arraybuffer');
                    pdfData = arrayBufferToBase64(pdfBinary);
                    
                    // Try to get text content from XML
                    const textEl = sourceEl.querySelector('PlainTextContent');
                    content = textEl ? textEl.textContent : '';
                    
                    // If no text in XML and PDF.js available, extract it
                    if (!content && typeof pdfjsLib !== 'undefined') {
                        try {
                            const extractResult = await extractPdfText(pdfBinary);
                            content = extractResult.text;
                            pdfPages = extractResult.pages;
                        } catch (e) {
                            console.warn('Could not extract PDF text:', e);
                        }
                    }
                } else {
                    content = await sourceFile.async('string');
                }
            }
        }
        
        // Fallback to inline content
        if (!content) {
            const textEl = sourceEl.querySelector('PlainTextContent');
            if (textEl) {
                content = textEl.textContent;
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
                importReport.importedMetadataFields += 1;
            }
        });
        const sourceDescEl = sourceEl.querySelector(':scope > Description');
        if (sourceDescEl && applyMetadataValue(doc, 'notes', sourceDescEl.textContent)) {
            importReport.importedMetadataFields += 1;
        }
        
        if (isPdf && pdfData) {
            doc.pdfData = pdfData;
            if (pdfPages) {
                doc.pdfPages = pdfPages;
            }
        }
        
        project.documents.push(doc);
        docsByGuid[guid] = doc;
        importReport.importedSources += 1;
    }

    // Parse variables/cases/attributes (best effort for cross-tool imports)
    const variableNameByGuid = {};
    xmlDoc.querySelectorAll('Variables > Variable').forEach(variableEl => {
        const guid = getAttrFirst(variableEl, ['guid', 'id', 'variableGUID']);
        const name = getAttrFirst(variableEl, ['name', 'label']);
        if (guid && name) variableNameByGuid[guid] = name;
    });

    xmlDoc.querySelectorAll('Cases > Case').forEach(caseEl => {
        const memberGuids = [];
        caseEl.querySelectorAll(':scope > MemberSource, :scope > SourceRef, :scope > CaseSourceRef').forEach(memberEl => {
            const sourceGuid = getAttrFirst(memberEl, ['targetGUID', 'sourceGUID', 'guid', 'id']);
            if (sourceGuid) memberGuids.push(sourceGuid);
        });

        if (memberGuids.length === 0) {
            const sourceGuid = getAttrFirst(caseEl, ['sourceGUID', 'targetGUID']);
            if (sourceGuid) memberGuids.push(sourceGuid);
        }

        if (memberGuids.length === 0) return;

        caseEl.querySelectorAll(':scope > VariableValue, :scope > AttributeValue, :scope > CaseVariableValue').forEach(valueEl => {
            const variableGuid = getAttrFirst(valueEl, ['variableGUID', 'variableGuid', 'variableId']);
            const key = variableNameByGuid[variableGuid] || getAttrFirst(valueEl, ['variableName', 'name', 'key']);
            const value = getAttrFirst(valueEl, ['value', 'text', 'content']) || (valueEl.textContent || '').trim();
            if (!key || !value) return;

            memberGuids.forEach(sourceGuid => {
                const doc = docsByGuid[sourceGuid];
                if (!doc) return;
                if (applyMetadataValue(doc, key, value)) importReport.importedMetadataFields += 1;
            });
        });
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
            if (applyMetadataValue(doc, key, value)) importReport.importedMetadataFields += 1;
        });
    });
    
    // Parse selections (coded segments)
    const selectionElements = xmlDoc.querySelectorAll('Selections > PlainTextSelection');
    
    selectionElements.forEach(selEl => {
        const guid = selEl.getAttribute('guid');
        const sourceGuid = selEl.getAttribute('sourceGUID');
        const startPos = parseInt(selEl.getAttribute('startPosition'), 10);
        const endPos = parseInt(selEl.getAttribute('endPosition'), 10);
        
        const docId = guidToId[sourceGuid];
        if (!docId) return;
        
        const doc = project.documents.find(d => d.id === docId);
        if (!doc) return;
        
        const segId = buildQdpxId('seg');
        guidToId[guid] = segId;
        
        // Get codes applied to this selection
        const codingElements = selEl.querySelectorAll('Coding');
        const codeIds = [];
        codingElements.forEach(codingEl => {
            const codeGuid = codingEl.getAttribute('codeGUID');
            const codeId = guidToId[codeGuid];
            if (codeId && !codeIds.includes(codeId)) {
                codeIds.push(codeId);
            }
        });
        
        if (codeIds.length === 0) return;
        
        const segment = {
            id: segId,
            docId: docId,
            text: doc.content.substring(startPos, endPos),
            codeIds: codeIds,
            startIndex: startPos,
            endIndex: endPos,
            created: new Date().toISOString()
        };
        
        project.segments.push(segment);
        importReport.importedPlainTextSelections += 1;
    });

    // Parse Quackdas PDF region extension
    xmlDoc.querySelectorAll('QuackdasExtensions > PdfRegionSelections > PdfRegionSelection').forEach(selEl => {
        const guid = getAttrFirst(selEl, ['guid']);
        const sourceGuid = getAttrFirst(selEl, ['sourceGUID']);
        const docId = guidToId[sourceGuid];
        if (!docId) return;

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

        const startPosition = parseInt(getAttrFirst(selEl, ['startPosition']), 10);
        const endPosition = parseInt(getAttrFirst(selEl, ['endPosition']), 10);
        const segment = {
            id: segId,
            docId: docId,
            text: getAttrFirst(selEl, ['text']) || '',
            codeIds,
            created: new Date().toISOString(),
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
        if (Number.isFinite(startPosition)) segment.startIndex = startPosition;
        if (Number.isFinite(endPosition)) segment.endIndex = endPosition;

        project.segments.push(segment);
        importReport.importedPdfRegionSelections += 1;
    });
    
    // Parse notes (memos)
    const noteElements = xmlDoc.querySelectorAll('Notes > Note');
    
    noteElements.forEach(noteEl => {
        const guid = noteEl.getAttribute('guid');
        const contentEl = noteEl.querySelector('PlainTextContent');
        const content = contentEl ? contentEl.textContent : '';
        const noteRefEl = noteEl.querySelector('NoteRef');
        const targetGuid = noteRefEl ? noteRefEl.getAttribute('targetGUID') : null;
        
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
        
        const memo = {
            id: memoId,
            type: memoType,
            targetId: targetId,
            content: content,
            tag: noteEl.getAttribute('quackdasTag') || '',
            created: noteEl.getAttribute('creationDateTime') || new Date().toISOString(),
            edited: noteEl.getAttribute('quackdasEdited') || noteEl.getAttribute('creationDateTime') || new Date().toISOString()
        };
        
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
    
    // Set current document
    if (project.documents.length > 0) {
        project.currentDocId = project.documents[0].id;
    }
    if (importReport.importedPdfRegionSelections > 0) {
        importReport.warnings.push('PDF region codings were restored from a Quackdas extension block and may not exist in generic QDPX files.');
    }
    setQdpxReport('import', importReport);
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

/**
 * Check if a file is a legacy JSON project
 */
function isLegacyJsonProject(data) {
    try {
        if (typeof data === 'string') {
            const parsed = JSON.parse(data);
            return parsed && (parsed.documents || parsed.codes || parsed.segments);
        }
        return false;
    } catch {
        return false;
    }
}
