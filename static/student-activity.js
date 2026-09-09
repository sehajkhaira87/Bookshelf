(() => {
    const script = document.currentScript;
    let busy = false, lastAttempt = 0;
    async function heartbeat() {
        if (document.hidden || busy || Date.now() - lastAttempt < 30000) return;
        busy = true; lastAttempt = Date.now();
        try {
            await fetch(script.dataset.endpoint, {
                method: 'POST', body: new URLSearchParams({ _csrf_token: script.dataset.csrf }),
                signal: AbortSignal.timeout(10000)
            });
        } catch (_) {
            // Presence is best effort; a tracking outage must not interrupt studying.
        } finally { busy = false; }
    }
    heartbeat();
    setInterval(heartbeat, 60000);
    document.addEventListener('visibilitychange', heartbeat);
    window.addEventListener('pageshow', heartbeat);
})();
