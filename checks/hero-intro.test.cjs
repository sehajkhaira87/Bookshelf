const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ mobile = false, reduced = false } = {}) {
    let now = 0, splitCount = 0, playCount = 0, refreshCount = 0;
    const timers = [], animations = [], errors = [];
    const later = (fn, ms = 0) => timers.push({ at: now + ms, fn });
    const node = text => ({
        textContent: text, style: {}, children: [],
        appendChild(child) { this.children.push(child); },
        replaceChildren(fragment) { this.children = fragment.children; },
        animate(...args) { animations.push({ target: this, args }); }
    });
    const lines = [node('ABC DEF'), node('GHI')];
    const title = node('ABC DEF GHI');
    title.querySelectorAll = () => lines;
    const loader = { hidden: false, removed: false,
        classList: { add() { loader.hidden = true; } },
        remove() { this.removed = true; }, addEventListener() {} };
    const elements = { '.hero-title': title, '.tag-line': node(''), '.tag-text': node('Tag') };
    const gsap = {
        set() {},
        ticker: { add(fn) { later(fn, 1); } },
        timeline({ onComplete }) {
            return { to() { return this; }, kill() {},
                play() { playCount++; later(onComplete, 3800); } };
        }
    };
    const context = vm.createContext({
        window: {}, performance: { now: () => now }, setTimeout: later,
        requestAnimationFrame: fn => later(fn, 16),
        matchMedia: query => ({ matches: query.includes('reduce') ? reduced : mobile }),
        document: {
            getElementById: () => loader, querySelector: selector => elements[selector],
            querySelectorAll: () => [], createDocumentFragment: () => node(''),
            createElement: () => node(''), fonts: { load: () => Promise.resolve() }
        },
        console: { error: (...args) => errors.push(args) }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/hero-intro.js'), 'utf8'), context);
    const intro = context.window.bookshelfIntro;
    const start = () => intro.start({ gsap,
        SplitType: function () { splitCount++; this.chars = [...'ABCDEFGHI'].map(node); },
        refresh() { refreshCount++; } });
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    async function advance(target) {
        await flush();
        while (true) {
            timers.sort((a, b) => a.at - b.at);
            if (!timers.length || timers[0].at > target) break;
            const timer = timers.shift(); now = timer.at; timer.fn(); await flush();
        }
        now = target; await flush();
    }
    return { intro, start, advance, loader, lines, animations, errors,
        counts: () => ({ splitCount, playCount, refreshCount }) };
}

test('critical preparation completes behind the loader before one reveal starts', async () => {
    const f = fixture(); let prepared;
    f.intro.hold(new Promise(resolve => { prepared = resolve; }));
    f.start();
    await f.advance(2200);
    assert.equal(f.intro.phase, 'loading');
    assert.equal(f.loader.hidden, false);
    assert.equal(f.counts().splitCount, 0);
    prepared(); await f.advance(2300);
    assert.equal(f.intro.phase, 'revealing');
    assert.equal(f.loader.hidden, true);
    assert.deepEqual(f.counts(), { splitCount: 1, playCount: 1, refreshCount: 1 });
    await f.advance(6500); await f.intro.ready;
    assert.equal(f.intro.phase, 'ready');
    assert.equal(f.loader.removed, true);
});

test('a stalled or failed optional asset cannot trap the page behind the loader', async () => {
    const f = fixture();
    f.intro.hold(Promise.reject(new Error('asset unavailable')));
    f.intro.hold(new Promise(() => {}));
    f.start();
    await f.advance(4999); assert.equal(f.intro.phase, 'loading');
    await f.advance(5100); assert.equal(f.intro.phase, 'revealing');
    await f.advance(9100); await f.intro.ready;
    assert.equal(f.loader.removed, true);
    assert.deepEqual(f.errors, []);
});

test('mobile letters have one animation each even if startup is requested twice', async () => {
    const f = fixture({ mobile: true });
    f.start(); f.start();
    await f.advance(1700);
    assert.equal(f.counts().splitCount, 0);
    assert.equal(f.counts().playCount, 1);
    const letters = f.lines.flatMap(line => line.children);
    assert.equal(letters.length, 10);
    assert(letters.every(letter => letter.children.length === 0));
    assert.equal(f.animations.length, letters.length);
    assert.equal(new Set(f.animations.map(a => a.target)).size, letters.length);
    await f.advance(6000); await f.intro.ready;
});

test('reduced motion shows the original unsplit heading without waiting for animation', async () => {
    const f = fixture({ reduced: true });
    f.start(); await f.advance(1700); await f.intro.ready;
    assert.equal(f.intro.phase, 'ready');
    assert.equal(f.counts().splitCount, 0);
    assert.equal(f.counts().playCount, 0);
    assert.equal(f.loader.removed, true);
});
