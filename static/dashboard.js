
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
