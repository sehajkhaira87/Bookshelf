document.addEventListener('DOMContentLoaded', () => {
    const stateStart = document.getElementById('state-start');
    const stateOptions = document.getElementById('state-options');
    const stateForm = document.getElementById('state-form');
    
    const startBtn = document.querySelector('.big-contribute-btn');
    const cancelOptionsBtn = document.getElementById('btn-cancel-options');
    const btnCamera = document.getElementById('btn-camera');
    const btnUpload = document.getElementById('btn-upload');
    const btnCancelFile = document.getElementById('btn-cancel-file');
    
    const nativeUpload = document.getElementById('native-upload');
    const nativeCamera = document.getElementById('native-camera');
    const fileNameDisplay = document.getElementById('file-name-display');

    const metadataForm = document.getElementById('metadata-form');
    const branchSelect = metadataForm.elements.branch;
    const semesterSelect = metadataForm.elements.semester;

    function updateSemesters() {
        const previousSemester = semesterSelect.value;
        const branch = branchSelect.value;
        const semesters = branch === 'as' ? [1, 2] : [3, 4, 5, 6, 7, 8];
        const placeholder = new Option(branch ? 'Semester...' : 'Select a branch first...', '');
        placeholder.disabled = true;
        const options = branch ? semesters.map(value => new Option('Semester ' + value, String(value))) : [];
        semesterSelect.replaceChildren(placeholder, ...options);
        semesterSelect.disabled = !branch;
        semesterSelect.value = semesters.map(String).includes(previousSemester) && branch ? previousSemester : '';
        semesterSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    branchSelect.addEventListener('change', updateSemesters);
    metadataForm.addEventListener('reset', () => queueMicrotask(updateSemesters));
    window.addEventListener('pageshow', updateSemesters);
    updateSemesters();

    const mobileMenus = window.matchMedia('(max-width: 820px)');
    const pickers = [];

    function enhanceSelect(select) {
        const field = select.closest('.picker-field');
        const label = field.querySelector('label');
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.id = select.name + '-trigger';
        trigger.className = 'book-input mobile-picker';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', select.name + '-menu');
        trigger.setAttribute('aria-labelledby', label.id + ' ' + trigger.id);

        const menu = document.createElement('div');
        menu.id = select.name + '-menu';
        menu.className = 'picker-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-labelledby', label.id);
        menu.hidden = true;

        const error = document.createElement('span');
        error.id = select.name + '-error';
        error.className = 'picker-error';
        error.textContent = 'Choose your ' + label.textContent.toLowerCase() + '.';
        error.hidden = true;
        let choices = [];

        function close(restoreFocus = false) {
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (restoreFocus) trigger.focus({ preventScroll: true });
        }

        function makeChoice(option) {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'picker-menu-option';
            choice.setAttribute('role', 'option');
            choice.setAttribute('aria-selected', String(option.selected));
            choice.dataset.value = option.value;
            choice.textContent = option.textContent;
            choice.tabIndex = -1;
            choice.addEventListener('click', () => {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                close(true);
            });
            choices.push(choice);
            return choice;
        }

        function refresh() {
            trigger.textContent = select.selectedOptions[0]?.textContent || 'Select...';
            trigger.disabled = select.disabled;
            trigger.classList.toggle('is-placeholder', !select.value);
            trigger.removeAttribute('aria-invalid');
            trigger.removeAttribute('aria-describedby');
            error.hidden = true;
            choices = [];
            menu.replaceChildren();
            for (const source of select.children) {
                if (source.tagName === 'OPTGROUP') {
                    const group = document.createElement('div');
                    group.className = 'picker-menu-group';
                    group.setAttribute('role', 'group');
                    group.setAttribute('aria-label', source.label);
                    const heading = document.createElement('div');
                    heading.className = 'picker-menu-heading';
                    heading.setAttribute('aria-hidden', 'true');
                    heading.textContent = source.label;
                    group.append(heading);
                    for (const option of source.children) {
                        if (!option.disabled) group.append(makeChoice(option));
                    }
                    menu.append(group);
                } else if (!source.disabled && source.value) {
                    menu.append(makeChoice(source));
                }
            }
            close();
        }

        function open(last = false) {
            if (select.disabled || !choices.length) return;
            pickers.forEach(picker => picker.close());
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            const selected = choices.find(choice => choice.dataset.value === select.value);
            (selected || choices[last ? choices.length - 1 : 0]).focus({ preventScroll: true });
        }

        field.append(trigger, menu, error);
        field.classList.add('has-mobile-picker');
        trigger.addEventListener('click', () => {
            if (menu.hidden) open();
            else close();
        });
        trigger.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                open(event.key === 'ArrowUp');
            }
        });
        menu.addEventListener('keydown', event => {
            const index = choices.indexOf(document.activeElement);
            let next = index;
            if (event.key === 'ArrowDown') next = Math.min(index + 1, choices.length - 1);
            else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = choices.length - 1;
            else if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
                return;
            } else return;
            event.preventDefault();
            choices[next]?.focus();
        });
        field.addEventListener('focusout', event => {
            if (event.relatedTarget && !field.contains(event.relatedTarget)) close();
        });
        document.addEventListener('pointerdown', event => {
            if (!field.contains(event.target)) close();
        });
        select.addEventListener('change', refresh);
        select.addEventListener('invalid', event => {
            if (!mobileMenus.matches) return;
            event.preventDefault();
            error.hidden = false;
            trigger.setAttribute('aria-invalid', 'true');
            trigger.setAttribute('aria-describedby', error.id);
            trigger.focus();
        });
        function updateLabel() {
            label.htmlFor = mobileMenus.matches ? trigger.id : select.id;
            close();
        }
        mobileMenus.addEventListener('change', updateLabel);
        metadataForm.addEventListener('reset', () => queueMicrotask(refresh));
        window.addEventListener('pageshow', refresh);
        btnCancelFile.addEventListener('click', () => close());
        refresh();
        updateLabel();
        return { close };
    }

    metadataForm.querySelectorAll('.picker-field select').forEach(select => {
        pickers.push(enhanceSelect(select));
    });

    startBtn.addEventListener('click', () => {
        stateStart.classList.add('hidden');
        stateOptions.classList.remove('hidden');
    });

    cancelOptionsBtn.addEventListener('click', () => {
        stateOptions.classList.add('hidden');
        stateStart.classList.remove('hidden');
    });

    btnUpload.addEventListener('click', () => nativeUpload.click());
    btnCamera.addEventListener('click', () => nativeCamera.click());

    const handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (file) {
            (event.target === nativeUpload ? nativeCamera : nativeUpload).value = '';
            fileNameDisplay.textContent = file.name;
            stateOptions.classList.add('hidden');
            stateForm.classList.remove('hidden');
        }
    };

    nativeUpload.addEventListener('change', handleFileSelect);
    nativeCamera.addEventListener('change', handleFileSelect);

    btnCancelFile.addEventListener('click', (e) => {
        e.preventDefault(); 
        nativeUpload.value = ''; 
        nativeCamera.value = '';
        stateForm.classList.add('hidden');
        stateOptions.classList.remove('hidden');
    });
});
