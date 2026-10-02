const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(desktop = true) {
    const frames = new Map();
    const events = {};
    const media = { matches: desktop, addEventListener(_, fn) { events.media = fn; } };
    const document = { hidden: false, addEventListener(name, fn) { events[name] = fn; } };
    let next = 0, intersect;
    const context = vm.createContext({
        window: { matchMedia: () => media }, document,
        requestAnimationFrame(fn) { frames.set(++next, fn); return next; },
        cancelAnimationFrame(id) { frames.delete(id); },
        IntersectionObserver: class {
            constructor(fn) { intersect = fn; }
            observe() {}
        }
    });
    const source = fs.readFileSync(path.join(__dirname, '../static/script.js'), 'utf8');
    vm.runInContext(source.slice(0, source.indexOf('gsap.registerPlugin')), context);
    return {
        create: context.window.createDesktopAnimationLoop, frames, document, media, events,
        visible(value) { intersect([{ isIntersecting: value }]); },
        tick() {
            const pending = [...frames.values()]; frames.clear();
            pending.forEach(fn => fn(16));
        }
    };
}

test('repeated animation requests produce only one frame and stop offscreen', () => {
    const h = harness(); let calls = 0;
    const loop = h.create({}, () => { calls++; loop.request(); });
    loop.request(); assert.equal(h.frames.size, 0);
    h.visible(true);
    for (let i = 0; i < 100; i++) loop.request();
    assert.equal(h.frames.size, 1);
    h.tick(); assert.equal(calls, 1); assert.equal(h.frames.size, 1);
    h.visible(false); assert.equal(h.frames.size, 0);
    h.tick(); assert.equal(calls, 1);
    h.visible(true); h.tick(); assert.equal(calls, 2);
});

test('hidden tabs and resize to tablet keep visibility and enabled guards', () => {
    const h = harness(); let enabled = true, calls = 0;
    const loop = h.create({}, () => { calls++; loop.request(); }, () => enabled);
    h.visible(true); h.tick();
    h.document.hidden = true; h.events.visibilitychange();
    h.media.matches = false; h.events.media(); loop.request();
    assert.equal(h.frames.size, 0);
    h.document.hidden = false; h.events.visibilitychange(); h.tick();
    assert.equal(calls, 2);
    enabled = false; h.tick(); assert.equal(calls, 2);
    h.visible(false); enabled = true; loop.request();
    assert.equal(h.frames.size, 0);
});

test('a page initially opened on mobile does not animate CSS-hidden sections', () => {
    const h = harness(false); let calls = 0;
    const loop = h.create({}, () => { calls++; loop.request(); });
    assert.equal(loop.desktop, false);
    loop.request(); h.visible(false); h.tick();
    assert.equal(calls, 0);
    h.media.matches = true; h.events.media(); h.visible(true); h.tick();
    assert.equal(calls, 1);
    loop.cancel(); assert.equal(h.frames.size, 0);
});
