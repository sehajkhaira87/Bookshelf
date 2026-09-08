
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
let selectedDepartment = '';
let selectedSemester = '';
let departmentRevealTimer;

function scrollToSelection(step) {
    requestAnimationFrame(() => {
        step.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            block: 'start'
        });
    });
}

deptCards.forEach(card => {
    card.addEventListener('click', () => {
        clearTimeout(departmentRevealTimer);
        selectedDepartment = card.dataset.dept;
        selectedSemester = '';
        semCards.forEach(item => item.classList.remove('selected', 'dimmed'));
        categoryStep.classList.add('hidden');
        categoryStep.classList.remove('visible');
        deptCards.forEach(c => {
            c.classList.remove('selected');
            c.classList.add('dimmed');
        });

        card.classList.remove('dimmed');
        card.classList.add('selected');

        instructionText.style.opacity = 0;
        departmentRevealTimer = setTimeout(() => {
            instructionText.innerText = "Department selected. Now choose your semester.";
            instructionText.style.opacity = 1;
            semStep.classList.add('visible');
            semStep.classList.remove('hidden');
            scrollToSelection(semStep);
        }, 300);
    });
});

semCards.forEach(card => {
    card.addEventListener('click', () => {
        clearTimeout(departmentRevealTimer);
        selectedSemester = card.dataset.semester;
        const department = selectedDepartment;
        const semester = selectedSemester;
        semCards.forEach(c => {
            c.classList.remove('selected');
            c.classList.add('dimmed');
        });

        card.classList.remove('dimmed');
        card.classList.add('selected');

        instructionText.style.opacity = 0;
        setTimeout(() => {
            if (selectedDepartment !== department || selectedSemester !== semester) return;
            instructionText.innerText = "Semester selected. What do you need?";
            instructionText.style.opacity = 1;
            categoryStep.classList.add('visible');
            categoryStep.classList.remove('hidden');
            
            scrollToSelection(categoryStep);
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
        const target = new URL(card.dataset.url, window.location.href);
        if (card.dataset.category !== 'pyqs') {
            if (selectedDepartment) target.searchParams.set('branch', selectedDepartment);
            if (selectedSemester) target.searchParams.set('semester', selectedSemester);
        }
        window.location.assign(target.href);
    });
});

document.querySelectorAll('.dept-card, .category-card').forEach(card => {
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            card.click();
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('onboardingForm');

    if (form) {
        form.addEventListener('submit', () => {
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Saving your details…';
            }
        });
    }
});

const settingsBtn = document.getElementById('settingsBtn');
const settingsPopup = document.getElementById('settingsPopup');
const darkModeToggle = document.getElementById('darkModeToggle');

settingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    settingsPopup.classList.toggle('hidden');
    settingsBtn.setAttribute('aria-expanded', String(!settingsPopup.classList.contains('hidden')));
});

document.addEventListener('click', (e) => {
    if (settingsBtn && settingsPopup && !settingsBtn.contains(e.target) && !settingsPopup.contains(e.target)) {
        settingsPopup.classList.add('hidden');
        settingsBtn.setAttribute('aria-expanded', 'false');
    }
});

if (localStorage.getItem('bookshelf_dark_mode') === 'true') {
    document.body.classList.add('dark-mode');
    if (darkModeToggle) darkModeToggle.checked = true;
}

darkModeToggle?.addEventListener('change', (e) => {
    if (e.target.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('bookshelf_dark_mode', 'true');
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('bookshelf_dark_mode', 'false');
    }
});
