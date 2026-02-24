/**
 * Quackdas - Memo Functions
 * Analytical annotations for codes, documents, and segments
 */

// Current memo target
let currentMemoTarget = { type: null, id: null };
let currentEditingMemoId = null;

function normaliseMemoMetadata(memo) {
    if (!memo || typeof memo !== 'object') return memo;
    if (!memo.created) memo.created = new Date().toISOString();
    if (!memo.edited) memo.edited = memo.created;
    if (typeof memo.tag !== 'string') memo.tag = '';
    memo.tag = memo.tag.trim().slice(0, 40);
    return memo;
}

function formatMemoDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
}

function renderExistingMemos(type, targetId) {
    const existingList = document.getElementById('existingMemosList');
    if (!existingList) return;

    const memos = appData.memos
        .filter(m => m.type === type && m.targetId === targetId)
        .map(normaliseMemoMetadata)
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    if (memos.length > 0) {
        existingList.style.display = 'block';
        existingList.innerHTML = '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Existing annotations:</div>' +
            memos.map(memo => {
                const memoCodeId = memo.type === 'segment' ? String(memo.codeId || '').trim() : '';
                const memoCode = memoCodeId ? appData.codes.find(c => c.id === memoCodeId) : null;
                const memoCodeLabel = memoCode ? memoCode.name : memoCodeId;
                return `
                <div class="memo-item">
                    <div class="memo-item-header">
                        <span>${escapeHtml(formatMemoDate(memo.created))}${memo.edited && memo.edited !== memo.created ? ` · edited ${escapeHtml(formatMemoDate(memo.edited))}` : ''}</span>
                        <span>
                            <button class="memo-delete-btn" data-action="editMemo" data-memo-id="${escapeHtmlAttrValue(memo.id)}" title="Edit annotation">✎</button>
                            <button class="memo-delete-btn" data-action="deleteMemo" data-memo-id="${escapeHtmlAttrValue(memo.id)}" title="Delete annotation">×</button>
                        </span>
                    </div>
                    ${memoCodeLabel ? `<div class="memo-tag-badge">Code: ${escapeHtml(memoCodeLabel)}</div>` : ''}
                    ${memo.tag ? `<div class="memo-tag-badge">${escapeHtml(memo.tag)}</div>` : ''}
                    <div class="memo-item-content">${escapeHtml(memo.content)}</div>
                </div>
            `;
            }).join('');
    } else {
        existingList.style.display = 'none';
    }
}

function openMemoModal(type, targetId, event) {
    if (event) event.stopPropagation();
    
    currentMemoTarget = { type, id: targetId };
    currentEditingMemoId = null;
    const modal = document.getElementById('memoModal');
    const titleEl = document.getElementById('memoModalTitle');
    
    // Set title based on type
    const targetName = type === 'code' ? appData.codes.find(c => c.id === targetId)?.name :
                       type === 'document' ? appData.documents.find(d => d.id === targetId)?.title :
                       'Segment';
    titleEl.textContent = `Annotations for ${targetName}`;

    document.getElementById('memoContent').value = '';
    document.getElementById('memoTag').value = '';
    renderExistingMemos(type, targetId);
    
    modal.classList.add('show');
}

function closeMemoModal() {
    document.getElementById('memoModal').classList.remove('show');
    document.getElementById('memoContent').value = '';
    document.getElementById('memoTag').value = '';
    currentEditingMemoId = null;
    currentMemoTarget = { type: null, id: null };
}

function editMemo(memoId) {
    const memo = appData.memos.find(m => m.id === memoId);
    if (!memo) return;
    normaliseMemoMetadata(memo);
    currentEditingMemoId = memoId;
    document.getElementById('memoContent').value = memo.content || '';
    document.getElementById('memoTag').value = memo.tag || '';
    const input = document.getElementById('memoContent');
    if (input) input.focus();
}

function saveMemo(e) {
    e.preventDefault();
    const content = document.getElementById('memoContent').value;
    const tag = (document.getElementById('memoTag').value || '').trim().slice(0, 40);
    
    if (!content.trim()) return;
    
    saveHistory();

    if (currentEditingMemoId) {
        const memo = appData.memos.find(m => m.id === currentEditingMemoId);
        if (memo) {
            normaliseMemoMetadata(memo);
            memo.content = content;
            memo.tag = tag;
            memo.edited = new Date().toISOString();
        }
    } else {
        const memo = normaliseMemoMetadata({
            id: 'memo_' + Date.now(),
            type: currentMemoTarget.type,
            targetId: currentMemoTarget.id,
            content: content,
            tag: tag,
            created: new Date().toISOString()
        });
        appData.memos.push(memo);
    }

    saveData();
    renderAll();
    closeMemoModal();
}

function deleteMemo(memoId) {
    if (!confirm('Delete this annotation?')) return;
    
    saveHistory();
    appData.memos = appData.memos.filter(m => m.id !== memoId);
    saveData();

    // Keep marker gutters and memo indicators in sync immediately.
    renderDocuments();
    renderCodes();
    renderCurrentDocument();

    // Refresh the modal list
    renderExistingMemos(currentMemoTarget.type, currentMemoTarget.id);
}

function initMemoModalEnterToSave() {
    const input = document.getElementById('memoContent');
    if (!input || input.dataset.enterSaveInit === '1') return;

    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        if (currentMemoTarget.type !== 'segment') return;
        e.preventDefault();
        const form = document.getElementById('memoForm');
        if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit();
        } else if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
    });

    input.dataset.enterSaveInit = '1';
}

document.addEventListener('DOMContentLoaded', initMemoModalEnterToSave);
