(function(global) {
    function normalizeFieldsiteName(value) {
        return String(value || '').trim().replace(/\s+/g, ' ');
    }

    function mergeFieldsites(stored, projectDerived) {
        const merged = new Set();
        (Array.isArray(stored) ? stored : []).forEach((name) => {
            const normalized = normalizeFieldsiteName(name);
            if (normalized) merged.add(normalized);
        });
        (Array.isArray(projectDerived) ? projectDerived : []).forEach((name) => {
            const normalized = normalizeFieldsiteName(name);
            if (normalized) merged.add(normalized);
        });
        return Array.from(merged).sort((a, b) => a.localeCompare(b));
    }

    global.ObserverFieldsites = {
        normalizeFieldsiteName,
        mergeFieldsites
    };
})(this);
