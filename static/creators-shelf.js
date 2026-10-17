// Desktop only. No book images, portraits or video are requested before lights-off.
(() => {
    const hero = document.querySelector('.hero');
    const trigger = document.getElementById('creators-shelf-trigger');
    const template = document.getElementById('creators-reader-template');
    if (!hero || !trigger || !template) return;

    const desktop = matchMedia('(min-width: 821px)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const assets = JSON.parse(document.getElementById('bookshelf-creators-assets').textContent);
    const home = document.querySelector('.page1');
    const homeStatus = document.getElementById('after-hours-status');
    const flightMs = 3300;
    const shelfTilt = -14;
    let reader, world, carrier, pivot, shade, glow, status, returnButton, authorRoot, authorScreen, engine;
    let loading, ticket = 0, phaseName = 'day', returning = false, geometry, coverGeometry, shelfProjection, viewportScale = 1;
    let animations = [], unlockPage = null, lastFocused = null;
    let positionFrame = null;
    let homeZoom = 1, homeTransform = '';

    const clamp = value => Math.max(0, Math.min(1, value));
    const phase = (value, start, end) => clamp((value - start) / (end - start));
    const smooth = value => { const t = clamp(value); return t*t*t*(10+t*(6*t-15)); };
    const isNight = () => desktop.matches && hero.classList.contains('lights-off');
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

    function setPhase(value) {
        phaseName = value;
        if (reader) reader.dataset.phase = value;
    }

    function resizeWorld() {
        if (!world) return;
        // Reserve room for the reader controls even at the closest author view.
        viewportScale = Math.min(innerWidth / 1376, Math.max(1, innerHeight - 144) / 704);
        const left = (innerWidth - 1376 * viewportScale) / 2;
        const top = (innerHeight - 768 * viewportScale) / 2;
        world.style.left = `${left}px`;
        world.style.top = `${top}px`;
        world.style.transform = `scale(${viewportScale})`;
        // Keep both navigation controls on the same screen line; only the book
        // scales with the reading area.
        const back = reader.querySelector('.authors-back');
        back.style.left = `${(28 - left) / viewportScale}px`;
        back.style.top = `${(23 - top) / viewportScale}px`;
        back.style.transformOrigin = '0 0';
        back.style.transform = `scale(${1 / viewportScale})`;
    }

    async function loadBook() {
        if (loading) return loading;
        loading = (async () => {
            const { createCreatorsBook } = await import(assets.engine);
            document.body.appendChild(template.content.cloneNode(true));
            reader = document.getElementById('bookshelf-creators');
            world = reader.querySelector('.creators-cinema-world');
            carrier = reader.querySelector('.creators-flight-carrier');
            shade = reader.querySelector('.creators-cinema-shade');
            glow = reader.querySelector('.creators-focus-glow');
            status = reader.querySelector('.creators-status');
            returnButton = reader.querySelector('.creators-return');
            authorRoot = reader.querySelector('#bookshelf-authors-spread');
            authorScreen = reader.querySelector('.authors-screen');
            engine = createCreatorsBook(authorRoot, assets);

            const camera = reader.querySelector('.authors-camera');
            const book = reader.querySelector('.authors-book');
            pivot = document.createElement('div');
            pivot.className = 'creators-book-pivot';
            camera.insertBefore(pivot, book);
            pivot.appendChild(book);
            const spine = document.createElement('div');
            spine.className = 'creators-film-edge creators-film-spine';
            spine.setAttribute('aria-hidden', 'true');
            spine.innerHTML = '<span class="creators-spine-rule"></span><span class="creators-spine-title">BOOKSHELF</span><span class="creators-spine-rule"></span>';
            spine.style.backgroundImage = `linear-gradient(90deg,#0d0b09c9,#4944381a 34%,#100d0a66),url("${assets.cover}")`;
            book.appendChild(spine);
            for (const edge of ['pages', 'top']) {
                const face = document.createElement('div');
                face.className = `creators-film-edge creators-film-${edge}`;
                face.setAttribute('aria-hidden', 'true');
                book.appendChild(face);
            }

            returnButton.addEventListener('click', putBack);
            shade.addEventListener('click', putBack);
            authorRoot.addEventListener('bookshelf:view', event => {
                if (returning && event.detail.view === 'cover') returnFlight();
                else if (phaseName === 'reading') status.textContent = event.detail.view === 'cover'
                    ? 'Click the cover to open the creators’ book.'
                    : event.detail.view === 'spread' ? 'Choose either author to read their introduction.' : '';
            });
            new MutationObserver(() => {
                returnButton.disabled = engine.running;
            }).observe(authorScreen, { attributes: true, attributeFilter: ['aria-busy'] });
            reader.addEventListener('keydown', handleKeys);
            resizeWorld();
            await engine.ready;
        })();
        try { await loading; }
        catch (error) {
            loading = null;
            if (reader) reader.hidden = true;
            console.error('The creators’ book could not load:', error);
            throw error;
        }
    }

    function measureFlight() {
        const source = trigger.getBoundingClientRect();
        const destination = reader.querySelector('.authors-cover-front').getBoundingClientRect();
        const frame = world.getBoundingClientRect();
        const camera = new DOMMatrixReadOnly(getComputedStyle(reader.querySelector('.authors-camera')).transform);
        coverGeometry = {
            dx: (destination.left + destination.width / 2 - frame.left) / viewportScale,
            dy: (destination.top + destination.height / 2 - frame.top) / viewportScale,
            height: destination.height / viewportScale,
            pivotX: (destination.left + destination.width / 2 - frame.left) / viewportScale - camera.m41,
            pivotY: (destination.top + destination.height / 2 - frame.top) / viewportScale - camera.m42
        };
        return sourceGeometry(source, frame);
    }

    function sourceGeometry(source, frame) {
        const start = source.height / homeZoom / ((shelfProjection?.height ?? coverGeometry.height) * viewportScale);
        return {
            sx: (source.left + source.width / 2 - frame.left) / viewportScale - start * (shelfProjection?.offsetX ?? 0),
            sy: (source.top + source.height / 2 - frame.top) / viewportScale - start * (shelfProjection?.offsetY ?? 0),
            dx: coverGeometry.dx, dy: coverGeometry.dy, start
        };
    }

    function placeShelf() {
        const source = trigger.getBoundingClientRect();
        const artwork = trigger.closest('.hero-image').getBoundingClientRect();
        reader.style.setProperty('--creators-shelf-floor', `${source.bottom + .3 * artwork.height / 1100}px`);
        pivot.style.transformOrigin = `${coverGeometry.pivotX}px ${coverGeometry.pivotY}px`;
        carrier.style.transform = flightFrames()[0].transform;
        pivot.style.transform = turnFrames()[0].transform;
    }

    function calibrateShelf() {
        // Measure the visible spine after perspective, rather than fitting the
        // unturned cover. Its lower edge then meets the actual shelf surface.
        if (shelfProjection) return;
        const spine = reader.querySelector('.creators-film-spine').getBoundingClientRect();
        const frame = world.getBoundingClientRect();
        if (!spine.height || !geometry.start) return;
        shelfProjection = {
            height: spine.height / (geometry.start * viewportScale),
            offsetX: ((spine.left + spine.width / 2 - frame.left) / viewportScale - geometry.sx) / geometry.start,
            offsetY: ((spine.top + spine.height / 2 - frame.top) / viewportScale - geometry.sy) / geometry.start
        };
        geometry = sourceGeometry(trigger.getBoundingClientRect(), frame);
        placeShelf();
    }

    function flightFrames(reverse = false) {
        const g = geometry;
        return Array.from({ length: 121 }, (_, index) => {
            const offset = index / 120, t = reverse ? 1-offset : offset;
            const move = smooth(phase(t,.12,.94)), growth = smooth(phase(t,.12,1)), pull = smooth(phase(t,0,.24));
            const lift = Math.sin(Math.PI*smooth(t)), scale = g.start+(1-g.start)*growth;
            const x = g.sx+(g.dx-g.sx)*move+15*pull*(1-move);
            const y = g.sy+(g.dy-g.sy)*move-34*lift;
            return { offset, transform: `matrix(${scale},0,0,${scale},${x-scale*g.dx},${y-scale*g.dy})` };
        });
    }

    function turnFrames(reverse = false) {
        return Array.from({ length: 121 }, (_, index) => {
            const offset = index/120, t = reverse ? 1-offset : offset;
            const turn = smooth(phase(t,.18,.96)), lift = Math.sin(Math.PI*smooth(t));
            // Match the shelf's receding depth, then gently level the book as it
            // comes forward. The return uses the exact same pose in reverse.
            return { offset, transform: `rotateX(${shelfTilt*(1-turn)}deg) rotateY(${86*(1-turn)}deg) rotateX(${-3.2*(1-turn)-4*lift}deg) rotateZ(${.6*(1-turn)-1.8*lift}deg)` };
        });
    }

    async function animate(element, frames, options) {
        const final = frames.at(-1);
        const commit = () => { for (const [key, value] of Object.entries(final)) if (key !== 'offset') element.style[key] = String(value); };
        if (reduced.matches || !element.animate) { commit(); return; }
        const animation = element.animate(frames, { fill: 'both', ...options });
        animations.push(animation);
        try { await animation.finished; commit(); } catch { /* A newer light state cancels the old reveal. */ }
        animation.cancel();
        animations = animations.filter(item => item !== animation);
    }

    async function prepareShelf(currentTicket) {
        reader.hidden = false;
        reader.style.visibility = 'hidden';
        reader.inert = true;
        reader.setAttribute('aria-hidden', 'true');
        authorRoot.inert = true;
        carrier.style.opacity = '0';
        carrier.style.transform = pivot.style.transform = 'none';
        shade.style.opacity = glow.style.opacity = '0';
        resizeWorld();
        await nextFrame();
        // The book's own ResizeObserver must see its visible, unscaled world
        // before the closed cover is measured for the tiny shelf placement.
        await nextFrame();
        if (currentTicket !== ticket || !isNight()) return;
        geometry = measureFlight();
        placeShelf();
        calibrateShelf();
        reader.style.visibility = 'visible';
    }

    async function syncLight() {
        if (['flying', 'reading', 'closing', 'returning'].includes(phaseName)) return;
        const currentTicket = ++ticket;
        animations.forEach(animation => animation.cancel());
        trigger.disabled = true;
        trigger.setAttribute('aria-hidden', 'true');
        trigger.style.opacity = '0';
        if (!isNight()) {
            setPhase('day');
            trigger.hidden = true;
            if (reader) reader.hidden = true;
            return;
        }
        setPhase('revealing');
        trigger.hidden = false;
        if (homeStatus) homeStatus.textContent = 'The creators’ book is appearing on the shelf.';
        try { await loadBook(); } catch { if (currentTicket === ticket && homeStatus) homeStatus.textContent = 'The creators’ book could not load. Switch the light on and try again.'; return; }
        if (!reduced.matches) await new Promise(resolve => setTimeout(resolve, 700));
        if (currentTicket !== ticket || !isNight()) return;
        await prepareShelf(currentTicket);
        if (currentTicket !== ticket || !isNight()) return;
        await Promise.all([
            animate(carrier, [{opacity:0},{opacity:1}], {duration:1000,easing:'ease'}),
            animate(trigger, [{opacity:0},{opacity:1}], {duration:1000,easing:'ease'})
        ]);
        if (currentTicket !== ticket || !isNight()) return;
        trigger.disabled = false;
        trigger.setAttribute('aria-hidden', 'false');
        setPhase('night');
        if (homeStatus) homeStatus.textContent = 'The Creators is on the shelf. Select the book to meet its creators.';
    }

    function lockHome() {
        const sections = [...document.querySelectorAll('.page1, .page2')];
        const priorInert = sections.map(element => element.inert);
        const overflow = document.body.style.overflow, padding = document.body.style.paddingRight;
        const origin = home.style.transformOrigin, promotion = home.style.willChange;
        homeTransform = home.style.transform;
        const shelfBounds = trigger.getBoundingClientRect(), homeBounds = home.getBoundingClientRect();
        home.style.transformOrigin = `${shelfBounds.left+shelfBounds.width/2-homeBounds.left}px ${shelfBounds.top+shelfBounds.height/2-homeBounds.top}px`;
        home.style.willChange = 'transform';
        const scrollbar = innerWidth - document.documentElement.clientWidth;
        if (scrollbar) document.body.style.paddingRight = `${scrollbar}px`;
        document.body.style.overflow = 'hidden';
        sections.forEach(element => { element.inert = true; });
        window.dispatchEvent(new CustomEvent('bookshelf:creatorschange', {detail:{active:true}}));
        unlockPage = () => {
            sections.forEach((element, index) => { element.inert = priorInert[index]; });
            document.body.style.overflow = overflow;
            document.body.style.paddingRight = padding;
            home.style.transform = homeTransform;
            home.style.transformOrigin = origin;
            home.style.willChange = promotion;
            homeZoom = 1;
            window.dispatchEvent(new CustomEvent('bookshelf:creatorschange', {detail:{active:false}}));
            unlockPage = null;
        };
    }

    async function bringForward() {
        if (phaseName !== 'night' || trigger.disabled || !isNight()) return;
        const currentTicket = ++ticket;
        animations.forEach(animation => animation.cancel());
        lastFocused = document.activeElement;
        trigger.disabled = true;
        trigger.style.opacity = '0';
        trigger.setAttribute('aria-hidden', 'true');
        lockHome();
        carrier.style.transform = pivot.style.transform = 'none';
        resizeWorld();
        geometry = measureFlight();
        placeShelf();
        setPhase('flying');
        status.textContent = 'The creators’ book is coming forward.';
        await Promise.all([
            animate(carrier, flightFrames(), {duration:flightMs,easing:'linear'}),
            animate(pivot, turnFrames(), {duration:flightMs,easing:'linear'}),
            animate(shade, [{opacity:0},{opacity:.93}], {duration:flightMs,easing:'cubic-bezier(.4,0,.2,1)'}),
            animate(glow, [{opacity:0},{opacity:1}], {duration:flightMs,easing:'ease'}),
            animate(home, [{transform:homePush(1)},{transform:homePush(1.028)}], {duration:flightMs,easing:'cubic-bezier(.4,0,.2,1)'})
        ]);
        if (currentTicket !== ticket) return;
        carrier.style.transform = pivot.style.transform = 'none';
        homeZoom = 1.028;
        if (!reduced.matches) await new Promise(resolve => setTimeout(resolve, 420));
        if (currentTicket !== ticket) return;
        setPhase('reading');
        reader.inert = authorRoot.inert = false;
        reader.setAttribute('aria-hidden', 'false');
        reader.setAttribute('aria-modal', 'true');
        returnButton.hidden = false;
        returnButton.focus({preventScroll:true});
        authorRoot.dispatchEvent(new CustomEvent('bookshelf:open'));
    }

    function putBack() {
        if (phaseName !== 'reading' || engine.running) return;
        ++ticket;
        returning = true;
        setPhase('closing');
        returnButton.hidden = true;
        reader.inert = authorRoot.inert = true;
        reader.setAttribute('aria-hidden', 'true');
        reader.removeAttribute('aria-modal');
        if (engine.view !== 'cover') authorRoot.dispatchEvent(new CustomEvent('bookshelf:close'));
        else returnFlight();
    }

    async function returnFlight() {
        returning = false;
        setPhase('returning');
        const currentTicket = ticket;
        carrier.style.transform = pivot.style.transform = 'none';
        resizeWorld();
        geometry = measureFlight();
        pivot.style.transformOrigin = `${coverGeometry.pivotX}px ${coverGeometry.pivotY}px`;
        status.textContent = 'Returning the creators’ book to the shelf.';
        await Promise.all([
            animate(carrier, flightFrames(true), {duration:flightMs,easing:'linear'}),
            animate(pivot, turnFrames(true), {duration:flightMs,easing:'linear'}),
            animate(shade, [{opacity:.93},{opacity:0}], {duration:flightMs,easing:'ease-in-out'}),
            animate(glow, [{opacity:1},{opacity:0}], {duration:flightMs,easing:'ease-in-out'}),
            animate(home, [{transform:homePush(1.028)},{transform:homePush(1)}], {duration:flightMs,easing:'ease-in-out'})
        ]);
        if (currentTicket !== ticket) return;
        unlockPage?.();
        setPhase('night');
        trigger.style.opacity = '1';
        trigger.disabled = false;
        trigger.setAttribute('aria-hidden', 'false');
        if (homeStatus) homeStatus.textContent = 'The creators’ book is back on the shelf.';
        (lastFocused?.isConnected ? lastFocused : trigger).focus({preventScroll:true});
        positionShelf();
    }

    function handleKeys(event) {
        if (event.key === 'Escape') { event.preventDefault(); putBack(); return; }
        if (event.key !== 'Tab' || phaseName !== 'reading') return;
        const buttons = [...reader.querySelectorAll('button')].filter(button => !button.disabled && !button.closest('[inert]') && button.getClientRects().length);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }

    function homePush(scale) {
        const base = homeTransform && homeTransform !== 'none' ? homeTransform + ' ' : '';
        return `${base}scale(${scale})`;
    }

    function reset() {
        ++ticket;
        returning = false;
        animations.forEach(animation => animation.cancel());
        unlockPage?.();
        trigger.hidden = true;
        trigger.disabled = true;
        trigger.setAttribute('aria-hidden', 'true');
        if (reader) {
            reader.inert = true;
            reader.setAttribute('aria-hidden', 'true');
            authorRoot.inert = true;
            reader.hidden = true;
            reader.removeAttribute('aria-modal');
            returnButton.hidden = true;
            engine.reset();
        }
        setPhase('day');
    }

    function positionShelf() {
        if (phaseName !== 'night' || !reader || !coverGeometry || !isNight()) return;
        // Follow the shelf's existing scroll/parallax transform without hiding,
        // remeasuring or rebuilding the visible book between animation frames.
        const source = trigger.getBoundingClientRect(), frame = world.getBoundingClientRect();
        geometry = sourceGeometry(source, frame);
        placeShelf();
    }
    function queuePosition() {
        resizeWorld();
        if (phaseName !== 'night' || positionFrame !== null) return;
        positionFrame = requestAnimationFrame(() => { positionFrame = null; positionShelf(); });
    }

    trigger.addEventListener('click', bringForward);
    window.addEventListener('bookshelf:lightchange', syncLight);
    window.addEventListener('resize', queuePosition, {passive:true});
    window.addEventListener('scroll', queuePosition, {passive:true});
    new MutationObserver(queuePosition).observe(trigger.closest('.hero-image'), {attributes:true,attributeFilter:['style']});
    new ResizeObserver(queuePosition).observe(trigger.closest('.hero-image'));
    desktop.addEventListener('change', () => { reset(); syncLight(); });
    reduced.addEventListener('change', () => { if (reduced.matches) animations.forEach(animation => animation.finish()); });
    window.addEventListener('pagehide', reset);
    window.addEventListener('pageshow', event => { if (event.persisted) syncLight(); });
    syncLight();
})();
