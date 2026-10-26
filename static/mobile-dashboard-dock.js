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
    let selected = overview, enabled = false, points = [];
    let x = 0, y = 0, vx = 0, vy = 0, ax = 0, ay = 0;
    let lift = 0, liftVelocity = 0, liftAcceleration = 0;
    let width = 0, height = 0, frame = null, lastTime = 0, motion = null, follow = null;
    let gesture = null, holdTimer = null, holding = false, activation = null;
    let passClick = false, suppressClickUntil = 0, measuredWidth = 0, measuredHeight = 0;
    let bounds = null, logoutBounds = null, minX = 0, maxX = 0, minY = 0, maxY = 0;
    let dragCandidate = overview, hinted = -1, colours = [];
    const inactive = [225, 216, 202], active = [53, 41, 27];
    const labels = items.map(item => (item.querySelector('.nav-label-mobile') || item.querySelector('span')).textContent.trim());

    function label(index) {
        return labels[index];
    }

    function paint() {
        indicator.style.transform = `translate3d(${x}px,${y - lift}px,0)`;
        indicator.style.setProperty('--dock-sheen', Math.max(-12, Math.min(12, vx * .012)) + '%');
        dock.style.setProperty('--dock-hold-progress', Math.max(0, Math.min(1, lift / 2)));
        points.forEach((point, index) => {
            const overlapX = Math.max(0, Math.min(x + width, point.x + point.width) - Math.max(x, point.x));
            const overlapY = Math.max(0, Math.min(y + height, point.y + point.height) - Math.max(y, point.y));
            const coverage = Math.min(1, overlapX * overlapY / (point.width * point.height * .85));
            const colour = `rgb(${inactive.map((value, i) => Math.round(value + (active[i] - value) * coverage)).join(',')})`;
            if (colours[index] !== colour) {
                items[index].style.setProperty('--dock-label-color', colour);
                colours[index] = colour;
            }
        });
    }

    function finish() {
        dock.classList.remove('dock-moving');
        const action = activation;
        activation = null;
        action?.();
    }

    // One curve controls position, lift and the hint. Glides land with zero
    // velocity and acceleration; an interrupted glide retains its current motion.
    function curve(from, velocity, acceleration, to, milliseconds) {
        const seconds = milliseconds / 1000, distance = to - from;
        const v = velocity * seconds, a = acceleration * seconds * seconds;
        return [from, v, a / 2, 10 * distance - 6 * v - 1.5 * a,
            -15 * distance + 8 * v + 1.5 * a, 6 * distance - 3 * v - .5 * a];
    }

    function sample(c, t, milliseconds) {
        const seconds = milliseconds / 1000;
        return {
            position: c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * (c[4] + t * c[5])))),
            velocity: (c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5])))) / seconds,
            acceleration: (2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5]))) / (seconds * seconds)
        };
    }

    function wake() {
        dock.classList.add('dock-moving');
        if (frame === null) frame = requestAnimationFrame(tick);
    }

    function landingVelocity(from, velocity, to, milliseconds) {
        const distance = to - from, direction = Math.sign(distance);
        // Keep release momentum directed toward the selected cell, with a
        // monotonic landing even after a fast flick at the edge of the dock.
        return direction * Math.min(Math.max(0, direction * velocity), 2.5 * Math.abs(distance) / (milliseconds / 1000));
    }

    function tick(time) {
        frame = null;
        if (follow) {
            const previousX = x, previousY = y;
            const t = follow.duration ? Math.min(1, (time - follow.started) / follow.duration) : 1;
            if (t < 1) {
                const horizontal = sample(follow.x, t, follow.duration);
                const vertical = sample(follow.y, t, follow.duration);
                const raised = sample(follow.lift, t, follow.duration);
                x = follow.targetX + horizontal.position; y = follow.targetY + vertical.position;
                ax = horizontal.acceleration; ay = vertical.acceleration;
                lift = raised.position; liftVelocity = raised.velocity; liftAcceleration = raised.acceleration;
            } else {
                // After the short handoff, input follows the finger in one frame.
                x = follow.targetX; y = follow.targetY; lift = 2;
                ax = ay = liftVelocity = liftAcceleration = 0;
                follow.duration = 0;
            }
            const dt = Math.max(.001, (time - (lastTime || time - 16.7)) / 1000);
            vx = (x - previousX) / dt; vy = (y - previousY) / dt;
            lastTime = time;
            hint(dragCandidate);
            paint();
            if (t < 1) wake();
            else dock.classList.remove('dock-moving');
            return;
        }
        if (!motion) return;
        const t = Math.min(1, (time - motion.started) / motion.duration);
        if (t < 1) {
            const horizontal = sample(motion.x, t, motion.duration);
            const vertical = sample(motion.y, t, motion.duration);
            const raised = sample(motion.lift, t, motion.duration);
            x = horizontal.position; vx = horizontal.velocity; ax = horizontal.acceleration;
            y = vertical.position; vy = vertical.velocity; ay = vertical.acceleration;
            lift = raised.position; liftVelocity = raised.velocity; liftAcceleration = raised.acceleration;
            paint(); wake();
        } else {
            x = motion.toX; y = motion.toY; lift = motion.toLift;
            motion = null; vx = vy = ax = ay = liftVelocity = liftAcceleration = lastTime = 0;
            paint(); finish();
        }
    }

    function animate(point, toLift, duration, immediate = false) {
        // A stopped finger must not leave stale drag velocity on release.
        if (follow) {
            if (performance.now() - lastTime > 40) vx = vy = 0;
            vx = landingVelocity(x, vx, point.x, duration);
            vy = landingVelocity(y, vy, point.y, duration);
            liftVelocity = landingVelocity(lift, liftVelocity, toLift, duration);
            ax = ay = liftAcceleration = 0;
        }
        follow = null;
        if (immediate || reduced.matches) {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = motion = null;
            x = point.x; y = point.y; lift = toLift;
            vx = vy = ax = ay = liftVelocity = liftAcceleration = lastTime = 0;
            paint(); finish();
            return;
        }
        motion = {
            started: performance.now(), duration, toX: point.x, toY: point.y, toLift,
            x: curve(x, vx, ax, point.x, duration), y: curve(y, vy, ay, point.y, duration),
            lift: curve(lift, liftVelocity, liftAcceleration, toLift, duration)
        };
        wake();
    }

    function moveTo(point, manual = false, immediate = false) {
        animate(point, 0, manual ? 620 : 260, immediate);
    }

    function hint(index, force = false) {
        if (hinted === index && !force) return;
        hinted = index;
        items.forEach((item, i) => item.classList.toggle('dock-candidate', i === index));
        bubble.querySelector('span').textContent = label(index);
        // CSS clamps the bubble to the dock without a synchronous width read.
        bubble.style.setProperty('--dock-bubble-x', points[index].x + points[index].width / 2 + 'px');
    }

    function setHolding(value) {
        if (holding === value) return;
        holding = value;
        dock.classList.toggle('dock-holding', value);
    }

    function beginHold(found) {
        setHolding(true);
        dragCandidate = found.index;
        const point = points[found.index];
        const travelling = Math.hypot(point.x - x, point.y - y) > .1;
        animate(point, 2, travelling ? 520 : 160);
    }

    function track(found) {
        setHolding(true);
        if (!follow) {
            const origin = points[gesture.index];
            const catchingUp = Math.hypot(x - origin.x, y - origin.y) > .5 || Math.hypot(vx, vy) > .1;
            const duration = !reduced.matches && (catchingUp || Math.abs(lift - 2) > .01 || Math.abs(liftVelocity) > .01) ? 160 : 0;
            follow = {
                started: performance.now(), duration,
                x: curve(catchingUp ? x - found.x : 0, vx, ax, 0, 160),
                y: curve(catchingUp ? y - found.y : 0, vy, ay, 0, 160),
                lift: curve(lift, liftVelocity, liftAcceleration, 2, 160)
            };
            motion = null;
        }
        follow.targetX = found.x; follow.targetY = found.y;
        dragCandidate = found.index;
        wake();
    }

    function readBounds() {
        const rect = dock.getBoundingClientRect();
        bounds = {
            left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            borderLeft: dock.clientLeft, borderTop: dock.clientTop
        };
        logoutBounds = logout?.getBoundingClientRect();
        return rect;
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
            // A held selection opens its menu after the glass has landed.
            // Keyboard and ordinary taps retain the existing immediate toggle.
            if (manual) originalClick(settings);
            else activation = () => originalClick(settings);
            moveTo(points[index], manual);
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
        const rect = readBounds();
        points = items.map(item => {
            const box = item.getBoundingClientRect();
            return { x: box.left - rect.left - dock.clientLeft, y: box.top - rect.top - dock.clientTop, width: box.width, height: box.height };
        });
        measuredWidth = dock.clientWidth; measuredHeight = dock.clientHeight;
        minX = Math.min(...points.map(point => point.x)); maxX = Math.max(...points.map(point => point.x));
        minY = Math.min(...points.map(point => point.y)); maxY = Math.max(...points.map(point => point.y));
        width = points[0].width; height = points[0].height;
        indicator.style.width = width + 'px'; indicator.style.height = height + 'px';
        dock.style.setProperty('--dock-width', measuredWidth + 'px');
        hint(selected, true);
        moveTo(points[selected], false, true);
    }

    function locate(clientX, clientY) {
        const localX = clientX - bounds.left - bounds.borderLeft;
        const localY = clientY - bounds.top - bounds.borderTop;
        const distance = point => (point.x + point.width / 2 - localX) ** 2 + (point.y + point.height / 2 - localY) ** 2;
        const index = points.reduce((best, point, i) => distance(point) < distance(points[best]) ? i : best, 0);
        return {
            index,
            x: Math.max(minX, Math.min(maxX, localX - width / 2)),
            y: Math.max(minY, Math.min(maxY, localY - height / 2))
        };
    }

    function cancelGesture() {
        clearTimeout(holdTimer);
        const pointer = gesture?.id;
        gesture = null; activation = null;
        selected = settings?.getAttribute('aria-expanded') === 'true' ? items.indexOf(settings) : overview;
        if (pointer !== undefined && dock.hasPointerCapture(pointer)) dock.releasePointerCapture(pointer);
        setHolding(false);
        if (enabled && points.length) { hint(selected); moveTo(points[selected], false, document.hidden); }
    }

    function modified(event) {
        return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0;
    }

    dock.addEventListener('pointerdown', event => {
        if (!enabled || !event.isPrimary || modified(event) || event.target.closest('.text-danger, .settings-popup')) return;
        activation = null;
        clearTimeout(holdTimer);
        // Refresh the fixed bar's viewport position once at pickup, not on every move.
        readBounds();
        const found = locate(event.clientX, event.clientY);
        gesture = { id: event.pointerId, index: found.index, x: event.clientX, y: event.clientY, moved: false };
        dock.setPointerCapture(event.pointerId);
        hint(found.index);
        holdTimer = setTimeout(() => {
            if (gesture) beginHold(found);
        }, 140);
    });

    dock.addEventListener('pointermove', event => {
        if (event.pointerId !== gesture?.id) return;
        const samples = event.getCoalescedEvents?.();
        const latest = samples?.length ? samples[samples.length - 1] : event;
        if (Math.hypot(latest.clientX - gesture.x, latest.clientY - gesture.y) > 5) gesture.moved = true;
        // Small touch jitter must not interrupt the slow stationary pickup.
        if (!gesture.moved) return;
        clearTimeout(holdTimer);
        // Keep only the newest sample; all visual work happens in the next frame.
        track(locate(latest.clientX, latest.clientY));
    }, { passive: true });

    dock.addEventListener('pointerup', event => {
        if (event.pointerId !== gesture?.id) return;
        clearTimeout(holdTimer);
        const rect = bounds;
        const exit = logoutBounds;
        const overLogout = exit && event.clientX >= exit.left && event.clientX <= exit.right && event.clientY >= exit.top && event.clientY <= exit.bottom;
        const valid = !overLogout && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top - 68 && event.clientY <= rect.bottom + 32;
        const moved = gesture.moved || holding;
        gesture = null;
        suppressClickUntil = performance.now() + 500;
        if (dock.hasPointerCapture(event.pointerId)) dock.releasePointerCapture(event.pointerId);
        if (valid) commit(locate(event.clientX, event.clientY).index, !moved);
        else cancelGesture();
    });

    dock.addEventListener('pointercancel', cancelGesture);
    dock.addEventListener('lostpointercapture', () => { if (gesture) cancelGesture(); });
    // A link's native drag/callout must not cancel an active mobile scrub.
    dock.addEventListener('dragstart', event => {
        if (enabled && gesture) event.preventDefault();
    });
    dock.addEventListener('contextmenu', event => {
        if (enabled && gesture && holding) event.preventDefault();
    });
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
        frame = motion = follow = null;
        vx = vy = ax = ay = lift = liftVelocity = liftAcceleration = lastTime = 0;
        colours = []; hinted = -1;
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
