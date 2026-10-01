(() => {
    const root = document.querySelector('.notification-center');
    if (!root) return;
    const bell = document.getElementById('notificationBell');
    const panel = document.getElementById('notificationPanel');
    const count = document.getElementById('notificationCount');
    const list = document.getElementById('notificationList');
    const status = document.getElementById('notificationStatus');
    const more = document.getElementById('moreNotifications');
    const retry = document.getElementById('retryNotifications');
    const readAll = document.getElementById('readAllNotifications');
    let nextBefore = null, latestId = null, loading = false;

    const photo = document.querySelector('.profile-photo');
    if (photo) {
        photo.addEventListener('error', () => photo.remove());
        if (photo.complete && !photo.naturalWidth) photo.remove();
    }
    function close() { panel.hidden = true; bell.setAttribute('aria-expanded', 'false'); }
    async function markRead(path, values = {}) {
        const response = await fetch(path, { method: 'POST', body: new URLSearchParams({ _csrf_token: root.dataset.csrf, ...values }) });
        if (!response.ok) throw new Error();
    }
    function row(item) {
        const li = document.createElement('li'); li.className = `notification-item${item.read_at ? '' : ' unread'}`;
        const title = document.createElement('h3'); title.textContent = item.title;
        const body = document.createElement('p'); body.textContent = item.body;
        const time = document.createElement('time'); time.dateTime = item.created_at;
        time.textContent = new Date(item.created_at).toLocaleString(); li.append(title, body, time);
        if (item.link_url) {
            const link = document.createElement('a'); link.href = item.link_url; link.textContent = 'View update →'; li.append(link);
        }
        if (!item.read_at) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Mark as read';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try { await markRead(`${root.dataset.endpoint}/${item.id}/read`); await load(); }
                catch (_) { status.textContent = 'Could not mark this notification as read. Please try again.'; button.disabled = false; }
            });
            li.append(button);
        }
        return li;
    }
    async function load(append = false, countOnly = false) {
        if (loading) return;
        loading = true; more.disabled = true; retry.hidden = true;
        try {
            const url = new URL(root.dataset.endpoint, location.href);
            if (append && nextBefore) url.searchParams.set('before', nextBefore);
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error();
            const data = await response.json();
            count.textContent = data.unread_count > 99 ? '99+' : String(data.unread_count);
            count.hidden = !data.unread_count;
            bell.setAttribute('aria-label', `Notifications, ${data.unread_count} unread`);
            if (!countOnly) {
                if (!append) { list.replaceChildren(); latestId = data.items[0]?.id || null; }
                for (const item of data.items) list.append(row(item));
                nextBefore = data.next_before; more.hidden = !nextBefore;
                readAll.disabled = !data.unread_count || !latestId;
                status.textContent = list.children.length ? '' : 'You’re all caught up. New official updates will appear here.';
            }
            bell.removeAttribute('title');
        } catch (_) {
            bell.title = 'Notifications are temporarily unavailable';
            if (!countOnly) { status.textContent = 'Could not load notifications. Please try again.'; retry.hidden = false; }
        } finally { loading = false; more.disabled = false; }
    }
    bell.addEventListener('click', () => {
        panel.hidden = !panel.hidden; bell.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) load();
    });
    document.getElementById('closeNotifications').addEventListener('click', () => { close(); bell.focus(); });
    document.addEventListener('click', event => { if (!root.contains(event.target)) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { close(); bell.focus(); } });
    more.addEventListener('click', () => load(true));
    retry.addEventListener('click', () => load());
    readAll.addEventListener('click', async () => {
        readAll.disabled = true;
        try { await markRead(`${root.dataset.endpoint}/read-all`, { through: latestId }); await load(); }
        catch (_) { status.textContent = 'Could not update your notifications. Please try again.'; readAll.disabled = false; }
    });
    // Refresh the count without moving focus or replacing an open inbox while it is being read.
    setInterval(() => { if (!document.hidden) load(false, true); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false, true); });
    load();
})();
