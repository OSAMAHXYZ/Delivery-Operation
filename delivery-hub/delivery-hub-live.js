/**
 * Live sync for delivery hub pages — WebSocket push + slow fallback poll.
 * Debounced + gap-limited so admin charts are not rebuilt constantly.
 */
(function (global) {
    let ws = null;
    let reconnectTimer = null;
    let fallbackTimer = null;
    let debounceTimer = null;
    let trailingTimer = null;
    let onRefreshFn = null;
    let connected = false;
    let started = false;
    let pollMs = 8000;
    let minRefreshGapMs = 0;
    let debounceMs = 400;
    let pollWhenConnected = true;
    let lastRefreshAt = 0;
    let visibilityBound = false;

    function clearTimer(ref) {
        if (ref) clearTimeout(ref);
        return null;
    }

    function runRefresh() {
        if (!onRefreshFn) return;
        const now = Date.now();
        if (minRefreshGapMs && lastRefreshAt && now - lastRefreshAt < minRefreshGapMs) {
            const wait = minRefreshGapMs - (now - lastRefreshAt);
            if (!trailingTimer) {
                trailingTimer = setTimeout(() => {
                    trailingTimer = null;
                    runRefresh();
                }, wait + 50);
            }
            return;
        }
        lastRefreshAt = now;
        Promise.resolve(onRefreshFn()).catch(() => {});
    }

    function scheduleRefresh() {
        if (!onRefreshFn) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            runRefresh();
        }, debounceMs);
    }

    function wsUrl() {
        const protocol = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${global.location.host}`;
    }

        function startFallbackPoll() {
        if (fallbackTimer) return;
        // When WS is connected and pollWhenConnected is false, use a slow backup only.
        const interval = connected && !pollWhenConnected
            ? Math.max(pollMs, 180000)
            : pollMs;
        fallbackTimer = setInterval(() => scheduleRefresh(), interval);
    }

    function stopFallbackPoll() {
        if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
        }
    }

    function restartFallbackPoll() {
        stopFallbackPoll();
        startFallbackPoll();
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

        try {
            ws = new WebSocket(wsUrl());
        } catch {
            connected = false;
            startFallbackPoll();
            reconnectTimer = setTimeout(connect, 2500);
            return;
        }

        ws.onopen = () => {
            connected = true;
            restartFallbackPoll();
            // Do not force an immediate full refresh on connect — page already loads once.
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'delivery_hub_updated') scheduleRefresh();
            } catch {
                /* ignore */
            }
        };

        ws.onclose = () => {
            connected = false;
            ws = null;
            restartFallbackPoll();
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 2000);
        };

        ws.onerror = () => {
            try { ws.close(); } catch { /* ignore */ }
        };
    }

    function disconnect() {
        started = false;
        reconnectTimer = clearTimer(reconnectTimer);
        debounceTimer = clearTimer(debounceTimer);
        trailingTimer = clearTimer(trailingTimer);
        stopFallbackPoll();
        onRefreshFn = null;
        connected = false;
        if (ws) {
            try { ws.close(); } catch { /* ignore */ }
            ws = null;
        }
    }

    function ensureVisibilityListener() {
        if (visibilityBound) return;
        visibilityBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') scheduleRefresh();
        });
    }

    global.DeliveryHubLive = {
        start(onRefresh, options) {
            const opts = options && typeof options === 'object' ? options : {};
            pollMs = Math.max(5000, Number(opts.pollMs) || 8000);
            minRefreshGapMs = Math.max(0, opts.minRefreshGapMs != null ? Number(opts.minRefreshGapMs) : 0);
            debounceMs = Math.max(200, Number(opts.debounceMs) || 400);
            pollWhenConnected = opts.pollWhenConnected !== false;
            onRefreshFn = typeof onRefresh === 'function' ? onRefresh : null;
            ensureVisibilityListener();
            if (started) {
                restartFallbackPoll();
                return;
            }
            started = true;
            connect();
            startFallbackPoll();
            // Initial page load should call its own loadDashboard — avoid double refresh here.
        },
        stop: disconnect,
        isConnected: () => connected,
        refreshNow: scheduleRefresh
    };
})(window);
