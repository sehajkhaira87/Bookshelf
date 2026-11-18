
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



const deptCards = document.querySelectorAll('.dept-card[data-dept]');
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

const departmentStep = document.getElementById('step-dept');
const departmentGrid = departmentStep.querySelector('.dept-squares');
const appliedNote = departmentStep.querySelector('.applied-note');
const appliedCard = appliedNote.querySelector('button');
const firstYears = appliedCard.querySelector('.first-years');
const allDepartments = departmentStep.querySelector('.all-departments');
const initialInstruction = instructionText.textContent;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function hideStep(step) {
    step.classList.remove('visible');
    step.classList.add('hidden');
    step.inert = true;
}

function resetSelections() {
    clearTimeout(departmentRevealTimer);
    selectedDepartment = '';
    selectedSemester = '';
    [...deptCards, ...semCards, ...categoryCards].forEach(card => card.classList.remove('selected', 'dimmed'));
    hideStep(semStep);
    hideStep(categoryStep);
    instructionText.style.opacity = 1;
}

function revealSemesters(firstYear) {
    semCards.forEach(card => { card.hidden = (Number(card.dataset.semester) <= 2) !== firstYear; });
    instructionText.textContent = firstYear ? 'Choose your first-year semester.' : 'Department selected. Now choose your semester.';
    instructionText.style.opacity = 1;
    semStep.inert = false;
    semStep.classList.remove('hidden');
    semStep.classList.add('visible');
}

deptCards.forEach(card => {
    card.addEventListener('click', () => {
        if (departmentGrid.inert) return;
        resetSelections();
        selectedDepartment = card.dataset.dept;
        appliedNote.hidden = true;
        allDepartments.hidden = false;
        deptCards.forEach(item => item.classList.toggle('dimmed', item !== card));
        card.classList.add('selected');
        revealSemesters(false);
        scrollToSelection(semStep);
    });
});

// Sample the same curved path in both directions. Each card lands at its
// measured position, including when the grid wraps to multiple rows.
function departmentFlights(destination, returning, delay = 0) {
    return Array.from(deptCards, (card, index) => {
        const box = card.getBoundingClientRect();
        const dx = destination.left - box.left + (destination.width - box.width) / 2;
        const dy = destination.top - box.top + (destination.height - box.height) / 2;
        const frames = Array.from({ length: 81 }, (_, frame) => {
            const t = returning ? 1 - frame / 80 : frame / 80;
            const p = t * t * (3 - 2 * t);
            const q = 1 - p;
            const y = 3*q*q*p*(dy*.08 - 14) + 3*q*p*p*dy*.72 + p*p*p*dy;
            const scaleProgress = Math.max(0, (p - .08) / .92);
            const scale = 1 - .975 * scaleProgress ** 3 * (scaleProgress * (6 * scaleProgress - 15) + 10);
            const rotation = Math.sin(p * Math.PI) * (index - (deptCards.length - 1) / 2) * .6;
            return {
                transform: `translate3d(${dx*p}px,${y}px,0) scale(${scale}) rotate(${rotation}deg)`,
                opacity: Math.min(1, (1 - p) / .16)
            };
        });
        const stagger = returning ? (deptCards.length - 1 - index) * 145 : index * 105;
        const speed = returning ? 1.06 : 1;
        return card.animate(frames, {
            duration: (returning ? 2450 : 1560) / speed,
            delay: (delay + stagger) / speed, fill: 'both'
        });
    });
}

async function finishMotion(animations) {
    await Promise.all(animations.map(animation => animation.finished));
    animations.forEach(animation => animation.cancel());
}

function setFirstYearLayout(open) {
    departmentStep.classList.toggle('first-year-open', open);
    appliedCard.setAttribute('aria-expanded', String(open));
    firstYears.hidden = !open;
}

async function showFirstYear(open) {
    if (departmentStep.hasAttribute('data-moving')) return;
    departmentStep.setAttribute('data-moving', '');
    departmentGrid.inert = true;
    appliedCard.disabled = true;
    const animate = !reducedMotion.matches && typeof appliedNote.animate === 'function';
    const expandedWidth = departmentStep.clientWidth;
    const expandedTop = departmentStep.getBoundingClientRect().top;
    allDepartments.hidden = true;
    resetSelections();
    if (!open) setFirstYearLayout(false);
    const home = appliedNote.getBoundingClientRect();
    const travel = home.top - expandedTop;
    const copy = appliedCard.querySelector('.applied-copy');
    try {
        if (animate && open) {
            const flights = departmentFlights(home, false);
            await Promise.all(flights.map(flight => flight.finished));
            const rise = appliedNote.animate([
                { transform: 'translateY(0)' }, { transform: `translateY(${-travel}px)` }
            ], { duration: 820, easing: 'cubic-bezier(.35,0,.18,1)', fill: 'both' });
            await rise.finished;
            setFirstYearLayout(true);
            rise.cancel();
            flights.forEach(flight => flight.cancel());
            await finishMotion([
                appliedNote.animate([{width: home.width + 'px'}, {width: '100%'}],
                    {duration: 2050, easing: 'cubic-bezier(.42,0,.30,1)'}),
                copy.animate([{opacity: 0}, {opacity: 1}], {duration: 840, delay: 560, fill: 'both'})
            ]);
        } else if (animate) {
            const descentStart = 1420;
            const descent = Math.min(3000, 2120 + travel * 1.7);
            const timing = {easing: 'cubic-bezier(.45,0,.42,1)', fill: 'both'};
            await finishMotion([
                ...departmentFlights(home, true, descentStart + descent),
                appliedNote.animate([{width: expandedWidth + 'px'}, {width: home.width + 'px'}],
                    {...timing, duration: 1850 / 1.06}),
                appliedNote.animate([{transform: `translateY(${-travel}px)`}, {transform: 'translateY(0)'}],
                    {...timing, duration: descent / 1.06, delay: descentStart / 1.06}),
                copy.animate([{opacity: 0}, {opacity: 1}], {duration: 650/1.06, delay: 520/1.06, fill: 'both'})
            ]);
        }
    } finally {
        setFirstYearLayout(open);
        departmentStep.removeAttribute('data-moving');
        departmentGrid.inert = open;
        appliedCard.disabled = open;
        allDepartments.hidden = !open;
        if (open) {
            revealSemesters(true);
            allDepartments.focus({preventScroll:true});
        } else {
            instructionText.textContent = initialInstruction;
            appliedCard.focus({preventScroll:true});
        }
    }
}

appliedCard.addEventListener('click', () => showFirstYear(true));
function returnToDepartments() {
    if (departmentStep.hasAttribute('data-moving')) return;
    if (departmentStep.classList.contains('first-year-open')) {
        showFirstYear(false);
    } else {
        resetSelections();
        appliedNote.hidden = false;
        allDepartments.hidden = true;
        instructionText.textContent = initialInstruction;
        appliedCard.focus({preventScroll:true});
    }
}
allDepartments.addEventListener('click', returnToDepartments);
document.querySelector('.sidebar-nav a[href="#"]')?.addEventListener('click', () => {
    if (!allDepartments.hidden) returnToDepartments();
});
semStep.inert = true;
categoryStep.inert = true;

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
            categoryStep.inert = false;
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
        // Keep the selection available when switching from the shared PYQ
        // archive to the department's MST papers or other study materials.
        if (selectedDepartment) target.searchParams.set('branch', selectedDepartment);
        if (selectedSemester) target.searchParams.set('semester', selectedSemester);
        window.location.assign(target.href);
    });
});

document.querySelectorAll('.dept-card[data-dept], .category-card').forEach(card => {
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
