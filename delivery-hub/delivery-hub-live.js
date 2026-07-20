/**
 * Live sync for delivery hub pages — WebSocket push + fast debounced refresh.
 */
(function (global) {
    let ws = null;
    let reconnectTimer = null;
    let fallbackTimer = null;
    let debounceTimer = null;
    let onRefreshFn = null;
    let connected = false;

    function scheduleRefresh() {
        if (!onRefreshFn) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            Promise.resolve(onRefreshFn()).catch(() => {});
        }, 100);
    }

    function wsUrl() {
        const protocol = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${global.location.host}`;
    }

    function startFallbackPoll() {
        if (fallbackTimer) return;
        fallbackTimer = setInterval(() => scheduleRefresh(), 3000);
    }

    function stopFallbackPoll() {
        if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
        }
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

        try {
            ws = new WebSocket(wsUrl());
        } catch {
            startFallbackPoll();
            reconnectTimer = setTimeout(connect, 1500);
            return;
        }

        ws.onopen = () => {
            connected = true;
            // Keep a light poll even with WS so UI stays fresh if a push is missed
            startFallbackPoll();
            scheduleRefresh();
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
            startFallbackPoll();
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 1200);
        };

        ws.onerror = () => {
            try { ws.close(); } catch { /* ignore */ }
        };
    }

    function disconnect() {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (debounceTimer) clearTimeout(debounceTimer);
        stopFallbackPoll();
        reconnectTimer = null;
        debounceTimer = null;
        onRefreshFn = null;
        connected = false;
        if (ws) {
            try { ws.close(); } catch { /* ignore */ }
            ws = null;
        }
    }

    global.DeliveryHubLive = {
        start(onRefresh) {
            onRefreshFn = typeof onRefresh === 'function' ? onRefresh : null;
            connect();
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') scheduleRefresh();
            });
            scheduleRefresh();
        },
        stop: disconnect,
        isConnected: () => connected,
        refreshNow: scheduleRefresh
    };
})(window);
