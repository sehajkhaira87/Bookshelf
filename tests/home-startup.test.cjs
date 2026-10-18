const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bootstrap = fs.readFileSync(require.resolve('../static/home-bootstrap.js'), 'utf8');
const flush = () => new Promise(setImmediate);

function mediaQuery(matches) {
    const listeners = [];
    return { matches, addEventListener(type, fn) { listeners.push(fn); }, change(value) {
        this.matches = value; listeners.forEach(fn => fn());
    } };
}
function startup(phone, fail = '', reduced = false, intro) {
    const media = mediaQuery(phone), scripts = [], dataset = {};
    const timers = new Map(), classes = new Set(), listeners = {};
    let loaderRemoved = false;
    let finishLogo;
    const logo = { decode: () => Promise.resolve(), getAnimations: () => [{
        finished: new Promise(resolve => { finishLogo = resolve; })
    }] };
    const loader = {
        remove() { loaderRemoved = true; }, querySelector: () => logo,
        classList: { add(name) { classes.add(name); } },
        addEventListener(type, fn) { listeners[type] = fn; }
    };
    const document = {
        documentElement: { dataset }, currentScript: { dataset: { staticBase: '/static/' } },
        getElementById() { return loaderRemoved ? null : loader; },
        querySelectorAll: () => [logo], fonts: { ready: Promise.resolve() },
        querySelector: selector => intro?.selectors[selector] ?? null,
        createElement: tag => tag === 'span' && intro ? intro.makeElement() : {},
        createDocumentFragment() { return { children: [], appendChild(child) { this.children.push(child); } }; },
        body: { appendChild(script) {
            scripts.push(script);
            queueMicrotask(() => script.src.includes(fail) && fail ? script.onerror() : script.onload());
        } }
    };
    vm.runInNewContext(bootstrap, {
        document, window: { matchMedia: query => query.includes('reduced-motion') ? { matches: reduced } : media },
        console: { error() {} },
        setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    return { media, scripts, dataset, classes, finishLogo,
        transition(propertyName = 'transform') { listeners.transitionend({ target: loader, propertyName }); },
        expire(ms) {
            const entry = [...timers].find(([, timer]) => timer.ms === ms);
            assert.ok(entry, `Missing ${ms}ms safety timer`);
            timers.delete(entry[0]); entry[1].fn();
        },
        get loaderRemoved() { return loaderRemoved; }
    };
}

test('a phone keeps the Bookshelf animation and reveals using only the local mobile script', async () => {
    const home = startup(true);
    assert.equal(home.loaderRemoved, false);
    assert.equal(home.dataset.homeRuntime, 'mobile');
    await flush();
    assert.deepEqual(home.scripts.map(s => s.src), ['/static/mobile-home.js']);
    assert.equal(home.classes.has('hide-loader'), false, 'the logo should finish before the reveal');
    home.finishLogo(); await flush();
    assert.equal(home.classes.has('hide-loader'), true);
    assert.equal(home.loaderRemoved, false, 'the curtain should finish sliding before removal');
    home.transition('opacity'); assert.equal(home.loaderRemoved, false);
    home.transition(); assert.equal(home.loaderRemoved, true);
});

test('reduced motion skips the mobile loader animation without loading desktop effects', async () => {
    const home = startup(true, '', true);
    assert.equal(home.loaderRemoved, true);
    await flush();
    assert.deepEqual(home.scripts.map(s => s.src), ['/static/mobile-home.js']);
});

test('a stalled mobile asset or missing transition event cannot trap the loader', async () => {
    const home = startup(true);
    home.expire(3500); await flush();
    assert.equal(home.classes.has('hide-loader'), true);
    home.expire(1250);
    assert.equal(home.loaderRemoved, true);
});

test('failed mobile interaction code still reveals the page when the logo finishes', async () => {
    const home = startup(true, 'mobile-home.js');
    home.finishLogo(); await flush();
    assert.equal(home.classes.has('hide-loader'), true);
    home.transition(); assert.equal(home.loaderRemoved, true);
});

function headingIntro() {
    const animations = [];
    const makeElement = () => ({
        children: [],
        get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; },
        set textContent(text) { this.text = text; this.children = []; },
        replaceChildren(fragment) { this.children = fragment.children; },
        animate(keyframes, options) {
            let finish;
            const animation = { keyframes, options, cancelled: false,
                finished: new Promise(resolve => { finish = resolve; }),
                cancel() { this.cancelled = true; finish(); },
                finish() { finish(); }
            };
            animations.push(animation);
            return animation;
        }
    });
    const lines = ['EVERYTHING', 'EXACTLY WHERE', 'IT BELONGS.'].map(text => {
        const line = makeElement(); line.textContent = text; return line;
    });
    const title = makeElement(); title.querySelectorAll = () => lines;
    return { animations, lines, makeElement, selectors: {
        '.hero-title': title, '.tag-line': makeElement(), '.tag-text': makeElement()
    } };
}

test('the mobile letter rise starts with the curtain and returns to normal text after finishing', async () => {
    const intro = headingIntro(), home = startup(true, '', false, intro);
    await flush();
    assert.equal(intro.animations.length, 0, 'text must wait for the loader reveal');
    home.finishLogo(); await flush();
    assert.equal(home.classes.has('hide-loader'), true);
    const letters = intro.animations.filter(animation => animation.options.duration === 820);
    assert.equal(letters.length, 34);
    assert.equal(letters[0].keyframes[0].transform, 'translateY(28px)');
    assert.equal(letters[0].options.easing, 'cubic-bezier(.22,.8,.3,1)');
    letters.forEach((animation, i) => assert.equal(animation.options.delay, 500 + i * 30));
    assert.deepEqual(intro.animations.slice(-2).map(animation => animation.options.delay), [2300, 2300]);
    intro.animations.forEach(animation => animation.finish()); await flush();
    assert.deepEqual(intro.lines.map(line => line.textContent), ['EVERYTHING', 'EXACTLY WHERE', 'IT BELONGS.']);
    assert.ok(intro.lines.every(line => line.children.length === 0));
});

test('reduced motion leaves the mobile heading readable without splitting or animating it', async () => {
    const intro = headingIntro(), home = startup(true, '', true, intro);
    await flush();
    assert.equal(home.loaderRemoved, true);
    assert.equal(intro.animations.length, 0);
    assert.ok(intro.lines.every(line => line.children.length === 0));
});

test('resizing to desktop cancels the phone entrance before desktop effects take ownership', async () => {
    const intro = headingIntro(), home = startup(true, '', false, intro);
    home.finishLogo(); await flush();
    home.media.change(false); await flush();
    assert.ok(intro.animations.every(animation => animation.cancelled));
    assert.ok(intro.lines.every(line => line.children.length === 0));
    assert.equal(home.dataset.homeRuntime, 'desktop');
});

test('desktop startup preserves vendor execution order and loads all existing effects', async () => {
    const home = startup(false);
    assert.equal(home.scripts.length, 4, 'vendor downloads should overlap');
    assert.ok(home.scripts.every(s => s.async === false));
    assert.match(home.scripts[0].src, /lenis/);
    assert.match(home.scripts[1].src, /gsap.min/);
    assert.match(home.scripts[2].src, /ScrollTrigger/);
    assert.match(home.scripts[3].src, /split-type/);
    await flush();
    for (const filename of ['hero-intro.js', 'three.js', 'bulb-physics.js', 'script.js', 'grid-bg.js', 'page-wheel.js', 'page2-narrative.js']) {
        assert.ok(home.scripts.some(s => s.src === '/static/' + filename), filename);
    }
    assert.equal(home.scripts.find(s => s.src === '/static/three.js').type, 'module');
});

test('crossing the breakpoint does not download or initialize the same runtime twice', async () => {
    const home = startup(true);
    await flush();
    home.media.change(false); await flush();
    home.media.change(true); home.media.change(false); await flush();
    assert.equal(home.scripts.filter(s => s.src === '/static/mobile-home.js').length, 1);
    assert.equal(home.scripts.filter(s => s.src === '/static/script.js').length, 1);
});

test('a missing optional creators script does not stop the remaining desktop effects', async () => {
    const home = startup(false, 'creators-shelf.js');
    await flush();
    for (const filename of ['grid-bg.js', 'page-wheel.js', 'page2-narrative.js']) {
        assert.ok(home.scripts.some(script => script.src === '/static/' + filename), filename);
    }
});

test('a failed optional desktop library cannot leave the page trapped in a loader', async () => {
    const home = startup(false, 'gsap.min');
    await flush();
    assert.equal(home.loaderRemoved, true);
});

const source = fs.readFileSync(require.resolve('../static/mobile-home.js'), 'utf8');

function setup({ reduced = false } = {}) {
    let now = 0, nextFrame = 0;
    const frames = new Map();
    function element() {
        const classes = new Set(), attributes = {}, events = {}, properties = {};
        let captured;
        return {
            classes, attributes, events, properties, textContent: '',
            classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); } },
            style: { setProperty(name, value) { properties[name] = value; } },
            addEventListener(type, fn) { (events[type] ||= []).push(fn); },
            setAttribute(name, value) { attributes[name] = value; },
            removeAttribute(name) { delete attributes[name]; },
            setPointerCapture(id) { captured = id; },
            hasPointerCapture(id) { return captured === id; },
            releasePointerCapture() { captured = undefined; },
            getBoundingClientRect: () => ({ left: 100, width: 88 }),
            fire(type, values = {}) {
                const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 111, clientY: 700,
                    preventDefault() {}, ...values };
                for (const fn of events[type] || []) fn(event);
            }
        };
    }
    function media(matches) {
        return { ...element(), matches, change(matches) { this.matches = matches; this.fire('change'); } };
    }
    const mobile = media(true), reducedMotion = media(reduced);
    const track = element(), rail = element(), selector = element(), status = element();
    rail.querySelectorAll = () => [];
    rail.append = () => {};
    const cards = ['All in One Place', 'Save Your Time', 'Trusted Content', 'Made for You'].map(title => {
        const card = element(); card.querySelector = () => ({ textContent: title }); return card;
    });
    track.querySelectorAll = () => cards;
    const nodes = { featuresTrack: track, featureDots: rail };
    let spans = 0;
    const document = { ...element(), hidden: false, getElementById: id => nodes[id],
        createElement: tag => tag === 'input' ? selector : ++spans === 1 ? element() : status };
    const window = { ...element(), matchMedia: query => query.includes('reduced-motion') ? reducedMotion : mobile };
    vm.runInNewContext(source, {
        document, window,
        requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
        cancelAnimationFrame(id) { frames.delete(id); }
    });
    function advance(ms) {
        const end = now + ms;
        while (now < end) {
            now += Math.min(1000 / 60, end - now);
            const callbacks = [...frames.values()]; frames.clear();
            callbacks.forEach(fn => fn(now));
        }
    }
    const active = () => cards.findIndex(card => card.classes.has('card-active'));
    const position = () => Number.parseFloat(rail.properties['--feature-bar-x']);
    const tap = index => {
        const point = { clientX: 111 + 22 * index };
        selector.fire('pointerdown', point); selector.fire('pointerup', point);
    };
    const swipe = (dx, dy = 0, cancel = false) => {
        track.fire('pointerdown', { clientX: 200, clientY: 500 });
        if (cancel) track.fire('pointercancel');
        track.fire('pointerup', { clientX: 200 + dx, clientY: 500 + dy });
    };
    return { track, rail, selector, status, cards, document, window, mobile, reducedMotion, frames, active, position, tap, swipe, advance };
}

test('cards retain horizontal swipe thresholds, wrapping, and cancellation', () => {
    const ui = setup();
    assert.equal(ui.active(), 0);
    ui.swipe(-100); assert.equal(ui.active(), 1);
    ui.swipe(100); assert.equal(ui.active(), 0);
    ui.swipe(100); assert.equal(ui.active(), 3);
    ui.swipe(-100); assert.equal(ui.active(), 0);
    ui.swipe(4); ui.swipe(0, 100); ui.swipe(-100, 0, true);
    assert.equal(ui.active(), 0);
    assert.ok(ui.cards[1].classes.has('card-next'));
});

test('tapping changes the card as before while the indicator glides and stops at rest', () => {
    const ui = setup();
    ui.tap(2);
    assert.equal(ui.active(), 2);
    assert.equal(ui.position(), 0, 'the bar must not jump to the destination');
    ui.advance(220);
    assert.ok(ui.position() > 0 && ui.position() < 44);
    ui.advance(1600);
    assert.equal(ui.position(), 44);
    assert.equal(ui.status.textContent, 'Trusted Content');
    assert.equal(ui.frames.size, 0, 'no idle animation loop');
});

test('dragging moves only the indicator until release and clamps at the ends', () => {
    const ui = setup();
    ui.selector.fire('pointerdown');
    ui.selector.fire('pointermove', { clientX: 159 });
    ui.advance(200);
    assert.ok(ui.position() > 0);
    assert.equal(ui.active(), 0, 'dragging the bar must not move or replace a card');
    ui.selector.fire('pointerup', { clientX: 159 });
    assert.equal(ui.active(), 2);
    ui.advance(1600); assert.equal(ui.position(), 44);
    ui.selector.fire('pointerdown', { clientX: 155 });
    ui.selector.fire('pointermove', { clientX: 900 });
    ui.selector.fire('pointerup', { clientX: 900 });
    ui.advance(1600);
    assert.equal(ui.active(), 3); assert.equal(ui.position(), 66);
});

test('bar cancellation and lost capture restore the selected card and indicator', () => {
    for (const reason of ['pointercancel', 'lostpointercapture']) {
        const ui = setup();
        ui.selector.fire('pointerdown');
        ui.selector.fire('pointermove', { clientX: 177 });
        ui.advance(150);
        ui.selector.fire(reason);
        ui.advance(1600);
        assert.equal(ui.active(), 0); assert.equal(ui.position(), 0);
        assert.equal(ui.frames.size, 0);
    }
});

test('a new tap retargets from the current position without jumping', () => {
    const ui = setup();
    ui.tap(3); ui.advance(180);
    const before = ui.position();
    ui.tap(1); assert.equal(ui.position(), before);
    ui.advance(1600);
    assert.equal(ui.active(), 1); assert.equal(ui.position(), 22);
});

test('keyboard selection stays bounded and reduced motion schedules no animation', () => {
    const ui = setup({ reduced: true });
    ui.selector.fire('keydown', { key: 'End' });
    assert.equal(ui.active(), 3); assert.equal(ui.position(), 66);
    ui.selector.fire('keydown', { key: 'ArrowRight' });
    assert.equal(ui.active(), 3);
    ui.selector.fire('keydown', { key: 'Home' });
    ui.selector.fire('keydown', { key: 'ArrowRight' });
    assert.equal(ui.active(), 1); assert.equal(ui.position(), 22);
    assert.equal(ui.selector.attributes['aria-valuetext'], 'Save Your Time');
    assert.equal(ui.frames.size, 0);
});

test('leaving mobile restores all desktop cards and cancels motion', () => {
    const ui = setup();
    ui.tap(2); ui.advance(120); ui.mobile.change(false);
    assert.equal(ui.frames.size, 0);
    assert.ok(ui.cards.every(card => !('aria-hidden' in card.attributes)));
    ui.swipe(-100); ui.tap(1); assert.equal(ui.active(), 2);
    ui.mobile.change(true);
    assert.equal(ui.position(), 44);
    assert.equal(ui.cards[2].attributes['aria-hidden'], 'false');
});

test('backgrounding or enabling reduced motion stops a running glide', () => {
    for (const reason of ['hidden', 'reduced']) {
        const ui = setup();
        ui.tap(3); ui.advance(100);
        if (reason === 'hidden') { ui.document.hidden = true; ui.document.fire('visibilitychange'); }
        else ui.reducedMotion.change(true);
        assert.equal(ui.position(), 66);
        assert.equal(ui.frames.size, 0);
    }
});
