(() => {
    const root = document.getElementById('activeStudents');
    const count = document.getElementById('activeStudentCount');
    const list = document.getElementById('activeStudentList');
    const status = document.getElementById('activeStudentStatus');
    const refresh = document.getElementById('refreshActiveStudents');
    const toggle = document.getElementById('toggleActiveStudents');
    const panelCount = document.getElementById('activeStudentPanelCount');
    let latest = null;
    let busy = false;
    function updateSummary() {
        if (!latest) return;
        status.textContent = latest.total
            ? `${latest.total} active students${list.hidden ? ' · student list hidden' : latest.total > latest.items.length ? ` · showing the latest ${latest.items.length}` : ''}`
            : 'No students have been active in the last 5 minutes.';
    }
    function setListHidden(hidden) {
        list.hidden = hidden;
        toggle.textContent = hidden ? 'Show students' : 'Hide students';
        toggle.setAttribute('aria-expanded', String(!hidden));
        updateSummary();
    }
    try { setListHidden(localStorage.getItem('bookshelf_hide_active_students') === 'true'); }
    catch (_) { setListHidden(false); }
    toggle.addEventListener('click', () => {
        setListHidden(!list.hidden);
        try { localStorage.setItem('bookshelf_hide_active_students', String(list.hidden)); }
        catch (_) { /* The visibility control also works without browser storage. */ }
    });
    async function load() {
        if (busy || document.hidden) return;
        busy = true; refresh.disabled = true;
        try {
            const response = await fetch(root.dataset.endpoint, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!response.ok || response.redirected) throw new Error();
            const data = await response.json();
            latest = data;
            count.textContent = panelCount.textContent = data.total.toLocaleString();
            updateSummary();
            if (!list.contains(document.activeElement)) {
                list.replaceChildren();
                for (const student of data.items) {
                    const item = document.createElement('li');
                    const link = document.createElement('a');
                    const url = new URL(root.dataset.userUrl, location.href); url.searchParams.set('q', student.email);
                    link.href = url.href;
                    const name = document.createElement('strong'); name.textContent = student.name;
                    const detail = document.createElement('span');
                    detail.textContent = `${student.department || 'Department not set'}${student.semester_no ? ` · Semester ${student.semester_no}` : ''}`;
                    const time = document.createElement('time'); time.dateTime = student.last_seen_at;
                    time.textContent = `Last seen ${new Date(student.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                    link.append(name, detail, time); item.append(link); list.append(item);
                }
            }
        } catch (_) {
            latest = null;
            count.textContent = panelCount.textContent = '—'; list.replaceChildren();
            status.textContent = 'Active student information is temporarily unavailable. Try refreshing.';
        } finally { busy = false; refresh.disabled = false; }
    }
    refresh.addEventListener('click', load);
    setInterval(load, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    load();
})();
