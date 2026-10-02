(() => {
    'use strict';
    const script = document.currentScript;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function create(host, preview = false) {
        let enabled = false, canvas, context, frame = 0, lastTime = 0;
        let width = 0, height = 0, flakes = [];
        const observer = new ResizeObserver(resize);
        if (preview) observer.observe(host);

        function resize() {
            if (!canvas) return;
            width = preview ? host.clientWidth : window.innerWidth;
            height = preview ? host.clientHeight : window.innerHeight;
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.round(width * ratio));
            canvas.height = Math.max(1, Math.round(height * ratio));
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            flakes = Array.from({length: preview ? 18 : (width < 700 ? 30 : 55)}, () => ({
                x: Math.random() * width, y: Math.random() * height,
                radius: 1.3 + Math.random() * 2.3, speed: 18 + Math.random() * 26,
                phase: Math.random() * Math.PI * 2
            }));
        }

        function draw(time) {
            frame = requestAnimationFrame(draw);
            if (time - lastTime < 1000 / 30) return;
            const elapsed = Math.min((time - (lastTime || time)) / 1000, 0.06);
            lastTime = time;
            context.clearRect(0, 0, width, height);
            context.fillStyle = 'rgba(255, 255, 255, 0.9)';
            context.shadowColor = 'rgba(56, 74, 96, 0.35)';
            context.shadowBlur = 3;
            for (const flake of flakes) {
                flake.y += flake.speed * elapsed;
                flake.x += Math.sin(time / 1800 + flake.phase) * elapsed * 9;
                if (flake.y > height + 5) { flake.y = -5; flake.x = Math.random() * width; }
                context.beginPath();
                context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
                context.fill();
            }
        }

        function sync() {
            cancelAnimationFrame(frame);
            frame = 0;
            lastTime = 0;
            if (!enabled || reducedMotion.matches) {
                canvas?.remove();
                canvas = null;
                return;
            }
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.className = 'site-snowfall' + (preview ? ' site-snowfall-preview' : '');
                canvas.setAttribute('aria-hidden', 'true');
                context = canvas.getContext('2d');
                if (!context) { canvas = null; return; }
                host.appendChild(canvas);
                resize();
            }
            if (!document.hidden) frame = requestAnimationFrame(draw);
        }

        window.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', sync);
        reducedMotion.addEventListener('change', sync);
        return {
            setEnabled(value) { enabled = value === true; sync(); },
            destroy() {
                enabled = false;
                sync();
                observer.disconnect();
                window.removeEventListener('resize', resize);
                document.removeEventListener('visibilitychange', sync);
                reducedMotion.removeEventListener('change', sync);
            }
        };
    }

    window.BookshelfSnowfall = {create};
    const endpoint = script?.dataset.settingsUrl;
    if (!endpoint) return;
    fetch(endpoint, {credentials: 'same-origin', cache: 'no-store'})
        .then(response => response.ok ? response.json() : null)
        .then(settings => {
            if (settings?.snowfall_enabled === true) create(document.body).setEnabled(true);
        })
        .catch(() => { /* Decorative effects never block the page. */ });
})();
