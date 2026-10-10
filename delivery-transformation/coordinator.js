/* Delivery Transformation coordinator — Live Sheet + Delivery_pdf print */
(() => {
  const { api, esc, na, getToken, getUser, setSession, clearSession, useSessionScope, migrateLegacySession } = window.DTX;
  useSessionScope('coordinator');
  migrateLegacySession((u) => u.role === 'coordinator' || u.canCoordinate);

  const $ = (id) => document.getElementById(id);
  const AR_NUMS = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠'];
  const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

  const POLL_MS = 3000;
  const POLL_PUSH_MS = 15000;
  let liveEvents = null;
  let pushOn = false;
  let wsAgain = false;
  let sheetAgain = false;
  let rows = [];
  let collapsedCarriers = new Set();
  let viewTab = 'fleet';
  let sheetRows = [];
  let fleetFp = '';
  let sheetFp = '';
  let wsBusy = false;
  let sheetBusy = false;
  let poll = null;
  let overlayReady = false;
  let printMode = 'sheet';
  let transferCities = [];
  let vinPickerMode = 'open-warehouse';
  let activeVinRow = null;
  let attendanceCompanies = [];
  let claimedAttendanceId = '';
  let companyPerf = null;
  let companyPerfDebug = [];
  let dtsCoState = { company: '', bucket: '', status: 'ALL', q: '' };
  let vinSource = 'live';
  let memoSource = 'live';
  let salesRawRows = null;
  let salesRawLoading = false;
  let vinCarrier = {};
  let lastLock = '';
  const fieldEls = {};

  function showView(name) {
    $('gateLogin').classList.toggle('hidden', name !== 'login');
    $('agentWorkspace').classList.toggle('hidden', name !== 'workspace');
    $('mainApp').classList.toggle('hidden', name !== 'detail');
    document.body.classList.toggle('workspace-mode', name === 'workspace');
    document.body.classList.toggle('app-mode', name === 'detail');
    if (name === 'workspace') {
      startPoll();
      startLiveEvents();
    } else if (name === 'detail') {
      stopPoll();
      startLiveEvents();
    } else {
      stopPoll();
      stopLiveEvents();
    }
  }

  function stopPoll() {
    if (poll) { clearInterval(poll); poll = null; }
  }

  /** Push connected → polling is only a safety net; otherwise poll fast. */
  function startPoll() {
    stopPoll();
    poll = setInterval(() => {
      if (!document.hidden) refreshWorkspace();
    }, pushOn ? POLL_PUSH_MS : POLL_MS);
  }

  function setPushOn(on) {
    if (pushOn === on) return;
    pushOn = on;
    const pill = $('livePill');
    if (pill) {
      pill.classList.toggle('is-push', on);
      pill.title = on ? 'تحديث فوري — أي تعديل في employee.html يظهر هنا مباشرة' : 'Live';
    }
    if (poll) startPoll();
  }

  /** Server pushes "change" on every save (employee.html edit, import, print) → refresh right away. */
  function startLiveEvents() {
    if (liveEvents || typeof EventSource === 'undefined') return;
    const token = getToken();
    if (!token) return;
    liveEvents = new EventSource(`${window.DTX.API}/live-events?token=${encodeURIComponent(token)}`);
    liveEvents.addEventListener('open', () => {
      setPushOn(true);
      if ($('mainApp').classList.contains('hidden')) refreshWorkspace();
    });
    liveEvents.addEventListener('change', () => {
      if (document.hidden) return;
      if ($('mainApp').classList.contains('hidden')) refreshWorkspace();
      else refreshCompanyCounts();
    });
    liveEvents.addEventListener('error', () => {
      setPushOn(false);
      if (liveEvents && liveEvents.readyState === EventSource.CLOSED) liveEvents = null;
    });
  }

  function stopLiveEvents() {
    if (liveEvents) {
      liveEvents.close();
      liveEvents = null;
    }
    setPushOn(false);
  }

  function refreshWorkspace() {
    loadWorkspace({ silent: true }).catch(() => { $('livePill').classList.add('off'); });
    if (viewTab === 'live') loadLiveSheetView().catch(() => { $('livePill').classList.add('off'); });
  }

  function logout() {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    location.reload();
  }

  async function login() {
    const status = $('loginStatus');
    status.textContent = '';
    status.className = 'ws-toast';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: { username: $('loginUser').value, password: $('loginPass').value },
      });
      if (data.user.role !== 'coordinator' && !data.user.canCoordinate) {
        status.className = 'ws-toast err';
        status.textContent = 'هذا المستخدم ليس منسق تسليم';
        return;
      }
      setSession(data.token, data.user);
      enterApp(data.user);
    } catch (err) {
      status.className = 'ws-toast err';
      status.textContent = err.message || 'فشل الدخول';
    }
  }

  function enterApp(user) {
    $('loggedAs').textContent = user.name;
    if ($('adminLink')) $('adminLink').hidden = true;
    if ($('empLink')) $('empLink').hidden = true;
    showView('workspace');
    let savedTab = 'fleet';
    try { savedTab = sessionStorage.getItem('dt_co_view') || 'fleet'; } catch (_) { /* ignore */ }
    setViewTab(savedTab);
    loadWorkspace().catch((e) => alert(e.message));
  }

  function setViewTab(tab) {
    viewTab = tab === 'live' ? 'live' : 'fleet';
    const live = viewTab === 'live';
    [['tabFleet', !live], ['tabLiveSheet', live]].forEach(([id, on]) => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('coFleetSection').classList.toggle('hidden', live);
    $('coLiveSheetSection').classList.toggle('hidden', !live);
    try { sessionStorage.setItem('dt_co_view', viewTab); } catch (_) { /* ignore */ }
    if (live) {
      loadLiveSheetView().catch((e) => {
        const hint = $('liveSheetHint');
        if (hint) hint.textContent = e.message || 'تعذر تحميل Live Sheet';
      });
    }
  }

  function carrierOf(r) {
    return String((r && r.ops && r.ops.carrier) || '').trim();
  }

  function carrierChangeBadge(ops) {
    const from = String((ops && ops.carrierChangedFrom) || '').trim();
    const to = String((ops && ops.carrier) || '').trim();
    if (!from || from === to) return '';
    return `<span class="co-changed" title="غيّره المنسق">تغيّر من ${esc(from)} ← ${esc(to)}</span>`;
  }

  function fleetCard(r) {
    const product = r.raw.product || '—';
    const type = r.raw.salesType || '';
    const loc = r.raw.vehicleLocation || r.raw.gtLocation || '';
    const city = (r.ops && r.ops.transferCity) || '';
    const changed = carrierChangeBadge(r.ops);
    return `<button type="button" class="fleet-card fleet-card--actionable${changed ? ' fleet-card--changed' : ''}" data-vin="${esc(r.vin)}" data-product="${esc(product)}" data-company="${esc(carrierOf(r))}" data-type="${esc(type)}" data-order="${esc(r.raw.salesOrder || '')}" data-customer="${esc(r.raw.userName || '')}" data-phone="${esc(r.raw.phone || '')}" data-city="${esc(city)}">
      <div class="fc-body">
        <div class="fc-vin">${esc(r.vin)}</div>
        <div class="fc-product">${esc(product)}</div>
        <div class="fc-meta">${[r.raw.salesOrder ? `طلب ${r.raw.salesOrder}` : '', city ? `📍 ${city}` : loc].filter(Boolean).map(esc).join(' · ') || '—'}</div>
        ${changed}
        ${type ? `<span class="fc-badge">${esc(type)}</span>` : ''}
      </div>
    </button>`;
  }

  /** Only VINs Hanouf / Rasha already gave a الناقل — grouped by that company, biggest first. */
  function groupByCarrier(list) {
    const groups = new Map();
    list.forEach((r) => {
      const key = carrierOf(r);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ar'));
  }

  function renderFleet(groups) {
    const availEl = $('availableFleet');
    if (!groups.length) {
      availEl.innerHTML = '<div class="ws-empty"><strong>لا توجد سيارات معيّنة لناقل بعد</strong>عند تعيين هنوف / رشا للناقل تظهر السيارة هنا فوراً</div>';
      return;
    }
    availEl.innerHTML = groups.map(([company, items]) => {
      const open = !collapsedCarriers.has(company);
      const changed = items.filter((r) => carrierChangeBadge(r.ops)).length;
      return `<div class="fleet-company-group co-carrier-group${open ? ' is-expanded' : ''}" data-type="${esc(company)}">
        <button type="button" class="fleet-company-head" data-fold-type="${esc(company)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="fleet-company-name"><span class="co-carrier-ico" aria-hidden="true">🚚</span>${esc(company)}${changed ? `<span class="co-carrier-changed">${changed} تغيّر</span>` : ''}</span>
          <span class="fleet-fold-meta">
            <span class="fleet-company-count">${items.length} سيارة</span>
            <span class="fleet-chevron" aria-hidden="true"></span>
          </span>
        </button>
        <div class="fleet-grid">${items.map(fleetCard).join('')}</div>
      </div>`;
    }).join('');
  }

  function filterFleet() {
    const input = $('availableVinSearch');
    const countEl = $('availableVinSearchCount');
    const emptyEl = $('availableVinSearchEmpty');
    const availEl = $('availableFleet');
    const q = String(input.value || '').trim().toUpperCase().replace(/\s+/g, '');
    availEl.classList.toggle('is-searching', Boolean(q));
    const cards = [...availEl.querySelectorAll('.fleet-card')];
    let visible = 0;
    cards.forEach((card) => {
      const hay = [card.dataset.vin, card.dataset.product, card.dataset.company, card.dataset.type, card.dataset.order, card.dataset.customer, card.dataset.phone, card.dataset.city]
        .join(' ').toUpperCase().replace(/\s+/g, '');
      const match = !q || hay.includes(q);
      card.classList.toggle('fleet-card--hidden', !match);
      card.classList.toggle('fleet-card--hit', Boolean(q) && match);
      if (match) visible += 1;
    });
    availEl.querySelectorAll('.fleet-company-group').forEach((group) => {
      const vis = [...group.querySelectorAll('.fleet-card')].filter((c) => !c.classList.contains('fleet-card--hidden'));
      group.classList.toggle('fleet-company-group--hidden', !vis.length);
      const type = group.dataset.type || '';
      const open = Boolean(q) || !collapsedCarriers.has(type);
      group.classList.toggle('is-expanded', open);
      const head = group.querySelector('.fleet-company-head');
      if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
      const count = group.querySelector('.fleet-company-count');
      const total = group.querySelectorAll('.fleet-card').length;
      if (count) count.textContent = q ? `${vis.length} من ${total}` : `${total} سيارة`;
    });
    countEl.textContent = q ? `${visible} نتيجة` : `${cards.length} سيارة`;
    emptyEl.classList.toggle('hidden', visible > 0 || !q);
    const missingBtn = $('btnMissingVin');
    if (missingBtn) missingBtn.classList.toggle('is-highlight', Boolean(q) && visible === 0);
  }

  function syncTime(at) {
    return new Date(at || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async function loadWorkspace() {
    if (wsBusy) {
      wsAgain = true;
      return;
    }
    wsBusy = true;
    let live;
    try {
      live = await api('/live-sheet');
    } finally {
      wsBusy = false;
      if (wsAgain) {
        wsAgain = false;
        setTimeout(() => loadWorkspace().catch(() => {}), 0);
      }
    }
    rows = live.rows || [];
    $('livePill').classList.remove('off');
    const assigned = rows.filter((r) => carrierOf(r));
    const groups = groupByCarrier(assigned);
    const changed = assigned.filter((r) => carrierChangeBadge(r.ops)).length;
    $('wsStats').innerHTML = `
      <div class="ws-stat ws-stat--avail"><span>سيارات معيّنة</span><b>${assigned.length}</b></div>
      <div class="ws-stat ws-stat--stock"><span>شركات النقل</span><b>${groups.length}</b></div>
      <div class="ws-stat ws-stat--warn"><span>غيّرها المنسق</span><b>${changed}</b></div>
      <div class="ws-stat ws-stat--muted"><span>بدون ناقل</span><b>${rows.length - assigned.length}</b></div>
      <div class="ws-stat"><span>آخر مزامنة</span><b class="ws-stat-time">${esc(syncTime(live.at))}</b></div>`;
    if ($('tabFleetCount')) $('tabFleetCount').textContent = String(assigned.length);
    const fp = JSON.stringify(assigned.map((r) => [
      r.vin, carrierOf(r), r.ops.carrierChangedFrom || '', r.ops.transferCity || '',
      r.raw.product || '', r.raw.salesType || '', r.raw.salesOrder || '', r.raw.userName || '',
      r.raw.phone || '', r.raw.vehicleLocation || '', r.raw.gtLocation || '',
    ]));
    if (fp !== fleetFp) {
      fleetFp = fp;
      renderFleet(groups);
    }
    filterFleet();
  }

  /** Read-only copy of the full Live Sheet (same rows the employees see) — re-rendered only when something changed. */
  async function loadLiveSheetView() {
    if (sheetBusy) {
      sheetAgain = true;
      return;
    }
    sheetBusy = true;
    let data;
    try {
      data = await api('/live-sheet?view=sheet');
    } finally {
      sheetBusy = false;
      if (sheetAgain) {
        sheetAgain = false;
        setTimeout(() => {
          if (viewTab === 'live') loadLiveSheetView().catch(() => {});
        }, 0);
      }
    }
    sheetRows = data.rows || [];
    $('livePill').classList.remove('off');
    if ($('tabLiveCount')) $('tabLiveCount').textContent = String(sheetRows.length);
    const fp = JSON.stringify(sheetRows.map((r) => [r.vin, r.raw, r.ops]));
    if (fp !== sheetFp) {
      const first = !sheetFp;
      sheetFp = fp;
      renderLiveTable(sheetRows);
      const pulse = $('liveSheetPulse');
      if (pulse && !first) {
        pulse.classList.remove('is-flash');
        void pulse.offsetWidth;
        pulse.classList.add('is-flash');
      }
    }
    const hint = $('liveSheetHint');
    if (hint) hint.textContent = `${sheetRows.length} شاسيه · ${pushOn ? 'تحديث فوري مع employee.html' : 'يتحدّث تلقائياً'} · آخر تحديث ${syncTime(data.at)}`;
  }

  function monthRange(d = new Date()) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const last = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to };
  }

  function setCoPerfMonthDefaults() {
    const range = monthRange();
    const fromEl = $('coPerfFrom');
    const toEl = $('coPerfTo');
    if (fromEl && !fromEl.value) fromEl.value = range.from;
    if (toEl && !toEl.value) toEl.value = range.to;
  }

  function coPerfDonutSvg(segments, centerLabel, centerSub) {
    const total = segments.reduce((s, x) => s + (Number(x.count) || 0), 0) || 1;
    const box = 120;
    const cx = box / 2;
    const r = 48;
    const inner = 34;
    const stroke = 14;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segments.filter((x) => x.count > 0).map((x) => {
      const len = (x.count / total) * c;
      const arc = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${esc(x.color)}" stroke-width="${stroke}"
        stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cx})"></circle>`;
      offset += len;
      return arc;
    }).join('');
    return `<div class="co-perf-donut">
      <svg viewBox="0 0 ${box} ${box}" aria-hidden="true">${arcs}
        <circle cx="${cx}" cy="${cx}" r="${inner}" fill="#fff"></circle>
      </svg>
      <div class="co-perf-donut-center"><strong>${esc(centerLabel)}</strong><span>${esc(centerSub || '')}</span></div>
    </div>`;
  }

  function getDaysToSalesData() {
    return (companyPerfDebug || []).map((r) => ({
      vin: r.vin,
      company: r.company,
      assignmentDate: r.assignmentDate,
      salesDate: r.salesDate || null,
      daysToSales: r.daysToSales == null ? null : r.daysToSales,
      bucket: r.bucket || null,
      status: (r.status === 'SOLD' || r.status === 'COMPLETED')
        ? 'SOLD'
        : (r.status === 'DATA_QUALITY' ? 'DATA_QUALITY' : 'PENDING'),
    }));
  }

  function fmtDtsDate(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    try {
      return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
      return String(iso);
    }
  }

  function summarizeDaysToSales(rows) {
    const sold = rows.filter((r) => r.status === 'SOLD' && r.daysToSales != null);
    return {
      totalSold: sold.length,
      averageDays: sold.length
        ? Math.round((sold.reduce((s, r) => s + r.daysToSales, 0) / sold.length) * 10) / 10
        : null,
      fastestSale: sold.length ? Math.min(...sold.map((r) => r.daysToSales)) : null,
      eightPlus: sold.filter((r) => r.daysToSales >= 8).length,
    };
  }

  function renderCompanyPerformance(data) {
    companyPerf = data || null;
    companyPerfDebug = (data && data.debug) || [];
    const meta = $('coPerfMeta');
    const tbody = $('coPerfTbody');
    const bars = $('coPerfBars');
    const donutBody = $('coPerfDonutBody');
    if (!tbody) return;

    const companies = (data && data.companies) || [];
    const totals = (data && data.totals) || {};
    const dist = (data && data.daysDist) || [];

    if (meta) {
      meta.textContent = `${totals.totalUniqueVins || 0} VIN · ${totals.completedVins || 0} completed · avg ${totals.averageDaysToSales == null ? '—' : totals.averageDaysToSales} days · Hanouf sales map ${totals.hanoufSalesVinCount || 0}`;
    }

    if (donutBody) {
      const completed = totals.completedVins || 0;
      if (!completed && !(totals.totalUniqueVins > 0)) {
        donutBody.innerHTML = '<p class="ws-empty" style="margin:0;padding:12px">No assignments in range</p>';
      } else {
        donutBody.innerHTML = `${coPerfDonutSvg(dist, String(completed), 'Sold')}
          <ul class="co-perf-legend is-scroll">${dist.map((x) => `
            <li class="co-perf-legend-hit" data-dts-bucket="${esc(x.label)}" role="button" tabindex="0">
              <i style="background:${esc(x.color)}"></i>
              <span>${esc(x.label)}</span>
              <b>${esc(x.count)}</b>
              <em>${esc(x.pct)}%</em>
            </li>
          `).join('')}</ul>`;
        donutBody.querySelectorAll('[data-dts-bucket]').forEach((el) => {
          const open = () => openDaysToSalesModal({ bucket: el.dataset.dtsBucket || '' });
          el.addEventListener('click', open);
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
          });
        });
      }
    }

    if (bars) {
      const maxAvg = Math.max(1, ...companies.map((c) => Number(c.averageDaysToSales) || 0));
      bars.innerHTML = companies.map((c) => {
        const avg = c.averageDaysToSales;
        const w = avg == null ? 0 : (avg / maxAvg) * 100;
        return `<div class="co-perf-bar" title="${esc(c.companyName)}
Total VINs: ${c.totalUniqueVins}
Completed: ${c.completedVins}
Pending: ${c.pendingVins}
Average: ${avg == null ? '—' : avg + ' days'}">
          <span class="co-perf-bar-name">${esc(c.companyName)}</span>
          <span class="co-perf-bar-track"><i style="width:${w}%"></i></span>
          <b>${avg == null ? '—' : esc(avg)}</b>
        </div>`;
      }).join('') || '<p class="ws-empty" style="margin:0;padding:8px">No companies</p>';
    }

    tbody.innerHTML = companies.map((c) => `<tr>
      <td>${esc(c.companyName)}</td>
      <td class="num">${esc(c.totalUniqueVins)}</td>
      <td class="num">${esc(c.completedVins)}</td>
      <td class="num">${esc(c.pendingVins)}</td>
      <td class="num"><b>${c.averageDaysToSales == null ? '—' : esc(c.averageDaysToSales)}</b></td>
    </tr>`).join('') || '<tr><td colspan="5">No assignments in this date range</td></tr>';
  }

  function openDaysToSalesModal(opts = {}) {
    const modal = $('dtsModal');
    if (!modal) return;
    const all = getDaysToSalesData();
    const companies = [...new Set(all.map((r) => r.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    const buckets = ((companyPerf && companyPerf.daysDist) || []).map((b) => b.label);
    dtsCoState = {
      company: opts.company || '',
      bucket: opts.bucket || '',
      status: opts.status || 'ALL',
      q: '',
    };
    const companyEl = $('dtsCoCompany');
    const bucketEl = $('dtsCoBucket');
    const statusEl = $('dtsCoStatus');
    const qEl = $('dtsCoSearch');
    if (companyEl) {
      companyEl.innerHTML = '<option value="">All Companies</option>'
        + companies.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      companyEl.value = dtsCoState.company;
    }
    if (bucketEl) {
      bucketEl.innerHTML = '<option value="">All</option>'
        + buckets.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
      bucketEl.value = dtsCoState.bucket;
    }
    if (statusEl) statusEl.value = dtsCoState.status;
    if (qEl) qEl.value = '';
    modal.hidden = false;
    renderDaysToSalesModalTable();
  }

  function closeDaysToSalesModal() {
    const modal = $('dtsModal');
    if (modal) modal.hidden = true;
  }

  function renderDaysToSalesModalTable() {
    const tbody = $('dtsCoTbody');
    const summaryEl = $('dtsCoSummary');
    const foot = $('dtsCoFoot');
    if (!tbody) return;
    let rows = getDaysToSalesData();
    if (dtsCoState.company) rows = rows.filter((r) => r.company === dtsCoState.company);
    if (dtsCoState.bucket) rows = rows.filter((r) => r.bucket === dtsCoState.bucket);
    if (dtsCoState.status === 'SOLD') rows = rows.filter((r) => r.status === 'SOLD');
    if (dtsCoState.status === 'PENDING') rows = rows.filter((r) => r.status !== 'SOLD');
    const q = String(dtsCoState.q || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (q) rows = rows.filter((r) => String(r.vin || '').includes(q));

    const sum = summarizeDaysToSales(rows);
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="dts-sum-card"><span>Total Sold</span><strong>${esc(sum.totalSold)}</strong></div>
        <div class="dts-sum-card"><span>Average Days</span><strong>${sum.averageDays == null ? '—' : esc(sum.averageDays)}</strong></div>
        <div class="dts-sum-card"><span>Fastest Sale</span><strong>${sum.fastestSale == null ? '—' : esc(sum.fastestSale)}</strong></div>
        <div class="dts-sum-card"><span>8+ Days</span><strong>${esc(sum.eightPlus)}</strong></div>`;
    }
    tbody.innerHTML = rows.map((r) => `<tr>
      <td class="vin-ltr">${esc(r.vin)}</td>
      <td>${esc(r.company)}</td>
      <td>${esc(fmtDtsDate(r.assignmentDate))}</td>
      <td>${r.salesDate ? esc(fmtDtsDate(r.salesDate)) : '—'}</td>
      <td class="num">${r.daysToSales == null ? '—' : esc(r.daysToSales)}</td>
      <td>${r.bucket ? esc(r.bucket) : '—'}</td>
      <td>${esc(r.status === 'SOLD' ? 'Sold' : 'Pending')}</td>
    </tr>`).join('') || '<tr><td colspan="7">No VINs match these filters</td></tr>';
    if (foot) foot.textContent = `${rows.length} VIN(s) · Sold ${sum.totalSold} · Avg ${sum.averageDays == null ? '—' : sum.averageDays}`;
  }

  async function loadCompanyPerformance({ silent = false } = {}) {
    setCoPerfMonthDefaults();
    const from = ($('coPerfFrom') && $('coPerfFrom').value) || '';
    const to = ($('coPerfTo') && $('coPerfTo').value) || '';
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    qs.set('debug', '1');
    const data = await api(`/company-performance?${qs.toString()}`);
    renderCompanyPerformance(data);
    return data;
  }

  function getCompanyPerformanceDebug() {
    return companyPerfDebug.slice();
  }

  window.getCompanyPerformanceDebug = getCompanyPerformanceDebug;
  window.getCompanyPerformance = () => companyPerf;
  window.getDaysToSalesData = getDaysToSalesData;

  function printedCell(ops) {
    if (!ops || !ops.coordinatorPrintedAt) return '—';
    const label = String(ops.coordinatorPrintLabel || '').trim();
    return `<span class="co-printed">✓ طُبع</span>${label ? ` <span class="co-label co-label--${label === 'داخلي' ? 'internal' : 'display'}">${esc(label)}</span>` : ''}`;
  }

  /** Coordinator Live Sheet — view only (no edit controls, no print on click). */
  function renderLiveTable(list) {
    const table = $('coordLiveTable');
    const o = (r) => r.ops || {};
    const cols = [
      ['#', (_r, i) => i + 1],
      ['Employee', (r) => `<b>${esc(na(o(r).assignedEmployeeName))}</b>`],
      ['Status', (r) => (o(r).opsStatus ? `<span class="co-status">${esc(o(r).opsStatus)}</span>` : '—')],
      ['VIN', (r) => `<span class="vin-ltr coord-vin">${esc(r.vin)}</span>`],
      ['Proforma', (r) => esc(na(r.raw.proformaDate))],
      ['Order', (r) => esc(na(r.raw.salesOrder))],
      ['Product', (r) => esc(na(r.raw.product))],
      ['Sales Type', (r) => esc(na(r.raw.salesType))],
      ['Customer', (r) => esc(na(r.raw.userName))],
      ['Phone', (r) => (r.raw.phone ? `<a class="phone-link" href="tel:${esc(r.raw.phone)}">${esc(r.raw.phone)}</a>` : '—')],
      ['S/A', (r) => esc(na(r.raw.salesAdvisor))],
      ['GT Loc', (r) => esc(na(r.raw.gtLocation))],
      ['Veh Loc', (r) => esc(na(r.raw.vehicleLocation))],
      ['مدينة الترحيل', (r) => esc(na(o(r).transferCity))],
      ['الناقل', (r) => `${carrierOf(r) ? `<b>${esc(carrierOf(r))}</b>` : '—'}${carrierChangeBadge(o(r))}`],
      ['المنسق', (r) => printedCell(o(r))],
      ['ملاحظات', (r) => esc(na(o(r).notes))],
      ['Updated', (r) => esc(String(o(r).updatedAt || '').replace('T', ' ').slice(0, 16) || '—')],
      ['By', (r) => esc(na(o(r).updatedBy))],
    ];
    const hay = (r) => [
      r.vin, r.raw.product, r.raw.salesOrder, r.raw.userName, r.raw.phone, r.raw.salesType, r.raw.salesAdvisor,
      o(r).assignedEmployeeName, o(r).opsStatus, o(r).transferCity, o(r).carrier, o(r).carrierChangedFrom, o(r).coordinatorPrintLabel,
    ].join(' ').toUpperCase().replace(/\s+/g, '');
    table.innerHTML = `<thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead>
      <tbody>${list.map((r, i) => `<tr data-vin="${esc(r.vin)}" data-hay="${esc(hay(r))}" data-employee="${esc(o(r).assignedEmployeeName || '')}" data-status="${esc(o(r).opsStatus || '')}"${o(r).coordinatorPrintedAt ? ' class="is-printed"' : ''}>${cols.map((c) => `<td>${c[1](r, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">لا توجد شاسيهات على Live Sheet</td></tr>`}</tbody>`;
    paintCoordFilters(list);
    filterLiveSheet();
  }

  const coordFilters = { employee: [], status: [] };

  function paintCoordFilters(list) {
    const employees = [...new Set((list || []).map((r) => String((r.ops && r.ops.assignedEmployeeName) || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const statuses = [...new Set((list || []).map((r) => String((r.ops && r.ops.opsStatus) || '').trim()).filter(Boolean))];
    const paint = (id, options, selected, key) => {
      const root = document.getElementById(id);
      if (!root) return;
      const btn = root.querySelector('.multi-filter-btn');
      const menu = root.querySelector('.multi-filter-menu');
      const picked = coordFilters[key];
      if (btn) {
        btn.textContent = picked.length ? picked.join(' · ') : (btn.dataset.empty || 'All');
        btn.classList.toggle('is-on', picked.length > 0);
      }
      if (!menu || menu.dataset.open === '1') return;
      menu.innerHTML = options.map((name) => `<label class="multi-filter-opt"><input type="checkbox" value="${esc(name)}" ${picked.includes(name) ? 'checked' : ''} /> ${esc(name)}</label>`).join('')
        || '<span class="hint">—</span>';
      menu.querySelectorAll('input').forEach((el) => {
        el.addEventListener('change', () => {
          const cur = coordFilters[key].filter((x) => x !== el.value);
          if (el.checked) cur.push(el.value);
          coordFilters[key] = cur;
          paintCoordFilters(sheetRows);
          filterLiveSheet();
        });
      });
    };
    paint('co-employee-filter', employees, coordFilters.employee, 'employee');
    paint('co-status-filter', statuses, coordFilters.status, 'status');
  }

  function filterLiveSheet() {
    const input = $('liveSheetSearch');
    const countEl = $('liveSheetSearchCount');
    const q = String((input && input.value) || '').trim().toUpperCase().replace(/\s+/g, '');
    const emps = coordFilters.employee;
    const sts = coordFilters.status;
    const trs = [...$('coordLiveTable').querySelectorAll('tbody tr[data-vin]')];
    let visible = 0;
    trs.forEach((tr) => {
      const match = (!q || String(tr.dataset.hay || '').includes(q))
        && (!emps.length || emps.includes(tr.dataset.employee || ''))
        && (!sts.length || sts.includes(tr.dataset.status || ''));
      tr.style.display = match ? '' : 'none';
      if (match) visible += 1;
    });
    if (countEl) countEl.textContent = (q || emps.length || sts.length) ? `${visible} نتيجة` : `${trs.length} شاسيه`;
  }

  function fill(id, val) {
    const el = $(id);
    if (el) el.value = val && String(val).trim() && val !== 'N/A' ? String(val) : '';
  }

  function toIsoDate(value) {
    const s = String(value || '').trim();
    if (!s || s === 'N/A') return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (dmy) {
      let y = Number(dmy[3]);
      if (y < 100) y += 2000;
      return `${y}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }
    return '';
  }

  function getSaudiTodayIso() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  }

  function getSaudiWeekdayIndex(isoDate) {
    const iso = String(isoDate || getSaudiTodayIso()).trim();
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      weekday: 'short',
    }).format(new Date(`${iso}T12:00:00+03:00`));
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? 0;
  }

  function arabicDayName(isoDate) {
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return days[getSaudiWeekdayIndex(isoDate)];
  }

  function splitDateParts(value) {
    if (!value) return { d: '', m: '', y: '' };
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { y: iso[1], m: iso[2], d: iso[3] };
    const dmy = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
    if (dmy) return { d: dmy[1], m: dmy[2], y: dmy[3] };
    return { d: '', m: '', y: '' };
  }

  function toArabicIndicDigits(s) {
    return String(s).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
  }

  function toHijriPartsFromIso(isoDate) {
    try {
      if (!isoDate) return { d: '', m: '', y: '' };
      const dt = new Date(`${String(isoDate).trim()}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return { d: '', m: '', y: '' };
      const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        numberingSystem: 'latn',
      });
      const parts = fmt.formatToParts(dt) || [];
      const get = (type) => parts.find((p) => p.type === type)?.value || '';
      return {
        d: toArabicIndicDigits(String(get('day')).padStart(2, '0')),
        m: toArabicIndicDigits(String(get('month')).padStart(2, '0')),
        y: toArabicIndicDigits(String(get('year'))),
      };
    } catch (_) {
      return { d: '', m: '', y: '' };
    }
  }

  function selectedAttendanceName() {
    const el = $('customer_name');
    return String((el && el.value) || '').trim();
  }

  function companyLabel(g) {
    return `${g.company} — الإجمالي ${g.total || 0} · اليوم ${g.today || 0}`;
  }

  function normVin(vin) {
    return String(vin || '').trim().toUpperCase();
  }

  /** الناقل assigned on the Live Sheet (Hanouf / Rasha) for a VIN in the memo. */
  function carrierOfVin(vin) {
    const key = normVin(vin);
    if (!key) return '';
    if (Object.prototype.hasOwnProperty.call(vinCarrier, key)) return vinCarrier[key];
    const r = rows.find((x) => normVin(x.vin) === key);
    return String((r && r.ops && r.ops.carrier) || '').trim();
  }

  function assignedCarrier(exceptRow) {
    if (isWarehouse() || printMode === 'display') return '';
    const vins = getSelectedVins(exceptRow);
    for (let i = 0; i < vins.length; i += 1) {
      const c = carrierOfVin(vins[i]);
      if (c) return c;
    }
    return '';
  }

  /** First Live Sheet الناقل (before any coordinator change) among the memo VINs. */
  function originalCarrierOfMemo() {
    const vins = getSelectedVins();
    for (let i = 0; i < vins.length; i += 1) {
      const r = findLiveRow(vins[i]);
      const from = String((r && r.ops && r.ops.carrierChangedFrom) || '').trim();
      if (from) return from;
    }
    return '';
  }

  function renderCompanyLockHint() {
    const hint = $('companyLockHint');
    if (!hint) return;
    const assigned = isWarehouse() ? '' : assignedCarrier();
    if (!assigned) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }
    const chosen = String($('company_rep').value || '').trim();
    const original = originalCarrierOfMemo();
    hint.classList.remove('hidden');
    hint.classList.remove('is-missing');
    hint.classList.toggle('is-changed', Boolean(original && original !== assigned));
    if (original && original !== assigned) {
      hint.textContent = `✓ تم تغيير الناقل في Live Sheet: ${original} ← ${assigned}`;
    } else if (chosen && chosen !== assigned) {
      hint.textContent = `سيتم تغيير الناقل في Live Sheet: ${assigned} ← ${chosen}`;
    } else {
      hint.textContent = `الناقل المعيّن على Live Sheet: ${assigned} — تم اختياره تلقائياً · يمكنك اختيار شركة أخرى`;
    }
  }

  function renderAttendanceSelects() {
    const companyEl = $('company_rep');
    const currentCompany = companyEl.value;
    const assigned = assignedCarrier();
    const list = attendanceCompanies.slice();
    if (assigned && !list.some((g) => g.company === assigned)) list.unshift({ company: assigned, total: 0, today: 0, people: [] });
    if (currentCompany && !list.some((g) => g.company === currentCompany)) list.unshift({ company: currentCompany, total: 0, today: 0, people: [] });
    companyEl.innerHTML = `<option value="">${printMode === 'display' ? '— بدون شركة (اختياري) —' : '— اختر الشركة —'}</option>`
      + list.map((g) =>
        `<option value="${esc(g.company)}">${esc(companyLabel(g))}${g.company === assigned ? ' · المعيّن' : ''}</option>`
      ).join('');
    if (currentCompany) companyEl.value = currentCompany;
    else if (assigned) companyEl.value = assigned;
    else companyEl.value = '';
    companyEl.disabled = false;
    companyEl.classList.remove('is-locked');
    renderCompanyLockHint();
    renderAttendanceNames();
  }

  /** Coordinator picked another company than the Live Sheet الناقل → change it on the Live Sheet now (keeps "from → to"). */
  async function captureCarrierChange() {
    if (isWarehouse()) return;
    const company = String($('company_rep').value || '').trim();
    if (!company) {
      renderCompanyLockHint();
      return;
    }
    const vins = getSelectedVins().filter((vin) => {
      const c = carrierOfVin(vin);
      return c && c !== company;
    });
    if (!vins.length) {
      renderCompanyLockHint();
      return;
    }
    const data = await api('/coordinator/carrier', { method: 'POST', json: { vins, company } });
    const changed = data.changed || [];
    changed.forEach((c) => {
      vinCarrier[normVin(c.vin)] = c.to;
      const r = findLiveRow(c.vin);
      if (r && r.ops) {
        r.ops.carrier = c.to;
        r.ops.carrierChangedFrom = c.original || '';
      }
    });
    lastLock = assignedCarrier();
    fleetFp = '';
    sheetFp = '';
    renderCompanyLockHint();
    if (changed.length) {
      setPrintStatus(`تم تحديث الناقل في Live Sheet: ${changed.map((c) => `${c.from} ← ${c.to}`).filter((s, i, a) => a.indexOf(s) === i).join(' · ')}`, 'ok');
    }
  }

  /** Memo's assigned الناقل changed (VIN picked / typed) → re-select the company. */
  function syncCompanyLock() {
    if (isWarehouse()) return;
    const lock = assignedCarrier();
    if (lock === lastLock) return;
    lastLock = lock;
    renderAttendanceSelects();
  }

  /** Representative name is typed; anyone checked in for that company is offered as a suggestion. */
  function renderAttendanceNames() {
    const list = $('rep-list');
    if (!list) return;
    const company = $('company_rep').value;
    const group = attendanceCompanies.find((g) => g.company === company);
    const people = (group && group.people) || [];
    list.innerHTML = people.map((p) => `<option value="${esc(p.name)}">${esc(p.phone || '')}</option>`).join('');
  }

  function attendanceCity() {
    return String($('branch_to').value || '').trim();
  }

  /** Every company with how many cars it took — independent of attendance.html check-ins. */
  async function loadAttendanceOptions() {
    if (isWarehouse()) return;
    lastLock = assignedCarrier();
    const data = await api('/coordinator/companies');
    attendanceCompanies = data.companies || [];
    renderAttendanceSelects();
    updatePreview();
  }

  /** Live refresh of the "took N" counts while the memo is open (keeps the current choice). */
  function refreshCompanyCounts() {
    if (isWarehouse() || $('mainApp').classList.contains('hidden')) return;
    api('/coordinator/companies').then((data) => {
      attendanceCompanies = data.companies || attendanceCompanies;
      if (document.activeElement !== $('company_rep')) renderAttendanceSelects();
    }).catch(() => {});
  }

  /** Typed name matches someone checked in for that company → hold that attendance entry (marked used on print). */
  async function syncRepAttendance() {
    const name = selectedAttendanceName();
    const company = String($('company_rep').value || '').trim();
    const group = attendanceCompanies.find((g) => g.company === company);
    const person = name && group ? (group.people || []).find((p) => p.name === name) : null;
    if (!person) {
      await releaseAttendanceHold();
      return;
    }
    if (person.id === claimedAttendanceId) return;
    try {
      await api('/attendance/hold', { method: 'POST', json: { id: person.id, company } });
      claimedAttendanceId = person.id;
    } catch (_) {
      claimedAttendanceId = '';
    }
  }

  async function releaseAttendanceHold() {
    if (!claimedAttendanceId) return;
    claimedAttendanceId = '';
    try {
      await api('/attendance/release', { method: 'POST', json: {} });
    } catch (_) { /* ignore */ }
  }

  function setPrintStatus(msg, type) {
    const el = $('printStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status no-print' + (type ? ` ${type}` : '');
  }

  function buildCarRows() {
    const body = $('carsBody');
    body.innerHTML = AR_NUMS.map((n, i) => `
      <tr>
        <td class="row-no">${n}</td>
        <td><input name="car_model_${i}" data-field="model" data-row="${i}" aria-label="Model row ${i + 1}"></td>
        <td><input name="car_chassis_${i}" data-field="chassis" data-row="${i}" class="chassis-pick vin-ltr" placeholder="${i === 0 ? '' : 'انقر للاختيار'}" aria-label="Chassis row ${i + 1}" readonly></td>
        <td><input name="car_plate_${i}" data-field="plate" data-row="${i}" aria-label="Plate row ${i + 1}"></td>
        <td><input name="car_remarks_${i}" data-field="remarks" data-row="${i}" aria-label="Remarks row ${i + 1}"></td>
      </tr>
    `).join('');
    let lockTimer = null;
    body.querySelectorAll('input').forEach((el) => {
      el.addEventListener('input', () => {
        syncCarCount();
        updatePreview();
        if (el.dataset.field === 'chassis') {
          clearTimeout(lockTimer);
          lockTimer = setTimeout(syncCompanyLock, 300);
        }
      });
    });
    body.querySelectorAll('.chassis-pick').forEach((el) => {
      el.addEventListener('click', () => {
        const row = parseInt(el.dataset.row, 10);
        if (Number.isNaN(row)) return;
        if (isTypedMode()) return;
        openAddVinPicker(row, memoSource);
      });
    });
  }

  function getSelectedVins(exceptRow) {
    const form = $('deliveryForm');
    return AR_NUMS.map((_, i) => {
      if (i === exceptRow) return '';
      const el = form.querySelector(`[name="car_chassis_${i}"]`);
      return el && el.value ? el.value.trim().toUpperCase() : '';
    }).filter(Boolean);
  }

  function countFilledChassis() {
    const form = $('deliveryForm');
    return AR_NUMS.reduce((n, _x, i) => {
      const el = form.querySelector(`[name="car_chassis_${i}"]`);
      return n + (el && el.value.trim() ? 1 : 0);
    }, 0);
  }

  function syncCarCount() {
    const n = countFilledChassis();
    $('car_count').value = n ? String(n) : '';
  }

  function isWarehouse() {
    return printMode === 'warehouse';
  }

  /** Manual + Display & Internal: chassis / model typed by hand, branch editable. */
  function isTypedMode() {
    return printMode === 'manual' || printMode === 'display';
  }

  function overlayPositionStyle(tag, x, y, w, h) {
    let left = `${x * 100}%`;
    const top = `${y * 100}%`;
    if (/^wh_chassis/.test(tag)) left = `${x * 100}%`;
    else if (/_chassis$/.test(tag)) left = `calc(${x * 100}% + 15.9mm)`;
    if (/_model$/.test(tag)) left = `calc(${x * 100}% + 4mm)`;
    if (/_plate$/.test(tag)) left = `calc(${x * 100}% + 10.6mm)`;
    return `left:${left};top:${top};width:${w * 100}%;height:${h * 100}%`;
  }

  function buildOverlay() {
    const overlayFields = $('overlayFields');
    const warehouse = isWarehouse() && typeof CHECK_NOTE_FIELDS !== 'undefined';
    const layout = warehouse ? CHECK_NOTE_FIELDS : (typeof MUTHAKARA_FIELDS !== 'undefined' ? MUTHAKARA_FIELDS : []);
    if (!overlayFields || !layout.length) return;
    Object.keys(fieldEls).forEach((k) => { delete fieldEls[k]; });
    let coverHtml = '';
    if (!warehouse) {
      const cover = typeof MEMO_NUMBER_COVER !== 'undefined' ? MEMO_NUMBER_COVER : [0.050, 0.122, 0.146, 0.036];
      const [cx, cy, cw, ch] = cover;
      coverHtml = `<div class="overlay-cover" aria-hidden="true" style="left:${cx * 100}%;top:${cy * 100}%;width:${cw * 100}%;height:${ch * 100}%"></div>`;
    }
    overlayFields.innerHTML = coverHtml + layout.map(([tag, x, y, w, h, align]) => {
      const dateCls = /^date_[dmy]$/.test(tag) ? ' overlay-field--header-date' : '';
      const invoiceCls = tag === 'invoice_number' ? ' overlay-field--invoice' : '';
      const chassisCls = /chassis/.test(tag) ? ' overlay-field--chassis' : '';
      const cls = `overlay-field align-${align || 'end'}${dateCls}${invoiceCls}${chassisCls}`;
      return `<div class="${cls}" data-tag="${tag}" style="${overlayPositionStyle(tag, x, y, w, h)}"></div>`;
    }).join('');
    overlayFields.querySelectorAll('.overlay-field').forEach((el) => {
      fieldEls[el.dataset.tag] = el;
    });
    overlayReady = true;
  }

  function collectPayload() {
    const form = $('deliveryForm');
    const fd = new FormData(form);
    const cars = AR_NUMS.map((_, i) => ({
      model: fd.get(`car_model_${i}`)?.trim() || '',
      chassis: fd.get(`car_chassis_${i}`)?.trim() || '',
      plate: fd.get(`car_plate_${i}`)?.trim() || '',
      remarks: fd.get(`car_remarks_${i}`)?.trim() || '',
    }));
    const filled = countFilledChassis();
    return {
      doc_date: fd.get('doc_date'),
      invoice_number: fd.get('invoice_number')?.trim(),
      dep_hour: fd.get('dep_hour')?.trim(),
      dep_minute: fd.get('dep_minute')?.trim(),
      customer_name: selectedAttendanceName() || fd.get('customer_name')?.trim(),
      company_rep: String($('company_rep').value || '').trim(),
      attendanceId: claimedAttendanceId,
      transfer_date: fd.get('transfer_date') || fd.get('doc_date'),
      corresponding_date: fd.get('corresponding_date') || fd.get('transfer_date') || fd.get('doc_date'),
      day_name: fd.get('day_name')?.trim(),
      trailer_number: fd.get('trailer_number')?.trim(),
      car_count: String(filled || fd.get('car_count')?.trim() || ''),
      branch_to: fd.get('branch_to')?.trim() || '',
      attachments: fd.get('attachments')?.trim(),
      warehouse: {
        owner_name: fd.get('wh_owner_name')?.trim(),
        user_name: fd.get('wh_user_name')?.trim(),
        user_phone: fd.get('wh_user_phone')?.trim(),
        user_id: fd.get('wh_user_id')?.trim(),
        print_date: fd.get('wh_print_date')?.trim(),
        print_time: fd.get('wh_print_time')?.trim(),
      },
      cars,
    };
  }

  function formatWhPrintDate(iso) {
    const s = String(iso || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
  }

  function formatWhPrintTime(value) {
    const raw = String(value || '').trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
      const parts = raw.split(':');
      return `${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}:${String(parts[2] || '00').padStart(2, '0')}`;
    }
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
    } catch (_) {
      return '';
    }
  }

  function buildCheckNoteOverlayData(body) {
    const wh = body.warehouse || {};
    const vins = [];
    const seen = new Set();
    (body.cars || []).forEach((c) => {
      const vin = String(c && c.chassis || '').trim().toUpperCase();
      if (!vin || seen.has(vin)) return;
      seen.add(vin);
      vins.push(vin);
    });
    const owner = wh.owner_name || body.customer_name || '';
    return {
      wh_owner_name: owner,
      wh_user_name: wh.user_name || '',
      wh_user_phone: wh.user_phone || '',
      wh_user_id: wh.user_id || '',
      wh_print_date: formatWhPrintDate(wh.print_date || body.doc_date || ''),
      wh_print_time: formatWhPrintTime(wh.print_time),
      wh_chassis: vins[0] || '',
      wh_chassis_2: vins[1] || '',
      wh_chassis_3: vins[2] || '',
      wh_chassis_4: vins[3] || '',
      wh_chassis_5: vins[4] || (vins.length > 5 ? `+${vins.length - 4} أخرى` : ''),
    };
  }

  function buildFlatData(body) {
    const docDate = splitDateParts(body.doc_date);
    const transferDate = splitDateParts(body.transfer_date || body.doc_date);
    const correspondingIso = body.corresponding_date || body.transfer_date || body.doc_date;
    const correspondingDate = splitDateParts(correspondingIso);
    const correspondingHijri = toHijriPartsFromIso(correspondingIso);
    const data = {
      date_d: docDate.d,
      date_m: docDate.m,
      date_y: docDate.y,
      invoice_number: body.invoice_number || '',
      dep_hour: body.dep_hour || '',
      dep_minute: body.dep_minute || '',
      customer_name: body.customer_name || '',
      company_rep: body.company_rep || '',
      transfer_d: transferDate.d,
      transfer_m: transferDate.m,
      transfer_y: transferDate.y,
      corresponding_d: correspondingHijri.d || correspondingDate.d,
      corresponding_m: correspondingHijri.m || correspondingDate.m,
      corresponding_y: correspondingHijri.y || correspondingDate.y,
      day_name: body.day_name || '',
      trailer_number: body.trailer_number || '',
      car_count: body.car_count || '',
      branch_to: body.branch_to || '',
      attachments: body.attachments || '',
    };
    const cars = Array.isArray(body.cars) ? body.cars : [];
    for (let i = 1; i <= 10; i++) {
      const row = cars[i - 1] || {};
      data[`car${i}_model`] = row.model || '';
      data[`car${i}_chassis`] = row.chassis || '';
      data[`car${i}_plate`] = row.plate || '';
      data[`car${i}_remarks`] = row.remarks || '';
    }
    return data;
  }

  function updatePreview() {
    if (!overlayReady) buildOverlay();
    const payload = collectPayload();
    const data = isWarehouse() ? buildCheckNoteOverlayData(payload) : buildFlatData(payload);
    Object.keys(fieldEls).forEach((tag) => {
      fieldEls[tag].textContent = data[tag] || '';
    });
  }

  function setTodayDates() {
    const today = getSaudiTodayIso();
    $('doc_date').value = today;
    $('transfer_date').value = today;
    $('corresponding_date').value = today;
    $('day_name').value = arabicDayName(today);
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = timeParts.find((p) => p.type === 'hour')?.value || '';
    const minute = timeParts.find((p) => p.type === 'minute')?.value || '';
    $('dep_hour').value = hour === '24' ? '00' : hour;
    $('dep_minute').value = minute;
    if ($('wh_print_date')) $('wh_print_date').value = today;
    if ($('wh_print_time')) {
      const now = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      $('wh_print_time').value = now;
    }
    updatePreview();
  }

  function syncDayFromTransferDate() {
    const transfer = $('transfer_date').value || $('doc_date').value || getSaudiTodayIso();
    $('day_name').value = arabicDayName(transfer);
    updatePreview();
  }

  function validatePrintFields() {
    if (!countFilledChassis()) {
      setPrintStatus(isWarehouse() || isTypedMode() ? 'أدخل رقم الشاسيه قبل الطباعة' : 'لا يوجد رقم شاسيه للطباعة', 'err');
      return false;
    }
    if (isWarehouse()) return true;
    const display = printMode === 'display';
    const company = String($('company_rep').value || '').trim();
    const branch = String($('branch_to').value || '').trim();
    const invoice = String($('invoice_number').value || '').trim();
    const attach = String($('attachments').value || '').trim();
    if (!invoice) {
      setPrintStatus('أدخل رقم الفاتورة قبل الطباعة', 'err');
      $('invoice_number').focus();
      return false;
    }
    if (!company && !display) {
      setPrintStatus('اختر الشركة قبل الطباعة', 'err');
      $('company_rep').focus();
      return false;
    }
    if (company && !selectedAttendanceName()) {
      setPrintStatus('اكتب اسم مندوب الشركة قبل الطباعة', 'err');
      $('customer_name').focus();
      return false;
    }
    if (!branch) {
      const editable = !$('branch_to').readOnly;
      setPrintStatus(
        editable ? 'اختر الفرع / المدينة قبل الطباعة' : 'لا توجد مدينة ترحيل على Live Sheet لهذا الشاسيه',
        'err'
      );
      if (editable) $('branch_to').focus();
      return false;
    }
    if (printMode === 'manual' && attach !== 'صالة عرض' && attach !== 'تسليم') {
      setPrintStatus('اختر المرفق: صالة عرض أو تسليم', 'err');
      return false;
    }
    if (display && attach !== 'داخلي' && attach !== 'صالة عرض') {
      setPrintStatus('اختر المرفق: داخلي أو صالة عرض', 'err');
      return false;
    }
    return true;
  }

  function printKind() {
    if (isWarehouse()) return 'warehouse';
    return printMode === 'display' ? 'display' : 'memo';
  }

  async function doPrintA4() {
    if (!validatePrintFields()) return;
    const printedVins = getSelectedVins();
    let invoiceNumber = '';
    if (!isWarehouse()) {
      try {
        const issued = await api('/print-invoice', { method: 'POST', json: { vin: printedVins[0] || '' } });
        invoiceNumber = String(issued.invoiceNumber || '');
        fill('invoice_number', invoiceNumber);
      } catch (err) {
        setPrintStatus(err.message || 'فشل إصدار رقم المذكرة', 'err');
        return;
      }
    }
    const snapshot = collectPayload();
    if (invoiceNumber) snapshot.invoice_number = invoiceNumber;
    const kind = printKind();
    try {
      await api('/print-complete', {
        method: 'POST',
        json: {
          vins: printedVins,
          kind,
          label: kind === 'display' ? (String(snapshot.attachments || '').trim() === 'داخلي' ? 'داخلي' : 'عرض') : '',
          attendanceId: isWarehouse() ? '' : claimedAttendanceId,
          company: isWarehouse() ? '' : String($('company_rep').value || '').trim(),
          city: isWarehouse() ? '' : attendanceCity(),
          invoiceNumber,
          snapshot,
        },
      });
      if (!isWarehouse()) claimedAttendanceId = '';
    } catch (err) {
      setPrintStatus(err.message || 'فشل تحديث قائمة المنسق', 'err');
      return;
    }
    buildOverlay();
    updatePreview();
    const cleanupPrintCopies = () => {
      const existing = document.getElementById('printCopies');
      if (existing) existing.remove();
    };
    cleanupPrintCopies();
    const printSheet = $('printSheet');
    const copiesContainer = document.createElement('div');
    copiesContainer.id = 'printCopies';
    for (let i = 0; i < 3; i++) {
      const clone = printSheet.cloneNode(true);
      clone.classList.add('print-copy');
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      copiesContainer.appendChild(clone);
    }
    document.body.insertBefore(copiesContainer, document.body.firstChild);
    const finish = () => {
      cleanupPrintCopies();
      window.removeEventListener('afterprint', finish);
      setPrintMode('sheet');
      resetPrintForm();
      closeVinModal();
      const search = $('availableVinSearch');
      if (search) search.value = '';
      showView('workspace');
      refreshWorkspace();
    };
    const waitImages = Promise.all([...copiesContainer.querySelectorAll('img')].map((img) => (
      img.complete ? Promise.resolve() : new Promise((done) => {
        img.onload = () => done();
        img.onerror = () => done();
      })
    )));
    window.addEventListener('afterprint', finish);
    setPrintStatus('جاري فتح نافذة الطباعة — ٣ صفحات A4…', 'ok');
    waitImages.then(() => {
      requestAnimationFrame(() => window.print());
    });
  }

  function fillBranchList() {
    const list = $('branch-list');
    if (!list) return;
    list.innerHTML = transferCities.map((c) => `<option value="${esc(c)}"></option>`).join('');
  }

  function syncAttachmentChoice() {
    const picked = document.querySelector('input[name="attach_opt"]:checked');
    const pickedDisplay = document.querySelector('input[name="display_opt"]:checked');
    if (printMode === 'manual') fill('attachments', picked ? picked.value : '');
    if (printMode === 'display') fill('attachments', pickedDisplay ? pickedDisplay.value : '');
    updatePreview();
  }

  function setPrintMode(mode) {
    printMode = ['manual', 'warehouse', 'display'].includes(mode) ? mode : 'sheet';
    const manual = printMode === 'manual';
    const warehouse = printMode === 'warehouse';
    const display = printMode === 'display';
    const typed = manual || display;
    const branch = $('branch_to');
    const attach = $('attachments');
    document.body.classList.toggle('warehouse-form-mode', warehouse);
    document.body.classList.toggle('manual-form-mode', manual);
    document.body.classList.toggle('display-form-mode', display);
    $('warehouseTopFields').classList.toggle('hidden', !warehouse);
    branch.readOnly = !typed;
    if (typed) branch.removeAttribute('readonly');
    else branch.setAttribute('readonly', '');
    $('branchReq').classList.toggle('hidden', !typed);
    $('attachReq').classList.toggle('hidden', !typed);
    attach.classList.toggle('hidden', typed);
    $('attachmentsManual').classList.toggle('hidden', !manual);
    $('attachmentsDisplay').classList.toggle('hidden', !display);
    document.querySelectorAll('#carsBody [data-field="chassis"]').forEach((el) => {
      el.readOnly = !typed;
      el.placeholder = typed ? 'اكتب رقم الشاسية' : 'انقر للاختيار';
    });
    $('navTitle').textContent = warehouse ? 'التسليم في المستودع' : display ? 'Display & Internal' : 'مذكرة ترحيل السيارات';
    $('printHeroTitle').textContent = warehouse
      ? 'قائمة فحص السيارات وقت التسليم'
      : display ? 'مذكرة ترحيل — داخلي / صالة عرض' : 'مذكرة ترحيل السيارات';
    $('printHeroHint').textContent = warehouse
      ? 'نموذج المستودع · ابحث الشاسيه ثم راجع البيانات واطبع'
      : display
        ? 'اكتب السيارة (الموديل والشاسيه) والمدينة · المرفق داخلي أو صالة عرض · الشركة اختيارية'
        : manual
          ? 'السيارة غير موجودة في البحث · اكتب الشركة والفرع يدوياً · المرفق صالة عرض أو تسليم'
          : 'الشركة = الناقل المعيّن على Live Sheet (يمكن تغييرها) · الفرع من مدينة الترحيل · رقم المذكرة تلقائي';
    $('carsHint').textContent = typed
      ? 'اكتب الموديل ورقم الشاسية يدوياً — بدون اختيار من Live Sheet'
      : 'انقر أي صف شاسيه لاختيار سيارة من Live Sheet';
    $('previewTitle').textContent = warehouse ? 'معاينة قائمة فحص التسليم' : 'معاينة مذكرة الترحيل';
    const img = $('previewFormImage');
    img.src = warehouse
      ? '../images/delivery-check-note-form.png'
      : '../images/muthakara-tarhil-form.png';
    img.alt = warehouse ? 'قائمة فحص السيارات وقت التسليم' : 'مذكرة ترحيل';
    $('btnPrint').textContent = warehouse ? '🖨 طباعة قائمة الفحص' : '🖨 طباعة A4';
    $('btnPrint2').textContent = warehouse ? '🖨 طباعة قائمة الفحص' : '🖨 طباعة A4';
    if (!manual) {
      document.querySelectorAll('input[name="attach_opt"]').forEach((el) => { el.checked = false; });
    }
    if (!display) {
      document.querySelectorAll('input[name="display_opt"]').forEach((el) => { el.checked = false; });
    }
    overlayReady = false;
    buildOverlay();
  }

  function resetPrintForm() {
    $('deliveryForm').reset();
    buildCarRows();
    setPrintStatus('');
    vinCarrier = {};
    lastLock = '';
    memoSource = 'live';
    $('company_rep').disabled = false;
    $('company_rep').classList.remove('is-locked');
    renderCompanyLockHint();
  }

  async function peekInvoice() {
    try {
      const peek = await api('/print-invoice');
      fill('invoice_number', String(peek.next || 1000));
    } catch {
      fill('invoice_number', '1000');
    }
  }

  function fillTodayTimes() {
    const today = getSaudiTodayIso();
    fill('transfer_date', today);
    fill('corresponding_date', today);
    fill('day_name', arabicDayName(today));
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    $('dep_hour').value = (timeParts.find((p) => p.type === 'hour')?.value || '').replace('24', '00');
    $('dep_minute').value = timeParts.find((p) => p.type === 'minute')?.value || '';
    if ($('wh_print_date')) $('wh_print_date').value = today;
    if ($('wh_print_time')) {
      $('wh_print_time').value = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
    }
    return today;
  }

  function closeVinModal() {
    $('vinModal').classList.remove('open');
    activeVinRow = null;
    setVinModalNote('');
    $('vinModalFoot').classList.add('hidden');
  }

  function setVinModalNote(msg) {
    const note = $('vinModalNote');
    if (!note) return;
    note.textContent = msg || '';
    note.classList.toggle('hidden', !msg);
  }

  function findLiveRow(vin) {
    const key = normVin(vin);
    return rows.find((r) => normVin(r.vin) === key) || null;
  }

  function findSalesRawRow(vin) {
    const key = normVin(vin);
    return (salesRawRows || []).find((r) => normVin(r.vin) === key) || null;
  }

  async function loadSalesRawVins() {
    if (salesRawLoading) return;
    salesRawLoading = true;
    try {
      const data = await api('/sales-raw-vins');
      salesRawRows = data.rows || [];
      const meta = $('vinSrcMeta');
      if (meta) {
        const last = data.lastSalesRaw;
        meta.textContent = `${salesRawRows.length} غير معيّن${last && last.at ? ` · Sales Raw ${new Date(last.at).toLocaleString()}` : ''}`;
      }
    } finally {
      salesRawLoading = false;
    }
  }

  function setVinSource(src) {
    vinSource = src === 'sales' ? 'sales' : 'live';
    document.querySelectorAll('#vinSrcTabs [data-vin-src]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.vinSrc === vinSource);
    });
    $('vinModalTitle').textContent = vinSource === 'sales'
      ? 'إذا لم يتم تعيين الشاسيه — ابحث في Sales Raw'
      : 'أضف سيارة من Live Sheet';
    setVinModalNote('');
    if (vinSource === 'sales') {
      salesRawRows = null;
      renderVinModal($('vinModalSearch').value);
      loadSalesRawVins()
        .then(() => renderVinModal($('vinModalSearch').value))
        .catch((e) => {
          salesRawRows = [];
          setVinModalNote(e.message || 'تعذر تحميل Sales Raw');
          renderVinModal($('vinModalSearch').value);
        });
      return;
    }
    renderVinModal($('vinModalSearch').value);
  }

  /** Sales Raw picker list: VINs on the Live Sheet first (with their city / الناقل), then Sales Raw VINs not assigned yet. */
  function salesPickList() {
    const seen = new Set();
    const out = [];
    rows.forEach((r) => {
      const key = normVin(r.vin);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ vin: r.vin, raw: r.raw || {}, ops: r.ops || {}, src: 'live' });
    });
    (salesRawRows || []).forEach((r) => {
      const key = normVin(r.vin);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ vin: r.vin, raw: r.raw || {}, ops: {}, src: 'sales' });
    });
    return out;
  }

  function renderVinModal(query) {
    const q = String(query || '').trim().toUpperCase().replace(/\s+/g, '');
    const exclude = new Set(vinPickerMode === 'add-row' ? getSelectedVins(activeVinRow) : []);
    const salesMode = vinPickerMode === 'add-row' && vinSource === 'sales';
    const grid = $('vinModalGrid');
    if (salesMode && salesRawRows === null) {
      grid.innerHTML = '<p class="vin-empty">جاري تحميل Sales Raw…</p>';
      return;
    }
    const source = salesMode ? salesPickList() : rows.map((r) => ({ ...r, src: 'live' }));
    const list = source.filter((r) => {
      const vin = normVin(r.vin);
      if (exclude.has(vin)) return false;
      if (!q) return true;
      const hay = [
        r.vin,
        r.raw && r.raw.product,
        r.raw && r.raw.salesOrder,
        r.raw && r.raw.userName,
        r.raw && r.raw.phone,
        r.raw && r.raw.salesType,
      ].join(' ').toUpperCase().replace(/\s+/g, '');
      return hay.includes(q);
    });
    const countNote = vinPickerMode === 'add-row'
      ? `${list.length} شاسيه${q ? ' مطابق' : ' على Live Sheet'}`
      : '';
    if (!list.length) {
      grid.innerHTML = `<p class="vin-empty">${salesMode ? 'لا توجد شاسيهات في Sales Raw مطابقة' : 'لا توجد شاسيهات من Live Sheet مطابقة'}</p>`;
      if (countNote) setVinModalNote(countNote);
      return;
    }
    if (countNote) setVinModalNote(countNote);
    grid.innerHTML = list.map((r) => {
      const carrier = String((r.ops && r.ops.carrier) || '').trim();
      const badge = salesMode
        ? `<span class="vin-src-badge vin-src-badge--${r.src}">${r.src === 'live' ? 'على Live Sheet' : 'Sales Raw · غير معيّن'}</span>`
        : '';
      return `
      <button type="button" class="vin-card" data-vin="${esc(r.vin)}">
        ${badge}
        <div class="vin-no">${esc(r.vin)}</div>
        <div class="vin-product">${esc((r.raw && r.raw.product) || '—')}</div>
        <div class="vin-meta">${esc([r.raw && r.raw.salesOrder, r.raw && r.raw.userName, r.ops && r.ops.transferCity].filter(Boolean).join(' · ') || '—')}</div>
        ${carrier ? `<div class="vin-carrier">🚚 ${esc(carrier)}</div>` : '<div class="vin-carrier vin-carrier--none">بدون ناقل</div>'}
      </button>`;
    }).join('');
  }

  function onVinCardClick(e) {
    const btn = e.target.closest('.vin-card');
    if (!btn) return;
    if (vinPickerMode === 'add-row') {
      applyPickedVin(btn.dataset.vin);
      return;
    }
    closeVinModal();
    openWarehouseDetail(btn.dataset.vin).catch((err) => alert(err.message));
  }

  function cityFromSalesRaw(raw) {
    const cands = [raw && raw.gtLocation, raw && raw.vehicleLocation].map((s) => String(s || '').trim()).filter(Boolean);
    for (let i = 0; i < cands.length; i += 1) {
      const hit = transferCities.find((c) => c === cands[i] || cands[i].includes(c));
      if (hit) return hit;
    }
    return '';
  }

  function setBranchEditable(editable) {
    const branch = $('branch_to');
    branch.readOnly = !editable;
    if (editable) branch.removeAttribute('readonly');
    else branch.setAttribute('readonly', '');
    $('branchReq').classList.toggle('hidden', !editable);
  }

  /** Put the picked VIN into the clicked memo row — Live Sheet data first, else Sales Raw. */
  function applyPickedVin(vin) {
    if (activeVinRow == null) {
      closeVinModal();
      return;
    }
    const live = findLiveRow(vin);
    const sales = live ? null : findSalesRawRow(vin);
    const row = live || sales;
    if (!row) {
      closeVinModal();
      return;
    }
    const carrier = live ? String((live.ops && live.ops.carrier) || '').trim() : '';
    vinCarrier[normVin(row.vin)] = carrier;
    const form = $('deliveryForm');
    const chassis = form.querySelector(`[name="car_chassis_${activeVinRow}"]`);
    const model = form.querySelector(`[name="car_model_${activeVinRow}"]`);
    if (chassis) chassis.value = row.vin;
    if (model) model.value = (row.raw && row.raw.product) || '';
    const isFirst = activeVinRow === 0;
    if (isFirst && printMode === 'sheet') {
      const city = live ? String((live.ops && live.ops.transferCity) || '').trim() : cityFromSalesRaw(row.raw);
      fill('branch_to', city);
      setBranchEditable(!live || !city);
      const d = toIsoDate(row.raw && row.raw.proformaDate);
      if (d) fill('doc_date', d);
    }
    closeVinModal();
    syncCarCount();
    updatePreview();
    if (isFirst && printMode === 'sheet') {
      (async () => {
        if (claimedAttendanceId) await releaseAttendanceHold();
        await loadAttendanceOptions();
      })().catch(() => {});
    } else {
      syncCompanyLock();
    }
  }

  function openAddVinPicker(rowIndex, source) {
    vinPickerMode = 'add-row';
    activeVinRow = rowIndex;
    $('vinModalSearch').value = '';
    $('vinSrcTabs').classList.remove('hidden');
    $('vinModalFoot').classList.toggle('hidden', getSelectedVins(rowIndex).length > 0);
    $('vinModal').classList.add('open');
    setVinSource(source || 'live');
    setTimeout(() => $('vinModalSearch').focus(), 40);
  }

  function openWarehouseSearch() {
    vinPickerMode = 'open-warehouse';
    activeVinRow = null;
    vinSource = 'live';
    $('vinSrcTabs').classList.add('hidden');
    setVinModalNote('');
    $('vinModalTitle').textContent = 'التسليم في المستودع — ابحث عن الشاسيه';
    $('vinModalSearch').value = '';
    renderVinModal('');
    $('vinModal').classList.add('open');
    setTimeout(() => $('vinModalSearch').focus(), 40);
  }

  /** "في حال عدم وجود السيارة": blank memo, then pick row 1 from every Live Sheet VIN (search). */
  function openMissingDetail() {
    return openBlankMemo('live');
  }

  /** Blank memo, then pick row 1 from the Live Sheet ('live') or unassigned Sales Raw ('sales'). */
  async function openBlankMemo(source) {
    resetPrintForm();
    setPrintMode('sheet');
    memoSource = source === 'sales' ? 'sales' : 'live';
    fill('doc_date', fillTodayTimes());
    fill('company_rep', '');
    fill('customer_name', '');
    fill('branch_to', '');
    setBranchEditable(true);
    claimedAttendanceId = '';
    await loadAttendanceOptions();
    await peekInvoice();
    syncCarCount();
    if (!overlayReady) buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
    openAddVinPicker(0, memoSource);
  }

  /** Display & Internal: type the vehicle + city, المرفق داخلي / صالة عرض, saved with that label. */
  async function openDisplayDetail() {
    resetPrintForm();
    setPrintMode('display');
    fill('doc_date', fillTodayTimes());
    fill('company_rep', '');
    fill('customer_name', '');
    fill('branch_to', '');
    fill('attachments', '');
    claimedAttendanceId = '';
    await loadAttendanceOptions();
    await peekInvoice();
    syncCarCount();
    if (!overlayReady) buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
    const model0 = document.querySelector('[name="car_model_0"]');
    if (model0) model0.focus();
  }

  async function openWarehouseDetail(vin) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    resetPrintForm();
    setPrintMode('warehouse');
    fill('doc_date', fillTodayTimes());
    fill('wh_owner_name', v.raw.invoiceOwner || v.raw.userName);
    fill('wh_user_name', v.raw.userName);
    fill('wh_user_phone', v.raw.phone);
    fill('wh_user_id', '');
    const form = $('deliveryForm');
    form.querySelector('[name="car_model_0"]').value = v.raw.product || '';
    form.querySelector('[name="car_chassis_0"]').value = v.vin || '';
    form.querySelector('[name="car_chassis_0"]').readOnly = true;
    syncCarCount();
    buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
  }

  async function openManualDetail() {
    resetPrintForm();
    setPrintMode('manual');
    fill('doc_date', fillTodayTimes());
    fill('company_rep', '');
    fill('customer_name', '');
    fill('branch_to', '');
    fill('attachments', '');
    claimedAttendanceId = '';
    await loadAttendanceOptions();
    await peekInvoice();
    syncCarCount();
    if (!overlayReady) buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
    $('company_rep').focus();
  }

  async function openDetail(vin) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    resetPrintForm();
    setPrintMode('sheet');
    const today = fillTodayTimes();
    const docDate = toIsoDate(v.raw.proformaDate) || today;
    fill('doc_date', docDate);
    fill('company_rep', '');
    fill('customer_name', '');
    const city = String((v.ops && v.ops.transferCity) || '').trim();
    fill('branch_to', city);
    setBranchEditable(!city);
    claimedAttendanceId = '';
    vinCarrier[normVin(v.vin)] = String((v.ops && v.ops.carrier) || '').trim();
    const form = $('deliveryForm');
    form.querySelector('[name="car_model_0"]').value = v.raw.product || '';
    form.querySelector('[name="car_chassis_0"]').value = v.vin || '';
    form.querySelector('[name="car_chassis_0"]').readOnly = true;
    await loadAttendanceOptions();
    await peekInvoice();
    syncCarCount();
    if (!overlayReady) buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
  }

  function bindPrintForm() {
    buildCarRows();
    buildOverlay();
    const form = $('deliveryForm');
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);
    $('transfer_date').addEventListener('change', syncDayFromTransferDate);
    $('doc_date').addEventListener('change', () => {
      if (!$('transfer_date').value) $('transfer_date').value = $('doc_date').value;
      syncDayFromTransferDate();
    });
    document.querySelectorAll('input[name="attach_opt"], input[name="display_opt"]').forEach((el) => {
      el.addEventListener('change', syncAttachmentChoice);
    });
    $('company_rep').addEventListener('change', async () => {
      if (claimedAttendanceId) await releaseAttendanceHold();
      fill('customer_name', '');
      renderAttendanceNames();
      updatePreview();
      try {
        await captureCarrierChange();
      } catch (err) {
        setPrintStatus(err.message || 'تعذر تحديث الناقل في Live Sheet', 'err');
      }
    });
    $('customer_name').addEventListener('change', async () => {
      await syncRepAttendance();
      updatePreview();
    });
    $('btnPrint').addEventListener('click', doPrintA4);
    $('btnPrint2').addEventListener('click', doPrintA4);
    $('btnToday').addEventListener('click', setTodayDates);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      doPrintA4();
    });
  }

  async function boot() {
    const meta = await api('/meta');
    transferCities = meta.transferCities || [];
    fillBranchList();
    const users = (meta.users || []).filter((u) => u.role === 'coordinator' || u.canCoordinate);
    $('loginUser').innerHTML = '<option value="">— اختر الاسم —</option>'
      + users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');

    $('btnLogin').addEventListener('click', login);
    $('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('btnLogout').addEventListener('click', logout);
    $('btnBackWorkspace').addEventListener('click', () => {
      releaseAttendanceHold().finally(() => {
        setPrintMode('sheet');
        showView('workspace');
        refreshWorkspace();
      });
    });
    $('brandHome').addEventListener('click', (e) => {
      e.preventDefault();
      releaseAttendanceHold().finally(() => {
        setPrintMode('sheet');
        showView('workspace');
        refreshWorkspace();
      });
    });
    $('availableVinSearch').addEventListener('input', filterFleet);
    $('availableFleet').addEventListener('click', (e) => {
      const fold = e.target.closest('[data-fold-type]');
      if (fold) {
        if (String($('availableVinSearch').value || '').trim()) return;
        const company = fold.dataset.foldType;
        if (collapsedCarriers.has(company)) collapsedCarriers.delete(company);
        else collapsedCarriers.add(company);
        filterFleet();
        return;
      }
      const card = e.target.closest('.fleet-card');
      if (card) openDetail(card.dataset.vin).catch((err) => alert(err.message));
    });
    $('fleet-fold-all').addEventListener('click', () => {
      $('availableFleet').querySelectorAll('.fleet-company-group').forEach((g) => {
        if (g.dataset.type) collapsedCarriers.add(g.dataset.type);
      });
      filterFleet();
    });
    $('fleet-open-all').addEventListener('click', () => {
      collapsedCarriers.clear();
      filterFleet();
    });
    $('tabFleet').addEventListener('click', () => setViewTab('fleet'));
    $('tabLiveSheet').addEventListener('click', () => setViewTab('live'));
    $('liveSheetSearch').addEventListener('input', filterLiveSheet);
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.multi-filter-btn');
      if (btn) {
        const menu = btn.parentElement.querySelector('.multi-filter-menu');
        const open = menu && menu.dataset.open === '1';
        document.querySelectorAll('.multi-filter-menu').forEach((m) => { m.hidden = true; m.dataset.open = ''; });
        if (menu && !open) {
          menu.hidden = false;
          menu.dataset.open = '1';
        }
        return;
      }
      if (e.target.closest('.multi-filter')) return;
      document.querySelectorAll('.multi-filter-menu').forEach((m) => { m.hidden = true; m.dataset.open = ''; });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && poll) refreshWorkspace();
    });
    const missing = () => {
      const go = () => openMissingDetail().catch((e) => alert(e.message));
      if (!rows.length) loadWorkspace().then(go).catch((e) => alert(e.message));
      else go();
    };
    $('btnMissingVin').addEventListener('click', missing);
    $('btnMissingVinEmpty').addEventListener('click', missing);
    $('btnDisplayInternal').addEventListener('click', () => openDisplayDetail().catch((e) => alert(e.message)));
    $('vinModalManual').addEventListener('click', () => {
      closeVinModal();
      openManualDetail().catch((e) => alert(e.message));
    });
    document.querySelectorAll('#vinSrcTabs [data-vin-src]').forEach((b) => {
      b.addEventListener('click', () => setVinSource(b.dataset.vinSrc));
    });
    $('vinModalGrid').addEventListener('click', onVinCardClick);
    $('btnWarehouse').addEventListener('click', () => {
      if (!rows.length) loadWorkspace().then(openWarehouseSearch).catch((e) => alert(e.message));
      else openWarehouseSearch();
    });
    $('vinModalClose').addEventListener('click', closeVinModal);
    $('vinModal').addEventListener('click', (e) => { if (e.target === $('vinModal')) closeVinModal(); });
    $('vinModalSearch').addEventListener('input', () => renderVinModal($('vinModalSearch').value));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('vinModal').classList.contains('open')) closeVinModal();
    });
    if ($('coPerfApply')) {
      $('coPerfApply').addEventListener('click', () => {
        loadCompanyPerformance().catch((e) => alert(e.message));
      });
    }
    if ($('coPerfMonth')) {
      $('coPerfMonth').addEventListener('click', () => {
        const range = monthRange();
        if ($('coPerfFrom')) $('coPerfFrom').value = range.from;
        if ($('coPerfTo')) $('coPerfTo').value = range.to;
        loadCompanyPerformance().catch((e) => alert(e.message));
      });
    }
    if ($('coPerfMore')) {
      $('coPerfMore').addEventListener('click', () => openDaysToSalesModal({}));
    }
    if ($('dtsModalClose')) $('dtsModalClose').addEventListener('click', closeDaysToSalesModal);
    if ($('dtsModal')) {
      $('dtsModal').addEventListener('click', (e) => {
        if (e.target === $('dtsModal')) closeDaysToSalesModal();
      });
    }
    const wireDtsFilter = (id, key, eventName) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener(eventName || 'change', () => {
        dtsCoState[key] = key === 'q' ? el.value.trim() : el.value;
        renderDaysToSalesModalTable();
      });
    };
    wireDtsFilter('dtsCoCompany', 'company');
    wireDtsFilter('dtsCoBucket', 'bucket');
    wireDtsFilter('dtsCoStatus', 'status');
    wireDtsFilter('dtsCoSearch', 'q', 'input');
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('dtsModal') && !$('dtsModal').hidden) closeDaysToSalesModal();
    });
    setCoPerfMonthDefaults();
    bindPrintForm();

    if (getToken() && getUser()) {
      try {
        const me = await api('/auth/me');
        if (me.user.role !== 'coordinator' && !me.user.canCoordinate) {
          showView('login');
          return;
        }
        enterApp(me.user);
        return;
      } catch {
        clearSession();
      }
    }
    showView('login');
  }

  boot().catch((e) => { $('loginStatus').textContent = e.message; });
})();
