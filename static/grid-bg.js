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

    function resize() {
        const r = page2.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = r.width * dpr;
        canvas.height = r.height * dpr;
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    page2.addEventListener('mousemove', (e) => {
        const r = page2.getBoundingClientRect();
        mx = e.clientX - r.left;
        my = e.clientY - r.top;
    });
    page2.addEventListener('mouseleave', () => {
        mx = -9999;
        my = -9999;
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

    function drawSmoothLine(x1, y1, x2, y2) {
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
        cmx += (mx - cmx) * LERP;
        cmy += (my - cmy) * LERP;

        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        ctx.clearRect(0, 0, cw, ch);
        ctx.lineWidth = 0.75;

        const cols = Math.ceil(cw / SPACING) + 1;
        const rows = Math.ceil(ch / SPACING) + 1;

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

        requestAnimationFrame(draw);
    }
    draw();
})();