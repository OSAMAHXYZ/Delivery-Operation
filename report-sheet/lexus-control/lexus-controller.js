/**
 * Lexus Controller · Excel-style sheet of every Lexus B2C order (Details sheet) with
 * user edits, notes and 24 h follow-ups. File values refresh on every Admin Push; user data never does.
 */
(function () {
  const Core = window.LexusCore;
  const Store = window.ReportSheetStore;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtN = new Intl.NumberFormat("en-US");
  const n = (v) => fmtN.format(Number(v) || 0);

  const SYS_COLS = [
    { id: "category", header: "Category" },
    { id: "track", header: "BO Queue / Sales Raw" },
    { id: "followup", header: "Follow-up (every 24 h)" },
    { id: "last", header: "Last follow-up" },
    { id: "note", header: "Notes", editable: true },
  ];

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "progress", label: "In progress" },
    { id: "due", label: "Follow-up due", due: true },
    { id: "delivered", label: "Delivered" },
    { id: "cancelled", label: "Cancelled" },
  ];

  const state = {
    data: null,
    tracker: { at: 0, orders: {} },
    model: null,
    cols: [],
    rows: [],
    sel: { key: "", c: 0 },
    anchor: null,
    dragging: false,
    colFilters: {},
    editing: null,
    fuDialog: null,
    live: { busy: new Set(), error: "", errorAt: 0 },
    filter: "all",
    search: "",
    editedOnly: false,
    pendingRender: false,
    serverOk: false,
    notifiedDue: 0,
    loading: false,
  };

  // ---------- Filters ----------

  const FILTER_FN = {
    all: () => true,
    progress: (o) => o.category === "progress",
    due: (o) => o.due,
    delivered: (o) => o.category === "delivered",
    cancelled: (o) => o.category === "cancelled",
    queue: (o) => o.category === "progress" && o.track.kind === "queue",
    proforma: (o) => o.category === "progress" && o.track.kind === "proforma",
    srDelivered: (o) => o.category === "progress" && o.track.kind === "delivered",
  };

  function visibleOrders() {
    if (!state.model || !state.model.ready) return [];
    const q = state.search.trim().toLowerCase();
    const fn = FILTER_FN[state.filter] || FILTER_FN.all;
    const rules = activeColRules();
    return state.model.orders.filter((o) => {
      if (!fn(o)) return false;
      if (state.editedOnly && !o.editCount && !o.note) return false;
      if (rules.length && !rules.every(([col, rule]) => matchRule(cellText(o, col), rule))) return false;
      if (!q) return true;
      return (o.cells.join(" ") + " " + o.note + " " + Core.trackText(o.track)).toLowerCase().includes(q);
    });
  }

  // ---------- Column filters (one box per column · saved per user in this browser only) ----------

  const CF_HINT = "contains · =exact · !not · empty for blank cells";
  const colKey = (col) => (col.kind === "file" ? `f:${col.header}` : `s:${col.id}`);
  const cfStoreKey = () => `lxc-colfilters:${(Core.getUser() || "guest").trim().toLowerCase()}`;

  function loadColFilters() {
    try { state.colFilters = JSON.parse(localStorage.getItem(cfStoreKey()) || "{}") || {}; } catch { state.colFilters = {}; }
  }

  function saveColFilters() {
    try {
      const clean = Object.fromEntries(Object.entries(state.colFilters).filter(([, v]) => String(v || "").trim()));
      state.colFilters = clean;
      if (Object.keys(clean).length) localStorage.setItem(cfStoreKey(), JSON.stringify(clean));
      else localStorage.removeItem(cfStoreKey());
    } catch { /* storage blocked */ }
  }

  function activeColRules() {
    return state.cols
      .map((col) => [col, String(state.colFilters[colKey(col)] || "").trim()])
      .filter(([, rule]) => rule);
  }

  function matchRule(value, rule) {
    const v = value.replace(/\s+/g, " ").toLowerCase();
    const r = rule.replace(/\s+/g, " ").trim().toLowerCase();
    if (!r) return true;
    if (r === "empty" || r === '""') return v === "";
    if (r === "!empty" || r === '!""') return v !== "";
    if (r.startsWith("!")) return !v.includes(r.slice(1).trim());
    if (r.startsWith("=")) return v === r.slice(1).trim();
    return r.split(" ").every((part) => v.includes(part));
  }

  function clearColFilters() {
    state.colFilters = {};
    saveColFilters();
    render();
  }

  let cfListFor = "";
  function fillFilterList(key) {
    const col = state.cols.find((c) => colKey(c) === key);
    const list = $("lxc-cf-list");
    if (!col || !list || !state.model || !state.model.ready) return;
    const sig = `${key}|${state.model.orders.length}|${state.data ? state.data.at : 0}`;
    if (cfListFor === sig) return;
    cfListFor = sig;
    const seen = new Map();
    state.model.orders.forEach((o) => {
      const v = cellText(o, col).replace(/\s+/g, " ");
      if (v && v.length <= 80) seen.set(v, (seen.get(v) || 0) + 1);
    });
    const values = [...seen.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 400);
    list.innerHTML = values.map((v) => `<option value="${esc(v)}"></option>`).join("");
  }

  // ---------- Model ----------

  function rebuild() {
    const d = state.data;
    state.model = d && d.b2c && d.b2c.ok
      ? Core.buildModel({ b2c: d.b2c, bo: d.bo, sales: d.sales, state: state.tracker, now: Date.now() })
      : null;
    const headers = state.model ? state.model.headers : [];
    state.cols = headers.map((h, i) => ({ kind: "file", idx: i, header: h, letter: Core.colLetter(i), editable: true }))
      .concat(SYS_COLS.map((s, i) => ({ kind: "sys", id: s.id, header: s.header, letter: Core.colLetter(headers.length + i), editable: !!s.editable })));
  }

  // ---------- Render ----------

  function render() {
    if (state.editing) { state.pendingRender = true; return; }
    state.pendingRender = false;
    renderSource();
    renderKpis();
    renderFilters();
    renderAlert();
    renderGrid();
    $("lxc-export").disabled = !(state.model && state.model.ready);
  }

  function renderSource() {
    const d = state.data;
    const el = $("lxc-source");
    if (!d) { el.textContent = "Loading the latest Admin Push…"; return; }
    const f = d.files || {};
    const pushed = d.at ? Core.fmtAt(d.at) : "—";
    if (!d.b2c) { el.innerHTML = `No <b>Lexus B2C</b> file in the Admin Push · last push ${esc(pushed)}`; return; }
    const parts = [
      `<b>${esc((f.lexusB2c && f.lexusB2c.name) || "Lexus B2C")}</b>`,
      `sheet ${esc(d.b2c.sheetName || "—")}`,
      `${n(d.b2c.rows ? d.b2c.rows.length : 0)} orders`,
      `pushed ${esc(pushed)}`,
      `Back Order ${d.bo && d.bo.rows.length ? "✓" : "—"}`,
      `Sales Raw ${d.sales && d.sales.matrix.length ? "✓" : "—"}`,
    ];
    el.innerHTML = parts.join(" · ");
  }

  function kpi(label, value, sub, tone, filter, alert) {
    const on = state.filter === filter ? " is-on" : "";
    return `<button type="button" class="lxc-kpi ${tone}${on}${alert ? " is-alert" : ""}" data-filter="${filter}">
      <small>${esc(label)}</small><b class="num">${n(value)}</b><em>${sub}</em></button>`;
  }

  function renderKpis() {
    const s = state.model && state.model.ready ? state.model.summary : null;
    const box = $("lxc-kpis");
    if (!s) { box.innerHTML = ""; return; }
    const pct = (v) => (s.total ? `${((v / s.total) * 100).toFixed(1)}%` : "—");
    const t = s.track;
    const hasBo = state.model.hasBo;
    const hasSales = state.model.hasSales;
    box.innerHTML = [
      kpi("Total orders", s.total, `${n(s.edited)} edited by users`, "t-slate", "all"),
      kpi("Delivered", s.delivered, `${pct(s.delivered)} of orders`, "t-green", "delivered"),
      kpi("Cancelled", s.cancelled, `${pct(s.cancelled)} of orders`, "t-rose", "cancelled"),
      kpi("In progress", s.progress, `${pct(s.progress)} of orders`, "t-blue", "progress"),
      kpi("Follow-up due", s.due, s.due ? "no follow-up in 24 h" : "all followed up", "t-red", "due", s.due > 0),
      kpi("In BO queue", t.queue, hasBo ? "in progress · Back Order" : "Back Order not pushed", "t-amber", "queue"),
      kpi("Pro-Forma", t.proforma, hasSales ? "Sales Raw Col P · V blank" : "Sales Raw not pushed", "t-indigo", "proforma"),
      kpi("Delivered · Sales Raw", t.delivered, hasSales ? "Sales Raw Col V has a date" : "Sales Raw not pushed", "t-teal", "srDelivered"),
    ].join("");
  }

  function renderFilters() {
    const s = state.model && state.model.ready ? state.model.summary : null;
    const counts = s ? { all: s.total, progress: s.progress, due: s.due, delivered: s.delivered, cancelled: s.cancelled } : {};
    const extra = FILTERS.some((f) => f.id === state.filter) ? "" : state.filter;
    $("lxc-filter").innerHTML = FILTERS.map((f) => `<button type="button" role="tab" class="${state.filter === f.id ? "is-on" : ""}${f.due ? " is-due" : ""}" data-filter="${f.id}">${esc(f.label)}<b class="num">${s ? n(counts[f.id]) : ""}</b></button>`).join("")
      + (extra ? `<button type="button" class="is-on" data-filter="all" title="Clear filter">${esc(kpiLabel(extra))} ✕</button>` : "");
  }

  const kpiLabel = (id) => ({ queue: "In BO queue", proforma: "Pro-Forma", srDelivered: "Delivered · Sales Raw" }[id] || id);

  function renderAlert() {
    const el = $("lxc-alert");
    const due = state.model && state.model.ready ? state.model.summary.due : 0;
    document.title = `${due ? `(${due}) ` : ""}Lexus Controller · B2C Orders`;
    if (!due) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>⚠</span><span><b class="num">${n(due)}</b> order${due === 1 ? "" : "s"} need${due === 1 ? "s" : ""} a follow-up — no follow-up recorded in the last 24 hours.
      After you contact the customer, click <b>Yes</b> in the Follow-up column and update the notes.</span>
      <button type="button" data-filter="due">Show only these</button>`;
  }

  function cellValue(o, col) {
    if (col.kind === "file") return o.cells[col.idx];
    if (col.id === "category") return Core.CATEGORY_LABEL[o.category];
    if (col.id === "track") return Core.trackText(o.track);
    if (col.id === "followup") return followUpText(o);
    if (col.id === "last") return lastText(o);
    if (col.id === "note") return o.note;
    return "";
  }

  function cellText(o, col) {
    const v = String(cellValue(o, col) ?? "").trim();
    return v === "—" ? "" : v;
  }

  function followUpText(o) {
    if (!o.needsFollowUp) return "Not needed";
    if (!o.firstSeenAt) return "Starting…";
    if (o.due) return `Due · ${Core.hoursText(o.sinceMs)} without follow-up`;
    return `Next in ${Core.hoursText(o.dueAt - Date.now())}`;
  }

  function lastText(o) {
    if (!o.lastFollowUpAt) return "—";
    return `${Core.fmtAt(o.lastFollowUpAt)}${o.lastFollowUpBy ? ` · ${o.lastFollowUpBy}` : ""}${o.followUps.length > 1 ? ` (${o.followUps.length}×)` : ""}`;
  }

  function followUpHtml(o) {
    if (!o.needsFollowUp) return `<span class="lxc-fu lxc-fu-na">Not needed · ${esc(Core.CATEGORY_LABEL[o.category])}</span>`;
    if (!o.firstSeenAt) return `<span class="lxc-fu lxc-fu-na">Starting…</span>`;
    if (o.due) {
      return `<span class="lxc-fu"><span class="lxc-fu-due">● ${esc(Core.hoursText(o.sinceMs))} without follow-up</span>Sent follow-up? <button type="button" data-fu="${esc(o.key)}">Yes</button></span>`;
    }
    return `<span class="lxc-fu"><span class="lxc-fu-ok">✓ Next in ${esc(Core.hoursText(o.dueAt - Date.now()))}</span><button type="button" class="is-ghost" data-fu="${esc(o.key)}" title="Record a follow-up now">Log now</button></span>`;
  }

  function trackHtml(o) {
    const t = o.track;
    let extra = "";
    if (t.kind === "queue" && t.position != null) extra = `<small>${n(t.ahead)} ahead${t.product ? ` · ${esc(t.product)} ${esc(t.suffix)}` : ""}</small>`;
    if ((t.kind === "delivered" || t.kind === "proforma" || t.kind === "salesNoDate") && t.sheetRow) extra = `<small>Sales Raw row ${t.sheetRow}</small>`;
    if (o.category !== "progress" && (t.kind === "notFound" || t.kind === "noData")) return `<span class="lxc-trk k-notFound">—</span>`;
    return `<span class="lxc-trk k-${t.kind}">${esc(Core.trackText(t))}${extra}</span>`;
  }

  // ---------- Live Sheet delivery status (Delivery Transformation · VIN Finder) ----------

  const LIVE_RETRY_MS = 60 * 1000;
  const vinIdx = () => (state.model ? Core.vinColumn(state.model.headers) : -1);

  function categoryHtml(o) {
    const pill = `<span class="lxc-cat c-${o.category}">${esc(Core.CATEGORY_LABEL[o.category])}</span>`;
    if (o.category !== "delivered") return pill;
    const live = Core.liveStatusOf(o, vinIdx());
    let badge;
    if (live === undefined) {
      badge = `<span class="lxc-lstat is-idle">${state.live.busy.has(o.key) ? "Checking…" : state.live.error ? "Live Sheet unavailable" : "Live Sheet status ›"}</span>`;
    } else if (live === null) {
      badge = `<span class="lxc-lstat is-none">Not on Live Sheet</span>`;
    } else {
      const tone = Core.liveTone(live.status);
      badge = `<span class="lxc-lstat${tone ? ` is-${tone}` : ""}"><bdi>${esc(live.status || "No status")}</bdi>${live.employee ? ` · <bdi>${esc(live.employee)}</bdi>` : ""}</span>`;
    }
    const tip = live ? `Live Sheet · ${live.status || "no status"}${live.employee ? ` · ${live.employee}` : ""}${live.vin ? ` · VIN ${live.vin}` : ""}` : "Show the delivery status on the Live Sheet (VIN Finder)";
    return `<button type="button" class="lxc-catbtn" data-live="${esc(o.key)}" title="${esc(tip)}">${pill}${badge}</button>`;
  }

  function ensureLive(orders, force) {
    if (!force && state.live.error && Date.now() - state.live.errorAt < LIVE_RETRY_MS) return;
    const list = orders.filter((o) => o.category === "delivered" && !state.live.busy.has(o.key));
    if (!list.length) return;
    list.forEach((o) => state.live.busy.add(o.key));
    Core.fetchLiveStatus(list, vinIdx())
      .then((changed) => {
        state.live.error = "";
        list.forEach((o) => state.live.busy.delete(o.key));
        if (changed || force) render();
      })
      .catch((err) => {
        state.live.error = err.message || "Live Sheet lookup failed";
        state.live.errorAt = Date.now();
        list.forEach((o) => state.live.busy.delete(o.key));
        render();
        if (force) toast(`Live Sheet: ${state.live.error}`, true);
      });
  }

  function checkLive(key) {
    const o = state.model && state.model.orders.find((x) => x.key === key);
    if (!o) return;
    ensureLive([o], true);
    if (Core.liveStatusOf(o, vinIdx()) === undefined) render();
  }

  function cellHtml(o, col, r, c) {
    const attrs = `data-r="${r}" data-c="${c}"`;
    if (col.kind === "file") {
      const v = o.cells[col.idx];
      const edited = Object.prototype.hasOwnProperty.call(o.edits, col.header);
      const cls = [edited ? "is-edited" : "", /^-?[\d,]+(\.\d+)?$/.test(v) ? "is-num" : ""].filter(Boolean).join(" ");
      const title = edited
        ? `File value: ${o.fileCells[col.idx] || "(blank)"} · edited${o.updatedBy ? ` by ${o.updatedBy}` : ""} · right-click to revert`
        : v;
      return `<td ${attrs} class="${cls}" title="${esc(title)}">${esc(v)}</td>`;
    }
    if (col.id === "note") {
      return `<td ${attrs} class="is-note${o.note ? " is-edited" : ""}" title="${esc(o.note || "Double-click to add a note")}">${esc(o.note)}</td>`;
    }
    let inner = "";
    if (col.id === "category") inner = categoryHtml(o);
    else if (col.id === "track") inner = trackHtml(o);
    else if (col.id === "followup") inner = followUpHtml(o);
    else if (col.id === "last") inner = esc(lastText(o));
    return `<td ${attrs} class="is-sys">${inner}</td>`;
  }

  function renderGrid() {
    const empty = $("lxc-empty");
    const d = state.data;
    if (!state.model || !state.model.ready) {
      $("lxc-grid").innerHTML = "";
      empty.hidden = false;
      const err = d && d.b2c && d.b2c.error;
      empty.innerHTML = `<div class="lxc-empty-card">${!d
        ? "<strong>Loading…</strong><p>Reading the latest Admin Push.</p>"
        : err
          ? `<strong>Could not read the Lexus B2C file</strong><p>${esc(err)}</p>`
          : "<strong>No Lexus B2C file pushed yet</strong><p>Admin: open <b>Admin Push</b>, upload the <b>Lexus B2C</b> workbook (slot 9 · sheet <b>Details</b> with <b>Order No</b> and <b>Status</b>), then click <b>Push to live</b>. This page updates by itself.</p>"}</div>`;
      $("lxc-status-right").textContent = "";
      return;
    }
    empty.hidden = true;
    state.rows = visibleOrders();
    if (state.filter === "delivered") ensureLive(state.rows);
    const cols = state.cols;
    const head1 = `<tr class="lxc-letters"><th class="lxc-corner"></th>${cols.map((c, i) => `<th class="${c.kind === "sys" ? "is-sys" : ""}" data-col="${i}">${c.letter}</th>`).join("")}</tr>`;
    const head2 = `<tr class="lxc-heads"><th class="lxc-corner">#</th>${cols.map((c) => `<th class="${c.kind === "sys" ? "is-sys" : ""}" title="${esc(c.header)}">${esc(c.header)}</th>`).join("")}</tr>`;
    const colRules = activeColRules().length;
    const head3 = `<tr class="lxc-frow"><th class="lxc-corner">${colRules
      ? `<button type="button" class="lxc-cf-x" data-cf-clear title="Clear all column filters">✕</button>`
      : `<span title="Type in a box to filter that column · ${esc(CF_HINT)}">▼</span>`}</th>${cols.map((c) => {
      const key = colKey(c);
      const v = state.colFilters[key] || "";
      return `<th class="${c.kind === "sys" ? "is-sys" : ""}${v ? " is-on" : ""}"><input type="search" class="lxc-cf" data-cf="${esc(key)}" value="${esc(v)}" list="lxc-cf-list" autocomplete="off" spellcheck="false" placeholder="Filter…" title="${esc(`${c.header}: ${CF_HINT}`)}" aria-label="Filter ${esc(c.header)}" /></th>`;
    }).join("")}</tr>`;
    const body = state.rows.map((o, r) => `<tr class="${o.due ? "is-due" : ""}${o.category === "cancelled" ? " is-cancelled" : ""}"><td class="lxc-rn" data-rn="${r}" title="Details sheet row ${o.sheetRow} · click to select the row">${o.sheetRow}</td>${cols.map((col, c) => cellHtml(o, col, r, c)).join("")}</tr>`).join("");
    const emptyMsg = colRules ? "No orders match your column filters." : "No orders match this filter.";
    const scroll = $("lxc-scroll");
    const grid = $("lxc-grid");
    const top = scroll.scrollTop;
    const left = scroll.scrollLeft;
    const focused = document.activeElement;
    const keep = focused && focused.classList && focused.classList.contains("lxc-cf") && grid.contains(focused)
      ? { key: focused.dataset.cf, start: focused.selectionStart, end: focused.selectionEnd }
      : null;
    grid.innerHTML = `<thead>${head1}${head2}${head3}</thead><tbody>${body || `<tr><td class="lxc-rn"></td><td colspan="${cols.length}" style="color:#94a3b8;padding:14px 10px">${emptyMsg}</td></tr>`}</tbody>`;
    const heads = grid.querySelector("tr.lxc-heads");
    if (heads) grid.style.setProperty("--lxc-ftop", `${heads.offsetTop + heads.offsetHeight}px`);
    scroll.scrollTop = top;
    scroll.scrollLeft = left;
    if (keep) {
      const input = [...grid.querySelectorAll("input.lxc-cf")].find((i) => i.dataset.cf === keep.key);
      if (input) {
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(keep.start, keep.end); } catch { /* not supported */ }
      }
    }
    const cfBtn = $("lxc-cf-clear");
    cfBtn.hidden = !colRules;
    cfBtn.textContent = `Clear column filters (${colRules})`;
    const s = state.model.summary;
    const editedCells = state.model.orders.reduce((a, o) => a + o.editCount, 0);
    $("lxc-status-right").textContent = `${n(state.rows.length)} of ${n(s.total)} orders shown${colRules ? ` · ${colRules} column filter${colRules === 1 ? "" : "s"}` : ""} · ${n(editedCells)} edited cells · ${n(s.followUps)} follow-ups logged`;
    applySelection(false);
  }

  // ---------- Selection & keyboard ----------

  function selRowIndex() {
    const i = state.rows.findIndex((o) => o.key === state.sel.key);
    return i >= 0 ? i : (state.rows.length ? 0 : -1);
  }

  function cellEl(r, c) {
    return $("lxc-grid").querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  }

  // Range = anchor cell → active cell (state.sel); both follow the order key so filters and re-renders keep them.
  function rangeBounds() {
    const r = selRowIndex();
    if (r < 0) return null;
    const c = Math.max(0, Math.min(state.cols.length - 1, state.sel.c));
    let ar = r;
    let ac = c;
    if (state.anchor) {
      const i = state.rows.findIndex((o) => o.key === state.anchor.key);
      if (i >= 0) { ar = i; ac = Math.max(0, Math.min(state.cols.length - 1, state.anchor.c)); }
    }
    return { r1: Math.min(r, ar), r2: Math.max(r, ar), c1: Math.min(c, ac), c2: Math.max(c, ac) };
  }

  function rangeSize(b) {
    return b ? (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1) : 0;
  }

  function applySelection(scroll) {
    const grid = $("lxc-grid");
    grid.querySelectorAll(".is-sel, .is-colsel, .is-rowsel, .is-range").forEach((el) => el.classList.remove("is-sel", "is-colsel", "is-rowsel", "is-range"));
    const r = selRowIndex();
    if (r < 0) { $("lxc-namebox").textContent = ""; $("lxc-fxval").textContent = ""; renderSelInfo(null); return; }
    const c = Math.max(0, Math.min(state.cols.length - 1, state.sel.c));
    state.sel = { key: state.rows[r].key, c };
    const b = rangeBounds();
    const multi = rangeSize(b) > 1;
    const body = grid.tBodies[0];
    for (let i = b.r1; i <= b.r2; i += 1) {
      const tr = body && body.rows[i];
      if (!tr) continue;
      const rn = tr.cells[0];
      if (rn && rn.classList.contains("lxc-rn")) rn.classList.add("is-rowsel");
      if (multi) for (let j = b.c1; j <= b.c2; j += 1) { const cell = tr.cells[j + 1]; if (cell) cell.classList.add("is-range"); }
    }
    for (let j = b.c1; j <= b.c2; j += 1) {
      const th = grid.querySelector(`th[data-col="${j}"]`);
      if (th) th.classList.add("is-colsel");
    }
    const td = cellEl(r, c);
    if (td) {
      td.classList.add("is-sel");
      if (scroll) td.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const o = state.rows[r];
    const col = state.cols[c];
    $("lxc-namebox").textContent = multi
      ? `${state.cols[b.c1].letter}${state.rows[b.r1].sheetRow}:${state.cols[b.c2].letter}${state.rows[b.r2].sheetRow}`
      : `${col.letter}${o.sheetRow}`;
    const v = cellValue(o, col);
    const fileNote = col.kind === "file" && Object.prototype.hasOwnProperty.call(o.edits, col.header) ? `   ·   file value: ${o.fileCells[col.idx] || "(blank)"}` : "";
    $("lxc-fxval").textContent = `${v}${fileNote}`;
    renderSelInfo(multi ? b : null);
  }

  function renderSelInfo(b) {
    const el = $("lxc-selinfo");
    if (!b) { el.textContent = ""; return; }
    const size = rangeSize(b);
    let filled = 0;
    let sum = 0;
    let nums = 0;
    if (size <= 50000) {
      for (let r = b.r1; r <= b.r2; r += 1) {
        for (let c = b.c1; c <= b.c2; c += 1) {
          const v = cellText(state.rows[r], state.cols[c]);
          if (!v) continue;
          filled += 1;
          if (state.cols[c].kind === "file" && /^-?[\d,]+(\.\d+)?$/.test(v) && !/^0\d|^\d{7,}$/.test(v)) { sum += Number(v.replace(/,/g, "")); nums += 1; }
        }
      }
    }
    const parts = [`${n(b.r2 - b.r1 + 1)}R × ${n(b.c2 - b.c1 + 1)}C`, `Count: ${n(filled)}`];
    if (nums > 1) parts.push(`Sum: ${fmtN.format(Math.round(sum * 100) / 100)}`);
    el.textContent = `${parts.join("   ")}   ·   Ctrl+C copy · Ctrl+Shift+C with headers`;
  }

  function moveSel(dr, dc, extend) {
    if (!state.rows.length) return;
    if (extend && !state.anchor) state.anchor = { ...state.sel };
    if (!extend) state.anchor = null;
    const r = Math.max(0, Math.min(state.rows.length - 1, selRowIndex() + dr));
    const c = Math.max(0, Math.min(state.cols.length - 1, state.sel.c + dc));
    state.sel = { key: state.rows[r].key, c };
    applySelection(true);
  }

  function selectBlock(r1, c1, r2, c2) {
    if (!state.rows.length) return;
    const clampR = (r) => Math.max(0, Math.min(state.rows.length - 1, r));
    const clampC = (c) => Math.max(0, Math.min(state.cols.length - 1, c));
    state.sel = { key: state.rows[clampR(r1)].key, c: clampC(c1) };
    state.anchor = { key: state.rows[clampR(r2)].key, c: clampC(c2) };
    applySelection(false);
  }

  function inRange(r, c) {
    const b = rangeBounds();
    return !!b && r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;
  }

  // ---------- Copy (TSV + bordered HTML table so Excel / Outlook paste as cells) ----------

  let copyPayload = null;

  function buildCopy(withHeaders) {
    const b = rangeBounds();
    if (!b) return null;
    const cols = state.cols.slice(b.c1, b.c2 + 1);
    const grid = [];
    if (withHeaders) grid.push(cols.map((c) => c.header));
    for (let r = b.r1; r <= b.r2; r += 1) grid.push(cols.map((col) => cellText(state.rows[r], col)));
    const tsvCell = (v) => (/[\t\r\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const text = grid.map((line) => line.map(tsvCell).join("\t")).join("\r\n");
    const td = "border:1px solid #9aa5b1;padding:4px 8px;white-space:nowrap;vertical-align:top";
    const th = `${td};background:#e9efe9;font-weight:bold`;
    // Long digit strings / leading zeros (VINs, order numbers, phones) must stay text in Excel.
    const keepText = (v) => (/^\+?0\d|^\d{12,}$/.test(v) ? ";mso-number-format:'\\@'" : "");
    const cellHtmlOut = (v) => esc(v).replace(/\r?\n/g, '<br style="mso-data-placement:same-cell">');
    const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">${grid.map((line, i) =>
      `<tr>${line.map((v) => (withHeaders && i === 0 ? `<th style="${th}">${esc(v)}</th>` : `<td style="${td}${keepText(v)}">${cellHtmlOut(v)}</td>`)).join("")}</tr>`
    ).join("")}</table>`;
    return { text, html, cells: rangeSize(b) };
  }

  function copyRange(withHeaders) {
    const p = buildCopy(withHeaders);
    if (!p) return;
    const done = () => {
      const msg = `Copied ${n(p.cells)} cell${p.cells === 1 ? "" : "s"}${withHeaders ? " with headers" : ""}`;
      setStatus(msg);
      toast(msg);
    };
    copyPayload = p;
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    copyPayload = null;
    if (ok) { done(); return; }
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new window.ClipboardItem({
        "text/plain": new Blob([p.text], { type: "text/plain" }),
        "text/html": new Blob([p.html], { type: "text/html" }),
      })]).then(done, () => toast("Copy blocked by the browser", true));
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(p.text).then(done, () => toast("Copy blocked by the browser", true));
    }
  }

  document.addEventListener("copy", (e) => {
    if (!copyPayload || !e.clipboardData) return;
    e.clipboardData.setData("text/plain", copyPayload.text);
    e.clipboardData.setData("text/html", copyPayload.html);
    e.preventDefault();
  });

  function startEdit(initial) {
    const r = selRowIndex();
    if (r < 0) return;
    const col = state.cols[state.sel.c];
    if (!col || !col.editable) {
      toast(col && col.id === "followup" ? "Use the Yes button to record a follow-up" : "This column is calculated by the system");
      return;
    }
    const o = state.rows[r];
    const td = cellEl(r, state.sel.c);
    if (!td) return;
    const current = col.kind === "file" ? o.cells[col.idx] : o.note;
    td.classList.add("is-editing");
    td.innerHTML = `<input type="text" />`;
    const input = td.querySelector("input");
    input.value = initial != null ? initial : current;
    state.editing = { key: o.key, c: state.sel.c, input, current };
    input.focus();
    if (initial == null) input.select();
    input.addEventListener("keydown", onEditKey);
    input.addEventListener("blur", () => { if (state.editing && state.editing.input === input) commitEdit(0, 0); });
  }

  function onEditKey(e) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  }

  function endEdit() {
    state.editing = null;
    render();
    $("lxc-scroll").focus({ preventScroll: true });
  }

  function cancelEdit() {
    if (!state.editing) return;
    endEdit();
  }

  function commitEdit(dr, dc) {
    const ed = state.editing;
    if (!ed) return;
    const value = ed.input.value;
    state.editing = null;
    const o = state.model.orders.find((x) => x.key === ed.key);
    const col = state.cols[ed.c];
    if (o && col && value !== ed.current) {
      if (col.kind === "file") {
        const fileVal = o.fileCells[col.idx];
        saveEdit(o.key, { edits: { [col.header]: value === fileVal ? null : value } });
      } else {
        saveEdit(o.key, { note: value });
      }
    }
    render();
    if (dr || dc) moveSel(dr, dc);
    $("lxc-scroll").focus({ preventScroll: true });
  }

  // ---------- Saving (optimistic, then server) ----------

  function ensureUser() {
    let name = Core.getUser();
    if (!name) {
      name = (window.prompt("Your name (saved with your edits and follow-ups):") || "").trim();
      if (name) {
        Core.setUser(name);
        $("lxc-user").value = name;
      }
    }
    $("lxc-user").closest(".lxc-user").classList.toggle("is-missing", !name);
    return name;
  }

  function applyLocal(key, patch) {
    const orders = state.tracker.orders || (state.tracker.orders = {});
    const entry = orders[key] || (orders[key] = {});
    const at = Date.now();
    if (!entry.firstSeenAt) entry.firstSeenAt = at;
    if (patch.edits) {
      entry.edits = { ...(entry.edits || {}) };
      Object.entries(patch.edits).forEach(([h, v]) => { if (v === null) delete entry.edits[h]; else entry.edits[h] = v; });
    }
    if (patch.note !== undefined) entry.note = patch.note;
    if (patch.followUp) entry.followUps = (entry.followUps || []).concat([{ at, by: Core.getUser(), note: entry.note || "" }]);
    entry.updatedAt = at;
    entry.updatedBy = Core.getUser();
  }

  async function saveEdit(key, patch) {
    ensureUser();
    applyLocal(key, patch);
    rebuild();
    render();
    try {
      await Core.saveOrder(key, patch);
      setStatus(patch.followUp ? "Follow-up saved" : "Saved");
    } catch (err) {
      toast(`Not saved: ${err.message || err}`, true);
      refreshState();
    }
  }

  // A follow-up is only recorded together with an updated note.
  function followUp(key) {
    const o = state.model && state.model.orders.find((x) => x.key === key);
    if (!o) return;
    if (state.editing) commitEdit(0, 0);
    $("lxc-menu").hidden = true;
    const prev = o.note || "";
    const note = $("lxc-fu-note");
    note.value = prev;
    $("lxc-fu-sub").textContent = `Order ${o.orderNo} · ${followUpText(o)}`;
    state.fuDialog = { key, prev: prev.trim() };
    syncFollowUpDialog();
    $("lxc-fu-dialog").hidden = false;
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
  }

  function syncFollowUpDialog() {
    const d = state.fuDialog;
    if (!d) return;
    const v = $("lxc-fu-note").value.trim();
    const ok = !!v && v !== d.prev;
    $("lxc-fu-save").disabled = !ok;
    const hint = $("lxc-fu-hint");
    hint.textContent = !v ? "Write a note about this follow-up to continue."
      : v === d.prev ? "Update the notes — they must change with every follow-up."
      : "Ctrl + Enter to save";
    hint.classList.toggle("is-warn", !ok);
  }

  function closeFollowUpDialog() {
    state.fuDialog = null;
    $("lxc-fu-dialog").hidden = true;
    $("lxc-scroll").focus({ preventScroll: true });
  }

  function submitFollowUp() {
    const d = state.fuDialog;
    if (!d) return;
    const note = $("lxc-fu-note").value.trim();
    if (!note || note === d.prev) { syncFollowUpDialog(); $("lxc-fu-note").focus(); return; }
    const o = state.model && state.model.orders.find((x) => x.key === d.key);
    closeFollowUpDialog();
    saveEdit(d.key, { followUp: true, note });
    if (o) toast(`Follow-up and notes saved for order ${o.orderNo} · next one due in 24 h`);
  }

  // ---------- Loading ----------

  async function refreshState() {
    try {
      state.tracker = await Core.fetchState();
      state.serverOk = true;
    } catch {
      state.serverOk = false;
    }
    setLive();
    rebuild();
    render();
  }

  async function loadAll(force) {
    if (state.loading) return;
    state.loading = true;
    setStatus(force ? "Admin Push received · reloading…" : "Loading the latest Admin Push…");
    try {
      state.data = await Core.loadPushedData({ force: !!force });
    } catch (err) {
      toast(`Could not load the Admin Push: ${err.message || err}`, true);
    }
    state.loading = false;
    await refreshState();
    setStatus(state.data && state.data.b2c && state.data.b2c.ok ? "Ready" : "Waiting for the Lexus B2C file");
    const warnings = state.data && state.data.b2c && state.data.b2c.warnings;
    if (warnings && warnings.length) setStatus(`Ready · ${warnings.join(" · ")}`);
    if (state.model && state.model.ready && state.serverOk) {
      const unseen = state.model.orders.filter((o) => !o.firstSeenAt).map((o) => o.key);
      if (unseen.length) {
        try { await Core.markSeen(unseen); await refreshState(); } catch { /* next load retries */ }
      }
    }
    checkNotify();
  }

  function setLive() {
    const el = $("lxc-live");
    el.classList.toggle("is-off", !state.serverOk);
    el.title = state.serverOk ? "Connected · updates on every Admin Push and every user change" : "Server not reachable · changes cannot be saved";
  }

  function setStatus(text) {
    $("lxc-status").textContent = text;
  }

  let toastTimer = null;
  function toast(text, isErr) {
    const el = $("lxc-toast");
    el.textContent = text;
    el.classList.toggle("is-err", !!isErr);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isErr ? 5000 : 2600);
  }

  // ---------- Notifications ----------

  function setupNotifyButton() {
    const btn = $("lxc-notify");
    btn.hidden = !("Notification" in window) || Notification.permission !== "default";
    btn.onclick = () => Notification.requestPermission().then(() => { setupNotifyButton(); checkNotify(); });
  }

  function checkNotify() {
    const due = state.model && state.model.ready ? state.model.summary.due : 0;
    if (due < state.notifiedDue) state.notifiedDue = due;
    if (!due || due === state.notifiedDue) return;
    state.notifiedDue = due;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const note = new Notification("Lexus Controller · follow-up needed", {
        body: `${due} order${due === 1 ? "" : "s"} without a follow-up in the last 24 hours.`,
        tag: "lexus-follow-up",
      });
      note.onclick = () => { window.focus(); state.filter = "due"; render(); };
    } catch { /* ignore */ }
  }

  // ---------- Export ----------

  function exportExcel() {
    if (!state.model || !state.model.ready || !window.XLSX) return;
    const X = window.XLSX;
    const headers = state.cols.map((c) => c.header);
    const orders = visibleOrders();
    const aoa = [headers].concat(orders.map((o) => state.cols.map((c) => cellValue(o, c))));
    const ws = X.utils.aoa_to_sheet(aoa);
    const headStyle = { font: { bold: true }, fill: { fgColor: { rgb: "E9EFE9" } }, border: { bottom: { style: "thin", color: { rgb: "9FB8A6" } } } };
    headers.forEach((_, c) => { const a = X.utils.encode_cell({ r: 0, c }); if (ws[a]) ws[a].s = headStyle; });
    orders.forEach((o, r) => {
      state.cols.forEach((col, c) => {
        const a = X.utils.encode_cell({ r: r + 1, c });
        if (!ws[a]) return;
        if (col.kind === "file" && Object.prototype.hasOwnProperty.call(o.edits, col.header)) ws[a].s = { fill: { fgColor: { rgb: "FFF7D1" } } };
        if (col.id === "followup" && o.due) ws[a].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "DC2626" } } };
      });
    });
    ws["!cols"] = headers.map((h, c) => ({ wch: Math.min(40, Math.max(10, h.length + 2, ...aoa.slice(1, 200).map((row) => String(row[c] || "").length + 1))) }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Details");
    const d = new Date();
    X.writeFile(wb, `Lexus-B2C-Controller-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`);
  }

  // ---------- Context menu ----------

  function openMenu(x, y, o, col) {
    const menu = $("lxc-menu");
    const items = [];
    const size = rangeSize(rangeBounds());
    items.push(`<button type="button" data-menu="copy">${size > 1 ? `Copy ${n(size)} cells` : "Copy cell"}<kbd>Ctrl+C</kbd></button>`);
    items.push(`<button type="button" data-menu="copy-h">Copy with headers<kbd>Ctrl+Shift+C</kbd></button>`);
    if (col.editable) items.push(`<button type="button" data-menu="edit">Edit cell</button>`);
    if (col.kind === "file" && Object.prototype.hasOwnProperty.call(o.edits, col.header)) {
      items.push(`<button type="button" data-menu="revert">Revert to file value</button><p>File value: ${esc(o.fileCells[col.idx] || "(blank)")}</p>`);
    }
    if (col.id === "note" && o.note) items.push(`<button type="button" data-menu="clear-note">Clear note</button>`);
    if (o.needsFollowUp) items.push(`<button type="button" data-menu="followup">Record follow-up now</button>`);
    menu.innerHTML = items.join("");
    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
    menu.onclick = (e) => {
      const b = e.target.closest("[data-menu]");
      if (!b) return;
      menu.hidden = true;
      const act = b.dataset.menu;
      if (act === "copy" || act === "copy-h") copyRange(act === "copy-h");
      else if (act === "edit") startEdit();
      else if (act === "revert") saveEdit(o.key, { edits: { [col.header]: null } });
      else if (act === "clear-note") saveEdit(o.key, { note: "" });
      else if (act === "followup") followUp(o.key);
    };
  }

  // ---------- Events ----------

  function bind() {
    const user = $("lxc-user");
    user.value = Core.getUser();
    user.addEventListener("change", () => {
      Core.setUser(user.value);
      user.closest(".lxc-user").classList.toggle("is-missing", !user.value.trim());
      loadColFilters();
      render();
    });

    document.addEventListener("click", (e) => {
      const menu = $("lxc-menu");
      if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
      const f = e.target.closest("[data-filter]");
      if (f) {
        state.filter = state.filter === f.dataset.filter && f.classList.contains("lxc-kpi") ? "all" : f.dataset.filter;
        render();
      }
    });

    const q = new URLSearchParams(location.search).get("q");
    if (q) { state.search = q; $("lxc-search").value = q; }
    $("lxc-search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
    $("lxc-edited").addEventListener("change", (e) => { state.editedOnly = e.target.checked; render(); });
    $("lxc-refresh").addEventListener("click", () => loadAll(true));
    $("lxc-export").addEventListener("click", exportExcel);

    $("lxc-cf-clear").addEventListener("click", clearColFilters);

    const grid = $("lxc-grid");
    const focusSheet = () => $("lxc-scroll").focus({ preventScroll: true });
    grid.addEventListener("click", (e) => {
      if (e.target.closest("[data-cf-clear]")) { clearColFilters(); return; }
      const fu = e.target.closest("[data-fu]");
      if (fu) { followUp(fu.dataset.fu); return; }
      const live = e.target.closest("[data-live]");
      if (live) { checkLive(live.dataset.live); }
    });

    // Excel-style selection: click · drag · Shift+click · column letter · row number
    grid.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button, input, a, select, textarea")) return;
      const last = state.rows.length - 1;
      const letter = e.target.closest("tr.lxc-letters th[data-col]");
      if (letter && last >= 0) {
        e.preventDefault();
        if (state.editing) commitEdit(0, 0);
        const c = Number(letter.dataset.col);
        const ac = e.shiftKey && state.anchor ? state.anchor.c : c;
        selectBlock(0, c, last, ac);
        focusSheet();
        return;
      }
      const rn = e.target.closest("td.lxc-rn[data-rn]");
      if (rn) {
        e.preventDefault();
        if (state.editing) commitEdit(0, 0);
        const r = Number(rn.dataset.rn);
        const aIdx = e.shiftKey && state.anchor ? state.rows.findIndex((o) => o.key === state.anchor.key) : -1;
        selectBlock(r, 0, aIdx >= 0 ? aIdx : r, state.cols.length - 1);
        focusSheet();
        return;
      }
      const td = e.target.closest("td[data-r]");
      if (!td || td.classList.contains("is-editing")) return;
      const o = state.rows[Number(td.dataset.r)];
      if (!o) return;
      e.preventDefault();
      if (state.editing) commitEdit(0, 0);
      const cell = { key: o.key, c: Number(td.dataset.c) };
      if (e.shiftKey) {
        if (!state.anchor) state.anchor = { ...state.sel };
        state.sel = cell;
      } else {
        state.sel = cell;
        state.anchor = { ...cell };
        state.dragging = true;
      }
      applySelection(false);
      focusSheet();
    });
    grid.addEventListener("mouseover", (e) => {
      if (!state.dragging) return;
      const td = e.target.closest("td[data-r]");
      if (!td) return;
      const o = state.rows[Number(td.dataset.r)];
      const c = Number(td.dataset.c);
      if (!o || (o.key === state.sel.key && c === state.sel.c)) return;
      state.sel = { key: o.key, c };
      applySelection(false);
    });
    document.addEventListener("mouseup", () => { state.dragging = false; });

    let cfTimer = null;
    grid.addEventListener("input", (e) => {
      const input = e.target.closest("input.lxc-cf");
      if (!input) return;
      state.colFilters[input.dataset.cf] = input.value;
      clearTimeout(cfTimer);
      cfTimer = setTimeout(() => { saveColFilters(); render(); }, 160);
    });
    grid.addEventListener("focusin", (e) => {
      const input = e.target.closest("input.lxc-cf");
      if (input) fillFilterList(input.dataset.cf);
    });
    grid.addEventListener("keydown", (e) => {
      const input = e.target.closest("input.lxc-cf");
      if (!input) return;
      if (e.key === "Enter" || (e.key === "Escape" && !input.value)) { e.preventDefault(); focusSheet(); }
    });
    grid.addEventListener("dblclick", (e) => {
      const td = e.target.closest("td[data-r]");
      if (!td || e.target.closest("button") || td.classList.contains("is-editing")) return;
      startEdit();
    });
    grid.addEventListener("contextmenu", (e) => {
      const td = e.target.closest("td[data-r]");
      if (!td) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      const o = state.rows[r];
      if (!o) return;
      e.preventDefault();
      if (!inRange(r, c)) state.anchor = null;
      state.sel = { key: o.key, c };
      applySelection(false);
      openMenu(e.clientX, e.clientY, o, state.cols[state.sel.c]);
    });

    $("lxc-scroll").addEventListener("keydown", (e) => {
      if (state.editing || e.target !== $("lxc-scroll")) return;
      const k = e.key;
      const ext = e.shiftKey;
      if (k === "ArrowDown") { e.preventDefault(); moveSel(1, 0, ext); }
      else if (k === "ArrowUp") { e.preventDefault(); moveSel(-1, 0, ext); }
      else if (k === "ArrowRight") { e.preventDefault(); moveSel(0, 1, ext); }
      else if (k === "ArrowLeft") { e.preventDefault(); moveSel(0, -1, ext); }
      else if (k === "Tab") { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1, false); }
      else if (k === "PageDown") { e.preventDefault(); moveSel(20, 0, ext); }
      else if (k === "PageUp") { e.preventDefault(); moveSel(-20, 0, ext); }
      else if (k === "Escape" && state.anchor) { e.preventDefault(); state.anchor = null; applySelection(false); }
      else if ((e.ctrlKey || e.metaKey) && (k === "a" || k === "A")) { e.preventDefault(); selectBlock(0, 0, state.rows.length - 1, state.cols.length - 1); }
      else if (k === "Enter" || k === "F2") { e.preventDefault(); startEdit(); }
      else if (k === "Delete" || k === "Backspace") {
        const col = state.cols[state.sel.c];
        const r = selRowIndex();
        if (r >= 0 && col && col.editable) {
          e.preventDefault();
          const o = state.rows[r];
          if (col.kind === "file") saveEdit(o.key, { edits: { [col.header]: o.fileCells[col.idx] === "" ? null : "" } });
          else saveEdit(o.key, { note: "" });
        }
      } else if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "C")) {
        e.preventDefault();
        copyRange(e.shiftKey);
      } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const col = state.cols[state.sel.c];
        if (col && col.editable) { e.preventDefault(); startEdit(k); }
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("lxc-menu").hidden = true; });

    const fuNote = $("lxc-fu-note");
    fuNote.addEventListener("input", syncFollowUpDialog);
    fuNote.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitFollowUp(); }
    });
    $("lxc-fu-form").addEventListener("submit", (e) => { e.preventDefault(); submitFollowUp(); });
    $("lxc-fu-cancel").addEventListener("click", closeFollowUpDialog);
    $("lxc-fu-dialog").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeFollowUpDialog(); } });
    $("lxc-fu-dialog").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) closeFollowUpDialog(); });
  }

  // ---------- Start ----------

  loadColFilters();
  bind();
  setupNotifyButton();
  render();
  loadAll(false).then(() => {
    Store.startLiveSync(() => loadAll(true), { initialAt: state.data ? state.data.at : 0 });
  });
  Core.startStateSync(() => { if (!state.loading) refreshState(); }, 30000);
  setInterval(() => {
    if (!state.data) return;
    rebuild();
    render();
    checkNotify();
  }, 60000);
})();
