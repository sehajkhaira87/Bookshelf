// Run with Node's test runner and Playwright installed. A shared installation
// can be supplied through PLAYWRIGHT_MODULE_PATH; BROWSER_EXECUTABLE_PATH is
// optional when using a system Chromium/Edge instead of Playwright's browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')); }
catch { /* The browser checks are optional when only running the pure JS suite. */ }
const browserOptions = { headless: true };
if (process.env.BROWSER_EXECUTABLE_PATH) browserOptions.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
const source = name => fs.readFileSync(path.join(__dirname, '..', 'static', name), 'utf8');
const manualClock = `
window.createDesktopAnimationLoop = (element, render) => {
    window.tick = render;
    return { desktop: true, request() {} };
};
window.ResizeObserver = class { observe() {} };
window.strokeCount = 0;
const originalStroke = CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.stroke = function (...args) {
    window.strokeCount++;
    return originalStroke.apply(this, args);
};`;

test('partial grid redraw matches a full redraw at common Windows display scales', { skip: !chromium }, async () => {
    const production = source('grid-bg.js');
    // The reference uses precisely the current grid geometry and shading,
    // but clears/replays every segment. This detects stale pixels and clip
    // seams without storing screenshots or a second copy of the algorithm.
    assert(production.includes('if (desktop && !dirty)'));
    assert(production.includes('if (dirty || damage)'));
    const fullRedraw = production
        .replace('if (desktop && !dirty)', 'if (false)')
        .replace('if (dirty || damage)', 'if (true)');
    const browser = await chromium.launch(browserOptions);
    try {
        for (const deviceScaleFactor of [1, 1.25, 2]) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
            const pages = await Promise.all([context.newPage(), context.newPage()]);
            for (let i = 0; i < pages.length; i++) {
                await pages[i].setContent(`<style>html,body{margin:0}.page2{position:relative;width:1440px;height:900px}canvas{position:absolute;inset:0}</style><section class="page2"><canvas id="grid-bg-canvas"></canvas></section><script>${manualClock}</script>`);
                await pages[i].addScriptTag({ content: i ? production : fullRedraw });
                await pages[i].evaluate(() => tick());
            }
            for (const point of [[700, 430], [100, 100], [1439, 899], [50, 850], [-1, -1], [1000, 400]]) {
                await Promise.all(pages.map(page => page.evaluate(([x, y]) => {
                    document.querySelector('.page2').dispatchEvent(new MouseEvent(x < 0 ? 'mouseleave' : 'mousemove', { clientX: x, clientY: y }));
                }, point)));
                for (let sample = 0; sample < 4; sample++) {
                    const pixels = await Promise.all(pages.map(page => page.evaluate(() => {
                        for (let frame = 0; frame < 8; frame++) tick();
                        return document.querySelector('canvas').toDataURL();
                    })));
                    assert.equal(pixels[1], pixels[0], `Grid differs at scale ${deviceScaleFactor}, pointer ${point}, sample ${sample}`);
                }
            }
            const strokes = await Promise.all(pages.map(page => page.evaluate(() => strokeCount)));
            assert(strokes[1] < strokes[0] * 0.3, `Partial redraw did not reduce strokes sufficiently: ${strokes}`);
            await context.close();
        }
    } finally { await browser.close(); }
});

test('wheel selection follows displayed z-index and movement does not cause layout', { skip: !chromium }, async () => {
    const browser = await chromium.launch(browserOptions);
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.setContent(`<style>html,body{margin:0}.page-wheel{position:absolute;inset:0;width:52%;perspective:1500px}.page-wheel-stage{position:absolute;inset:0;transform-style:preserve-3d}</style><div id="pageWheel" class="page-wheel"></div><script>${manualClock}
window.frontEvents = [];
window.addEventListener('pagewheelchange', event => frontEvents.push(event.detail.index));
</script>`);
        await page.addScriptTag({ content: source('page-wheel.js') });
        await page.evaluate(() => { tick(); document.body.getBoundingClientRect(); });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
        const before = (await cdp.send('Performance.getMetrics')).metrics;
        const result = await page.evaluate(() => {
            let mismatch = false;
            const observed = [window.pageWheelFrontIndex];
            const stage = document.querySelector('.page-wheel-stage');
            for (let frame = 0; frame < 240; frame++) {
                setPageWheelProgress((Math.sin(frame / 30) + 1) / 2);
                tick();
                const cards = [...stage.children].filter(card => card.style.zIndex !== '');
                let best = 0;
                for (let i = 1; i < cards.length; i++) {
                    if (+cards[i].style.zIndex > +cards[best].style.zIndex) best = i;
                }
                if (best !== observed[observed.length - 1]) observed.push(best);
                if (window.pageWheelFrontIndex !== best) mismatch = true;
                // Force pending style work so an accidental left/top animation
                // becomes a measurable layout instead of hiding in the queue.
                stage.getBoundingClientRect();
            }
            return { mismatch, observed, events: window.frontEvents };
        });
        const after = (await cdp.send('Performance.getMetrics')).metrics;
        const layouts = metrics => metrics.find(metric => metric.name === 'LayoutCount').value;
        assert.equal(result.mismatch, false);
        assert.deepEqual(result.events, result.observed);
        assert.equal(layouts(after) - layouts(before), 0);
    } finally { await browser.close(); }
});
