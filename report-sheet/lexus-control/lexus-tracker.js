/**
 * Live report · Lexus Tracker · one-screen Lexus order cockpit (presentation only — rules live in lexus-core.js).
 * Fixed 100vh overlay like the GEC Control Center; detail opens in modals (the only scrolling surface).
 * Usage: LexusTracker.mount(hostEl) once, then LexusTracker.show({ onExit }) whenever the panel opens.
 */
(function (global) {
  const Core = () => global.LexusCore;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtN = new Intl.NumberFormat("en-US");
  const n = (v) => fmtN.format(Math.round(Number(v) || 0));
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
  const w100 = (a, b) => `${b ? Math.min(100, (a / b) * 100).toFixed(1) : 0}%`;
  const reduceMotion = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const SVGNS = "http://www.w3.org/2000/svg";
  const RING_C = 2 * Math.PI * 42;
  const CONTROLLER_URL = "lexus-control/lexus-controller.html";

  const CAT_TONE = { delivered: "s-delivered", cancelled: "s-cancelled", progress: "s-progress" };
  const CAT_ORDER = ["delivered", "cancelled", "progress"];
  const TRACK_ORDER = ["queue", "proforma", "delivered", "salesNoDate", "notFound", "noData"];
  const TRACK_TONE = { queue: "s-queue", proforma: "s-proforma", delivered: "s-delivered", salesNoDate: "s-sales", notFound: "s-none", noData: "s-none" };
  const TRACK_RULE = {
    queue: "Order number found in the Back Order file · position by bo-order-lookup rules",
    proforma: "Not in Back Order · Sales Raw Col P filled and Col V blank",
    delivered: "Not in Back Order · Sales Raw Col V has a date",
    salesNoDate: "Not in Back Order · in Sales Raw but Col P and Col V are blank",
    notFound: "In neither the Back Order file nor Sales Raw",
    noData: "Push Back Order / Sales Raw Data to track these orders",
  };
  const EMPTY_FILTERS = { from: "", to: "", model: "", status: "", person: "", city: "", category: "" };
  const LIST_TABS = [
    { id: "all", label: "All", fn: () => true },
    { id: "progress", label: "In progress", fn: (o) => o.category === "progress" },
    { id: "due", label: "Follow-up due", fn: (o) => o.due },
    { id: "delivered", label: "Delivered", fn: (o) => o.category === "delivered" },
    { id: "cancelled", label: "Cancelled", fn: (o) => o.category === "cancelled" },
  ];
  const GROUP_META = {
    model: { title: "By Model", empty: "No model / vehicle column in the Details sheet", hint: "Add a Model column to the Details sheet to group orders by car." },
    person: { title: "By Consultant", empty: "No consultant / sales person assigned", hint: "Orders will group here once the Details sheet has a sales consultant column." },
    city: { title: "By Delivery City", empty: "No delivery city column in the Details sheet", hint: "" },
    status: { title: "Details Status", empty: "No statuses", hint: "" },
  };

  const state = {
    host: null,
    root: null,
    ctx: {},
    data: null,
    tracker: { orders: {} },
    model: null,
    cols: {},
    options: null,
    dayKeys: new Map(),
    filters: { ...EMPTY_FILTERS },
    view: null,
    started: false,
    loading: false,
    serverOk: false,
    prevNum: new Map(),
    prevW: new Map(),
    modal: { stack: [] },
    resizeTimer: null,
    live: { busy: new Set(), error: "", errorAt: 0 },
  };

  // ---------- Icons (inline SVG, stroke = currentColor) ----------

  const ICON = {
    car: '<path d="M5 17H3v-4.5a2 2 0 0 1 .6-1.4L6 9l1.6-3.2A2 2 0 0 1 9.4 5h5.2a2 2 0 0 1 1.8 1.1L18 9l2.4 2.1a2 2 0 0 1 .6 1.4V17h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  const icon = (name, cls) => `<svg class="lxt-ic${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;
  const LOGO = '<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="24" cy="16" rx="22" ry="14"/><path d="M21.5 5.5 15 24.5h19.5l3.5-6"/></svg>';
  /** Line-art vehicle for the hero backdrop · inline SVG (no network request), applied after first paint. */
  const HERO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 200' fill='none' stroke='#c8a96b' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'><path d='M40 142 36 118Q36 100 58 96L118 88Q156 52 220 44L378 40Q432 42 474 66L524 94Q588 102 610 118Q618 128 612 142L554 142A42 42 0 0 0 470 142L202 142A42 42 0 0 0 118 142Z' opacity='.55'/><path d='M150 88Q180 58 222 52L372 48Q410 50 440 70L462 86Z' opacity='.35'/><path d='M300 50 298 88M560 104 596 112' opacity='.35'/><circle cx='160' cy='142' r='36' opacity='.5'/><circle cx='160' cy='142' r='20' opacity='.28'/><circle cx='512' cy='142' r='36' opacity='.5'/><circle cx='512' cy='142' r='20' opacity='.28'/><path d='M8 184H632' opacity='.16'/></svg>`;

  // ---------- Skeleton ----------

  function build() {
    state.host.innerHTML = `
      <div class="lxt" role="application" aria-label="Lexus Tracker">
        <header class="lxt-header">
          <div class="lxt-brand">
            <span class="lxt-mark">${LOGO}</span>
            <div class="lxt-brand-text"><strong>LEXUS TRACKER</strong><span>B2C ORDERS · FOLLOW-UP</span></div>
          </div>
          <div class="lxt-filters">
            <div class="lxt-f lxt-f-date" data-fwrap="date"><span>Date</span>
              <div><input type="date" data-f="from" aria-label="From date" /><em>→</em><input type="date" data-f="to" aria-label="To date" /></div>
            </div>
            <label class="lxt-f"><span>Model</span><select data-f="model" dir="auto"></select></label>
            <label class="lxt-f"><span>Status</span><select data-f="status" dir="auto"></select></label>
            <label class="lxt-f"><span>Consultant</span><select data-f="person" dir="auto"></select></label>
            <label class="lxt-f"><span>Delivery City</span><select data-f="city" dir="auto"></select></label>
            <label class="lxt-f"><span>Category</span><select data-f="category"></select></label>
            <button type="button" class="lxt-btn is-ghost" data-act="reset" data-el="reset" hidden>Reset</button>
          </div>
          <div class="lxt-actions">
            <span class="lxt-live is-off" data-el="live"><i></i>LIVE</span>
            <span class="lxt-updated"><small>Last push</small><b data-el="updated">—</b></span>
            <a class="lxt-btn" href="${CONTROLLER_URL}" target="_blank" rel="noopener">${icon("external")}<span>Open Lexus Controller</span></a>
            <button type="button" class="lxt-btn is-gold" data-act="refresh" title="Reload the latest Admin Push">${icon("refresh")}<span>Refresh</span></button>
            <button type="button" class="lxt-icon-btn" data-act="fullscreen" title="Fullscreen" aria-label="Fullscreen">${icon("expand")}</button>
            <button type="button" class="lxt-icon-btn is-exit" data-act="exit" data-el="exit" title="Back to report" aria-label="Back to report" hidden>${icon("close")}</button>
          </div>
        </header>

        <section class="lxt-kpis" data-el="kpis"></section>

        <section class="lxt-row1">
          <article class="lxt-card lxt-status">
            <div class="lxt-card-head"><h2>${icon("pie")}Order Status <small>Details sheet</small></h2></div>
            <div class="lxt-donut-wrap" data-el="donut"></div>
          </article>
          <div class="lxt-hero" data-el="hero">
            <article class="lxt-card is-glass lxt-trackcard">
              <div class="lxt-card-head"><h2>${icon("route")}In-Progress Tracking <small>Back Order → Sales Raw</small></h2><span class="lxt-head-note" data-el="track-note"></span></div>
              <div class="lxt-flow" data-el="track"></div>
            </article>
            <article class="lxt-card is-glass lxt-follow">
              <div class="lxt-card-head"><h2>${icon("bell")}Follow-up · 24 h <small>in-progress orders</small></h2></div>
              <div class="lxt-follow-body" data-el="follow"></div>
            </article>
          </div>
        </section>

        <section class="lxt-row2">
          <article class="lxt-card">
            <div class="lxt-card-head"><h2>${icon("list")}Details Status</h2><button type="button" class="lxt-link" data-act="groups" data-group="status" data-el="status-all" hidden>All ↗</button></div>
            <div class="lxt-bars" data-el="statuses"></div>
          </article>
          <article class="lxt-card">
            <div class="lxt-card-head"><h2>${icon("car")}<span data-el="model-title">By Model</span></h2><button type="button" class="lxt-link" data-act="groups" data-group="model" data-el="model-all" hidden>All ↗</button></div>
            <div class="lxt-bars" data-el="models"></div>
          </article>
          <article class="lxt-card">
            <div class="lxt-card-head"><h2>${icon("users")}<span data-el="person-title">By Consultant</span></h2><button type="button" class="lxt-link" data-act="groups" data-group="person" data-el="person-all" hidden>All ↗</button></div>
            <div class="lxt-people" data-el="people"></div>
          </article>
        </section>

        <section class="lxt-card lxt-orders">
          <div class="lxt-card-head">
            <h2>${icon("db")}All Orders <small data-el="orders-sub"></small></h2>
            <button type="button" class="lxt-link is-strong" data-act="view-all">View All ${icon("arrow")}</button>
          </div>
          <div class="lxt-table-wrap" data-el="preview-wrap"><table class="lxt-table" data-el="preview"></table></div>
        </section>

        <div class="lxt-empty" data-el="empty" hidden></div>

        <div class="lxt-modal" data-el="modal" hidden>
          <div class="lxt-modal-card" role="dialog" aria-modal="true" aria-labelledby="lxt-m-title">
            <div class="lxt-modal-head">
              <button type="button" class="lxt-icon-btn" data-act="m-back" data-el="m-back" title="Back" aria-label="Back" hidden>${icon("back")}</button>
              <div class="lxt-modal-titles"><h3 id="lxt-m-title" data-el="m-title"></h3><p data-el="m-sub"></p></div>
              <div class="lxt-modal-tools">
                <input type="search" data-el="m-search" placeholder="Search orders…" aria-label="Search orders" />
                <a class="lxt-btn" data-el="m-link" target="_blank" rel="noopener" hidden>${icon("external")}<span>Open in Controller</span></a>
                <button type="button" class="lxt-icon-btn" data-act="m-close" title="Close" aria-label="Close">${icon("close")}</button>
              </div>
            </div>
            <div class="lxt-modal-tabs" data-el="m-tabs"></div>
            <div class="lxt-modal-body" data-el="m-body"></div>
            <div class="lxt-modal-foot" data-el="m-foot"></div>
          </div>
        </div>
      </div>`;
    state.root = state.host.querySelector(".lxt");
    bind();
  }

  const el = (name) => state.root.querySelector(`[data-el="${name}"]`);

  function bind() {
    const root = state.root;
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      const drill = e.target.closest("[data-drill]");
      const fset = e.target.closest("[data-fset]");
      if (act && (!drill || drill.contains(act)) && (!fset || fset.contains(act))) { onAction(act); return; }
      if (drill && (!fset || fset.contains(drill))) { openList(drill.dataset.drill, drill.dataset.label || ""); return; }
      if (fset) { toggleFilter(fset.dataset.fset, fset.dataset.value); if (fset.closest(".lxt-modal")) closeModal(); return; }
      const row = e.target.closest("[data-key]");
      if (row) { openOrder(row.dataset.key); return; }
      if (e.target === el("modal")) closeModal();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el("modal").hidden) { e.stopPropagation(); closeModal(); return; }
      if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("tr[data-key], tr[data-fset]")) {
        e.preventDefault();
        e.target.click();
      }
    });
    root.addEventListener("change", (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (f) setFilter(f, e.target.value || "");
    });
    el("m-search").addEventListener("input", (e) => {
      const top = modalTop();
      if (top) { top.search = e.target.value; renderModal(); }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.root && state.root.getClientRects().length && !el("modal").hidden) closeModal();
    });
    document.addEventListener("fullscreenchange", () => {
      const btn = root.querySelector('[data-act="fullscreen"]');
      if (btn) btn.title = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    });
    if ("ResizeObserver" in global) {
      new ResizeObserver(() => {
        clearTimeout(state.resizeTimer);
        state.resizeTimer = setTimeout(() => {
          if (state.model && state.model.ready && state.root.getClientRects().length) renderPreview(filteredView());
        }, 90);
      }).observe(root);
    }
  }

  function onAction(node) {
    const a = node.dataset.act;
    if (a === "refresh") load(true);
    else if (a === "fullscreen") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (a === "exit") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (typeof state.ctx.onExit === "function") state.ctx.onExit();
    } else if (a === "reset") {
      state.filters = { ...EMPTY_FILTERS };
      render();
    } else if (a === "view-all") openList("all", "All orders");
    else if (a === "groups") openGroups(node.dataset.group);
    else if (a === "open") openOrder(node.dataset.key);
    else if (a === "live") checkLive(node.dataset.key);
    else if (a === "m-close") closeModal();
    else if (a === "m-back") { state.modal.stack.pop(); renderModal(); }
    else if (a === "m-tab") { const top = modalTop(); if (top) { top.tab = node.dataset.tab; renderModal(); } }
  }

  // ---------- Columns worth showing ----------

  function detectCols(headers, b2c) {
    const norms = headers.map((h) => String(h).toLowerCase());
    const find = (re, not) => norms.findIndex((h, i) => i !== b2c.orderCol && i !== b2c.statusCol && re.test(h) && !(not && not.test(h)));
    const deliveryCity = find(/delivery\s*city/);
    const city = deliveryCity >= 0 ? deliveryCity : find(/city/);
    return {
      customer: find(/customer|client|buyer|company|account/, /id$|number|no\b|phone|mobile|email/),
      model: find(/model|vehicle|car\b|product|variant|grade|katashiki/, /year|code|date/),
      person: find(/sales\s*(man|person|consultant|advisor|executive|rep)|consultant|advisor|owner|assigned|employee|agent|salesman/),
      date: find(/order\s*date|created|date/),
      city: city >= 0 ? city : find(/branch|showroom|location|region/),
      vin: Core().vinColumn(headers),
    };
  }

  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const ymd = (y, m, d) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "");

  /** Date cell text ("dd Mon yyyy" from the reader, or typed by users) → "yyyy-mm-dd". */
  function dayKey(text) {
    const s = String(text || "").trim();
    if (!s) return "";
    let m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})/);
    if (m && MON[m[2].toLowerCase()]) return ymd(+m[3], MON[m[2].toLowerCase()], +m[1]);
    m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let d = +m[1];
      let mo = +m[2];
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
      return ymd(+m[3] < 100 ? +m[3] + 2000 : +m[3], mo, d);
    }
    const t = Date.parse(s);
    if (isNaN(t)) return "";
    const d = new Date(t);
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const cellOf = (o, idx) => (idx != null && idx >= 0 ? o.cells[idx] || "(blank)" : "");
  const statusOf = (o) => o.statusText || "(blank)";

  // ---------- Load ----------

  async function load(force) {
    if (state.loading || !Core()) return;
    state.loading = true;
    try {
      state.data = await Core().loadPushedData({ force: !!force });
    } catch (err) {
      state.data = { error: err.message || String(err) };
    }
    try {
      state.tracker = await Core().fetchState();
      state.serverOk = true;
    } catch {
      state.serverOk = false;
    }
    state.loading = false;
    rebuild();
    render();
  }

  async function refreshState() {
    try {
      state.tracker = await Core().fetchState();
      state.serverOk = true;
    } catch {
      state.serverOk = false;
    }
    rebuild();
    render();
  }

  /** Model from lexus-core (unchanged business rules) · filter options and date keys are derived once per model. */
  function rebuild() {
    const d = state.data;
    const prevB2c = state.model && state.model.b2c;
    state.model = d && d.b2c && d.b2c.ok
      ? Core().buildModel({ b2c: d.b2c, bo: d.bo, sales: d.sales, state: state.tracker, now: Date.now() })
      : null;
    state.view = null;
    if (!state.model) { state.cols = {}; state.options = null; return; }
    if (d.b2c !== prevB2c || !state.options) state.cols = detectCols(state.model.headers, d.b2c);
    const c = state.cols;
    const orders = state.model.orders;
    const uniq = (fn) => [...new Set(orders.map(fn))].filter((v) => v !== "").sort((a, b) => a.localeCompare(b));
    state.dayKeys = new Map();
    let min = "";
    let max = "";
    if (c.date >= 0) {
      orders.forEach((o) => {
        const k = dayKey(o.cells[c.date]);
        state.dayKeys.set(o.key, k);
        if (k && (!min || k < min)) min = k;
        if (k && (!max || k > max)) max = k;
      });
    }
    state.options = {
      model: c.model >= 0 ? uniq((o) => cellOf(o, c.model)) : [],
      status: uniq(statusOf),
      person: c.person >= 0 ? uniq((o) => cellOf(o, c.person)) : [],
      city: c.city >= 0 ? uniq((o) => cellOf(o, c.city)) : [],
      category: ["progress", "delivered", "cancelled"],
      min,
      max,
    };
    ["model", "status", "person", "city"].forEach((k) => {
      if (state.filters[k] && !state.options[k].includes(state.filters[k])) state.filters[k] = "";
    });
  }

  /** Filtered orders + their summary (same Core.summarize as the unfiltered totals) · memoized per model × filters. */
  function filteredView() {
    const f = state.filters;
    const sig = JSON.stringify(f);
    if (state.view && state.view.model === state.model && state.view.sig === sig) return state.view;
    const c = state.cols;
    const active = Object.values(f).some(Boolean);
    const orders = !active ? state.model.orders : state.model.orders.filter((o) => {
      if (f.model && cellOf(o, c.model) !== f.model) return false;
      if (f.status && statusOf(o) !== f.status) return false;
      if (f.person && cellOf(o, c.person) !== f.person) return false;
      if (f.city && cellOf(o, c.city) !== f.city) return false;
      if (f.category && o.category !== f.category) return false;
      if ((f.from || f.to) && c.date >= 0) {
        const k = state.dayKeys.get(o.key);
        if (!k || (f.from && k < f.from) || (f.to && k > f.to)) return false;
      }
      return true;
    });
    state.view = { model: state.model, sig, active, orders, summary: active ? Core().summarize(orders) : state.model.summary };
    return state.view;
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    if (state.filters.from && state.filters.to && state.filters.from > state.filters.to) {
      [state.filters.from, state.filters.to] = [state.filters.to, state.filters.from];
    }
    render();
  }

  function toggleFilter(key, value) {
    setFilter(key, state.filters[key] === value ? "" : value);
  }

  // ---------- Render ----------

  function render() {
    if (!state.root) return;
    const d = state.data;
    el("live").classList.toggle("is-off", !state.serverOk);
    el("updated").textContent = d && d.at ? Core().fmtAt(d.at) : "—";
    const empty = el("empty");
    if (!state.model || !state.model.ready) {
      empty.hidden = false;
      const err = d && (d.error || (d.b2c && d.b2c.error));
      empty.innerHTML = `<div class="lxt-empty-card"><span class="lxt-mark is-lg">${LOGO}</span><strong>${err ? "Could not read the Lexus B2C file" : "No Lexus B2C file pushed yet"}</strong>
        <p>${err ? esc(err) : "In <b>Admin Push → Excel Uploads</b>, add the <b>Lexus B2C</b> workbook (slot 9 · sheet <b>Details</b> with <b>Order No</b> and <b>Status</b>), then click <b>Push to live</b>."}</p></div>`;
      ["kpis", "donut", "track", "follow", "statuses", "models", "people", "preview"].forEach((k) => { el(k).innerHTML = ""; });
      return;
    }
    empty.hidden = true;
    const v = filteredView();
    renderFilters();
    renderKpis(v);
    renderDonut(v);
    renderTrack(v);
    renderFollow(v);
    renderStatuses(v);
    renderModels(v);
    renderPeople(v);
    renderPreview(v);
    tweenNumbers(state.root);
    animateBars(state.root);
    if (!el("modal").hidden) renderModal();
  }

  function renderFilters() {
    const o = state.options;
    const f = state.filters;
    const CAT_LABEL = Core().CATEGORY_LABEL;
    const setSel = (key, list, allLabel, labelOf) => {
      const sel = state.root.querySelector(`select[data-f="${key}"]`);
      const sig = list.join("\u0001");
      if (sel.dataset.sig !== sig) {
        sel.innerHTML = `<option value="">${esc(allLabel)}</option>${list.map((v) => `<option value="${esc(v)}">${esc(labelOf ? labelOf(v) : v)}</option>`).join("")}`;
        sel.dataset.sig = sig;
      }
      sel.disabled = !list.length;
      sel.value = f[key];
      sel.closest(".lxt-f").classList.toggle("is-active", !!f[key]);
      sel.closest(".lxt-f").classList.toggle("is-na", !list.length);
    };
    setSel("model", o.model, o.model.length ? "All models" : "No column");
    setSel("status", o.status, "All statuses");
    setSel("person", o.person, o.person.length ? "All consultants" : "Not assigned");
    setSel("city", o.city, o.city.length ? "All cities" : "No column");
    setSel("category", o.category, "All categories", (v) => CAT_LABEL[v]);
    const hasDate = state.cols.date >= 0;
    ["from", "to"].forEach((k) => {
      const inp = state.root.querySelector(`input[data-f="${k}"]`);
      inp.disabled = !hasDate;
      inp.min = o.min || "";
      inp.max = o.max || "";
      inp.value = f[k];
    });
    const dateWrap = state.root.querySelector('[data-fwrap="date"]');
    dateWrap.classList.toggle("is-active", !!(f.from || f.to));
    dateWrap.classList.toggle("is-na", !hasDate);
    dateWrap.title = hasDate ? `Filters by “${state.model.headers[state.cols.date]}”` : "No date column in the Details sheet";
    el("reset").hidden = !Object.values(f).some(Boolean);
  }

  function renderKpis(v) {
    const s = v.summary;
    const t = s.track;
    const all = state.model.summary.total;
    const k = (key, label, value, sub, tone, drill, of, alert) => `
      <button type="button" class="lxt-kpi ${tone}${alert ? " is-alert" : ""}" data-drill="${drill}" data-label="${esc(label)}">
        <span class="lxt-kpi-lab">${esc(label)}</span>
        <span class="lxt-kpi-val lxt-num" data-num="kpi-${key}" data-to="${value}">${n(value)}</span>
        <span class="lxt-kpi-sub">${sub}</span>
        <span class="lxt-kpi-line"><i data-wk="kpi-${key}" data-w="${w100(value, of)}"></i></span>
      </button>`;
    el("kpis").innerHTML = [
      k("total", "Total Orders", s.total, v.active ? `of <b>${n(all)}</b> · filtered` : `<b>${n(s.edited)}</b> edited by users`, "s-neutral", "all", all),
      k("delivered", "Delivered", s.delivered, `<b>${pct(s.delivered, s.total)}</b> of orders`, "s-delivered", "cat:delivered", s.total),
      k("cancelled", "Cancelled", s.cancelled, `<b>${pct(s.cancelled, s.total)}</b> of orders`, "s-cancelled", "cat:cancelled", s.total),
      k("progress", "In Progress", s.progress, `<b>${pct(s.progress, s.total)}</b> of orders`, "s-progress", "cat:progress", s.total),
      k("due", "Follow-up Due", s.due, s.due ? `<b>${pct(s.due, s.progress)}</b> of in progress` : "all followed up", "s-due", "due", s.progress, s.due > 0),
      k("queue", "In BO Queue", t.queue, state.model.hasBo ? "in progress · Back Order" : "Back Order not pushed", "s-queue", "track:queue", s.progress),
      k("proforma", "Pro-Forma", t.proforma, state.model.hasSales ? "Sales Raw · Col P, V blank" : "Sales Raw not pushed", "s-proforma", "track:proforma", s.progress),
    ].join("");
  }

  function ringSvg() {
    return `<svg class="lxt-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="lxt-ring-bg" cx="50" cy="50" r="42"/></svg>`;
  }

  /** Thin SVG ring whose segments glide to their new size (persistent circles, CSS transitions). */
  function setRing(svg, parts) {
    const total = parts.reduce((a, p) => a + p.value, 0);
    const shown = parts.filter((p) => p.value > 0).length;
    let acc = 0;
    parts.forEach((p) => {
      let c = svg.querySelector(`[data-seg="${p.key}"]`);
      if (!c) {
        c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("cx", "50");
        c.setAttribute("cy", "50");
        c.setAttribute("r", "42");
        c.setAttribute("class", `lxt-ring-seg ${p.tone || ""}`);
        c.dataset.seg = p.key;
        c.style.strokeDasharray = `0 ${RING_C}`;
        c.style.strokeDashoffset = "0";
        svg.appendChild(c);
        c.getBoundingClientRect();
      }
      const len = total ? (p.value / total) * RING_C : 0;
      const gap = shown > 1 && len > 3 ? 1.8 : 0;
      c.style.strokeDasharray = `${Math.max(0, len - gap)} ${RING_C}`;
      c.style.strokeDashoffset = String(-acc);
      acc += len;
    });
  }

  function renderDonut(v) {
    const s = v.summary;
    const box = el("donut");
    if (!box.querySelector(".lxt-ring")) {
      box.innerHTML = `<div class="lxt-donut">${ringSvg()}<div class="lxt-ring-c"><b class="lxt-num" data-el="donut-total"></b><small>orders</small></div></div><div class="lxt-legend" data-el="donut-legend"></div>`;
    }
    const center = el("donut-total");
    center.dataset.num = "donut";
    center.dataset.to = s.total;
    center.textContent = n(s.total);
    setRing(box.querySelector(".lxt-ring"), CAT_ORDER.map((key) => ({ key, value: s[key], tone: CAT_TONE[key] })));
    el("donut-legend").innerHTML = CAT_ORDER.map((key) => `
      <button type="button" class="lxt-leg ${CAT_TONE[key]}" data-drill="cat:${key}" data-label="${esc(Core().CATEGORY_LABEL[key])} orders">
        <i></i><span>${esc(Core().CATEGORY_LABEL[key])}</span><b class="lxt-num">${n(s[key])}</b><em class="lxt-num">${pct(s[key], s.total)}</em>
      </button>`).join("");
  }

  function renderTrack(v) {
    const s = v.summary;
    const kinds = TRACK_ORDER.filter((k) => s.track[k] || (k !== "noData" && (k !== "notFound" || state.model.hasBo || state.model.hasSales)));
    el("track-note").innerHTML = `<b class="lxt-num">${n(s.progress)}</b> in progress`;
    if (!s.progress) {
      el("track").innerHTML = `<div class="lxt-calm">${icon("check")}<b>No orders in progress</b><span>Every order in view is delivered or cancelled.</span></div>`;
      return;
    }
    const stack = kinds.filter((k) => s.track[k]).map((k) => `<i class="${TRACK_TONE[k]}" style="flex:${s.track[k]}" title="${esc(Core().TRACK_LABEL[k])}: ${n(s.track[k])}"></i>`).join("");
    el("track").innerHTML = `<div class="lxt-flow-stack">${stack}</div>${kinds.map((k) => {
      const val = s.track[k] || 0;
      return `<button type="button" class="lxt-flow-row ${TRACK_TONE[k]}${val ? "" : " is-zero"}" data-drill="track:${k}" data-label="${esc(Core().TRACK_LABEL[k])}" title="${esc(TRACK_RULE[k])}">
        <span class="lxt-flow-lab"><i></i>${esc(Core().TRACK_LABEL[k])}</span>
        <b class="lxt-num">${n(val)}</b><em class="lxt-num">${pct(val, s.progress)}</em>
        <span class="lxt-track"><i data-wk="trk-${k}" data-w="${w100(val, s.progress)}"></i></span>
      </button>`;
    }).join("")}`;
  }

  function renderFollow(v) {
    const s = v.summary;
    const box = el("follow");
    if (!box.querySelector(".lxt-ring")) {
      box.innerHTML = `<div class="lxt-follow-top">
          <div class="lxt-gauge">${ringSvg()}<div class="lxt-ring-c"><b class="lxt-num" data-el="fu-pct"></b><small>on time</small></div></div>
          <div class="lxt-fstats" data-el="fu-stats"></div>
        </div>
        <div class="lxt-over-wrap" data-el="fu-over"></div>`;
    }
    const compliance = s.progress ? s.onTime / s.progress : 1;
    el("fu-pct").textContent = s.progress ? `${(compliance * 100).toFixed(0)}%` : "—";
    el("fu-pct").parentElement.parentElement.classList.toggle("is-warn", s.due > 0);
    setRing(box.querySelector(".lxt-ring"), [
      { key: "ontime", value: s.onTime, tone: "s-delivered" },
      { key: "due", value: s.due, tone: "s-due" },
    ]);
    const stat = (label, value, tone, drill, drillLabel) => `<button type="button" class="lxt-fstat ${tone}" data-drill="${drill}" data-label="${esc(drillLabel)}"><small>${esc(label)}</small><b class="lxt-num" data-num="fu-${drill}" data-to="${value}">${n(value)}</b></button>`;
    el("fu-stats").innerHTML = [
      stat("On time", s.onTime, s.onTime ? "is-ok" : "", "ontime", "Followed up within 24 h"),
      stat("Due now", s.due, s.due ? "is-due" : "", "due", "Follow-up due"),
      stat("Never followed up", s.neverFollowed, "", "never", "Never followed up"),
      stat("Follow-ups logged", s.followUps, "", "logged", "Orders with follow-ups logged"),
    ].join("");
    const overdue = v.orders.filter((o) => o.due).sort((a, b) => b.sinceMs - a.sinceMs);
    const custIdx = state.cols.customer;
    el("fu-over").innerHTML = overdue.length
      ? `<button type="button" class="lxt-over is-hot" data-drill="due" data-label="Overdue follow-ups"><span><i></i>Overdue follow-ups</span><b class="lxt-num">${n(overdue.length)}</b></button>
         <div class="lxt-od-list">${overdue.slice(0, 3).map((o) => `<button type="button" class="lxt-od" data-act="open" data-key="${esc(o.key)}"><b class="lxt-num">${esc(o.orderNo)}</b><span dir="auto">${esc(custIdx >= 0 ? o.cells[custIdx] : o.statusText)}</span><em>${esc(Core().hoursText(o.sinceMs))}</em></button>`).join("")}</div>`
      : `<div class="lxt-over is-calm">${icon("check")}<span>No overdue follow-ups</span></div>`;
  }

  function groupsOf(orders, nameOf) {
    const groups = new Map();
    orders.forEach((o) => {
      const name = nameOf(o);
      const g = groups.get(name) || { name, total: 0, delivered: 0, cancelled: 0, progress: 0, due: 0 };
      g.total += 1;
      g[o.category] += 1;
      if (o.due) g.due += 1;
      groups.set(name, g);
    });
    return [...groups.values()];
  }

  function calm(title, hint, ic) {
    return `<div class="lxt-calm">${icon(ic || "users")}<b>${esc(title)}</b>${hint ? `<span>${esc(hint)}</span>` : ""}</div>`;
  }

  function renderStatuses(v) {
    const s = v.summary;
    const list = s.statuses;
    const max = list.reduce((m, x) => Math.max(m, x.count), 0);
    const cap = 6;
    el("status-all").hidden = list.length <= cap;
    el("statuses").innerHTML = list.length ? list.slice(0, cap).map((x) => `
      <button type="button" class="lxt-bar ${CAT_TONE[x.category]}${state.filters.status === x.label ? " is-on" : ""}${state.filters.status && state.filters.status !== x.label ? " is-dim" : ""}" data-fset="status" data-value="${esc(x.label)}" title="${esc(`${x.label} → ${Core().CATEGORY_LABEL[x.category]} · click to filter`)}">
        <span class="lxt-bar-lab" dir="auto"><i></i>${esc(x.label)}</span>
        <b class="lxt-num">${n(x.count)}</b><em class="lxt-num">${pct(x.count, s.total)}</em>
        <span class="lxt-track"><i data-wk="st-${esc(x.label)}" data-w="${w100(x.count, max)}"></i></span>
      </button>`).join("") : calm("No statuses", "", "list");
  }

  function renderModels(v) {
    const idx = state.cols.model;
    const box = el("models");
    el("model-title").textContent = idx >= 0 ? `By ${state.model.headers[idx]}` : "By Model";
    if (idx == null || idx < 0) { el("model-all").hidden = true; box.innerHTML = calm(GROUP_META.model.empty, GROUP_META.model.hint, "car"); return; }
    const list = groupsOf(v.orders, (o) => cellOf(o, idx)).sort((a, b) => b.total - a.total);
    const cap = 6;
    el("model-all").hidden = list.length <= cap;
    const max = list.reduce((m, g) => Math.max(m, g.total), 0);
    const f = state.filters.model;
    box.innerHTML = list.length ? list.slice(0, cap).map((g) => `
      <button type="button" class="lxt-bar lxt-split${f === g.name ? " is-on" : ""}${f && f !== g.name ? " is-dim" : ""}" data-fset="model" data-value="${esc(g.name)}"
        title="${esc(`${g.name} · ${g.delivered} delivered · ${g.cancelled} cancelled · ${g.progress} in progress · click to filter`)}">
        <span class="lxt-bar-lab" dir="auto">${esc(g.name)}</span>
        <span class="lxt-split-meta"><b class="s-delivered">${n(g.delivered)}</b><b class="s-cancelled">${n(g.cancelled)}</b><b class="s-progress">${n(g.progress)}</b></span>
        <b class="lxt-num">${n(g.total)}</b>
        <span class="lxt-track"><span data-wk="md-${esc(g.name)}" data-w="${w100(g.total, max)}">
          <i class="s-delivered" style="flex:${g.delivered}"></i><i class="s-cancelled" style="flex:${g.cancelled}"></i><i class="s-progress" style="flex:${g.progress}"></i>
        </span></span>
      </button>`).join("") : calm("No orders in view", "", "car");
  }

  function renderPeople(v) {
    const idx = state.cols.person;
    const box = el("people");
    el("person-title").textContent = idx >= 0 ? `By ${state.model.headers[idx]}` : "By Consultant";
    const list = idx >= 0 ? groupsOf(v.orders, (o) => cellOf(o, idx)) : [];
    const assigned = list.filter((g) => g.name !== "(blank)");
    if (!assigned.length) {
      el("person-all").hidden = true;
      box.innerHTML = calm(GROUP_META.person.empty, GROUP_META.person.hint, "users");
      return;
    }
    list.sort((a, b) => b.progress - a.progress || b.total - a.total);
    const cap = 6;
    el("person-all").hidden = list.length <= cap;
    const f = state.filters.person;
    box.innerHTML = `<div class="lxt-pgrid lxt-phead"><span>Consultant</span><span>Orders</span><span>In prog.</span><span>Due</span><span>Deliv.</span><span>Canc.</span></div>
      ${list.slice(0, cap).map((g) => `
        <button type="button" class="lxt-pgrid lxt-prow${f === g.name ? " is-on" : ""}${f && f !== g.name ? " is-dim" : ""}" data-fset="person" data-value="${esc(g.name)}" title="${esc(g.name)} · click to filter">
          <span class="lxt-pname" dir="auto"><i>${esc(initials(g.name))}</i>${esc(g.name)}</span>
          <b class="lxt-num">${n(g.total)}</b>
          <span class="lxt-num s-progress">${n(g.progress)}</span>
          <span class="lxt-num${g.due ? " s-due is-strong" : " is-zero"}">${n(g.due)}</span>
          <span class="lxt-num s-delivered">${n(g.delivered)}</span>
          <span class="lxt-num s-cancelled">${n(g.cancelled)}</span>
        </button>`).join("")}`;
  }

  function initials(name) {
    if (name === "(blank)") return "—";
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() : "?";
  }

  // ---------- Orders ----------

  /** Attention first (longest overdue), then the latest orders. */
  function attentionSort(list) {
    const dk = state.dayKeys;
    return list.slice().sort((a, b) => (b.due - a.due)
      || (a.due && b.due ? b.sinceMs - a.sinceMs : 0)
      || (dk.get(b.key) || "").localeCompare(dk.get(a.key) || "")
      || b.sheetRow - a.sheetRow);
  }

  function followCell(o) {
    if (!o.needsFollowUp) return `<span class="lxt-dim">—</span>`;
    if (!o.firstSeenAt) return `<span class="lxt-dim">Starting</span>`;
    if (o.due) return `<span class="lxt-fu is-due" title="No follow-up for ${esc(Core().hoursText(o.sinceMs))}">Due · ${esc(Core().hoursText(o.sinceMs))}</span>`;
    return `<span class="lxt-fu is-ok">Next in ${esc(Core().hoursText(o.dueAt - Date.now()))}</span>`;
  }

  function trackCell(o) {
    const t = o.track;
    if (o.category !== "progress" && (t.kind === "notFound" || t.kind === "noData")) return `<span class="lxt-dim">—</span>`;
    return `<span class="lxt-trk ${TRACK_TONE[t.kind]}"><i></i>${esc(Core().trackText(t))}</span>`;
  }

  // ---------- Live Sheet delivery status (VIN Finder) ----------

  const VIN_FINDER_URL = "/delivery-transformation/vin-finder.html";
  const LIVE_RETRY_MS = 60 * 1000;

  const liveOf = (o) => Core().liveStatusOf(o, state.cols.vin);

  function liveBadge(o) {
    const live = liveOf(o);
    if (live === undefined) {
      const text = state.live.busy.has(o.key) ? "Checking Live Sheet…" : state.live.error ? "Live Sheet unavailable" : "Live Sheet status ›";
      return `<small class="lxt-lstat is-idle">${esc(text)}</small>`;
    }
    if (live === null) return `<small class="lxt-lstat is-none">Not on Live Sheet</small>`;
    const tone = Core().liveTone(live.status);
    return `<small class="lxt-lstat${tone ? ` is-${tone}` : ""}" title="${esc(`Live Sheet · ${live.status || "no status"}${live.employee ? ` · ${live.employee}` : ""}${live.vin ? ` · VIN ${live.vin}` : ""}`)}"><i></i><bdi>${esc(live.status || "No status")}</bdi>${live.employee ? ` · <bdi>${esc(live.employee)}</bdi>` : ""}</small>`;
  }

  function categoryCell(o) {
    const pill = `<span class="lxt-cat ${CAT_TONE[o.category]}"><i></i>${esc(Core().CATEGORY_LABEL[o.category])}</span>`;
    if (o.category !== "delivered") return pill;
    return `<button type="button" class="lxt-catbtn" data-act="live" data-key="${esc(o.key)}" title="Show the delivery status on the Live Sheet (VIN Finder)">${pill}${liveBadge(o)}</button>`;
  }

  /** Loads Live Sheet statuses for the delivered orders given (cached for a minute in lexus-core). */
  function ensureLive(orders, force) {
    const C = Core();
    if (!C.fetchLiveStatus) return;
    if (!force && state.live.error && Date.now() - state.live.errorAt < LIVE_RETRY_MS) return;
    const list = orders.filter((o) => o.category === "delivered" && !state.live.busy.has(o.key));
    if (!list.length) return;
    list.forEach((o) => state.live.busy.add(o.key));
    C.fetchLiveStatus(list, state.cols.vin)
      .then((changed) => {
        state.live.error = "";
        list.forEach((o) => state.live.busy.delete(o.key));
        if (changed || force) refreshLiveViews();
      })
      .catch((err) => {
        state.live.error = err.message || "Live Sheet lookup failed";
        state.live.errorAt = Date.now();
        list.forEach((o) => state.live.busy.delete(o.key));
        refreshLiveViews();
      });
  }

  function checkLive(key) {
    const o = state.model && state.model.orders.find((x) => x.key === key);
    if (!o) return;
    ensureLive([o], true);
    if (liveOf(o) === undefined) refreshLiveViews();
  }

  function refreshLiveViews() {
    if (!state.model || !state.model.ready) return;
    renderPreview(filteredView());
    if (!el("modal").hidden) renderModal();
  }

  function liveSection(o) {
    const live = liveOf(o);
    const field = (label, value) => `<div class="lxt-field"><span>${esc(label)}</span><b dir="auto">${value}</b></div>`;
    const link = `<a class="lxt-link" href="${VIN_FINDER_URL}?q=${encodeURIComponent(live && live.vin ? live.vin : o.orderNo)}" target="_blank" rel="noopener">Open in VIN Finder ${icon("external")}</a>`;
    let body;
    if (live === undefined) body = `<p class="lxt-dim lxt-pad">${esc(state.live.busy.has(o.key) ? "Checking the Live Sheet…" : state.live.error || "Not checked yet")}</p>`;
    else if (live === null) body = `<p class="lxt-dim lxt-pad">Order ${esc(o.orderNo)}${state.cols.vin >= 0 && o.cells[state.cols.vin] ? ` / VIN ${esc(o.cells[state.cols.vin])}` : ""} is not on the Delivery Transformation Live Sheet.</p>`;
    else {
      const tone = Core().liveTone(live.status);
      body = `<div class="lxt-fields">
        ${field("Current status", `<span class="lxt-lstat is-lg${tone ? ` is-${tone}` : ""}"><i></i><bdi>${esc(live.status || "No status")}</bdi></span>`)}
        ${field("Employee", esc(live.employee || "—"))}
        ${field("VIN number", esc(live.vin || "—"))}
        ${field("Order number", esc(live.order || "—"))}
      </div>`;
    }
    return `<section><h4>Delivery · Live Sheet ${link}</h4>${body}</section>`;
  }

  function orderColumns() {
    const c = state.cols;
    const H = state.model.headers;
    const cell = (idx) => (o) => (idx >= 0 ? `<span dir="auto">${esc(o.cells[idx])}</span>` : `<span class="lxt-dim">—</span>`);
    return [
      { h: "Order No.", td: (o) => `<b class="lxt-num">${esc(o.orderNo)}</b>`, cls: "is-key" },
      { h: c.customer >= 0 ? H[c.customer] : "Customer", td: cell(c.customer), cls: "is-wide" },
      { h: c.model >= 0 ? H[c.model] : "Model", td: cell(c.model) },
      { h: c.city >= 0 ? H[c.city] : "Delivery City", td: cell(c.city) },
      { h: "Status", td: (o) => `<span class="lxt-pill ${CAT_TONE[o.category]}" dir="auto">${esc(o.statusText || "—")}</span>` },
      { h: "Category", td: categoryCell },
      { h: "BO Queue / Sales Raw", td: trackCell },
      { h: "Follow-up", td: followCell },
      { h: "Last Follow-up", td: (o) => (o.lastFollowUpAt ? `${esc(Core().fmtAt(o.lastFollowUpAt))}${o.lastFollowUpBy ? ` <span class="lxt-dim">· ${esc(o.lastFollowUpBy)}</span>` : ""}` : `<span class="lxt-dim">—</span>`) },
      { h: "Notes", td: (o) => (o.note ? `<span dir="auto" title="${esc(o.note)}">${esc(o.note)}</span>` : `<span class="lxt-dim">—</span>`), cls: "is-note" },
      { h: "Actions", td: (o) => `<span class="lxt-acts"><button type="button" class="lxt-act" data-act="open" data-key="${esc(o.key)}">View</button><a class="lxt-act is-icon" href="${CONTROLLER_URL}?q=${encodeURIComponent(o.orderNo)}" target="_blank" rel="noopener" title="Open in Lexus Controller" aria-label="Open in Lexus Controller">${icon("external")}</a></span>`, cls: "is-act" },
    ];
  }

  function tableHtml(rows, cols, emptyText) {
    return `<thead><tr>${cols.map((c) => `<th class="${c.cls || ""}">${esc(c.h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((o) => `<tr data-key="${esc(o.key)}" tabindex="0" class="${o.due ? "is-due" : ""}">${cols.map((c) => `<td class="${c.cls || ""}">${c.td(o)}</td>`).join("")}</tr>`).join("")
        || `<tr><td colspan="${cols.length}" class="lxt-dim lxt-td-empty">${esc(emptyText || "No orders match.")}</td></tr>`}</tbody>`;
  }

  function renderPreview(v) {
    const wrap = el("preview-wrap");
    const scrollMode = getComputedStyle(state.root).overflowY === "auto";
    const fit = scrollMode ? 8 : Math.max(2, Math.floor((wrap.clientHeight - 34) / 34));
    const rows = attentionSort(v.orders);
    const shown = rows.slice(0, fit);
    if (state.filters.category === "delivered") ensureLive(shown);
    el("orders-sub").textContent = `attention first · ${n(shown.length)} of ${n(rows.length)}${v.active ? " filtered" : ""}`;
    el("preview").innerHTML = tableHtml(shown, orderColumns(), "No orders match the filters.");
  }

  // ---------- Modal ----------

  function drillFn(kind) {
    const [k, ...rest] = String(kind || "all").split(":");
    const arg = rest.join(":");
    if (k === "cat") return (o) => o.category === arg;
    if (k === "due") return (o) => o.due;
    if (k === "ontime") return (o) => o.category === "progress" && !o.due;
    if (k === "never") return (o) => o.category === "progress" && !o.followUps.length;
    if (k === "logged") return (o) => o.followUps.length > 0;
    if (k === "track") return (o) => o.category === "progress" && o.track.kind === arg;
    return () => true;
  }

  const modalTop = () => state.modal.stack[state.modal.stack.length - 1];

  function openList(drill, label) {
    state.modal.stack = [{ type: "list", drill, label: label || "Orders", tab: "all", search: "" }];
    renderModal();
  }

  function openGroups(group) {
    state.modal.stack = [{ type: "groups", group, search: "" }];
    renderModal();
  }

  function openOrder(key) {
    const top = modalTop();
    const entry = { type: "order", key };
    if (!el("modal").hidden && top && top.type !== "order") state.modal.stack.push(entry);
    else state.modal.stack = [entry];
    renderModal();
  }

  function closeModal() {
    state.modal.stack = [];
    el("modal").hidden = true;
  }

  function filterNote(v) {
    if (!v.active) return "";
    const parts = [];
    const f = state.filters;
    if (f.from || f.to) parts.push(`${f.from || "…"} → ${f.to || "…"}`);
    ["model", "status", "person", "city"].forEach((k) => { if (f[k]) parts.push(f[k]); });
    if (f.category) parts.push(Core().CATEGORY_LABEL[f.category]);
    return ` · filters: ${parts.join(" · ")}`;
  }

  function renderModal() {
    const top = modalTop();
    if (!top || !state.model || !state.model.ready) { closeModal(); return; }
    el("modal").hidden = false;
    el("m-back").hidden = state.modal.stack.length < 2;
    const search = el("m-search");
    search.hidden = top.type === "order";
    if (document.activeElement !== search) search.value = top.search || "";
    el("m-link").hidden = top.type !== "order";
    if (top.type === "list") renderListModal(top);
    else if (top.type === "groups") renderGroupModal(top);
    else renderOrderModal(top);
  }

  function renderListModal(top) {
    const v = filteredView();
    const base = v.orders.filter(drillFn(top.drill));
    const counts = Object.fromEntries(LIST_TABS.map((t) => [t.id, base.filter(t.fn).length]));
    const tab = LIST_TABS.find((t) => t.id === top.tab) || LIST_TABS[0];
    const q = (top.search || "").trim().toLowerCase();
    const rows = attentionSort(base.filter(tab.fn).filter((o) => !q || `${o.cells.join(" ")} ${o.note} ${Core().trackText(o.track)}`.toLowerCase().includes(q)));
    const limit = 500;
    ensureLive(rows.slice(0, limit));
    el("m-title").textContent = top.label;
    el("m-sub").textContent = `${n(base.length)} orders${filterNote(v)} · click a row for tracking, follow-up history and all columns`;
    el("m-tabs").innerHTML = LIST_TABS.map((t) => `<button type="button" class="${t.id === tab.id ? "is-on" : ""}${t.id === "due" && counts.due ? " is-due" : ""}" data-act="m-tab" data-tab="${t.id}">${esc(t.label)}<b class="lxt-num">${n(counts[t.id])}</b></button>`).join("");
    el("m-body").innerHTML = `<table class="lxt-table is-modal">${tableHtml(rows.slice(0, limit), orderColumns(), "No orders match.")}</table>`;
    el("m-foot").textContent = rows.length > limit ? `Showing the first ${limit} of ${n(rows.length)} · search to narrow down` : `${n(rows.length)} shown`;
  }

  function renderGroupModal(top) {
    const v = filteredView();
    const meta = GROUP_META[top.group];
    const idx = top.group === "status" ? null : state.cols[top.group];
    const nameOf = top.group === "status" ? statusOf : (o) => cellOf(o, idx);
    const q = (top.search || "").trim().toLowerCase();
    const list = groupsOf(v.orders, nameOf).filter((g) => !q || g.name.toLowerCase().includes(q)).sort((a, b) => b.total - a.total);
    const max = list.reduce((m, g) => Math.max(m, g.total), 0);
    el("m-title").textContent = top.group === "status" ? meta.title : idx >= 0 ? `By ${state.model.headers[idx]}` : meta.title;
    el("m-sub").textContent = `${n(list.length)} groups · ${n(v.orders.length)} orders${filterNote(v)} · click a row to filter the dashboard`;
    el("m-tabs").innerHTML = "";
    el("m-body").innerHTML = `<table class="lxt-table is-modal"><thead><tr><th>Name</th><th class="num">Orders</th><th class="num">In progress</th><th class="num">Follow-up due</th><th class="num">Delivered</th><th class="num">Cancelled</th><th class="is-share">Share</th></tr></thead>
      <tbody>${list.map((g) => `<tr data-fset="${top.group}" data-value="${esc(g.name)}" tabindex="0">
        <td dir="auto"><b>${esc(g.name)}</b></td><td class="num"><b>${n(g.total)}</b></td><td class="num s-progress">${n(g.progress)}</td>
        <td class="num${g.due ? " s-due" : ""}">${n(g.due)}</td><td class="num s-delivered">${n(g.delivered)}</td><td class="num s-cancelled">${n(g.cancelled)}</td>
        <td class="is-share"><span class="lxt-track"><span style="width:${w100(g.total, max)}"><i class="s-delivered" style="flex:${g.delivered}"></i><i class="s-cancelled" style="flex:${g.cancelled}"></i><i class="s-progress" style="flex:${g.progress}"></i></span></span></td>
      </tr>`).join("") || `<tr><td colspan="7" class="lxt-dim lxt-td-empty">Nothing matches.</td></tr>`}</tbody></table>`;
    el("m-foot").textContent = "Delivered · Cancelled · In progress";
  }

  function renderOrderModal(top) {
    const o = state.model.orders.find((x) => x.key === top.key);
    if (!o) { closeModal(); return; }
    const C = Core();
    el("m-title").textContent = `Order ${o.orderNo}`;
    el("m-sub").innerHTML = `<span class="lxt-cat ${CAT_TONE[o.category]}"><i></i>${esc(C.CATEGORY_LABEL[o.category])}</span> · ${esc(C.trackText(o.track) || "—")} · Details sheet row ${o.sheetRow}`;
    el("m-link").href = `${CONTROLLER_URL}?q=${encodeURIComponent(o.orderNo)}`;
    el("m-tabs").innerHTML = "";
    const H = state.model.headers;
    const field = (label, value, cls) => `<div class="lxt-field${cls ? ` ${cls}` : ""}"><span>${esc(label)}</span><b dir="auto">${value}</b></div>`;
    const t = o.track;
    const trackRows = t.kind === "queue"
      ? field("Queue position", t.position != null ? `${n(t.position)} of ${n(t.total)}` : "No queue match")
        + field("Orders ahead", t.ahead != null ? n(t.ahead) : "—")
        + field("Product · Suffix", esc(`${t.product} ${t.suffix}`.trim() || "—"))
        + field("Reservation date", esc(t.reservationDate || "—"))
      : t.kind === "delivered" || t.kind === "proforma" || t.kind === "salesNoDate"
        ? field("Sales Raw row", `${n(t.sheetRow)} (order no in Col ${esc(t.column)})`)
          + field("Col P · Pro-Forma", esc(t.proforma || "blank"))
          + field("Col V · Delivery", esc(t.delivery || "blank"))
        : field("Tracking", esc(TRACK_RULE[t.kind] || ""), "is-wide");
    const fields = H.map((h, i) => {
      const edited = Object.prototype.hasOwnProperty.call(o.edits, h);
      return `<div class="lxt-field${edited ? " is-edited" : ""}"><span>${esc(h)}</span><b dir="auto">${esc(o.cells[i]) || '<em class="lxt-dim">blank</em>'}</b>${edited ? `<small>File: ${esc(o.fileCells[i] || "(blank)")}</small>` : ""}</div>`;
    }).join("");
    const history = o.followUps.slice().reverse().map((f) => `<li><b>${esc(C.fmtAt(f.at))}</b>${f.by ? ` · ${esc(f.by)}` : ""}${f.note ? `<p dir="auto">${esc(f.note)}</p>` : ""}</li>`).join("");
    if (o.category === "delivered") ensureLive([o]);
    el("m-body").innerHTML = `<div class="lxt-detail">
      ${o.category === "delivered" ? liveSection(o) : ""}
      <section><h4>Tracking</h4><div class="lxt-fields">${trackRows}</div></section>
      <section><h4>Follow-up</h4><div class="lxt-fields">
        ${field("Status", followCell(o))}
        ${field("First seen", esc(C.fmtAt(o.firstSeenAt) || "—"))}
        ${field("Last user update", esc(o.updatedAt ? `${C.fmtAt(o.updatedAt)}${o.updatedBy ? ` · ${o.updatedBy}` : ""}` : "—"))}
        ${field("Notes", esc(o.note) || '<em class="lxt-dim">No notes</em>', "is-wide")}
      </div>${history ? `<ol class="lxt-history">${history}</ol>` : `<p class="lxt-dim lxt-pad">No follow-ups recorded yet.</p>`}</section>
      <section><h4>All columns · Details sheet${o.editCount ? ` · <span class="lxt-edited-tag">${n(o.editCount)} edited by users</span>` : ""}</h4><div class="lxt-fields">${fields}</div></section>
    </div>`;
    el("m-foot").textContent = "Edits, notes and follow-ups are made in the Lexus Controller";
  }

  // ---------- Motion ----------

  function tweenNumbers(scope) {
    scope.querySelectorAll("[data-num]").forEach((node) => {
      const key = node.dataset.num;
      const to = Number(node.dataset.to) || 0;
      const from = state.prevNum.has(key) ? state.prevNum.get(key) : to;
      state.prevNum.set(key, to);
      if (from === to || reduceMotion) { node.textContent = n(to); return; }
      const t0 = performance.now();
      node.textContent = n(from);
      const step = (t) => {
        const p = Math.min(1, (t - t0) / 420);
        node.textContent = n(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1 && node.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function animateBars(scope) {
    const nodes = [...scope.querySelectorAll("[data-wk]")];
    if (!nodes.length) return;
    if (!reduceMotion) {
      nodes.forEach((nd) => { nd.style.width = state.prevW.get(nd.dataset.wk) || "0%"; });
      void scope.offsetWidth;
    }
    nodes.forEach((nd) => {
      nd.style.width = nd.dataset.w;
      state.prevW.set(nd.dataset.wk, nd.dataset.w);
    });
  }

  function lightHero() {
    const hero = el("hero");
    if (!hero || hero.classList.contains("is-lit")) return;
    const apply = () => {
      hero.style.setProperty("--lxt-hero-img", `url("data:image/svg+xml,${encodeURIComponent(HERO_SVG)}")`);
      hero.classList.add("is-lit");
    };
    if (global.requestIdleCallback) global.requestIdleCallback(apply, { timeout: 1200 });
    else setTimeout(apply, 250);
  }

  // ---------- Public ----------

  function mount(host) {
    if (!host || state.host === host) return;
    state.host = host;
    build();
  }

  function show(ctx) {
    state.ctx = ctx || {};
    if (!state.root) return;
    el("exit").hidden = typeof state.ctx.onExit !== "function";
    lightHero();
    if (!state.started) {
      state.started = true;
      load(false);
      if (global.ReportSheetStore) global.ReportSheetStore.startLiveSync(() => load(true), { pollMs: 10000 });
      Core().startStateSync(() => { if (!state.loading) refreshState(); }, 30000);
      setInterval(() => { if (state.data && state.root.getClientRects().length) { rebuild(); render(); } }, 60000);
    } else if (state.data) {
      rebuild();
      render();
    } else {
      load(false);
    }
  }

  global.LexusTracker = { mount, show, reload: () => load(true) };
})(typeof window !== "undefined" ? window : globalThis);
