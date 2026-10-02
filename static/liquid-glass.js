/* Edge optics for the existing glass controls. No click/form handlers or layout changes. */
(() => {
    'use strict';

    const selector = '.liquid-glass, .notification-panel button';
    const controls = [...document.querySelectorAll(selector)];
    if (!controls.length) return;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
    const contrast = matchMedia('(forced-colors: active)');
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    const enabled = element => !element.matches(':disabled, [aria-disabled="true"], .dimmed');

    // Only animate in response to input; no render loop, sensor access or pointer capture.
    let active = null;
    let frame = 0;
    let position = null;
    const resetLight = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        if (active) {
            for (const name of ['--lg-light-x', '--lg-light-y', '--lg-light-angle']) {
                active.style.removeProperty(name);
            }
        }
        active = null;
    };
    const paintLight = () => {
        frame = 0;
        if (!active || !position) return;
        const bounds = active.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (position.x - bounds.left) / bounds.width));
        const y = Math.max(0, Math.min(1, (position.y - bounds.top) / bounds.height));
        // A distant light source moves through a small arc, avoiding a spinning rim.
        active.style.setProperty('--lg-light-x', `${20 + x * 60}%`);
        active.style.setProperty('--lg-light-y', `${y * 65}%`);
        active.style.setProperty('--lg-light-angle', `${-55 + x * 40 + y * 12}deg`);
    };
    document.addEventListener('pointermove', event => {
        if (motion.matches || transparency.matches || contrast.matches || !pointer.matches || event.pointerType === 'touch') return;
        const element = event.target instanceof Element ? event.target.closest(selector) : null;
        if (!element || !enabled(element)) {
            resetLight();
            return;
        }
        if (active !== element) resetLight();
        active = element;
        position = { x: event.clientX, y: event.clientY };
        if (!frame) frame = requestAnimationFrame(paintLight);
    }, { passive: true });
    document.addEventListener('pointerout', event => {
        if (active && (!(event.relatedTarget instanceof Node) || !active.contains(event.relatedTarget))) resetLight();
    }, { passive: true });
    window.addEventListener('blur', resetLight);
    for (const preference of [motion, transparency, contrast, pointer]) {
        preference.addEventListener('change', resetLight);
    }

    // URL backdrop filters are not interoperable. CSS.supports only checks syntax;
    // Safari/WebKit must retain the CSS blur/rim fallback (WebKit bug 245510).
    const chromium = /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent) &&
        !/(?:iPhone|iPad|iPod)/.test(navigator.userAgent);
    if (!chromium || !CSS.supports('backdrop-filter', 'url("#lg-probe")') ||
        !window.ResizeObserver || !window.IntersectionObserver) return;

    const ns = 'http://www.w3.org/2000/svg';
    const makeSvg = (name, attributes) => {
        const node = document.createElementNS(ns, name);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        return node;
    };
    const svg = makeSvg('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
    // Do not use display:none: some rendering engines then discard referenced filters.
    svg.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
    const defs = makeSvg('defs', {});
    svg.append(defs);
    document.body.append(svg);
    const cache = new Map();
    const assigned = new Map();
    const visible = new Set();
    const dirty = new Set();
    let measureFrame = 0;
    let nextFilter = 0;

    const filterFor = (width, height, radius) => {
        const key = `${width}/${height}/${radius}`;
        if (cache.has(key)) return cache.get(key).id;
        const resolution = Math.min(1, 512 / width, 256 / height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * resolution));
        canvas.height = Math.max(1, Math.round(height * resolution));
        const context = canvas.getContext('2d');
        if (!context) return null;
        const pixels = context.createImageData(canvas.width, canvas.height);
        const bevel = Math.min(9, height * .2, Math.max(2, radius));
        const strength = 12; // SVG scale: channel extremes correspond to +/-6 CSS pixels.

        for (let row = 0; row < canvas.height; row++) {
            for (let col = 0; col < canvas.width; col++) {
                const x = (col + .5) / canvas.width * width - width / 2;
                const y = (row + .5) / canvas.height * height - height / 2;
                const qx = Math.abs(x) - (width / 2 - radius);
                const qy = Math.abs(y) - (height / 2 - radius);
                const ax = Math.max(qx, 0);
                const ay = Math.max(qy, 0);
                const length = Math.hypot(ax, ay);
                const distance = radius - length - Math.min(Math.max(qx, qy), 0);
                let dx = 0;
                let dy = 0;
                if (distance > 0 && distance < bevel) {
                    // Normal of a rounded rectangle, including its quarter-circle corners.
                    const nx = length ? Math.sign(x) * ax / length : (qx > qy ? Math.sign(x) : 0);
                    const ny = length ? Math.sign(y) * ay / length : (qy >= qx ? Math.sign(y) : 0);
                    // A circular bevel cross-section + Snell's law (air 1.0, glass 1.45).
                    // The flat center has zero slope, so only the perimeter refracts.
                    const slope = 1 - distance / bevel;
                    const incident = Math.asin(slope);
                    const refracted = Math.asin(slope / 1.45);
                    const thickness = bevel * Math.sqrt(1 - slope * slope);
                    const shift = Math.min(5.5, Math.tan(incident - refracted) * (2 + thickness * .65)) *
                        Math.min(1, distance / 1.5);
                    dx = -nx * shift;
                    dy = -ny * shift;
                }
                const index = (row * canvas.width + col) * 4;
                pixels.data[index] = Math.round(255 * (.5 + dx / strength));
                pixels.data[index + 1] = Math.round(255 * (.5 + dy / strength));
                pixels.data[index + 2] = 128;
                pixels.data[index + 3] = 255;
            }
        }
        context.putImageData(pixels, 0, 0);
        const id = `bookshelf-glass-${nextFilter++}`;
        const filter = makeSvg('filter', { id, x: 0, y: 0, width, height,
            filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
            'color-interpolation-filters': 'sRGB' });
        filter.append(makeSvg('feImage', { x: 0, y: 0, width, height,
            href: canvas.toDataURL(), preserveAspectRatio: 'none', result: 'edge-map' }));
        filter.append(makeSvg('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge-map',
            scale: strength, xChannelSelector: 'R', yChannelSelector: 'G' }));
        defs.append(filter);
        cache.set(key, { id, filter });
        return id;
    };

    const update = () => {
        measureFrame = 0;
        for (const element of dirty) {
            element.style.removeProperty('--lg-refraction');
            assigned.delete(element);
            if (!visible.has(element) || transparency.matches || contrast.matches) continue;
            const width = element.offsetWidth;
            const height = element.offsetHeight;
            if (!width || !height) continue;
            const corners = getComputedStyle(element).borderTopLeftRadius;
            const parsedRadius = parseFloat(corners) || 0;
            const radius = Math.round(Math.min(width / 2, height / 2,
                corners.includes('%') ? Math.min(width, height) * parsedRadius / 100 : parsedRadius));
            const id = filterFor(width, height, radius);
            if (id) {
                assigned.set(element, id);
                element.style.setProperty('--lg-refraction', `url("#${id}") blur(.65px)`);
            }
        }
        dirty.clear();
        // Evict old, unused geometries after resize; never discard an in-use filter.
        const inUse = new Set(assigned.values());
        for (const [key, entry] of cache) {
            if (cache.size <= 64) break;
            if (!inUse.has(entry.id)) {
                entry.filter.remove();
                cache.delete(key);
            }
        }
    };
    const queue = element => {
        dirty.add(element);
        if (!measureFrame) measureFrame = requestAnimationFrame(update);
    };
    const intersection = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
            queue(entry.target);
        }
    });
    const resize = new ResizeObserver(entries => {
        for (const entry of entries) if (visible.has(entry.target)) queue(entry.target);
    });
    for (const element of controls) {
        intersection.observe(element);
        resize.observe(element);
    }
    for (const preference of [transparency, contrast]) {
        preference.addEventListener('change', () => controls.forEach(queue));
    }
})();
