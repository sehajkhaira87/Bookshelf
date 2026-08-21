document.addEventListener('DOMContentLoaded', () => {
    const googleBtn = document.getElementById('googleSignIn');
    
    if (googleBtn) {
        googleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            const btn = e.currentTarget;
            const label = btn.querySelector('.login-google-label');
            const icon = btn.querySelector('.login-google-icon');
            const arrow = btn.querySelector('.login-google-arrow');
            const targetUrl = btn.getAttribute('href');

            
            btn.style.display = "flex";
            btn.style.pointerEvents = "none";
            
            btn.classList.add('bookshelf-loading-pulse');
            
            if (arrow) arrow.style.display = "none";
            if (label) label.innerText = "Authenticating...";

            setTimeout(() => {
                if (label) label.innerText = "Redirecting to Google...";
                if (icon) {
                    icon.innerHTML = `<span class="login-spinner"></span>`;
                }

                setTimeout(() => {
                    window.location.href = targetUrl;
                }, 800);
            }, 1200);
        });
    }
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