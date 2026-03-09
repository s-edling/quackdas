/**
 * Quackdas - Import/Export Functions
 * Project and report export/import
 */

function hasProjectDataLoadedForReplacement() {
    if (!appData || typeof appData !== 'object') return false;
    return (
        (appData.documents?.length || 0) +
        (appData.codes?.length || 0) +
        (appData.cases?.length || 0) +
        (appData.segments?.length || 0) +
        (appData.folders?.length || 0) +
        (appData.memos?.length || 0)
    ) > 0;
}

function buildProjectReplacementMessage(actionText = 'Open this project') {
    const verb = String(actionText || 'Open this project').trim() || 'Open this project';
    if (appData?.hasUnsavedChanges) {
        return `You have unsaved changes. ${verb} and replace the current project in memory?`;
    }
    return `${verb} and replace the current project in memory?`;
}

function confirmProjectReplacement(actionText = 'Open this project') {
    if (!hasProjectDataLoadedForReplacement()) return true;
    if (typeof confirm !== 'function') return true;
    return confirm(buildProjectReplacementMessage(actionText));
}

async function commitOpenedProjectPath(projectPath) {
    if (!(window.electronAPI && typeof window.electronAPI.commitOpenedProject === 'function')) {
        return { ok: true };
    }
    return window.electronAPI.commitOpenedProject(projectPath);
}

function newProject() {
    if (appData.documents.length > 0 || appData.codes.length > 0 || appData.cases.length > 0) {
        if (!confirm('This will clear all current data. Continue?')) {
            return;
        }
    }
    
    // Reset the project file handle in Electron so future saves prompt for file
    if (window.electronAPI && window.electronAPI.clearProjectHandle) {
        window.electronAPI.clearProjectHandle().catch(() => {});
    }

    const nextProject = makeEmptyProject({
        theme: appData?.theme || 'light'
    });
    if (typeof replaceProjectData === 'function') {
        replaceProjectData(nextProject, {
            skipNormalization: true,
            fallbackTheme: appData?.theme || 'light',
            hasUnsavedChanges: false,
            lastSaveTime: null,
            markUnsaved: false
        });
    } else {
        history.past = [];
        history.future = [];
        updateHistoryButtons();
        appData = nextProject;
        appData.hasUnsavedChanges = false;
        appData.lastSaveTime = null;
        saveData({ markUnsaved: false });
    }

    renderAll();
    if (typeof updateSaveStatus === 'function') updateSaveStatus();
}

function importProject(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.qdpx')) {
        alert('Unsupported project format. Please choose a .qdpx file.');
        event.target.value = '';
        return;
    }

    if (!confirmProjectReplacement('Open this project')) {
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            if (typeof importFromQdpx !== 'function') {
                throw new Error('QDPX import not available');
            }

            const applied = await applyImportedQdpx(e.target.result, { resetProjectHandle: true });
            if (!applied) return;
        } catch (error) {
            console.error('Import error:', error);
            alert('Error importing project: ' + error.message);
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset file input
}

async function importProjectNative() {
    // Prefer native dialog in Electron; fall back to hidden file input in browser
    if (window.electronAPI && window.electronAPI.openProjectFile) {
        try {
            const res = await window.electronAPI.openProjectFile();
            if (!res || !res.ok) return;

            if (res.kind !== 'qdpx') {
                throw new Error('Unsupported project format. Please choose a .qdpx file.');
            }
            if (!confirmProjectReplacement('Open this project')) return;
            // QDPX format - data is base64-encoded
            if (typeof importFromQdpx !== 'function') {
                throw new Error('QDPX import not available');
            }
            const buffer = base64ToArrayBuffer(res.data);
            const applied = await applyImportedQdpx(buffer, {
                projectPath: String(res.path || '')
            });
            if (!applied) return;
            return;
        } catch (e) {
            console.error(e);
            alert('Error importing project: ' + (e?.message || e));
            return;
        }
    }
    const inp = document.getElementById('importProjectInput');
    if (inp) inp.click();
}

// Electron helper: apply a QDPX project (used by native Open Project with QDPX files)
async function applyImportedQdpx(buffer, options = {}) {
    const projectPath = String(options.projectPath || '').trim();
    const shouldResetProjectHandle = !!options.resetProjectHandle;
    try {
        if (typeof importFromQdpx !== 'function') {
            throw new Error('QDPX import not available');
        }
        
        const imported = await importFromQdpx(buffer);
        const previousTheme = appData?.theme || 'light';
        const importedAt = new Date().toISOString();

        if (typeof replaceProjectData === 'function') {
            replaceProjectData(imported, {
                fallbackTheme: previousTheme,
                hasUnsavedChanges: false,
                lastSaveTime: importedAt,
                markUnsaved: false
            });
        } else {
            const normalizedProject = normaliseProject(imported);
            appData = normalizedProject;
            appData.theme = appData.theme || previousTheme;
            appData.hasUnsavedChanges = false;
            appData.lastSaveTime = importedAt;
            if (typeof saveData === 'function') saveData({ markUnsaved: false });
            else if (typeof rebuildIndexes === 'function') rebuildIndexes();
        }

        if (projectPath) {
            const commitResult = await commitOpenedProjectPath(projectPath);
            if (!commitResult || !commitResult.ok) {
                throw new Error(commitResult?.error || 'Could not commit opened project path.');
            }
            if (typeof syncFieldnoteProjectMetadata === 'function') {
                syncFieldnoteProjectMetadata(projectPath);
            }
        } else if (shouldResetProjectHandle && window.electronAPI?.clearProjectHandle) {
            await window.electronAPI.clearProjectHandle().catch(() => {});
        }
        if (typeof renderAll === 'function') renderAll();
        if (typeof updateSaveStatus === 'function') updateSaveStatus();
        return true;
    } catch (error) {
        if ((projectPath || shouldResetProjectHandle) && window.electronAPI?.clearProjectHandle) {
            window.electronAPI.clearProjectHandle().catch(() => {});
        }
        console.error('Error importing QDPX project:', error);
        alert('Error importing project: ' + error.message);
        return false;
    }
}

function exportCodedData() {
    if (appData.documents.length === 0) {
        alert('No documents to export.');
        return;
    }
    let report = '# Quackdas - Coded Data Report\n';
    report += `Generated: ${new Date().toLocaleString()}\n\n`;
    report += '---\n\n';

    // Summary
    report += '## Project Summary\n\n';
    report += `- Documents: ${appData.documents.length}\n`;
    report += `- Codes: ${appData.codes.length}\n`;
    report += `- Coded Segments: ${appData.segments.length}\n\n`;
    report += '---\n\n';

    // Codes overview
    report += '## Codes\n\n';
    appData.codes.forEach(code => {
        const parent = code.parentId ? appData.codes.find(c => c.id === code.parentId) : null;
        const count = getCodeSegmentCountFast(code.id);
        const indent = parent ? '  - ' : '- ';
        report += `${indent}**${code.name}** (${count} segments)`;
        if (parent) report += ` [Child of: ${parent.name}]`;
        report += '\n';
    });
    report += '\n---\n\n';

    // Segments by code
    report += '## Coded Segments\n\n';
    appData.codes.forEach(code => {
        const segments = getSegmentsForCode(code.id);
        if (segments.length === 0) return;

        report += `### ${code.name}\n\n`;
        report += `${segments.length} segment(s)\n\n`;

        segments.forEach((segment, i) => {
            const doc = appData.documents.find(d => d.id === segment.docId);
            const segmentText = segment.pdfRegion
                ? `[PDF region, page ${segment.pdfRegion.pageNum}] ${segment.text || 'Region selection'}`
                : (segment.fieldnoteImageId ? `[Fieldnote image] ${segment.text || 'Image capture'}` : segment.text);
            report += `**${i + 1}. From: ${doc.title}**`;
            report += `\n\n`;
            report += `> ${segmentText}\n\n`;
            
            // Show other codes applied to this segment
            const otherCodes = segment.codeIds
                .filter(id => id !== code.id)
                .map(id => appData.codes.find(c => c.id === id))
                .filter(Boolean);
            
            if (otherCodes.length > 0) {
                report += `*Also coded as: ${otherCodes.map(c => c.name).join(', ')}*\n\n`;
            }
        });
        report += '---\n\n';
    });

    // Documents overview
    report += '## Documents\n\n';
    appData.documents.forEach(doc => {
        const segmentCount = getDocSegmentCountFast(doc.id);
        report += `### ${doc.title}\n\n`;
        report += `- Length: ${doc.content.length} characters\n`;
        report += `- Coded segments: ${segmentCount}\n`;
        report += `- Created: ${new Date(doc.created).toLocaleString()}\n\n`;
    });

    // Download as markdown file
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quackdas-report-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function packProjectForExport() {
    try {
        if (typeof exportToQdpx !== 'function') {
            throw new Error('QDPX export is not available in this build.');
        }
        const blob = await exportToQdpx({ embedFieldnoteMedia: true });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const baseName = String(appData.projectName || 'quackdas-project').replace(/[^\w.-]+/g, '-');
        link.href = url;
        link.download = `${baseName}-packed.qdpx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Packed export failed:', error);
        alert('Packed export failed: ' + (error.message || error));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        hasProjectDataLoadedForReplacement,
        buildProjectReplacementMessage,
        confirmProjectReplacement,
        applyImportedQdpx,
        packProjectForExport
    };
}
