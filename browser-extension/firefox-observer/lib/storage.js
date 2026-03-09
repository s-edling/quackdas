(function(global) {
    const KEYS = {
        settings: 'quackdasObserver.settings',
        fieldsiteHistory: 'quackdasObserver.fieldsiteHistory',
        entries: 'quackdasObserver.entries',
        lastSession: 'quackdasObserver.lastSession'
    };

    const DEFAULT_SETTINGS = {
        serverUrl: 'http://127.0.0.1:45823',
        authToken: '',
        sessionMode: 'rollover',
        rolloverHour: 4,
        storedFieldsites: [],
        lastFieldsite: ''
    };

    async function get(key, fallbackValue) {
        const result = await browser.storage.local.get(key);
        return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : fallbackValue;
    }

    async function set(key, value) {
        await browser.storage.local.set({ [key]: value });
        return value;
    }

    async function remove(key) {
        await browser.storage.local.remove(key);
    }

    function normalizeServerUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return DEFAULT_SETTINGS.serverUrl;
        return raw.replace(/\/+$/, '');
    }

    function normalizeFieldsiteName(value) {
        return String(value || '').trim().replace(/\s+/g, ' ');
    }

    function normalizeFieldsiteEntry(rawEntry) {
        const entry = (rawEntry && typeof rawEntry === 'object') ? rawEntry : {};
        return {
            uuid: String(entry.uuid || '').trim(),
            fieldsite: normalizeFieldsiteName(entry.fieldsite || ''),
            url: String(entry.url || '').trim(),
            pageTitle: String(entry.pageTitle || '').trim(),
            timestamp: String(entry.timestamp || '').trim(),
            note: String(entry.note || ''),
            imageDataUrl: String(entry.imageDataUrl || '').trim(),
            noteDirty: !!entry.noteDirty,
            metadataVisible: !!entry.metadataVisible,
            html: String(entry.html || ''),
            sessionDate: String(entry.sessionDate || '').trim(),
            sessionStartedAt: String(entry.sessionStartedAt || '').trim(),
            sessionHeading: !!entry.sessionHeading,
            sessionNumber: Number.isFinite(Number(entry.sessionNumber)) ? Number(entry.sessionNumber) : 1,
            sessionHeadingLabel: String(entry.sessionHeadingLabel || '').trim()
        };
    }

    function normalizeLastSession(rawSession) {
        if (!rawSession || typeof rawSession !== 'object') return null;
        const sessionStartedAt = String(rawSession.sessionStartedAt || '').trim();
        const sessionDate = String(rawSession.sessionDate || '').trim();
        const lastCaptureAt = String(rawSession.lastCaptureAt || '').trim();
        const sessionNumber = Number.isFinite(Number(rawSession.sessionNumber)) ? Number(rawSession.sessionNumber) : 1;
        if (!sessionStartedAt && !sessionDate && !lastCaptureAt) return null;
        return {
            sessionDate,
            lastCaptureAt,
            sessionStartedAt,
            sessionNumber
        };
    }

    function normalizeFieldsiteHistoryRecord(rawRecord, fallbackFieldsite) {
        const record = (rawRecord && typeof rawRecord === 'object') ? rawRecord : {};
        const fieldsite = normalizeFieldsiteName(record.fieldsite || fallbackFieldsite || '');
        const entries = Array.isArray(record.entries) ? record.entries.map(normalizeFieldsiteEntry) : [];
        const lastSession = normalizeLastSession(record.lastSession);
        const activeSessionStartedAt = String(record.activeSessionStartedAt || '').trim() || (lastSession ? lastSession.sessionStartedAt : '');
        return {
            fieldsite,
            entries: entries.filter((entry) => !fieldsite || !entry.fieldsite || entry.fieldsite === fieldsite)
                .map((entry) => fieldsite ? Object.assign({}, entry, { fieldsite }) : entry),
            lastSession,
            activeSessionStartedAt
        };
    }

    function normalizeFieldsiteHistoryMap(rawMap) {
        const input = (rawMap && typeof rawMap === 'object') ? rawMap : {};
        const normalized = {};
        Object.keys(input).forEach((rawKey) => {
            const key = normalizeFieldsiteName(rawKey);
            if (!key) return;
            normalized[key] = normalizeFieldsiteHistoryRecord(input[rawKey], key);
        });
        return normalized;
    }

    function buildLegacyFieldsiteHistory(entries, lastSession) {
        const normalizedEntries = Array.isArray(entries) ? entries.map(normalizeFieldsiteEntry) : [];
        const grouped = {};
        normalizedEntries.forEach((entry) => {
            const fieldsite = normalizeFieldsiteName(entry.fieldsite || '');
            if (!fieldsite) return;
            if (!grouped[fieldsite]) {
                grouped[fieldsite] = normalizeFieldsiteHistoryRecord({ fieldsite, entries: [] }, fieldsite);
            }
            grouped[fieldsite].entries.push(Object.assign({}, entry, { fieldsite }));
        });

        const normalizedLastSession = normalizeLastSession(lastSession);
        if (normalizedLastSession && normalizedEntries.length > 0) {
            const lastEntry = normalizedEntries[normalizedEntries.length - 1];
            const fieldsite = normalizeFieldsiteName(lastEntry.fieldsite || '');
            if (fieldsite) {
                if (!grouped[fieldsite]) {
                    grouped[fieldsite] = normalizeFieldsiteHistoryRecord({ fieldsite, entries: [] }, fieldsite);
                }
                grouped[fieldsite].lastSession = normalizedLastSession;
                grouped[fieldsite].activeSessionStartedAt = normalizedLastSession.sessionStartedAt || grouped[fieldsite].activeSessionStartedAt;
            }
        }

        return normalizeFieldsiteHistoryMap(grouped);
    }

    async function getFieldsiteHistoryMap() {
        const result = await browser.storage.local.get([
            KEYS.fieldsiteHistory,
            KEYS.entries,
            KEYS.lastSession
        ]);
        if (Object.prototype.hasOwnProperty.call(result, KEYS.fieldsiteHistory)) {
            return normalizeFieldsiteHistoryMap(result[KEYS.fieldsiteHistory]);
        }

        const migrated = buildLegacyFieldsiteHistory(result[KEYS.entries], result[KEYS.lastSession]);
        if (Object.keys(migrated).length > 0) {
            await browser.storage.local.set({ [KEYS.fieldsiteHistory]: migrated });
        }
        if (
            Object.prototype.hasOwnProperty.call(result, KEYS.entries) ||
            Object.prototype.hasOwnProperty.call(result, KEYS.lastSession)
        ) {
            await browser.storage.local.remove([KEYS.entries, KEYS.lastSession]);
        }
        return migrated;
    }

    async function setFieldsiteHistoryMap(value) {
        const normalized = normalizeFieldsiteHistoryMap(value);
        await browser.storage.local.set({ [KEYS.fieldsiteHistory]: normalized });
        return normalized;
    }

    function normalizeSettings(settings) {
        const next = Object.assign({}, DEFAULT_SETTINGS, settings || {});
        next.serverUrl = normalizeServerUrl(next.serverUrl);
        next.authToken = String(next.authToken || '').trim();
        next.sessionMode = next.sessionMode || 'rollover';
        next.rolloverHour = Number.isFinite(next.rolloverHour) ? next.rolloverHour : 4;
        next.storedFieldsites = Array.isArray(next.storedFieldsites) ? next.storedFieldsites : [];
        next.lastFieldsite = normalizeFieldsiteName(next.lastFieldsite || '');
        return next;
    }

    global.ObserverStorage = {
        DEFAULT_SETTINGS,
        KEYS,
        get,
        getFieldsiteHistoryMap,
        normalizeServerUrl,
        normalizeFieldsiteHistoryMap,
        normalizeFieldsiteName,
        normalizeSettings,
        set,
        setFieldsiteHistoryMap,
        remove
    };
})(this);
