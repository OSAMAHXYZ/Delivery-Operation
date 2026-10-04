/**
 * GEC Control Center · one-screen light executive dashboard (presentation only — rules live in gec-data.js).
 * Fixed 100vh layout, no page scroll; detail lives in modals (the only scrolling surface).
 * Usage: GecDashboard.render(hostEl, leadDataset, { visitors, sales, backorder, control, lastUpdated, onRefresh, onExit })
 */
(function (global) {
  const Data = () => global.GecData;
  const cfg = () => Data().config;
  /** Letter of the detected “Employee Number” column (it can move between files). */
  const empCol = () => {
    const m = state.dataset && state.dataset.mapping.find((x) => x.key === "employeeNumber");
    return (m && m.letter) || cfg().EMPLOYEE_NUMBER_COLUMN;
  };

  const EMPTY_FILTERS = { from: "", to: "", promoter: "", model: "", source: "", status: "", consultant: "", purpose: "" };

  const state = {
    host: null,
    root: null,
    dataset: null,
    visitors: null,
    orders: null,
    orderSrc: { sales: null, bo: null },
    ctx: {},
    sig: "",
    filters: { ...EMPTY_FILTERS },
    metrics: null,
    view: {
      promoter: { mode: "period", day: "", rank: "leads" },
      advisor: { mode: "period", day: "", rank: "leads" },
    },
    chart: null,
    resizeObserver: null,
    resizeTimer: null,
    debug: /[?&]gecdebug=1\b/.test(global.location ? global.location.search : ""),
    modal: { views: [], active: 0, search: "", allCols: false, filterAction: null },
  };

  const fmtInt = new Intl.NumberFormat("en-US");
  const n = (v) => fmtInt.format(Math.round(Number(v) || 0));
  const nOrDash = (v) => (v == null ? "—" : n(v));
  const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ratio = (a, b) => (b ? a / b : null);
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const w100 = (v) => `${(clamp01(v) * 100).toFixed(1)}%`;

  function fmtDay(key, withYear) {
    const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "—";
    return `${m[3]} ${MONTHS[+m[2] - 1]}${withYear ? ` ${m[1]}` : ""}`;
  }
  function fmtDate(d, withTime) {
    if (!(d instanceof Date) || isNaN(d)) return "";
    const base = `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (!withTime || (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0)) return base;
    return `${base} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function minutesText(m) {
    if (m == null || !Number.isFinite(m)) return "";
    if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
    if (m < 2880) return `${(m / 60).toFixed(1)} h`;
    return `${(m / 1440).toFixed(1)} d`;
  }
  function daysBetween(from, to) {
    const a = from ? new Date(`${from}T00:00:00`) : null;
    const b = to ? new Date(`${to}T00:00:00`) : null;
    if (!a || !b || isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }
  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  const empOf = (name) => { const e = Object.entries(Data().PROMOTER_MAP).find(([, v]) => v === name); return e ? e[0] : ""; };

  // ---------- Icons (inline SVG, stroke = currentColor) ----------

  const ICONS = {
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    lead: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    msg: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
    receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-3 2-3-2-3 2-3-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
    crown: '<path d="m2 7 5 4 5-7 5 7 5-4-2 12H4z"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1z"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    funnel: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    car: '<path d="M5 17H3v-4.5a2 2 0 0 1 .6-1.4L6 9l1.6-3.2A2 2 0 0 1 9.4 5h5.2a2 2 0 0 1 1.8 1.1L18 9l2.4 2.1a2 2 0 0 1 .6 1.4V17h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5M6 9h12"/>',
  };
  const icon = (name, cls) => `<svg class="gcc-ic${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  const KPI_DEFS = [
    { key: "visitors", label: "Total Visitors", icon: "users", tone: "violet", spark: "visitors" },
    { key: "total", label: "Registered Leads", icon: "lead", tone: "blue", spark: "leads" },
    { key: "visitorToLead", label: "Visitor → Lead", icon: "trend", tone: "indigo", spark: "v2l", rate: true },
    { key: "responded", label: "Meet Sales Advisor", icon: "msg", tone: "cyan", spark: "responded" },
    { key: "converted", label: "Converted", icon: "check", tone: "green", spark: "converted" },
    { key: "assignmentErrors", label: "No Promoter Assigned", icon: "alert", tone: "rose", side: true },
    { key: "noProduct", label: "No Product", icon: "car", tone: "rose", side: true },
  ];

  const DRILL_TITLES = {
    total: "Registered leads (unique Transaction No.)",
    get knownPromoter() { return `Leads assigned to an official promoter (Employee Number · column ${empCol()})`; },
    get assignmentErrors() { return `No promoter assigned · customers with Employee Number (column ${empCol()}) blank`; },
    noProduct: "No product · customers with column D or column G blank",
    get invalidPromoter() { return `Invalid Promoter · Employee Number (column ${empCol()}) is not an official promoter number`; },
    responded: "Meet Sales Advisor · leads with a Sales Response",
    responseRate: "Meet Sales Advisor · leads with a Sales Response",
    salesOrders: "Leads with an actual Sales Order",
    salesOrderRate: "Leads with an actual Sales Order",
    noOrder: "“NO ORDER” leads (not counted as Sales Orders)",
    converted: "Converted leads (GEC CONTROL conversion statuses)",
    conversionRate: "Converted leads (GEC CONTROL conversion statuses)",
    noAdvisor: "Leads without a sales advisor",
    noResponse: "Did not meet a sales advisor · no Sales Response",
    unlisted: "Leads with a status not in GEC CONTROL",
    promoterConsultant: "Leads assigned to a promoter (not a sales advisor)",
  };
  const METRIC_LABEL = { visitors: "Visitors", leads: "Leads", responded: "Meet Sales Advisor", salesOrders: "Sales Orders", converted: "Converted" };
  const METRIC_PRED = { leads: "total", responded: "responded", salesOrders: "salesOrders", converted: "converted" };
  const STAGE_LABEL = { converted: "Converted", lead: "Lead", visitor: "Registered", unlisted: "Unlisted status" };

  // ---------- Skeleton ----------

  function build(host) {
    host.innerHTML = `
      <div class="gcc" role="application" aria-label="GEC Control Center">
        <header class="gcc-header">
          <div class="gcc-brand">
            <span class="gcc-logo" aria-hidden="true">${icon("route")}</span>
            <div class="gcc-brand-text"><strong>GEC CONTROL CENTER</strong><span>GUEST EXPERIENCE CENTER</span></div>
          </div>
          <div class="gcc-filters">
            <div class="gcc-f gcc-f-date" data-fwrap="date"><span>Date</span>
              <input type="date" data-f="from" aria-label="From date" /><em>→</em><input type="date" data-f="to" aria-label="To date" />
            </div>
            <label class="gcc-f" data-fwrap="promoter"><span>Promoter</span><select data-f="promoter"></select></label>
            <label class="gcc-f" data-fwrap="consultant"><span>Sales Advisor</span><select data-f="consultant" dir="auto"></select></label>
            <label class="gcc-f" data-fwrap="model"><span>Model</span><select data-f="model" dir="auto"></select></label>
            <label class="gcc-f" data-fwrap="source"><span>Source</span><select data-f="source"></select></label>
            <label class="gcc-f" data-fwrap="status"><span>Status</span><select data-f="status"></select></label>
            <span class="gcc-fchips" data-el="chips"></span>
            <button type="button" class="gcc-btn is-ghost" data-act="reset" data-el="reset">Reset</button>
          </div>
          <div class="gcc-actions">
            <span class="gcc-live is-off" data-el="live"><i></i><b>LIVE</b></span>
            <span class="gcc-updated"><small>Last updated</small><b data-el="updated">—</b></span>
            <button type="button" class="gcc-btn is-debug" data-act="validate" data-el="debug-btn" title="Developer validation (Ctrl+Shift+D)" hidden>Validation</button>
            <button type="button" class="gcc-icon-btn" data-act="info" title="Data source, rules & quality" aria-label="Data source, rules and quality">${icon("db")}</button>
            <button type="button" class="gcc-btn is-primary" data-act="refresh" title="Reload the latest Admin Push">${icon("refresh")}<span>Refresh</span></button>
            <button type="button" class="gcc-icon-btn" data-act="fullscreen" title="Fullscreen" aria-label="Fullscreen">${icon("expand")}</button>
            <button type="button" class="gcc-icon-btn is-exit" data-act="exit" title="Back to report" aria-label="Back to report">${icon("close")}</button>
          </div>
        </header>

        <section class="gcc-kpis" data-el="kpis"></section>

        <section class="gcc-journeys">
          <article class="gcc-card gcc-journey is-visitor" data-el="vj"></article>
          <article class="gcc-card gcc-journey is-lead" data-el="lj"></article>
        </section>

        <section class="gcc-mid">
          <article class="gcc-card gcc-trend">
            <div class="gcc-card-head">
              <h2><span class="gcc-h-ic t-blue">${icon("chart")}</span>Trend <small data-el="trend-sub"></small></h2>
              <div class="gcc-legend" data-el="legend"></div>
            </div>
            <div class="gcc-chart"><canvas data-el="chart" aria-label="Visitors and leads per day (bars), sales orders and converted (lines)"></canvas></div>
          </article>
          <article class="gcc-card gcc-cars">
            <div class="gcc-card-head">
              <h2><span class="gcc-h-ic t-green">${icon("car")}</span>Top Cars <small>converted → now</small></h2>
              <button type="button" class="gcc-link" data-act="cars-all" title="All models · converted and current Sales Raw / Back Order status">All ↗</button>
            </div>
            <div class="gcc-car-sum" data-el="car-sum"></div>
            <div class="gcc-bars" data-el="cars"></div>
          </article>
          <article class="gcc-card gcc-status">
            <div class="gcc-card-head">
              <h2><span class="gcc-h-ic t-green">${icon("list")}</span>Lead Status</h2>
              <span class="gcc-head-note" data-el="status-note"></span>
            </div>
            <div class="gcc-bars" data-el="status"></div>
          </article>
        </section>

        <section class="gcc-perf-row">
          <article class="gcc-card gcc-perf is-promoter">
            <div class="gcc-card-head">
              <h2><span class="gcc-emoji" aria-hidden="true">👑</span>Promoter Performance <small>visitors → leads → converted</small></h2>
              <div class="gcc-tools" data-el="promoter-tools"></div>
            </div>
            <div class="gcc-perf-body" data-el="promoter"></div>
          </article>
          <article class="gcc-card gcc-perf is-advisor">
            <div class="gcc-card-head">
              <h2><span class="gcc-emoji" aria-hidden="true">⭐</span>Sales Advisor Performance <small>leads received → response → converted</small></h2>
              <div class="gcc-tools" data-el="advisor-tools"></div>
            </div>
            <div class="gcc-perf-body" data-el="advisor"></div>
          </article>
        </section>

        <footer class="gcc-attention" data-el="attention"></footer>

        <div class="gcc-empty" data-el="empty" hidden></div>

        <div class="gcc-modal" data-el="modal" hidden>
          <div class="gcc-modal-card" role="dialog" aria-modal="true" aria-labelledby="gcc-modal-title">
            <div class="gcc-modal-head">
              <div><h3 id="gcc-modal-title" data-el="m-title"></h3><p data-el="m-sub"></p></div>
              <div class="gcc-modal-tools">
                <button type="button" class="gcc-btn" data-act="modal-filter" data-el="m-filter" hidden></button>
                <input type="search" data-el="m-search" placeholder="Search records…" aria-label="Search records" />
                <label data-el="m-allcols-wrap"><input type="checkbox" data-el="m-allcols" /> All Excel columns</label>
                <button type="button" class="gcc-icon-btn" data-act="modal-close" title="Close" aria-label="Close">${icon("close")}</button>
              </div>
            </div>
            <div class="gcc-modal-stats" data-el="m-stats"></div>
            <div class="gcc-modal-tabs" data-el="m-tabs"></div>
            <div class="gcc-modal-body" data-el="m-body"></div>
            <div class="gcc-modal-foot" data-el="m-foot"></div>
          </div>
        </div>
      </div>`;
    state.host = host;
    state.root = host.querySelector(".gcc");
    bindEvents();
  }

  const el = (name) => state.root.querySelector(`[data-el="${name}"]`);

  function bindEvents() {
    const root = state.root;
    root.addEventListener("click", (e) => {
      const drill = e.target.closest("[data-drill]");
      const act = e.target.closest("[data-act]");
      // Innermost target wins (a number inside a clickable row opens that number).
      if (drill && (!act || act.contains(drill))) { onDrill(drill); return; }
      if (act) { onAction(act); return; }
      const row = e.target.closest("tr[data-row]");
      if (row) { onModalRow(Number(row.dataset.row)); return; }
      if (e.target === el("modal")) closeModal();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el("modal").hidden) { e.stopPropagation(); closeModal(); return; }
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target;
      if (/^(BUTTON|SELECT|INPUT)$/.test(t.tagName)) return;
      const drill = t.closest && t.closest("[data-drill]");
      if (drill) { e.preventDefault(); onDrill(drill); return; }
      const act = t.closest && t.closest("[data-act]");
      if (act) { e.preventDefault(); onAction(act); return; }
      if (t.matches("tr[data-row]")) { e.preventDefault(); onModalRow(Number(t.dataset.row)); }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.f) { setFilter(t.dataset.f, t.value || ""); return; }
      if (t === el("m-allcols")) { state.modal.allCols = t.checked; renderModalTable(); }
    });
    el("m-search").addEventListener("input", (e) => { state.modal.search = e.target.value; renderModalTable(); });
    document.addEventListener("keydown", (e) => {
      if (!state.root || !state.root.getClientRects().length) return;
      if (e.key === "Escape" && !el("modal").hidden) closeModal();
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        state.debug = !state.debug;
        el("debug-btn").hidden = !state.debug;
        if (state.debug) openValidation();
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const btn = root.querySelector('[data-act="fullscreen"]');
      if (btn) btn.title = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    });
    if ("ResizeObserver" in global) {
      state.resizeObserver = new ResizeObserver(() => {
        clearTimeout(state.resizeTimer);
        state.resizeTimer = setTimeout(() => {
          if (!state.metrics || !state.root.getClientRects().length) return;
          renderPerf("promoter");
          renderPerf("advisor");
        }, 90);
      });
      state.resizeObserver.observe(root);
    }
  }

  function onAction(node) {
    const d = node.dataset;
    const act = d.act;
    if (act === "refresh" && typeof state.ctx.onRefresh === "function") state.ctx.onRefresh();
    else if (act === "exit") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (typeof state.ctx.onExit === "function") state.ctx.onExit();
    } else if (act === "fullscreen") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (act === "reset") {
      state.filters = { ...EMPTY_FILTERS };
      renderAll();
    } else if (act === "clear-filter") setFilter(d.key, "");
    else if (act === "purpose") setFilter("purpose", state.filters.purpose === d.value ? "" : d.value);
    else if (act === "mode") {
      const v = state.view[d.panel];
      v.mode = d.mode;
      if (v.mode === "daily" && !validDay(v.day)) v.day = defaultDay();
      renderPerf(d.panel);
    } else if (act === "rank") { state.view[d.panel].rank = d.rank; renderPerf(d.panel); }
    else if (act === "day") {
      const days = dataDays();
      const v = state.view[d.panel];
      const i = days.indexOf(v.day);
      const next = days[Math.max(0, Math.min(days.length - 1, (i < 0 ? days.length - 1 : i) + Number(d.step)))];
      if (next) { v.day = next; renderPerf(d.panel); }
    } else if (act === "info") openInfo();
    else if (act === "validate") openValidation();
    else if (act === "unlisted") openUnlisted();
    else if (act === "registered") openRegistered();
    else if (act === "rank-all") openRankAll(d.kind);
    else if (act === "cars-all") openCarsAll();
    else if (act === "car-state") openCarState(d.state);
    else if (act === "modal-close") closeModal();
    else if (act === "modal-tab") { state.modal.active = Number(d.tab) || 0; state.modal.search = ""; el("m-search").value = ""; renderModalTable(); }
    else if (act === "modal-filter" && state.modal.filterAction) {
      const { key, value } = state.modal.filterAction;
      closeModal();
      setFilter(key, state.filters[key] === value ? "" : value);
    }
  }

  function onDrill(node) {
    const d = node.dataset;
    const kind = d.drill;
    if (kind === "kpi") openKpi(d.key);
    else if (kind === "promoter") openPromoter(d.name);
    else if (kind === "advisor") openAdvisor(d.name);
    else if (kind === "cell") openCell(d.kind, d.name, d.metric);
    else if (kind === "status") openStatus(d.key);
    else if (kind === "car") openCar(d.name);
    else if (kind === "quality") openInfo();
  }

  // ---------- Filters ----------

  function datasetSig(ds, vs) {
    if (!ds) return "";
    return [ds.fileName, ds.sheetName, ds.records.length, ds.range.from, ds.range.to, vs ? vs.total : ""].join("|");
  }

  function setFilter(key, value) {
    const f = state.filters;
    const r = (state.dataset && state.dataset.range) || {};
    if (key === "from" || key === "to") {
      f[key] = value;
      if (f.from && f.to && f.from > f.to) { if (key === "from") f.to = f.from; else f.from = f.to; }
      // Full range selected = no date filter (keeps undated transactions in the totals).
      if ((!f.from || f.from <= r.from) && (!f.to || f.to >= r.to)) { f.from = ""; f.to = ""; }
    } else f[key] = value;
    renderAll();
  }

  function renderFilterControls() {
    const ds = state.dataset;
    const opts = ds ? Data().filterOptions(ds) : { promoters: [], consultants: [], models: [], sources: [], statuses: [] };
    const fill = (key, list, allLabel) => {
      const sel = state.root.querySelector(`[data-f="${key}"]`);
      const cur = state.filters[key];
      sel.innerHTML = `<option value="">${allLabel}</option>` + list.map((v) =>
        `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
      sel.disabled = !list.length;
      state.root.querySelector(`[data-fwrap="${key}"]`).classList.toggle("is-active", !!cur);
    };
    fill("promoter", opts.promoters, "All promoters");
    fill("consultant", opts.consultants || [], "All advisors");
    fill("model", opts.models, "All models");
    fill("source", opts.sources, "All sources");
    fill("status", opts.statuses, "All statuses");
    const from = state.root.querySelector('[data-f="from"]');
    const to = state.root.querySelector('[data-f="to"]');
    const r = (ds && ds.range) || {};
    [from, to].forEach((inp) => { inp.min = r.from || ""; inp.max = r.to || ""; inp.disabled = !r.from; });
    from.value = state.filters.from || r.from || "";
    to.value = state.filters.to || r.to || "";
    state.root.querySelector('[data-fwrap="date"]').classList.toggle("is-active", !!(state.filters.from || state.filters.to));
    const chips = [];
    if (state.filters.purpose) chips.push(["purpose", "Purpose", state.filters.purpose]);
    el("chips").innerHTML = chips.map(([k, lab, v]) =>
      `<button type="button" class="gcc-fchip" data-act="clear-filter" data-key="${k}" title="Clear ${esc(lab)} filter"><small>${esc(lab)}</small>${esc(v)}<b>×</b></button>`).join("");
    el("reset").hidden = !filteredAny();
  }

  const filteredAny = () => Object.values(state.filters).some(Boolean);

  function filterSubtitle(extra) {
    const f = state.filters;
    const parts = [];
    const range = state.metrics ? state.metrics.range : {};
    if (f.from || f.to) parts.push(`${fmtDay(f.from || range.from, true)} – ${fmtDay(f.to || range.to, true)}`);
    ["promoter", "consultant", "model", "source", "status", "purpose"].forEach((k) => { if (f[k] && k !== extra) parts.push(f[k]); });
    return parts.length ? parts.join(" · ") : "Selected period · no filters";
  }

  // ---------- Compute (memoised in GecData.compute) ----------

  const computeWith = (filters) => Data().compute(state.dataset, filters, { visitors: state.visitors, orders: state.orders });

  /** Days with any record inside the global date filter (for the Daily view stepper). */
  function dataDays() {
    const m = state.metrics;
    if (!m) return [];
    const set = new Set();
    m.rows.forEach((r) => { if (r.day) set.add(r.day); });
    m.registeredRows.forEach((r) => { if (r.day) set.add(r.day); });
    m.visitorRows.forEach((v) => { if (v.day) set.add(v.day); });
    return [...set].sort();
  }
  const validDay = (d) => !!d && dataDays().includes(d);
  const defaultDay = () => { const days = dataDays(); return days[days.length - 1] || ""; };

  /** Metrics behind a performance panel: all promoters / advisors stay visible (the filtered one is highlighted). */
  function perfSource(kind) {
    const v = state.view[kind];
    const f = { ...state.filters, [kind === "promoter" ? "promoter" : "consultant"]: "" };
    if (v.mode === "daily") {
      if (!validDay(v.day)) v.day = defaultDay();
      if (v.day) { f.from = v.day; f.to = v.day; }
    }
    return computeWith(f);
  }

  // ---------- Render ----------

  function renderAll() {
    const t0 = performance.now();
    state.metrics = computeWith(state.filters);
    renderFilterControls();
    renderHeader();
    renderKpis();
    renderJourneys();
    renderTrend();
    renderCars();
    renderStatus();
    renderPerf("promoter");
    renderPerf("advisor");
    renderAttention();
    renderEmpty();
    el("debug-btn").hidden = !state.debug;
    if (state.debug) console.debug(`[GEC] render ${(performance.now() - t0).toFixed(1)} ms`);
  }

  function renderHeader() {
    const ds = state.dataset;
    const live = el("live");
    live.classList.toggle("is-off", !(ds && ds.ok));
    live.querySelector("b").textContent = ds && ds.ok ? "LIVE" : "NO DATA";
    const at = Number(state.ctx.lastUpdated) || 0;
    el("updated").textContent = at ? new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  }

  // Sparkline (SVG path) for KPI cards.
  function spark(values) {
    const vals = values.map((v) => (v == null || !Number.isFinite(v) ? null : v));
    const pts = vals.filter((v) => v != null);
    if (pts.length < 2) return "";
    const W = 100;
    const H = 32;
    const max = Math.max(...pts);
    const min = Math.min(0, ...pts);
    const span = max - min || 1;
    const step = W / (vals.length - 1);
    let d = "";
    let first = null;
    let last = null;
    vals.forEach((v, i) => {
      if (v == null) return;
      const x = (i * step).toFixed(1);
      const y = (H - 2 - ((v - min) / span) * (H - 6)).toFixed(1);
      d += `${d ? "L" : "M"}${x} ${y}`;
      if (first == null) first = x;
      last = x;
    });
    return `<path class="a" d="${d}L${last} ${H}L${first} ${H}Z"/><path class="l" d="${d}"/>`;
  }

  function tween(node, to, format) {
    const from = Number(node.dataset.num);
    node.dataset.num = String(to);
    cancelAnimationFrame(node._raf);
    if (!Number.isFinite(from) || from === to || !Number.isFinite(to)) { node.textContent = format(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 380);
      node.textContent = format(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) node._raf = requestAnimationFrame(step);
    };
    node._raf = requestAnimationFrame(step);
  }

  function kpiContent(key) {
    const m = state.metrics;
    const k = m.kpis;
    const days = Math.max(1, daysBetween(m.range.from, m.range.to));
    const link = (drillKey, text, extra) => `<span class="gcc-sublink${extra ? ` ${extra}` : ""}" role="button" tabindex="0" data-drill="kpi" data-key="${drillKey}" title="${esc(DRILL_TITLES[drillKey] || "")}">${text}</span>`;
    switch (key) {
      case "visitors":
        return m.hasVisitors
          ? { value: k.visitors, fmt: n, sub: `<b>${(k.visitors / days).toFixed(1)}</b> per day · column J` }
          : { na: true, sub: "No GEC file uploaded" };
      case "total":
        return { value: k.total, fmt: n, sub: `${link("knownPromoter", `<b>${n(k.knownPromoter)}</b>`)} assigned to an official promoter` };
      case "visitorToLead":
        if (!m.hasVisitors) return { na: true, sub: "Needs the GEC file" };
        if (k.visitorToLead == null) return { na: true, sub: m.purposeFilter ? "n/a · purpose applies to visitors only" : "n/a · model/source/status filter" };
        return { value: k.visitorToLead, fmt: (v) => pct(v), sub: `<b>${n(k.total)}</b> leads ÷ ${n(k.visitors)} visitors` };
      case "responded":
        return { value: k.responded, fmt: n, sub: `${k.noResponse ? link("noResponse", `<b>${n(k.noResponse)}</b> not responded ↗`, "is-alert") : "<b>0</b> not responded"} · ${pct(k.responseRate)} of ${n(k.total)} leads` };
      case "salesOrders":
        return { value: k.salesOrders, fmt: n, sub: `<b>${pct(k.salesOrderRate)}</b> · ${link("noOrder", `${n(k.noOrder)} NO ORDER`)} excluded` };
      case "converted":
        return { value: k.converted, fmt: n, sub: `<b>${pct(k.conversionRate)}</b> lead → conversion` };
      case "assignmentErrors":
        return {
          value: k.assignmentErrors, fmt: n, sub: `Employee Number (column ${empCol()}) blank`,
          side: `<span class="gcc-kpi-side${k.invalidPromoter ? " is-bad" : ""}" role="button" tabindex="0" data-drill="kpi" data-key="invalidPromoter" title="${esc(DRILL_TITLES.invalidPromoter)}"><small>Invalid promoter</small><b class="gcc-num">${n(k.invalidPromoter)}</b></span>`,
        };
      case "noProduct":
        return {
          value: k.noProduct, fmt: n, sub: `Column ${cfg().PRODUCT_COLUMNS.join(" or ")} blank`,
          side: `<span class="gcc-kpi-side" role="button" tabindex="0" data-drill="kpi" data-key="noProduct" title="${esc(DRILL_TITLES.noProduct)} · leads only"><small>Leads</small><b class="gcc-num">${n(k.noProductLeads)}</b></span>`,
        };
      default:
        return { na: true, sub: "" };
    }
  }

  function sparkSeries(key) {
    const b = state.metrics.trend.buckets;
    if (key === "visitors") return state.metrics.hasVisitors ? b.map((x) => x.visitors) : [];
    if (key === "v2l") return state.metrics.hasVisitors ? b.map((x) => (x.visitors ? x.leads / x.visitors : null)) : [];
    return b.map((x) => x[key]);
  }

  function renderKpis() {
    const box = el("kpis");
    if (box.childElementCount !== KPI_DEFS.length) {
      box.innerHTML = KPI_DEFS.map((d) => `
        <div class="gcc-kpi t-${d.tone}" role="button" tabindex="0" data-drill="kpi" data-key="${d.key}" data-kpi="${d.key}">
          <div class="gcc-kpi-top"><span class="gcc-kpi-ic">${icon(d.icon)}</span><span class="gcc-kpi-lab">${esc(d.label)}</span></div>
          <div class="gcc-kpi-mid"><span class="gcc-kpi-val gcc-num" data-v>—</span>${d.side ? "<span data-side></span>" : '<svg class="gcc-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" data-spark></svg>'}</div>
          <div class="gcc-kpi-sub" data-sub></div>
        </div>`).join("");
    }
    KPI_DEFS.forEach((d) => {
      const card = box.querySelector(`[data-kpi="${d.key}"]`);
      const c = kpiContent(d.key);
      const v = card.querySelector("[data-v]");
      card.classList.toggle("is-na", !!c.na);
      if (c.na) { cancelAnimationFrame(v._raf); v.textContent = "—"; delete v.dataset.num; } else tween(v, c.value, c.fmt);
      card.querySelector("[data-sub]").innerHTML = c.sub;
      if (d.side) card.querySelector("[data-side]").innerHTML = c.side || "";
      else card.querySelector("[data-spark]").innerHTML = c.na ? "" : spark(sparkSeries(d.spark));
      card.title = `Open ${d.key === "visitors" ? "visitor records" : d.key === "visitorToLead" ? "Visitor → Lead by promoter and day" : DRILL_TITLES[d.key] || "records"}`;
    });
  }

  // ---------- Journeys ----------

  function stageHtml(s, base) {
    const share = s.na ? 0 : ratio(s.value || 0, base || 0);
    return `<button type="button" class="gcc-stage t-${s.tone}${s.na ? " is-na" : ""}" data-drill="kpi" data-key="${s.key}" title="${esc(s.title || `Open ${s.label}`)}">
      <span class="gcc-stage-lab">${esc(s.label)}</span>
      <span class="gcc-stage-val gcc-num">${s.na ? "—" : n(s.value)}</span>
      <span class="gcc-stage-meta">${s.meta || ""}</span>
      <span class="gcc-stage-bar"><i style="--w:${w100(share)}"></i></span>
    </button>`;
  }
  const stepHtml = (value, label, tone) => `<div class="gcc-step t-${tone || "slate"}"><span class="gcc-step-pct gcc-num">${value}</span><span class="gcc-step-arrow">${icon("right")}</span><small>${esc(label)}</small></div>`;

  function renderJourneys() {
    const m = state.metrics;
    const k = m.kpis;
    const hv = m.hasVisitors;
    const vBase = hv ? k.visitors : k.total;
    const reg = k.registeredNotLead;
    el("vj").innerHTML = `
      <div class="gcc-card-head">
        <h2><span class="gcc-h-ic t-violet">${icon("route")}</span>Visitor Journey <small>visitors → registered leads → converted</small></h2>
        <span class="gcc-badge t-violet" title="Converted ÷ visitors">Visitor → Conversion <b class="gcc-num">${pct(k.visitorToConversion)}</b></span>
      </div>
      <div class="gcc-flow is-3">
        ${stageHtml({ key: "visitors", label: "Visitors", value: k.visitors, tone: "violet", na: !hv, meta: hv ? "column J · selected dates" : "no GEC file", title: "Open visitor records" }, vBase)}
        ${stepHtml(pct(k.visitorToLead), "Visitor → Lead", "indigo")}
        ${stageHtml({ key: "total", label: "Registered Leads", value: k.total, tone: "blue", meta: hv && k.visitorToLead != null ? `${pct(k.visitorToLead)} of visitors` : "unique Transaction No." }, vBase)}
        ${stepHtml(pct(k.conversionRate), "Lead → Conversion", "green")}
        ${stageHtml({ key: "converted", label: "Converted", value: k.converted, tone: "green", meta: hv && k.visitorToConversion != null ? `${pct(k.visitorToConversion)} of visitors` : `${pct(k.conversionRate)} of leads` }, vBase)}
      </div>
      <div class="gcc-journey-foot">${reg
        ? `<button type="button" class="gcc-note-btn" data-act="registered" title="Records whose status is a GEC CONTROL visitor status">${icon("info")}<b class="gcc-num">${n(reg)}</b> registered (${esc(Data().enabledStatuses("visitor").join(" · ") || "visitor statuses")}) · not yet leads</button>`
        : `<span class="gcc-muted">${hv ? "Visitors are every transaction whose column J date is in the selected period" : "Upload the GEC file in Admin Push to track visitors"}</span>`}</div>`;

    el("lj").innerHTML = `
      <div class="gcc-card-head">
        <h2><span class="gcc-h-ic t-blue">${icon("funnel")}</span>Lead Journey <small>leads → sales response → sales orders → converted</small></h2>
        <span class="gcc-badge t-green" title="Converted ÷ leads">Lead → Conversion <b class="gcc-num">${pct(k.conversionRate)}</b></span>
      </div>
      <div class="gcc-flow is-4">
        ${stageHtml({ key: "total", label: "Leads", value: k.total, tone: "blue", meta: "100% of leads" }, k.total)}
        ${stepHtml("", "", "slate")}
        ${stageHtml({ key: "responded", label: "Meet Sales Advisor", value: k.responded, tone: "cyan", meta: `<b>${pct(k.responseRate)}</b> of leads` }, k.total)}
        ${stepHtml("", "", "slate")}
        ${stageHtml({ key: "salesOrders", label: "Sales Orders", value: k.salesOrders, tone: "amber", meta: `<b>${pct(k.salesOrderRate)}</b> of leads` }, k.total)}
        ${stepHtml("", "", "slate")}
        ${stageHtml({ key: "converted", label: "Converted", value: k.converted, tone: "green", meta: `<b>${pct(k.conversionRate)}</b> of leads` }, k.total)}
      </div>
      <div class="gcc-journey-foot">
        <span class="gcc-sublink" role="button" tabindex="0" data-drill="kpi" data-key="noResponse">${n(k.noResponse)} without response</span>
        <span class="gcc-dot-sep"></span>
        <span class="gcc-sublink" role="button" tabindex="0" data-drill="kpi" data-key="noOrder">${n(k.noOrder)} NO ORDER — not counted as orders</span>
      </div>`;
  }

  // ---------- Trend ----------

  const SERIES = [
    { key: "visitors", label: "Visitors", type: "bar", color: "#8b5cf6", fill: "rgba(139, 92, 246, 0.22)", hover: "rgba(139, 92, 246, 0.4)" },
    { key: "leads", label: "Leads", type: "bar", color: "#3b82f6", fill: "rgba(59, 130, 246, 0.55)", hover: "rgba(59, 130, 246, 0.75)" },
    { key: "salesOrders", label: "Sales Orders", type: "line", color: "#f59e0b" },
    { key: "converted", label: "Converted", type: "line", color: "#10b981" },
  ];

  function renderTrend() {
    const canvas = el("chart");
    const m = state.metrics;
    const { unit, buckets, undated } = m.trend;
    el("trend-sub").textContent = `${unit === "week" ? "weekly" : "daily"} · click a ${unit === "week" ? "week" : "day"} for records${undated ? ` · ${n(undated)} undated not plotted` : ""}`;
    const shown = SERIES.filter((s) => s.key !== "visitors" || m.hasVisitors);
    el("legend").innerHTML = shown.map((s) => `<span class="${s.type === "line" ? "is-line" : ""}"><i style="--c:${s.color}"></i>${s.label}</span>`).join("");
    if (typeof global.Chart === "undefined") return;
    const labels = buckets.map((b) => (unit === "week" ? `Wk ${fmtDay(b.key)}` : fmtDay(b.key)));
    const dense = buckets.length > 40;
    const dataFor = (s) => (s.key === "visitors" && !m.hasVisitors ? [] : buckets.map((b) => b[s.key] || 0));
    if (state.chart && state.chart.canvas === canvas) {
      state.chart.data.labels = labels;
      state.chart.data.datasets.forEach((ds, i) => {
        ds.data = dataFor(SERIES[i]);
        ds.hidden = SERIES[i].key === "visitors" && !m.hasVisitors;
        if (ds.type === "line") ds.pointRadius = dense ? 0 : 2.5;
      });
      state.chart.update();
      return;
    }
    if (state.chart) state.chart.destroy();
    state.chart = new global.Chart(canvas.getContext("2d"), {
      data: {
        labels,
        datasets: SERIES.map((s, i) => (s.type === "bar"
          ? { type: "bar", label: s.label, data: dataFor(s), hidden: s.key === "visitors" && !m.hasVisitors, order: 10 + i,
            backgroundColor: s.fill, hoverBackgroundColor: s.hover, borderRadius: 4, borderSkipped: false, barPercentage: 0.86, categoryPercentage: 0.78 }
          : { type: "line", label: s.label, data: dataFor(s), order: i, borderColor: s.color, backgroundColor: s.color, borderWidth: 2.4,
            cubicInterpolationMode: "monotone", pointRadius: dense ? 0 : 2.5, pointHoverRadius: 5, pointBackgroundColor: "#fff", pointBorderWidth: 2 })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 320 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 6, right: 6, left: 2 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.94)", titleColor: "#fff", bodyColor: "#e2e8f0", padding: 10, boxPadding: 4, usePointStyle: true, cornerRadius: 10,
            callbacks: {
              title: (items) => {
                const b = state.metrics.trend.buckets[items[0].dataIndex];
                if (!b) return "";
                return state.metrics.trend.unit === "week" ? `Week of ${fmtDay(b.key, true)}` : fmtDay(b.key, true);
              },
              footer: (items) => {
                const b = state.metrics.trend.buckets[items[0].dataIndex];
                if (!b) return "";
                const parts = [];
                if (b.visitors) parts.push(`V→L ${pct(b.leads / b.visitors)}`);
                if (b.leads) parts.push(`L→C ${pct(b.converted / b.leads)}`);
                return parts.length ? `${parts.join(" · ")} · click for records` : "";
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: "#e2e8f0" },
            ticks: { color: "#94a3b8", font: { size: 11, family: "Outfit" }, maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
          y: { beginAtZero: true, grid: { color: "rgba(148, 163, 184, 0.16)" }, border: { display: false },
            ticks: { color: "#94a3b8", font: { size: 11, family: "Outfit" }, precision: 0, maxTicksLimit: 5 } },
        },
        onClick: (evt, _els, chart) => {
          const pts = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
          if (!pts.length) return;
          const b = state.metrics.trend.buckets[pts[0].index];
          if (b) openDay(b);
        },
        onHover: (evt, els) => {
          const t = evt.native && evt.native.target;
          if (t) t.style.cursor = els.length ? "pointer" : "default";
        },
      },
    });
  }

  // ---------- Visitor purpose · lead status ----------

  const BAR_LIMIT = 7;

  // Draw as many bars as fit (no half rows, no scroll); the rest sit behind the “more” link.
  function fitBars(box, draw) {
    let limit = BAR_LIMIT;
    draw(limit);
    while (limit > 1 && box.scrollHeight > box.clientHeight + 1) draw(--limit);
  }

  // ---------- Top cars · converted → Sales Raw / Back Order status ----------

  /** optional → only shown when it has records. color mirrors the .s-<key> rules in gec-control.css. */
  const ORDER_STATES = [
    { key: "delivered", label: "Delivered", color: "#059669", rule: "Sales Raw · Col V has a date" },
    { key: "proforma", label: "Pro-Forma", color: "#2563eb", rule: "Sales Raw · Col P has a date, Col V blank" },
    { key: "backorder", label: "In BO file", color: "#d97706", rule: "Not in Sales Raw · found in the Back Order file" },
    { key: "salesNoDate", label: "Sales Raw · no P/V date", color: "#7c3aed", rule: "In Sales Raw but Col P and Col V are both blank", optional: true },
    { key: "notFound", label: "Not found", color: "#cbd5e1", rule: "In neither Sales Raw nor the Back Order file", optional: true },
  ];
  const ORDER_LABEL = Object.fromEntries(ORDER_STATES.map((s) => [s.key, s.label]));
  const orderOf = (r) => Data().orderStatus(r, state.orders);
  const orderStateOf = (r) => { const o = orderOf(r); return o ? o.status : ""; };
  const shownStates = (count) => ORDER_STATES.filter((s) => !s.optional || count(s.key));

  function carTotals(list) {
    const t = { leads: 0, converted: 0, ...Object.fromEntries(ORDER_STATES.map((s) => [s.key, 0])) };
    list.forEach((c) => Object.keys(t).forEach((k) => { t[k] += c[k] || 0; }));
    return t;
  }

  function carTitle(c, hasOrders) {
    const split = hasOrders ? ` · ${shownStates((k) => c[k]).map((s) => `${s.label} ${n(c[s.key])}`).join(" · ")}` : "";
    return `${c.name} · ${n(c.converted)} converted of ${n(c.leads)} leads${split} · open records`;
  }

  function renderCars() {
    const m = state.metrics;
    const box = el("cars");
    const sum = el("car-sum");
    const list = m.cars.filter((c) => c.converted > 0);
    const t = carTotals(list);
    sum.innerHTML = !m.hasOrders
      ? `<span class="gcc-muted">Push <b>Sales Raw Data</b> / <b>Back Order</b> to see Pro-Forma &amp; Delivered</span>`
      : shownStates((k) => t[k]).map((s) =>
        `<button type="button" class="gcc-car-chip s-${s.key}" data-act="car-state" data-state="${s.key}" title="Converted leads · ${esc(s.label)} · open records"><i></i>${esc(s.label)} <b class="gcc-num">${n(t[s.key])}</b></button>`).join("");
    if (!m.kpis.total) { box.innerHTML = `<div class="gcc-empty-note"><span>No leads in this selection.</span></div>`; return; }
    if (!list.length) { box.innerHTML = `<div class="gcc-empty-note">${icon("car")}<span>No converted leads in this selection.</span></div>`; return; }
    const sel = state.filters.model;
    fitBars(box, (limit) => {
      let shown = list.slice(0, limit);
      if (sel && !shown.some((c) => c.name === sel)) { const s = list.find((c) => c.name === sel); if (s) shown = [...shown.slice(0, limit - 1), s]; }
      const max = Math.max(1, ...shown.map((c) => c.converted));
      const rest = list.length - shown.length;
      box.innerHTML = shown.map((c) => {
        const segs = m.hasOrders
          ? ORDER_STATES.map((s) => (c[s.key] ? `<i class="s-${s.key}" style="flex:${c[s.key]}"></i>` : "")).join("")
          : `<i class="s-converted" style="flex:1"></i>`;
        const split = m.hasOrders
          ? `<b class="s-proforma">${n(c.proforma)}</b> PF · <b class="s-delivered">${n(c.delivered)}</b> Del`
          : `${n(c.leads)} leads`;
        return `
        <button type="button" class="gcc-bar gcc-car t-green${sel === c.name ? " is-on" : ""}${sel && sel !== c.name ? " is-dim" : ""}" data-drill="car" data-name="${esc(c.name)}" title="${esc(carTitle(c, m.hasOrders))}">
          <span class="gcc-bar-lab" dir="auto">${esc(c.name)}</span>
          <span class="gcc-car-split gcc-num">${split}</span>
          <span class="gcc-bar-val gcc-num">${n(c.converted)}</span>
          <span class="gcc-car-track"><span style="--w:${w100(c.converted / max)}">${segs}</span></span>
        </button>`;
      }).join("") + (rest > 0 ? `<button type="button" class="gcc-link gcc-bars-more" data-act="cars-all">+ ${n(rest)} more cars ↗</button>` : "");
    });
  }

  const KIND_LABEL = { lead: "Lead status", conversion: "Conversion status", unlisted: "Not in GEC CONTROL", other: "Classified as lead" };

  function renderStatus() {
    const m = state.metrics;
    const box = el("status");
    const list = m.leadStatus.filter((s) => s.count > 0 || s.kind !== "other");
    el("status-note").innerHTML = `<i class="k-lead"></i>Lead <i class="k-conversion"></i>Conversion${m.kpis.unlisted ? ' <i class="k-unlisted"></i>Unlisted' : ""}`;
    if (!m.kpis.total) { box.innerHTML = `<div class="gcc-empty-note"><span>No leads in this selection.</span></div>`; return; }
    fitBars(box, (limit) => {
      const shown = list.slice(0, limit);
      const max = Math.max(1, ...shown.map((s) => s.count));
      const rest = list.slice(limit).reduce((s, x) => s + x.count, 0);
      box.innerHTML = shown.map((s) => `
        <button type="button" class="gcc-bar k-${s.kind}${s.count ? "" : " is-zero"}" data-drill="status" data-key="${esc(s.key)}" title="${esc(`${s.status} · ${KIND_LABEL[s.kind]} · open records`)}">
          <span class="gcc-bar-lab" dir="auto"><i></i>${esc(s.status)}</span>
          <span class="gcc-bar-val gcc-num">${n(s.count)}</span>
          <span class="gcc-bar-pct gcc-num">${pct(s.share)}</span>
          <span class="gcc-bar-track"><i style="--w:${w100(s.count / max)}"></i></span>
        </button>`).join("") + (list.length > limit ? `<button type="button" class="gcc-link gcc-bars-more" data-drill="kpi" data-key="total">+ ${n(list.length - limit)} more statuses · ${n(rest)} leads ↗</button>` : "");
    });
  }

  // ---------- Promoter / advisor performance ----------

  function perfTools(kind) {
    const v = state.view[kind];
    const ranks = kind === "promoter"
      ? [["leads", "Leads"], ...(state.metrics.hasVisitors ? [["visitors", "Visitors"]] : []), ["converted", "Converted"]]
      : [["leads", "Leads"], ["responded", "Response"], ["converted", "Converted"]];
    if (!ranks.some(([r]) => r === v.rank)) v.rank = "leads";
    const seg = (items, act, cur) => `<div class="gcc-seg" role="group">${items.map(([val, lab]) =>
      `<button type="button" class="${val === cur ? "is-on" : ""}" data-act="${act}" data-panel="${kind}" data-${act === "rank" ? "rank" : "mode"}="${val}">${lab}</button>`).join("")}</div>`;
    const days = dataDays();
    const i = days.indexOf(v.day);
    const stepper = v.mode === "daily" ? `<div class="gcc-day">
        <button type="button" data-act="day" data-panel="${kind}" data-step="-1" ${i <= 0 ? "disabled" : ""} aria-label="Previous day">${icon("left")}</button>
        <span class="gcc-num">${v.day ? fmtDay(v.day, true) : "—"}</span>
        <button type="button" data-act="day" data-panel="${kind}" data-step="1" ${i < 0 || i >= days.length - 1 ? "disabled" : ""} aria-label="Next day">${icon("right")}</button>
      </div>` : "";
    return `<span class="gcc-tools-lab">Rank by</span>${seg(ranks, "rank", v.rank)}${stepper}${seg([["daily", "Daily"], ["period", "Period"]], "mode", v.mode)}`;
  }

  function rankList(list, rank, tie) {
    return list.slice().sort((a, b) => (b[rank] || 0) - (a[rank] || 0) || tie.reduce((s, key) => s || (b[key] || 0) - (a[key] || 0), 0) || a.name.localeCompare(b.name));
  }

  const whenLabel = (kind) => { const v = state.view[kind]; return v.mode === "daily" ? (v.day ? fmtDay(v.day, true) : "No day") : "Selected period"; };

  function rateBar(label, value, tone) {
    return `<div class="gcc-rate t-${tone}"><span>${esc(label)}</span><b class="gcc-num">${pct(value)}</b><i><em style="--w:${w100(value)}"></em></i></div>`;
  }

  const cell = (kind, name, metric, text, label) =>
    `<span class="gcc-metric" role="button" tabindex="0" data-drill="cell" data-kind="${kind}" data-name="${esc(name)}" data-metric="${metric}" title="${esc(`${name} · ${METRIC_LABEL[metric] || metric} · open records`)}"><small>${esc(label)}</small><b class="gcc-num">${text}</b></span>`;

  function renderPerf(kind) {
    if (!state.metrics) return;
    el(`${kind}-tools`).innerHTML = perfTools(kind);
    if (kind === "promoter") renderPromoters(); else renderAdvisors();
  }

  function renderPromoters() {
    const box = el("promoter");
    const v = state.view.promoter;
    const src = perfSource("promoter");
    const hasV = src.hasVisitors;
    const list = rankList(src.promoters, v.rank, ["leads", "converted", "visitors"]);
    const sel = state.filters.promoter;
    const blankR = src.kpis.assignmentErrors;
    const invalidR = src.kpis.invalidPromoter;
    const any = list.some((p) => p.leads || p.visitors);
    if (!any) {
      box.innerHTML = `<div class="gcc-empty-note">${icon("users")}<b>No promoter activity</b><span>${esc(whenLabel("promoter"))} · no visitors or leads for the official promoters.</span></div>`;
      return;
    }
    const top = list[0];
    const rankLab = { leads: "leads", visitors: "visitors", converted: "conversions" }[v.rank];
    const hero = `
      <div class="gcc-hero is-promoter${sel && sel !== top.name ? " is-dim" : ""}" role="button" tabindex="0" data-drill="promoter" data-name="${esc(top.name)}" title="Open ${esc(top.name)}">
        <div class="gcc-hero-top"><span class="gcc-hero-rank">${icon("crown")} #1 · Top promoter</span><span class="gcc-hero-when">${esc(whenLabel("promoter"))}</span></div>
        <div class="gcc-hero-id">
          <span class="gcc-avatar is-xl">${esc(initials(top.name))}</span>
          <div><strong>${esc(top.name)}</strong><small>Emp. ${esc(empOf(top.name))} · most ${rankLab}</small></div>
        </div>
        <div class="gcc-hero-stats">
          ${hasV ? cell("promoter", top.name, "visitors", n(top.visitors), "Visitors") : `<span class="gcc-metric is-na"><small>Visitors</small><b>—</b></span>`}
          ${cell("promoter", top.name, "leads", n(top.leads), "Leads")}
          ${cell("promoter", top.name, "converted", n(top.converted), "Converted")}
        </div>
        <div class="gcc-hero-rates">${rateBar("Visitor → Lead", top.visitorToLead, "light")}${rateBar("Lead → Conversion", top.leadToConversion, "light")}</div>
      </div>`;
    const rows = list.slice(1).map((p, i) => `
      <div class="gcc-prow${sel === p.name ? " is-selected" : ""}${sel && sel !== p.name ? " is-dim" : ""}" role="button" tabindex="0" data-drill="promoter" data-name="${esc(p.name)}" title="Open ${esc(p.name)}">
        <span class="gcc-prow-rank gcc-num">${i + 2}</span>
        <span class="gcc-avatar t-${["blue", "cyan", "amber", "rose"][i % 4]}">${esc(initials(p.name))}</span>
        <span class="gcc-prow-name"><b>${esc(p.name)}</b><small>${esc(empOf(p.name))}</small></span>
        ${hasV ? cell("promoter", p.name, "visitors", n(p.visitors), "Visitors") : `<span class="gcc-metric is-na"><small>Visitors</small><b>—</b></span>`}
        ${cell("promoter", p.name, "leads", n(p.leads), "Leads")}
        ${cell("promoter", p.name, "converted", n(p.converted), "Conv.")}
        <span class="gcc-prow-rates">${rateBar("V→L", p.visitorToLead, "violet")}${rateBar("L→C", p.leadToConversion, "green")}</span>
      </div>`).join("");
    box.innerHTML = `<div class="gcc-perf-grid">${hero}<div class="gcc-perf-list">
        <div class="gcc-prow-head" aria-hidden="true"><span></span><span>Promoter</span><span>Visitors</span><span>Leads</span><span>Conv.</span><span>V→L · L→C</span></div>
        <div class="gcc-rows">${rows}</div>
        <div class="gcc-perf-foot">
          <span class="gcc-foot-notes">
            ${blankR ? `<span class="gcc-warn-chip" role="button" tabindex="0" data-drill="kpi" data-key="assignmentErrors" title="${esc(DRILL_TITLES.assignmentErrors)} — not in any promoter's performance">${icon("alert")}<b class="gcc-num">${n(blankR)}</b> No promoter assigned</span>` : ""}
            ${invalidR ? `<span class="gcc-warn-chip" role="button" tabindex="0" data-drill="kpi" data-key="invalidPromoter" title="${esc(DRILL_TITLES.invalidPromoter)} — not in any promoter's performance">${icon("alert")}<b class="gcc-num">${n(invalidR)}</b> Invalid Promoter</span>` : ""}
            ${blankR || invalidR ? `<span class="gcc-muted">not ranked</span>` : `<span class="gcc-muted">Every lead has an official promoter (Employee Number · column ${empCol()})</span>`}
          </span>
          <button type="button" class="gcc-link" data-act="rank-all" data-kind="promoter">Full table ↗</button>
        </div>
      </div></div>`;
  }

  function renderAdvisors() {
    const box = el("advisor");
    const v = state.view.advisor;
    const src = perfSource("advisor");
    if (!src.hasConsultant) {
      box.innerHTML = `<div class="gcc-empty-note">${icon("star")}<b>No sales advisor column</b><span>The GEC File has no “Assigned To” / consultant column.</span></div>`;
      return;
    }
    const list = rankList(src.consultants, v.rank, ["leads", "converted", "responded"]);
    const sel = state.filters.consultant;
    if (!list.length) {
      box.innerHTML = `<div class="gcc-empty-note">${icon("star")}<b>No advisor leads</b><span>${esc(whenLabel("advisor"))} · no leads assigned to sales advisors.</span></div>`;
      return;
    }
    const top = list[0];
    const rankLab = { leads: "leads received", responded: "sales responses", converted: "conversions" }[v.rank];
    const hero = `
      <div class="gcc-hero is-advisor${sel && sel !== top.name ? " is-dim" : ""}" role="button" tabindex="0" data-drill="advisor" data-name="${esc(top.name)}" title="Open ${esc(top.name)}">
        <div class="gcc-hero-top"><span class="gcc-hero-rank">${icon("star")} #1 · Top sales advisor</span><span class="gcc-hero-when">${esc(whenLabel("advisor"))}</span></div>
        <div class="gcc-hero-id">
          <span class="gcc-avatar is-xl">${esc(initials(top.name))}</span>
          <div><strong dir="auto">${esc(top.name)}</strong><small>Most ${rankLab}</small></div>
        </div>
        <div class="gcc-hero-stats is-4">
          ${cell("advisor", top.name, "leads", n(top.leads), "Leads")}
          ${cell("advisor", top.name, "responded", n(top.responded), "Response")}
          ${cell("advisor", top.name, "salesOrders", n(top.salesOrders), "Orders")}
          ${cell("advisor", top.name, "converted", n(top.converted), "Converted")}
        </div>
        <div class="gcc-hero-rates">${rateBar("Response %", top.responseRate, "light")}${rateBar("Conversion %", top.conversionRate, "light")}</div>
      </div>`;
    const rowHtml = (c) => `
      <div class="gcc-arow${sel === c.name ? " is-selected" : ""}${sel && sel !== c.name ? " is-dim" : ""}" role="button" tabindex="0" data-drill="advisor" data-name="${esc(c.name)}" title="Open ${esc(c.name)}">
        <span class="gcc-prow-rank gcc-num">${list.indexOf(c) + 1}</span>
        <span class="gcc-arow-name" dir="auto">${esc(c.name)}</span>
        ${cell("advisor", c.name, "leads", n(c.leads), "Leads")}
        ${cell("advisor", c.name, "responded", n(c.responded), "Resp.")}
        <span class="gcc-metric is-rate"><small>Resp %</small><b class="gcc-num">${pct(c.responseRate)}</b></span>
        ${cell("advisor", c.name, "salesOrders", n(c.salesOrders), "Orders")}
        ${cell("advisor", c.name, "converted", n(c.converted), "Conv.")}
        <span class="gcc-metric is-rate${c.conversionRate != null && c.conversionRate >= (src.kpis.conversionRate || 0) ? " is-good" : ""}"><small>Conv %</small><b class="gcc-num">${pct(c.conversionRate)}</b></span>
      </div>`;
    const others = list.slice(1);
    const un = src.kpis.noAdvisor || 0;
    const pc = src.kpis.promoterConsultant || 0;
    box.innerHTML = `<div class="gcc-perf-grid">${hero}<div class="gcc-perf-list">
        <div class="gcc-arow-head" aria-hidden="true"><span></span><span>Advisor</span><span>Leads</span><span>Resp.</span><span>Resp %</span><span>Orders</span><span>Conv.</span><span>Conv %</span></div>
        <div class="gcc-rows is-advisor" data-el="advisor-rows">${others.slice(0, 12).map(rowHtml).join("")}</div>
        <div class="gcc-perf-foot">
          <span class="gcc-foot-notes">
            ${un ? `<span class="gcc-sublink" role="button" tabindex="0" data-drill="kpi" data-key="noAdvisor" title="Assigned To is blank">${n(un)} no advisor</span>` : ""}
            ${pc ? `<span class="gcc-sublink" role="button" tabindex="0" data-drill="kpi" data-key="promoterConsultant" title="Assigned to a promoter — excluded from advisor ranking">${n(pc)} assigned to promoters</span>` : ""}
            ${src.kpis.registeredNotLead ? `<span class="gcc-muted" title="Visitor-stage records are not leads">${n(src.kpis.registeredNotLead)} ${esc(Data().enabledStatuses("visitor").join("/") || "visitor-stage")} excluded</span>` : ""}
          </span>
          <button type="button" class="gcc-link" data-act="rank-all" data-kind="advisor">All ${n(list.length)} advisors ↗</button>
        </div>
      </div></div>`;
    // Keep only the rows that fit (no half rows, no scroll).
    const rowsEl = box.querySelector('[data-el="advisor-rows"]');
    const kids = rowsEl.children;
    if (kids.length) {
      const avail = rowsEl.clientHeight;
      const gap = parseFloat(getComputedStyle(rowsEl).rowGap) || 0;
      const rowH = kids[0].offsetHeight + gap;
      const fit = Math.max(1, Math.floor((avail + gap) / rowH));
      let shown = others.slice(0, fit);
      if (sel && sel !== top.name && !shown.some((c) => c.name === sel)) {
        const s = others.find((c) => c.name === sel);
        if (s) shown = [...shown.slice(0, fit - 1), s];
      }
      if (shown.length !== kids.length || shown.some((c, i) => others[i] !== c)) rowsEl.innerHTML = shown.map(rowHtml).join("");
    }
  }

  // ---------- Attention ----------

  function renderAttention() {
    const m = state.metrics;
    const k = m.kpis;
    const ds = state.dataset;
    const q = ds && ds.quality;
    const items = [];
    const chip = (tone, count, label, attrs, title) => items.push(`<button type="button" class="gcc-att t-${tone}" ${attrs} title="${esc(title || label)}"><b class="gcc-num">${n(count)}</b>${esc(label)}</button>`);
    if (ds && ds.ok) {
      if (k.assignmentErrors) chip("rose", k.assignmentErrors, "No promoter assigned", 'data-drill="kpi" data-key="assignmentErrors"', DRILL_TITLES.assignmentErrors);
      if (k.noProduct) chip("rose", k.noProduct, "No product", 'data-drill="kpi" data-key="noProduct"', DRILL_TITLES.noProduct);
      if (k.invalidPromoter) chip("amber", k.invalidPromoter, "Invalid Promoter", 'data-drill="kpi" data-key="invalidPromoter"', DRILL_TITLES.invalidPromoter);
      if (k.noOrder) chip("rose", k.noOrder, "NO ORDER", 'data-drill="kpi" data-key="noOrder"', "Sales Order = “NO ORDER” — never counted as an order");
      if (k.unlisted) {
        const names = m.unlistedStatuses.slice(0, 3).map((s) => `${s.status} ${s.count}`).join(" · ");
        chip("amber", k.unlisted, `Unlisted status (${names}${m.unlistedStatuses.length > 3 ? " …" : ""})`, 'data-act="unlisted"', "Status not in any GEC CONTROL list — counted as a lead. Classify it in Admin → GEC CONTROL.");
      }
      if (k.noAdvisor) chip("amber", k.noAdvisor, "No sales advisor", 'data-drill="kpi" data-key="noAdvisor"', "Assigned To is blank");
      if (k.promoterConsultant) chip("slate", k.promoterConsultant, "Assigned to a promoter", 'data-drill="kpi" data-key="promoterConsultant"', "Excluded from Sales Advisor Performance");
      if (k.visitorUnknownPromoter) chip("amber", k.visitorUnknownPromoter, "Visitors · unknown promoter", 'data-drill="kpi" data-key="visitorsUnknown"');
      if (q && q.duplicateRows) chip("slate", q.duplicateRows, "Duplicate rows merged", 'data-drill="quality"', `${q.duplicateTransactions} transactions repeated — latest row kept, counted once`);
      if (q && q.missingTxn) chip("rose", q.missingTxn, "Rows without Transaction No.", 'data-drill="quality"');
      if (q && q.undated) chip("slate", q.undated, "Undated", 'data-drill="quality"');
      if (!m.hasVisitors) items.push(`<span class="gcc-att t-slate is-static">${icon("info")}No GEC file — Visitor → Lead unavailable</span>`);
    }
    const summary = ds && ds.ok
      ? `<span class="gcc-att-meta">${n(m.rows.length)} leads${m.registeredRows.length ? ` · ${n(m.registeredRows.length)} registered` : ""} of ${n(m.totalAll)} transactions${filteredAny() ? " · filtered" : ""}</span>`
      : "";
    el("attention").innerHTML = `<span class="gcc-att-title">${icon("alert")}Attention</span>
      <div class="gcc-att-list">${items.length ? items.join("") : `<span class="gcc-att t-green is-static">${icon("check")}No data-quality issues</span>`}</div>${summary}`;
  }

  function renderEmpty() {
    const box = el("empty");
    const ds = state.dataset;
    if (ds && ds.ok) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = ds
      ? `<div class="gcc-empty-card">${icon("alert")}<strong>GEC File could not be read</strong><p>${esc(ds.warnings[0] || "No lead rows found.")}</p><button type="button" class="gcc-btn" data-act="info">See detected sheets & columns</button></div>`
      : `<div class="gcc-empty-card">${icon("db")}<strong>No GEC File pushed yet</strong><p>Open <b>Admin Push</b>, upload the <b>GEC File</b> (Lead Data sheet) and optionally <b>GEC Visitors</b>, then click <b>Push to live</b>.</p></div>`;
  }

  // ---------- Modal engine (tabs · search · the only scrolling surface) ----------

  const stagePill = (r) => `<span class="gcc-pill st-${r.stage || "lead"}">${esc(STAGE_LABEL[r.stage] || "Lead")}</span>`;
  /** Current Sales Raw / Back Order status; unmatched non-converted leads stay blank. */
  const nowText = (r) => { const s = orderStateOf(r); return !s || (s === "notFound" && !r.converted) ? "" : ORDER_LABEL[s]; };

  const errorsOf = (r) => [
    r.assignment === "blank" ? Data().ASSIGNMENT_ERROR : r.assignment === "invalid" ? Data().INVALID_PROMOTER : "",
    r.noProduct ? Data().NO_PRODUCT : "",
  ].filter(Boolean);

  function productColumns() {
    return ((state.dataset && state.dataset.productColumns) || []).map((p, i) => ({
      h: `${p.header || "Column"} (${p.letter})`, dir: true, v: (r) => (r.product && r.product[i]) || "",
      html: (r) => (r.product && r.product[i] ? esc(r.product[i]) : '<span class="gcc-flag">blank</span>'),
    }));
  }

  function leadColumns(rows, withProduct) {
    const cols = [
      { h: "Transaction No.", v: (r) => r.id },
      { h: "Errors", v: (r) => errorsOf(r).join(" · "), html: (r) => errorsOf(r).map((e) => `<span class="gcc-pill st-error">${esc(e)}</span>`).join(" ") },
      ...(withProduct ? productColumns() : []),
      { h: "Lead date", v: (r) => fmtDate(r.leadDate, true) },
      { h: "Promoter", v: (r) => r.promoter },
      { h: `Emp. No. (${empCol()})`, v: (r) => r.employeeNumber, num: true },
      { h: "Sales advisor", v: (r) => r.consultant, dir: true },
      { h: "Model", v: (r) => r.modelGroup, dir: true },
      { h: "Source", v: (r) => (r.source === "(blank)" ? "" : r.source) },
      { h: "Status", v: (r) => r.status },
      { h: "Stage", v: (r) => STAGE_LABEL[r.stage] || "", html: stagePill },
      { h: "Sales Response", v: (r) => (r.responded ? r.salesResponse : "Not responded"), dir: true,
        html: (r) => (r.responded ? esc(r.salesResponse)
          : `<span class="gcc-pill st-error">Not responded</span>${r.salesResponse ? ` <span class="gcc-muted-val">${esc(r.salesResponse)}</span>` : ""}`) },
      { h: "Sales Order", v: (r) => r.salesOrder,
        html: (r) => (r.salesOrderState === "order" ? `<span class="gcc-pill st-order">${esc(r.salesOrder)}</span>` : r.salesOrder ? `<span class="gcc-muted-val">${esc(r.salesOrder)}</span>` : "") },
      ...(state.orders && state.orders.ready ? [
        { h: "Now", v: nowText, html: (r) => { const t = nowText(r); return t ? `<span class="gcc-pill st-${orderStateOf(r)}">${esc(t)}</span>` : ""; } },
        { h: "Matched in", v: (r) => { const o = orderOf(r); return o && o.source ? `${o.sourceLabel} · ${o.via}` : ""; } },
        { h: "Pro-forma date", v: (r) => { const o = orderOf(r); return o ? fmtDate(o.proformaDate) : ""; } },
        { h: "Delivery date", v: (r) => { const o = orderOf(r); return o ? fmtDate(o.deliveryDate) : ""; } },
        { h: "BO No.", v: (r) => { const o = orderOf(r); return o ? o.boNumber : ""; } },
        { h: "BO / sales status", v: (r) => { const o = orderOf(r); return o ? o.sourceStatus : ""; }, dir: true },
      ] : []),
      cfg().SHOW_TIMING ? { h: "Response", v: (r) => minutesText(r.responseMinutes), num: true } : null,
      { h: "Customer", v: (r) => r.customer, dir: true },
      { h: "Rows", v: (r) => (r.rowCount > 1 ? String(r.rowCount) : ""), num: true },
    ].filter(Boolean);
    return cols.filter((c) => c.h === "Transaction No." || rows.some((r) => String(c.v(r) || "").trim() !== ""));
  }

  function rawColumns() {
    const headers = (state.dataset && state.dataset.headers) || [];
    return [
      { h: "Stage", v: (r) => STAGE_LABEL[r.stage] || "", html: stagePill },
      { h: "Excel row", v: (r) => String(r.rowNo), num: true },
      ...headers.map((h) => ({ h, v: (r) => String(r.raw[h] ?? ""), dir: true })),
    ];
  }

  const VISITOR_COLUMNS = [
    { h: "Date", v: (v) => fmtDay(v.day, true) },
    { h: "Promoter", v: (v) => v.promoter },
    { h: "Visit Purpose", v: (v) => v.purpose, dir: true },
    { h: "Visitors", v: (v) => String(v.count), num: true },
    { h: "Excel row", v: (v) => String(v.rowNo), num: true },
  ];

  const leadView = (label, rows, withProduct) => ({ label, rows, type: "leads", withProduct: !!withProduct });
  const visitorView = (label, rows) => ({ label, rows, type: "visitors", columns: VISITOR_COLUMNS, countOf: (list) => list.reduce((s, v) => s + v.count, 0) });

  /**
   * @param o { title, sub, stats, views:[{label, rows, type:"leads"|"visitors"|"table", columns, onRow}], html, filterAction }
   */
  function openModal(o) {
    const m = state.modal;
    m.views = o.views || [];
    m.active = 0;
    m.search = "";
    m.allCols = false;
    m.filterAction = o.filterAction || null;
    el("m-title").textContent = o.title;
    el("m-sub").textContent = o.sub || "";
    el("m-search").value = "";
    el("m-allcols").checked = false;
    const fb = el("m-filter");
    fb.hidden = !m.filterAction;
    if (m.filterAction) fb.textContent = state.filters[m.filterAction.key] === m.filterAction.value ? "Clear dashboard filter" : "Filter dashboard";
    el("m-stats").innerHTML = (o.stats || []).map((s) => `<div class="gcc-mstat${s.cls ? ` ${s.cls}` : ""}"><small>${esc(s.label)}</small><b class="gcc-num">${s.value}</b></div>`).join("");
    el("modal").hidden = false;
    if (o.html != null) {
      el("m-tabs").innerHTML = "";
      el("m-search").hidden = true;
      el("m-allcols-wrap").hidden = true;
      el("m-body").innerHTML = o.html;
      el("m-foot").textContent = o.foot || "";
      return;
    }
    renderModalTable();
    setTimeout(() => el("m-search").focus(), 30);
  }

  function closeModal() {
    el("modal").hidden = true;
    state.modal.views = [];
    el("m-body").innerHTML = "";
  }

  const MODAL_MAX_ROWS = 2000;

  function renderModalTable() {
    const m = state.modal;
    const view = m.views[m.active];
    el("m-tabs").innerHTML = m.views.length > 1 ? m.views.map((v, i) => {
      const count = v.type === "html" ? null : v.countOf ? v.countOf(v.rows) : v.rows.length;
      return `<button type="button" class="${i === m.active ? "is-on" : ""}" data-act="modal-tab" data-tab="${i}">${esc(v.label)}${count == null ? "" : ` <b class="gcc-num">${n(count)}</b>`}</button>`;
    }).join("") : "";
    if (!view) { el("m-body").innerHTML = ""; el("m-foot").textContent = ""; return; }
    el("m-allcols-wrap").hidden = view.type !== "leads";
    el("m-search").hidden = view.type === "html";
    if (view.type === "html") { el("m-body").innerHTML = view.html; el("m-foot").textContent = view.foot || ""; return; }
    const cols = view.columns || (m.allCols ? rawColumns() : leadColumns(view.rows, view.withProduct));
    const q = m.search.trim().toLowerCase();
    const idx = view.rows.map((r, i) => i).filter((i) => !q || cols.some((c) => String(c.v(view.rows[i]) || "").toLowerCase().includes(q)));
    const shown = idx.slice(0, MODAL_MAX_ROWS);
    const clickable = !!view.onRow;
    el("m-body").innerHTML = view.rows.length ? `<table class="gcc-table"><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.h)}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((i) => {
        const r = view.rows[i];
        return `<tr${clickable ? ` class="is-click" data-row="${i}" tabindex="0"` : ""}>${cols.map((c) => {
          const text = String(c.v(r) ?? "");
          return `<td class="${c.num ? "num" : ""}"${c.dir ? ' dir="auto"' : ""} title="${esc(text)}">${c.html ? c.html(r) : esc(text)}</td>`;
        }).join("")}</tr>`;
      }).join("")}</tbody></table>` : `<div class="gcc-modal-empty">No records.</div>`;
    const unit = view.type === "visitors" ? "visitor rows" : view.type === "table" ? "rows" : "records";
    el("m-foot").textContent = idx.length > MODAL_MAX_ROWS
      ? `Showing first ${n(MODAL_MAX_ROWS)} of ${n(idx.length)} — refine with search`
      : `${n(idx.length)} ${unit}${view.countOf ? ` · ${n(view.countOf(idx.map((i) => view.rows[i])))} visitors` : ""}${q ? ` matching “${m.search}”` : ""}`;
  }

  function onModalRow(i) {
    const view = state.modal.views[state.modal.active];
    if (view && view.onRow) view.onRow(view.rows[i]);
  }

  function leadStats(rows) {
    const c = (p) => rows.reduce((s, r) => s + (p(r) ? 1 : 0), 0);
    const resp = c((r) => r.responded);
    const so = c((r) => r.hasSalesOrder);
    const conv = c((r) => r.converted);
    return [
      { label: "Leads", value: n(rows.length) },
      { label: "Meet Sales Advisor", value: `${n(resp)} · ${pct(ratio(resp, rows.length))}` },
      { label: "Sales Orders", value: `${n(so)} · ${pct(ratio(so, rows.length))}` },
      { label: "NO ORDER", value: n(c((r) => r.salesOrderState === "noOrder")) },
      { label: "Converted", value: n(conv) },
      { label: "Lead → Conversion", value: pct(ratio(conv, rows.length)) },
    ];
  }

  // ---------- Drill-downs ----------

  function predicateRows(key, rows) {
    const pred = Data().PREDICATES[key];
    return pred ? rows.filter(pred) : rows;
  }

  function openKpi(key) {
    const m = state.metrics;
    if (key === "visitors") { openVisitors(); return; }
    if (key === "visitorsUnknown") { openVisitors(m.visitorRows.filter((v) => !v.promoterKnown), "Visitors · unknown promoter"); return; }
    if (key === "visitorToLead") { openV2L(); return; }
    if (key === "registered") { openRegistered(); return; }
    if (key === "assignmentErrors" || key === "invalidPromoter" || key === "noProduct") { openAssignment(key); return; }
    if (key === "responded" || key === "responseRate") { openResponse(); return; }
    if (key === "converted" || key === "conversionRate") { openConverted(); return; }
    const rows = predicateRows(key, m.rows);
    const views = [leadView("Leads", rows)];
    if (key === "total") {
      views.push(leadView("Assigned promoter", predicateRows("knownPromoter", rows)), leadView("No promoter assigned", predicateRows("assignmentErrors", rows)),
        leadView("Invalid Promoter", predicateRows("invalidPromoter", rows)), leadView("No product", predicateRows("noProduct", rows), true),
        leadView("Responded", predicateRows("responded", rows)), leadView("Sales Orders", predicateRows("salesOrders", rows)), leadView("Converted", predicateRows("converted", rows)), statusView(rows));
    }
    if (key === "salesOrders" || key === "salesOrderRate") views.push(leadView("NO ORDER (excluded)", predicateRows("noOrder", m.rows)));
    openModal({ title: DRILL_TITLES[key] || "Leads", sub: filterSubtitle(), stats: leadStats(rows), views });
  }

  /** Meet Sales Advisor card: every lead, not-responded ones labelled and listed first. */
  function openResponse() {
    const m = state.metrics;
    const yes = predicateRows("responded", m.rows);
    const no = predicateRows("noResponse", m.rows);
    openModal({
      title: "Meet Sales Advisor",
      sub: `${filterSubtitle()} · ${n(yes.length)} responded · ${n(no.length)} not responded (Sales Response column)`,
      stats: [
        { label: "Leads", value: n(m.rows.length) },
        { label: "Responded", value: `${n(yes.length)} · ${pct(ratio(yes.length, m.rows.length))}` },
        { label: "Not responded", value: n(no.length) },
      ],
      views: [
        leadView(`All leads (${n(m.rows.length)})`, [...no, ...yes]),
        leadView(`Responded (${n(yes.length)})`, yes),
        leadView(`Not responded (${n(no.length)})`, no),
      ],
    });
  }

  /** Error drills (Employee Number · columns D/G): every customer record in scope (leads + visitor-stage registrations), not just leads. */
  function openAssignment(key) {
    const m = state.metrics;
    const product = key === "noProduct";
    const rows = predicateRows(key, m.customerRows);
    const leads = rows.filter((r) => r.isLead);
    const reg = rows.length - leads.length;
    const views = [leadView("Customers", rows, product)];
    if (reg) views.push(leadView("Leads", leads, product), leadView("Registered (visitor stage)", rows.filter((r) => !r.isLead), product));
    if (key === "invalidPromoter") views.push(employeeBreakdownView(rows));
    const others = [
      ["assignmentErrors", "No promoter assigned"], ["invalidPromoter", "Invalid Promoter"], ["noProduct", "No product"],
    ].filter(([k]) => k !== key).map(([k, label]) => ({ label: `${label} (separate)`, value: n(m.kpis[k]) }));
    openModal({
      title: DRILL_TITLES[key],
      sub: product
        ? `${filterSubtitle()} · column ${cfg().PRODUCT_COLUMNS.join(" or column ")} is blank`
        : `${filterSubtitle()} · Employee Number (column ${empCol()}) ${key === "assignmentErrors" ? "is blank" : "is not an official promoter number"} · not in any promoter's performance`,
      stats: [
        { label: "Customers", value: n(rows.length) },
        { label: "Leads", value: n(leads.length) },
        { label: "Registered (visitor stage)", value: n(reg) },
        ...others,
      ],
      views,
    });
  }

  function employeeBreakdownView(rows) {
    const map = new Map();
    rows.forEach((r) => { const k = r.employeeNumber || "(blank)"; map.set(k, (map.get(k) || 0) + 1); });
    const list = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    return {
      label: "By Employee Number", type: "table", rows: list,
      columns: [{ h: `Employee Number (column ${empCol()})`, v: (x) => x.value }, { h: "Leads", v: (x) => n(x.count), num: true }],
      onRow: (x) => openModal({ title: `${x.value === "(blank)" ? Data().ASSIGNMENT_ERROR : Data().INVALID_PROMOTER} · Employee Number = ${x.value}`, sub: filterSubtitle(), views: [leadView("Leads", rows.filter((r) => (r.employeeNumber || "(blank)") === x.value))] }),
    };
  }

  function statusView(rows) {
    const map = new Map();
    rows.forEach((r) => { map.set(r.statusLabel, (map.get(r.statusLabel) || 0) + 1); });
    const list = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count, stage: Data().classifyStatus(value === "(blank)" ? "" : value) }));
    return {
      label: "Status breakdown", type: "table", rows: list,
      columns: [
        { h: "Status", v: (x) => x.value },
        { h: "Records", v: (x) => n(x.count), num: true },
        { h: "GEC CONTROL stage", v: (x) => STAGE_LABEL[x.stage], html: (x) => stagePill(x) },
      ],
      onRow: (x) => openModal({ title: `Status · ${x.value}`, sub: filterSubtitle(), views: [leadView("Records", rows.filter((r) => r.statusLabel === x.value))] }),
    };
  }

  function openStatus(key) {
    const m = state.metrics;
    const rows = m.rows.filter((r) => r.status.toLowerCase().replace(/\s+/g, " ") === key);
    const s = m.leadStatus.find((x) => x.key === key);
    const label = s ? s.status : key;
    const exact = Data().filterOptions(state.dataset).statuses.includes(label);
    openModal({
      title: `Lead status · ${label}`,
      sub: `${filterSubtitle("status")} · ${s ? KIND_LABEL[s.kind] : ""} · ${pct(ratio(rows.length, m.kpis.total))} of leads`,
      stats: leadStats(rows),
      views: [leadView("Leads", rows)],
      filterAction: exact ? { key: "status", value: label } : null,
    });
  }

  const ORDER_MATCH_NOTE = "converted leads looked up in Sales Raw Data / Back Order by Transaction No. (then Sales Order)";

  function orderStats(leads, conv) {
    const stats = [{ label: "Leads", value: n(leads.length) }, { label: "Converted", value: `${n(conv.length)} · ${pct(ratio(conv.length, leads.length))}` }];
    if (!state.metrics.hasOrders) return stats;
    const count = (k) => conv.filter((r) => orderStateOf(r) === k).length;
    return stats.concat(shownStates(count).map((s) => {
      const c = count(s.key);
      return { label: s.label, value: `${n(c)} · ${pct(ratio(c, conv.length))}`, cls: s.optional && c ? "is-warn" : "" };
    }));
  }

  /** Converted card: where every converted lead is now (Sales Raw first, then the Back Order file). */
  function openConverted() {
    const m = state.metrics;
    const conv = predicateRows("converted", m.rows);
    if (!m.hasOrders) {
      openModal({
        title: DRILL_TITLES.converted, sub: `${filterSubtitle()} · push Sales Raw Data / Back Order to see Delivered, Pro-Forma and In BO file`,
        stats: leadStats(conv), views: [leadView("Converted", conv), statusView(m.rows)],
      });
      return;
    }
    const byState = new Map(ORDER_STATES.map((s) => [s.key, []]));
    conv.forEach((r) => { const k = orderStateOf(r); if (byState.has(k)) byState.get(k).push(r); });
    const states = shownStates((k) => byState.get(k).length);
    openModal({
      title: `Converted · ${n(conv.length)} leads · current status`,
      sub: `${filterSubtitle()} · each Transaction No. checked in Sales Raw Data first, then the Back Order file`,
      stats: orderStats(m.rows, conv),
      views: [
        { label: "Chart", type: "html", html: convertedChart(conv, byState, states) },
        leadView("All converted", states.flatMap((s) => byState.get(s.key))),
        ...states.map((s) => leadView(s.label, byState.get(s.key))),
        statusView(m.rows),
      ],
    });
  }

  function convertedChart(conv, byState, states) {
    const total = conv.length;
    let at = 0;
    const stops = states.map((s) => {
      const from = at;
      at += total ? (byState.get(s.key).length / total) * 100 : 0;
      return `${s.color} ${from.toFixed(2)}% ${at.toFixed(2)}%`;
    });
    const bo = new Map();
    byState.get("backorder").forEach((r) => { const k = orderOf(r).sourceStatus || "(blank)"; bo.set(k, (bo.get(k) || 0) + 1); });
    const boRows = [...bo.entries()].sort((a, b) => b[1] - a[1]);
    const boN = byState.get("backorder").length;
    return `
      <div class="gcc-conv-chart">
        <div class="gcc-donut" style="background:${total ? `conic-gradient(${stops.join(", ")})` : "#e2e8f0"}">
          <div><b class="gcc-num">${n(total)}</b><small>converted</small></div>
        </div>
        <div class="gcc-conv-legend">
          ${states.map((s) => {
            const c = byState.get(s.key).length;
            return `
            <button type="button" class="gcc-conv-row" data-act="car-state" data-state="${s.key}" title="Open ${esc(s.label)} leads">
              <i style="background:${s.color}"></i>
              <span class="gcc-conv-lab"><b>${esc(s.label)}</b><small>${esc(s.rule)}</small></span>
              <span class="gcc-conv-bar"><span style="width:${w100(ratio(c, total) || 0)};background:${s.color}"></span></span>
              <b class="gcc-num gcc-conv-n">${n(c)}</b>
              <b class="gcc-num gcc-conv-pct">${pct(ratio(c, total))}</b>
            </button>`;
          }).join("")}
        </div>
      </div>
      ${boN ? `
      <section class="gcc-conv-bo">
        <h4>In BO file · Back Order status (${n(boN)})</h4>
        <table class="gcc-table"><thead><tr><th>Back Order status</th><th class="num">Leads</th><th class="num">% of In BO file</th><th class="num">% of converted</th></tr></thead>
        <tbody>${boRows.map(([k, c]) => `<tr><td dir="auto">${esc(k)}</td><td class="num">${n(c)}</td><td class="num">${pct(ratio(c, boN))}</td><td class="num">${pct(ratio(c, total))}</td></tr>`).join("")}</tbody></table>
      </section>` : ""}`;
  }

  const orderViews = (conv) => (state.metrics.hasOrders
    ? ORDER_STATES.map((s) => leadView(s.label, conv.filter((r) => orderStateOf(r) === s.key))).filter((v) => v.rows.length)
    : []);

  function openCar(name) {
    const m = state.metrics;
    const leads = m.rows.filter((r) => r.modelGroup === name);
    const conv = predicateRows("converted", leads);
    const exact = Data().filterOptions(state.dataset).models.includes(name);
    openModal({
      title: `Top car · ${name}`,
      sub: `${filterSubtitle("model")} · ${m.hasOrders ? ORDER_MATCH_NOTE : "push Sales Raw Data / Back Order to see Pro-Forma & Delivered"}`,
      stats: orderStats(leads, conv),
      views: [leadView("Converted", conv), ...orderViews(conv), leadView("All leads", leads)],
      filterAction: exact ? { key: "model", value: name } : null,
    });
  }

  function openCarState(key) {
    const m = state.metrics;
    const conv = predicateRows("converted", m.rows).filter((r) => orderStateOf(r) === key);
    const byCar = new Map();
    conv.forEach((r) => byCar.set(r.modelGroup, (byCar.get(r.modelGroup) || 0) + 1));
    const cars = [...byCar.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    openModal({
      title: `Converted · now ${ORDER_LABEL[key] || key}`,
      sub: `${filterSubtitle()} · ${ORDER_MATCH_NOTE}`,
      stats: [{ label: ORDER_LABEL[key] || key, value: n(conv.length) }, { label: "Converted", value: n(m.kpis.converted) }, { label: "Share", value: pct(ratio(conv.length, m.kpis.converted)) }],
      views: [leadView("Leads", conv), {
        label: "By car", type: "table", rows: cars,
        columns: [{ h: "Model", v: (x) => x.name, dir: true }, { h: ORDER_LABEL[key] || key, v: (x) => n(x.count), num: true }],
        onRow: (x) => openCar(x.name),
      }],
    });
  }

  function openCarsAll() {
    const m = state.metrics;
    const list = m.cars;
    const conv = predicateRows("converted", m.rows);
    const ho = m.hasOrders;
    openModal({
      title: "Top cars · converted → Pro-Forma / Delivered",
      sub: `${filterSubtitle()} · ${ho ? ORDER_MATCH_NOTE : "push Sales Raw Data / Back Order to see Pro-Forma & Delivered"} · click a row`,
      stats: orderStats(m.rows, conv),
      views: [{
        label: "By car", type: "table", rows: list,
        columns: [
          { h: "#", v: (x) => String(list.indexOf(x) + 1), num: true },
          { h: "Model", v: (x) => x.name, dir: true },
          { h: "Leads", v: (x) => n(x.leads), num: true },
          { h: "Converted", v: (x) => n(x.converted), num: true },
          { h: "Lead → Conversion", v: (x) => pct(ratio(x.converted, x.leads)), num: true },
          ...(ho ? ORDER_STATES.map((s) => ({ h: s.label, v: (x) => n(x[s.key]), num: true })) : []),
          ...(ho ? [{ h: "Delivered % of converted", v: (x) => pct(ratio(x.delivered, x.converted)), num: true }] : []),
        ],
        onRow: (x) => openCar(x.name),
      }, leadView("Converted", conv), ...orderViews(conv)],
    });
  }

  function openUnlisted() {
    const m = state.metrics;
    const rows = predicateRows("unlisted", m.rows);
    openModal({
      title: "Unlisted statuses · counted as leads",
      sub: "These statuses are in no GEC CONTROL list (visitor / lead / conversion). They count as leads until an admin classifies them in Admin → GEC CONTROL.",
      stats: m.unlistedStatuses.map((s) => ({ label: s.status, value: n(s.count), cls: "is-warn" })),
      views: [statusView(rows), leadView("Leads", rows)],
    });
  }

  function openRegistered() {
    const m = state.metrics;
    const rows = m.registeredRows;
    openModal({
      title: "Registered · not yet leads",
      sub: `Status is a GEC CONTROL visitor status (${Data().enabledStatuses("visitor").join(" · ") || "none"}) — not counted as leads or conversions · ${filterSubtitle()}`,
      stats: [{ label: "Registered", value: n(rows.length) }, { label: "Leads", value: n(m.kpis.total) }],
      views: [leadView("Registered", rows), statusView(rows)],
    });
  }

  function openVisitors(visitorRows, title) {
    const m = state.metrics;
    if (!m.hasVisitors) {
      openModal({ title: "Visitors", sub: "No GEC file", html: `<div class="gcc-rules"><h4>No GEC file uploaded</h4>
        <p>Visitors are every transaction in the GEC file. The date is read from <b>column J</b> and compared with the selected dates.</p></div>` });
      return;
    }
    const rows = visitorRows || m.visitorRows;
    const total = rows.reduce((s, v) => s + v.count, 0);
    const purposes = new Map();
    rows.forEach((v) => purposes.set(v.purpose, (purposes.get(v.purpose) || 0) + v.count));
    const byPurpose = [...purposes.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    openModal({
      title: title || "Visitors",
      sub: `${filterSubtitle()} · column J date · ${m.leadOnlyFilter ? "model, source, status and advisor filters apply to leads only" : "every transaction in the selected dates"}`,
      stats: [
        { label: "Visitors", value: n(total) },
        { label: "Registered leads", value: n(m.kpis.total) },
        { label: "Visitor → Lead", value: pct(m.kpis.visitorToLead) },
        ...byPurpose.slice(0, 4).map((p) => ({ label: p.value, value: n(p.count) })),
      ],
      views: [
        visitorView("Visitor records", rows),
        { label: "By purpose", type: "table", rows: byPurpose,
          columns: [{ h: "Visit Purpose", v: (x) => x.value, dir: true }, { h: "Visitors", v: (x) => n(x.count), num: true }, { h: "Share", v: (x) => pct(ratio(x.count, total)), num: true }],
          onRow: (x) => openVisitors(rows.filter((v) => v.purpose === x.value), `Visitors · ${x.value}`) },
      ],
    });
  }

  function dailyTableView(leads, visitors, withVisitors) {
    const days = new Map();
    const get = (d) => { if (!days.has(d)) days.set(d, { day: d, visitors: 0, leads: 0, responded: 0, salesOrders: 0, converted: 0 }); return days.get(d); };
    leads.forEach((r) => { if (!r.day) return; const x = get(r.day); x.leads += 1; x.responded += r.responded; x.salesOrders += r.hasSalesOrder; x.converted += r.converted; });
    if (withVisitors) visitors.forEach((v) => { if (v.day) get(v.day).visitors += v.count; });
    const rows = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    return {
      label: "Daily", type: "table", rows,
      columns: [
        { h: "Day", v: (x) => fmtDay(x.day, true) },
        withVisitors ? { h: "Visitors", v: (x) => n(x.visitors), num: true } : null,
        { h: "Leads", v: (x) => n(x.leads), num: true },
        withVisitors ? { h: "Visitor → Lead", v: (x) => pct(ratio(x.leads, x.visitors)), num: true } : null,
        { h: "Meet Sales Advisor", v: (x) => n(x.responded), num: true },
        { h: "Sales Orders", v: (x) => n(x.salesOrders), num: true },
        { h: "Converted", v: (x) => n(x.converted), num: true },
        { h: "Lead → Conversion", v: (x) => pct(ratio(x.converted, x.leads)), num: true },
      ].filter(Boolean),
      onRow: (x) => openDay({ key: x.day, days: [x.day] }, { leads, visitors }),
    };
  }

  function openV2L() {
    const m = state.metrics;
    if (!m.hasVisitors) { openVisitors(); return; }
    const list = m.promoters.slice().sort((a, b) => (b.visitors || 0) - (a.visitors || 0));
    const unknownV = m.visitorRows.filter((v) => !v.promoterKnown).reduce((s, v) => s + v.count, 0);
    const convOf = (a) => m.rows.filter((r) => r.assignment === a).reduce((s, r) => s + r.converted, 0);
    const rows = [...list,
      ...(m.kpis.assignmentErrorLeads ? [{ name: Data().ASSIGNMENT_ERROR, visitors: null, leads: m.kpis.assignmentErrorLeads, converted: convOf("blank"), drill: "assignmentErrors" }] : []),
      ...(m.kpis.invalidPromoterLeads ? [{ name: Data().INVALID_PROMOTER, visitors: null, leads: m.kpis.invalidPromoterLeads, converted: convOf("invalid"), drill: "invalidPromoter" }] : []),
      ...(unknownV ? [{ name: "Unknown promoter (visitor file)", visitors: unknownV, leads: null, converted: null, drill: "visitorsUnknown" }] : [])];
    openModal({
      title: "Visitor → Lead",
      sub: `${filterSubtitle()} · leads ÷ visitors`,
      stats: [{ label: "Visitors", value: n(m.kpis.visitors) }, { label: "Registered leads", value: n(m.kpis.total) }, { label: "Visitor → Lead", value: pct(m.kpis.visitorToLead) }, { label: "Visitor → Conversion", value: pct(m.kpis.visitorToConversion) }],
      views: [
        { label: "By promoter", type: "table", rows,
          columns: [
            { h: "Promoter", v: (x) => x.name },
            { h: "Visitors", v: (x) => nOrDash(x.visitors), num: true },
            { h: "Leads", v: (x) => nOrDash(x.leads), num: true },
            { h: "Visitor → Lead", v: (x) => (m.kpis.visitorToLead == null || x.drill ? "—" : pct(ratio(x.leads, x.visitors))), num: true },
            { h: "Converted", v: (x) => nOrDash(x.converted), num: true },
          ],
          onRow: (x) => (x.drill ? openKpi(x.drill) : openPromoter(x.name)) },
        dailyTableView(m.rows, m.visitorRows, true),
      ],
    });
  }

  function openPromoter(name) {
    const pm = perfSource("promoter");
    const leads = pm.rows.filter((r) => r.promoter === name);
    const visitors = pm.visitorRows.filter((v) => v.promoter === name);
    const p = pm.promoters.find((x) => x.name === name) || { visitors: null, leads: leads.length, converted: 0, visitorToLead: null, leadToConversion: null };
    const views = [leadView("Leads registered", leads), leadView("Converted", predicateRows("converted", leads))];
    if (pm.hasVisitors) views.push(visitorView("Visitors", visitors));
    views.push(dailyTableView(leads, visitors, pm.hasVisitors));
    const emp = empOf(name);
    openModal({
      title: `Promoter · ${name}${emp ? ` (${emp})` : ""}`,
      sub: `${whenLabel("promoter")} · ${filterSubtitle("promoter")}`,
      stats: [
        { label: "Visitors", value: nOrDash(p.visitors) },
        { label: "Leads registered", value: n(p.leads) },
        { label: "Converted", value: n(p.converted) },
        { label: "Visitor → Lead", value: pct(p.visitorToLead) },
        { label: "Lead → Conversion", value: pct(p.leadToConversion) },
      ],
      views,
      filterAction: { key: "promoter", value: name },
    });
  }

  function openAdvisor(name) {
    const cm = perfSource("advisor");
    const leads = cm.rows.filter((r) => r.consultant === name);
    const c = cm.consultants.find((x) => x.name === name) || { leads: 0, responded: 0, salesOrders: 0, converted: 0, responseRate: null, conversionRate: null };
    openModal({
      title: `Sales advisor · ${name}`,
      sub: `${whenLabel("advisor")} · ${filterSubtitle("consultant")}`,
      stats: [
        { label: "Leads received", value: n(c.leads) },
        { label: "Meet Sales Advisor", value: n(c.responded) },
        { label: "Response %", value: pct(c.responseRate) },
        { label: "Sales Orders", value: n(c.salesOrders) },
        { label: "Converted", value: n(c.converted) },
        { label: "Conversion %", value: pct(c.conversionRate) },
      ],
      views: [
        leadView("Received", leads),
        leadView("Responded", predicateRows("responded", leads)),
        leadView("Sales Orders", predicateRows("salesOrders", leads)),
        leadView("Converted", predicateRows("converted", leads)),
        dailyTableView(leads, [], false),
      ],
      filterAction: { key: "consultant", value: name },
    });
  }

  function openCell(kind, name, metric) {
    const src = perfSource(kind);
    const when = whenLabel(kind);
    if (metric === "visitors") {
      openVisitors(src.visitorRows.filter((v) => v.promoter === name), `${name} · visitors · ${when}`);
      return;
    }
    const key = kind === "promoter" ? "promoter" : "consultant";
    const base = src.rows.filter((r) => r[key] === name);
    const rows = predicateRows(METRIC_PRED[metric] || "total", base);
    openModal({ title: `${name} · ${METRIC_LABEL[metric] || metric}`, sub: `${when} · ${filterSubtitle(key)}`, stats: leadStats(base),
      views: [leadView(METRIC_LABEL[metric] || "Leads", rows), ...(rows.length !== base.length ? [leadView("All leads", base)] : [])] });
  }

  function openDay(b, scope) {
    const set = new Set(b.days);
    const m = state.metrics;
    const leads = (scope ? scope.leads : m.rows).filter((r) => set.has(r.day));
    const visitors = (scope ? scope.visitors : m.visitorRows).filter((v) => set.has(v.day));
    const title = b.days.length > 1 ? `Week of ${fmtDay(b.key, true)}` : fmtDay(b.key, true);
    const views = [leadView("Leads", leads), leadView("Responded", predicateRows("responded", leads)), leadView("Sales Orders", predicateRows("salesOrders", leads)), leadView("Converted", predicateRows("converted", leads))];
    if (m.hasVisitors) views.splice(1, 0, visitorView("Visitors", visitors));
    const stats = leadStats(leads);
    if (m.hasVisitors) stats.unshift({ label: "Visitors", value: n(visitors.reduce((s, v) => s + v.count, 0)) });
    openModal({ title, sub: filterSubtitle(), stats, views });
  }

  function openRankAll(kind) {
    if (kind === "promoter") {
      const src = perfSource("promoter");
      const list = rankList(src.promoters, state.view.promoter.rank, ["leads", "converted", "visitors"]);
      openModal({
        title: "Promoter performance · Visitor → Lead → Conversion",
        sub: `${whenLabel("promoter")} · ${filterSubtitle("promoter")} · No promoter assigned and Invalid Promoter not ranked · click a row`,
        views: [{
          label: "Promoters", type: "table", rows: list,
          columns: [
            { h: "#", v: (x) => String(list.indexOf(x) + 1), num: true },
            { h: "Promoter", v: (x) => x.name },
            { h: "Emp. No.", v: (x) => empOf(x.name), num: true },
            { h: "Visitors", v: (x) => nOrDash(x.visitors), num: true },
            { h: "Leads registered", v: (x) => n(x.leads), num: true },
            { h: "Meet Sales Advisor", v: (x) => n(x.responded), num: true },
            { h: "Sales Orders", v: (x) => n(x.salesOrders), num: true },
            { h: "Converted", v: (x) => n(x.converted), num: true },
            { h: "Visitor → Lead", v: (x) => pct(x.visitorToLead), num: true },
            { h: "Lead → Conversion", v: (x) => pct(x.leadToConversion), num: true },
          ],
          onRow: (x) => openPromoter(x.name),
        }],
      });
      return;
    }
    const src = perfSource("advisor");
    const list = rankList(src.consultants, state.view.advisor.rank, ["leads", "converted", "responded"]);
    openModal({
      title: "Sales advisor performance",
      sub: `${whenLabel("advisor")} · ${filterSubtitle("consultant")} · promoters and ${Data().enabledStatuses("visitor").join("/") || "visitor-stage"} records excluded · click a row`,
      views: [{
        label: "Sales advisors", type: "table", rows: list,
        columns: [
          { h: "#", v: (x) => String(list.indexOf(x) + 1), num: true },
          { h: "Sales advisor", v: (x) => x.name, dir: true },
          { h: "Leads received", v: (x) => n(x.leads), num: true },
          { h: "Meet Sales Advisor", v: (x) => n(x.responded), num: true },
          { h: "Response %", v: (x) => pct(x.responseRate), num: true },
          { h: "Sales Orders", v: (x) => n(x.salesOrders), num: true },
          { h: "Converted", v: (x) => n(x.converted), num: true },
          { h: "Conversion %", v: (x) => pct(x.conversionRate), num: true },
        ],
        onRow: (x) => openAdvisor(x.name),
      }],
    });
  }

  // ---------- Data & rules / validation ----------

  function openInfo() {
    const ds = state.dataset;
    const c = cfg();
    const ctl = Data().getControl();
    const col = (key) => {
      const m = ds && ds.mapping.find((x) => x.key === key);
      return m && m.column ? `“${esc(m.column)}” (${m.letter})` : `<i>missing</i>`;
    };
    const mapping = ds ? ds.mapping.map((m) => `<div class="gcc-map-item${m.column ? "" : " is-missing"}${!m.column && m.required ? " is-required" : ""}"><span>${esc(m.label)}</span><b>${m.column ? `${esc(m.column)} · ${m.letter}` : (m.required ? "NOT FOUND" : "not in file")}</b></div>`).join("") : "";
    const q = ds && ds.quality;
    const vs = state.visitors;
    const quality = q ? `
      <h4>Data quality</h4>
      <div class="gcc-dq-grid">
        <div><span>Source rows</span><b>${n(q.sourceRows)}</b></div>
        <div><span>Unique transactions</span><b>${n(q.uniqueTransactions)}</b></div>
        <div class="${q.duplicateRows ? "warn" : ""}"><span>Duplicate rows</span><b>${n(q.duplicateRows)}</b><em>${n(q.duplicateTransactions)} transactions repeated · latest row kept</em></div>
        <div class="${q.missingTxn ? "warn" : ""}"><span>Missing Transaction No.</span><b>${n(q.missingTxn)}</b><em>rows ignored</em></div>
        <div class="${q.blankEmployee ? "warn" : ""}"><span>No promoter assigned · blank Employee Number (unique transactions)</span><b>${n(q.blankEmployee)}</b><em>${n(q.blankEmployeeCells)} blank column ${empCol()} cells across all ${n(q.sourceRows)} source rows</em></div>
        <div class="${q.noProduct ? "warn" : ""}"><span>No product · blank column ${c.PRODUCT_COLUMNS.join(" or ")} (unique transactions)</span><b>${n(q.noProduct)}</b><em>${(ds.productColumns || []).map((p) => `${esc(p.letter)} = “${esc(p.header || "no header")}”`).join(" · ")}</em></div>
        <div class="${q.unmappedEmployee ? "warn" : ""}"><span>Invalid Promoter · Employee Number not official (unique transactions)</span><b>${n(q.unmappedEmployee)}</b></div>
        <div><span>NO ORDER (all records)</span><b>${n(q.noOrder)}</b><em>${n(q.orderPlaceholders)} other placeholders · ${n(q.actualOrders)} actual orders</em></div>
        <div class="${q.undated ? "warn" : ""}"><span>No readable Created Date</span><b>${n(q.undated)}</b></div>
        <div><span>Visitors · column J</span><b>${ds ? n(ds.records.filter((r) => r.visitDay).length) : "—"}</b><em>unique transactions with a date in column J · the card applies the selected dates</em></div>
      </div>` : "";
    const list = (g) => ctl[g].map((x) => `<span class="gcc-chip${x.enabled ? "" : " is-off"}">${x.enabled ? "✓" : "✕"} ${esc(x.name)}</span>`).join("") || `<span class="gcc-muted">none</span>`;
    const promoters = Object.entries(c.PROMOTER_MAP).map(([k, v]) => `<span class="gcc-chip">${esc(k)} → ${esc(v)}</span>`).join("");
    const rules = `
      <h4>GEC CONTROL · status rules (Admin → GEC CONTROL)</h4>
      <div class="gcc-ctl"><div><b>Visitor stage</b><div class="gcc-chips">${list("visitor")}</div></div>
        <div><b>Lead statuses</b><div class="gcc-chips">${list("lead")}</div></div>
        <div><b>Conversion statuses</b><div class="gcc-chips">${list("conversion")}</div></div></div>
      <h4>Business rules</h4>
      <ul>
        <li><b>Transaction</b> — one unique ${col("txn")}. Rows without it are ignored; repeated numbers count once (latest row${ds && ds.colMap.modifiedDate != null ? ` by ${col("modifiedDate")}` : " in the sheet"}).</li>
        <li><b>Stage</b> — ${col("status")} is matched (case-insensitive, enabled entries only) against conversion → lead → visitor. A status in no list counts as a lead and is flagged under Attention.</li>
        <li><b>Registered leads</b> — every transaction except visitor-stage statuses (${esc(Data().enabledStatuses("visitor").join(", ") || "none")}), which show as “registered, not yet leads”.</li>
        <li><b>Converted</b> — enabled conversion statuses only (“Won” alone is not converted unless enabled). A converted record is still a lead.</li>
        <li><b>Promoter</b> — ${col("employeeNumber")} is the only source (never Employee Responsible, Sales Employee, Sales Response or Status). Official number → that promoter. Blank → <b>${esc(c.ASSIGNMENT_ERROR)}</b> (unassigned customer). Any other value → <b>${esc(c.INVALID_PROMOTER)}</b>. The two are counted separately and neither is in any promoter's performance.</li>
        <li><b>Sales Response</b> — ${col("salesResponse")} has a real value. <b>Sales Order</b> — ${col("salesOrder")} is an actual order number; <b>“NO ORDER”</b> and placeholders never count.</li>
        <li><b>Visitors</b> — every unique transaction whose <b>column J</b> date is inside the selected dates (all of them when no date is selected). <b>Visitor → Lead</b> = registered leads ÷ visitors. <b>Lead → Conversion</b> = converted ÷ leads.</li>
        <li><b>Sales advisors</b> — ${col("consultant")} on lead records, excluding the official promoters. Conversion % = converted ÷ leads received.</li>
        <li><b>Response time / SLA</b> — not shown (timing data not validated).</li>
        <li><b>Top cars</b> — converted leads per ${col("model")}. Each converted Transaction No. (then its Sales Order number) is looked up in <b>Sales Raw Data</b> and <b>Back Order</b>: Sales Raw with a delivery / invoice date (Col V) → <b>Delivered</b>, without → <b>Pro-Forma</b>; only in Back Order → <b>Back Order</b> (unless its status says delivered / pro-forma); in neither → <b>Not found</b>.</li>
      </ul>
      <h4>Order status matching</h4>
      ${state.orders && state.orders.ready
        ? `<ul>${state.orders.sources.map((s) => `<li><b>${esc(s.label)}</b> — ${n(s.rows)} rows · ${s.fullScan ? "no transaction / order column found, every column scanned for long codes" : `matched on ${s.columns.map((h) => `“${esc(h)}”`).join(", ")}`}</li>`).join("")}
          ${ORDER_STATES.map((s) => `<li><b>${esc(s.label)}</b> — ${esc(s.rule)}</li>`).join("")}</ul>`
        : `<p class="gcc-muted">No Sales Raw Data or Back Order pushed — Top Cars shows converted counts only.</p>`}
      <h4>Official promoter list</h4><div class="gcc-chips">${promoters}</div>`;
    const sheets = ds ? `<h4>Sheets in file</h4><ul>${ds.sheets.map((s) => `<li>${esc(s.name)} — ${n(s.rows)} rows, ${s.fields} recognised columns${s.name === ds.sheetName ? " <b>(leads)</b>" : ""}${vs && vs.ok && s.name === vs.sheetName ? " <b>(visitors)</b>" : ""}</li>`).join("")}</ul>` : "";
    const warnList = [...((ds && ds.warnings) || []), ...((vs && vs.warnings) || [])];
    const warn = warnList.length ? `<h4>Notes</h4><ul>${warnList.map((w) => `<li class="gcc-warn-line">${esc(w)}</li>`).join("")}</ul>` : "";
    openModal({
      title: "Data source, rules & quality",
      sub: ds ? `${ds.fileName || "GEC File"} · sheet “${ds.sheetName}” · header row ${ds.headerRow}` : "No GEC File loaded",
      html: `<div class="gcc-map-grid">${mapping}</div><div class="gcc-rules">${quality}${rules}${warn}${sheets}
        ${state.debug ? `<p class="gcc-debug-hint"><button type="button" class="gcc-btn" data-act="validate">Open validation</button> Management targets, promoter mapping check and raw-cell reconciliation.</p>` : ""}</div>`,
      foot: `Columns are detected from the header row (Employee Number found in column ${empCol()} by reading the header from the first cell), so next month's file works without changes.`,
    });
  }

  const passPill = (ok, fail) => (ok ? '<span class="gcc-pill st-converted">PASS</span>' : `<span class="gcc-flag">${fail || "MISMATCH"}</span>`);
  const tbl = (head, rows) => `<table class="gcc-table"><thead><tr>${head.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.h || h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;

  function openValidation() {
    const ds = state.dataset;
    const res = Data().validate(ds, state.filters, { visitors: state.visitors });
    if (!res.totals) { openModal({ title: "Validation", sub: "No dataset loaded", html: `<div class="gcc-rules"><p>No GEC File loaded.</p></div>` }); return; }
    const tg = res.targets;
    const passed = res.checks.filter((c) => c.pass).length;
    const tgHtml = tg.rows.length
      ? tbl(["Management KPI", { h: "Approved", num: true }, { h: "Calculated", num: true }, "Result"], tg.rows.map((r) =>
        `<tr class="${r.pass ? "" : "is-bad"}"><td>${esc(r.label)}</td><td class="num">${esc(r.expected)}</td><td class="num">${esc(r.actual)}</td><td>${passPill(r.pass)}</td></tr>`))
      : `<p class="gcc-pad">${esc(tg.label)}.</p>`;
    const pc = res.promoterCheck;
    const pcHtml = tbl(["Promoter", { h: "Leads", num: true }], [
      ...pc.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${n(r.count)}</td></tr>`),
      `<tr class="is-total"><td>TOTAL</td><td class="num">${n(pc.total)}</td></tr>`,
    ]) + `<p class="gcc-pad ${pc.ok && (pc.expectedTotal == null || pc.total === pc.expectedTotal) ? "" : "gcc-warn-line"}">${
      !pc.ok ? `⚠ Promoter total ${n(pc.total)} ≠ leads ${n(pc.leads)}`
        : pc.expectedTotal != null && pc.total !== pc.expectedTotal ? `⚠ Total ${n(pc.total)} ≠ approved ${n(pc.expectedTotal)}`
          : `Promoters + No promoter assigned + Invalid Promoter = ${n(pc.total)} leads ✓`} · Employee Number column ${esc(pc.column)}</p>`;
    const b = res.breakdowns;
    const statusHtml = tbl(["Status", { h: "Records", num: true }, "Stage"], b.status.map((s) =>
      `<tr><td>${esc(s.value)}</td><td class="num">${n(s.count)}</td><td>${stagePill(s)}</td></tr>`));
    const soHtml = tbl(["Sales Order class", { h: "Records", num: true }], b.salesOrder.map((s) =>
      `<tr><td>${esc({ order: "Actual order (counted)", noOrder: "NO ORDER (excluded)", placeholder: "Placeholder (excluded)", blank: "Blank" }[s.value] || s.value)}</td><td class="num">${n(s.count)}</td></tr>`))
      + (b.salesOrderPlaceholders.length ? tbl(["Excluded value", { h: "Records", num: true }], b.salesOrderPlaceholders.map((s) => `<tr><td>“${esc(s.value)}”</td><td class="num">${n(s.count)}</td></tr>`)) : "");
    const respHtml = tbl(["Sales Response", { h: "Records", num: true }], b.responseValues.map((s) => `<tr><td>${esc(s.value)}</td><td class="num">${n(s.count)}</td></tr>`));
    const empHtml = b.employees.length ? tbl([`Employee Number · column ${empCol()} (blank = No promoter assigned)`, { h: "Records", num: true }], b.employees.map((s) => `<tr><td>${esc(s.value)}</td><td class="num">${n(s.count)}</td></tr>`)) : `<p class="gcc-pad">All employee numbers are official promoters.</p>`;
    const t = res.totals;
    const kRows = [["Total Visitors", "visitors"], ["Registered Leads", "total"], ["Registered, not yet lead", "registeredNotLead"], ["Visitor → Lead", "visitorToLead", true],
      ["Assigned promoter (Employee Number)", "knownPromoter"], ["No promoter assigned (blank Employee Number · all customers)", "assignmentErrors"], ["Invalid Promoter (non-official Employee Number · all customers)", "invalidPromoter"],
      ["No promoter assigned · leads only", "assignmentErrorLeads"], ["Invalid Promoter · leads only", "invalidPromoterLeads"],
      ["No product (blank D or G · all customers)", "noProduct"], ["No product · leads only", "noProductLeads"],
      ["Sales Response", "responded"], ["Response rate", "responseRate", true],
      ["Actual Sales Orders", "salesOrders"], ["Sales Order rate", "salesOrderRate", true], ["NO ORDER", "noOrder"], ["Converted", "converted"],
      ["Lead → Conversion", "conversionRate", true], ["Unlisted status leads", "unlisted"], ["No sales advisor", "noAdvisor"], ["Assigned to promoter", "promoterConsultant"]];
    const fmtK = (v, p) => (p ? pct(v, 2) : nOrDash(v));
    const kpiHtml = tbl(["KPI", { h: "Filtered", num: true }, { h: "Whole file", num: true }], kRows.map(([l, k, p]) => `<tr><td>${l}</td><td class="num">${fmtK(t.filtered[k], p)}</td><td class="num">${fmtK(t.all[k], p)}</td></tr>`));
    const checksHtml = tbl(["Reconciliation check", { h: "Raw cells / expected", num: true }, { h: "Dashboard", num: true }, "Result", "Note"], res.checks.map((c) =>
      `<tr class="${c.pass ? "" : "is-bad"}"><td>${esc(c.name)}</td><td class="num">${esc(c.expected)}</td><td class="num">${esc(c.actual)}</td><td>${passPill(c.pass, "FAIL")}</td><td>${esc(c.detail)}</td></tr>`));
    const daysHtml = tbl(["Day", { h: "Visitors", num: true }, { h: "Leads", num: true }, { h: "Resp.", num: true }, { h: "SO", num: true }, { h: "Conv.", num: true }], t.days.map((d) =>
      `<tr><td>${fmtDay(d.key, true)}</td><td class="num">${nOrDash(d.visitors)}</td><td class="num">${n(d.leads)}</td><td class="num">${n(d.responded)}</td><td class="num">${n(d.salesOrders)}</td><td class="num">${n(d.converted)}</td></tr>`));
    const allTargets = tg.rows.length && tg.passed === tg.rows.length;
    openModal({
      title: "Developer validation",
      sub: `${tg.rows.length ? `Management targets ${tg.passed}/${tg.rows.length}` : "No management targets for this period"} · reconciliation ${passed}/${res.checks.length} · filters: ${filterSubtitle()}`,
      stats: [
        { label: "Management targets", value: tg.rows.length ? `${tg.passed} / ${tg.rows.length}` : "—", cls: tg.rows.length ? (allTargets ? "is-ok" : "is-bad") : "" },
        { label: "Reconciliation", value: `${passed} / ${res.checks.length}`, cls: passed === res.checks.length ? "is-ok" : "is-bad" },
        { label: "Promoter mapping", value: `${n(pc.total)} / ${n(pc.leads)}`, cls: pc.ok ? "is-ok" : "is-bad" },
      ],
      html: `<div class="gcc-valid">
        <section><h4>Management targets · ${esc(tg.label)}</h4>${tgHtml}<p class="gcc-pad gcc-muted">Whole file, no filters. Calculated values come only from the Excel rows — targets are never displayed on the dashboard.</p></section>
        <section><h4>Promoter Mapping Check (leads)</h4>${pcHtml}</section>
        <section><h4>KPI totals</h4>${kpiHtml}</section>
        <section><h4>Status → GEC CONTROL stage</h4>${statusHtml}</section>
        <section><h4>Sales Order values</h4>${soHtml}</section>
        <section><h4>Sales Response values</h4>${respHtml}</section>
        <section><h4>Employee Number (column ${empCol()}) · not an official promoter</h4>${empHtml}</section>
        <section><h4>Daily totals (filtered)</h4>${daysHtml}</section>
        <section class="span2"><h4>Reconciliation · independent pass over raw sheet cells</h4>${checksHtml}</section>
      </div>`,
      foot: "Developer only. A MISMATCH means the file or a rule differs from the approved numbers — fix the rule or the data, never the display.",
    });
  }

  // ---------- Public API ----------

  function render(host, dataset, ctx) {
    if (!host || !Data()) return;
    if (!state.root || state.host !== host || !host.contains(state.root)) {
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      if (state.resizeObserver) state.resizeObserver.disconnect();
      build(host);
    }
    state.ctx = ctx || {};
    const exitBtn = state.root.querySelector('[data-act="exit"]');
    if (exitBtn) exitBtn.style.display = typeof state.ctx.onExit === "function" ? "" : "none";
    Data().setControl(state.ctx.control || null);
    state.dataset = dataset && dataset.records ? dataset : null;
    const extVisitors = state.ctx.visitors && state.ctx.visitors.ok ? state.ctx.visitors : null;
    state.visitors = extVisitors || (state.dataset && state.dataset.visitors) || null;
    const sales = Array.isArray(state.ctx.sales) && state.ctx.sales.length ? state.ctx.sales : null;
    const bo = Array.isArray(state.ctx.backorder) && state.ctx.backorder.length ? state.ctx.backorder : null;
    if (!state.orders || sales !== state.orderSrc.sales || bo !== state.orderSrc.bo) {
      state.orders = Data().buildOrderIndex(sales, bo);
      state.orderSrc = { sales, bo };
    }
    const sig = datasetSig(state.dataset, state.visitors);
    if (sig !== state.sig) {
      state.sig = sig;
      state.filters = { ...EMPTY_FILTERS };
      state.view.promoter.day = "";
      state.view.advisor.day = "";
      if (!el("modal").hidden) closeModal();
    }
    renderAll();
  }

  global.GecDashboard = { render, state };
})(typeof window !== "undefined" ? window : globalThis);
