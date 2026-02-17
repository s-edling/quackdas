/**
 * Quackdas - Import/Export Functions
 * Project and report export/import
 */

function newProject() {
    if (appData.documents.length > 0 || appData.codes.length > 0) {
        if (!confirm('This will clear all current data. Continue?')) {
            return;
        }
    }
    
    // Reset the project file handle in Electron so future saves prompt for file
    if (window.electronAPI && window.electronAPI.clearProjectHandle) {
        window.electronAPI.clearProjectHandle().catch(() => {});
    }
    
    history.past = [];
    history.future = [];
    updateHistoryButtons();
    
    appData = makeEmptyProject();
    appData.hasUnsavedChanges = false;
    appData.lastSaveTime = null;
    
    saveData();
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

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            if (typeof importFromQdpx !== 'function') {
                throw new Error('QDPX import not available');
            }
            
            if (appData.documents.length > 0 || appData.codes.length > 0) {
                if (!confirm('This will replace your current project. Continue?')) {
                    return;
                }
            }
            
            const imported = await importFromQdpx(e.target.result);
            appData = normaliseProject(imported);
            appData.lastSaveTime = new Date().toISOString();
            saveData({ markUnsaved: false });
            renderAll();
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
            
            if (appData.documents.length > 0 || appData.codes.length > 0) {
                if (!confirm('This will replace your current project. Continue?')) return;
            }
            
            if (res.kind !== 'qdpx') {
                throw new Error('Unsupported project format. Please choose a .qdpx file.');
            }
            // QDPX format - data is base64-encoded
            if (typeof importFromQdpx !== 'function') {
                throw new Error('QDPX import not available');
            }
            const buffer = base64ToArrayBuffer(res.data);
            const imported = await importFromQdpx(buffer);
            appData = normaliseProject(imported);
            
            appData.lastSaveTime = new Date().toISOString();
            saveData({ markUnsaved: false });
            renderAll();
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
async function applyImportedQdpx(buffer) {
    try {
        if (typeof importFromQdpx !== 'function') {
            throw new Error('QDPX import not available');
        }
        
        const imported = await importFromQdpx(buffer);
        const previousTheme = appData?.theme || 'light';
        
        appData = normaliseProject(imported);
        appData.theme = appData.theme || previousTheme;
        appData.hasUnsavedChanges = false;
        appData.lastSaveTime = new Date().toISOString();
        
        if (typeof rebuildIndexes === 'function') rebuildIndexes();
        if (typeof renderAll === 'function') renderAll();
        if (typeof updateSaveStatus === 'function') updateSaveStatus();
        
    } catch (error) {
        console.error('Error importing QDPX project:', error);
        alert('Error importing project: ' + error.message);
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
                : segment.text;
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
