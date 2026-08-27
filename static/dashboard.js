
document.addEventListener("DOMContentLoaded", () => {
    const loader = document.getElementById("loader");
    const overlay = document.getElementById("onboardingOverlay");
    const sidebar = document.querySelector(".sidebar");
    const mainContent = document.querySelector(".main-content");

    if (document.referrer.includes("login") || document.referrer.includes("auth")) {
        sessionStorage.removeItem("dashboard_visited");
    }

    if (sessionStorage.getItem("dashboard_visited") === "true") {
        if (loader) loader.style.display = "none";
        if (overlay) overlay.style.display = "none";
        
        if (sidebar) { sidebar.style.animation = "none"; sidebar.style.opacity = "1"; }
        if (mainContent) { mainContent.style.animation = "none"; mainContent.style.opacity = "1"; }
    } else {
        
        sessionStorage.setItem("dashboard_visited", "true");
        
        
        setTimeout(() => {
            if (loader) loader.classList.add("hide-loader");
        }, 3900); 
    }
});



const deptCards = document.querySelectorAll('.dept-card');
const semCards = document.querySelectorAll('.sem-card');
const categoryCards = document.querySelectorAll('.category-card'); 

const semStep = document.getElementById('step-sem');
const categoryStep = document.getElementById('step-category'); 
const instructionText = document.getElementById('instruction-text');

deptCards.forEach(card => {
    card.addEventListener('click', () => {
        deptCards.forEach(c => {
            c.classList.remove('selected');
            c.classList.add('dimmed');
        });

        card.classList.remove('dimmed');
        card.classList.add('selected');

        instructionText.style.opacity = 0;
        setTimeout(() => {
            instructionText.innerText = "Department selected. Now choose your semester.";
            instructionText.style.opacity = 1;
            semStep.classList.add('visible');
            semStep.classList.remove('hidden');
        }, 300);
    });
});

semCards.forEach(card => {
    card.addEventListener('click', () => {
        semCards.forEach(c => {
            c.classList.remove('selected');
            c.classList.add('dimmed');
        });

        card.classList.remove('dimmed');
        card.classList.add('selected');

        instructionText.style.opacity = 0;
        setTimeout(() => {
            instructionText.innerText = "Semester selected. What do you need?";
            instructionText.style.opacity = 1;
            categoryStep.classList.add('visible');
            categoryStep.classList.remove('hidden');
            
            categoryStep.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 300);
    });
});

categoryCards.forEach(card => {
    card.addEventListener('click', () => {
        categoryCards.forEach(c => {
            c.classList.remove('selected');
            c.classList.add('dimmed');
        });

        card.classList.remove('dimmed');
        card.classList.add('selected');

        instructionText.style.opacity = 0;
        setTimeout(() => {
            instructionText.innerText = "Loading your resources...";
            instructionText.style.opacity = 1;
        }, 300);
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('onboardingOverlay');
    const form = document.getElementById('onboardingForm');

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault(); 
            
            localStorage.setItem('bookshelf_profile_complete', 'true');
            
            overlay.classList.add('hidden');
        });
    }
});

const settingsBtn = document.getElementById('settingsBtn');
const settingsPopup = document.getElementById('settingsPopup');
const darkModeToggle = document.getElementById('darkModeToggle');

settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    settingsPopup.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
    if (!settingsBtn.contains(e.target) && !settingsPopup.contains(e.target)) {
        settingsPopup.classList.add('hidden');
    }
});

if (localStorage.getItem('bookshelf_dark_mode') === 'true') {
    document.body.classList.add('dark-mode');
    darkModeToggle.checked = true;
}

darkModeToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('bookshelf_dark_mode', 'true');
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('bookshelf_dark_mode', 'false');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const pyqCard = document.querySelector('.category-card[data-category="pyqs"]');
    
    if (pyqCard) {
        pyqCard.addEventListener('click', () => {
            window.location.href = '/pyqs';
        });
    }
});