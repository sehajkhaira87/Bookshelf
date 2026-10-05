/* Progressive enhancement of existing links; no separate mobile navigation. */
(() => {
    const dock = document.querySelector('.dashboard-page .sidebar');
    if (!dock) return;
    const indicator = dock.querySelector('.mobile-dock-indicator');
    const bubble = dock.querySelector('.mobile-dock-destination');
    const status = dock.querySelector('.mobile-dock-status');
    const settings = dock.querySelector('#settingsBtn');
    const logout = dock.querySelector('.text-danger');
    const items = [...dock.querySelectorAll('.sidebar-nav > .nav-item'), settings].filter(Boolean);
    if (!indicator || !bubble || !items.length) return;

    const mobile = window.matchMedia('(max-width: 820px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const overview = Math.max(0, items.findIndex(item => item.classList.contains('active')));
    let selected = overview, candidate = overview, enabled = false, points = [];
    let x = 0, y = 0, vx = 0, vy = 0, targetX = 0, targetY = 0;
    let width = 0, height = 0, frame = null, lastTime = 0, tapMotion = null;
    let gesture = null, holdTimer = null, holding = false, activation = null;
    let passClick = false, suppressClickUntil = 0, measuredWidth = 0, measuredHeight = 0;

    function label(index) {
        const item = items[index];
        return (item.querySelector('.nav-label-mobile') || item.querySelector('span')).textContent.trim();
    }

    function paint() {
        const stretch = holding ? Math.min(.025, Math.hypot(vx, vy) * .00004) : 0;
        indicator.style.transform = `translate3d(${x}px,${y - (holding ? 2 : 0)}px,0) scale(${1 + stretch},${holding ? 1.02 : 1})`;
        indicator.style.setProperty('--dock-sheen', Math.max(-16, Math.min(16, vx * .025)) + '%');
        points.forEach((point, index) => {
            const overlapX = Math.max(0, Math.min(x + width, point.x + point.width) - Math.max(x, point.x));
            const overlapY = Math.max(0, Math.min(y + height, point.y + point.height) - Math.max(y, point.y));
            const coverage = Math.min(1, overlapX * overlapY / (point.width * point.height * .85));
            const inactive = [225, 216, 202], active = [53, 41, 27];
            items[index].style.setProperty('--dock-label-color', `rgb(${inactive.map((value, i) => Math.round(value + (active[i] - value) * coverage)).join(',')})`);
        });
    }

    function finish() {
        dock.classList.remove('dock-moving');
        const action = activation;
        activation = null;
        action?.();
    }

    function tick(time) {
        frame = null;
        if (tapMotion) {
            if (tapMotion.started === null) tapMotion.started = time;
            const t = Math.min(1, (time - tapMotion.started) / 620);
            const eased = t * t * t * (10 + t * (-15 + 6 * t));
            targetX = tapMotion.x + (tapMotion.toX - tapMotion.x) * eased;
            targetY = tapMotion.y + (tapMotion.toY - tapMotion.y) * eased;
            if (t === 1) tapMotion = null;
        }
        const dt = Math.min((time - (lastTime || time - 16.7)) / 1000, .032);
        lastTime = time;
        const stiffness = (5.5 / .28) ** 2, damping = 2 * Math.sqrt(stiffness) * .88;
        const steps = Math.ceil(dt / .008), step = dt / steps;
        for (let i = 0; i < steps; i++) {
            vx += (stiffness * (targetX - x) - damping * vx) * step;
            vy += (stiffness * (targetY - y) - damping * vy) * step;
            x += vx * step;
            y += vy * step;
        }
        paint();
        if (tapMotion || Math.hypot(targetX - x, targetY - y) > .15 || Math.hypot(vx, vy) > 2) {
            frame = requestAnimationFrame(tick);
        } else {
            x = targetX; y = targetY; vx = vy = lastTime = 0;
            paint(); finish();
        }
    }

    function moveTo(point, manual = false, immediate = false) {
        tapMotion = null;
        if (immediate || reduced.matches) {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            x = targetX = point.x; y = targetY = point.y;
            vx = vy = lastTime = 0;
            paint(); finish();
            return;
        }
        if (manual && Math.hypot(point.x - x, point.y - y) > .1) {
            // Retarget from the current pose without resetting momentum.
            tapMotion = { x, y, toX: point.x, toY: point.y, started: null };
        } else {
            targetX = point.x; targetY = point.y;
        }
        dock.classList.add('dock-moving');
        if (frame === null) { lastTime = 0; frame = requestAnimationFrame(tick); }
    }

    function hint(index) {
        candidate = index;
        items.forEach((item, i) => item.classList.toggle('dock-candidate', i === index));
        bubble.querySelector('span').textContent = label(index);
        const half = bubble.offsetWidth / 2;
        bubble.style.left = Math.max(half + 4, Math.min(dock.clientWidth - half - 4, points[index].x + width / 2)) + 'px';
    }

    function setHolding(value) {
        holding = value;
        dock.classList.toggle('dock-holding', value);
        paint();
    }

    function originalClick(item) {
        // Accessibility activation can itself call .click(). Let that dispatch
        // finish before forwarding, so the browser's recursion guard cannot drop it.
        setTimeout(() => {
            passClick = true;
            try { item.click(); } finally { passClick = false; }
        }, 0);
    }

    function commit(index, manual = true) {
        activation = null;
        selected = index;
        setHolding(false); hint(index);
        if (items[index] === settings) {
            moveTo(points[index], manual);
            originalClick(settings);
        } else {
            if (settings?.getAttribute('aria-expanded') === 'true') originalClick(settings);
            activation = () => originalClick(items[index]);
            moveTo(points[index], manual);
        }
        status.textContent = label(index) + ' selected';
    }

    function measure(force = false) {
        if (!enabled) return;
        // An unchanged observer notification must never interrupt a tap glide.
        if (!force && measuredWidth === dock.clientWidth && measuredHeight === dock.clientHeight) return;
        const rect = dock.getBoundingClientRect();
        points = items.map(item => {
            const box = item.getBoundingClientRect();
            return { x: box.left - rect.left - dock.clientLeft, y: box.top - rect.top - dock.clientTop, width: box.width, height: box.height };
        });
        measuredWidth = dock.clientWidth; measuredHeight = dock.clientHeight;
        width = points[0].width; height = points[0].height;
        indicator.style.width = width + 'px'; indicator.style.height = height + 'px';
        hint(selected);
        moveTo(points[selected], false, true);
    }

    function locate(clientX, clientY) {
        const rect = dock.getBoundingClientRect();
        const localX = clientX - rect.left - dock.clientLeft;
        const localY = clientY - rect.top - dock.clientTop;
        const distance = point => (point.x + point.width / 2 - localX) ** 2 + (point.y + point.height / 2 - localY) ** 2;
        const index = points.reduce((best, point, i) => distance(point) < distance(points[best]) ? i : best, 0);
        return {
            index,
            x: Math.max(Math.min(...points.map(point => point.x)), Math.min(Math.max(...points.map(point => point.x)), localX - width / 2)),
            y: Math.max(Math.min(...points.map(point => point.y)), Math.min(Math.max(...points.map(point => point.y)), localY - height / 2))
        };
    }

    function cancelGesture() {
        clearTimeout(holdTimer);
        const pointer = gesture?.id;
        gesture = null; activation = null;
        selected = settings?.getAttribute('aria-expanded') === 'true' ? items.indexOf(settings) : overview;
        if (pointer !== undefined && dock.hasPointerCapture(pointer)) dock.releasePointerCapture(pointer);
        setHolding(false);
        if (enabled && points.length) { hint(selected); moveTo(points[selected], true); }
    }

    function modified(event) {
        return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0;
    }

    dock.addEventListener('pointerdown', event => {
        if (!enabled || !event.isPrimary || modified(event) || event.target.closest('.text-danger, .settings-popup')) return;
        activation = null;
        clearTimeout(holdTimer);
        const found = locate(event.clientX, event.clientY);
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        dock.setPointerCapture(event.pointerId);
        hint(found.index);
        holdTimer = setTimeout(() => {
            if (gesture) { setHolding(true); moveTo(points[found.index], true); }
        }, 140);
    });

    dock.addEventListener('pointermove', event => {
        if (event.pointerId !== gesture?.id) return;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
        if (!gesture.moved && !holding) return;
        clearTimeout(holdTimer);
        const found = locate(event.clientX, event.clientY);
        setHolding(true); hint(found.index); moveTo(found);
    });

    dock.addEventListener('pointerup', event => {
        if (event.pointerId !== gesture?.id) return;
        clearTimeout(holdTimer);
        const rect = dock.getBoundingClientRect();
        const exit = logout?.getBoundingClientRect();
        const overLogout = exit && event.clientX >= exit.left && event.clientX <= exit.right && event.clientY >= exit.top && event.clientY <= exit.bottom;
        const valid = !overLogout && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top - 68 && event.clientY <= rect.bottom + 32;
        const moved = gesture.moved;
        gesture = null;
        suppressClickUntil = performance.now() + 500;
        if (dock.hasPointerCapture(event.pointerId)) dock.releasePointerCapture(event.pointerId);
        if (valid) commit(locate(event.clientX, event.clientY).index, !moved);
        else cancelGesture();
    });

    dock.addEventListener('pointercancel', cancelGesture);
    dock.addEventListener('lostpointercapture', () => { if (gesture) cancelGesture(); });
    dock.addEventListener('click', event => {
        if (!enabled || passClick || modified(event)) return;
        const item = event.target.closest('.nav-item');
        if (event.detail > 0 && performance.now() < suppressClickUntil && !event.target.closest('.settings-popup')) {
            event.preventDefault(); event.stopImmediatePropagation();
            return;
        }
        const index = items.indexOf(item);
        if (index < 0) return;
        event.preventDefault(); event.stopImmediatePropagation();
        commit(index);
    }, true);

    dock.addEventListener('keydown', event => {
        if (!enabled || !items.includes(event.target.closest('.nav-item'))) return;
        if (event.key === 'Escape') {
            cancelGesture();
            if (settings?.getAttribute('aria-expanded') === 'true') originalClick(settings);
        }
    });

    if (settings) new MutationObserver(() => {
        if (!enabled || gesture || activation) return;
        const index = items.indexOf(settings);
        if (settings.getAttribute('aria-expanded') === 'true') {
            if (selected !== index) { selected = index; hint(index); moveTo(points[index], true); }
        } else if (selected === index) {
            selected = overview; hint(overview); moveTo(points[overview], true);
        }
    }).observe(settings, { attributes: true, attributeFilter: ['aria-expanded'] });

    function configure() {
        activation = null;
        enabled = mobile.matches;
        cancelGesture();
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null; tapMotion = null; vx = vy = lastTime = 0;
        selected = settings?.getAttribute('aria-expanded') === 'true' ? items.indexOf(settings) : overview;
        dock.classList.toggle('mobile-dock-ready', enabled);
        dock.classList.remove('dock-moving');
        items.forEach(item => { item.style.removeProperty('--dock-label-color'); item.classList.remove('dock-candidate'); });
        if (enabled) measure(true);
    }

    new ResizeObserver(() => measure()).observe(dock);
    mobile.addEventListener('change', configure);
    reduced.addEventListener('change', () => { cancelGesture(); if (enabled) moveTo(points[selected], false, true); });
    window.addEventListener('pageshow', configure);
    window.addEventListener('pagehide', () => { activation = null; cancelGesture(); if (frame !== null) cancelAnimationFrame(frame); frame = null; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelGesture(); });
    configure();
})();
