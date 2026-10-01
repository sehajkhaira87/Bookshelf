(() => {
    const controls = document.querySelectorAll(
        '.back-btn, .paper-card a, .pagination a, .clear-search, .minimal-search-box button, .paper-form button, .paper-card button'
    );
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');

    for (const control of controls) {
        let frame = 0;
        control.addEventListener('pointermove', (event) => {
            if (event.pointerType !== 'mouse' || reducedMotion.matches || reducedTransparency.matches) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const bounds = control.getBoundingClientRect();
                control.style.setProperty('--glass-x', `${(event.clientX - bounds.left) / bounds.width * 100}%`);
                control.style.setProperty('--glass-y', `${(event.clientY - bounds.top) / bounds.height * 100}%`);
            });
        });
        control.addEventListener('pointerleave', () => {
            cancelAnimationFrame(frame);
            control.style.removeProperty('--glass-x');
            control.style.removeProperty('--glass-y');
        });
    }

    // Progressive optical enhancement; the CSS lens also works without SVG filters.
    if (!CSS.supports('backdrop-filter', 'url("#pyq-lens")') || reducedTransparency.matches || !window.ResizeObserver) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const defs = document.createElementNS(ns, 'defs');
    svg.append(defs);
    document.body.append(svg);

    // Keep live refraction on the main controls, avoiding dozens of filters in the paper list.
    document.querySelectorAll('.back-btn, .minimal-search-box button').forEach((control, index) => {
        const filter = document.createElementNS(ns, 'filter');
        const map = document.createElementNS(ns, 'feImage');
        const lens = document.createElementNS(ns, 'feDisplacementMap');
        const id = `pyq-liquid-lens-${index}`;
        filter.id = id;
        filter.setAttribute('filterUnits', 'userSpaceOnUse');
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        filter.setAttribute('x', '0');
        filter.setAttribute('y', '0');
        map.setAttribute('result', 'lens-map');
        lens.setAttribute('in', 'SourceGraphic');
        lens.setAttribute('in2', 'lens-map');
        lens.setAttribute('scale', '12');
        lens.setAttribute('xChannelSelector', 'R');
        lens.setAttribute('yChannelSelector', 'G');
        filter.append(map, lens);
        defs.append(filter);

        let lastSize = '';
        const observer = new ResizeObserver(() => {
            const width = control.clientWidth;
            const height = control.clientHeight;
            const size = `${width}:${height}`;
            if (!width || !height || size === lastSize) return;
            lastSize = size;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) return;
            const pixels = context.createImageData(width, height);
            const radius = height / 2;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const dx = x + 0.5 - Math.max(radius, Math.min(width - radius, x + 0.5));
                    const dy = y + 0.5 - radius;
                    const distance = Math.hypot(dx, dy);
                    const depth = radius - distance;
                    const bend = depth >= 0 && depth < 8 ? Math.pow(1 - depth / 8, 2) : 0;
                    const offset = (y * width + x) * 4;
                    pixels.data[offset] = 128 + (distance ? dx / distance : 0) * bend * 127;
                    pixels.data[offset + 1] = 128 + (distance ? dy / distance : 0) * bend * 127;
                    pixels.data[offset + 2] = 128;
                    pixels.data[offset + 3] = 255;
                }
            }
            context.putImageData(pixels, 0, 0);
            filter.setAttribute('width', String(width));
            filter.setAttribute('height', String(height));
            map.setAttribute('width', String(width));
            map.setAttribute('height', String(height));
            map.setAttribute('href', canvas.toDataURL());
            control.style.setProperty('--liquid-filter', `url("#${id}")`);
            control.classList.add('liquid-lens');
        });
        observer.observe(control);
    });
})();
