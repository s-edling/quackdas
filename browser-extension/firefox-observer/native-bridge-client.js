(function(global) {
    async function request(pathname, settings, options) {
        const normalized = global.ObserverStorage.normalizeSettings(settings);
        const serverUrl = normalized.serverUrl;
        const authToken = normalized.authToken;
        if (!serverUrl) {
            throw new Error('Quackdas server URL is missing.');
        }
        if (!authToken) {
            throw new Error('Quackdas auth token is missing.');
        }

        let response;
        const requestOptions = Object.assign({}, options || {});
        const mergedHeaders = Object.assign({}, requestOptions.headers || {}, {
            Authorization: `Bearer ${authToken}`
        });
        requestOptions.headers = mergedHeaders;
        try {
            response = await fetch(`${serverUrl}${pathname}`, requestOptions);
        } catch (error) {
            throw new Error('Could not reach Quackdas on localhost. Make sure Quackdas is running and the server URL is correct.');
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (!response.ok) {
            const message = payload && payload.error ? payload.error : `Request failed (${response.status}).`;
            throw new Error(message);
        }
        return payload || { ok: true };
    }

    async function getStatus(settings) {
        return request('/api/status', settings, { method: 'GET' });
    }

    async function listFieldsites(settings) {
        return request('/api/fieldsites', settings, { method: 'GET' });
    }

    async function getFieldsiteHistory(settings, fieldsite) {
        const encodedFieldsite = encodeURIComponent(String(fieldsite || '').trim());
        return request(`/api/history?fieldsite=${encodedFieldsite}`, settings, { method: 'GET' });
    }

    async function submitObservation(settings, observation) {
        return request('/api/observation', settings, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(observation || {})
        });
    }

    async function deleteObservation(settings, payload) {
        return request('/api/observation/delete', settings, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload || {})
        });
    }

    global.ObserverConnectionClient = {
        deleteObservation,
        getFieldsiteHistory,
        getStatus,
        listFieldsites,
        submitObservation
    };
})(this);
