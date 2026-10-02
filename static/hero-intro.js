(function () {
    const startedAt = performance.now();
    const holds = new Set();
    let phase = 'loading', started = false, finish;
    const ready = new Promise(resolve => { finish = resolve; });
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const frame = () => new Promise(requestAnimationFrame);

    // GPU preparation can join the loader, or wait for the finished reveal if
    // its assets arrive late. A failed/slow asset never traps the page in loading.
    window.bookshelfIntro = {
        get phase() { return phase; },
        ready,
        hold(promise) {
            const settled = Promise.resolve(promise).catch(() => {});
            if (phase === 'loading') holds.add(settled);
            return settled;
        },
        async start({ gsap, SplitType, refresh }) {
            if (started) return ready;
            started = true;
            const loader = document.getElementById('loader');
            const title = document.querySelector('.hero-title');
            const tagLine = document.querySelector('.tag-line');
            const tagText = document.querySelector('.tag-text');
            const mobile = matchMedia('(max-width: 820px)').matches;
            const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
            let chars = [], timeline;
            const complete = () => {
                // Return settled glyphs to normal text rendering after the
                // temporary animation layers have done their work.
                if (chars.length) gsap.set(chars, { clearProps: 'transform,opacity,willChange' });
                phase = 'ready';
                finish();
            };

            try {
                if (document.fonts) {
                    this.hold(Promise.allSettled([
                        document.fonts.load('700 72px "Canela"'),
                        document.fonts.load('500 14px "Inter"')
                    ]));
                }
                document.querySelectorAll('.hero img, #loader img').forEach(img => {
                    if (img.decode) this.hold(img.decode());
                });

                await delay(Math.max(0, 1500 - (performance.now() - startedAt)));
                const waitForAssets = async () => {
                    // A module may register another hold while fonts are loading.
                    let count;
                    do {
                        count = holds.size;
                        await Promise.allSettled([...holds]);
                    } while (holds.size !== count);
                };
                await Promise.race([
                    waitForAssets(),
                    delay(Math.max(0, 5000 - (performance.now() - startedAt)))
                ]);

                // One owner per character: mobile no longer gets split again by
                // the desktop animation while its CSS animation is in progress.
                if (!reduced) {
                    if (mobile) {
                        title.querySelectorAll(':scope > span').forEach(line => {
                            const fragment = document.createDocumentFragment();
                            for (const letter of line.textContent) {
                                const char = document.createElement('span');
                                char.className = 'char';
                                char.textContent = letter === ' ' ? '\u00a0' : letter;
                                fragment.appendChild(char);
                                chars.push(char);
                            }
                            line.replaceChildren(fragment);
                        });
                    } else {
                        chars = new SplitType(title, { types: 'chars' }).chars;
                    }
                }

                timeline = gsap.timeline({ paused: true, onComplete: complete });
                if (!reduced) {
                    chars.forEach(char => { char.style.willChange = 'transform, opacity'; });
                    gsap.set(tagLine, { scaleX: 0, transformOrigin: 'left center' });
                    gsap.set(tagText, { opacity: 0, x: 20 });
                    timeline.to(tagLine, { scaleX: 1, duration: 1.8, ease: 'power3.out' }, 2);
                    timeline.to(tagText, { opacity: 1, x: 0, duration: 1.7, ease: 'power3.out' }, 2);
                    if (!mobile) {
                        gsap.set(chars, { opacity: 0, y: 120, rotationX: -90, force3D: true });
                        timeline.to(chars, { opacity: 1, y: 0, rotationX: 0, stagger: 0.03,
                            duration: 1.2, ease: 'power4.out', force3D: true }, 0.9);
                    }
                }

                // All DOM splitting, measurements and pin refreshes happen
                // behind the loader, before any letter starts moving.
                refresh();
                phase = 'revealing';
                await frame();
                await frame();
                // Start against a fresh GSAP clock after loading work, so the
                // first tick cannot fast-forward a newly played timeline.
                await new Promise(resolve => gsap.ticker.add(() => resolve(), true));
                if (loader) {
                    loader.classList.add('hide-loader');
                    const removeLoader = () => loader.remove();
                    loader.addEventListener('transitionend', event => {
                        if (event.target === loader && event.propertyName === 'transform') removeLoader();
                    });
                    setTimeout(removeLoader, reduced ? 0 : 1250);
                }
                if (reduced) {
                    gsap.set([title, tagText], { opacity: 1, clearProps: 'transform' });
                    gsap.set(tagLine, { scaleX: 1 });
                    complete();
                } else {
                    if (mobile) {
                        // Keep the original mobile rise, easing and stagger,
                        // using compositor animations with no GSAP/CSS conflict.
                        chars.forEach((char, i) => {
                            char.animate([
                                { opacity: 0, transform: 'translateY(28px)' },
                                { opacity: 1, transform: 'translateY(0)' }
                            ], { duration: 600, delay: 500 + i * 25,
                                easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
                        });
                    }
                    timeline.play(0);
                }
            } catch (error) {
                // Show readable content even if an optional effect cannot start.
                timeline?.kill();
                loader?.remove();
                gsap.set([...chars, title, tagText], { opacity: 1, clearProps: 'transform' });
                gsap.set(tagLine, { scaleX: 1 });
                complete();
                console.error('Hero intro could not start:', error);
            }
            return ready;
        }
    };
})();
