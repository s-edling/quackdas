(function(global) {
    function dataUrlToBase64(dataUrl) {
        const match = String(dataUrl || '').match(/^data:.*?;base64,(.+)$/);
        return match ? match[1] : '';
    }

    async function cropVisibleCapture(dataUrl, rect) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = function() {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(rect.width));
                    canvas.height = Math.max(1, Math.round(rect.height));
                    const context = canvas.getContext('2d');
                    context.drawImage(
                        image,
                        Math.round(rect.left),
                        Math.round(rect.top),
                        Math.round(rect.width),
                        Math.round(rect.height),
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );
                    resolve(canvas.toDataURL('image/png'));
                } catch (err) {
                    reject(err);
                }
            };
            image.onerror = reject;
            image.src = dataUrl;
        });
    }

    global.ObserverCapture = {
        cropVisibleCapture,
        dataUrlToBase64
    };
})(this);
