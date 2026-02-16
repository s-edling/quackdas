/**
 * Quackdas - Memo Functions
 * Analytical memos for codes, documents, and segments
 */

// Current memo target
let currentMemoTarget = { type: null, id: null };

function openMemoModal(type, targetId, event) {
    if (event) event.stopPropagation();
    
    currentMemoTarget = { type, id: targetId };
    const modal = document.getElementById('memoModal');
    const titleEl = document.getElementById('memoModalTitle');
    const existingList = document.getElementById('existingMemosList');
    
    // Set title based on type
    const targetName = type === 'code' ? appData.codes.find(c => c.id === targetId)?.name :
                       type === 'document' ? appData.documents.find(d => d.id === targetId)?.title :
                       'Segment';
    titleEl.textContent = `Memos for ${targetName}`;
    
    // Show existing memos
    const memos = appData.memos.filter(m => m.type === type && m.targetId === targetId);
    if (memos.length > 0) {
        existingList.style.display = 'block';
        existingList.innerHTML = '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Existing Memos:</div>' +
            memos.map(memo => `
                <div class="memo-item">
                    <div class="memo-item-header">
                        <span>${new Date(memo.created).toLocaleDateString()}</span>
                        <button class="memo-delete-btn" onclick="deleteMemo('${memo.id}')">×</button>
                    </div>
                    <div class="memo-item-content">${escapeHtml(memo.content)}</div>
                </div>
            `).join('');
    } else {
        existingList.style.display = 'none';
    }
    
    modal.classList.add('show');
}

function closeMemoModal() {
    document.getElementById('memoModal').classList.remove('show');
    document.getElementById('memoContent').value = '';
    currentMemoTarget = { type: null, id: null };
}

function saveMemo(e) {
    e.preventDefault();
    const content = document.getElementById('memoContent').value;
    
    if (!content.trim()) return;
    
    saveHistory();
    
    const memo = {
        id: 'memo_' + Date.now(),
        type: currentMemoTarget.type,
        targetId: currentMemoTarget.id,
        content: content,
        created: new Date().toISOString()
    };
    
    appData.memos.push(memo);
    saveData();
    renderAll();
    
    // Refresh the modal to show the new memo
    openMemoModal(currentMemoTarget.type, currentMemoTarget.id);
    document.getElementById('memoContent').value = '';
}

function deleteMemo(memoId) {
    if (!confirm('Delete this memo?')) return;
    
    saveHistory();
    appData.memos = appData.memos.filter(m => m.id !== memoId);
    saveData();
    
    // Refresh the modal
    openMemoModal(currentMemoTarget.type, currentMemoTarget.id);
}
