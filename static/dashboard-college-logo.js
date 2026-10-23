/* Refined pencil artwork with the approved, reversible colour bloom. */
(() => {
    const button = document.querySelector('.dashboard-college-logo');
    if (!button) return;

    const canvas = button.querySelector('.college-canvas');
    const pencilImage = button.querySelector('.college-pencil');
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // The static pencil image remains visible without canvas.

    const desktop = window.matchMedia('(min-width: 821px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const size = canvas.width;
    const durationMs = 2400;
    const clamp = value => Math.max(0, Math.min(1, value));
    const makeLayer = () => {
        const layer = document.createElement('canvas');
        layer.width = layer.height = size;
        return layer;
    };
    const original = makeLayer(), pencil = makeLayer(), mask = makeLayer();
    const colour = makeLayer(), strokes = makeLayer();
    const originalCtx = original.getContext('2d'), pencilCtx = pencil.getContext('2d');
    const maskCtx = mask.getContext('2d'), colourCtx = colour.getContext('2d');
    const strokesCtx = strokes.getContext('2d');
    if (![originalCtx, pencilCtx, maskCtx, colourCtx, strokesCtx].every(Boolean)) return;

    const colourImage = new Image();
    let requested = false, ready = false, hovered = false, focused = false, pinned = false;
    let progress = 0, target = 0, velocity = 0, frame = null, lastTime = 0;
    let lastPointer = 'mouse';
    let origin = { x: .28 * size, y: .25 * size };

    function paint() {
        if (!ready) return;
        ctx.clearRect(0, 0, size, size);
        if (progress <= .0001) { ctx.drawImage(pencil, 0, 0); return; }
        if (progress >= .9999) { ctx.drawImage(original, 0, 0); return; }

        maskCtx.clearRect(0, 0, size, size);
        const radius = Math.max(1, progress * size * 1.95);
        const bloom = maskCtx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, radius);
        bloom.addColorStop(0, 'rgba(255,255,255,1)');
        bloom.addColorStop(.62, 'rgba(255,255,255,1)');
        bloom.addColorStop(.86, 'rgba(255,255,255,.45)');
        bloom.addColorStop(1, 'rgba(255,255,255,0)');
        maskCtx.globalAlpha = progress;
        maskCtx.fillStyle = bloom;
        maskCtx.fillRect(0, 0, size, size);
        maskCtx.globalAlpha = 1;

        strokesCtx.clearRect(0, 0, size, size);
        strokesCtx.drawImage(pencil, 0, 0);
        strokesCtx.globalCompositeOperation = 'destination-out';
        strokesCtx.drawImage(mask, 0, 0);
        strokesCtx.globalCompositeOperation = 'source-over';

        colourCtx.clearRect(0, 0, size, size);
        colourCtx.drawImage(original, 0, 0);
        colourCtx.globalCompositeOperation = 'destination-in';
        colourCtx.drawImage(mask, 0, 0);
        colourCtx.globalCompositeOperation = 'source-over';
        ctx.drawImage(strokes, 0, 0);
        ctx.drawImage(colour, 0, 0);
    }

    function stop() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        lastTime = 0;
    }

    function finish() {
        progress = target;
        velocity = lastTime = 0;
        paint();
        button.dataset.state = target ? 'colour' : 'pencil';
    }

    function tick(time) {
        frame = null;
        const dt = Math.min((time - (lastTime || time - 16.7)) / 1000, .032);
        lastTime = time;
        const duration = (target ? durationMs : durationMs * .8) / 1000;
        const omega = 8.5 / duration, steps = Math.ceil(dt / .008), step = dt / steps;
        // Preserve velocity when the pointer reverses direction partway through.
        for (let i = 0; i < steps; i++) {
            velocity += (omega * omega * (target - progress) - 2 * omega * velocity) * step;
            progress = clamp(progress + velocity * step);
        }
        paint();
        if (Math.abs(target - progress) > .0003 || Math.abs(velocity) > .002) {
            frame = requestAnimationFrame(tick);
        } else finish(); // No animation work while the logo is idle.
    }

    function update() {
        target = desktop.matches && (hovered || focused || pinned) ? 1 : 0;
        button.setAttribute('aria-pressed', String(pinned));
        if (!ready) return;
        if (reduced.matches || document.hidden || !desktop.matches) { stop(); finish(); return; }
        if (Math.abs(target - progress) < .0001 && Math.abs(velocity) < .002) { finish(); return; }
        button.dataset.state = target ? 'revealing' : 'restoring';
        if (frame === null) frame = requestAnimationFrame(tick);
    }

    function prepare() {
        if (ready || !desktop.matches || !pencilImage.naturalWidth || !colourImage.naturalWidth) return;
        originalCtx.drawImage(colourImage, 0, 0, size, size);
        pencilCtx.drawImage(pencilImage, 0, 0, size, size);
        ready = true;
        paint();
        button.classList.add('is-ready');
        update();
    }

    function initialize() {
        if (!desktop.matches) return;
        if (!requested) {
            requested = true;
            colourImage.src = button.dataset.colourSrc;
        }
        prepare();
    }

    button.addEventListener('pointerenter', event => {
        lastPointer = event.pointerType;
        if (event.pointerType === 'touch') return;
        if (progress < .01) {
            const rect = button.getBoundingClientRect();
            origin = {
                x: clamp((event.clientX - rect.left) / rect.width) * size,
                y: clamp((event.clientY - rect.top) / rect.height) * size
            };
        }
        hovered = true;
        update();
    });
    button.addEventListener('pointerleave', () => { hovered = false; update(); });
    button.addEventListener('pointercancel', () => { hovered = false; update(); });
    button.addEventListener('pointerdown', event => { lastPointer = event.pointerType; });
    button.addEventListener('focus', () => { focused = button.matches(':focus-visible'); update(); });
    button.addEventListener('blur', () => { focused = false; update(); });
    button.addEventListener('click', event => {
        if (lastPointer === 'touch' || event.detail === 0) pinned = !pinned;
        update();
    });
    window.addEventListener('blur', () => { hovered = focused = false; update(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { hovered = focused = false; update(); }
    });
    reduced.addEventListener('change', update);
    desktop.addEventListener('change', () => {
        if (desktop.matches) initialize();
        else hovered = focused = pinned = false;
        update();
    });
    pencilImage.addEventListener('load', prepare);
    colourImage.addEventListener('load', prepare);
    colourImage.addEventListener('error', () => { button.dataset.state = 'unavailable'; });
    initialize();
})();
