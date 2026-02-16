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
    projectFileHandle = null;
    
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

async function exportProject() {
    // Export as QDPX format
    try {
        if (typeof exportToQdpx !== 'function') {
            throw new Error('QDPX export not available');
        }
        
        const blob = await exportToQdpx();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${appData.projectName || 'quackdas-project'}-${new Date().toISOString().split('T')[0]}.qdpx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Export failed:', err);
        alert('Export failed: ' + (err?.message || err));
    }
}

// Legacy JSON export for backwards compatibility
function exportProjectAsJson() {
    // Create a copy without pdfData to reduce size
    const exportData = JSON.parse(JSON.stringify(appData));
    exportData.documents.forEach(doc => {
        if (doc.pdfData) {
            delete doc.pdfData;
            delete doc.pdfPages;
            delete doc.pdfTextPositions;
        }
    });
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quackdas-project-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function importProject(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.qdpx')) {
        // QDPX format
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
                saveData();
                renderAll();
                alert('Project imported successfully!');
            } catch (error) {
                console.error('Import error:', error);
                alert('Error importing project: ' + error.message);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        // Legacy JSON format
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                
                // Validate the imported data structure
                if (!imported.documents || !imported.codes || !imported.segments) {
                    throw new Error('Invalid project file format');
                }

                if (appData.documents.length > 0 || appData.codes.length > 0) {
                    if (!confirm('This will replace your current project. Continue?')) {
                        return;
                    }
                }

                appData = normaliseProject(imported);
                saveData();
                renderAll();
                alert('Project imported successfully!');
            } catch (error) {
                alert('Error importing project: ' + error.message);
            }
        };
        reader.readAsText(file);
    }
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
            
            if (res.kind === 'qdpx') {
                // QDPX format - data is base64-encoded
                if (typeof importFromQdpx !== 'function') {
                    throw new Error('QDPX import not available');
                }
                const buffer = base64ToArrayBuffer(res.data);
                const imported = await importFromQdpx(buffer);
                appData = normaliseProject(imported);
            } else {
                // Legacy JSON format
                const imported = JSON.parse(res.data);
                appData = normaliseProject(imported);
            }
            
            saveData();
            renderAll();
            alert('Project imported successfully!');
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

// Electron helper: apply a parsed project object (used by native Open Project).
function applyImportedProject(imported) {
    try {
        if (!imported || typeof imported !== 'object') {
            throw new Error('Invalid project file format');
        }

        const previousTheme = appData?.theme || 'light';

        appData = normaliseProject(imported);
        appData.theme = appData.theme || previousTheme;

        appData.hasUnsavedChanges = false;
        appData.lastSaveTime = new Date().toISOString();

        if (typeof rebuildIndexes === 'function') rebuildIndexes();
        if (typeof renderAll === 'function') renderAll();
        if (typeof updateSaveStatus === 'function') updateSaveStatus();

    } catch (error) {
        console.error('Error importing project:', error);
        alert('Error importing project: ' + error.message);
    }
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
            report += `**${i + 1}. From: ${doc.title}**`;
            report += `\n\n`;
            report += `> ${segment.text}\n\n`;
            
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
