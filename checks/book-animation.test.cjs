// Live browser regression: set BOOK_PREVIEW_URL to the local Flask landing
// preview. PLAYWRIGHT_MODULE_PATH and BROWSER_EXECUTABLE_PATH are optional.
// The page must be able to load its normal public animation dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')); }
catch { /* Browser checks are optional in the offline suite. */ }
const preview = process.env.BOOK_PREVIEW_URL;
const source = fs.readFileSync(path.join(__dirname, '../static/three.js'), 'utf8');

for (const scenario of ['normal', 'unavailable-cue', 'stalled-cue', 'slow-model']) {
    test(`main book reveals and animates with ${scenario}`, {
        skip: !chromium || !preview, timeout: 65000
    }, async () => {
        const browser = await chromium.launch({
            headless: true, args: ['--enable-unsafe-swiftshader'],
            ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {})
        });
        try {
            const page = await browser.newPage({ viewport: { width: 1522, height: 729 }, deviceScaleFactor: 1.25 });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            let instrumented = source.replace(' // MOUSE HOVER', `
 window.__bookState = () => ({ prepared, introPlayed, scale: bookPivot?.scale.x, rotation: bookPivot?.rotation.y });
 // MOUSE HOVER`);
            if (scenario === 'stalled-cue') {
                instrumented = instrumented.replace('async function initScrollCueBook(sourceBookGroup) {',
                    'async function initScrollCueBook(sourceBookGroup) { await new Promise(() => {});');
            }
            await page.route('**/static/three.js', route => route.fulfill({ contentType: 'application/javascript', body: instrumented }));
            if (scenario === 'unavailable-cue') {
                await page.addInitScript(() => {
                    const getContext = HTMLCanvasElement.prototype.getContext;
                    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
                        if (this.id === 'scrollCueCanvas' && /^(webgl|experimental-webgl)/.test(type)) return null;
                        return getContext.call(this, type, ...args);
                    };
                });
            }
            if (scenario === 'slow-model') {
                await page.route('**/static/models/book.glb', async route => {
                    await new Promise(resolve => setTimeout(resolve, 12000));
                    await route.continue();
                });
            }
            await page.goto(preview, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.bookshelfIntro?.phase === 'ready', null, { timeout: 25000 });
            await page.evaluate(() => {
                const pin = ScrollTrigger.getAll().find(t => t.trigger?.matches('.page2') && t.pin);
                if (!pin) throw new Error('Page-two scroll transition did not initialize');
                window.scrollTo(0, pin.start + 150);
                ScrollTrigger.update();
            });
            await page.waitForFunction(() => window.__bookState?.().introPlayed, null, { timeout: 25000 });
            const first = await page.evaluate(() => window.__bookState());
            assert.equal(first.prepared, true);
            assert.equal(first.scale, 1, 'The book must not remain hidden at zero scale');
            await page.waitForFunction(rotation => Math.abs(window.__bookState().rotation - rotation) > .02, first.rotation);
            assert.deepEqual(errors, [], 'No unhandled application exceptions');
            if (process.env.BOOK_SCREENSHOT_DIR) {
                await page.screenshot({ path: path.join(process.env.BOOK_SCREENSHOT_DIR, `book-fixed-${scenario}.png`) });
            }
        } finally { await browser.close(); }
    });
}
