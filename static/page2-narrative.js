
(function () {
    const page2 = document.querySelector('.page2');
    if (!page2 || page2.querySelector('.p2-layer')) return;

    const CATEGORIES = [
        { quote: 'Written by people who sat where you sit.', body: 'Unit-wise notes, for every subject.' },
        { quote: 'Ten years of papers, one place.', body: 'Learn the pattern before the exam does.' },
        { quote: 'The syllabus, never out of date.', body: 'Every branch, every semester.' },
        { quote: 'Everything else you end up needing.', body: 'Books, manuals and guides — all vetted.' }
    ];

    const STATS = [
        { value: 2000, suffix: '+', label: 'Resources' },
        { value: 8,    suffix: '',  label: 'Semesters' },
        { value: 5,    suffix: '',  label: 'Branches' },
        { value: 100,  suffix: '%', label: 'Senior verified' }
    ];

    const N = CATEGORIES.length;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    
    const layer = document.createElement('div');
    layer.className = 'p2-layer';

    const head = document.createElement('div');
    head.className = 'p2-head';
    const rule = document.createElement('span');
    rule.className = 'p2-rule';
    const eyebrow = document.createElement('p');
    
    head.appendChild(rule);
    head.appendChild(eyebrow);
    layer.appendChild(head);

    const narrative = document.createElement('div');
    narrative.className = 'p2-narrative';
    const stem = document.createElement('span');
    stem.className = 'p2-stem';
    const quoteEl = document.createElement('p');
    quoteEl.className = 'p2-quote';
    const bodyEl = document.createElement('p');
    bodyEl.className = 'p2-body';
    narrative.appendChild(stem);
    narrative.appendChild(quoteEl);
    narrative.appendChild(bodyEl);
    layer.appendChild(narrative);

    const rail = document.createElement('div');
    rail.className = 'p2-rail';
    const ticks = [];
    for (let i = 0; i < N; i++) {
        const tick = document.createElement('span');
        tick.className = 'p2-tick';
        tick.style.transitionDelay = (0.3 + i * 0.07) + 's';
        rail.appendChild(tick);
        ticks.push(tick);
    }
    layer.appendChild(rail);

    const cue = document.createElement('div');
    cue.className = 'p2-cue';
    const cueLine = document.createElement('span');
    cueLine.className = 'p2-cue-line';
    const cueText = document.createElement('span');
    cueText.textContent = 'Keep scrolling';
    cue.appendChild(cueLine);
    cue.appendChild(cueText);
    layer.appendChild(cue);

    const statBand = document.createElement('div');
    statBand.className = 'p2-stats';
    const statGrid = document.createElement('div');
    statGrid.className = 'p2-statgrid';
    const valueEls = [];
    STATS.forEach(function (stat, i) {
        const cell = document.createElement('div');
        cell.className = 'p2-stat';
        cell.style.transitionDelay = (0.6 + i * 0.09) + 's';
        const value = document.createElement('div');
        value.className = 'p2-stat-value';
        value.textContent = '0' + stat.suffix;
        const label = document.createElement('div');
        label.className = 'p2-stat-label';
        label.textContent = stat.label;
        cell.appendChild(value);
        cell.appendChild(label);
        statGrid.appendChild(cell);
        valueEls.push(value);
    });
    statBand.appendChild(statGrid);
    layer.appendChild(statBand);

    page2.appendChild(layer);

    
    let cards = null;

    function findCards() {
        const stage = document.querySelector('.page-wheel-stage');
        if (!stage) return null;
        const found = [];
        for (let i = 0; i < stage.children.length; i++) {
            if (stage.children[i].style.zIndex !== '') found.push(stage.children[i]);
        }
        return found.length === N ? found : null;
    }

    function frontIndex() {
        if (!cards) cards = findCards();
        if (!cards) return -1;
        let best = -1, bestZ = -Infinity;
        for (let i = 0; i < N; i++) {
            const z = parseFloat(cards[i].style.zIndex);
            if (isNaN(z)) return -1;
            if (z > bestZ) { bestZ = z; best = i; }
        }
        return best;
    }

    
    let rendered = -1;
    let token = 0;

    function buildWords(text) {
        quoteEl.textContent = '';
        const words = text.split(' ');
        const masks = [];
        words.forEach(function (word, i) {
            const mask = document.createElement('span');
            mask.className = 'p2-w';
            const ink = document.createElement('span');
            ink.className = 'p2-wi';
            ink.textContent = word;
            mask.appendChild(ink);
            quoteEl.appendChild(mask);
            if (i < words.length - 1) quoteEl.appendChild(document.createTextNode(' '));
            masks.push(mask);
        });
        void quoteEl.offsetWidth;
        return masks;
    }

    function revealWords(masks, baseMs, mine) {
        const step = reduceMotion ? 0 : 120;
        masks.forEach(function (mask, i) {
            setTimeout(function () {
                if (mine !== token) return;
                mask.classList.add('is-in');
            }, baseMs + i * step);
        });
    }

    function enter(i, baseMs, mine) {
        revealWords(buildWords(CATEGORIES[i].quote), baseMs, mine);
        bodyEl.textContent = CATEGORIES[i].body;
        setTimeout(function () {
            if (mine !== token) return;
            bodyEl.classList.add('is-in');
        }, baseMs + 600);
        ticks.forEach(function (tick, k) { tick.classList.toggle('is-active', k === i); });
        rendered = i;
    }

    function swapTo(i) {
        const mine = ++token;
        rendered = i;

        const old = quoteEl.querySelectorAll('.p2-w');
        for (let k = 0; k < old.length; k++) {
            old[k].classList.remove('is-in');
            old[k].classList.add('is-out');
        }
        bodyEl.classList.remove('is-in');

        const gap = reduceMotion ? 60 : 290;
        setTimeout(function () {
            if (mine !== token) return;
            enter(i, 0, mine);
        }, gap);
    }

    
    function runCounters() {
        if (reduceMotion) {
            STATS.forEach(function (stat, i) {
                valueEls[i].textContent = stat.value.toLocaleString('en-US') + stat.suffix;
            });
            return;
        }
        STATS.forEach(function (stat, i) {
            const start = performance.now() + 200 + i * 130;
            const dur = 3500;
            (function step(now) {
                const p = Math.min(1, Math.max(0, (now - start) / dur));
                const eased = 1 - Math.pow(1 - p, 4);
                valueEls[i].textContent =
                    Math.round(stat.value * eased).toLocaleString('en-US') + stat.suffix;
                if (p < 1) requestAnimationFrame(step);
            })(performance.now());
        });
    }

    
    let watching = false;
    let cueHidden = false;

    function watch() {
        if (!watching) return;
        requestAnimationFrame(watch);
        const i = frontIndex();
        if (i < 0) return;
        if (i !== rendered) swapTo(i);
        if (!cueHidden && i !== 0) {
            cueHidden = true;
            cue.classList.add('is-hidden');
        }
    }

    
    let started = false;

    function start() {
        if (started) return;
        started = true;
        
        setTimeout(function () {
            
            layer.classList.add('is-lit');
            
            const i = Math.max(0, frontIndex());
            enter(i, reduceMotion ? 0 : 300, token);
            
            runCounters();

            setTimeout(function () {
                ticks.forEach(function (tick) { tick.style.transitionDelay = '0s'; });
                watching = true;
                requestAnimationFrame(watch);
            }, reduceMotion ? 200 : 1000);
            
        }, 6000); 
    }

    new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) start();
        });
    }, { threshold: 0.28 }).observe(page2);
})();