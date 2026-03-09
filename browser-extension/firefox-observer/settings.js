(function() {
    const defaults = ObserverStorage.DEFAULT_SETTINGS;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        const settings = ObserverStorage.normalizeSettings(await ObserverStorage.get(ObserverStorage.KEYS.settings, defaults));
        document.getElementById('serverUrlInput').value = settings.serverUrl || '';
        document.getElementById('authTokenInput').value = settings.authToken || '';
        document.getElementById('sessionModeSelect').value = settings.sessionMode || 'rollover';
        document.getElementById('rolloverHourInput').value = Number.isFinite(settings.rolloverHour) ? settings.rolloverHour : 4;

        document.getElementById('applyConfigButton').addEventListener('click', onApplyConfig);
        document.getElementById('saveSettingsButton').addEventListener('click', onSave);
        document.getElementById('validateSettingsButton').addEventListener('click', onValidate);
    }

    async function onSave() {
        const current = ObserverStorage.normalizeSettings(await ObserverStorage.get(ObserverStorage.KEYS.settings, defaults));
        const next = readForm(current);
        await ObserverStorage.set(ObserverStorage.KEYS.settings, next);
        showStatus('Settings saved.', 'success');
    }

    async function onValidate() {
        const next = readForm();
        if (!next.serverUrl || !next.authToken) {
            showStatus('Enter or paste the Quackdas server URL and auth token first.', 'error');
            return;
        }
        try {
            const result = await ObserverConnectionClient.getStatus(next);
            const suffix = result.hasActiveProject
                ? ` Saved project: ${result.activeProjectFileName || result.activeProjectPath || 'unknown'}.`
                : ' Quackdas is reachable, but no saved project is open.';
            showStatus(`Connected to Quackdas at ${result.serverUrl || next.serverUrl}.${suffix}`, 'success');
        } catch (err) {
            showStatus(err && err.message ? err.message : 'Could not reach Quackdas.', 'error');
        }
    }

    async function onApplyConfig() {
        const input = document.getElementById('configInput').value.trim();
        if (!input) {
            showStatus('Paste the Quackdas config JSON first.', 'error');
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(input);
        } catch (_) {
            showStatus('Quackdas config must be valid JSON.', 'error');
            return;
        }
        const merged = ObserverStorage.normalizeSettings(Object.assign({}, readForm(), {
            serverUrl: parsed.serverUrl,
            authToken: parsed.authToken
        }));
        document.getElementById('serverUrlInput').value = merged.serverUrl || '';
        document.getElementById('authTokenInput').value = merged.authToken || '';
        await ObserverStorage.set(ObserverStorage.KEYS.settings, merged);
        showStatus('Quackdas config applied.', 'success');
    }

    function readForm(current) {
        return ObserverStorage.normalizeSettings({
            serverUrl: document.getElementById('serverUrlInput').value.trim(),
            authToken: document.getElementById('authTokenInput').value.trim(),
            sessionMode: document.getElementById('sessionModeSelect').value,
            rolloverHour: Number.parseInt(document.getElementById('rolloverHourInput').value, 10) || 4,
            storedFieldsites: Array.isArray(current && current.storedFieldsites) ? current.storedFieldsites : []
        });
    }

    function showStatus(message, status) {
        const banner = document.getElementById('settingsStatus');
        banner.hidden = !message;
        banner.innerHTML = '';
        banner.dataset.status = status || '';
        if (!message) return;
        const text = document.createElement('div');
        text.className = 'status-banner-message';
        text.textContent = message;
        banner.appendChild(text);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'status-banner-close';
        close.setAttribute('aria-label', 'Dismiss message');
        close.textContent = '×';
        close.addEventListener('click', () => showStatus('', ''));
        banner.appendChild(close);
    }
})();
