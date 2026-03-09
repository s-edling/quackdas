(function(global) {
    function toSessionDate(date, rolloverHour) {
        const stamp = new Date(date.getTime());
        if (stamp.getHours() < rolloverHour) {
            stamp.setDate(stamp.getDate() - 1);
        }
        return stamp.toISOString().slice(0, 10);
    }

    function formatHeadingTimestamp(iso) {
        const date = new Date(iso);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }

    function evaluateSession(options) {
        const mode = options.mode || 'rollover';
        const nowIso = options.nowIso || new Date().toISOString();
        const now = new Date(nowIso);
        const rolloverHour = Number.isFinite(options.rolloverHour) ? options.rolloverHour : 4;
        const gapMinutes = Number.isFinite(options.gapMinutes) ? options.gapMinutes : 120;
        const prior = options.previousSession || null;
        const forceManual = !!options.forceManual;

        const sessionDate = toSessionDate(now, rolloverHour);
        let needsHeading = forceManual || !prior;

        if (!needsHeading && prior) {
            if (mode === 'rollover') {
                needsHeading = prior.sessionDate !== sessionDate;
            } else if (mode === 'gap') {
                const previousAt = Date.parse(prior.lastCaptureAt || '');
                const currentAt = Date.parse(nowIso);
                if (!Number.isFinite(previousAt) || !Number.isFinite(currentAt)) {
                    needsHeading = true;
                } else {
                    needsHeading = (currentAt - previousAt) > (gapMinutes * 60 * 1000);
                }
            }
        }

        return {
            sessionDate,
            sessionHeading: needsHeading,
            headingLabel: `${options.fieldsite || 'Fieldsite'} \u2014 ${formatHeadingTimestamp(nowIso)}`
        };
    }

    global.ObserverSession = {
        evaluateSession,
        toSessionDate,
        formatHeadingTimestamp
    };
})(this);
