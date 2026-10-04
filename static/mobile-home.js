// Native swipe cards: no animation framework, timers, or idle render loop.
(() => {
    if (window.history && 'scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    window.scrollTo?.(0, 0);
    const mobile = window.matchMedia('(max-width: 820px)');
    const track = document.getElementById('featuresTrack');
    if (!track) return;
    const cards = Array.from(track.querySelectorAll('.feature-item'));
    const dots = Array.from(document.querySelectorAll('.f-dot'));
    if (!cards.length) return;
    let index = 0, gesture = null;

    function render() {
        if (!mobile.matches) return;
        cards.forEach((card, i) => {
            card.classList.toggle('card-active', i === index);
            card.classList.toggle('card-next', i === (index + 1) % cards.length);
            card.classList.toggle('card-hidden', i !== index && i !== (index + 1) % cards.length);
        });
        dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    }

    dots.forEach((dot, i) => dot.addEventListener('click', () => { index = i; render(); }));
    track.addEventListener('pointerdown', event => {
        if (!mobile.matches || !event.isPrimary || event.button !== 0) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
        track.setPointerCapture(event.pointerId);
    }, { passive: true });
    track.addEventListener('pointerup', event => {
        if (!mobile.matches || event.pointerId !== gesture?.id) return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        gesture = null;
        if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy)) return;
        index = (index + (dx < 0 ? 1 : -1) + cards.length) % cards.length;
        render();
    }, { passive: true });
    track.addEventListener('pointercancel', () => { gesture = null; }, { passive: true });
    mobile.addEventListener('change', render);
    render();
})();
