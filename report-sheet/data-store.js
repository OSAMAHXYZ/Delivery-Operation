/** Shared store: Admin Push → server → Live Sales Report (all laptops) */
(function (global) {
  const DB_NAME = "toyota_report_sheet_v1";
  const DB_VERSION = 1;
  const STORE = "kv";
  const WORKBOOK_KEY = "workbook_files_v1";
  const DATA_PUSH_KEY = "toyota_admin_workbook_push_v1";
  const TARGETS_KEY = "toyota_admin_employee_targets_v1";
  const TARGETS_PUSH_KEY = "toyota_admin_employee_targets_push_v1";
  const ACCESSORIES_SETTLED_KEY = "toyota_admin_accessories_settled_v1";
  const ACCESSORIES_SETTLED_PUSH_KEY = "toyota_admin_accessories_settled_push_v1";
  const WORKING_DAYS_KEY = "toyota_admin_working_days_v1";
  const WORKING_DAYS_PUSH_KEY = "toyota_admin_working_days_push_v1";
  const ALLOCATION_PLAN_KEY = "toyota_admin_allocation_plan_v1";
  const ALLOCATION_PLAN_PUSH_KEY = "toyota_admin_allocation_plan_push_v1";
  const CHANNEL = "toyota_targets_live";
  const API_META = "/api/report-sheet/meta";
  const API_PUSH = "/api/report-sheet/push";
  const API_CLEAR = "/api/report-sheet/clear";
  const API_FILE = "/api/report-sheet/file";

  const SLOT_IDS = ["backorder", "rtl", "central", "sales", "cancelled", "accessories"];

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  function idbGet(key) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function idbSet(key, value) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function idbDelete(key) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function applySettingsToLocalStorage(meta) {
    if (!meta || typeof meta !== "object") return;
    const at = Number(meta.targetsAt || meta.at) || Date.now();
    if (Array.isArray(meta.targets)) {
      localStorage.setItem(TARGETS_KEY, JSON.stringify(meta.targets));
      const total = meta.targets.reduce((s, e) => s + (Number(e && e.target) || 0), 0);
      localStorage.setItem(TARGETS_PUSH_KEY, JSON.stringify({ at, total }));
    }
    const settled = Math.max(0, Number(meta.accessoriesSettled) || 0);
    localStorage.setItem(ACCESSORIES_SETTLED_KEY, JSON.stringify({ amount: settled, at }));
    localStorage.setItem(ACCESSORIES_SETTLED_PUSH_KEY, JSON.stringify({ amount: settled, at }));
    const days = Math.max(1, Number(meta.workingDays) || 22);
    localStorage.setItem(WORKING_DAYS_KEY, JSON.stringify({ days, at }));
    localStorage.setItem(WORKING_DAYS_PUSH_KEY, JSON.stringify({ days, at }));
    const values = meta.allocationValues && typeof meta.allocationValues === "object"
      ? meta.allocationValues
      : {};
    localStorage.setItem(ALLOCATION_PLAN_KEY, JSON.stringify({ values, at }));
    localStorage.setItem(ALLOCATION_PLAN_PUSH_KEY, JSON.stringify({ at }));
  }

  /**
   * @param {Record<string, { name: string, buffer: ArrayBuffer }|null>} filesBySlot
   * @param {{ at?: number }} [opts]
   */
  async function saveWorkbookFiles(filesBySlot, opts) {
    const files = {};
    SLOT_IDS.forEach((id) => {
      const f = filesBySlot[id];
      if (f && f.buffer) {
        files[id] = { name: f.name || id, buffer: f.buffer, size: f.buffer.byteLength };
      }
    });
    const at = Number(opts && opts.at) || Date.now();
    const stamp = {
      at,
      slots: Object.keys(files),
      hasSales: !!files.sales,
      hasCancelled: !!files.cancelled,
    };
    await idbSet(WORKBOOK_KEY, { at: stamp.at, files });
    localStorage.setItem(DATA_PUSH_KEY, JSON.stringify(stamp));
    return stamp;
  }

  async function loadWorkbookFiles() {
    const payload = await idbGet(WORKBOOK_KEY);
    if (!payload || !payload.files) return null;
    return payload;
  }

  async function clearWorkbookFiles() {
    await idbDelete(WORKBOOK_KEY);
    localStorage.removeItem(DATA_PUSH_KEY);
  }

  function readDataPushStamp() {
    try {
      return JSON.parse(localStorage.getItem(DATA_PUSH_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function broadcast(message) {
    if (!("BroadcastChannel" in global)) return;
    try {
      const bc = new BroadcastChannel(CHANNEL);
      bc.postMessage(message);
      bc.close();
    } catch {
      /* ignore */
    }
  }

  async function fetchServerMeta() {
    const res = await fetch(API_META, { cache: "no-store" });
    if (!res.ok) throw new Error(`Server meta ${res.status}`);
    return res.json();
  }

  async function downloadServerFiles(meta) {
    const files = {};
    const slots = Array.isArray(meta && meta.slots) ? meta.slots : [];
    const names = (meta && meta.fileNames) || {};
    await Promise.all(slots.map(async (id) => {
      if (!SLOT_IDS.includes(id)) return;
      try {
        const res = await fetch(`${API_FILE}/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) return;
        const buffer = await res.arrayBuffer();
        if (!buffer || !buffer.byteLength) return;
        let name = names[id] || `${id}.xlsx`;
        const hdr = res.headers.get("X-Report-Sheet-Name");
        if (hdr) {
          try { name = decodeURIComponent(hdr); } catch { /* keep */ }
        }
        files[id] = { name, buffer, size: buffer.byteLength };
      } catch {
        /* skip failed slot */
      }
    }));
    return files;
  }

  /**
   * Pull shared snapshot from server into IndexedDB + localStorage.
   * @param {{ force?: boolean }} [opts] — force:true always re-downloads slot files
   * @returns {Promise<{ at: number, fromServer: boolean, meta?: object }|null>}
   */
  async function syncFromServer(opts) {
    const force = !!(opts && opts.force);
    let meta;
    try {
      meta = await fetchServerMeta();
    } catch {
      return null;
    }
    if (!meta || !Number(meta.at)) return null;

    applySettingsToLocalStorage(meta);

    const localAt = Number(readDataPushStamp().at) || 0;
    const serverAt = Number(meta.at) || 0;
    const local = await loadWorkbookFiles();
    const hasLocal = !!(local && local.files && Object.keys(local.files).length);

    if (!force && serverAt === localAt && hasLocal) {
      return { at: serverAt, fromServer: true, meta, cached: true };
    }

    // Cleared on server
    if (!(Array.isArray(meta.slots) && meta.slots.length)) {
      await clearWorkbookFiles();
      localStorage.setItem(DATA_PUSH_KEY, JSON.stringify({
        at: serverAt,
        slots: [],
        hasSales: false,
        hasCancelled: false,
      }));
      return { at: serverAt, fromServer: true, meta, cleared: true };
    }

    const files = await downloadServerFiles(meta);
    await saveWorkbookFiles(files, { at: serverAt });
    return { at: serverAt, fromServer: true, meta, forced: force };
  }

  /**
   * Push local files + settings to the shared server snapshot.
   */
  async function pushToServer({
    targets,
    accessoriesSettled,
    workingDays,
    allocationValues,
    filesBySlot,
  }) {
    const files = {};
    SLOT_IDS.forEach((id) => {
      const f = filesBySlot && filesBySlot[id];
      if (!f || !f.buffer) return;
      files[id] = {
        name: f.name || `${id}.xlsx`,
        base64: arrayBufferToBase64(f.buffer),
      };
    });
    const res = await fetch(API_PUSH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: targets || [],
        accessoriesSettled: Math.max(0, Number(accessoriesSettled) || 0),
        workingDays: Math.max(1, Number(workingDays) || 22),
        allocationValues: allocationValues || {},
        files,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Push failed (${res.status})`);
    return data;
  }

  async function clearOnServer() {
    const res = await fetch(API_CLEAR, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Clear failed (${res.status})`);
    return data;
  }

  /** WebSocket + poll so other laptops refresh when Admin Push lands. */
  function startLiveSync(onUpdate, options) {
    const opts = options && typeof options === "object" ? options : {};
    const pollMs = Math.max(4000, Number(opts.pollMs) || 8000);
    let lastAt = Number(opts.initialAt) || 0;
    let ws = null;
    let reconnectTimer = null;
    let pollTimer = null;
    let debounceTimer = null;
    let stopped = false;

    const notify = (reason) => {
      if (typeof onUpdate !== "function") return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        Promise.resolve(onUpdate(reason)).catch(() => {});
      }, 200);
    };

    const checkMeta = async (reason) => {
      try {
        const meta = await fetchServerMeta();
        const at = Number(meta && meta.at) || 0;
        if (at && at !== lastAt) {
          lastAt = at;
          notify(reason || "Server update");
        } else if (!lastAt && at) {
          lastAt = at;
        }
      } catch {
        /* offline / not on server */
      }
    };

    const wsUrl = () => {
      const protocol = global.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${global.location.host}`;
    };

    const connect = () => {
      if (stopped) return;
      if (ws && (ws.readyState === 1 || ws.readyState === 0)) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        reconnectTimer = setTimeout(connect, 2000);
        return;
      }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "report_sheet_updated") {
            const at = Number(msg.at) || Date.now();
            if (at !== lastAt) {
              lastAt = at;
              notify("Live sync — Admin Push");
            }
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        ws = null;
        if (!stopped) reconnectTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };
    };

    pollTimer = setInterval(() => checkMeta("Live sync — poll"), pollMs);
    connect();
    checkMeta();

    global.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkMeta("Live sync — focus");
    });

    return {
      stop() {
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (pollTimer) clearInterval(pollTimer);
        if (debounceTimer) clearTimeout(debounceTimer);
        if (ws) {
          try { ws.close(); } catch { /* ignore */ }
        }
      },
      setLastAt(at) {
        lastAt = Number(at) || lastAt;
      },
    };
  }

  global.ReportSheetStore = {
    SLOT_IDS,
    WORKBOOK_KEY,
    DATA_PUSH_KEY,
    TARGETS_KEY,
    TARGETS_PUSH_KEY,
    ACCESSORIES_SETTLED_KEY,
    ACCESSORIES_SETTLED_PUSH_KEY,
    WORKING_DAYS_KEY,
    WORKING_DAYS_PUSH_KEY,
    ALLOCATION_PLAN_KEY,
    ALLOCATION_PLAN_PUSH_KEY,
    CHANNEL,
    saveWorkbookFiles,
    loadWorkbookFiles,
    clearWorkbookFiles,
    readDataPushStamp,
    broadcast,
    fetchServerMeta,
    syncFromServer,
    pushToServer,
    clearOnServer,
    startLiveSync,
    applySettingsToLocalStorage,
  };
})(typeof window !== "undefined" ? window : globalThis);
