
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