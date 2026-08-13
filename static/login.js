document.getElementById('googleSignIn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const label = btn.querySelector('.login-google-label');
    const icon = btn.querySelector('.login-google-icon');
    const arrow = btn.querySelector('.login-google-arrow');

    label.innerText = "Authenticating...";
    btn.style.pointerEvents = "none";
    btn.classList.add('is-authenticating');
    if (arrow) arrow.style.opacity = "0";

    setTimeout(() => {
        label.innerText = "Preparing your bookshelf...";
        if (icon) {
            icon.innerHTML = `<span class="login-spinner"></span>`;
        }

        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 800);
    }, 1200);
});

(function() {
    const visual = document.getElementById('loginVisual');
    if (!visual) return;

    visual.addEventListener('mousemove', (e) => {
        const r = visual.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        
        
        visual.style.setProperty('--x', `${mx}px`);
        visual.style.setProperty('--y', `${my}px`);
    });

    visual.addEventListener('mouseleave', () => {
        visual.style.setProperty('--x', `-100px`);
        visual.style.setProperty('--y', `-100px`);
    });
})();