const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../static/mobile-dashboard-dock.js'), 'utf8');

// Exercise the real event controller with a deterministic animation clock.
function setup({ mobile = true, reduced = false, roles = false } = {}) {
    let now = 0, nextId = 0;
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
            getBoundingClientRect: () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height }),
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
    bubble.offsetWidth = 100;
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
    function advance(ms) {
        flush();
        const end = now + ms;
        while (now < end) {
            now += Math.min(1000 / 60, end - now);
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
    function pose() { return indicator.style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px/).slice(1).map(Number); }
    return { dock, links, settings, indicator, mobileMedia, reducedMedia, document, navigations, frames, advance, dispatch, point, tap, pose,
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
    ui.advance(1400);
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
