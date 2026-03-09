(function() {
    if (window.__quackdasObserverInjected) return;
    window.__quackdasObserverInjected = true;

    browser.runtime.onMessage.addListener(async (message) => {
        if (!message || typeof message !== 'object') return undefined;
        if (message.type === 'observer:getPageContext') {
            return getPageContext();
        }
        if (message.type === 'observer:beginRegionSelection') {
            return beginRegionSelection();
        }
        return undefined;
    });

    function getPageContext() {
        return {
            url: window.location.href,
            title: document.title || window.location.href,
            html: document.documentElement ? document.documentElement.outerHTML : '',
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1
        };
    }

    function beginRegionSelection() {
        return new Promise((resolve) => {
            const existing = document.getElementById('quackdas-observer-overlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'quackdas-observer-overlay';
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.zIndex = '2147483646';
            overlay.style.cursor = 'crosshair';
            overlay.style.background = 'rgba(42, 37, 32, 0.15)';

            const box = document.createElement('div');
            box.style.position = 'absolute';
            box.style.border = '2px solid #c17a5c';
            box.style.background = 'rgba(193, 122, 92, 0.14)';
            box.style.pointerEvents = 'none';
            overlay.appendChild(box);

            const hint = document.createElement('div');
            hint.textContent = 'Drag to capture. Esc to cancel.';
            hint.style.position = 'fixed';
            hint.style.top = '16px';
            hint.style.right = '16px';
            hint.style.padding = '8px 12px';
            hint.style.background = '#ffffff';
            hint.style.border = '1px solid #ddd8d0';
            hint.style.color = '#2a2520';
            hint.style.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            overlay.appendChild(hint);

            let startX = 0;
            let startY = 0;
            let dragging = false;

            function cleanup(result) {
                document.removeEventListener('keydown', onKeyDown, true);
                overlay.remove();
                resolve(result);
            }

            function onKeyDown(event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup({ cancelled: true });
                }
            }

            overlay.addEventListener('mousedown', (event) => {
                dragging = true;
                startX = event.clientX;
                startY = event.clientY;
                updateBox(event.clientX, event.clientY);
                event.preventDefault();
            });

            overlay.addEventListener('mousemove', (event) => {
                if (!dragging) return;
                updateBox(event.clientX, event.clientY);
            });

            overlay.addEventListener('mouseup', (event) => {
                if (!dragging) return;
                dragging = false;
                const rect = normalizeRect(startX, startY, event.clientX, event.clientY);
                if (rect.width < 8 || rect.height < 8) {
                    cleanup({ cancelled: true });
                    return;
                }
                cleanup({
                    cancelled: false,
                    rect,
                    page: getPageContext()
                });
            });

            function updateBox(currentX, currentY) {
                const rect = normalizeRect(startX, startY, currentX, currentY);
                box.style.left = `${rect.left}px`;
                box.style.top = `${rect.top}px`;
                box.style.width = `${rect.width}px`;
                box.style.height = `${rect.height}px`;
            }

            document.addEventListener('keydown', onKeyDown, true);
            document.documentElement.appendChild(overlay);
        });
    }

    function normalizeRect(x1, y1, x2, y2) {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        return { left, top, width, height };
    }
})();
