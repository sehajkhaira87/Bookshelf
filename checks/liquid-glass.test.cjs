const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/liquid-glass.js'), 'utf8');
const queries = {
    motion: '(prefers-reduced-motion: reduce)',
    transparency: '(prefers-reduced-transparency: reduce)',
    contrast: '(forced-colors: active)',
    pointer: '(hover: hover) and (pointer: fine)'
};

// Exercise the browser entry point without a browser dependency. Canvas image data
// stays available here so the displacement field can be checked independently of CSS.
function fixture(options = {}) {
    class Events {
        constructor() { this.listeners = new Map(); }
        addEventListener(type, handler) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(handler);
        }
        dispatch(type, event = {}) {
            for (const handler of this.listeners.get(type) || []) handler(event);
        }
    }
    class Element extends Events {
        constructor(tag = 'button') {
            super();
            this.tag = tag;
            this.children = [];
            this.attributes = {};
            this.offsetWidth = 120;
            this.offsetHeight = 48;
            this.radius = '24px';
            this.disabled = false;
            this.properties = new Map();
            this.style = {
                setProperty: (key, value) => this.properties.set(key, value),
                removeProperty: key => this.properties.delete(key)
            };
        }
        append(...children) {
            for (const child of children) {
                child.parent = this;
                this.children.push(child);
            }
        }
        remove() {
            if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
        }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        matches() { return this.disabled; }
        closest() { return this.tag === 'button' ? this : null; }
        contains(other) { return this === other || this.children.some(child => child.contains(other)); }
        getBoundingClientRect() {
            return { left: 0, top: 0, width: this.offsetWidth, height: this.offsetHeight };
        }
    }
    const controls = Array.from({ length: options.count ?? 1 }, () => new Element());
    const document = new Events();
    document.body = new Element('body');
    document.querySelectorAll = () => controls;
    document.createElementNS = (_, tag) => new Element(tag);
    const maps = [];
    document.createElement = tag => {
        assert.equal(tag, 'canvas');
        const canvas = new Element(tag);
        canvas.getContext = () => options.canvas === false ? null : {
            createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: pixels => maps.push(pixels)
        };
        canvas.toDataURL = () => `data:image/png;base64,test-map-${maps.length}`;
        return canvas;
    };
    const media = new Map(Object.entries(queries).map(([name, query]) => {
        const value = new Events();
        value.matches = options[name] ?? (name === 'pointer');
        return [query, value];
    }));
    const frames = new Map();
    let nextFrame = 0;
    let intersection, resize;
    class IntersectionObserver {
        constructor(callback) { intersection = callback; }
        observe() {}
    }
    class ResizeObserver {
        constructor(callback) { resize = callback; }
        observe() {}
    }
    const window = new Events();
    window.IntersectionObserver = IntersectionObserver;
    window.ResizeObserver = ResizeObserver;
    const context = vm.createContext({
        document, window, Element, Node: Element,
        navigator: { userAgent: options.userAgent ?? 'Mozilla/5.0 Chrome/132.0.0.0 Safari/537.36' },
        CSS: { supports: () => options.supports ?? true },
        matchMedia: query => media.get(query),
        getComputedStyle: element => ({ borderTopLeftRadius: element.radius }),
        IntersectionObserver, ResizeObserver,
        requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: id => frames.delete(id)
    });
    vm.runInContext(source, context);
    const flush = () => {
        for (let rounds = 0; frames.size; rounds++) {
            assert.ok(rounds < 10, 'input should not create a persistent animation loop');
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback());
        }
    };
    const all = (node = document.body) => [node, ...node.children.flatMap(child => all(child))];
    return {
        controls, document, window, maps, flush,
        filters: () => all().filter(node => node.tag === 'filter'),
        visible(value = true, targets = controls) {
            intersection?.(targets.map(target => ({ target, isIntersecting: value })));
            flush();
        },
        resize(target = controls[0]) { resize?.([{ target }]); flush(); },
        preference(name, value) {
            const setting = media.get(queries[name]);
            setting.matches = value;
            setting.dispatch('change');
            flush();
        },
        move({ target = controls[0], pointerType = 'mouse', clientX = 110, clientY = 10 } = {}) {
            document.dispatch('pointermove', { target, pointerType, clientX, clientY });
            flush();
        }
    };
}

const pixel = (map, x, y) => [...map.data.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4)];
const refraction = control => control.properties.get('--lg-refraction');
const light = control => control.properties.get('--lg-light-x');

test('refraction is lazy and equal button geometries share one filter', () => {
    const f = fixture({ count: 2 });
    assert.equal(f.maps.length, 0);
    assert.equal(refraction(f.controls[0]), undefined);
    f.visible();
    assert.equal(f.maps.length, 1);
    assert.equal(f.filters().length, 1);
    assert.equal(refraction(f.controls[0]), refraction(f.controls[1]));
    assert.match(refraction(f.controls[0]), /url\("#bookshelf-glass-/);
    f.visible(false);
    assert.equal(refraction(f.controls[0]), undefined);
});

test('the displacement field bends inward at all edges and leaves the flat center neutral', () => {
    const f = fixture();
    f.visible();
    const map = f.maps[0];
    for (const [x, y] of [[60, 24], [20, 24], [60, 12], [0, 0]]) {
        assert.deepEqual(pixel(map, x, y), [128, 128, 128, 255]);
    }
    const left = pixel(map, 2, 24);
    const right = pixel(map, 117, 24);
    const top = pixel(map, 60, 2);
    const bottom = pixel(map, 60, 45);
    assert.ok(left[0] > 128 && right[0] < 128, 'horizontal edges refract in opposite directions');
    assert.ok(top[1] > 128 && bottom[1] < 128, 'vertical edges refract in opposite directions');
    assert.ok(Math.abs(left[0] + right[0] - 255) <= 1, 'opposite edges remain symmetric');
    const corner = pixel(map, 8, 8);
    assert.ok(corner[0] > 128 && corner[1] > 128, 'curved corners bend along both axes');
    for (let index = 0; index < map.data.length; index += 4) {
        assert.equal(map.data[index + 3], 255, 'map alpha never introduces holes in the backdrop');
    }
});

test('Safari, iOS Chrome and unsupported URL filters retain the CSS fallback', () => {
    for (const options of [
        { userAgent: 'Mozilla/5.0 Version/18.0 Safari/605.1.15' },
        { userAgent: 'Mozilla/5.0 (iPhone) CriOS/132.0 Mobile Safari/604.1' },
        { supports: false }
    ]) {
        const f = fixture(options);
        f.visible();
        assert.equal(f.maps.length, 0);
        assert.equal(f.filters().length, 0);
        assert.equal(refraction(f.controls[0]), undefined);
        f.move();
        assert.ok(light(f.controls[0]), 'fallback still permits the CSS light interaction');
    }
});

test('reduced transparency and forced colors skip maps and disable existing refraction', () => {
    for (const preference of ['transparency', 'contrast']) {
        const f = fixture({ [preference]: true });
        f.visible();
        f.move();
        assert.equal(f.maps.length, 0);
        assert.equal(f.filters().length, 0);
        assert.equal(refraction(f.controls[0]), undefined);
        assert.equal(light(f.controls[0]), undefined);
        f.preference(preference, false);
        assert.ok(refraction(f.controls[0]));
        assert.equal(f.maps.length, 1);
        f.preference(preference, true);
        assert.equal(refraction(f.controls[0]), undefined);
        assert.equal(f.maps.length, 1, 'preference change does not allocate another map');
    }
});

test('reduced motion suppresses pointer response and changing the preference resets it', () => {
    const f = fixture({ motion: true });
    f.visible();
    assert.ok(refraction(f.controls[0]), 'static optics can remain while motion is reduced');
    f.move();
    assert.equal(light(f.controls[0]), undefined);
    f.preference('motion', false);
    f.move();
    assert.ok(light(f.controls[0]));
    f.preference('motion', true);
    assert.equal(light(f.controls[0]), undefined);
    f.move();
    assert.equal(light(f.controls[0]), undefined);
});

test('touch input, disabled controls, pointer exit and window blur do not leave moving highlights', () => {
    const f = fixture();
    const control = f.controls[0];
    f.move({ pointerType: 'touch' });
    assert.equal(light(control), undefined);
    control.disabled = true;
    f.move();
    assert.equal(light(control), undefined);
    control.disabled = false;
    f.move();
    assert.ok(light(control));
    f.document.dispatch('pointerout', { relatedTarget: null });
    assert.equal(light(control), undefined);
    f.move();
    f.window.dispatch('blur');
    assert.equal(light(control), undefined);
});

test('resizing through more than 64 geometries keeps refraction active with a bounded cache', () => {
    const f = fixture();
    const control = f.controls[0];
    f.visible();
    for (let width = 121; width <= 216; width++) {
        control.offsetWidth = width;
        f.resize();
        const value = refraction(control);
        assert.ok(value, `filter remains active at width ${width}`);
        const id = value.match(/#([^" ]+)/)[1];
        assert.ok(f.filters().some(filter => filter.attributes.id === id), 'the assigned filter must not be evicted');
        assert.ok(f.filters().length <= 64, 'obsolete geometry filters are bounded');
    }
    assert.equal(f.maps.length, 97);
    assert.equal(f.filters().length, 64);
    control.offsetWidth = 120;
    f.resize();
    assert.ok(refraction(control), 'an evicted geometry can be recreated when revisited');
    assert.equal(f.filters().length, 64);
});

test('missing canvas context degrades gracefully without installing an invalid filter', () => {
    const f = fixture({ canvas: false });
    f.visible();
    assert.equal(f.maps.length, 0);
    assert.equal(f.filters().length, 0);
    assert.equal(refraction(f.controls[0]), undefined);
});
