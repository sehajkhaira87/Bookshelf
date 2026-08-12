document.getElementById('googleSignIn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const label = btn.querySelector('.login-google-label');
    const icon = btn.querySelector('.login-google-icon');

    
    label.innerText = "Authenticating...";
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0.8";

    setTimeout(() => {
        label.innerText = "Loading dashboard...";
        if (icon) {
            icon.innerHTML = `<span class="login-spinner"></span>`;
        }

        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 700);
    }, 1000);
});
(function() {
    const visual = document.getElementById('loginVisual');
    if (!visual) return;

    const canvas = document.getElementById('trail-canvas');
    const ctx = canvas.getContext('2d');
    const pencil = document.getElementById('loginPencil');

    let w, h, mx = -100, my = -100, cx = 0, cy = 0;
    let lastX = null, lastY = null, lastAngle = -45;
    let points = [];
    const MAX_POINTS = 60;
    const HOLD_TIME = 1400;
    const FADE_TIME = 900;

    function resize() {
        const r = visual.getBoundingClientRect();
        w = canvas.width = r.width * window.devicePixelRatio;
        h = canvas.height = r.height * window.devicePixelRatio;
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    resize();
    new ResizeObserver(resize).observe(visual);

    visual.addEventListener('mousemove', (e) => {
        const r = visual.getBoundingClientRect();
        mx = e.clientX - r.left;
        my = e.clientY - r.top;
        pencil.style.opacity = '1';


        visual.style.setProperty('--x', `${mx}px`);
        visual.style.setProperty('--y', `${my}px`);
    });

    visual.addEventListener('mouseleave', () => {
        mx = -100;
        my = -100;
        pencil.style.opacity = '0';
    });

    function addPoint(x, y) {
        points.push({ x, y, t: performance.now() });
        if (points.length > MAX_POINTS) points.shift();
    }

    function updatePencil(x, y) {
        pencil.style.transform = `translate(${x - 20}px, ${y - 20}px)`;
        if (lastX !== null) {
            const dx = x - lastX, dy = y - lastY;
            if (Math.hypot(dx, dy) > 1) lastAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        }
        pencil.querySelector('g').setAttribute('transform', `rotate(${lastAngle + 45} 32 32)`);
        lastX = x; lastY = y;
    }

    function draw() {
        const now = performance.now();
        const cssW = canvas.clientWidth;
        const cssH = canvas.clientHeight;
        ctx.clearRect(0, 0, cssW, cssH);

        if (mx >= 0) {
            cx += (mx - cx) * 0.18;
            cy += (my - cy) * 0.18;
            addPoint(cx, cy);
            updatePencil(cx, cy);
        }

        const totalLife = HOLD_TIME + FADE_TIME;

        if (points.length >= 2) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (let i = 1; i < points.length; i++) {
                const p0 = points[i - 1];
                const p1 = points[i];
                const age = now - p1.t;
                if (age > totalLife) continue;

                let life;
                if (age <= HOLD_TIME) {
                    life = 1;
                } else {
                    life = 1 - ((age - HOLD_TIME) / FADE_TIME);
                }

                const opacity = life * 0.55;
                const width = 0.6 + life * 1.6;

                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                // I updated the line color to match your Bookshelf gold theme!
                ctx.strokeStyle = `rgba(242, 193, 78, ${opacity})`; 
                ctx.lineWidth = width;
                ctx.stroke();
            }
        }

        points = points.filter(p => now - p.t < totalLife);
        requestAnimationFrame(draw);
    }
    draw();
})();