const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bootstrap = fs.readFileSync(require.resolve('../static/home-bootstrap.js'), 'utf8');
const mobileScript = fs.readFileSync(require.resolve('../static/mobile-home.js'), 'utf8');
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

test('a failed optional desktop library cannot leave the page trapped in a loader', async () => {
    const home = startup(false, 'gsap.min');
    await flush();
    assert.equal(home.loaderRemoved, true);
});

function element() {
    const classes = new Set(), listeners = {};
    return { classes, listeners, classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
        addEventListener(type, fn) { listeners[type] = fn; }, setPointerCapture() {} };
}
test('mobile cards respond to dots and horizontal swipes, ignoring taps, vertical motion and cancellation', () => {
    const cards = Array.from({ length: 4 }, element), dots = Array.from({ length: 4 }, element);
    const track = element(), media = mediaQuery(true);
    track.querySelectorAll = () => cards;
    vm.runInNewContext(mobileScript, {
        window: { matchMedia: () => media },
        document: { getElementById: () => track, querySelectorAll: () => dots }
    });
    const active = () => cards.findIndex(card => card.classes.has('card-active'));
    const swipe = (dx, dy, cancel = false) => {
        track.listeners.pointerdown({ isPrimary: true, button: 0, pointerId: 1, clientX: 200, clientY: 500 });
        if (cancel) track.listeners.pointercancel();
        track.listeners.pointerup({ pointerId: 1, clientX: 200 + dx, clientY: 500 + dy });
    };
    assert.equal(active(), 0);
    dots[2].listeners.click(); assert.equal(active(), 2);
    swipe(-100, 0); assert.equal(active(), 3);
    swipe(-100, 0); assert.equal(active(), 0);
    swipe(100, 0); assert.equal(active(), 3);
    swipe(4, 0); swipe(0, 100); swipe(-100, 0, true);
    assert.equal(active(), 3);
    media.change(false); swipe(-100, 0); assert.equal(active(), 3);
});
