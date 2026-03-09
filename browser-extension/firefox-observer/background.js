const tabSessionState = new Map();

browser.runtime.onMessage.addListener(async (message) => {
    if (!message || typeof message !== 'object') return undefined;

    if (message.type === 'observer:captureRegion') {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
            throw new Error('No active tab available for capture.');
        }
        await browser.tabs.executeScript(tab.id, { file: 'content-script.js' });
        const selection = await browser.tabs.sendMessage(tab.id, { type: 'observer:beginRegionSelection' });
        if (!selection || !selection.rect || selection.cancelled) {
            return { ok: false, cancelled: true };
        }

        const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        return {
            ok: true,
            page: selection.page,
            selection,
            captureDataUrl: dataUrl
        };
    }

    if (message.type === 'observer:getPageContext') {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
            throw new Error('No active tab available.');
        }
        await browser.tabs.executeScript(tab.id, { file: 'content-script.js' });
        const page = await browser.tabs.sendMessage(tab.id, { type: 'observer:getPageContext' });
        return { ok: true, page };
    }

    if (message.type === 'observer:getTabSessionState') {
        return getTabState(message.tabId);
    }

    if (message.type === 'observer:setTabSessionState') {
        const next = {
            lastUrl: message.lastUrl || '',
            lastCaptureAt: message.lastCaptureAt || '',
            navigationId: message.navigationId || '',
            metadataSeenForPage: !!message.metadataSeenForPage
        };
        tabSessionState.set(message.tabId, next);
        return { ok: true };
    }

    return undefined;
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tabId || !changeInfo) return;
    const state = tabSessionState.get(tabId) || {};
    if (changeInfo.status === 'loading' || (changeInfo.url && changeInfo.url !== state.lastUrl)) {
        tabSessionState.set(tabId, {
            lastUrl: changeInfo.url || tab.url || '',
            lastCaptureAt: state.lastCaptureAt || '',
            navigationId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            metadataSeenForPage: false
        });
    }
});

browser.tabs.onRemoved.addListener((tabId) => {
    tabSessionState.delete(tabId);
});

async function getActiveTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
}

function getTabState(tabId) {
    if (!tabId) return { ok: true, state: null };
    const state = tabSessionState.get(tabId) || null;
    return { ok: true, state };
}
