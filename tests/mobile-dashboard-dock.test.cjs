const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../static/mobile-dashboard-dock.js'), 'utf8');

// Exercise the real event controller with a deterministic animation clock.
function setup({ mobile = true, reduced = false, roles = false } = {}) {
    let now = 0, nextId = 0;
    const work = { layouts: 0, paints: 0 };
    const frames = new Map(), timers = new Map(), navigations = [], observers = [];
    function flush() {
        for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
    function element(name, box = {}, classes = []) {
        const events = {}, attributes = {}, properties = {};
        const tokens = new Set(classes);
        const node = {
            name, textContent: name, events, attributes, properties,
            classList: {
                contains: key => tokens.has(key),
                add: (...keys) => keys.forEach(key => tokens.add(key)),
                remove: (...keys) => keys.forEach(key => tokens.delete(key)),
                toggle(key, value = !tokens.has(key)) { value ? tokens.add(key) : tokens.delete(key); return value; }
            },
            style: { setProperty: (key, value) => { properties[key] = value; }, removeProperty: key => { delete properties[key]; } },
            addEventListener: (type, callback) => { (events[type] ||= []).push(callback); },
            getAttribute: key => attributes[key],
            setAttribute(key, value) {
                attributes[key] = value;
                observers.filter(item => item.node === node && item.options.attributeFilter?.includes(key)).forEach(item => item.callback());
            },
            getBoundingClientRect: () => { work.layouts++; return { ...box, right: box.left + box.width, bottom: box.top + box.height }; },
            querySelector: selector => selector === 'span' || selector === '.nav-label-mobile' ? { textContent: name } : null,
            closest(selector) {
                if (selector.includes('.text-danger') && tokens.has('text-danger')) return node;
                return selector === '.nav-item' && tokens.has('nav-item') ? node : null;
            }
        };
        return node;
    }
    const dock = element('dock', { left: 16, top: 754, width: 358, height: roles ? 128 : 70 });
    Object.assign(dock, { clientWidth: 356, clientHeight: roles ? 126 : 68, clientLeft: 1, clientTop: 1 });
    let captured = null;
    dock.setPointerCapture = id => { captured = id; };
    dock.hasPointerCapture = id => captured === id;
    dock.releasePointerCapture = () => { captured = null; };
    const labels = roles ? ['Overview', 'PYQs', 'Contribute', 'Alerts', 'Users', 'UI Edit', 'Settings', 'Log Out'] : ['Overview', 'PYQs', 'Contribute', 'Settings', 'Log Out'];
    const columns = roles ? 4 : 5;
    const cellWidth = roles ? 82 : 66.8;
    const links = labels.map((name, index) => element(name, {
        left: 24 + index % columns * (cellWidth + 2), top: 763 + Math.floor(index / columns) * 56,
        width: cellWidth, height: 52
    }, ['nav-item', ...(index === 0 ? ['active'] : []), ...(name === 'Log Out' ? ['text-danger'] : [])]));
    const settings = links.find(item => item.name === 'Settings');
    settings.attributes['aria-expanded'] = 'false';
    const indicator = element('indicator'), bubble = element('bubble'), status = element('status');
    let transform = '';
    Object.defineProperty(indicator.style, 'transform', {
        get: () => transform,
        set(value) { work.paints++; transform = value; }
    });
    Object.defineProperty(bubble, 'offsetWidth', { get() { work.layouts++; return 100; } });
    bubble.querySelector = () => status;
    const queries = {
        '.mobile-dock-indicator': indicator, '.mobile-dock-destination': bubble,
        '.mobile-dock-status': status, '#settingsBtn': settings, '.text-danger': links.at(-1)
    };
    dock.querySelector = selector => queries[selector];
    dock.querySelectorAll = () => links.filter(item => ![settings, links.at(-1)].includes(item));
    const document = element('document');
    document.hidden = false;
    document.querySelector = () => dock;
    const window = element('window');
    const mobileMedia = { matches: mobile, addEventListener(type, fn) { this.change = fn; } };
    const reducedMedia = { matches: reduced, addEventListener(type, fn) { this.change = fn; } };
    window.matchMedia = query => query.includes('max-width') ? mobileMedia : reducedMedia;
    function dispatch(target, type, values = {}) {
        const event = {
            target, detail: 0, button: 0, isPrimary: true, pointerId: 1,
            ...values, preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() { this.stopped = true; }
        };
        for (const fn of dock.events[type] || []) { fn(event); if (event.stopped) break; }
        return event;
    }
    links.forEach(item => {
        item.click = () => {
            if (item.clicking) return;
            item.clicking = true;
            try {
                const event = dispatch(item, 'click');
                if (event.defaultPrevented) return;
                if (item === settings) settings.setAttribute('aria-expanded', String(settings.getAttribute('aria-expanded') !== 'true'));
                else navigations.push(item.name);
            } finally { item.clicking = false; }
        };
    });
    vm.runInNewContext(source, {
        document, window, performance: { now: () => now },
        requestAnimationFrame: fn => { const id = ++nextId; frames.set(id, fn); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id),
        MutationObserver: class { constructor(callback) { this.callback = callback; } observe(node, options) { observers.push({ callback: this.callback, node, options }); } },
        ResizeObserver: class { constructor(callback) { this.callback = callback; } observe(node) { observers.push({ callback: this.callback, node, resize: true }); } }
    });
    function advance(ms, refreshRate = 60) {
        flush();
        const end = now + ms;
        while (now < end) {
            now += Math.min(1000 / refreshRate, end - now);
            for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
            const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn(now));
            flush();
        }
    }
    function point(name) { const rect = links.find(item => item.name === name).getBoundingClientRect(); return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }; }
    function tap(name) {
        const item = links.find(item => item.name === name), values = point(name);
        dispatch(item, 'pointerdown', values); dispatch(item, 'pointerup', values);
        dispatch(item, 'click', { detail: 1 });
        flush();
    }
    function pose() { return indicator.style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px/).slice(1).map(value => Math.round(Number(value) * 1e6) / 1e6); }
    return { dock, links, settings, indicator, mobileMedia, reducedMedia, document, navigations, frames, advance, dispatch, point, tap, pose, work,
        resize: () => observers.filter(item => item.resize).forEach(item => item.callback()),
        accessibleClick: name => { links.find(item => item.name === name).click(); flush(); } };
}

test('manual taps ease through the intermediate positions before following the original link', () => {
    const ui = setup();
    const start = ui.pose()[0];
    ui.tap('PYQs');
    assert.deepEqual(ui.navigations, []);
    ui.advance(220);
    assert.ok(ui.pose()[0] > start && ui.pose()[0] < start + 66.8);
    ui.resize();
    assert.deepEqual(ui.navigations, [], 'an unchanged ResizeObserver notification must not finish the glide');
    ui.advance(1500);
    assert.deepEqual(ui.navigations, ['PYQs']);
    assert.equal(ui.frames.size, 0, 'no animation loop remains at rest');
});

test('tapping again mid-glide follows only the most recent destination', () => {
    const ui = setup();
    ui.tap('PYQs'); ui.advance(160);
    const before = ui.pose()[0];
    ui.tap('Contribute');
    assert.equal(ui.pose()[0], before, 'retargeting must not reset the position');
    ui.advance(1800);
    assert.deepEqual(ui.navigations, ['Contribute']);
});

test('dragging selects on release and pointer cancellation returns to the current page', () => {
    const ui = setup();
    const item = ui.links[0];
    ui.dispatch(item, 'pointerdown', ui.point('Overview'));
    ui.advance(150);
    assert.equal(ui.dock.classList.contains('dock-holding'), true);
    ui.dispatch(item, 'pointermove', ui.point('Contribute'));
    ui.advance(180);
    assert.deepEqual(ui.navigations, []);
    ui.dispatch(item, 'pointercancel');
    ui.advance(500);
    assert.deepEqual(ui.navigations, []);
    assert.equal(ui.pose()[0], 7);
    ui.dispatch(item, 'pointerdown', ui.point('Overview'));
    ui.dispatch(item, 'pointermove', ui.point('Contribute'));
    ui.dispatch(item, 'pointerup', ui.point('Contribute'));
    ui.advance(1400);
    assert.deepEqual(ui.navigations, ['Contribute']);
});

test('a drag over Log Out cannot activate the logout link', () => {
    const ui = setup();
    ui.dispatch(ui.links[0], 'pointerdown', ui.point('Overview'));
    ui.dispatch(ui.links[0], 'pointermove', ui.point('Log Out'));
    ui.dispatch(ui.links[0], 'pointerup', ui.point('Log Out'));
    ui.advance(1400);
    assert.deepEqual(ui.navigations, []);
    assert.equal(ui.pose()[0], 7);
});

test('Settings keeps its existing toggle and returning selection works across role rows', () => {
    const ui = setup({ roles: true });
    ui.tap('Settings'); ui.advance(1400);
    assert.equal(ui.settings.getAttribute('aria-expanded'), 'true');
    assert.ok(ui.pose()[1] > 50);
    ui.settings.setAttribute('aria-expanded', 'false'); ui.advance(1400);
    assert.deepEqual(ui.pose(), [7, 8]);
    assert.deepEqual(ui.navigations, []);
});

test('reduced motion follows the link without scheduling an animation', () => {
    const ui = setup({ reduced: true });
    ui.tap('PYQs');
    assert.deepEqual(ui.navigations, ['PYQs']);
    assert.equal(ui.frames.size, 0);
});

test('accessibility activation forwards a Settings click exactly once', () => {
    const ui = setup();
    ui.accessibleClick('Settings');
    assert.equal(ui.settings.getAttribute('aria-expanded'), 'true');
    ui.accessibleClick('Settings');
    assert.equal(ui.settings.getAttribute('aria-expanded'), 'false');
});

test('desktop and modified clicks keep the original browser behavior', () => {
    const desktop = setup({ mobile: false });
    assert.equal(desktop.dock.classList.contains('mobile-dock-ready'), false);
    assert.equal(desktop.dispatch(desktop.links[1], 'click').defaultPrevented, undefined);
    const phone = setup();
    assert.equal(phone.dispatch(phone.links[1], 'click', { metaKey: true }).defaultPrevented, undefined);
    assert.equal(phone.frames.size, 0);
});

test('bursts of drag input share one paint and do not force layout measurements', () => {
    const ui = setup();
    const start = ui.point('Overview'), end = ui.point('Contribute');
    ui.dispatch(ui.links[0], 'pointerdown', start);
    ui.advance(300);
    const layouts = ui.work.layouts, paints = ui.work.paints;
    for (let i = 1; i <= 24; i++) {
        ui.dispatch(ui.links[0], 'pointermove', {
            clientX: start.clientX + (end.clientX - start.clientX) * i / 24,
            clientY: end.clientY
        });
    }
    assert.equal(ui.work.layouts, layouts, 'drag events must use cached geometry');
    assert.equal(ui.work.paints, paints, 'input events must not repaint between display frames');
    assert.equal(ui.frames.size, 1);
    ui.advance(1000 / 120, 120);
    assert.equal(ui.work.paints, paints + 1);
    assert.equal(ui.work.layouts, layouts, 'the animation frame must not read layout either');
});

test('held dragging follows the latest finger position within one frame at 60 and 120 Hz', () => {
    for (const rate of [60, 120]) {
        const ui = setup();
        const start = ui.point('Overview'), end = ui.point('Contribute');
        ui.dispatch(ui.links[0], 'pointerdown', start);
        ui.advance(350, rate);
        ui.dispatch(ui.links[0], 'pointermove', end);
        ui.advance(1000 / rate, rate);
        const expected = 7 + end.clientX - start.clientX;
        assert.ok(Math.abs(ui.pose()[0] - expected) < .5, `finger tracking should not trail behind at ${rate} Hz`);
        ui.dispatch(ui.links[0], 'pointermove', start);
        ui.advance(1000 / rate, rate);
        assert.ok(Math.abs(ui.pose()[0] - 7) < .5, 'a direction change should follow the finger immediately');
        assert.equal(ui.frames.size, 0, 'a stationary held finger does not need an idle animation loop');
    }
});

test('picking up a different item uses the approved slow glide and a drag release settles promptly', () => {
    const ui = setup();
    ui.dispatch(ui.links[2], 'pointerdown', ui.point('Contribute'));
    ui.advance(140);
    assert.equal(ui.pose()[0], 7, 'holding another item must not teleport the indicator');
    ui.advance(260);
    assert.ok(Math.abs(ui.pose()[0] - 75.8) < .5, 'the glass should be halfway across at the middle of the 520ms pickup');
    ui.advance(260);
    assert.ok(Math.abs(ui.pose()[0] - 144.6) < .01, 'the pickup should land exactly without a trailing spring');
    const end = ui.point('PYQs');
    ui.dispatch(ui.links[2], 'pointermove', { ...end, clientX: end.clientX + 12 });
    ui.advance(17);
    ui.dispatch(ui.links[2], 'pointerup', { ...end, clientX: end.clientX + 12 });
    assert.deepEqual(ui.navigations, []);
    ui.advance(500);
    assert.deepEqual(ui.navigations, ['PYQs']);
    assert.equal(ui.frames.size, 0);
});

test('Overview to Settings has a gentle start and landing, stable dimensions and no idle work', () => {
    for (const rate of [60, 120]) {
        const ui = setup();
        const end = ui.point('Settings');
        ui.dispatch(ui.settings, 'pointerdown', end);
        ui.advance(140, rate);
        const start = ui.pose();
        ui.advance(20, rate);
        const initial = ui.pose();
        assert.ok(initial[0] - start[0] < .2, 'the held pickup must start with almost no movement');
        assert.ok(start[1] - initial[1] < .01, 'the 2px lift must ease in rather than jump');
        // A stationary thumb is never perfectly still; jitter must not cut the pickup short.
        ui.dispatch(ui.settings, 'pointermove', { ...end, clientX: end.clientX + 2 });
        ui.advance(240, rate);
        assert.ok(Math.abs(ui.pose()[0] - 110.2) < .01, 'touch jitter must preserve the original glide');
        assert.ok(Math.abs(ui.pose()[1] - 7) < .01, 'lift and travel should share the same easing');
        assert.ok(Math.abs(Number(ui.dock.properties['--dock-hold-progress']) - .5) < .01);
        ui.advance(240, rate);
        const nearLanding = ui.pose()[0];
        ui.advance(20, rate);
        assert.ok(ui.pose()[0] - nearLanding < .2, 'the glass must decelerate softly at the destination');
        assert.deepEqual(ui.pose(), [213.4, 6]);
        assert.doesNotMatch(ui.indicator.style.transform, /scale/, 'the glass must never squeeze or stretch');
        assert.equal(ui.settings.getAttribute('aria-expanded'), 'false', 'holding previews the destination without opening it');
        assert.equal(ui.frames.size, 0, 'no animation loop should remain under a stationary thumb');
        ui.dispatch(ui.settings, 'pointerup', end);
        assert.equal(ui.settings.getAttribute('aria-expanded'), 'false', 'the menu must wait for the glass to land');
        ui.advance(300, rate);
        assert.deepEqual(ui.pose(), [213.4, 8]);
        assert.equal(ui.settings.getAttribute('aria-expanded'), 'true');
        assert.equal(Number(ui.dock.properties['--dock-hold-progress']), 0);
        assert.equal(ui.frames.size, 0);
    }
});

test('dragging during pickup takes over smoothly, then tracks new input in one frame', () => {
    const ui = setup();
    const end = ui.point('Settings'), next = ui.point('PYQs');
    ui.dispatch(ui.settings, 'pointerdown', end);
    ui.advance(310);
    const before = ui.pose();
    ui.dispatch(ui.settings, 'pointermove', next);
    assert.deepEqual(ui.pose(), before, 'a retarget must not reset the rendered pose');
    ui.advance(1, 120);
    assert.ok(Math.abs(ui.pose()[0] - before[0]) < 1, 'a new finger target must preserve the existing motion');
    ui.advance(180, 120);
    assert.ok(Math.abs(ui.pose()[0] - 75.8) < .01, 'the short handoff must finish at the finger');
    ui.dispatch(ui.settings, 'pointermove', end);
    ui.advance(1000 / 120, 120);
    assert.ok(Math.abs(ui.pose()[0] - 213.4) < .01, 'subsequent movement should track within one frame');
    assert.equal(ui.frames.size, 0);
    ui.dispatch(ui.settings, 'pointercancel');
    ui.advance(300);
    assert.deepEqual(ui.pose(), [7, 8]);
    assert.deepEqual(ui.navigations, []);
});

test('releasing before pickup finishes continues from the current pose and opens Settings once', () => {
    const ui = setup();
    const end = ui.point('Settings');
    ui.dispatch(ui.settings, 'pointerdown', end);
    ui.advance(300);
    const before = ui.pose();
    ui.dispatch(ui.settings, 'pointerup', end);
    assert.deepEqual(ui.pose(), before, 'early release must not jump to the destination');
    assert.equal(ui.settings.getAttribute('aria-expanded'), 'false');
    ui.advance(300);
    assert.deepEqual(ui.pose(), [213.4, 8]);
    assert.equal(ui.settings.getAttribute('aria-expanded'), 'true');
    ui.advance(1000);
    assert.equal(ui.settings.getAttribute('aria-expanded'), 'true', 'the native toggle must only fire once');
    assert.equal(ui.frames.size, 0);
});

test('a fast drag release lands without carrying the glass into Log Out', () => {
    const ui = setup();
    const start = ui.point('Overview'), end = ui.point('Settings');
    ui.dispatch(ui.links[0], 'pointerdown', start);
    ui.advance(350);
    for (let i = 1; i <= 8; i++) {
        ui.dispatch(ui.links[0], 'pointermove', {
            clientX: start.clientX + (end.clientX - start.clientX) * i / 8,
            clientY: start.clientY
        });
        ui.advance(1000 / 120, 120);
    }
    ui.dispatch(ui.links[0], 'pointerup', end);
    for (let i = 0; i < 40; i++) {
        ui.advance(1000 / 120, 120);
        assert.ok(ui.pose()[0] <= 213.401, 'release momentum must not push the glass beyond Settings');
    }
    assert.equal(ui.settings.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(ui.navigations, []);
    assert.equal(ui.frames.size, 0);
});

test('tracking uses the newest coalesced sample and supports two-row role navigation', () => {
    const ui = setup({ roles: true });
    const start = ui.point('Overview'), end = ui.point('UI Edit');
    ui.dispatch(ui.links[0], 'pointerdown', start);
    ui.advance(350);
    ui.dispatch(ui.links[0], 'pointermove', { ...start, getCoalescedEvents: () => [start, end] });
    ui.advance(1000 / 120, 120);
    assert.deepEqual(ui.pose(), [91, 62]);
    ui.dispatch(ui.links[0], 'pointerup', end);
    ui.advance(500);
    assert.deepEqual(ui.navigations, ['UI Edit']);
    assert.equal(ui.frames.size, 0);
});

test('hiding the page cancels a held gesture without leaving animation work or navigation', () => {
    const ui = setup();
    ui.dispatch(ui.links[0], 'pointerdown', ui.point('Contribute'));
    ui.advance(170);
    ui.document.hidden = true;
    ui.document.events.visibilitychange.forEach(fn => fn());
    assert.equal(ui.frames.size, 0);
    ui.advance(1000);
    assert.deepEqual(ui.navigations, []);
});

test('native link dragging cannot interrupt an active mobile scrub', () => {
    const ui = setup();
    assert.equal(ui.dispatch(ui.links[0], 'dragstart').defaultPrevented, undefined);
    ui.dispatch(ui.links[0], 'pointerdown', ui.point('Overview'));
    assert.equal(ui.dispatch(ui.links[0], 'dragstart').defaultPrevented, true);
    ui.advance(150);
    assert.equal(ui.dispatch(ui.links[0], 'contextmenu').defaultPrevented, true);
    ui.dispatch(ui.links[0], 'pointercancel');
    assert.equal(ui.dispatch(ui.links[0], 'contextmenu').defaultPrevented, undefined);
    const desktop = setup({ mobile: false });
    desktop.dispatch(desktop.links[0], 'pointerdown', desktop.point('Overview'));
    assert.equal(desktop.dispatch(desktop.links[0], 'dragstart').defaultPrevented, undefined);
});
