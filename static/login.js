document.addEventListener('DOMContentLoaded', () => {
    const googleBtn = document.getElementById('googleSignIn');
    
    if (googleBtn) {
        googleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            const btn = e.currentTarget;
            const label = btn.querySelector('.login-google-label');
            const icon = btn.querySelector('.login-google-icon');
            const arrow = btn.querySelector('.login-google-arrow');
            const targetUrl = btn.getAttribute('href');

            
            btn.style.display = "flex";
            btn.style.pointerEvents = "none";
            
            btn.classList.add('bookshelf-loading-pulse');
            
            if (arrow) arrow.style.display = "none";
            if (label) label.innerText = "Authenticating...";

            setTimeout(() => {
                if (label) label.innerText = "Redirecting to Google...";
                if (icon) {
                    icon.innerHTML = `<span class="login-spinner"></span>`;
                }

                setTimeout(() => {
                    window.location.href = targetUrl;
                }, 800);
            }, 1200);
        });
    }
});


(function() {
    const visual = document.getElementById('loginVisual');
    if (!visual) return;

    const sign = document.createElement('span');
    sign.className = 'login-library-sign';
    sign.textContent = 'GNE LIBRARY';
    sign.setAttribute('aria-hidden', 'true');
    visual.appendChild(sign);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const radius = 170;
    let gate = { x: 0, y: 0 };
    const target = { x: 0, y: 0, active: false };
    const current = { x: 0, y: 0, reveal: 0 };
    let frame = 0;
    let lastTime = 0;
    let touching = false;

    function measure() {
        // These coordinates use the original 1024 × 559 corridor image.
        const width = visual.clientWidth;
        const height = visual.clientHeight;
        const scale = Math.max(width / 1024, height / 559);
        gate = {
            x: 512 * scale + (width - 1024 * scale) / 2,
            y: 233.5 * scale + (height - 559 * scale) / 2,
        };
        sign.style.left = `${gate.x}px`;
        sign.style.top = `${gate.y}px`;
        sign.style.fontSize = `${11 * scale}px`;
        sign.style.letterSpacing = `${.15 * scale}px`;
        sign.style.transform = 'translate(-50%, -50%)';
        const availableWidth = 70 * scale;
        if (sign.offsetWidth > availableWidth) {
            sign.style.transform = `translate(-50%, -50%) scaleX(${availableWidth / sign.offsetWidth})`;
        }
        if (!target.active) {
            current.x = target.x = gate.x;
            current.y = target.y = gate.y;
        }
        paint();
        if (target.active) wake();
    }

    function paint() {
        visual.style.setProperty('--x', `${current.x}px`);
        visual.style.setProperty('--y', `${current.y}px`);
        visual.style.setProperty('--library-reveal', current.reveal.toFixed(4));
    }

    function animate(time) {
        frame = 0;
        const dt = Math.min(32, Math.max(1, lastTime ? time - lastTime : 16.7));
        lastTime = time;
        const follow = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 42);
        const fade = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / (650 / 4.2));
        current.x += (target.x - current.x) * follow;
        current.y += (target.y - current.y) * follow;

        const distance = Math.hypot(current.x - gate.x, current.y - gate.y);
        const t = Math.max(0, Math.min(1, (distance - radius * .3) / (radius * .55)));
        const visibility = target.active ? 1 - t * t * (3 - 2 * t) : 0;
        current.reveal += (visibility - current.reveal) * fade;
        if (Math.abs(current.reveal - visibility) < .001) current.reveal = visibility;
        paint();

        const moving = Math.abs(current.x - target.x) + Math.abs(current.y - target.y) > .1;
        if (moving || current.reveal !== visibility) frame = requestAnimationFrame(animate);
        else lastTime = 0;
    }

    function wake() {
        if (!frame) {
            lastTime = 0;
            frame = requestAnimationFrame(animate);
        }
    }

    function point(event) {
        const rect = visual.getBoundingClientRect();
        // Convert pointer coordinates to the image's untransformed local space.
        target.x = (event.clientX - rect.left) * visual.clientWidth / rect.width;
        target.y = (event.clientY - rect.top) * visual.clientHeight / rect.height;
        target.active = true;
        wake();
    }

    function leave() {
        target.active = false;
        wake();
    }

    visual.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') point(event); });
    visual.addEventListener('pointermove', event => { if (event.pointerType !== 'touch' || touching) point(event); });
    visual.addEventListener('pointerleave', leave);
    visual.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch') { touching = true; point(event); }
    });
    visual.addEventListener('pointerup', event => {
        if (event.pointerType === 'touch') { touching = false; leave(); }
    });
    visual.addEventListener('pointercancel', () => { touching = false; leave(); });

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(visual);
    document.fonts?.ready.then(measure);
    measure();
})();
