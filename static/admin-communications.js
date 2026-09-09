(() => {
    const form = document.getElementById('sendNotificationForm');
    const audience = document.getElementById('notificationAudience');
    const picker = document.getElementById('recipientPicker');
    const results = document.getElementById('recipientResults');
    const selectedBox = document.getElementById('selectedRecipients');
    const status = document.getElementById('recipientStatus');
    const sendButton = document.getElementById('sendNotificationButton');
    const unavailable = sendButton.disabled;
    const selected = new Map([...selectedBox.querySelectorAll('input')].map(input => [input.value, `Student #${input.value}`]));
    let searchController, timer;

    function updateSelection() {
        selectedBox.replaceChildren();
        for (const [id, name] of selected) {
            const input = document.createElement('input');
            input.type = 'hidden'; input.name = 'recipients'; input.value = id;
            const remove = document.createElement('button');
            remove.type = 'button'; remove.textContent = `${name} ×`;
            remove.setAttribute('aria-label', `Remove ${name}`);
            remove.addEventListener('click', () => { selected.delete(id); updateSelection(); });
            selectedBox.append(input, remove);
        }
        results.querySelectorAll('input').forEach(input => { input.checked = selected.has(input.value); });
        document.getElementById('recipientCount').textContent = `${selected.size} students selected`;
        sendButton.textContent = audience.value === 'all' ? 'Send to all students' : `Send to ${selected.size} selected students`;
        sendButton.disabled = unavailable || (audience.value === 'selected' && !selected.size);
    }

    async function search() {
        searchController?.abort();
        searchController = new AbortController();
        status.textContent = 'Finding students…';
        try {
            const url = new URL(picker.dataset.searchUrl, location.href);
            url.searchParams.set('q', document.getElementById('recipientSearch').value);
            const response = await fetch(url, { signal: searchController.signal, cache: 'no-store' });
            if (!response.ok || response.redirected) throw new Error();
            const data = await response.json();
            results.replaceChildren();
            for (const student of data.items) {
                const id = String(student.id);
                const label = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox'; checkbox.value = id; checkbox.checked = selected.has(id);
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked && selected.size >= 500) {
                        checkbox.checked = false; status.textContent = 'You can select up to 500 students.'; return;
                    }
                    if (checkbox.checked) selected.set(id, student.name); else selected.delete(id);
                    updateSelection();
                });
                const copy = document.createElement('span');
                copy.textContent = student.name;
                const detail = document.createElement('small');
                detail.textContent = `${student.email} · ${student.department || 'Department not set'}`;
                copy.append(detail); label.append(checkbox, copy); results.append(label);
                if (selected.has(id)) selected.set(id, student.name);
            }
            updateSelection();
            status.textContent = data.items.length ? `Showing ${data.items.length} students. Search to find others.` : 'No matching active students.';
        } catch (error) {
            if (error.name !== 'AbortError') status.textContent = 'Could not load students. Search again or reload this page.';
        }
    }
    audience.addEventListener('change', () => {
        picker.hidden = audience.value !== 'selected';
        document.getElementById('audienceHint').textContent = picker.hidden
            ? 'All currently registered, active students. Administrators are excluded.'
            : 'Choose students below. Selections remain when you change your search.';
        updateSelection();
        if (!picker.hidden) search();
    });
    document.getElementById('recipientSearch').addEventListener('input', () => {
        clearTimeout(timer); searchController?.abort(); timer = setTimeout(search, 250);
    });
    form.addEventListener('submit', () => { sendButton.disabled = true; sendButton.textContent = 'Sending…'; });
    window.addEventListener('pageshow', updateSelection);
    audience.dispatchEvent(new Event('change'));
})();
