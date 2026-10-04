// Keep the phone's first paint independent of the desktop animation stack.
(() => {
    const root = document.documentElement;
    const base = document.currentScript.dataset.staticBase;
    const mobile = window.matchMedia('(max-width: 820px)');
    let mobileStarted = false, desktopStarted = false;
    let mobileReady, mobileLoaderStarted = false;
    let mobileIntroCleanup;

    function load(src, type) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            if (type) script.type = type;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load ${src}`));
            document.body.appendChild(script);
        });
    }

    function animateMobileText() {
        const title = document.querySelector('.hero-title');
        if (!title?.animate) return;
        const lines = Array.from(title.querySelectorAll(':scope > span'));
        const originals = lines.map(line => line.textContent);
        const animations = [];
        const easing = 'cubic-bezier(.22,.8,.3,1)';
        let index = 0, cleaned = false;
        const animate = (element, keyframes, options) => {
            if (element) animations.push(element.animate(keyframes, { ...options, fill: 'backwards' }));
        };
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            animations.forEach(animation => animation.cancel());
            lines.forEach((line, i) => { line.textContent = originals[i]; });
        };
        try {
            lines.forEach((line, i) => {
                const fragment = document.createDocumentFragment();
                for (const letter of originals[i]) {
                    const char = document.createElement('span');
                    char.className = 'char';
                    char.textContent = letter === ' ' ? '\u00a0' : letter;
                    fragment.appendChild(char);
                }
                line.replaceChildren(fragment);
                for (const char of line.children) {
                    // Keep the gentle rise, with more time for each letter to settle.
                    animate(char, [
                        { opacity: 0, transform: 'translateY(28px)' },
                        { opacity: 1, transform: 'translateY(0)' }
                    ], { duration: 820, delay: 500 + index++ * 30, easing });
                }
            });
            animate(document.querySelector('.tag-line'), [
                { transform: 'scaleX(0)', transformOrigin: 'left center' },
                { transform: 'scaleX(1)', transformOrigin: 'left center' }
            ], { duration: 1950, delay: 2300, easing });
            animate(document.querySelector('.tag-text'), [
                { opacity: 0, transform: 'translateX(20px)' },
                { opacity: 1, transform: 'translateX(0)' }
            ], { duration: 1850, delay: 2300, easing });
            // Return the heading to ordinary text when the entrance finishes.
            Promise.allSettled(animations.map(animation => animation.finished)).then(cleanup);
        } catch (error) {
            cleanup();
            console.error('Mobile text reveal could not start:', error);
        }
        return cleanup;
    }

    async function revealMobile(ready) {
        const loader = document.getElementById('loader');
        if (!loader || mobileLoaderStarted) return;
        mobileLoaderStarted = true;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            loader.remove();
            return;
        }

        // Keep the original CSS logo animation and upward curtain reveal.
        // Native animation completion needs none of the desktop libraries.
        const images = Array.from(document.querySelectorAll('.hero img, #loader img'));
        const logo = loader.querySelector('img');
        const animation = logo?.getAnimations?.()[0];
        const prepared = Promise.allSettled([
            ready, document.fonts?.ready, animation?.finished,
            ...images.map(img => img.decode?.())
        ]);
        let deadline;
        await Promise.race([
            prepared,
            new Promise(resolve => { deadline = setTimeout(resolve, 3500); })
        ]);
        clearTimeout(deadline);
        if (!mobile.matches) return; // Desktop now owns the existing loader.

        // Start text and curtain together, after fonts and artwork are ready.
        mobileIntroCleanup = animateMobileText();
        const remove = () => { clearTimeout(fallback); loader.remove(); };
        loader.addEventListener('transitionend', event => {
            if (event.target === loader && event.propertyName === 'transform') remove();
        });
        loader.classList.add('hide-loader');
        const fallback = setTimeout(remove, 1250);
    }

    async function startDesktop() {
        if (desktopStarted) return;
        desktopStarted = true;
        root.dataset.homeRuntime = 'desktop';
        try {
            // async=false preserves execution order while downloads overlap.
            await Promise.all([
                'https://unpkg.com/lenis@1.3.11/dist/lenis.min.js',
                'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js',
                'https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js',
                'https://unpkg.com/split-type'
            ].map(src => load(src)));
            await load(base + 'hero-intro.js');
            // Module imports and model preparation may proceed alongside the
            // desktop scripts, just as they did before this startup split.
            load(base + 'three.js', 'module').catch(error => console.error('[Book3D]', error));
            await load(base + 'bulb-physics.js');
            await load(base + 'script.js');
            await load(base + 'grid-bg.js');
            await load(base + 'page-wheel.js');
            await load(base + 'page2-narrative.js');
        } catch (error) {
            document.getElementById('loader')?.remove();
            console.error('Desktop effects could not start:', error);
        }
    }

    function sync() {
        if (!mobile.matches) {
            mobileIntroCleanup?.();
            startDesktop();
            return;
        }
        root.dataset.homeRuntime = 'mobile';
        if (!mobileStarted) {
            mobileStarted = true;
            mobileReady = load(base + 'mobile-home.js').catch(error => console.error('Mobile interactions could not start:', error));
        }
        revealMobile(mobileReady);
    }

    mobile.addEventListener('change', sync);
    sync();
})();
