// Keep the existing card swipe; only the pagination bar follows a motion spring.
(() => {
    if (window.history && 'scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    window.scrollTo?.(0, 0);
    const mobile = window.matchMedia('(max-width: 820px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const track = document.getElementById('featuresTrack');
    const rail = document.getElementById('featureDots');
    if (!track || !rail) return;
    const cards = Array.from(track.querySelectorAll('.feature-item'));
    if (!cards.length) return;
    // Enhance the existing dots without requiring a new page template.
    const indicator = document.createElement('span');
    indicator.className = 'feature-dot-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    const selector = document.createElement('input');
    selector.className = 'feature-selector';
    selector.type = 'range'; selector.min = '0'; selector.step = '1'; selector.value = '0';
    selector.setAttribute('aria-label', 'Feature card');
    const status = document.createElement('span');
    status.className = 'feature-dot-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    rail.querySelectorAll('.f-dot').forEach(dot => {
        dot.classList.remove('is-active');
        dot.setAttribute('aria-hidden', 'true');
    });
    rail.append(indicator, selector, status);
    const titles = cards.map(card => card.querySelector('h3').textContent.trim());
    const clamp = value => Math.max(0, Math.min(cards.length - 1, value));
    const step = 22; // Matches the fixed dot spacing in the mobile CSS.
    selector.max = String(cards.length - 1);
    let index = 0, gesture = null, position = 0, target = 0, velocity = 0;
    let frame = null, lastTime = 0, tap = null, announce = false;

    function render() {
        cards.forEach((card, i) => {
            if (!mobile.matches) {
                card.removeAttribute('aria-hidden');
                return;
            }
            card.classList.toggle('card-active', i === index);
            card.classList.toggle('card-next', i === (index + 1) % cards.length);
            card.classList.toggle('card-hidden', i !== index && i !== (index + 1) % cards.length);
            card.setAttribute('aria-hidden', String(i !== index));
        });
        selector.value = String(index);
        selector.setAttribute('aria-valuetext', titles[index]);
    }

    function paint() {
        rail.style.setProperty('--feature-bar-x', `${step * clamp(position)}px`);
    }

    function stop() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null; lastTime = 0; tap = null;
    }

    function finish() {
        position = target; velocity = lastTime = 0;
        paint();
        if (announce && !gesture) {
            announce = false;
            status.textContent = titles[index];
        }
    }

    function tick(time) {
        frame = null;
        if (tap) {
            if (tap.started === null) tap.started = time;
            const t = Math.min(1, (time - tap.started) / 620);
            const eased = t * t * t * (10 + t * (-15 + 6 * t));
            target = tap.from + (tap.to - tap.from) * eased;
            if (t === 1) { target = tap.to; tap = null; }
        }
        const dt = Math.min((time - (lastTime || time - 16.7)) / 1000, .032);
        lastTime = time;
        const stiffness = (5.5 / .28) ** 2, damping = 2 * Math.sqrt(stiffness) * .88;
        const steps = Math.ceil(dt / .008), interval = dt / steps;
        for (let i = 0; i < steps; i++) {
            velocity += (stiffness * (target - position) - damping * velocity) * interval;
            position += velocity * interval;
        }
        paint();
        if (tap || Math.abs(target - position) > .0004 || Math.abs(velocity) > .006) {
            frame = requestAnimationFrame(tick);
        } else finish();
    }

    function start() {
        if (reduced.matches || document.hidden || !mobile.matches) { finish(); return; }
        if (frame === null) frame = requestAnimationFrame(tick);
    }

    function select(value, glide = true, notify = true) {
        const goal = clamp(Math.round(value));
        stop(); index = goal; render(); announce = notify;
        if (glide && !reduced.matches && !document.hidden && Math.abs(goal - position) > .0004) {
            tap = { from: position, to: goal, started: null };
        } else target = goal;
        start();
    }

    function locate(clientX) {
        return clamp((clientX - rail.getBoundingClientRect().left - step / 2) / step);
    }

    function clearGesture() {
        const old = gesture;
        gesture = null;
        if (old?.element.hasPointerCapture(old.id)) old.element.releasePointerCapture(old.id);
        return old;
    }

    function cancelGesture() {
        const old = clearGesture();
        if (old?.kind === 'bar') select(old.previous, false, false);
    }

    // Original swipe thresholds, wrapping and CSS card transitions are unchanged.
    track.addEventListener('pointerdown', event => {
        if (!mobile.matches || !event.isPrimary || event.button !== 0 || gesture) return;
        gesture = { kind: 'card', element: track, id: event.pointerId, x: event.clientX, y: event.clientY };
        track.setPointerCapture(event.pointerId);
    }, { passive: true });
    track.addEventListener('pointerup', event => {
        if (!mobile.matches || gesture?.kind !== 'card' || event.pointerId !== gesture.id) return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        clearGesture();
        if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy)) return;
        select((index + (dx < 0 ? 1 : -1) + cards.length) % cards.length);
    }, { passive: true });

    selector.addEventListener('pointerdown', event => {
        if (!mobile.matches || !event.isPrimary || event.button !== 0 || gesture) return;
        event.preventDefault();
        stop(); target = position; velocity = 0;
        gesture = { kind: 'bar', element: selector, id: event.pointerId, x: event.clientX, moved: false, previous: index };
        selector.setPointerCapture(event.pointerId);
    });
    selector.addEventListener('pointermove', event => {
        if (gesture?.kind !== 'bar' || event.pointerId !== gesture.id) return;
        event.preventDefault();
        if (!gesture.moved && Math.abs(event.clientX - gesture.x) < 3) return;
        gesture.moved = true; tap = null; target = locate(event.clientX);
        start();
    });
    selector.addEventListener('pointerup', event => {
        if (gesture?.kind !== 'bar' || event.pointerId !== gesture.id) return;
        event.preventDefault();
        const old = clearGesture();
        select(locate(event.clientX), !old.moved);
    });
    for (const element of [track, selector]) {
        element.addEventListener('pointercancel', cancelGesture);
        element.addEventListener('lostpointercapture', () => { if (gesture?.element === element) cancelGesture(); });
    }
    selector.addEventListener('input', () => { if (mobile.matches && !gesture) select(Number(selector.value)); });
    selector.addEventListener('keydown', event => {
        if (!mobile.matches) return;
        const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? index + 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? index - 1
            : event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : null;
        if (next !== null) { event.preventDefault(); select(next); }
        else if (event.key === 'Escape') cancelGesture();
    });
    function resetMotion() {
        cancelGesture(); stop(); target = index; finish(); render();
    }
    mobile.addEventListener('change', resetMotion);
    reduced.addEventListener('change', () => { if (reduced.matches) resetMotion(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetMotion(); });
    window.addEventListener('blur', cancelGesture);
    window.addEventListener('pagehide', resetMotion);
    render(); paint();
})();
