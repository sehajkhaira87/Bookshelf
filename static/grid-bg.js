(function () {
    const canvas = document.getElementById('grid-bg-canvas');
    const page2 = document.querySelector('.page2');
    if (!canvas || !page2) return;

    const ctx = canvas.getContext('2d');

    const SPACING = 34;
    const RADIUS = 130;
    const MAXSCALE = 1.32;
    const STEPS = 22;
    const LERP = 0.14;

    let mx = -9999, my = -9999, cmx = -9999, cmy = -9999;
    let drawLoop = null;
    let size = { width: 0, height: 0 };
    let segments = null;
    let dirty = true;

    function resize() {
        const r = page2.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = r.width * dpr;
        canvas.height = r.height * dpr;
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        size = { width: canvas.clientWidth, height: canvas.clientHeight };
        segments = null;
        dirty = true;
        if (drawLoop) drawLoop.request();
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    page2.addEventListener('mousemove', (e) => {
        const r = page2.getBoundingClientRect();
        mx = e.clientX - r.left;
        my = e.clientY - r.top;
        if (drawLoop) drawLoop.request();
    });
    page2.addEventListener('mouseleave', () => {
        mx = -9999;
        my = -9999;
        if (drawLoop) drawLoop.request();
    });

    function smoothstep(t) { return t * t * (3 - 2 * t); }

    function push(x, y) {
        if (cmx < 0) return [x, y, 0];
        const dx = x - cmx, dy = y - cmy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > RADIUS) return [x, y, 0];
        const t = smoothstep(1 - dist / RADIUS);
        const scale = 1 + t * (MAXSCALE - 1);
        return [cmx + dx * scale, cmy + dy * scale, t];
    }

    function drawSmoothLine(x1, y1, x2, y2, path) {
        if (path) {
            // Outside the distortion circle, replay precisely the same 22-step
            // path instead of recalculating and allocating every point.
            const dx = cmx - Math.max(x1, Math.min(x2, cmx));
            const dy = cmy - Math.max(y1, Math.min(y2, cmy));
            if (cmx < 0 || dx * dx + dy * dy > RADIUS * RADIUS) {
                ctx.strokeStyle = 'rgba(242, 193, 78, 0.06)';
                ctx.stroke(path);
                return;
            }
        }
        let maxT = 0;
        ctx.beginPath();
        for (let i = 0; i <= STEPS; i++) {
            const f = i / STEPS;
            const px = x1 + (x2 - x1) * f;
            const py = y1 + (y2 - y1) * f;
            const [dx, dy, t] = push(px, py);
            if (t > maxT) maxT = t;
            if (i === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy);
        }
        const alpha = 0.06 + Math.pow(maxT, 1.4) * 0.45;
        ctx.strokeStyle = `rgba(242, 193, 78, ${alpha})`;
        ctx.stroke();
    }

    function draw() {
        const previousX = cmx, previousY = cmy;
        cmx += (mx - cmx) * LERP;
        cmy += (my - cmy) * LERP;

        const desktop = drawLoop?.desktop && typeof Path2D !== 'undefined';
        const unchanged = cmx === previousX && cmy === previousY;
        if (desktop && !dirty && unchanged) return;
        const cw = desktop ? size.width : canvas.clientWidth;
        const ch = desktop ? size.height : canvas.clientHeight;
        ctx.clearRect(0, 0, cw, ch);
        ctx.lineWidth = 0.75;

        const cols = Math.ceil(cw / SPACING) + 1;
        const rows = Math.ceil(ch / SPACING) + 1;

        if (desktop) {
            if (!segments) {
                segments = [];
                function cache(x1, y1, x2, y2) {
                    const path = new Path2D();
                    for (let i = 0; i <= STEPS; i++) {
                        const f = i / STEPS;
                        const x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f;
                        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
                    }
                    segments.push([x1, y1, x2, y2, path]);
                }
                for (let r = 0; r <= rows; r++) {
                    for (let c = 0; c < cols; c++) cache(c * SPACING, r * SPACING, (c + 1) * SPACING, r * SPACING);
                }
                for (let c = 0; c <= cols; c++) {
                    for (let r = 0; r < rows; r++) cache(c * SPACING, r * SPACING, c * SPACING, (r + 1) * SPACING);
                }
            }
            segments.forEach(segment => drawSmoothLine(...segment));
        } else {
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c < cols; c++) {
                drawSmoothLine(c * SPACING, r * SPACING, (c + 1) * SPACING, r * SPACING);
            }
        }
        for (let c = 0; c <= cols; c++) {
            for (let r = 0; r < rows; r++) {
                drawSmoothLine(c * SPACING, r * SPACING, c * SPACING, (r + 1) * SPACING);
            }
        }
        }

        dirty = false;
        // Stop only on exact convergence: no changed easing, thresholds or snapping.
        if (drawLoop) {
            if (!desktop || !unchanged) drawLoop.request();
        } else requestAnimationFrame(draw);
    }
    drawLoop = window.createDesktopAnimationLoop?.(page2, draw);
    if (drawLoop) drawLoop.request(); else draw();
    if (drawLoop) new ResizeObserver(resize).observe(page2);
})();
