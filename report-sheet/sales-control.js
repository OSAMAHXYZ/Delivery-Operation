/**
 * Sales Control Center · Delivered vs Pro-Forma (same design system as the GEC Control Center).
 *
 * Pipeline: Sales Raw rows (parsed once by index.html)
 *   → normalize once (channel / showroom / model classification + indexes)
 *   → date flags cached per period
 *   → filter results cached per (period, showroom, model)
 *   → only changed text, bars and chart datasets are updated.
 *
 * Business rules are NOT implemented here — classification, period matching, trend and status
 * functions are injected by index.html (the same functions the previous page used).
 *
 * Usage: SalesControl.render(hostEl, source, ctx)
 */
(function (global) {
  const CHANNELS = [
    { id: "lexus", title: "Lexus Sales", short: "Lexus", brand: "LEXUS", sub: "ESH · IS · LC · LX · NX · RX", color: "#c9b28a", img: "../images/cars/thumbs/lexus.webp" },
    { id: "telesales", title: "Telesales", short: "Telesales", brand: "TOYOTA", sub: "All other advisors", color: "#22c3d6", img: "../images/cars/thumbs/camry.webp" },
    { id: "b2c", title: "B2C Sales", short: "B2C", brand: "TOYOTA", sub: "Not Assigned · API-PATCH", color: "#a78bfa", img: "../images/cars/thumbs/fortuner.webp" },
    { id: "guest", title: "Experience Automall", short: "Automall", brand: "TOYOTA", sub: "Guest Experience Center", color: "#f2b24c", img: "../images/cars/thumbs/alj-register.webp" },
  ];
  const CH_INDEX = Object.fromEntries(CHANNELS.map((c, i) => [c.id, i]));
  const NCH = CHANNELS.length;
  const BIT_DEL = 1;
  const BIT_PRO = 2;
  const BIT_DEL_PREV = 4;
  const BIT_PRO_PREV = 8;
  const COLOR_DEL = "#34d399";
  const COLOR_PRO = "#5aa9ff";
  const DATE_PRESETS = [
    { v: "today", l: "Today · MTD" },
    { v: "this_month", l: "This month" },
    { v: "last_month", l: "Last month" },
    { v: "all", l: "All dates" },
    { v: "custom", l: "Custom range" },
  ];

  const state = {
    host: null,
    root: null,
    src: null,
    ctx: {},
    norm: null,
    dateCache: new Map(),
    baseCache: new Map(),
    filters: { showroom: "", model: "", channel: "" },
    live: null,
    liveKey: "",
    period: "month",
    prevMonthKey: "",
    base: null,
    view: null,
    chartBar: null,
    chartRing: null,
    refreshing: false,
    debug: /[?&]scdebug=1\b/.test(global.location ? global.location.search : ""),
    perf: {},
    modal: { views: [], active: 0, search: "" },
    optionsSig: "",
  };

  const fmtInt = new Intl.NumberFormat("en-US");
  const n = (v) => fmtInt.format(Math.round(Number(v) || 0));
  const pct1 = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ratioOf = (del, pro) => (del + pro > 0 ? (del / (del + pro)) * 100 : null);
  const now = () => (global.performance ? global.performance.now() : Date.now());

  // ==================== Normalize once ====================

  const sigOf = (src) => `${src.rows.length}|${src.guestSig || ""}`;

  /** Classification pass, resumable so it can run in idle slices before the page is opened. */
  function startNormalize(src) {
    const len = src.rows.length;
    return {
      src, rows: src.rows, sig: sigOf(src), len, i: 0, ms: 0,
      bucket: new Uint8Array(len), showroomId: new Int32Array(len), modelId: new Int32Array(len),
      showrooms: [], models: [], sDict: new Map(), mDict: new Map(),
    };
  }

  function runNormalize(job, keepGoing) {
    const t0 = now();
    const { src, rows, len, bucket, showroomId, modelId, showrooms, models, sDict, mDict } = job;
    const idOf = (dict, list, v) => {
      let id = dict.get(v);
      if (id == null) { id = list.length; dict.set(v, id); list.push(v); }
      return id;
    };
    let i = job.i;
    while (i < len) {
      const end = Math.min(len, i + 250);
      for (; i < end; i += 1) {
        const c = src.classify(rows[i]);
        bucket[i] = CH_INDEX[c.bucket] != null ? CH_INDEX[c.bucket] : 255;
        showroomId[i] = idOf(sDict, showrooms, c.showroom);
        modelId[i] = idOf(mDict, models, c.model);
      }
      if (keepGoing && !keepGoing()) break;
    }
    job.i = i;
    job.ms += now() - t0;
    return i >= len;
  }

  function normalize(src, job) {
    const j = job && job.rows === src.rows && job.sig === sigOf(src) ? job : startNormalize(src);
    runNormalize(j);
    const t0 = now();
    const { rows, len, bucket, showroomId, modelId, showrooms, models, sDict, mDict } = j;
    const showroomIndex = showrooms.map(() => []);
    const modelIndex = models.map(() => []);
    const channelIndex = CHANNELS.map(() => []);
    for (let i = 0; i < len; i += 1) {
      showroomIndex[showroomId[i]].push(i);
      modelIndex[modelId[i]].push(i);
      if (bucket[i] < NCH) channelIndex[bucket[i]].push(i);
    }
    const sortedIds = (list) => list.map((v, id) => ({ v, id })).filter((x) => x.v && x.v !== "—").sort((a, b) => a.v.localeCompare(b.v));
    state.perf.normalizeMs = j.ms + (now() - t0);
    return {
      rows, len, bucket, showroomId, modelId, showrooms, models, sDict, mDict,
      showroomIndex, modelIndex, channelIndex,
      showroomOptions: sortedIds(showrooms),
      modelOptions: sortedIds(models),
      records: new Array(len),
      sig: j.sig,
      rowsRef: rows,
    };
  }

  function adoptNorm(src, norm) {
    state.src = src;
    state.norm = norm;
    state.dateCache.clear();
    state.baseCache.clear();
  }

  let prepJob = null;

  /** Normalize in idle slices after data loads so opening the page does not pay for classification. */
  function prepare(source) {
    if (!source || !source.rows || !source.rows.length) return;
    const sig = sigOf(source);
    if (state.norm && state.norm.rowsRef === source.rows && state.norm.sig === sig) return;
    if (prepJob && prepJob.rows === source.rows && prepJob.sig === sig) return;
    const job = startNormalize(source);
    prepJob = job;
    const idle = global.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 30));
    const step = (deadline) => {
      if (prepJob !== job) return;
      const done = runNormalize(job, () => deadline.timeRemaining() > 3);
      if (!done) { idle(step, { timeout: 1000 }); return; }
      prepJob = null;
      adoptNorm(source, normalize(source, job));
      state.perf.prepared = true;
    };
    idle(step, { timeout: 1000 });
  }

  function recordOf(i) {
    const norm = state.norm;
    if (!norm.records[i]) {
      const rec = state.src.vinRecord(norm.rows[i]);
      rec.channel = norm.bucket[i] < NCH ? CHANNELS[norm.bucket[i]].short : "—";
      rec.i = i;
      norm.records[i] = rec;
    }
    return norm.records[i];
  }

  // ==================== Date flags (cached per period) ====================

  function liveKeyOf(live, period, prevMonthKey) {
    const t = (d) => (d instanceof Date ? d.getTime() : String(d || ""));
    return [live.preset, live.filterMode, t(live.rangeFrom), t(live.rangeTo), t(live.prevRangeFrom), t(live.prevRangeTo), live.dayUsesRange ? 1 : 0, live.monthKey, period, prevMonthKey].join("|");
  }

  function dateFlags() {
    const key = state.liveKey;
    let flags = state.dateCache.get(key);
    if (flags) { state.perf.datesMs = 0; return flags; }
    const t0 = now();
    const { rows, len } = state.norm;
    const { isDelivery, isProforma } = state.src;
    const live = state.live;
    const period = state.period;
    const pmk = state.prevMonthKey;
    flags = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      const r = rows[i];
      let f = 0;
      if (isDelivery(r, live, period, pmk)) f |= BIT_DEL;
      if (isProforma(r, live, period, pmk)) f |= BIT_PRO;
      if (isDelivery(r, live, "prev", pmk)) f |= BIT_DEL_PREV;
      if (isProforma(r, live, "prev", pmk)) f |= BIT_PRO_PREV;
      flags[i] = f;
    }
    if (state.dateCache.size >= 8) state.dateCache.delete(state.dateCache.keys().next().value);
    state.dateCache.set(key, flags);
    state.perf.datesMs = now() - t0;
    return flags;
  }

  // ==================== Filter + aggregate (cached per combination) ====================

  function candidates(sId, mId) {
    const norm = state.norm;
    if (sId < 0 && mId < 0) return null;
    if (sId >= 0 && mId >= 0) {
      const a = norm.showroomIndex[sId];
      const b = norm.modelIndex[mId];
      const [small, other, arr] = a.length <= b.length ? [a, mId, norm.modelId] : [b, sId, norm.showroomId];
      return small.filter((i) => arr[i] === other);
    }
    return sId >= 0 ? norm.showroomIndex[sId] : norm.modelIndex[mId];
  }

  function computeBase() {
    const norm = state.norm;
    const f = state.filters;
    const sId = f.showroom ? (norm.sDict.has(f.showroom) ? norm.sDict.get(f.showroom) : -2) : -1;
    const mId = f.model ? (norm.mDict.has(f.model) ? norm.mDict.get(f.model) : -2) : -1;
    const key = `${state.liveKey}#${sId}#${mId}`;
    const hit = state.baseCache.get(key);
    if (hit) { state.perf.computeMs = 0; state.perf.cacheHit = true; return hit; }
    const t0 = now();
    const flags = dateFlags();
    const counts = new Int32Array(NCH * 4);
    const lists = CHANNELS.map(() => ({ del: [], pro: [] }));
    const modelAgg = new Map();
    const showroomAgg = new Map();
    const bump = (map, id, ch, metric) => {
      let a = map.get(id);
      if (!a) { a = new Int32Array(NCH * 2); map.set(id, a); }
      a[ch * 2 + metric] += 1;
    };
    const visit = (i) => {
      const ch = norm.bucket[i];
      const fl = flags[i];
      if (ch >= NCH || !fl) return;
      const o = ch * 4;
      if (fl & BIT_DEL) { counts[o] += 1; lists[ch].del.push(i); bump(modelAgg, norm.modelId[i], ch, 0); bump(showroomAgg, norm.showroomId[i], ch, 0); }
      if (fl & BIT_PRO) { counts[o + 1] += 1; lists[ch].pro.push(i); bump(modelAgg, norm.modelId[i], ch, 1); bump(showroomAgg, norm.showroomId[i], ch, 1); }
      if (fl & BIT_DEL_PREV) counts[o + 2] += 1;
      if (fl & BIT_PRO_PREV) counts[o + 3] += 1;
    };
    if (sId === -2 || mId === -2) { /* filter value no longer in data → empty */ } else {
      const list = candidates(sId, mId);
      if (list) for (let k = 0; k < list.length; k += 1) visit(list[k]);
      else for (let i = 0; i < norm.len; i += 1) visit(i);
    }
    const base = { key, counts, lists, modelAgg, showroomAgg, sId, mId };
    if (state.baseCache.size >= 60) state.baseCache.delete(state.baseCache.keys().next().value);
    state.baseCache.set(key, base);
    state.perf.computeMs = now() - t0;
    state.perf.cacheHit = false;
    return base;
  }

  /** Channel filter is a view over the cached base (no re-aggregation). */
  function buildView(base) {
    const c = base.counts;
    const channels = CHANNELS.map((ch, i) => ({
      ...ch,
      delivered: c[i * 4], proforma: c[i * 4 + 1], prevDelivered: c[i * 4 + 2], prevProforma: c[i * 4 + 3],
    }));
    const sel = state.filters.channel;
    const scope = sel ? channels.filter((x) => x.id === sel) : channels;
    const sum = (k) => scope.reduce((s, x) => s + x[k], 0);
    const del = sum("delivered");
    const pro = sum("proforma");
    const pDel = sum("prevDelivered");
    const pPro = sum("prevProforma");
    const ratio = ratioOf(del, pro);
    const prevRatio = ratioOf(pDel, pPro);
    const trend = state.ctx.trendPct;
    const allDel = channels.reduce((s, x) => s + x.delivered, 0);
    const top = channels.slice().sort((a, b) => b.delivered - a.delivered)[0];
    const scopeIdx = sel ? [CH_INDEX[sel]] : CHANNELS.map((_, i) => i);
    const models = [];
    base.modelAgg.forEach((a, id) => {
      let d = 0; let p = 0;
      scopeIdx.forEach((ci) => { d += a[ci * 2]; p += a[ci * 2 + 1]; });
      if (d || p) models.push({ id, name: state.norm.models[id], delivered: d, proforma: p });
    });
    models.sort((a, b) => b.delivered - a.delivered || b.proforma - a.proforma || a.name.localeCompare(b.name));
    return {
      channels, scopeIdx, allDel, top,
      totals: {
        delivered: del, proforma: pro, prevDelivered: pDel, prevProforma: pPro, ratio,
        delTrend: trend(del, pDel), proTrend: trend(pro, pPro),
        ratioTrend: ratio != null && prevRatio != null ? ratio - prevRatio : null,
      },
      models,
    };
  }

  // ==================== Skeleton (built once) ====================

  function build(host) {
    const cards = CHANNELS.map((c) => `
      <article class="sc-card gec-surface" style="--c:${c.color}" data-ch="${c.id}">
        <button type="button" class="sc-card-head" data-drill="channel" data-ch="${c.id}" title="Open ${esc(c.title)} details">
          <span class="sc-card-brand">${c.brand}</span>
          <span class="sc-card-title"><strong>${esc(c.title)}</strong><em>${esc(c.sub)}</em></span>
          <img class="sc-card-img" alt="" loading="lazy" decoding="async" fetchpriority="low" width="120" height="64" data-src="${c.img}" />
        </button>
        <div class="sc-card-nums">
          <button type="button" class="sc-num is-del" data-drill="records" data-ch="${c.id}" data-metric="delivered" title="${esc(c.title)} · delivered VINs"><span>Delivered</span><b class="gec-num" data-v="del"></b></button>
          <button type="button" class="sc-num is-pro" data-drill="records" data-ch="${c.id}" data-metric="proforma" title="${esc(c.title)} · pro-forma VINs"><span>Pro-Forma</span><b class="gec-num" data-v="pro"></b></button>
          <div class="sc-num is-ratio" title="Delivered ÷ (Delivered + Pro-Forma)"><span>Ratio</span><b class="gec-num" data-v="ratio"></b></div>
        </div>
        <div class="sc-card-bar" aria-hidden="true"><i class="d" data-v="bar-del"></i><i class="p" data-v="bar-pro"></i></div>
        <div class="sc-card-status"><span data-v="status-ico"></span><b data-v="status"></b><em data-v="status-tip"></em></div>
      </article>`).join("");

    host.innerHTML = `
      <div class="gec-root sc-root" role="application" aria-label="Sales Control Center">
        <header class="gec-header gec-surface">
          <div class="gec-h-row">
            <div class="gec-brand">
              <span class="gec-brand-mark" aria-hidden="true"></span>
              <div><strong>SALES CONTROL CENTER</strong><span>Delivered vs Pro-Forma</span></div>
            </div>
            <div class="gec-range" title="Reporting period">
              <strong class="gec-num" data-el="range">—</strong>
              <span class="gec-range-sub" data-el="range-sub"></span>
            </div>
            <div class="gec-actions">
              <span class="gec-live is-off" data-el="live"><i></i>LIVE</span>
              <span class="gec-updated" data-el="updated-wrap">Updated <b data-el="updated">—</b></span>
              <button type="button" class="gec-btn is-debug" data-act="parity" data-el="debug-btn" title="Parity check vs previous calculation (Ctrl+Shift+D)" hidden>Parity</button>
              <button type="button" class="gec-btn" data-act="refresh" data-el="refresh" title="Fetch the latest Admin Push">↻ Refresh</button>
              <button type="button" class="gec-btn is-icon" data-act="fullscreen" title="Fullscreen" aria-label="Fullscreen">⛶</button>
              <button type="button" class="gec-btn is-icon is-exit" data-act="exit" title="Back to report" aria-label="Back to report">✕</button>
            </div>
          </div>
          <div class="gec-filters">
            <label class="gec-filter" data-fwrap="date"><span>Date</span>
              <select data-f="preset" aria-label="Date range">${DATE_PRESETS.map((p) => `<option value="${p.v}">${p.l}</option>`).join("")}</select>
              <span class="sc-custom" data-el="custom" hidden><input type="date" data-f="from" aria-label="From date" /><em class="gec-to">→</em><input type="date" data-f="to" aria-label="To date" /></span>
            </label>
            <label class="gec-filter" data-fwrap="showroom"><span>Showroom</span><select data-f="showroom" dir="auto"></select></label>
            <label class="gec-filter" data-fwrap="model"><span>Model</span><select data-f="model" dir="auto"></select></label>
            <label class="gec-filter" data-fwrap="channel"><span>Channel</span><select data-f="channel">
              <option value="">All channels</option>${CHANNELS.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join("")}</select></label>
            <button type="button" class="gec-btn" data-act="reset">Reset</button>
            <span class="gec-filter-note" data-el="note"></span>
          </div>
        </header>

        <section class="gec-kpis sc-kpis" data-el="kpis" style="--kpi-count:6">
          ${kpiShell("delivered", "Total Delivered", COLOR_DEL, true)}
          ${kpiShell("proforma", "Total Pro-Forma", COLOR_PRO, true)}
          ${kpiShell("ratio", "Delivery / Pro-Forma", "var(--gec-conv)", true)}
          ${kpiShell("prevDelivered", "Delivered · last period", "var(--gec-muted)", true)}
          ${kpiShell("prevProforma", "Pro-Forma · last period", "var(--gec-muted)", true)}
          ${kpiShell("top", "Top Channel", "var(--gec-so)", true)}
        </section>

        <section class="sc-channels">${cards}</section>

        <section class="sc-main">
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Delivered vs Pro-Forma <span>by channel · click a bar for VINs</span></h2>
              <div class="gec-legend"><span><i style="background:${COLOR_DEL}"></i>Delivered</span><span><i style="background:${COLOR_PRO}"></i>Pro-Forma</span></div>
            </div>
            <div class="gec-chart"><canvas data-el="bar" aria-label="Delivered and pro-forma by channel"></canvas></div>
          </article>
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head"><h2>Channel Distribution <span>delivered</span></h2></div>
            <div class="sc-ring">
              <div class="sc-ring-chart"><canvas data-el="ring" aria-label="Delivered share by channel"></canvas>
                <div class="sc-ring-center" data-drill="records" data-ch="all" data-metric="delivered" role="button" tabindex="0" title="All delivered VINs"><b class="gec-num" data-el="ring-total">0</b><span data-el="ring-label">Total delivered</span></div>
              </div>
              <ul class="sc-ring-legend" data-el="ring-legend">${CHANNELS.map((c) => `
                <li><button type="button" data-drill="records" data-ch="${c.id}" data-metric="delivered" style="--c:${c.color}" title="${esc(c.title)} · delivered VINs">
                  <i></i><span class="nm">${esc(c.short)}</span><b class="gec-num" data-v="ring-${c.id}">0</b><em class="gec-num" data-v="ring-pct-${c.id}">0%</em></button></li>`).join("")}</ul>
            </div>
          </article>
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Models <span>delivered · pro-forma</span></h2>
              <button type="button" class="gec-link" data-drill="models" data-el="models-all"></button>
            </div>
            <div class="sc-models" data-el="models"></div>
          </article>
        </section>

        <footer class="gec-alerts gec-surface sc-foot">
          <span class="gec-alerts-title">Rules</span>
          <span class="sc-rule"><b style="color:${CHANNELS[0].color}">Lexus</b> product codes / Lexus plant</span>
          <span class="sc-rule"><b style="color:${CHANNELS[2].color}">B2C</b> Col A Not Assigned · API-PATCH</span>
          <span class="sc-rule"><b style="color:${CHANNELS[3].color}">Automall</b> Guest Exp advisors (Admin) <em data-el="guest-count"></em></span>
          <span class="sc-rule"><b style="color:${CHANNELS[1].color}">Telesales</b> everyone else</span>
          <span class="sc-rule">Pro-Forma = Col P in period with Col V blank · Delivered = Col V in period</span>
          <span class="gec-foot-meta" data-el="perf"></span>
        </footer>

        <div class="gec-empty gec-surface" data-el="empty" hidden></div>

        <div class="gec-modal" data-el="modal" hidden>
          <div class="gec-modal-card" role="dialog" aria-modal="true" aria-labelledby="sc-modal-title">
            <div class="gec-modal-head">
              <div><h3 id="sc-modal-title" data-el="m-title"></h3><p data-el="m-sub"></p></div>
              <div class="gec-modal-tools">
                <input type="search" data-el="m-search" placeholder="Search VIN, advisor, model…" aria-label="Search records" />
                <button type="button" class="gec-btn" data-act="copy" data-el="m-copy">Copy VINs</button>
                <button type="button" class="gec-btn" data-act="modal-close">Close</button>
              </div>
            </div>
            <div class="gec-modal-stats" data-el="m-stats"></div>
            <div class="gec-modal-tabs" data-el="m-tabs"></div>
            <div class="gec-modal-body" data-el="m-body"></div>
            <div class="gec-modal-foot" data-el="m-foot"></div>
          </div>
        </div>
      </div>`;
    state.host = host;
    state.root = host.querySelector(".sc-root");
    state.els = {};
    state.root.querySelectorAll("[data-el]").forEach((e) => { state.els[e.dataset.el] = e; });
    state.cardEls = {};
    state.root.querySelectorAll(".sc-card").forEach((card) => {
      const v = {};
      card.querySelectorAll("[data-v]").forEach((e) => { v[e.dataset.v] = e; });
      state.cardEls[card.dataset.ch] = { card, v };
    });
    state.ringEls = {};
    state.root.querySelectorAll("[data-v^='ring-']").forEach((e) => { state.ringEls[e.dataset.v] = e; });
    state.kpiEls = {};
    state.root.querySelectorAll(".sc-kpis .gec-kpi").forEach((k) => {
      state.kpiEls[k.dataset.key] = { card: k, val: k.querySelector(".gec-kpi-val"), sub: k.querySelector(".gec-kpi-sub"), meter: k.querySelector(".gec-kpi-meter i") };
    });
    state.modelsSig = "";
    bindEvents();
    watchModelsBox();
    loadImagesWhenIdle();
  }

  function kpiShell(key, label, color, clickable) {
    return `<div class="gec-kpi gec-surface" style="--k:${color}" data-key="${key}"${clickable ? ` role="button" tabindex="0" data-drill="kpi"` : ""}>
      <span class="gec-kpi-lab">${esc(label)}</span>
      <span class="gec-kpi-val gec-num">—</span>
      <span class="gec-kpi-sub"></span>
      <span class="gec-kpi-meter"><i style="--p:0%"></i></span>
    </div>`;
  }

  /** Channel images never block first paint: assigned after the dashboard is interactive. */
  function loadImagesWhenIdle() {
    const go = () => state.root.querySelectorAll("img[data-src]").forEach((img) => {
      img.onerror = () => { img.hidden = true; };
      img.onload = () => img.classList.add("is-loaded");
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
    });
    if (global.requestIdleCallback) global.requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 300);
  }

  const $el = (name) => state.els[name];

  function bindEvents() {
    const root = state.root;
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) { onAction(act); return; }
      const drill = e.target.closest("[data-drill]");
      if (drill) { onDrill(drill.dataset); return; }
      const row = e.target.closest("tr[data-row]");
      if (row) { onModalRow(Number(row.dataset.row)); return; }
      if (e.target === $el("modal")) closeModal();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$el("modal").hidden) { e.stopPropagation(); closeModal(); return; }
      if (e.key !== "Enter" && e.key !== " ") return;
      const drill = e.target.closest && e.target.closest("[data-drill]");
      if (drill && !/^(BUTTON|SELECT|INPUT)$/.test(e.target.tagName)) { e.preventDefault(); onDrill(drill.dataset); return; }
      if (e.target.matches("tr[data-row]")) { e.preventDefault(); onModalRow(Number(e.target.dataset.row)); }
    });
    root.addEventListener("change", (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      if (f === "preset" || f === "from" || f === "to") onDateChange(f);
      else setFilter(f, e.target.value || "");
    });
    let searchTimer = 0;
    $el("m-search").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.modal.search = e.target.value; renderModalTable(); }, 90);
    });
    document.addEventListener("keydown", (e) => {
      if (!state.root || !state.root.getClientRects().length) return;
      if (e.key === "Escape" && !$el("modal").hidden) closeModal();
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        state.debug = !state.debug;
        $el("debug-btn").hidden = !state.debug;
        if (state.debug) openParity();
      }
    });
  }

  function onAction(node) {
    const act = node.dataset.act;
    if (act === "refresh") doRefresh();
    else if (act === "exit") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (typeof state.ctx.onExit === "function") state.ctx.onExit();
    } else if (act === "fullscreen") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (act === "reset") {
      state.filters = { showroom: "", model: "", channel: "" };
      update();
    } else if (act === "modal-close") closeModal();
    else if (act === "copy") copyVins();
    else if (act === "parity") openParity();
    else if (act === "modal-tab") {
      state.modal.active = Number(node.dataset.tab) || 0;
      state.modal.search = "";
      $el("m-search").value = "";
      renderModalTable();
    }
  }

  // ==================== Filters ====================

  function setFilter(key, value) {
    state.filters[key] = value;
    update();
  }

  function onDateChange(which) {
    const preset = state.root.querySelector('[data-f="preset"]').value;
    const from = state.root.querySelector('[data-f="from"]').value;
    const to = state.root.querySelector('[data-f="to"]').value;
    $el("custom").hidden = preset !== "custom";
    if (preset === "custom") {
      if (which === "preset" && (!from || !to)) {
        const b = dateBounds();
        if (b.min && !from) state.root.querySelector('[data-f="from"]').value = b.min;
        if (b.max && !to) state.root.querySelector('[data-f="to"]').value = b.max;
      }
      const f2 = state.root.querySelector('[data-f="from"]').value;
      const t2 = state.root.querySelector('[data-f="to"]').value;
      if (!f2 || !t2 || f2 > t2) { $el("note").textContent = "Select a valid From → To range"; return; }
      applyDate({ preset, from: f2, to: t2 });
    } else applyDate({ preset, from: "", to: "" });
  }

  function applyDate(filter) {
    if (typeof state.ctx.setDateFilter !== "function") return;
    const live = state.ctx.setDateFilter(filter);
    state.ctx.dateFilter = filter;
    setLive(live);
    update();
  }

  let boundsCache = { ref: null, v: { min: "", max: "" } };
  function dateBounds() {
    if (boundsCache.ref !== state.norm.rowsRef) {
      const b = typeof state.ctx.dateBounds === "function" ? state.ctx.dateBounds() : {};
      boundsCache = { ref: state.norm.rowsRef, v: { min: b.min || "", max: b.max || "" } };
    }
    return boundsCache.v;
  }

  function setLive(live) {
    state.live = live || {};
    state.period = state.ctx.periodOf(state.live);
    state.prevMonthKey = state.ctx.prevMonthKeyOf(state.live);
    state.liveKey = liveKeyOf(state.live, state.period, state.prevMonthKey);
  }

  function fillOptions() {
    const norm = state.norm;
    const sig = norm.sig + "|" + norm.showrooms.length + "|" + norm.models.length;
    const f = state.filters;
    if (f.showroom && !norm.sDict.has(f.showroom)) f.showroom = "";
    if (f.model && !norm.mDict.has(f.model)) f.model = "";
    const sSel = state.root.querySelector('[data-f="showroom"]');
    const mSel = state.root.querySelector('[data-f="model"]');
    if (sig !== state.optionsSig) {
      state.optionsSig = sig;
      sSel.innerHTML = `<option value="">All showrooms</option>` + norm.showroomOptions.map((o) => `<option value="${esc(o.v)}">${esc(o.v)}</option>`).join("");
      mSel.innerHTML = `<option value="">All models</option>` + norm.modelOptions.map((o) => `<option value="${esc(o.v)}">${esc(o.v)}</option>`).join("");
    }
    sSel.value = f.showroom;
    mSel.value = f.model;
    state.root.querySelector('[data-f="channel"]').value = f.channel;
    const df = state.ctx.dateFilter || {};
    const preset = df.preset || "today";
    state.root.querySelector('[data-f="preset"]').value = preset;
    $el("custom").hidden = preset !== "custom";
    const fromEl = state.root.querySelector('[data-f="from"]');
    const toEl = state.root.querySelector('[data-f="to"]');
    if (preset === "custom") { fromEl.value = df.from || ""; toEl.value = df.to || ""; }
    const b = dateBounds();
    [fromEl, toEl].forEach((el) => { el.min = b.min; el.max = b.max; });
    ["showroom", "model", "channel"].forEach((k) => state.root.querySelector(`[data-fwrap="${k}"]`).classList.toggle("is-active", !!f[k]));
    state.root.querySelector('[data-fwrap="date"]').classList.toggle("is-active", preset !== "today");
  }

  // ==================== Update (only affected nodes) ====================

  function update() {
    if (!state.norm || !state.root) return;
    const t0 = now();
    const steps = {};
    let tp = t0;
    const lap = (name) => { const t = now(); steps[name] = +(t - tp).toFixed(1); tp = t; };
    state.base = computeBase();
    state.view = buildView(state.base);
    lap("compute");
    fillOptions();
    renderHeader();
    renderKpis();
    renderCards();
    lap("dom");
    renderBar();
    lap("bar");
    renderRing();
    lap("ring");
    renderModels();
    lap("models");
    state.perf.renderMs = now() - t0;
    state.perf.steps = steps;
    const p = state.perf;
    $el("perf").textContent = `${n(state.norm.len)} rows · update ${p.renderMs.toFixed(0)} ms${p.cacheHit ? " · cached" : ""}`;
  }

  function renderHeader() {
    const live = state.live;
    $el("range").textContent = state.ctx.periodLabel(live, state.period);
    $el("range-sub").textContent = live.prevMonthLabel ? `vs ${live.prevMonthLabel}` : "";
    const lv = $el("live");
    lv.classList.toggle("is-off", state.refreshing);
    lv.lastChild.textContent = state.refreshing ? "SYNCING" : "LIVE";
    const at = Number(state.ctx.lastUpdated) || 0;
    if (!state.refreshing) $el("updated").textContent = at ? new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";
    const t = state.view.totals;
    const f = state.filters;
    const parts = [f.showroom, f.model, f.channel ? CHANNELS[CH_INDEX[f.channel]].title : ""].filter(Boolean);
    $el("note").textContent = `${n(t.delivered + t.proforma)} VINs in scope${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
    $el("guest-count").textContent = state.src.guestCount ? `· ${state.src.guestCount} marked` : "· none marked yet";
  }

  /** Count-up tween on changed numbers (skipped for large jumps in hidden tabs). */
  function setNum(el, value, format) {
    const fmt = format || n;
    const from = el._v;
    el._v = value;
    if (from == null || value == null || !Number.isFinite(from) || !Number.isFinite(value) || from === value || document.hidden) {
      el.textContent = value == null ? "—" : fmt(value);
      return;
    }
    const start = now();
    const dur = 240;
    const token = (el._t = (el._t || 0) + 1);
    const step = () => {
      if (el._t !== token) return;
      const k = Math.min(1, (now() - start) / dur);
      const e = 1 - (1 - k) * (1 - k);
      el.textContent = fmt(from + (value - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function trendHtml(delta, unit) {
    if (delta == null || !Number.isFinite(delta)) return `<span class="sc-trend is-flat">— vs last period</span>`;
    const up = delta >= 0;
    const abs = Math.abs(delta);
    const txt = `${up ? "+" : "−"}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)}${unit || "%"}`;
    return `<span class="sc-trend ${up ? "is-up" : "is-down"}">${up ? "▲" : "▼"} ${txt}</span> vs last period`;
  }

  function renderKpis() {
    const v = state.view;
    const t = v.totals;
    const k = state.kpiEls;
    const meter = (key, p) => k[key].meter.style.setProperty("--p", `${(Math.max(0, Math.min(1, p || 0)) * 100).toFixed(1)}%`);
    const scopeTotal = t.delivered + t.proforma;
    setNum(k.delivered.val, t.delivered);
    k.delivered.sub.innerHTML = trendHtml(t.delTrend);
    meter("delivered", scopeTotal ? t.delivered / scopeTotal : 0);
    setNum(k.proforma.val, t.proforma);
    k.proforma.sub.innerHTML = trendHtml(t.proTrend);
    meter("proforma", scopeTotal ? t.proforma / scopeTotal : 0);
    setNum(k.ratio.val, t.ratio, (x) => `${x.toFixed(1)}%`);
    k.ratio.sub.innerHTML = trendHtml(t.ratioTrend, " pts");
    meter("ratio", (t.ratio || 0) / 100);
    setNum(k.prevDelivered.val, t.prevDelivered);
    k.prevDelivered.sub.textContent = state.live.prevMonthLabel || "Previous period";
    meter("prevDelivered", t.prevDelivered && t.delivered ? Math.min(1, t.delivered / t.prevDelivered) : 0);
    setNum(k.prevProforma.val, t.prevProforma);
    k.prevProforma.sub.textContent = state.live.prevMonthLabel || "Previous period";
    meter("prevProforma", t.prevProforma && t.proforma ? Math.min(1, t.proforma / t.prevProforma) : 0);
    const top = v.top;
    k.top.val.textContent = top && top.delivered ? top.short : "—";
    k.top.card.style.setProperty("--k", top && top.delivered ? top.color : "var(--gec-muted)");
    k.top.sub.innerHTML = top && top.delivered ? `<b>${n(top.delivered)}</b> delivered · ${pct1(v.allDel ? (top.delivered / v.allDel) * 100 : null)} share` : "No deliveries in period";
    meter("top", v.allDel && top ? top.delivered / v.allDel : 0);
  }

  function renderCards() {
    const v = state.view;
    const sel = state.filters.channel;
    const max = Math.max(1, ...v.channels.map((c) => Math.max(c.delivered, c.proforma)));
    v.channels.forEach((c) => {
      const { card, v: e } = state.cardEls[c.id];
      card.classList.toggle("is-selected", sel === c.id);
      card.classList.toggle("is-dim", !!sel && sel !== c.id);
      setNum(e.del, c.delivered);
      setNum(e.pro, c.proforma);
      const r = ratioOf(c.delivered, c.proforma);
      e.ratio.textContent = pct1(r);
      e["bar-del"].style.width = `${((c.delivered / max) * 100).toFixed(1)}%`;
      e["bar-pro"].style.width = `${((c.proforma / max) * 100).toFixed(1)}%`;
      const st = state.ctx.statusFor(c.delivered, c.proforma, c.id);
      e["status-ico"].textContent = st.icon;
      e.status.textContent = st.title;
      e["status-tip"].textContent = st.tip;
      e["status-tip"].title = st.tip;
    });
  }

  // ==================== Charts (created once, datasets updated) ====================

  const valueLabels = {
    id: "scValueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'Space Grotesk', 'Manrope', sans-serif";
      ctx.textBaseline = "middle";
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const val = ds.data[i];
          if (!val) return;
          const w = Math.abs(bar.x - bar.base);
          const txt = n(val);
          const tw = ctx.measureText(txt).width;
          if (w < tw + 10) return;
          ctx.fillStyle = "rgba(7,11,18,0.92)";
          ctx.textAlign = "center";
          ctx.fillText(txt, (bar.x + bar.base) / 2, bar.y);
        });
      });
      ctx.restore();
    },
  };

  const TOOLTIP = {
    backgroundColor: "rgba(10,16,27,0.96)", borderColor: "rgba(148,163,184,0.25)", borderWidth: 1,
    titleColor: "#e7edf6", bodyColor: "#c9d3e1", padding: 10, boxPadding: 4, usePointStyle: true,
  };

  function renderBar() {
    if (typeof global.Chart === "undefined") return;
    const v = state.view;
    const sel = state.filters.channel;
    const alpha = (hex, on) => (on ? hex : `${hex}40`);
    const del = v.channels.map((c) => c.delivered);
    const pro = v.channels.map((c) => c.proforma);
    const delBg = v.channels.map((c) => alpha(COLOR_DEL, !sel || sel === c.id));
    const proBg = v.channels.map((c) => alpha(COLOR_PRO, !sel || sel === c.id));
    if (state.chartBar && state.chartBar.canvas === $el("bar")) {
      const [d0, d1] = state.chartBar.data.datasets;
      d0.data = del; d0.backgroundColor = delBg;
      d1.data = pro; d1.backgroundColor = proBg;
      state.chartBar.update();
      return;
    }
    state.chartBar = new global.Chart($el("bar").getContext("2d"), {
      type: "bar",
      data: {
        labels: CHANNELS.map((c) => c.short),
        datasets: [
          { label: "Delivered", data: del, backgroundColor: delBg, borderRadius: 5, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.86 },
          { label: "Pro-Forma", data: pro, backgroundColor: proBg, borderRadius: 5, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.86 },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 260 },
        layout: { padding: { right: 8 } },
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          legend: { display: false },
          tooltip: { ...TOOLTIP, callbacks: { footer: () => "click for VINs" } },
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: "rgba(148,163,184,0.08)" }, border: { display: false }, ticks: { color: "#6f7d92", font: { size: 11 }, precision: 0, maxTicksLimit: 7 } },
          y: { stacked: true, grid: { display: false }, border: { color: "rgba(148,163,184,0.18)" }, ticks: { color: "#c9d3e1", font: { size: 12.5, weight: "600" } } },
        },
        onClick: (_e, els) => {
          if (!els.length) return;
          openRecords(CHANNELS[els[0].index].id, els[0].datasetIndex === 1 ? "proforma" : "delivered");
        },
        onHover: (evt, els) => { const t = evt.native && evt.native.target; if (t) t.style.cursor = els.length ? "pointer" : "default"; },
      },
      plugins: [valueLabels],
    });
  }

  function renderRing() {
    const v = state.view;
    const sel = state.filters.channel;
    const total = v.allDel;
    setNum($el("ring-total"), total);
    $el("ring-label").textContent = sel ? "All channels · delivered" : "Total delivered";
    v.channels.forEach((c) => {
      setNum(state.ringEls[`ring-${c.id}`], c.delivered);
      state.ringEls[`ring-pct-${c.id}`].textContent = total ? `${((c.delivered / total) * 100).toFixed(1)}%` : "0.0%";
      state.ringEls[`ring-${c.id}`].closest("li").classList.toggle("is-dim", !!sel && sel !== c.id);
    });
    if (typeof global.Chart === "undefined") return;
    const data = v.channels.map((c) => c.delivered);
    const bg = v.channels.map((c) => (!sel || sel === c.id ? c.color : `${c.color}33`));
    const offset = v.channels.map((c) => (sel === c.id ? 8 : 0));
    const empty = !total;
    if (state.chartRing && state.chartRing.canvas === $el("ring")) {
      const ds = state.chartRing.data.datasets[0];
      ds.data = empty ? [1] : data;
      ds.backgroundColor = empty ? ["rgba(148,163,184,0.12)"] : bg;
      ds.offset = empty ? [0] : offset;
      state.chartRing.data.labels = empty ? ["No deliveries"] : CHANNELS.map((c) => c.title);
      state.chartRing.update();
      return;
    }
    state.chartRing = new global.Chart($el("ring").getContext("2d"), {
      type: "doughnut",
      data: {
        labels: empty ? ["No deliveries"] : CHANNELS.map((c) => c.title),
        datasets: [{ data: empty ? [1] : data, backgroundColor: empty ? ["rgba(148,163,184,0.12)"] : bg, offset: empty ? [0] : offset, borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "74%",
        animation: { duration: 260 },
        layout: { padding: 8 },
        plugins: { legend: { display: false }, tooltip: { ...TOOLTIP, enabled: true } },
        onClick: (_e, els) => { if (els.length && state.view.allDel) openRecords(CHANNELS[els[0].index].id, "delivered"); },
        onHover: (evt, els) => { const t = evt.native && evt.native.target; if (t) t.style.cursor = els.length ? "pointer" : "default"; },
      },
    });
  }

  const MODEL_ROW_PX = 26;

  /** Rows that fit the Models panel; measured by ResizeObserver so updates never force a layout read. */
  function watchModelsBox() {
    const box = $el("models");
    const measure = (h) => {
      const fit = Math.max(3, Math.floor((h || MODEL_ROW_PX * 8) / MODEL_ROW_PX) - 1);
      if (fit === state.modelFit) return;
      state.modelFit = fit;
      state.modelsSig = "";
      if (state.view) renderModels();
    };
    if (global.ResizeObserver) new global.ResizeObserver((entries) => measure(entries[0].contentRect.height)).observe(box);
    else measure(box.clientHeight);
  }

  function renderModels() {
    const box = $el("models");
    const list = state.view.models;
    const fit = state.modelFit || 12;
    const shown = list.slice(0, fit);
    const sig = `${fit}|${list.length}|${shown.map((m) => `${m.id}:${m.delivered}:${m.proforma}`).join(",")}`;
    if (sig === state.modelsSig) return;
    state.modelsSig = sig;
    $el("models-all").textContent = list.length ? `View all ${n(list.length)} →` : "";
    if (!list.length) { box.innerHTML = `<div class="sc-empty-note">No delivered or pro-forma VINs in this selection.</div>`; return; }
    const max = Math.max(1, ...shown.map((m) => m.delivered + m.proforma));
    box.innerHTML = `<div class="sc-mgrid sc-mhead"><span>Model</span><span></span><span class="r">Del.</span><span class="r">P-F</span><span class="r">Ratio</span></div>` +
      shown.map((m) => `<div class="sc-mgrid sc-mrow" role="button" tabindex="0" data-drill="model" data-id="${m.id}" title="${esc(m.name)} — open model details">
        <span class="nm" dir="auto">${esc(m.name)}</span>
        <span class="sc-mbar"><i class="d" style="width:${((m.delivered / max) * 100).toFixed(1)}%"></i><i class="p" style="width:${((m.proforma / max) * 100).toFixed(1)}%"></i></span>
        <span class="r gec-num">${n(m.delivered)}</span><span class="r gec-num muted">${n(m.proforma)}</span><span class="r gec-num rate">${pct1(ratioOf(m.delivered, m.proforma))}</span>
      </div>`).join("");
  }

  // ==================== Refresh ====================

  async function doRefresh() {
    if (state.refreshing || typeof state.ctx.onRefresh !== "function") return;
    state.refreshing = true;
    const btn = $el("refresh");
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    $el("updated").textContent = "syncing…";
    renderHeader();
    try {
      await state.ctx.onRefresh();
    } finally {
      state.refreshing = false;
      btn.disabled = false;
      btn.textContent = "↻ Refresh";
      if (state.root && state.view) renderHeader();
      const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      $el("updated").textContent = t;
    }
  }

  // ==================== Drill-down modal ====================

  const RECORD_COLUMNS = () => [
    { h: "#", v: (r, i) => String(i + 1), num: true },
    { h: "VIN", v: (r) => r.vin, mono: true },
    { h: "Advisor", v: (r) => r.salesman, dir: true },
    { h: "Showroom", v: (r) => r.plant, dir: true },
    { h: "Model", v: (r) => r.product, dir: true },
    { h: "Channel", v: (r) => r.channel },
    { h: "Pro-Forma", v: (r) => (r.proformaDate ? state.ctx.formatDate(r.proformaDate) : "—") },
    { h: "Delivery", v: (r) => (r.deliveryDate ? state.ctx.formatDate(r.deliveryDate) : "—") },
  ];

  const recView = (label, idxList) => ({ label, type: "records", idx: idxList, get rows() { return this._rows || (this._rows = idxList.map(recordOf)); } });

  function scopeLists(metric, chId) {
    const key = metric === "proforma" ? "pro" : "del";
    const ids = chId && chId !== "all" ? [CH_INDEX[chId]] : state.view.scopeIdx;
    return ids.flatMap((ci) => state.base.lists[ci][key]);
  }

  function filterSub() {
    const f = state.filters;
    const bits = [state.ctx.periodLabel(state.live, state.period), f.showroom, f.model].filter(Boolean);
    return bits.join(" · ");
  }

  function onDrill(d) {
    if (d.drill === "records") openRecords(d.ch, d.metric);
    else if (d.drill === "channel") openChannel(d.ch);
    else if (d.drill === "model") openModel(Number(d.id));
    else if (d.drill === "models") openAllModels();
    else if (d.drill === "kpi") openKpi(d.key);
  }

  function openKpi(key) {
    if (key === "delivered" || key === "proforma") openRecords(state.filters.channel || "all", key);
    else if (key === "ratio" || key === "top") openChannelTable();
    else if (key === "prevDelivered" || key === "prevProforma") openPrev(key === "prevDelivered" ? BIT_DEL_PREV : BIT_PRO_PREV);
  }

  function openRecords(chId, metric) {
    const label = metric === "proforma" ? "Pro-Forma" : "Delivered";
    const title = chId && chId !== "all" ? CHANNELS[CH_INDEX[chId]].title : (state.filters.channel ? CHANNELS[CH_INDEX[state.filters.channel]].title : "All channels");
    const idx = scopeLists(metric, chId);
    const views = [recView(`${label}`, idx)];
    if (!chId || chId === "all") {
      state.view.scopeIdx.forEach((ci) => {
        const l = state.base.lists[ci][metric === "proforma" ? "pro" : "del"];
        if (state.view.scopeIdx.length > 1 && l.length) views.push(recView(CHANNELS[ci].short, l));
      });
    }
    openModal({ title: `${title} · ${label}`, sub: `${filterSub()} · Sales Raw VINs`, stats: [{ label: `${label} VINs`, value: n(idx.length) }], views });
  }

  function aggTable(label, map, names, chIdx, onRow) {
    const rows = [];
    map.forEach((a, id) => {
      let d = 0; let p = 0;
      chIdx.forEach((ci) => { d += a[ci * 2]; p += a[ci * 2 + 1]; });
      if (d || p) rows.push({ id, name: names[id], delivered: d, proforma: p });
    });
    rows.sort((a, b) => b.delivered - a.delivered || b.proforma - a.proforma);
    return {
      label: `${label} (${rows.length})`, type: "table", rows,
      columns: [
        { h: label, v: (x) => x.name, dir: true },
        { h: "Delivered", v: (x) => n(x.delivered), num: true },
        { h: "Pro-Forma", v: (x) => n(x.proforma), num: true },
        { h: "Ratio", v: (x) => pct1(ratioOf(x.delivered, x.proforma)), num: true },
      ],
      onRow,
    };
  }

  function channelStats(c) {
    return [
      { label: "Delivered", value: n(c.delivered) },
      { label: "Pro-Forma", value: n(c.proforma) },
      { label: "Ratio", value: pct1(ratioOf(c.delivered, c.proforma)) },
      { label: "Delivered · last period", value: n(c.prevDelivered) },
      { label: "Pro-Forma · last period", value: n(c.prevProforma) },
    ];
  }

  function openChannel(chId) {
    const ci = CH_INDEX[chId];
    const c = state.view.channels[ci];
    const l = state.base.lists[ci];
    openModal({
      title: `${c.title} · channel details`,
      sub: `${filterSub()} · ${c.sub}`,
      stats: channelStats(c),
      views: [
        recView("Delivered", l.del),
        recView("Pro-Forma", l.pro),
        aggTable("Model", state.base.modelAgg, state.norm.models, [ci], (x) => openModel(x.id, ci)),
        aggTable("Showroom", state.base.showroomAgg, state.norm.showrooms, [ci]),
      ],
    });
  }

  function openChannelTable() {
    const rows = state.view.channels;
    openModal({
      title: "Channels · Delivered vs Pro-Forma",
      sub: `${filterSub()} · click a channel`,
      views: [{
        label: "Channels", type: "table", rows,
        columns: [
          { h: "Channel", v: (c) => c.title },
          { h: "Delivered", v: (c) => n(c.delivered), num: true },
          { h: "Pro-Forma", v: (c) => n(c.proforma), num: true },
          { h: "Ratio", v: (c) => pct1(ratioOf(c.delivered, c.proforma)), num: true },
          { h: "Share of delivered", v: (c) => pct1(state.view.allDel ? (c.delivered / state.view.allDel) * 100 : null), num: true },
          { h: "Delivered · last period", v: (c) => n(c.prevDelivered), num: true },
          { h: "Pro-Forma · last period", v: (c) => n(c.prevProforma), num: true },
        ],
        onRow: (c) => openChannel(c.id),
      }],
    });
  }

  function openModel(id, onlyCh) {
    const name = state.norm.models[id];
    const chIdx = onlyCh != null ? [onlyCh] : state.view.scopeIdx;
    const del = [];
    const pro = [];
    chIdx.forEach((ci) => {
      state.base.lists[ci].del.forEach((i) => { if (state.norm.modelId[i] === id) del.push(i); });
      state.base.lists[ci].pro.forEach((i) => { if (state.norm.modelId[i] === id) pro.push(i); });
    });
    const a = state.base.modelAgg.get(id) || new Int32Array(NCH * 2);
    const byCh = CHANNELS.map((c, ci) => ({ id: c.id, name: c.title, delivered: a[ci * 2], proforma: a[ci * 2 + 1] })).filter((x) => chIdx.includes(CH_INDEX[x.id]) && (x.delivered || x.proforma));
    openModal({
      title: `Model · ${name}`,
      sub: `${filterSub()}${onlyCh != null ? ` · ${CHANNELS[onlyCh].title}` : ""}`,
      stats: [
        { label: "Delivered", value: n(del.length) },
        { label: "Pro-Forma", value: n(pro.length) },
        { label: "Ratio", value: pct1(ratioOf(del.length, pro.length)) },
      ],
      views: [
        recView("Delivered", del),
        recView("Pro-Forma", pro),
        { label: `By channel (${byCh.length})`, type: "table", rows: byCh,
          columns: [{ h: "Channel", v: (x) => x.name }, { h: "Delivered", v: (x) => n(x.delivered), num: true }, { h: "Pro-Forma", v: (x) => n(x.proforma), num: true }, { h: "Ratio", v: (x) => pct1(ratioOf(x.delivered, x.proforma)), num: true }],
          onRow: (x) => openChannel(x.id) },
      ],
    });
  }

  function openAllModels() {
    const rows = state.view.models;
    openModal({
      title: "All models",
      sub: `${filterSub()}${state.filters.channel ? ` · ${CHANNELS[CH_INDEX[state.filters.channel]].title}` : ""} · click a model`,
      views: [{
        label: "Models", type: "table", rows,
        columns: [
          { h: "#", v: (x) => String(rows.indexOf(x) + 1), num: true },
          { h: "Model", v: (x) => x.name, dir: true },
          { h: "Delivered", v: (x) => n(x.delivered), num: true },
          { h: "Pro-Forma", v: (x) => n(x.proforma), num: true },
          { h: "Ratio", v: (x) => pct1(ratioOf(x.delivered, x.proforma)), num: true },
        ],
        onRow: (x) => openModel(x.id),
      }],
    });
  }

  function openPrev(bit) {
    const flags = dateFlags();
    const norm = state.norm;
    const scope = new Set(state.view.scopeIdx);
    const { sId, mId } = state.base;
    const idx = [];
    if (sId !== -2 && mId !== -2) {
      const list = candidates(sId, mId);
      const test = (i) => { if ((flags[i] & bit) && scope.has(norm.bucket[i])) idx.push(i); };
      if (list) list.forEach(test); else for (let i = 0; i < norm.len; i += 1) test(i);
    }
    const label = bit === BIT_DEL_PREV ? "Delivered · last period" : "Pro-Forma · last period";
    openModal({ title: label, sub: `${state.live.prevMonthLabel || "Previous period"} · same showroom/model/channel filters`, stats: [{ label: "VINs", value: n(idx.length) }], views: [recView(label, idx)] });
  }

  function openModal(o) {
    const m = state.modal;
    m.views = o.views || [];
    m.active = 0;
    m.search = "";
    $el("m-title").textContent = o.title;
    $el("m-sub").textContent = o.sub || "";
    $el("m-search").value = "";
    $el("m-stats").innerHTML = (o.stats || []).map((s) => `<div class="gec-mstat${s.cls ? ` ${s.cls}` : ""}">${esc(s.label)}<b class="gec-num">${s.value}</b></div>`).join("");
    $el("modal").hidden = false;
    if (o.html != null) {
      $el("m-tabs").innerHTML = "";
      $el("m-search").hidden = true;
      $el("m-copy").hidden = true;
      $el("m-body").innerHTML = o.html;
      $el("m-foot").textContent = o.foot || "";
      return;
    }
    $el("m-search").hidden = false;
    renderModalTable();
    setTimeout(() => $el("m-search").focus(), 30);
  }

  function closeModal() {
    $el("modal").hidden = true;
    state.modal.views = [];
    $el("m-body").innerHTML = "";
  }

  const MODAL_MAX_ROWS = 1500;

  function currentRows() {
    const m = state.modal;
    const view = m.views[m.active];
    if (!view) return { view: null, rows: [], cols: [] };
    const cols = view.columns || RECORD_COLUMNS();
    const q = m.search.trim().toLowerCase();
    const all = view.rows;
    const rows = q ? all.filter((r) => cols.some((c) => String(c.v(r, 0) || "").toLowerCase().includes(q))) : all;
    return { view, rows, cols };
  }

  function renderModalTable() {
    const m = state.modal;
    $el("m-tabs").innerHTML = m.views.length > 1 ? m.views.map((v, i) =>
      `<button type="button" class="${i === m.active ? "is-on" : ""}" data-act="modal-tab" data-tab="${i}">${esc(v.label)}${v.type === "records" ? ` <b class="gec-num">${n(v.idx.length)}</b>` : ""}</button>`).join("") : "";
    const { view, rows, cols } = currentRows();
    if (!view) { $el("m-body").innerHTML = ""; return; }
    $el("m-copy").hidden = view.type !== "records";
    const shown = rows.slice(0, MODAL_MAX_ROWS);
    const clickable = !!view.onRow;
    $el("m-body").innerHTML = rows.length ? `<table class="gec-table"><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.h)}</th>`).join("")}</tr></thead><tbody>${
      shown.map((r, i) => `<tr${clickable ? ` class="is-click" data-row="${view.rows.indexOf(r)}" tabindex="0"` : ""}>${cols.map((c) => {
        const t = String(c.v(r, i) ?? "");
        return `<td class="${c.num ? "num" : ""}${c.mono ? " mono" : ""}"${c.dir ? ' dir="auto"' : ""} title="${esc(t)}">${esc(t)}</td>`;
      }).join("")}</tr>`).join("")
    }</tbody></table>` : `<div class="gec-modal-empty">No VINs for this number.</div>`;
    const unit = view.type === "records" ? "VINs" : "rows";
    $el("m-foot").textContent = rows.length > MODAL_MAX_ROWS ? `Showing first ${n(MODAL_MAX_ROWS)} of ${n(rows.length)} — refine with search` : `${n(rows.length)} ${unit}${m.search ? ` matching “${m.search}”` : ""}`;
  }

  function onModalRow(i) {
    const view = state.modal.views[state.modal.active];
    if (view && view.onRow) view.onRow(view.rows[i]);
  }

  async function copyVins() {
    const { rows } = currentRows();
    const text = rows.map((r) => r.vin).filter((v) => v && v !== "—").join("\n");
    const btn = $el("m-copy");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      btn.textContent = `Copied ${n(rows.length)}`;
    } catch {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => { btn.textContent = "Copy VINs"; }, 1400);
  }

  // ==================== Parity check (developer) ====================

  /** Compares every number with the previous page's calculation for the current showroom/model filter. */
  function openParity() {
    if (typeof state.ctx.reference !== "function" || !state.view) return;
    const t0 = now();
    const ref = state.ctx.reference(state.filters.showroom, state.filters.model);
    const refMs = now() - t0;
    const rows = [];
    const add = (label, a, b) => rows.push({ label, expected: a, actual: b, pass: a === b || (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9) });
    const cur = state.view.channels;
    ref.cards.forEach((c) => {
      const mine = cur.find((x) => x.id === c.id);
      add(`${c.title} · Delivered`, c.delivered, mine.delivered);
      add(`${c.title} · Pro-Forma`, c.proforma, mine.proforma);
      add(`${c.title} · Delivered last period`, c.prevDelivered, mine.prevDelivered);
      add(`${c.title} · Pro-Forma last period`, c.prevProforma, mine.prevProforma);
    });
    const saved = state.filters.channel;
    state.filters.channel = "";
    const all = buildView(state.base).totals;
    state.filters.channel = saved;
    add("Total Delivered", ref.totals.delivered, all.delivered);
    add("Total Pro-Forma", ref.totals.proforma, all.proforma);
    add("Delivery / Pro-Forma ratio", ref.totals.ratio, all.ratio);
    add("Delivered trend", ref.totals.delTrend, all.delTrend);
    add("Pro-Forma trend", ref.totals.proTrend, all.proTrend);
    add("Ratio trend", ref.totals.ratioTrend, all.ratioTrend);
    CHANNELS.forEach((c, ci) => {
      const refList = (ref.lists[c.id] || {});
      add(`${c.title} · delivered VIN list`, (refList.delivered || []).map((r) => r.vin).join(","), state.base.lists[ci].del.map((i) => recordOf(i).vin).join(","));
      add(`${c.title} · pro-forma VIN list`, (refList.proforma || []).map((r) => r.vin).join(","), state.base.lists[ci].pro.map((i) => recordOf(i).vin).join(","));
    });
    const passed = rows.filter((r) => r.pass).length;
    const show = (v) => (typeof v === "string" ? `${v.split(",").filter(Boolean).length} VINs` : v == null ? "—" : Number.isInteger(v) ? n(v) : v.toFixed(4));
    const p = state.perf;
    openModal({
      title: "Parity check · new pipeline vs previous calculation",
      sub: `${passed}/${rows.length} identical · ${filterSub() || "no filters"}`,
      stats: [
        { label: "Identical", value: `${passed} / ${rows.length}`, cls: passed === rows.length ? "is-ok" : "is-bad" },
        { label: "Previous calculation", value: `${refMs.toFixed(0)} ms` },
        { label: "Normalize (once)", value: `${(p.normalizeMs || 0).toFixed(0)} ms` },
        { label: "Date flags (per period)", value: `${(p.datesMs || 0).toFixed(0)} ms` },
        { label: "Last update", value: `${(p.renderMs || 0).toFixed(1)} ms` },
      ],
      html: `<table class="gec-table"><thead><tr><th>Number</th><th class="num">Previous page</th><th class="num">Sales Control Center</th><th>Result</th></tr></thead><tbody>${
        rows.map((r) => `<tr class="${r.pass ? "" : "is-bad"}"><td>${esc(r.label)}</td><td class="num">${esc(show(r.expected))}</td><td class="num">${esc(show(r.actual))}</td><td>${r.pass ? '<span class="gec-pill s-converted">SAME</span>' : '<span class="gec-flag">DIFF</span>'}</td></tr>`).join("")
      }</tbody></table>`,
      foot: "Developer only. Both columns come from the same Sales Raw rows; the previous calculation is run on demand for comparison.",
    });
  }

  // ==================== Public API ====================

  /**
   * @param host element · @param source { rows, guestSig, guestCount, classify, isDelivery, isProforma, vinRecord }
   * @param ctx { live, dateFilter, setDateFilter, periodOf, periodLabel, prevMonthKeyOf, trendPct, statusFor, formatDate,
   *              dateBounds, lastUpdated, onRefresh, onExit, reference }
   */
  function render(host, source, ctx) {
    if (!host) return;
    if (!state.root || state.host !== host || !host.contains(state.root)) {
      if (state.chartBar) { state.chartBar.destroy(); state.chartBar = null; }
      if (state.chartRing) { state.chartRing.destroy(); state.chartRing = null; }
      build(host);
    }
    state.ctx = ctx || {};
    const empty = $el("empty");
    if (!source || !source.rows || !source.rows.length) {
      empty.hidden = false;
      empty.innerHTML = `<div><strong>No Sales Raw Data pushed yet</strong>Open <b>Admin Push</b>, upload <b>Sales Raw Data</b> and click <b>Push to live</b>.</div>`;
      return;
    }
    empty.hidden = true;
    const sig = sigOf(source);
    if (!state.norm || state.norm.rowsRef !== source.rows || state.norm.sig !== sig) {
      const job = prepJob;
      prepJob = null;
      adoptNorm(source, normalize(source, job));
      state.perf.prepared = false;
    }
    state.src = source;
    setLive(state.ctx.live);
    $el("debug-btn").hidden = !state.debug;
    update();
  }

  global.SalesControl = { render, prepare, state, CHANNELS };
})(typeof window !== "undefined" ? window : globalThis);
