/**
 * Toyota B2C order tracking · shared by toyota-b2c-controller.html (users) and the live report "B2C Tracker" dashboard.
 *
 * Data sources (all from the Admin Push snapshot):
 *   - Toyota B2C (slot "toyotaB2c") · sheet "Details" (2nd sheet) · Order No + Status
 *   - Back Order (slot "backorder") · queue position via BoOrderLookup (same logic as bo-order-lookup.html)
 *   - Sales Raw Data (slot "sales") · Col V has a date → Delivered · Col P filled and Col V blank → Pro-Forma
 * User edits, notes and follow-ups live on the server (/api/toyota-b2c-tracker) and survive every Admin Push.
 */
(function (global) {
  const XLSX_SRC = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js";
  const SLOT = "toyotaB2c";
  const API = "/api/toyota-b2c-tracker";
  const FOLLOW_UP_MS = 24 * 60 * 60 * 1000;
  const USER_KEY = "toyota_b2c_controller_user_v1";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const HEADER_MARKERS = [
    "product", "vin", "vehicle identification number", "alj suffix", "exterior color",
    "interior color", "model year", "back order number", "salesman name", "amount",
  ];
  const COL_P = 15;
  const COL_V = 21;

  // ---------- Small helpers ----------

  const str = (v) => (v == null ? "" : String(v)).trim();
  const normHeader = (v) => str(v).toLowerCase().replace(/[_\s]+/g, " ").replace(/[.:#]+$/g, "").trim();

  function colLetter(idx) {
    let n = Number(idx) + 1;
    let s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function fmtDate(d, withTime) {
    if (!(d instanceof Date) || isNaN(d)) return "";
    const base = `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (!withTime || (d.getHours() === 0 && d.getMinutes() === 0)) return base;
    return `${base} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function fmtAt(ms) {
    return ms ? fmtDate(new Date(ms), true) : "";
  }

  /** Excel date cell → "dd Mon yyyy" (+ time only when the cell really has one; SheetJS can shift pure dates by the UTC offset). */
  function excelDateText(v) {
    const d = new Date(Math.round(v.getTime() / 60000) * 60000);
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
      return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    return fmtDate(d, true);
  }

  /** Excel cell → display text (dates as "dd Mon yyyy"). */
  function cellText(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date) return isNaN(v) ? "" : excelDateText(v);
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    return str(v);
  }

  /** Order number cell → comparable key ("" when blank). */
  function orderKey(v) {
    if (v == null || v === "" || v instanceof Date) return "";
    let s;
    if (typeof v === "number") {
      if (!Number.isFinite(v) || v % 1) return "";
      s = String(v);
    } else {
      s = str(v).replace(/^'/, "").replace(/\.0+$/, "").replace(/\s+/g, "").toUpperCase();
    }
    if (/^\d+$/.test(s)) s = s.replace(/^0+/, "") || "0";
    return s;
  }

  function isDateLike(v) {
    if (v == null || v === "") return false;
    if (v instanceof Date) return !isNaN(v);
    if (typeof v === "number") return v > 20000 && v < 80000;
    const s = str(v);
    if (!s || s === "-" || /^0+$/.test(s)) return false;
    if (/\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/.test(s)) return true;
    return /\d/.test(s) && !isNaN(Date.parse(s));
  }

  function hoursText(ms) {
    const h = Math.max(0, ms) / 3600000;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `${Math.floor(h)} h`;
    return `${Math.floor(h / 24)} d ${Math.floor(h % 24)} h`;
  }

  function loadXlsx() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${XLSX_SRC}"]`);
      const s = existing || document.createElement("script");
      s.addEventListener("load", () => resolve(global.XLSX));
      s.addEventListener("error", () => reject(new Error("Could not load the Excel reader")));
      if (!existing) {
        s.src = XLSX_SRC;
        document.head.appendChild(s);
      }
    });
  }

  function readWorkbook(buffer) {
    return global.XLSX.read(buffer, { type: "array", cellDates: true });
  }

  /** Row arrays where index 0 is always Col A; keeps the real sheet row number. */
  function sheetMatrix(sheet) {
    if (!sheet || !sheet["!ref"]) return [];
    const range = global.XLSX.utils.decode_range(sheet["!ref"]);
    range.s.c = 0;
    const rows = global.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true, raw: true, range });
    const out = [];
    rows.forEach((line, i) => {
      if (Array.isArray(line) && line.some((c) => str(c) !== "")) out.push({ sheetRow: range.s.r + i + 1, line });
    });
    return out;
  }

  // ---------- Toyota B2C · Details sheet ----------

  const ORDER_HEADER = (n) => /^order\s*(no|number|num|#)$/.test(n) || /^order\s*no\b/.test(n) || /\border\s*(no|number)\b/.test(n);

  function classifyStatus(text) {
    const s = str(text).toLowerCase();
    if (!s) return "progress";
    if (/cancel/.test(s)) return "cancelled";
    if (/\b(not|un|non)[\s-]*deliver/.test(s)) return "progress";
    if (/deliver/.test(s)) return "delivered";
    return "progress";
  }

  function pickDetailsSheet(workbook) {
    const names = workbook.SheetNames || [];
    return names.find((n) => /^\s*details\s*$/i.test(n))
      || names.find((n) => /details/i.test(n))
      || names[1]
      || names[0]
      || "";
  }

  /**
   * Toyota B2C workbook → orders from the "Details" sheet.
   * @returns {{ ok, sheetName, headers, orderCol, statusCol, rows, warnings, error? }}
   */
  function parseB2c(buffer, fileName) {
    const warnings = [];
    const wb = readWorkbook(buffer);
    const sheetName = pickDetailsSheet(wb);
    if (!sheetName) return { ok: false, error: "The workbook has no sheets", rows: [], headers: [], warnings };
    if (!/details/i.test(sheetName)) warnings.push(`No sheet named "Details" · read "${sheetName}" instead`);
    const matrix = sheetMatrix(wb.Sheets[sheetName]);

    let headerIdx = -1;
    let orderCol = -1;
    for (let i = 0; i < Math.min(matrix.length, 40) && headerIdx < 0; i += 1) {
      const idx = matrix[i].line.findIndex((c) => ORDER_HEADER(normHeader(c)));
      if (idx >= 0) { headerIdx = i; orderCol = idx; }
    }
    if (headerIdx < 0) {
      return { ok: false, sheetName, error: `No "Order No" column found in sheet "${sheetName}"`, rows: [], headers: [], warnings };
    }

    const headerLine = matrix[headerIdx].line;
    let width = headerLine.length;
    for (let i = headerIdx + 1; i < matrix.length; i += 1) width = Math.max(width, matrix[i].line.length);
    while (width > 0 && str(headerLine[width - 1]) === "" && !matrix.slice(headerIdx + 1).some((r) => str(r.line[width - 1]) !== "")) width -= 1;
    const seen = {};
    const headers = Array.from({ length: width }, (_, i) => {
      const h = str(headerLine[i]) || `Column ${colLetter(i)}`;
      seen[h] = (seen[h] || 0) + 1;
      return seen[h] > 1 ? `${h} (${seen[h]})` : h;
    });
    const norms = headers.map(normHeader);
    let statusCol = norms.findIndex((n) => n === "status" || n === "order status");
    if (statusCol < 0) statusCol = norms.findIndex((n) => /status/.test(n) && !/date|time/.test(n));
    if (statusCol < 0) warnings.push('No "Status" column · every order counts as in progress');

    const rows = [];
    const dup = {};
    for (let i = headerIdx + 1; i < matrix.length; i += 1) {
      const { line, sheetRow } = matrix[i];
      const orderNo = cellText(line[orderCol]);
      const base = orderKey(line[orderCol]);
      if (!base) continue;
      if (norms[orderCol] && normHeader(orderNo) === norms[orderCol]) continue;
      dup[base] = (dup[base] || 0) + 1;
      const key = dup[base] > 1 ? `${base}#${dup[base]}` : base;
      rows.push({
        key,
        orderKey: base,
        orderNo,
        sheetRow,
        raw: Array.from({ length: width }, (_, c) => (line[c] == null ? "" : line[c])),
        cells: Array.from({ length: width }, (_, c) => cellText(line[c])),
      });
    }
    const dupCount = Object.values(dup).filter((n) => n > 1).length;
    if (dupCount) warnings.push(`${dupCount} order number(s) appear more than once · each row is tracked separately`);
    return { ok: rows.length > 0, fileName: fileName || "", sheetName, headers, orderCol, statusCol, rows, warnings,
      error: rows.length ? "" : `No orders under "Order No" in sheet "${sheetName}"` };
  }

  // ---------- Back Order (BoOrderLookup rows) ----------

  function detectHeaderIdx(matrix) {
    let headerIdx = 0;
    let bestHits = -1;
    for (let i = 0; i < Math.min(matrix.length, 40); i += 1) {
      const cells = matrix[i].line.map(normHeader);
      const hits = HEADER_MARKERS.filter((m) => cells.some((c) => c === m || c.includes(m))).length;
      if (hits > bestHits) { bestHits = hits; headerIdx = i; }
      if (hits >= 3) break;
    }
    return headerIdx;
  }

  /** First worksheet only (same as the Live report) → { rows, headers } for BoOrderLookup. */
  function parseBackorder(buffer) {
    const wb = readWorkbook(buffer);
    const name = (wb.SheetNames || [])[0];
    if (!name) return { rows: [], headers: [] };
    const matrix = sheetMatrix(wb.Sheets[name]);
    if (!matrix.length) return { rows: [], headers: [] };
    const headerIdx = detectHeaderIdx(matrix);
    let width = 0;
    matrix.forEach((r) => { width = Math.max(width, r.line.length); });
    const seen = {};
    const headers = Array.from({ length: width }, (_, i) => {
      const h = cellText(matrix[headerIdx].line[i]) || `Column ${colLetter(i)}`;
      seen[h] = (seen[h] || 0) + 1;
      return seen[h] > 1 ? `${h} (${seen[h]})` : h;
    });
    const rows = [];
    for (let i = headerIdx + 1; i < matrix.length; i += 1) {
      const obj = {};
      headers.forEach((h, c) => { obj[h] = matrix[i].line[c] != null ? matrix[i].line[c] : ""; });
      obj.__headers = headers;
      rows.push(obj);
    }
    return { rows, headers, sheetName: name };
  }

  // ---------- Sales Raw Data (Col P / Col V) ----------

  function pickSalesSheet(workbook) {
    const names = workbook.SheetNames || [];
    return names.find((n) => /raw\s*data|row\s*data|rowdata/i.test(n)) || names.find((n) => /sales/i.test(n)) || names[0] || "";
  }

  function parseSales(buffer) {
    const wb = readWorkbook(buffer);
    const name = pickSalesSheet(wb);
    if (!name) return { matrix: [], headerIdx: 0, sheetName: "" };
    const matrix = sheetMatrix(wb.Sheets[name]);
    return { matrix, headerIdx: matrix.length ? detectHeaderIdx(matrix) : 0, sheetName: name };
  }

  const SALES_RANK = { delivered: 3, proforma: 2, salesNoDate: 1 };

  /** Sales Raw rows whose cells contain one of the order numbers → best hit per order key. */
  function indexSales(sales, keys) {
    const out = new Map();
    if (!sales || !sales.matrix || !sales.matrix.length || !keys.size) return out;
    for (let i = sales.headerIdx + 1; i < sales.matrix.length; i += 1) {
      const { line, sheetRow } = sales.matrix[i];
      for (let c = 0; c < line.length; c += 1) {
        if (c === COL_P || c === COL_V) continue;
        const k = orderKey(line[c]);
        if (!k || !keys.has(k)) continue;
        const p = line[COL_P];
        const v = line[COL_V];
        const status = isDateLike(v) ? "delivered" : str(cellText(p)) ? "proforma" : "salesNoDate";
        const hit = { status, proforma: cellText(p), delivery: cellText(v), sheetRow, column: colLetter(c) };
        const prev = out.get(k);
        if (!prev || SALES_RANK[status] > SALES_RANK[prev.status]) out.set(k, hit);
      }
    }
    return out;
  }

  // ---------- Model ----------

  const CATEGORY_LABEL = { delivered: "Delivered", cancelled: "Cancelled", progress: "In progress" };
  const TRACK_LABEL = {
    queue: "In BO queue",
    delivered: "Delivered · Sales Raw",
    proforma: "Pro-Forma",
    salesNoDate: "Sales Raw · no P/V date",
    notFound: "Not found",
    noData: "No BO / Sales Raw pushed",
  };

  /**
   * Everything the pages display, recomputed after every Admin Push or user change.
   * @param {{ b2c, bo, sales, state, now }} input
   */
  /** BO engine + queue results and Sales Raw hits only change on Admin Push — cache them per parsed file. */
  const pushCache = new WeakMap();
  function pushLookups(b2c, bo, sales) {
    let entry = pushCache.get(b2c);
    if (!entry || entry.bo !== bo || entry.sales !== sales) {
      entry = {
        bo,
        sales,
        engine: bo && bo.rows && bo.rows.length && global.BoOrderLookup ? new global.BoOrderLookup(bo.rows, bo.headers) : null,
        salesHits: indexSales(sales, new Set(b2c.rows.map((r) => r.orderKey))),
        queue: new Map(),
      };
      pushCache.set(b2c, entry);
    }
    return entry;
  }

  function buildModel(input) {
    const b2c = input.b2c;
    const state = (input.state && input.state.orders) || {};
    const now = Number(input.now) || Date.now();
    if (!b2c || !b2c.ok) return { ready: false, orders: [], headers: [], summary: emptySummary(), b2c };

    const headers = b2c.headers;
    const lookups = pushLookups(b2c, input.bo || null, input.sales || null);
    const engine = lookups.engine;
    const salesHits = lookups.salesHits;
    const hasSales = !!(input.sales && input.sales.matrix && input.sales.matrix.length);
    const queueCache = lookups.queue;

    const orders = b2c.rows.map((row) => {
      const st = state[row.key] || {};
      const edits = st.edits && typeof st.edits === "object" ? st.edits : {};
      const cells = headers.map((h, c) => (Object.prototype.hasOwnProperty.call(edits, h) ? str(edits[h]) : row.cells[c]));
      const statusText = b2c.statusCol >= 0 ? cells[b2c.statusCol] : "";
      const category = classifyStatus(statusText);

      let track = { kind: engine || hasSales ? "notFound" : "noData" };
      if (engine) {
        let found = queueCache.get(row.orderKey);
        if (found === undefined) {
          try { found = engine.lookupOrder(row.orderNo) || null; } catch { found = null; }
          queueCache.set(row.orderKey, found);
        }
        const qr = found && found.queue && found.queue.queueResult;
        if (found) {
          track = {
            kind: "queue",
            position: qr && qr.position != null ? qr.position : null,
            total: qr ? qr.totalQueueSize : null,
            ahead: qr ? qr.ordersAhead : null,
            product: qr ? cellText(qr.product) : "",
            suffix: qr ? cellText(qr.suffix) : "",
            reservationDate: qr ? cellText(qr.reservationDate) : "",
          };
        }
      }
      if (track.kind !== "queue") {
        const hit = salesHits.get(row.orderKey);
        if (hit) track = { kind: hit.status, proforma: hit.proforma, delivery: hit.delivery, sheetRow: hit.sheetRow, column: hit.column };
      }

      const followUps = Array.isArray(st.followUps) ? st.followUps : [];
      const lastFollowUpAt = followUps.length ? Number(followUps[followUps.length - 1].at) || 0 : 0;
      const baseAt = lastFollowUpAt || Number(st.firstSeenAt) || 0;
      const needsFollowUp = category === "progress";
      const dueAt = baseAt ? baseAt + FOLLOW_UP_MS : 0;
      const due = needsFollowUp && !!baseAt && now >= dueAt;

      return {
        key: row.key,
        orderNo: row.orderNo,
        sheetRow: row.sheetRow,
        fileCells: row.cells,
        cells,
        edits,
        editCount: Object.keys(edits).filter((h) => headers.includes(h)).length,
        statusText,
        category,
        track,
        note: str(st.note),
        followUps,
        lastFollowUpAt,
        lastFollowUpBy: followUps.length ? str(followUps[followUps.length - 1].by) : "",
        firstSeenAt: Number(st.firstSeenAt) || 0,
        needsFollowUp,
        due,
        dueAt,
        overdueMs: due ? now - dueAt : 0,
        sinceMs: baseAt ? now - baseAt : 0,
        updatedAt: Number(st.updatedAt) || 0,
        updatedBy: str(st.updatedBy),
        known: !!state[row.key],
      };
    });

    return { ready: true, orders, headers, b2c, summary: summarize(orders), hasBo: !!engine, hasSales, now };
  }

  function emptySummary() {
    return { total: 0, delivered: 0, cancelled: 0, progress: 0, due: 0, onTime: 0, neverFollowed: 0, followUps: 0, edited: 0,
      track: { queue: 0, delivered: 0, proforma: 0, salesNoDate: 0, notFound: 0, noData: 0 }, statuses: [] };
  }

  function summarize(orders) {
    const s = emptySummary();
    const statuses = new Map();
    orders.forEach((o) => {
      s.total += 1;
      s[o.category] += 1;
      if (o.editCount || o.note) s.edited += 1;
      s.followUps += o.followUps.length;
      const label = o.statusText || "(blank)";
      const e = statuses.get(label.toLowerCase()) || { label, count: 0, category: o.category };
      e.count += 1;
      statuses.set(label.toLowerCase(), e);
      if (o.category !== "progress") return;
      s.track[o.track.kind] = (s.track[o.track.kind] || 0) + 1;
      if (o.due) s.due += 1;
      else s.onTime += 1;
      if (!o.followUps.length) s.neverFollowed += 1;
    });
    s.statuses = [...statuses.values()].sort((a, b) => b.count - a.count);
    return s;
  }

  function trackText(t) {
    if (!t) return "";
    if (t.kind === "queue") {
      return t.position != null ? `Queue ${t.position} of ${t.total}` : `In BO file · no queue match (${t.total || 0} in queue)`;
    }
    if (t.kind === "delivered") return `Delivered · ${t.delivery}`;
    if (t.kind === "proforma") return `Pro-Forma · ${t.proforma}`;
    return TRACK_LABEL[t.kind] || "";
  }

  // ---------- Pushed files ----------

  /** Parsed workbooks of the last push; reused until the push stamp or a file changes (Excel is parsed once per push). */
  let parsedMemo = null;

  /**
   * Latest Admin Push → parsed Toyota B2C, Back Order and Sales Raw.
   * @param {{ force?: boolean }} [opts]
   */
  async function loadPushedData(opts) {
    const Store = global.ReportSheetStore;
    await loadXlsx();
    let sync = null;
    try { sync = await Store.syncFromServer(opts || {}); } catch { sync = null; }
    const payload = await Store.loadWorkbookFiles();
    const files = (payload && payload.files) || {};
    const at = Number((sync && sync.at) || (payload && payload.at) || Store.readDataPushStamp().at) || 0;
    const out = { at, fromServer: !!(sync && sync.fromServer), b2c: null, bo: null, sales: null, files: {} };
    Object.keys(files).forEach((id) => { out.files[id] = { name: files[id].name, size: files[id].size }; });
    const sig = [SLOT, "backorder", "sales"].map((id) => {
      const f = files[id];
      return f && f.buffer ? `${id}:${f.name}:${f.buffer.byteLength}` : `${id}:-`;
    }).join("|") + `|${at}`;
    if (parsedMemo && parsedMemo.sig === sig) {
      return { ...out, b2c: parsedMemo.b2c, bo: parsedMemo.bo, sales: parsedMemo.sales };
    }
    const b2cFile = files[SLOT];
    if (b2cFile && b2cFile.buffer) {
      try { out.b2c = parseB2c(b2cFile.buffer, b2cFile.name); } catch (err) { out.b2c = { ok: false, error: err.message || String(err), rows: [], headers: [] }; }
    }
    if (files.backorder && files.backorder.buffer) {
      try { out.bo = parseBackorder(files.backorder.buffer); } catch { out.bo = null; }
    }
    if (files.sales && files.sales.buffer) {
      try { out.sales = parseSales(files.sales.buffer); } catch { out.sales = null; }
    }
    parsedMemo = { sig, b2c: out.b2c, bo: out.bo, sales: out.sales };
    return out;
  }

  // ---------- Server state (edits · notes · follow-ups) ----------

  async function api(path, body) {
    const res = await fetch(`${API}${path}`, body === undefined
      ? { cache: "no-store" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const fetchState = () => api("/state");
  const markSeen = (keys) => (keys && keys.length ? api("/seen", { keys }) : Promise.resolve(null));
  /** patch: { edits?: { [header]: string|null }, note?: string, followUp?: true } */
  const saveOrder = (key, patch) => api("/order", { key, by: getUser(), ...patch });

  function getUser() {
    try { return str(localStorage.getItem(USER_KEY)); } catch { return ""; }
  }
  function setUser(name) {
    try { localStorage.setItem(USER_KEY, str(name).slice(0, 60)); } catch { /* ignore */ }
  }

  /** Re-render when another user edits / follows up (WebSocket, with a poll as fallback). */
  function startStateSync(onUpdate, pollMs) {
    let ws = null;
    let stopped = false;
    let timer = null;
    const fire = () => { try { onUpdate(); } catch { /* ignore */ } };
    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`${global.location.protocol === "https:" ? "wss:" : "ws:"}//${global.location.host}`);
      } catch {
        setTimeout(connect, 3000);
        return;
      }
      ws.onmessage = (e) => {
        try { if (JSON.parse(e.data).type === "toyota_b2c_tracker_updated") fire(); } catch { /* ignore */ }
      };
      ws.onclose = () => { ws = null; if (!stopped) setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    };
    connect();
    timer = setInterval(fire, Math.max(10000, Number(pollMs) || 30000));
    return { stop() { stopped = true; clearInterval(timer); if (ws) try { ws.close(); } catch { /* ignore */ } } };
  }

  // ---------- Live Sheet delivery status (Delivery Transformation · VIN Finder) ----------

  const LIVE_API = "/api/delivery-transformation/vin-finder/lookup";
  const LIVE_TTL = 60 * 1000;
  const liveKey = (v) => str(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const liveCache = new Map();

  /** VIN column of the Details sheet (−1 when the sheet has none). */
  const vinColumn = (headers) => (headers || []).findIndex((h) => /\bvin\b|chassis|فين|الشاصي|الهيكل/i.test(str(h)));

  function liveKeysOf(o, vinIdx) {
    const keys = [liveKey(o.orderNo)];
    if (vinIdx >= 0) keys.push(liveKey(o.cells[vinIdx]));
    return keys.filter((k) => k.length >= 4);
  }

  /** undefined = not checked yet · null = not on the Live Sheet · { vin, order, status, employee } */
  function liveStatusOf(o, vinIdx) {
    let seen = false;
    for (const k of liveKeysOf(o, vinIdx)) {
      const hit = liveCache.get(k);
      if (!hit) continue;
      seen = true;
      if (hit.row) return hit.row;
    }
    return seen ? null : undefined;
  }

  /** Looks up the orders not checked in the last minute; resolves to true when anything new arrived. */
  async function fetchLiveStatus(orders, vinIdx) {
    const now = Date.now();
    const keys = new Set();
    (orders || []).forEach((o) => liveKeysOf(o, vinIdx).forEach((k) => {
      const hit = liveCache.get(k);
      if (!hit || now - hit.at > LIVE_TTL) keys.add(k);
    }));
    if (!keys.size) return false;
    const res = await fetch(LIVE_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: [...keys] }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Live Sheet lookup failed (${res.status})`);
    const results = data.results || {};
    keys.forEach((k) => liveCache.set(k, { at: now, row: results[k] || null }));
    return true;
  }

  /** Same colouring rule as the VIN Finder page. */
  function liveTone(status) {
    const v = str(status);
    if (v === "Claimed" || v === "تم التسليم") return "ok";
    if (v === "جاهز للتسليم" || v === "PSFU") return "warn";
    return "";
  }

  global.ToyotaB2cCore = {
    SLOT,
    FOLLOW_UP_MS,
    CATEGORY_LABEL,
    TRACK_LABEL,
    colLetter,
    cellText,
    fmtAt,
    fmtDate,
    hoursText,
    orderKey,
    classifyStatus,
    loadXlsx,
    parseB2c,
    parseBackorder,
    parseSales,
    buildModel,
    summarize,
    trackText,
    loadPushedData,
    fetchState,
    markSeen,
    saveOrder,
    getUser,
    setUser,
    startStateSync,
    vinColumn,
    liveStatusOf,
    fetchLiveStatus,
    liveTone,
  };
})(typeof window !== "undefined" ? window : globalThis);
