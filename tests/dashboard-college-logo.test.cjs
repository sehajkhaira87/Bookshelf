const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../static/dashboard-college-logo.js'), 'utf8');

// Images can expose their dimensions while their download or decoding is unfinished.
function setup({ mobile = false, reduced = false, canvasAvailable = true } = {}) {
    const events = () => ({
        listeners: {},
        addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
        emit(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
    });
    const pencilImage = Object.assign(events(), {
        complete: false, naturalWidth: 0, decode: () => Promise.resolve()
    });
    const contexts = [];
    function makeCanvas() {
        const context = {
            draws: [],
            clearRect() {}, fillRect() {},
            drawImage(image) { this.draws.push({ image, loaded: image.complete !== false }); },
            createRadialGradient: () => ({ addColorStop() {} })
        };
        contexts.push(context);
        return { width: 256, height: 256, getContext: () => canvasAvailable ? context : null };
    }
    const canvas = makeCanvas(), classes = new Set();
    const button = Object.assign(events(), {
        dataset: { colourSrc: '/gndec-logo.png', state: 'pencil' },
        classList: { add: key => classes.add(key), remove: key => classes.delete(key) },
        querySelector: selector => selector === '.college-canvas' ? canvas : pencilImage,
        hasAttribute: () => mobile,
        matches: () => true,
        setAttribute() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 52, height: 52 })
    });
    const viewport = Object.assign(events(), { matches: true });
    const motion = Object.assign(events(), { matches: reduced });
    const document = Object.assign(events(), {
        body: {}, hidden: false,
        querySelectorAll: () => [button],
        createElement: () => makeCanvas()
    });
    const window = Object.assign(events(), { matchMedia: query => query.includes('reduced-motion') ? motion : viewport });
    let colourImage;
    let frameId = 0, now = 0;
    const frames = new Map();
    vm.runInNewContext(source, {
        window, document,
        Image: function () {
            colourImage = Object.assign(events(), { complete: false, naturalWidth: 0, decode: () => Promise.resolve() });
            return colourImage;
        },
        getComputedStyle: () => ({ getPropertyValue: () => '#514237' }),
        requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
        MutationObserver: class { observe() {} }
    });
    function loaded(image) {
        Object.assign(image, { complete: true, naturalWidth: 256 });
        image.emit('load');
    }
    async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
    function advance(ms) {
        const end = now + ms;
        while (now < end && frames.size) {
            now += 1000 / 60;
            const next = [...frames.values()]; frames.clear(); next.forEach(fn => fn(now));
        }
    }
    return {
        button, pencilImage, colourImage, contexts, viewport, document, frames,
        loaded, settle, advance, ready: () => classes.has('is-ready'),
        hover: () => button.emit('pointerenter', { pointerType: 'mouse', clientX: 20, clientY: 20 })
    };
}

test('a partial colour download never replaces the visible pencil with an empty canvas', async () => {
    const ui = setup();
    ui.colourImage.naturalWidth = 256;
    ui.loaded(ui.pencilImage);
    await ui.settle();
    ui.hover();
    assert.equal(ui.ready(), false);
    assert.equal(ui.frames.size, 0);
    assert.equal(ui.contexts.flatMap(ctx => ctx.draws).some(draw => !draw.loaded), false);
    ui.loaded(ui.colourImage);
    await ui.settle();
    assert.equal(ui.ready(), true);
    ui.advance(12000);
    assert.equal(ui.button.dataset.state, 'colour', 'an early hover is honoured after the download completes');
});

test('the pencil download must also finish before canvas replaces it', async () => {
    const ui = setup();
    ui.pencilImage.naturalWidth = 256;
    ui.loaded(ui.colourImage);
    await ui.settle();
    assert.equal(ui.ready(), false);
    ui.loaded(ui.pencilImage);
    await ui.settle();
    assert.equal(ui.ready(), true);
});

test('both images finish decoding before the pencil fallback is hidden', async () => {
    const ui = setup();
    let finishDecoding;
    ui.colourImage.decode = () => new Promise(resolve => { finishDecoding = resolve; });
    ui.loaded(ui.pencilImage);
    ui.loaded(ui.colourImage);
    await ui.settle();
    assert.equal(ui.ready(), false);
    finishDecoding();
    await ui.settle();
    assert.equal(ui.ready(), true);
});

test('an unsuccessful decode keeps the pencil visible and schedules no animation', async () => {
    const ui = setup();
    ui.colourImage.decode = () => Promise.reject(new Error('Image decoding failed'));
    ui.loaded(ui.pencilImage);
    ui.loaded(ui.colourImage);
    await ui.settle();
    ui.hover();
    assert.equal(ui.ready(), false);
    assert.equal(ui.frames.size, 0);
    assert.equal(ui.button.dataset.state, 'unavailable');
});

test('a failed colour download leaves the pencil fallback visible', async () => {
    const ui = setup();
    ui.loaded(ui.pencilImage);
    ui.colourImage.complete = true;
    ui.colourImage.emit('error');
    await ui.settle();
    ui.hover();
    assert.equal(ui.ready(), false);
    assert.equal(ui.frames.size, 0);
    assert.equal(ui.button.dataset.state, 'unavailable');
});

test('hover reverses smoothly and the controller stops when idle', async () => {
    const ui = setup();
    ui.loaded(ui.pencilImage); ui.loaded(ui.colourImage);
    await ui.settle();
    ui.hover(); ui.advance(600);
    assert.equal(ui.button.dataset.state, 'revealing');
    ui.button.emit('pointerleave'); ui.advance(12000);
    assert.equal(ui.button.dataset.state, 'pencil');
    assert.equal(ui.frames.size, 0);
    ui.hover(); ui.advance(12000);
    assert.equal(ui.button.dataset.state, 'colour');
    assert.equal(ui.frames.size, 0);
});

test('mobile touch still toggles colour and reduced motion avoids animation', async () => {
    const ui = setup({ mobile: true, reduced: true });
    ui.loaded(ui.pencilImage); ui.loaded(ui.colourImage);
    await ui.settle();
    ui.button.emit('pointerdown', { pointerType: 'touch' });
    ui.button.emit('click', { detail: 1 });
    assert.equal(ui.button.dataset.state, 'colour');
    ui.button.emit('click', { detail: 1 });
    assert.equal(ui.button.dataset.state, 'pencil');
    assert.equal(ui.frames.size, 0);
});

test('the static logo stays available when canvas is unsupported', () => {
    const ui = setup({ canvasAvailable: false });
    assert.equal(ui.ready(), false);
    assert.equal(ui.frames.size, 0);
});
