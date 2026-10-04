(() => {
  const { api, downloadFile, esc, toast, getToken, getUser, setSession, clearSession, useSessionScope, migrateCollectorSession } = window.DTX;

  // Keep collector login separate from employee / inventory / coordinator sessions
  useSessionScope('collector');
  migrateCollectorSession();

  const $ = (id) => document.getElementById(id);

  function isCollector(user) {
    return !!(user && (user.id === 'collector' || user.role === 'admin'));
  }

  function showCollector(user) {
    $('collector-gate').classList.add('hidden');
    $('collector-app').classList.remove('hidden');
    startApp(user);
  }

  function kickToGate(message) {
    clearSession();
    alert(message || 'Sign in again as Collector');
    location.reload();
  }

  async function collectorLogin() {
    $('collector-error').textContent = '';
    try {
      const data = await api('/auth/collector', {
        method: 'POST',
        json: { password: $('collector-pass').value },
      });
      setSession(data.token, data.user);
      showCollector(data.user);
    } catch (err) {
      $('collector-error').textContent = err.message || 'Could not open collector';
    }
  }

  $('collector-btn').addEventListener('click', collectorLogin);
  $('collector-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') collectorLogin(); });

  (async function bootGate() {
    if (getToken() && isCollector(getUser())) {
      try {
        const me = await api('/auth/me');
        if (isCollector(me.user)) {
          showCollector(me.user);
          return;
        }
        kickToGate('Collector access required');
      } catch {
        clearSession();
      }
    }
  }());

  let started = false;
  function startApp(user) {
  if (started) return;
  started = true;
  const CITY_COLORS = ['#0b2a44', '#1769a8', '#0d6b3c', '#b45309', '#7c3aed', '#eb0a1e', '#0e7490', '#854d0e'];

  let dash = null;
  let perf = null;
  let empMonth = '';
  let kpiOpenId = '';
  let kpiData = null;
  let kpiExpanded = false;
  let kpiDetailKey = '';
  let slaDash = null;
  let inventoryDash = null;
  let backup = null;
  let dashTimer = null;
  let dashInFlight = false;
  let pdfQuery = '';

  DTXLive.wireHeader(user);
  if ($('who')) $('who').textContent = 'Collector';
  document.body.classList.add('vsnd-screen');

  function fmtWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  }

  function stayText(person) {
    const start = Date.parse(person.arrivedAt);
    if (!start) return '—';
    if (person.leftAt) return fmtDur(Date.parse(person.leftAt) - start);
    return `still here · ${fmtDur(Date.now() - start)}`;
  }

  function tickClock() {
    const el = $('live-clock');
    if (el) el.textContent = new Date().toLocaleString();
    if (!dash) return;
    dash.companies.forEach((c) => {
      c.people.filter((p) => p.status === 'present').forEach((p) => {
        const cell = document.querySelector(`[data-stay="${p.id}"]`);
        if (cell) cell.textContent = stayText(p);
      });
    });
  }

  function maxOf(list, key) {
    return Math.max(1, ...list.map((x) => Number(x[key]) || 0));
  }

  function allDrivers() {
    const rows = [];
    (dash.companies || []).forEach((c) => {
      (c.people || []).forEach((p) => rows.push({ ...p, company: c.company }));
    });
    return rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'present' ? -1 : 1;
      return (Date.parse(b.arrivedAt) || 0) - (Date.parse(a.arrivedAt) || 0);
    });
  }

  function openAllDrivers() {
    const people = allDrivers();
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>Drivers</h2>
          <p class="sub">${dash.present} present now · ${dash.left} left · click any company chart for company-only view</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap" style="max-height:70vh">
        <table class="data">
          <thead><tr><th>Driver</th><th>Company</th><th>Arrived</th><th>Left</th><th>Stay</th><th>VIN</th><th>City</th></tr></thead>
          <tbody>${people.map((p) => `
            <tr>
              <td><b>${esc(p.name)}</b></td>
              <td>${esc(p.company || '—')}</td>
              <td>${esc(fmtWhen(p.arrivedAt))}</td>
              <td class="${p.leftAt ? 'gone' : 'stay'}">${p.leftAt ? esc(fmtWhen(p.leftAt)) : 'Still here'}</td>
              <td data-stay="${esc(p.id)}">${esc(stayText(p))}</td>
              <td class="detail-vin">${esc((p.vins || []).join(', ') || '—')}</td>
              <td>${esc(p.city || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="7">No drivers have checked in yet.</td></tr>'}</tbody>
        </table>
      </div>`);
  }

  function renderKpis() {
    const host = $('dash-kpis');
    host.innerHTML = `
      <button type="button" class="kpi kpi-click" id="kpi-drivers" title="Open every driver · arrive, leave, company, VIN">
        <strong><span class="stay">${esc(dash.present)}</span><span class="kpi-split"> / </span><span class="gone">${esc(dash.left)}</span></strong>
        <span>Present now / Drivers left</span>
      </button>
      <div class="kpi"><strong>${esc(dash.notes)}</strong><span>Delivery notes</span></div>
      <div class="kpi"><strong>${esc(dash.memos)}</strong><span>Memos</span></div>`;
    const btn = $('kpi-drivers');
    if (btn) btn.addEventListener('click', openAllDrivers);
    $('dash-sync').textContent = new Date(dash.at).toLocaleTimeString();
  }

  function renderBackup() {
    const meta = $('backup-meta');
    if (!meta) return;
    if (!backup) {
      meta.textContent = 'Backup status unavailable';
      return;
    }
    const last = backup.lastAt ? fmtWhen(backup.lastAt) : 'not saved yet';
    const next = backup.nextAt ? fmtWhen(backup.nextAt) : '—';
    const snap = backup.snapshot || {};
    const live = backup.live || {};
    meta.textContent = `Last saved ${last} · next scan ${next} · snapshot ${snap.vehicles || 0} VINs · live ${live.vehicles || 0} VINs`;
  }

  function renderAttendance() {
    const host = $('attend-chart');
    const rows = (dash.companies || []).filter((c) => c.arrived || c.notes);
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No attendance or printed notes yet. Drivers check in on attendance.html; notes come from coordinator print.</p>';
      return;
    }
    const max = Math.max(1, ...rows.map((c) => Math.max(c.arrived, c.notes)));
    host.innerHTML = rows.map((c) => {
      const presentW = (c.present / max) * 100;
      const leftW = (c.left / max) * 100;
      return `<button type="button" class="chart-row" data-company="${esc(c.company)}">
        <span class="name">${esc(c.company)}</span>
        <span class="bar" title="${c.present} present · ${c.left} left">
          <i class="present" style="width:${presentW}%"></i>
          <i class="left" style="width:${leftW}%"></i>
        </span>
        <span class="meta">${c.present} in · ${c.notes} VIN</span>
      </button>`;
    }).join('');
    host.querySelectorAll('[data-company]').forEach((b) => {
      b.addEventListener('click', () => openCompany(b.dataset.company));
    });
  }

  function renderUsers() {
    const host = $('user-chart');
    const rows = dash.coordinators || [];
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No delivery notes printed yet.</p>';
      return;
    }
    const max = maxOf(rows, 'notes');
    host.innerHTML = rows.map((u) => `
      <div class="chart-row" style="cursor:default">
        <span class="name">${esc(u.name)}</span>
        <span class="bar"><i class="user" style="width:${(u.notes / max) * 100}%"></i></span>
        <span class="meta">${u.notes} note${u.notes === 1 ? '' : 's'}</span>
      </div>`).join('');
  }

  function renderCities() {
    const host = $('city-chart');
    const rows = dash.companyCities || [];
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No company city deliveries yet.</p>';
      return;
    }
    const max = maxOf(rows, 'total');
    host.innerHTML = rows.map((c) => {
      const segs = (c.cities || []).map((city, i) => {
        const w = (city.count / Math.max(c.total, 1)) * 100;
        const color = CITY_COLORS[i % CITY_COLORS.length];
        return `<i class="stack-seg" style="width:${w}%;background:${color}" title="${esc(city.city)} · ${city.count}"></i>`;
      }).join('');
      return `<button type="button" class="chart-row" data-city-co="${esc(c.company)}">
        <span class="name">${esc(c.company)}</span>
        <span class="bar">${segs}</span>
        <span class="meta">${c.total}</span>
      </button>`;
    }).join('');
    host.querySelectorAll('[data-city-co]').forEach((b) => {
      b.addEventListener('click', () => openCompanyCities(b.dataset.cityCo));
    });
  }

  function monthLabel(ym) {
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return '';
    const [y, m] = ym.split('-').map(Number);
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' });
    return name;
  }

  function achText(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return '—';
    return `${Math.round(Number(pct))}%`;
  }

  function empGap(r) {
    const mtd = Number(r.total) || 0;
    const target = Number(r.target) || 0;
    return {
      mtd,
      target,
      remaining: Math.max(0, target - mtd),
      span: Math.max(target, mtd, 0),
      pct: r.achPct,
    };
  }

  function renderEmployees() {
    const host = $('emp-chart');
    const kpis = $('emp-kpis');
    const tbody = $('emp-table-body');
    if (!host) return;
    const monthInp = $('emp-month');
    if (monthInp && perf && perf.month && monthInp.value !== perf.month) monthInp.value = perf.month;
    if ($('emp-month-hint') && perf) {
      const label = monthLabel(perf.month);
      $('emp-month-hint').textContent = perf.month === perf.currentMonth
        ? `${label || perf.month} MTD · day 1 → today`
        : `${label || perf.month} · full month`;
    }
    if (!perf) {
      if (kpis) kpis.innerHTML = '';
      host.innerHTML = '<p class="chart-empty">Could not load employee MTD / target data.</p>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="5">Could not load employee data.</td></tr>';
      return;
    }
    const rows = [...(perf.rows || [])].sort((a, b) => {
      const ap = a.achPct == null ? -1 : a.achPct;
      const bp = b.achPct == null ? -1 : b.achPct;
      return bp - ap || String(a.name).localeCompare(String(b.name));
    });
    const t = perf.totals || {};
    const team = empGap(t);
    if (kpis) {
      kpis.innerHTML = `
        <div class="kpi"><strong>${esc(team.target || 0)}</strong><span>Team target</span></div>
        <div class="kpi"><strong class="stay">${esc(team.mtd || 0)}</strong><span>MTD total</span></div>
        <div class="kpi"><strong class="sla-late-n">${esc(team.remaining || 0)}</strong><span>Still to target</span></div>
        <div class="kpi"><strong>${esc(achText(t.achPct))}</strong><span>Team Ach%</span></div>`;
    }
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No employees yet. Anyone on employee.html appears here automatically once targets are managed by Hanouf.</p>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="5">No employees yet.</td></tr>';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => empGap(r).span), team.span || 0);
    host.innerHTML = rows.map((r) => {
      const g = empGap(r);
      const greenW = (g.mtd / max) * 100;
      const redW = (g.remaining / max) * 100;
      const targetLabel = g.target ? `Target ${g.target}` : 'No target';
      return `<button type="button" class="chart-row sla-row" data-emp="${esc(r.id)}" title="Open Overall KPI for ${esc(r.name)}">
        <span class="name">${esc(r.name)}<small>${esc(targetLabel)}</small></span>
        <span class="bar" title="${g.mtd} MTD · ${g.remaining} to target · ${achText(g.pct)}">
          <i class="present" style="width:${greenW}%"></i>
          <i class="sla-late" style="width:${redW}%"></i>
        </span>
        <span class="meta">${g.mtd} MTD · ${g.remaining} to target · ${achText(g.pct)}</span>
      </button>`;
    }).join('') + `
      <div class="chart-row sla-row" style="cursor:default">
        <span class="name">Team<small>Target ${team.target || '—'}</small></span>
        <span class="bar" title="${team.mtd} MTD · ${team.remaining} to target">
          <i class="present" style="width:${(team.mtd / max) * 100}%"></i>
          <i class="sla-late" style="width:${(team.remaining / max) * 100}%"></i>
        </span>
        <span class="meta">${team.mtd} MTD · ${team.remaining} to target · ${achText(t.achPct)}</span>
      </div>`;
    host.querySelectorAll('[data-emp]').forEach((b) => {
      b.addEventListener('click', () => openEmployeeKpi(b.dataset.emp));
    });

    if (tbody) {
      tbody.innerHTML = rows.map((r) => {
        const g = empGap(r);
        return `<tr class="emp-table-row" data-emp="${esc(r.id)}" title="Open Overall KPI">
          <td><b>${esc(r.name)}</b></td>
          <td class="num">${g.target || '—'}</td>
          <td class="num">${g.mtd}</td>
          <td class="num">${g.remaining}</td>
          <td class="num">${achText(g.pct)}</td>
        </tr>`;
      }).join('') + `
        <tr class="emp-table-team">
          <td><b>Team</b></td>
          <td class="num">${team.target || '—'}</td>
          <td class="num">${team.mtd}</td>
          <td class="num">${team.remaining}</td>
          <td class="num">${achText(t.achPct)}</td>
        </tr>`;
      tbody.querySelectorAll('[data-emp]').forEach((el) => {
        el.addEventListener('click', () => openEmployeeKpi(el.dataset.emp));
      });
    }
  }

  function fmtPct(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${Math.round(Number(n) * 100) / 100}%`;
  }

  function ringSvg(pct, status) {
    const r = 54;
    const circ = 2 * Math.PI * r;
    const p = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
    const off = circ * (1 - p / 100);
    return `<svg viewBox="0 0 132 132" class="ekpi-svg ekpi-${status || 'empty'}" aria-hidden="true">
      <circle class="ekpi-track" cx="66" cy="66" r="${r}"></circle>
      <circle class="ekpi-fill" cx="66" cy="66" r="${r}"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"></circle>
    </svg>`;
  }

  function showEmpList() {
    kpiOpenId = '';
    kpiExpanded = false;
    kpiDetailKey = '';
    if ($('emp-kpi-view')) $('emp-kpi-view').hidden = true;
    if ($('emp-list-view')) $('emp-list-view').hidden = false;
  }

  async function openEmployeeKpi(id, { keepExpand = false } = {}) {
    kpiOpenId = id;
    if (!keepExpand) {
      kpiExpanded = false;
      kpiDetailKey = '';
    }
    if ($('emp-list-view')) $('emp-list-view').hidden = true;
    if ($('emp-kpi-view')) $('emp-kpi-view').hidden = false;
    await loadEmployeeKpi();
  }

  async function loadEmployeeKpi() {
    if (!kpiOpenId) return;
    const month = ($('ekpi-month') && $('ekpi-month').value) || empMonth || '';
    const qs = `?employeeId=${encodeURIComponent(kpiOpenId)}${month ? `&month=${encodeURIComponent(month)}` : ''}`;
    kpiData = await api(`/kpi/employee${qs}`);
    empMonth = kpiData.month || empMonth;
    renderEmployeeKpi();
  }

  function renderEmployeeKpi() {
    const d = kpiData;
    if (!d || !d.employee) return;
    const empSel = $('ekpi-emp');
    if (empSel) {
      const roster = d.roster || [];
      if (empSel.options.length !== roster.length) {
        empSel.innerHTML = roster.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
      }
      empSel.value = d.employee.id;
    }
    if ($('ekpi-month') && d.month) $('ekpi-month').value = d.month;
    const o = d.overall || {};
    $('ekpi-overall-val').textContent = o.available ? fmtPct(o.pct) : '—';
    $('ekpi-overall').className = `ekpi-overall ekpi-${o.status || 'empty'}${kpiExpanded ? ' is-open' : ''}`;
    $('ekpi-overall').setAttribute('aria-expanded', kpiExpanded ? 'true' : 'false');
    $('ekpi-ring').innerHTML = ringSvg(o.pct, o.status || 'empty');
    const monthNote = d.month === d.currentMonth ? `${d.month} · this month` : (d.month || '');
    $('ekpi-hint').textContent = `${d.employee.name} · ${monthNote} · ${d.counts.vinCount} VIN · ${d.counts.delivered} delivered · target ${d.counts.target || '—'}`;
    $('ekpi-overall-note').textContent = o.message
      || (o.notes && o.notes.length ? o.notes.join(' ') : (kpiExpanded ? 'Click again to collapse' : 'Click to see the four KPI components'));

    const keys = ['leadTime', 'achievement', 'contribution', 'psfu'];
    const br = $('ekpi-breakdown');
    br.hidden = !kpiExpanded;
    if (kpiExpanded) {
      br.innerHTML = keys.map((k) => {
        const x = d.kpis[k];
        if (!x) return '';
        return `<button type="button" class="ekpi-card ekpi-${x.status}${kpiDetailKey === k ? ' is-open' : ''}" data-kpi="${k}">
          <span class="ekpi-card-top">
            <b>${esc(x.short)}</b>
            <strong>${x.available ? fmtPct(x.kpiPct) : 'No data'}</strong>
          </span>
          <span class="ekpi-bar"><i style="width:${x.available ? Math.min(x.kpiPct || 0, 100) : 0}%"></i></span>
          <span class="ekpi-card-meta">${esc(x.actualLabel)} · weight ${x.weight}%</span>
        </button>`;
      }).join('');
      br.querySelectorAll('[data-kpi]').forEach((b) => {
        b.addEventListener('click', () => {
          kpiDetailKey = kpiDetailKey === b.dataset.kpi ? '' : b.dataset.kpi;
          renderEmployeeKpi();
        });
      });
    }
    const host = $('ekpi-detail');
    const x = kpiDetailKey && d.kpis[kpiDetailKey];
    if (!x || !kpiExpanded) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    const scoreLine = x.score == null ? '—' : `${x.score} / ${x.maxScore}`;
    host.innerHTML = `
      <h3>${esc(x.name)}</h3>
      ${x.message ? `<p class="ekpi-warn">${esc(x.message)}</p>` : ''}
      <dl class="ekpi-dl">
        <div><dt>Actual</dt><dd>${esc(x.actualLabel)}</dd></div>
        <div><dt>Rule</dt><dd>${esc(x.targetRule || '—')}</dd></div>
        <div><dt>Score</dt><dd>${esc(scoreLine)}</dd></div>
        <div><dt>KPI</dt><dd>${x.available ? fmtPct(x.kpiPct) : 'No data'}</dd></div>
        <div><dt>Weight</dt><dd>${x.weight}%</dd></div>
        <div><dt>Weighted contribution</dt><dd>${x.contribution == null ? '—' : fmtPct(x.contribution)}</dd></div>
      </dl>`;
  }

  function readWeightForm() {
    const weights = {};
    const enabled = {};
    document.querySelectorAll('.wgt-input').forEach((el) => { weights[el.dataset.k] = Number(el.value) || 0; });
    document.querySelectorAll('.wgt-on').forEach((el) => { enabled[el.dataset.k] = el.checked; });
    return { weights, enabled };
  }

  function updateWeightTotal() {
    const { weights, enabled } = readWeightForm();
    const total = Object.keys(weights).reduce((s, k) => s + (enabled[k] ? Number(weights[k]) || 0 : 0), 0);
    if ($('weight-total')) $('weight-total').textContent = `${total}%`;
    if ($('weight-error')) {
      $('weight-error').textContent = total === 100 ? '' : `Total must be 100% (now ${total}%).`;
      $('weight-error').classList.toggle('ekpi-err', total !== 100);
    }
  }

  function renderWeightForm(data) {
    const keys = data.keys || ['leadTime', 'achievement', 'contribution', 'psfu'];
    $('weight-body').innerHTML = keys.map((k) => `
      <tr>
        <td>${esc((data.meta && data.meta[k] && data.meta[k].name) || k)}</td>
        <td><input type="number" min="0" max="100" step="1" class="wgt-input" data-k="${k}" value="${data.weights[k]}" /></td>
        <td><input type="checkbox" class="wgt-on" data-k="${k}" ${data.enabled[k] ? 'checked' : ''} /></td>
      </tr>`).join('');
    document.querySelectorAll('.wgt-input').forEach((el) => el.addEventListener('input', updateWeightTotal));
    document.querySelectorAll('.wgt-on').forEach((el) => el.addEventListener('change', updateWeightTotal));
    updateWeightTotal();
  }

  async function loadWeights() {
    renderWeightForm(await api('/kpi/weights'));
  }

  async function saveWeights() {
    $('weight-error').textContent = '';
    try {
      await api('/kpi/weights', { method: 'PUT', json: readWeightForm() });
      toast('KPI weights saved');
      updateWeightTotal();
      if (kpiOpenId) await loadEmployeeKpi();
    } catch (err) {
      $('weight-error').textContent = err.message || 'Could not save';
      $('weight-error').classList.add('ekpi-err');
    }
  }

  function printHaystack(p) {
    const vins = (p.vins || []).map((v) => [v.vin, v.product, v.customer].join(' ')).join(' ');
    const snap = p.snapshot || {};
    return [
      p.invoiceNumber, p.company, p.city, p.printedBy, p.kind, p.at,
      snap.customer_name, snap.company_rep, snap.branch_to, vins,
    ].join(' ').toLowerCase();
  }

  function filteredPrints() {
    const q = pdfQuery.trim().toLowerCase();
    const rows = dash && dash.prints ? dash.prints : [];
    if (!q) return rows;
    return rows.filter((p) => printHaystack(p).includes(q));
  }

  function renderPrints() {
    const host = $('pdf-list');
    if (!host) return;
    const all = (dash && dash.prints) || [];
    const rows = filteredPrints();
    if (!all.length) {
      host.innerHTML = '<p class="chart-empty">No delivery-note copies yet. They appear here after coordinator print.</p>';
      return;
    }
    if (!rows.length) {
      host.innerHTML = `<p class="chart-empty">No copies match “${esc(pdfQuery)}”.</p>`;
      return;
    }
    host.innerHTML = rows.map((p) => {
      const vins = (p.vins || []).map((v) => v.vin || v).join(', ');
      const kind = p.kind === 'warehouse' ? 'Warehouse' : 'Delivery note';
      return `<article class="pdf-item" data-print-id="${esc(p.id)}">
        <b>${esc(kind)}${p.invoiceNumber ? ` · #${esc(p.invoiceNumber)}` : ''}</b>
        <span>${esc(p.company || '—')} · ${esc(p.city || '—')}</span><br />
        <span class="detail-vin">${esc(vins || '—')}</span><br />
        <span>${esc(p.printedBy || '')} · ${esc(fmtWhen(p.at))}</span>
        <div class="pdf-item-actions">
          <button type="button" class="btn" data-extract="${esc(p.id)}">Extract PDF</button>
        </div>
      </article>`;
    }).join('');
    host.querySelectorAll('[data-extract]').forEach((b) => {
      b.addEventListener('click', () => extractPrints([b.dataset.extract]));
    });
  }

  function splitDateParts(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: m[1], m: m[2], d: m[3] } : { y: '', m: '', d: '' };
  }

  function overlayPositionStyle(tag, x, y, w, h) {
    let left = `${x * 100}%`;
    if (/^wh_chassis/.test(tag)) left = `${x * 100}%`;
    else if (/_chassis$/.test(tag)) left = `calc(${x * 100}% + 15.9mm)`;
    if (/_model$/.test(tag)) left = `calc(${x * 100}% + 4mm)`;
    if (/_plate$/.test(tag)) left = `calc(${x * 100}% + 10.6mm)`;
    return `left:${left};top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
  }

  function snapshotFromPrint(p) {
    if (p.snapshot && typeof p.snapshot === 'object') return p.snapshot;
    const day = String(p.at || '').slice(0, 10);
    const cars = (p.vins || []).map((v) => ({
      model: v.product || '',
      chassis: v.vin || v,
      plate: '',
      remarks: '',
    }));
    return {
      doc_date: day,
      invoice_number: p.invoiceNumber || '',
      customer_name: (p.vins && p.vins[0] && p.vins[0].customer) || '',
      company_rep: p.company || '',
      transfer_date: day,
      corresponding_date: day,
      car_count: String(cars.length || ''),
      branch_to: p.city || '',
      cars,
      warehouse: {},
    };
  }

  function overlayData(p) {
    const body = snapshotFromPrint(p);
    if (p.kind === 'warehouse') {
      const vins = (body.cars || []).map((c) => String(c.chassis || '').trim()).filter(Boolean);
      const wh = body.warehouse || {};
      return {
        wh_owner_name: wh.owner_name || body.customer_name || '',
        wh_user_name: wh.user_name || '',
        wh_user_phone: wh.user_phone || '',
        wh_user_id: wh.user_id || '',
        wh_print_date: (wh.print_date || body.doc_date || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1'),
        wh_print_time: wh.print_time || '',
        wh_chassis: vins[0] || '',
        wh_chassis_2: vins[1] || '',
        wh_chassis_3: vins[2] || '',
        wh_chassis_4: vins[3] || '',
        wh_chassis_5: vins[4] || '',
      };
    }
    const doc = splitDateParts(body.doc_date);
    const transfer = splitDateParts(body.transfer_date || body.doc_date);
    const corr = splitDateParts(body.corresponding_date || body.doc_date);
    const data = {
      date_d: doc.d, date_m: doc.m, date_y: doc.y,
      invoice_number: body.invoice_number || p.invoiceNumber || '',
      dep_hour: body.dep_hour || '',
      dep_minute: body.dep_minute || '',
      customer_name: body.customer_name || '',
      company_rep: body.company_rep || p.company || '',
      transfer_d: transfer.d, transfer_m: transfer.m, transfer_y: transfer.y,
      corresponding_d: corr.d, corresponding_m: corr.m, corresponding_y: corr.y,
      day_name: body.day_name || '',
      trailer_number: body.trailer_number || '',
      car_count: body.car_count || String((p.vins || []).length || ''),
      branch_to: body.branch_to || p.city || '',
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

  function buildPrintSheet(p) {
    const warehouse = p.kind === 'warehouse';
    const layout = warehouse
      ? (typeof CHECK_NOTE_FIELDS !== 'undefined' ? CHECK_NOTE_FIELDS : [])
      : (typeof MUTHAKARA_FIELDS !== 'undefined' ? MUTHAKARA_FIELDS : []);
    const cover = !warehouse && typeof INVOICE_NUMBER_COVER !== 'undefined' ? INVOICE_NUMBER_COVER : null;
    const coverHtml = cover
      ? `<div class="overlay-cover" style="left:${cover[0] * 100}%;top:${cover[1] * 100}%;width:${cover[2] * 100}%;height:${cover[3] * 100}%"></div>`
      : '';
    const data = overlayData(p);
    const fields = layout.map(([tag, x, y, w, h, align]) => {
      const invoiceCls = tag === 'invoice_number' ? ' overlay-field--invoice' : '';
      const chassisCls = /chassis/.test(tag) ? ' overlay-field--chassis' : '';
      return `<div class="overlay-field align-${align || 'end'}${invoiceCls}${chassisCls}" style="${overlayPositionStyle(tag, x, y, w, h)}">${esc(data[tag] || '')}</div>`;
    }).join('');
    const src = warehouse
      ? '../images/delivery-check-note-form.png'
      : '../images/muthakara-tarhil-form.png';
    const fallback = warehouse
      ? ''
      : '../toyota-internal-lease-calculator-main/images/muthakara-tarhil-form.png';
    return `<div class="print-sheet print-copy"><img src="${src}" alt=""${fallback ? ` onerror="this.onerror=null;this.src='${fallback}'"` : ''} />
      <div class="overlay-layer">${coverHtml}${fields}</div></div>`;
  }

  function extractPrints(ids) {
    const set = new Set(ids || []);
    const rows = ((dash && dash.prints) || []).filter((p) => set.has(p.id));
    if (!rows.length) {
      alert('No PDF copies to extract.');
      return;
    }
    const existing = document.getElementById('printCopies');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.id = 'printCopies';
    box.innerHTML = rows.map(buildPrintSheet).join('');
    document.body.insertBefore(box, document.body.firstChild);
    const imgs = [...box.querySelectorAll('img')];
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((done) => {
      img.onload = () => done();
      img.onerror = () => done();
    })))).then(() => {
      const finish = () => {
        window.removeEventListener('afterprint', finish);
        if (box.parentNode) box.remove();
      };
      window.addEventListener('afterprint', finish);
      window.print();
    });
  }

  function openDrawer(html, { wide = false } = {}) {
    const drawer = $('detail-drawer');
    drawer.classList.toggle('vsnd-sheet', !!wide);
    drawer.innerHTML = html;
    $('detail-back').classList.add('open');
    const close = $('detail-close');
    if (close) close.onclick = closeDrawer;
  }

  function closeDrawer() {
    $('detail-back').classList.remove('open');
    const drawer = $('detail-drawer');
    if (drawer) drawer.classList.remove('vsnd-sheet');
  }

  function openCompany(name) {
    const c = (dash.companies || []).find((x) => x.company === name);
    if (!c) return;
    const people = (c.people || []).slice().sort((a, b) => (Date.parse(b.arrivedAt) || 0) - (Date.parse(a.arrivedAt) || 0));
    const freePeople = people.filter((p) => p.status !== 'left');
    const leftPeople = people.filter((p) => p.status === 'left');
    const freeCount = c.free != null ? c.free : c.present;
    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>${esc(c.company)}</h2>
          <p class="sub">${esc(freeCount)} free · ${esc(c.left)} left · ${esc(c.notes)} VIN on notes · from attendance + coordinator print</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="inv-detail-summary">
        <div class="inv-detail-card">
          <h3>Free <span class="hint">· waiting · no VIN yet</span></h3>
          <div class="inv-detail-nums">
            <span><em>Free</em><b class="stay">${esc(freeCount)}</b></span>
          </div>
          <div class="table-wrap vsnd-sheet-wrap" style="max-height:28vh">
            <table class="data vsnd-live-table">
              <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Arrived</th><th>Stay</th></tr></thead>
              <tbody>${freePeople.map((p, i) => `
                <tr>
                  <td>${i + 1}</td>
              <td><b>${esc(p.name)}</b></td>
              <td>${esc(p.phone || '—')}</td>
              <td>${esc(fmtWhen(p.arrivedAt))}</td>
                  <td class="stay">${esc(stayText(p))}</td>
                </tr>`).join('') || '<tr><td colspan="5">No free drivers for this company</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="inv-detail-card">
          <h3>Left <span class="hint">· got VIN · departed</span></h3>
          <div class="inv-detail-nums">
            <span><em>Left</em><b class="gone">${esc(c.left)}</b></span>
            <span><em>VINs</em><b>${esc(leftPeople.reduce((n, p) => n + ((p.vins && p.vins.length) || 0), 0))}</b></span>
          </div>
          <div class="table-wrap vsnd-sheet-wrap" style="max-height:32vh">
            <table class="data vsnd-live-table">
              <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Left at</th><th>VIN(s)</th><th>City</th><th>By</th></tr></thead>
              <tbody>${leftPeople.map((p, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td><b>${esc(p.name)}</b></td>
                  <td>${esc(p.phone || '—')}</td>
                  <td class="gone">${esc(fmtWhen(p.leftAt))}</td>
              <td class="detail-vin">${esc((p.vins || []).join(', ') || '—')}</td>
              <td>${esc(p.city || '—')}</td>
                  <td>${esc(p.usedBy || '—')}</td>
                </tr>`).join('') || '<tr><td colspan="7">No drivers left yet for this company</td></tr>'}
              </tbody>
        </table>
      </div>
        </div>
      </div>`, { wide: true });
  }

  function renderFleetFreeLeft() {
    const host = $('vsnd-top5-body');
    if (!host) return;
    if (!dash) {
      host.innerHTML = '<p class="chart-empty" style="margin:0;font-size:.75rem">Loading attendance…</p>';
      return;
    }
    const freeTotal = dash.free != null ? dash.free : (dash.present || 0);
    const leftTotal = dash.left || 0;
    const rows = (dash.companies || [])
      .filter((c) => (c.free != null ? c.free : c.present) || c.left)
      .slice()
      .sort((a, b) => {
        const af = a.free != null ? a.free : a.present;
        const bf = b.free != null ? b.free : b.present;
        return (bf - af) || (b.left - a.left) || String(a.company).localeCompare(String(b.company), 'ar');
      });
    const max = Math.max(1, ...rows.map((c) => Math.max(c.free != null ? c.free : c.present, c.left || 0)));
    host.innerHTML = `
      <div class="inv-totals fleet-totals">
        <div class="inv-total in"><span>Free</span><strong>${esc(freeTotal)}</strong></div>
        <div class="inv-total out"><span>Left</span><strong>${esc(leftTotal)}</strong></div>
        <button type="button" class="btn inv-more" id="fleet-more-details">More details</button>
      </div>
      <div class="vsnd-hbars fleet-bars">
        ${rows.map((c) => {
          const free = c.free != null ? c.free : c.present;
          const left = c.left || 0;
          return `<button type="button" class="vsnd-hbar fleet-row" data-fleet-co="${esc(c.company)}" title="${esc(c.company)} · ${free} free · ${left} left">
            <span class="vsnd-hbar-lbl">${esc(c.company)}</span>
            <span class="vsnd-hbar-track fleet-track">
              <i class="fleet-free" style="width:${(free / max) * 100}%"></i>
              <i class="fleet-left" style="width:${(left / max) * 100}%"></i>
            </span>
            <b><span class="stay">${esc(free)}</span><small>/</small><span class="gone">${esc(left)}</span></b>
          </button>`;
        }).join('') || '<p class="chart-empty" style="margin:0;font-size:.75rem">No attendance yet</p>'}
      </div>
      <div class="vsnd-mini-legend"><span><i class="del"></i> Free</span><span><i class="vs"></i> Left</span></div>`;
    const more = $('fleet-more-details');
    if (more) more.onclick = () => openFleetOverview();
    host.querySelectorAll('[data-fleet-co]').forEach((btn) => {
      btn.addEventListener('click', () => openCompany(btn.dataset.fleetCo));
    });
  }

  function openFleetOverview() {
    if (!dash) return;
    const freeTotal = dash.free != null ? dash.free : (dash.present || 0);
    const leftTotal = dash.left || 0;
    const rows = (dash.companies || []).filter((c) => (c.free != null ? c.free : c.present) || c.left);
    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>Free / Left · all companies</h2>
          <p class="sub">${esc(freeTotal)} free · ${esc(leftTotal)} left · live from attendance.html + coordinator print</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="inv-detail-summary">
        ${rows.map((c) => {
          const free = c.free != null ? c.free : c.present;
          const people = c.people || [];
          const freePeople = people.filter((p) => p.status !== 'left');
          const leftPeople = people.filter((p) => p.status === 'left');
          return `
          <div class="inv-detail-card">
            <h3>${esc(c.company)}</h3>
            <div class="inv-detail-nums">
              <span><em>Free</em><b class="stay">${esc(free)}</b></span>
              <span><em>Left</em><b class="gone">${esc(c.left || 0)}</b></span>
            </div>
            <p class="hint" style="margin:0 0 6px">Free</p>
            <div class="table-wrap" style="max-height:18vh;margin-bottom:10px">
              <table class="data vsnd-live-table">
                <thead><tr><th>Name</th><th>Arrived</th><th>Stay</th></tr></thead>
                <tbody>${freePeople.map((p) => `
                  <tr><td><b>${esc(p.name)}</b></td><td>${esc(fmtWhen(p.arrivedAt))}</td><td class="stay">${esc(stayText(p))}</td></tr>
                `).join('') || '<tr><td colspan="3">—</td></tr>'}</tbody>
              </table>
            </div>
            <p class="hint" style="margin:0 0 6px">Left · VIN · time</p>
            <div class="table-wrap" style="max-height:22vh">
              <table class="data vsnd-live-table">
                <thead><tr><th>Name</th><th>Left at</th><th>VIN(s)</th><th>City</th></tr></thead>
                <tbody>${leftPeople.map((p) => `
                  <tr>
                    <td><b>${esc(p.name)}</b></td>
                    <td class="gone">${esc(fmtWhen(p.leftAt))}</td>
                    <td class="detail-vin">${esc((p.vins || []).join(', ') || '—')}</td>
                    <td>${esc(p.city || '—')}</td>
                  </tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}
                </tbody>
        </table>
            </div>
          </div>`;
        }).join('') || '<p class="chart-empty">No attendance companies</p>'}
      </div>`, { wide: true });
  }

  function openCompanyCities(name) {
    const c = (dash.companyCities || []).find((x) => x.company === name);
    if (!c) return;
    openDrawer(`
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(c.company)}</h2>
          <p class="sub">${c.total} car${c.total === 1 ? '' : 's'} · click a city row is not needed — all details below</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      ${(c.cities || []).map((city, i) => `
        <div class="card" style="margin-bottom:10px;box-shadow:none">
          <h2 style="display:flex;justify-content:space-between">
            <span>${esc(city.city)}</span>
            <span style="color:${CITY_COLORS[i % CITY_COLORS.length]}">${city.count}</span>
          </h2>
          <div class="table-wrap" style="max-height:200px">
            <table class="data">
              <thead><tr><th>VIN</th><th>Product</th><th>Printed</th><th>By</th></tr></thead>
              <tbody>${(city.vins || []).map((v) => `
                <tr>
                  <td class="detail-vin">${esc(v.vin)}</td>
                  <td>${esc(v.product || '—')}</td>
                  <td>${esc(fmtWhen(v.printedAt))}</td>
                  <td>${esc(v.printedBy || '—')}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`).join('')}`);
  }

  function resultClass(result) {
    if (result === 'LATE') return 'gone';
    if (result === 'ON TIME' || result === 'ON TRACK') return 'stay';
    return '';
  }

  function shiftMonth(ym, delta) {
    const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return ym;
    const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
    return dt.toISOString().slice(0, 7);
  }

  function syncMonthInputs() {
    ['emp-month', 'sla-month', 'ekpi-month'].forEach((id) => {
      const el = $(id);
      if (el && empMonth && el.value !== empMonth) el.value = empMonth;
    });
  }

  function setDashMonth(ym) {
    empMonth = ym || '';
    syncMonthInputs();
    return loadDash();
  }

  function donutSvg(segments, centerLabel, centerSub, { clickable = false, size = 84 } = {}) {
    const total = segments.reduce((s, x) => s + (Number(x.count) || 0), 0) || 1;
    const box = Number(size) || 84;
    const cx = box / 2;
    const r = Math.round(box * 0.405);
    const inner = Math.round(box * 0.286);
    const stroke = Math.max(8, Math.round(box * 0.12));
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segments.filter((x) => x.count > 0).map((x) => {
      const len = (x.count / total) * c;
      const key = esc(x.status || x.name || x.label || '');
      const arc = `<circle class="${clickable ? 'vsnd-arc-hit' : ''}" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${esc(x.color)}" stroke-width="${stroke}"
        stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cx})" ${clickable ? `data-status="${key}" role="button" tabindex="0"` : ''}></circle>`;
      offset += len;
      return arc;
    }).join('');
    return `<div class="vsnd-donut${clickable ? ' is-clickable' : ''}" style="width:${box}px;height:${box}px">
      <svg viewBox="0 0 ${box} ${box}" aria-hidden="true">${arcs}
        <circle cx="${cx}" cy="${cx}" r="${inner}" fill="#fff"></circle>
      </svg>
      <button type="button" class="vsnd-donut-center${clickable ? ' is-hit' : ''}" ${clickable ? 'data-status=""' : 'disabled'} title="All VSND">
        <strong>${esc(centerLabel)}</strong><span>${esc(centerSub || '')}</span>
      </button>
    </div>`;
  }

  function legendList(items, { clickable = false, wide = false } = {}) {
    return `<ul class="vsnd-legend-list${clickable ? ' is-clickable' : ''}${wide ? ' is-wide' : ''}">${items.map((x) => `
      <li ${clickable ? `class="vsnd-legend-hit" data-status="${esc(x.status || '')}" role="button" tabindex="0"` : ''}>
        <i style="background:${esc(x.color)}"></i>
        <span>${esc(x.label || x.name)}</span>
        <b>${esc(x.count)}</b>
        <em>${esc(x.pct != null ? `${x.pct}%` : '')}</em>
      </li>`).join('')}</ul>`;
  }

  function openWideVsndStatusChart() {
    const cal = slaDash && slaDash.calendar;
    const a = (cal && cal.analytics) || {};
    const byStatus = a.byStatusVsnd || [];
    const total = a.vsndTotal || 0;
    const monthNote = monthLabel(cal && cal.month) || (cal && cal.month) || '';
    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>VSND by Status</h2>
          <p class="sub">${esc(monthNote)} · ${total} open VSND · click a slice or row for Live Sheet VINs</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="vsnd-wide-chart" id="vsnd-wide-status-chart">
        ${donutSvg(byStatus, String(total), 'VSND', { clickable: true, size: 220 })}
        <div class="vsnd-wide-legend">
          ${legendList(byStatus, { clickable: true, wide: true })}
          <p class="hint" style="margin-top:10px">Tip: click the centre for all open VSND VINs.</p>
        </div>
      </div>`, { wide: true });
    wireVsndStatusHits($('vsnd-wide-status-chart'));
  }

  function wireVsndStatusHits(root) {
    if (!root) return;
    const open = (status) => openVsndStatusDetail(status || '').catch((err) => alert(err.message));
    root.querySelectorAll('[data-status]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        open(el.dataset.status);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(el.dataset.status);
        }
      });
    });
  }

  function isOpenVsndRow(v, month) {
    const p = String((v.raw && v.raw.proformaDate) || '').slice(0, 10);
    const inv = String((v.raw && v.raw.invoiceDate) || '').trim();
    return !!(p && p.slice(0, 7) === month && !inv);
  }

  function renderInventoryPanel() {
    const host = $('vsnd-last7-body');
    if (!host) return;
    const inv = inventoryDash;
    if (!inv) {
      host.innerHTML = '<p class="chart-empty" style="margin:0;font-size:.75rem">No inventory data</p>';
      return;
    }
    const users = inv.users || [];
    const stockIn = inv.stockIn != null ? inv.stockIn : users.reduce((s, u) => s + (u.stockIn || 0), 0);
    const stockOut = inv.stockOut != null ? inv.stockOut : users.reduce((s, u) => s + (u.stockOut || 0), 0);
    const max = Math.max(1, ...users.map((u) => Math.max(u.stockIn || 0, u.stockOut || 0)), stockIn, stockOut);
    host.innerHTML = `
      <div class="inv-compact-wrap">
        <div class="inv-totals inv-totals-compact">
          <div class="inv-total in"><span>Stock In</span><strong>${esc(stockIn)}</strong></div>
          <div class="inv-total out"><span>Stock Out</span><strong>${esc(stockOut)}</strong></div>
        </div>
        <div class="inv-hbar-list">
          ${users.map((u) => {
            const inW = ((u.stockIn || 0) / max) * 100;
            const outW = ((u.stockOut || 0) / max) * 100;
            return `<div class="inv-hbar-row" title="${esc(u.name)} · ${u.stockIn || 0} in · ${u.stockOut || 0} out">
              <span class="inv-hbar-name">${esc(u.name)}</span>
              <span class="inv-hbar-tracks">
                <span class="inv-hbar-track in"><i style="width:${inW}%"></i></span>
                <span class="inv-hbar-track out"><i style="width:${outW}%"></i></span>
              </span>
              <span class="inv-hbar-nums"><b class="in">${esc(u.stockIn || 0)}</b>/<b class="out">${esc(u.stockOut || 0)}</b></span>
            </div>`;
          }).join('') || '<p class="chart-empty" style="margin:0;font-size:.75rem">No inventory users</p>'}
        </div>
        <div class="vsnd-mini-legend"><span><i class="del"></i> In</span><span><i class="vs"></i> Out</span></div>
      </div>`;
    const wide = $('inv-wide-btn');
    if (wide) wide.onclick = () => openInventoryDetail();
  }

  function openInventoryDetail() {
    const inv = inventoryDash;
    if (!inv) return;
    const { na } = window.DTX;
    const users = inv.users || [];
    const stockIn = inv.stockIn != null ? inv.stockIn : users.reduce((s, u) => s + (u.stockIn || 0), 0);
    const stockOut = inv.stockOut != null ? inv.stockOut : users.reduce((s, u) => s + (u.stockOut || 0), 0);
    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>Inventory · Stock In / Out</h2>
          <p class="sub">${esc(stockIn)} in · ${esc(stockOut)} out · ${esc(inv.unclaimed || 0)} unclaimed · ${esc(inv.total || 0)} open VINs</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="inv-detail-summary">
        ${users.map((u) => `
          <div class="inv-detail-card">
            <h3>${esc(u.name)}</h3>
            <div class="inv-detail-nums">
              <span><em>In</em><b>${esc(u.stockIn || 0)}</b></span>
              <span><em>Out</em><b>${esc(u.stockOut || 0)}</b></span>
              <span><em>Claims</em><b>${esc(u.claims || 0)}</b></span>
            </div>
            <div class="table-wrap vsnd-sheet-wrap" style="max-height:28vh">
              <table class="data vsnd-live-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>VIN</th>
                    <th>Product</th>
                    <th>Sales Type</th>
                    <th>Customer</th>
                    <th>Proforma</th>
                    <th>Claimed</th>
                  </tr>
                </thead>
                <tbody>${(u.stock || []).map((r, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><b>${esc(r.vin)}</b></td>
                    <td>${esc(na(r.product))}</td>
                    <td>${esc(na(r.salesType))}</td>
                    <td>${esc(na(r.customer))}</td>
                    <td>${esc(na(r.proformaDate))}</td>
                    <td>${esc(fmtWhen(r.claimedAt))}</td>
                  </tr>`).join('') || '<tr><td colspan="7">No VINs currently in stock</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>`).join('') || '<p class="chart-empty">No inventory users</p>'}
      </div>`, { wide: true });
  }

  async function openVsndStatusDetail(status) {
    const cal = slaDash && slaDash.calendar;
    const month = (cal && cal.month) || empMonth || '';
    const qs = new URLSearchParams();
    if (month) qs.set('month', month);
    const statusFilter = status === '(blank)' ? '' : status;
    if (statusFilter) qs.set('status', statusFilter);
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(status || 'All VSND')}</h2>
          <p class="sub">Loading Live Sheet…</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>`, { wide: true });

    const data = await api(`/live-sheet?${qs.toString()}`);
    let rows = (data.rows || []).filter((v) => isOpenVsndRow(v, month));
    if (status === '(blank)') {
      rows = rows.filter((v) => !String((v.ops && v.ops.opsStatus) || '').trim());
    } else if (statusFilter) {
      rows = rows.filter((v) => String((v.ops && v.ops.opsStatus) || '') === statusFilter);
    }
    const label = status || 'All statuses';
    const monthNote = monthLabel(month) || month;
    const { statusBadge, na } = window.DTX;

    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>${esc(label)}</h2>
          <p class="sub">${esc(monthNote)} · ${rows.length} open VSND VIN(s) · Col P · no Col V · Live Sheet details</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap vsnd-sheet-wrap">
        <table class="data vsnd-live-table">
          <thead>
            <tr>
              <th>#</th>
              <th>VIN</th>
              <th>Proforma</th>
              <th>Order</th>
              <th>Product</th>
              <th>Sales Type</th>
              <th>Customer</th>
              <th>Owner</th>
              <th>Phone</th>
              <th>S/A</th>
              <th>Employee</th>
              <th>Status</th>
              <th>مدينة الترحيل</th>
              <th>الناقل</th>
              <th>GT Loc</th>
              <th>Veh Loc</th>
            </tr>
          </thead>
          <tbody>${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><button type="button" class="vin-btn" data-vin="${esc(r.vin)}">${esc(r.vin)}</button></td>
              <td>${esc(na(r.raw.proformaDate))}</td>
              <td>${esc(na(r.raw.salesOrder))}</td>
              <td>${esc(na(r.raw.product))}</td>
              <td>${esc(na(r.raw.salesType))}</td>
              <td>${esc(na(r.raw.userName))}</td>
              <td>${esc(na(r.raw.invoiceOwner))}</td>
              <td>${r.raw.phone ? `<a href="tel:${esc(r.raw.phone)}">${esc(r.raw.phone)}</a>` : '—'}</td>
              <td>${esc(na(r.raw.salesAdvisor))}</td>
              <td><b>${esc(na(r.ops.assignedEmployeeName))}</b></td>
              <td>${statusBadge(r.ops.opsStatus)}</td>
              <td>${esc(na(r.ops.transferCity))}</td>
              <td>${esc(na(r.ops.carrier))}</td>
              <td>${esc(na(r.raw.gtLocation))}</td>
              <td>${esc(na(r.raw.vehicleLocation))}</td>
            </tr>`).join('') || '<tr><td colspan="16">No open VSND VINs for this status.</td></tr>'}
          </tbody>
        </table>
      </div>`, { wide: true });

    $('detail-drawer').querySelectorAll('.vin-btn[data-vin]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.DTXLive && DTXLive.openDrawer) {
          DTXLive.openDrawer(btn.dataset.vin, {
            mode: 'admin',
            onSaved: () => openVsndStatusDetail(status).catch(() => {}),
          });
        }
      });
    });
  }

  function hBars(items, color) {
    const max = Math.max(1, ...items.map((x) => Number(x.count) || 0));
    return `<div class="vsnd-hbars">${items.map((x) => `
      <div class="vsnd-hbar">
        <span class="vsnd-hbar-lbl">${esc(x.label || x.name)}</span>
        <span class="vsnd-hbar-track"><i style="width:${((x.count || 0) / max) * 100}%;background:${esc(x.color || color)}"></i></span>
        <b>${esc(x.count || 0)}</b>
      </div>`).join('') || '<p class="chart-empty">No data</p>'}</div>`;
  }

  function renderVsndCharts(cal) {
    const a = (cal && cal.analytics) || {};
    const deliveredEl = $('vsnd-kpi-delivered');
    const vsndEl = $('vsnd-kpi-vsnd');
    if (deliveredEl) {
      deliveredEl.innerHTML = `
        <span class="vsnd-pill-ico" aria-hidden="true">🚚</span>
        <div>
          <span class="vsnd-pill-lbl">Delivered · تم التسليم</span>
          <strong>${esc(cal.delivered || 0)}</strong>
          <em>Current Month · Col V</em>
        </div>`;
    }
    if (vsndEl) {
      vsndEl.innerHTML = `
        <span class="vsnd-pill-ico" aria-hidden="true">⏳</span>
        <div>
          <span class="vsnd-pill-lbl">Not Delivered (VSND)</span>
          <strong>${esc(cal.notDelivered || 0)}</strong>
          <em>Current Month · Col P · no V</em>
        </div>`;
      vsndEl.classList.add('is-hit');
      vsndEl.title = 'Open all open VSND VINs';
      vsndEl.onclick = () => openVsndStatusDetail('').catch((err) => alert(err.message));
    }

    const byStatus = a.byStatusVsnd || [];
    if ($('vsnd-by-status-body')) {
      $('vsnd-by-status-body').innerHTML = `
        ${donutSvg(byStatus, String(a.vsndTotal || 0), 'VSND', { clickable: true, size: 72 })}
        ${legendList(byStatus, { clickable: true })}
        <button type="button" class="vsnd-expand-hit" id="vsnd-status-expand" title="Open wide chart">⤢</button>`;
      wireVsndStatusHits($('vsnd-by-status-body'));
      const expand = $('vsnd-status-expand');
      if (expand) expand.addEventListener('click', (e) => {
        e.stopPropagation();
        openWideVsndStatusChart();
      });
    }
    const wideBtn = $('vsnd-status-wide');
    if (wideBtn) {
      wideBtn.onclick = (e) => {
        e.stopPropagation();
        openWideVsndStatusChart();
      };
    }

    renderInventoryPanel();

    renderEntryAccuracy(a.entryAccuracy);

    if ($('vsnd-top5-body')) renderFleetFreeLeft();
    if ($('vsnd-aging-dist-body')) renderDaysToSalesPanel();
    if ($('vsnd-emp-body')) renderDisplayCounter();
    if ($('vsnd-region-body')) renderCarrierPanel();
  }

  function renderDaysToSalesPanel() {
    const host = $('vsnd-aging-dist-body');
    if (!host) return;
    const more = $('vsnd-dts-more');
    if (more) {
      more.onclick = (e) => {
        e.stopPropagation();
        openDaysToSalesDetails({});
      };
    }
    const perf = slaDash && slaDash.companyPerformance;
    const dist = (perf && perf.daysDist) || [];
    const totals = (perf && perf.totals) || {};
    const completed = totals.completedVins || 0;
    if (!dist.length && !(totals.totalUniqueVins > 0)) {
      host.innerHTML = '<p class="chart-empty" style="margin:0;font-size:.75rem">No coordinator assignments in this month yet.</p>';
      host.onclick = null;
      host.style.cursor = '';
      return;
    }
    host.innerHTML = `${donutSvg(dist, String(completed), 'Sold', { size: 96 })}
      <ul class="vsnd-legend-list is-clickable is-scroll">${dist.map((x) => `
        <li class="vsnd-legend-hit" data-dts-bucket="${esc(x.label)}" role="button" tabindex="0" title="Open ${esc(x.label)} VINs">
          <i style="background:${esc(x.color)}"></i>
          <span>${esc(x.label)}</span>
          <b>${esc(x.count)}</b>
          <em>${esc(x.pct != null ? `${x.pct}%` : '')}</em>
        </li>`).join('')}</ul>`;
    host.style.cursor = '';
    host.onclick = null;
    host.querySelectorAll('[data-dts-bucket]').forEach((el) => {
      const open = () => openDaysToSalesDetails({ bucket: el.dataset.dtsBucket || '' });
      el.addEventListener('click', (e) => { e.stopPropagation(); open(); });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  function getDaysToSalesData() {
    const perf = slaDash && slaDash.companyPerformance;
    const rows = (perf && perf.debug) || [];
    return rows.map((r) => ({
      vin: r.vin,
      company: r.company,
      assignmentDate: r.assignmentDate,
      salesDate: r.salesDate || null,
      daysToSales: r.daysToSales == null ? null : r.daysToSales,
      bucket: r.bucket || null,
      status: r.status === 'SOLD' || r.status === 'COMPLETED' ? 'SOLD' : (r.status === 'DATA_QUALITY' ? 'DATA_QUALITY' : 'PENDING'),
    }));
  }

  function fmtDtsDate(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return esc(iso);
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    try {
      return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
      return esc(iso);
    }
  }

  function summarizeDaysToSales(rows) {
    const sold = rows.filter((r) => r.status === 'SOLD' && r.daysToSales != null);
    const avg = sold.length
      ? Math.round((sold.reduce((s, r) => s + r.daysToSales, 0) / sold.length) * 10) / 10
      : null;
    const fastest = sold.length ? Math.min(...sold.map((r) => r.daysToSales)) : null;
    const eightPlus = sold.filter((r) => r.daysToSales >= 8).length;
    return {
      totalSold: sold.length,
      averageDays: avg,
      fastestSale: fastest,
      eightPlus,
    };
  }

  let dtsDetailState = { company: '', bucket: '', status: 'ALL', q: '' };

  async function ensureDaysToSalesDebug() {
    const perf = slaDash && slaDash.companyPerformance;
    if (perf && Array.isArray(perf.debug) && perf.debug.length) return perf;
    if (perf && Array.isArray(perf.debug)) return perf;
    // Fetch VIN-level rows if schedule payload omitted debug
    const month = empMonth || '';
    const qs = new URLSearchParams({ debug: '1' });
    if (month) qs.set('month', month);
    const data = await api(`/company-performance?${qs.toString()}`);
    if (slaDash) slaDash.companyPerformance = { ...(slaDash.companyPerformance || {}), ...data };
    return data;
  }

  async function openDaysToSalesDetails(opts = {}) {
    try {
      await ensureDaysToSalesDebug();
    } catch (err) {
      alert(err.message || 'Could not load Days to Sales details');
      return;
    }
    const all = getDaysToSalesData();
    const companies = [...new Set(all.map((r) => r.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    dtsDetailState = {
      company: opts.company || '',
      bucket: opts.bucket || '',
      status: opts.status || 'ALL',
      q: '',
    };

    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>Days to Sales — Assignment → Hanouf</h2>
          <p class="sub">Unique VIN · Hanouf Sales Raw only · assignment date filter = VSND month</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="dts-detail-filters">
        <label>Company
          <select id="dts-f-company">
            <option value="">All Companies</option>
            ${companies.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </label>
        <label>Bucket
          <select id="dts-f-bucket">
            <option value="">All</option>
            ${(slaDash && slaDash.companyPerformance && slaDash.companyPerformance.daysDist || []).map((b) => `<option value="${esc(b.label)}">${esc(b.label)}</option>`).join('')}
          </select>
        </label>
        <label>Status
          <select id="dts-f-status">
            <option value="ALL">All</option>
            <option value="SOLD">Sold</option>
            <option value="PENDING">Pending</option>
          </select>
        </label>
        <label class="dts-f-search">Search
          <input type="search" id="dts-f-q" placeholder="Search VIN..." autocomplete="off" />
        </label>
      </div>
      <div class="dts-summary" id="dts-summary"></div>
      <div class="table-wrap vsnd-sheet-wrap">
        <table class="data vsnd-live-table">
          <thead>
            <tr>
              <th>VIN</th>
              <th>Company</th>
              <th>Assignment Date</th>
              <th>Hanouf Sales Date</th>
              <th class="num">Days to Sales</th>
              <th>Bucket</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="dts-detail-tbody"></tbody>
        </table>
      </div>
      <p class="hint" id="dts-detail-foot" style="margin-top:8px"></p>
    `, { wide: true });

    const companyEl = $('dts-f-company');
    const bucketEl = $('dts-f-bucket');
    const statusEl = $('dts-f-status');
    const qEl = $('dts-f-q');
    if (companyEl) companyEl.value = dtsDetailState.company;
    if (bucketEl) bucketEl.value = dtsDetailState.bucket;
    if (statusEl) statusEl.value = dtsDetailState.status;
    const rerender = () => {
      dtsDetailState.company = companyEl ? companyEl.value : '';
      dtsDetailState.bucket = bucketEl ? bucketEl.value : '';
      dtsDetailState.status = statusEl ? statusEl.value : 'ALL';
      dtsDetailState.q = qEl ? qEl.value.trim() : '';
      renderDaysToSalesDetailTable();
    };
    [companyEl, bucketEl, statusEl].forEach((el) => {
      if (el) el.addEventListener('change', rerender);
    });
    if (qEl) qEl.addEventListener('input', rerender);
    renderDaysToSalesDetailTable();
  }

  function renderDaysToSalesDetailTable() {
    const tbody = $('dts-detail-tbody');
    const summaryEl = $('dts-summary');
    const foot = $('dts-detail-foot');
    if (!tbody) return;
    let rows = getDaysToSalesData();
    if (dtsDetailState.company) rows = rows.filter((r) => r.company === dtsDetailState.company);
    if (dtsDetailState.bucket) rows = rows.filter((r) => r.bucket === dtsDetailState.bucket);
    if (dtsDetailState.status === 'SOLD') rows = rows.filter((r) => r.status === 'SOLD');
    if (dtsDetailState.status === 'PENDING') rows = rows.filter((r) => r.status !== 'SOLD');
    const q = String(dtsDetailState.q || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (q) rows = rows.filter((r) => String(r.vin || '').includes(q));

    const sum = summarizeDaysToSales(
      // Summary ignores bucket/status/search? Spec: company filter updates summary. Bucket filter also filters table; summary should recalculate for visible/filtered set when company changes. Spec §9: company filter recalculates summary. Spec §8: bucket filter shows filtered list. I'll recalculate summary from company-filtered base (before bucket/status/search) when only company matters for cards — but also "based only on the selected company". For bucket click, summary of that bucket's sold VINs is more useful.
      // Use currently filtered rows for summary so all filters stay consistent.
      rows
    );
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="dts-sum-card"><span>Total Sold</span><strong>${esc(sum.totalSold)}</strong></div>
        <div class="dts-sum-card"><span>Average Days</span><strong>${sum.averageDays == null ? '—' : esc(sum.averageDays)}</strong></div>
        <div class="dts-sum-card"><span>Fastest Sale</span><strong>${sum.fastestSale == null ? '—' : esc(sum.fastestSale)}</strong></div>
        <div class="dts-sum-card"><span>8+ Days</span><strong>${esc(sum.eightPlus)}</strong></div>`;
    }
    tbody.innerHTML = rows.map((r) => `<tr>
      <td class="detail-vin">${esc(r.vin)}</td>
      <td>${esc(r.company)}</td>
      <td>${esc(fmtDtsDate(r.assignmentDate))}</td>
      <td>${r.salesDate ? esc(fmtDtsDate(r.salesDate)) : '—'}</td>
      <td class="num">${r.daysToSales == null ? '—' : esc(r.daysToSales)}</td>
      <td>${r.bucket ? esc(r.bucket) : '—'}</td>
      <td><span class="badge ${r.status === 'SOLD' ? 'stay' : 'gone'}">${esc(r.status === 'SOLD' ? 'Sold' : 'Pending')}</span></td>
    </tr>`).join('') || '<tr><td colspan="7">No VINs match these filters</td></tr>';
    if (foot) foot.textContent = `${rows.length} VIN(s) · Sold ${sum.totalSold} · Avg ${sum.averageDays == null ? '—' : sum.averageDays}`;
  }

  window.getDaysToSalesData = getDaysToSalesData;

  const CARRIER_STATUS_LABEL = {
    waiting: 'Waiting',
    printed: 'Printed',
    display: 'صالة عرض',
    internal: 'داخلي',
    changed_out: 'Changed away',
  };

  function renderCarrierPanel() {
    const host = $('vsnd-region-body');
    if (!host) return;
    if (!dash) {
      host.innerHTML = '<p class="chart-empty" style="margin:0;font-size:.75rem">Loading…</p>';
      return;
    }
    const stats = dash.carrierStats || [];
    const sum = (k) => stats.reduce((n, c) => n + (Number(c[k]) || 0), 0);
    const max = Math.max(1, ...stats.map((c) => c.total || 0));
    const seg = (c, k) => (c[k] ? `<i class="cs-seg cs-seg--${k}" style="width:${(c[k] / max) * 100}%" title="${esc(CARRIER_STATUS_LABEL[k])}: ${esc(c[k])}"></i>` : '');
    host.innerHTML = `
      <div class="inv-totals cs-totals">
        <div class="inv-total in"><span>VINs</span><strong>${esc(sum('total'))}</strong></div>
        <div class="inv-total out"><span>Companies</span><strong>${esc(stats.filter((c) => c.total).length)}</strong></div>
        <div class="inv-total"><span>Changed</span><strong>${esc(sum('changedIn'))}</strong></div>
        <button type="button" class="btn inv-more" id="carrier-show-schedule">Display schedule</button>
      </div>
      <div class="cs-legend">
        ${['waiting', 'printed', 'display', 'internal'].map((k) => `<span><i class="cs-seg--${k}"></i>${esc(CARRIER_STATUS_LABEL[k])} <b>${esc(sum(k))}</b></span>`).join('')}
      </div>
      <div class="vsnd-hbars fleet-bars cs-bars">
        ${stats.filter((c) => c.total || c.changedOut).map((c) => `
          <button type="button" class="vsnd-hbar fleet-row cs-row" data-carrier-co="${esc(c.company)}"
            title="${esc(c.company)} · ${esc(c.total)} VIN(s) · waiting ${esc(c.waiting)} · printed ${esc(c.printed)} · display ${esc(c.display)} · internal ${esc(c.internal)} · changed in ${esc(c.changedIn)} · changed out ${esc(c.changedOut)}">
            <span class="vsnd-hbar-lbl">${esc(c.company)}${c.changedIn ? `<em class="cs-chg cs-chg--in">+${esc(c.changedIn)}</em>` : ''}${c.changedOut ? `<em class="cs-chg cs-chg--out">−${esc(c.changedOut)}</em>` : ''}</span>
            <span class="vsnd-hbar-track cs-track">${seg(c, 'waiting')}${seg(c, 'printed')}${seg(c, 'display')}${seg(c, 'internal')}</span>
            <b>${esc(c.total || 0)}</b>
          </button>`).join('') || '<p class="chart-empty" style="margin:0;font-size:.75rem">No carrier assignments yet</p>'}
      </div>`;
    const btn = $('carrier-show-schedule');
    if (btn) btn.onclick = () => openCarrierSchedule();
    host.querySelectorAll('[data-carrier-co]').forEach((el) => {
      el.addEventListener('click', () => openCarrierCompany(el.dataset.carrierCo));
    });
  }

  /** Everything captured for one الناقل: assigned VINs, prints, display / internal, coordinator changes. */
  function openCarrierCompany(company, filter = '') {
    const c = (dash && dash.carrierStats || []).find((x) => x.company === company);
    if (!c) return;
    const { na } = window.DTX;
    const list = (c.vins || []).filter((v) => !filter || (filter === 'changed' ? (v.changedFrom || v.status === 'changed_out') : v.status === filter));
    const chip = (key, label, n) => `<button type="button" class="cs-chip${filter === key ? ' is-on' : ''}" data-cs-filter="${esc(key)}">${esc(label)} <b>${esc(n)}</b></button>`;
    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>🚚 ${esc(c.company)}</h2>
          <p class="sub">${esc(c.total)} VIN(s) · everything captured from employee.html (Hanouf / Rasha) + coordinator.html</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="cs-chips">
        ${chip('', 'All', (c.vins || []).length)}
        ${chip('waiting', CARRIER_STATUS_LABEL.waiting, c.waiting)}
        ${chip('printed', CARRIER_STATUS_LABEL.printed, c.printed)}
        ${chip('display', CARRIER_STATUS_LABEL.display, c.display)}
        ${chip('internal', CARRIER_STATUS_LABEL.internal, c.internal)}
        ${chip('changed', 'Changed (in / out)', (c.changedIn || 0) + (c.changedOut || 0))}
      </div>
      <div class="table-wrap vsnd-sheet-wrap">
        <table class="data vsnd-live-table">
          <thead>
            <tr><th>#</th><th>VIN</th><th>Status</th><th>Product</th><th>Customer</th><th>City</th><th>الناقل</th><th>Changed</th><th>Memo</th><th>Printed</th><th>By</th></tr>
          </thead>
          <tbody>${list.map((v, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><b>${esc(v.vin)}</b></td>
              <td><span class="cs-status cs-status--${esc(v.status)}">${esc(CARRIER_STATUS_LABEL[v.status] || v.status)}</span></td>
              <td>${esc(na(v.product))}</td>
              <td>${esc(na(v.customer))}</td>
              <td>${esc(na(v.city))}</td>
              <td>${esc(na(v.carrier))}</td>
              <td>${v.changedFrom ? `<span class="cs-chg-note" title="${esc([v.changedBy, fmtWhen(v.changedAt)].filter(Boolean).join(' · '))}">${esc(v.changedFrom)} ← ${esc(v.carrier || c.company)}</span>` : '—'}</td>
              <td>${esc(na(v.invoice))}</td>
              <td>${v.printedAt ? esc(fmtWhen(v.printedAt)) : '—'}</td>
              <td>${esc(na(v.printedBy))}</td>
            </tr>`).join('') || '<tr><td colspan="11">No VINs</td></tr>'}
          </tbody>
        </table>
      </div>`, { wide: true });
    $('detail-drawer').querySelectorAll('[data-cs-filter]').forEach((b) => {
      b.addEventListener('click', () => openCarrierCompany(company, b.dataset.csFilter || ''));
    });
  }

  function openCarrierSchedule(focusCompany) {
    if (!dash || !dash.carrierPivot) return;
    const pivot = dash.carrierPivot;
    const cities = pivot.cities || [];
    const rows = focusCompany
      ? (pivot.rows || []).filter((r) => r.company === focusCompany)
      : (pivot.rows || []);
    const cityTotals = pivot.cityTotals || {};
    const { na } = window.DTX;

    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>الناقل × المدينة · schedule</h2>
          <p class="sub">${esc(pivot.total || 0)} VIN(s) from coordinator.html · click a number for VIN list</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap vsnd-sheet-wrap pivot-wrap">
        <table class="data vsnd-live-table pivot-table" dir="rtl">
          <thead>
            <tr>
              <th class="pivot-corner">الناقل</th>
              ${cities.map((c) => `<th>${esc(c)}</th>`).join('')}
              <th class="pivot-total">Grand Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <th class="pivot-row-lbl">${esc(r.company)}</th>
                ${cities.map((city) => {
                  const cell = r.cells && r.cells[city];
                  const n = cell ? cell.count : 0;
                  if (!n) return '<td class="pivot-empty"></td>';
                  return `<td class="pivot-hit">
                    <button type="button" class="pivot-num" data-co="${esc(r.company)}" data-city="${esc(city)}">${esc(n)}</button>
                  </td>`;
                }).join('')}
                <td class="pivot-total">
                  <button type="button" class="pivot-num" data-co="${esc(r.company)}" data-city="">${esc(r.total || 0)}</button>
                </td>
              </tr>`).join('') || `<tr><td colspan="${cities.length + 2}">No prints yet</td></tr>`}
            <tr class="pivot-grand">
              <th class="pivot-row-lbl">Grand Total</th>
              ${cities.map((city) => {
                const n = cityTotals[city] || 0;
                if (!n) return '<td class="pivot-empty"></td>';
                return `<td class="pivot-hit">
                  <button type="button" class="pivot-num" data-co="" data-city="${esc(city)}">${esc(n)}</button>
                </td>`;
              }).join('')}
              <td class="pivot-total"><b>${esc(pivot.total || 0)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div id="pivot-vin-host" class="pivot-vin-host" hidden></div>`, { wide: true });

    const drawer = $('detail-drawer');
    drawer.querySelectorAll('.pivot-num').forEach((btn) => {
      btn.addEventListener('click', () => {
        showPivotVins(btn.dataset.co || '', btn.dataset.city || '', na);
      });
    });
  }

  function showPivotVins(company, city, na) {
    const pivot = dash && dash.carrierPivot;
    if (!pivot) return;
    const host = $('pivot-vin-host');
    if (!host) return;
    const list = [];
    (pivot.rows || []).forEach((r) => {
      if (company && r.company !== company) return;
      Object.keys(r.cells || {}).forEach((c) => {
        if (city && c !== city) return;
        (r.cells[c].vins || []).forEach((v) => list.push(v));
      });
    });
    list.sort((a, b) => String(a.vin).localeCompare(String(b.vin)));
    const title = [company || 'All الناقل', city || 'All cities'].filter(Boolean).join(' · ');
    host.hidden = false;
    host.innerHTML = `
      <h3 style="margin:12px 0 8px;font-size:.9rem">${esc(title)} · ${list.length} VIN(s)</h3>
      <div class="table-wrap" style="max-height:32vh">
        <table class="data vsnd-live-table">
          <thead>
            <tr><th>#</th><th>VIN</th><th>الناقل</th><th>City</th><th>Product</th><th>Customer</th><th>Printed</th><th>By</th></tr>
          </thead>
          <tbody>${list.map((v, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><b>${esc(v.vin)}</b></td>
              <td>${esc(na(v.company))}</td>
              <td>${esc(na(v.city))}</td>
              <td>${esc(na(v.product))}</td>
              <td>${esc(na(v.customer))}</td>
              <td>${esc(fmtWhen(v.printedAt))}</td>
              <td>${esc(na(v.printedBy))}</td>
            </tr>`).join('') || '<tr><td colspan="8">No VINs</td></tr>'}
          </tbody>
        </table>
      </div>`;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderDisplayCounter() {
    const host = $('vsnd-emp-body');
    if (!host) return;
    const inv = inventoryDash;
    if (!inv) {
      host.innerHTML = '<p class="chart-empty" style="margin:0;font-size:.75rem">No inventory data</p>';
      return;
    }
    const display = inv.display || 0;
    const delivery = inv.delivery || 0;
    const max = Math.max(1, display, delivery);
    host.innerHTML = `
      <div class="inv-totals">
        <div class="inv-total in"><span>Display</span><strong>${esc(display)}</strong></div>
        <div class="inv-total out"><span>Delivery</span><strong>${esc(delivery)}</strong></div>
        <button type="button" class="btn inv-more" id="display-more-details">More details</button>
      </div>
      <div class="vsnd-hbars">
        <button type="button" class="vsnd-hbar fleet-row" data-disp-kind="display" title="Display cars">
          <span class="vsnd-hbar-lbl">Display</span>
          <span class="vsnd-hbar-track"><i style="width:${(display / max) * 100}%;background:#7c3aed"></i></span>
          <b>${esc(display)}</b>
        </button>
        <button type="button" class="vsnd-hbar fleet-row" data-disp-kind="delivery" title="Delivery cars">
          <span class="vsnd-hbar-lbl">Delivery</span>
          <span class="vsnd-hbar-track"><i style="width:${(delivery / max) * 100}%;background:#059669"></i></span>
          <b>${esc(delivery)}</b>
        </button>
      </div>
      <div class="vsnd-mini-legend"><span><i style="background:#7c3aed"></i> Display</span><span><i style="background:#059669"></i> Delivery</span></div>`;
    const more = $('display-more-details');
    if (more) more.onclick = () => openDisplayDetail();
    host.querySelectorAll('[data-disp-kind]').forEach((btn) => {
      btn.addEventListener('click', () => openDisplayDetail(btn.dataset.dispKind));
    });
  }

  function openDisplayDetail(kind) {
    const inv = inventoryDash;
    if (!inv) return;
    const { na } = window.DTX;
    const sections = [];
    if (!kind || kind === 'display') {
      sections.push({
        title: 'Display',
        count: inv.display || 0,
        rows: inv.displayRows || [],
        color: '#7c3aed',
      });
    }
    if (!kind || kind === 'delivery') {
      sections.push({
        title: 'Delivery',
        count: inv.delivery || 0,
        rows: inv.deliveryRows || [],
        color: '#059669',
      });
    }
    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>${esc(kind === 'delivery' ? 'Delivery' : kind === 'display' ? 'Display' : 'Display / Delivery')}</h2>
          <p class="sub">${esc(inv.display || 0)} display · ${esc(inv.delivery || 0)} delivery · labeled by Ruba in inventory</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="inv-detail-summary">
        ${sections.map((s) => `
          <div class="inv-detail-card">
            <h3 style="color:${esc(s.color)}">${esc(s.title)} · ${esc(s.count)}</h3>
            <div class="table-wrap vsnd-sheet-wrap" style="max-height:36vh">
              <table class="data vsnd-live-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>VIN</th>
                    <th>Product</th>
                    <th>Customer</th>
                    <th>Stock</th>
                    <th>Proforma</th>
                    <th>Claimed</th>
                  </tr>
                </thead>
                <tbody>${(s.rows || []).map((r, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><b>${esc(r.vin)}</b></td>
                    <td>${esc(na(r.product))}</td>
                    <td>${esc(na(r.customer))}</td>
                    <td>${esc(na(r.stockOwner))}</td>
                    <td>${esc(na(r.proformaDate))}</td>
                    <td>${esc(fmtWhen(r.claimedAt))}</td>
                  </tr>`).join('') || `<tr><td colspan="7">No ${esc(s.title.toLowerCase())} cars</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>`).join('')}
      </div>`, { wide: true });
  }

  function accuracyColor(score) {
    const n = Number(score) || 0;
    if (n >= 90) return '#22c55e';
    if (n >= 70) return '#eab308';
    return '#ef4444';
  }

  function renderEntryAccuracy(data) {
    const host = $('vsnd-aging-body');
    if (!host) return;
    if (!data || !Array.isArray(data.users)) {
      host.innerHTML = '<p class="chart-empty" style="margin:0;font-size:.75rem">No accuracy data</p>';
      return;
    }
    const avg = data.avg != null ? data.avg : 0;
    host.innerHTML = `
      <div class="acc-head">
        <div class="acc-avg" title="Team average (users with VINs)">
          <span>Avg</span><strong style="color:${accuracyColor(avg)}">${esc(avg)}</strong><em>/100</em>
        </div>
        <button type="button" class="btn inv-more" id="acc-more-details">More details</button>
      </div>
      <div class="vsnd-hbars acc-bars">
        ${data.users.map((u) => `
          <button type="button" class="vsnd-hbar acc-row" data-acc-user="${esc(u.id)}" title="${esc(u.name)} · ${u.missing || 0} missing · ${u.vins || 0} VIN(s)">
            <span class="vsnd-hbar-lbl">${esc(u.name)}</span>
            <span class="vsnd-hbar-track"><i style="width:${Math.max(0, Math.min(100, u.score || 0))}%;background:${esc(u.color || accuracyColor(u.score))}"></i></span>
            <b>${esc(u.score || 0)}<small>/100</small></b>
          </button>`).join('')}
      </div>`;
    const more = $('acc-more-details');
    if (more) more.onclick = () => openEntryAccuracyDetail();
    host.querySelectorAll('[data-acc-user]').forEach((btn) => {
      btn.addEventListener('click', () => openEntryAccuracyDetail(btn.dataset.accUser));
    });
  }

  function openEntryAccuracyDetail(userId) {
    const data = slaDash && slaDash.calendar && slaDash.calendar.analytics
      && slaDash.calendar.analytics.entryAccuracy;
    if (!data) return;
    const users = userId
      ? (data.users || []).filter((u) => u.id === userId)
      : (data.users || []);
    const title = userId && users[0] ? users[0].name : 'Entry Accuracy';
    openDrawer(`
      <div class="drawer-head vsnd-sheet-head">
        <div>
          <h2>${esc(title)}</h2>
          <p class="sub">Avg ${esc(data.avg || 0)}/100 · ${esc(data.totalMissing || 0)} missing field(s) · month ${esc(data.month || '—')}</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="inv-detail-summary">
        ${users.map((u) => `
          <div class="inv-detail-card">
            <h3>${esc(u.name)} · <span style="color:${esc(u.color || accuracyColor(u.score))}">${esc(u.score)}/100</span></h3>
            <div class="inv-detail-nums">
              <span><em>Filled</em><b>${esc(u.filled || 0)}</b></span>
              <span><em>Missing</em><b>${esc(u.missing || 0)}</b></span>
              <span><em>VINs</em><b>${esc(u.vins || 0)}</b></span>
              <span><em>Audit clears</em><b>${esc((u.clears && u.clears.length) || 0)}</b></span>
            </div>
            <div class="table-wrap vsnd-sheet-wrap" style="max-height:32vh">
              <table class="data vsnd-live-table">
                <thead>
                  <tr><th>#</th><th>VIN</th><th>Missing fields</th><th>Status</th></tr>
                </thead>
                <tbody>${(u.rows && u.rows.length
                  ? u.rows.map((r, i) => `
                      <tr>
                        <td>${i + 1}</td>
                        <td><b>${esc(r.vin)}</b></td>
                        <td>${esc((r.gaps || []).map((g) => g.label || g.field).join(', '))}</td>
                        <td>${esc(r.status || '—')}</td>
                      </tr>`).join('')
                  : '<tr><td colspan="4">No missing entries</td></tr>')}
                </tbody>
              </table>
            </div>
          </div>`).join('') || '<p class="chart-empty">No users</p>'}
      </div>`, { wide: true });
  }

  function renderSchedule() {
    const host = $('sla-chart');
    const monthLbl = $('vsnd-month-label');
    if (!host) return;
    syncMonthInputs();
    if (!slaDash) {
      if (monthLbl) monthLbl.textContent = '—';
      host.innerHTML = '<p class="chart-empty">Could not load VSND schedule.</p>';
      return;
    }
    const cal = slaDash.calendar;
    if (!cal || !cal.rows) {
      host.innerHTML = '<p class="chart-empty">No calendar data for this month.</p>';
      return;
    }
    const label = monthLabel(cal.month) || cal.month;
    const year = String(cal.month || '').slice(0, 4);
    if (monthLbl) monthLbl.textContent = `${label} ${year}`.trim();
    if ($('vsnd-sched-title')) $('vsnd-sched-title').textContent = `VSND Schedule — ${label} ${year}`.trim();
    if ($('vsnd-updated')) {
      $('vsnd-updated').textContent = new Date().toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    }
    renderVsndCharts(cal);
    if (slaDash && slaDash.controlCenter) {
      renderControlKpis('vsnd-sla-kpis', slaDash.controlCenter);
      renderControlKpis('sla-control-kpis', slaDash.controlCenter);
    }
    renderScheduleAlerts(cal);

    const headers = cal.dayHeaders || [];
    const headCells = headers.map((h) => `
      <th class="vsnd-day ${h.future ? 'is-future' : ''}${h.day === cal.todayDay ? ' is-today' : ''}${h.day === cal.psfuTarget ? ' is-due' : ''}">
        <b>${h.day}</b><small>${esc(h.weekday)}</small>
      </th>`).join('');

    const body = (cal.rows || []).map((r) => {
      const cells = (r.days || []).map((n, i) => {
        const zone = (r.zones && r.zones[i]) || 'empty';
        const future = zone === 'future';
        const show = future ? '—' : (n || 0);
        const clickable = !future && n > 0;
        return `<td class="vsnd-cell zone-${esc(zone)}${clickable ? ' is-hit' : ''}">
          <button type="button" class="vsnd-val" data-status="${esc(r.status)}" data-day="${i + 1}" ${clickable ? '' : 'disabled'}>${esc(show)}</button>
        </td>`;
    }).join('');
      return `<tr class="vsnd-row tone-${esc(r.tone)}">
        <th class="vsnd-status">
          <span class="vsnd-ico" aria-hidden="true">${r.icon || '•'}</span>
          <span class="vsnd-status-lbl">${esc(r.label)}</span>
        </th>
        ${cells}
        <td class="vsnd-total">
          <button type="button" class="vsnd-total-btn" data-status="${esc(r.status)}" data-day="">${esc(r.total || 0)}</button>
        </td>
      </tr>`;
    }).join('');

    const footDays = (cal.dayTotals || []).map((n, i) => {
      const future = headers[i] && headers[i].future;
      return `<td class="vsnd-foot-day${future ? ' is-future' : ''}">${future ? '—' : esc(n || 0)}</td>`;
    }).join('');

    host.innerHTML = `
      <table class="vsnd-table">
        <thead>
          <tr>
            <th class="vsnd-status-h">Status</th>
            ${headCells}
            <th class="vsnd-total-h">Total</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <th class="vsnd-status">Total</th>
            ${footDays}
            <td class="vsnd-grand"><span>${esc(cal.grandTotal || 0)}</span></td>
          </tr>
        </tfoot>
      </table>`;

    host.querySelectorAll('.vsnd-val[data-status], .vsnd-total-btn[data-status]').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.disabled) return;
        openVsndCell(el.dataset.status, el.dataset.day ? Number(el.dataset.day) : 0);
      });
    });
  }

  function scheduleAlertRank(condition) {
    const order = [
      'SLA_BREACHED', 'NO_MOVEMENT', 'DELIVERY_LATE', 'COMPLETED_LATE',
      'DUE_TODAY', 'AT_RISK', 'MISSING_DATA',
    ];
    const i = order.indexOf(condition);
    return i >= 0 ? i : 99;
  }

  function isScheduleAlert(condition) {
    return scheduleAlertRank(condition) < 99;
  }

  function renderScheduleAlerts(cal) {
    const host = $('vsnd-alerts-body');
    const meta = $('vsnd-alerts-meta');
    if (!host) return;
    const vins = (cal && cal.vins) || [];
    const alerts = vins
      .filter((v) => isScheduleAlert(v.condition) || v.zone === 'red' || v.zone === 'yellow')
      .slice()
      .sort((a, b) => {
        const ra = scheduleAlertRank(a.condition);
        const rb = scheduleAlertRank(b.condition);
        if (ra !== rb) return ra - rb;
        return (b.statusAgeHours || 0) - (a.statusAgeHours || 0);
      });

    const breached = alerts.filter((a) => a.condition === 'SLA_BREACHED' || a.condition === 'NO_MOVEMENT' || a.condition === 'DELIVERY_LATE').length;
    const risk = alerts.filter((a) => a.condition === 'AT_RISK' || a.condition === 'DUE_TODAY').length;
    if (meta) {
      meta.textContent = alerts.length
        ? `${alerts.length} alert(s) · ${breached} critical · ${risk} at risk/due · live from schedule`
        : 'No schedule alerts · all on track';
    }

    if (!alerts.length) {
      host.innerHTML = '<p class="chart-empty">No schedule alerts right now</p>';
      return;
    }

    const tone = (c) => {
      if (c === 'SLA_BREACHED' || c === 'NO_MOVEMENT' || c === 'DELIVERY_LATE' || c === 'COMPLETED_LATE') return 'crit';
      if (c === 'AT_RISK' || c === 'DUE_TODAY') return 'warn';
      return 'info';
    };

    host.innerHTML = `
      <div class="vsnd-alert-list">
        ${alerts.map((r) => `
          <button type="button" class="vsnd-alert-row tone-${tone(r.condition)}"
            data-status="${esc(r.status)}" data-day="${esc(r.day)}" data-vin="${esc(r.vin)}"
            title="Open schedule cell">
            <span class="vsnd-alert-badge">${esc(r.conditionLabel || r.condition || 'ALERT')}</span>
            <span class="vsnd-alert-vin"><b>${esc(r.vin)}</b></span>
            <span class="vsnd-alert-model">${esc(r.product || '—')}</span>
            <span class="vsnd-alert-status">${esc(r.status || '—')}</span>
            <span class="vsnd-alert-age">${r.statusAgeHours != null ? `${esc(r.statusAgeHours)}h` : '—'}</span>
            <span class="vsnd-alert-pro">${esc(r.proforma || '—')}</span>
          </button>`).join('')}
      </div>`;

    host.querySelectorAll('.vsnd-alert-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const day = Number(btn.dataset.day) || 0;
        const status = btn.dataset.status || '';
        openVsndCell(status, day);
      });
    });
  }

  function openVsndCell(status, day) {
    const cal = slaDash && slaDash.calendar;
    if (!cal) return;
    const rows = (cal.vins || []).filter((v) => {
      if (status && v.status !== status) return false;
      if (day && Number(v.day) !== Number(day)) return false;
      return true;
    }).sort((a, b) => {
      const za = a.zone === 'red' ? 0 : a.zone === 'yellow' ? 1 : 2;
      const zb = b.zone === 'red' ? 0 : b.zone === 'yellow' ? 1 : 2;
      if (za !== zb) return za - zb;
      return String(a.vin).localeCompare(String(b.vin));
    });
    const title = day ? `${status} · Day ${day}` : status;
    const condClass = (c) => {
      if (c === 'SLA_BREACHED' || c === 'NO_MOVEMENT' || c === 'DELIVERY_LATE' || c === 'COMPLETED_LATE') return 'sla-bad';
      if (c === 'AT_RISK' || c === 'DUE_TODAY') return 'sla-warn';
      if (c === 'ON_TRACK' || c === 'COMPLETED_ON_TIME') return 'sla-ok';
      return '';
    };
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(title)}</h2>
          <p class="sub">${esc(monthLabel(cal.month) || cal.month)} · ${rows.length} unique VIN(s) · Proforma date × status</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap" style="max-height:70vh">
        <table class="data">
          <thead>
            <tr>
              <th>VIN</th><th>Model</th><th>Proforma</th><th>Status since</th>
              <th>Age</th><th>SLA</th><th>Condition</th><th>Delivery due</th>
            </tr>
          </thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td class="detail-vin"><b>${esc(r.vin)}</b></td>
              <td>${esc(r.product || '—')}</td>
              <td>${esc(r.proforma || '—')}</td>
              <td>${esc((r.statusChangedAt || '').replace('T', ' ').slice(0, 16) || 'MISSING')}</td>
              <td>${r.statusAgeHours != null ? `${esc(r.statusAgeHours)}h` : '—'}</td>
              <td>${r.slaBreach != null ? `${esc(r.slaBreach)}h` : '—'}</td>
              <td class="${condClass(r.condition)}"><b>${esc(r.conditionLabel || r.condition || '—')}</b></td>
              <td>${esc(r.deliveryDueDate || '—')}${r.deliverySlaResult ? `<br><span class="hint">${esc(r.deliverySlaResult)}</span>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="8">No VINs in this cell.</td></tr>'}
          </tbody>
        </table>
      </div>`);
  }

  function openSla(id) {
    const s = ((slaDash && slaDash.sla) || []).find((x) => x.id === id);
    if (!s) return;
    const rows = (s.rows || []).slice().sort((a, b) => {
      if (a.zone !== b.zone) return a.zone === 'red' ? -1 : 1;
      return String(a.vin).localeCompare(String(b.vin));
    });
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(s.label)}</h2>
          <p class="sub">Target Day ${s.targetDay} from each VIN’s Proforma · ${s.green} on plan · ${s.red} late</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap" style="max-height:70vh">
        <table class="data">
          <thead><tr><th>VIN</th><th>Employee</th><th>Proforma</th><th>Target</th><th>Actual</th><th>Result</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td class="detail-vin">${esc(r.vin)}</td>
              <td>${esc(r.employee || '—')}</td>
              <td>${esc(r.proforma || '—')}</td>
              <td>${esc(r.targetDate || '—')}</td>
              <td>${esc(r.actualAt || '—')}</td>
              <td class="${resultClass(r.result)}"><b>${esc(r.result)}</b><br /><span class="hint">${esc(r.label)}</span></td>
            </tr>`).join('') || '<tr><td colspan="6">No VINs with a Proforma Date this month.</td></tr>'}</tbody>
        </table>
      </div>`);
  }

  function renderControlKpis(hostId, kpis) {
    const host = $(hostId);
    if (!host) return;
    const k = kpis || {};
    const cards = [
      ['TOTAL VINs', k.total || 0, ''],
      ['ON TRACK', k.ON_TRACK || 0, 'ok'],
      ['AT RISK', k.AT_RISK || 0, 'warn'],
      ['DUE TODAY', k.DUE_TODAY || 0, 'warn'],
      ['SLA BREACHED', k.SLA_BREACHED || 0, 'bad'],
      ['NO MOVEMENT', k.NO_MOVEMENT || 0, 'bad'],
      ['DELIVERY LATE', k.DELIVERY_LATE || 0, 'bad'],
    ];
    host.innerHTML = cards.map(([l, v, c]) =>
      `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`
    ).join('');
  }

  let slaConfigState = null;

  function renderSlaForm(data) {
    slaConfigState = data;
    const canEdit = !!(data && data.canEdit);
    const control = (data && data.control) || { rules: [], delivery: {} };
    const host = $('sla-body');
    if (host) {
      host.innerHTML = (control.rules || []).map((x) => `
        <tr data-rule-id="${esc(x.id)}">
          <td><b>${esc(x.status)}</b></td>
          <td><input type="number" min="0" step="1" class="wgt-input sla-f" data-f="warningValue" value="${esc(x.warningValue)}" ${canEdit ? '' : 'disabled'} /> h</td>
          <td><input type="number" min="0" step="1" class="wgt-input sla-f" data-f="breachValue" value="${esc(x.breachValue)}" ${canEdit ? '' : 'disabled'} /> h</td>
          <td><input type="number" min="0" step="1" class="wgt-input sla-f" data-f="noMoveWarnValue" value="${esc(x.noMoveWarnValue)}" ${canEdit ? '' : 'disabled'} /> h</td>
          <td><input type="number" min="0" step="1" class="wgt-input sla-f" data-f="noMoveBreachValue" value="${esc(x.noMoveBreachValue)}" ${canEdit ? '' : 'disabled'} /> h</td>
          <td><input type="checkbox" class="sla-f" data-f="active" ${x.active ? 'checked' : ''} ${canEdit ? '' : 'disabled'} /></td>
          <td>${canEdit ? `<button type="button" class="btn sla-edit-row" data-id="${esc(x.id)}">Edit</button>` : 'View'}</td>
        </tr>`).join('') || '<tr><td colspan="7">No SLA rules</td></tr>';
    }

    const dHost = $('sla-delivery-form');
    const d = control.delivery || {};
    if (dHost) {
      dHost.innerHTML = `
        <div class="field"><label>Target days</label><input type="number" min="1" id="sla-del-target" value="${esc(d.targetDays != null ? d.targetDays : 5)}" ${canEdit ? '' : 'disabled'} /></div>
        <div class="field"><label>Warning days</label><input type="number" min="0" id="sla-del-warn" value="${esc(d.warningDays != null ? d.warningDays : 4)}" ${canEdit ? '' : 'disabled'} /></div>
        <div class="field"><label>Breach days</label><input type="number" min="0" id="sla-del-breach" value="${esc(d.breachDays != null ? d.breachDays : 5)}" ${canEdit ? '' : 'disabled'} /></div>
        <div class="field"><label>Start from</label>
          <select id="sla-del-start" ${canEdit ? '' : 'disabled'}>
            <option value="proforma"${d.startFrom === 'proforma' ? ' selected' : ''}>Proforma Date</option>
            <option value="claimed"${d.startFrom === 'claimed' ? ' selected' : ''}>CLAIMED Date</option>
            <option value="psfu"${d.startFrom === 'psfu' ? ' selected' : ''}>PSFU Date</option>
          </select>
        </div>
        <div class="field"><label>Day type</label>
          <select id="sla-del-type" ${canEdit ? '' : 'disabled'}>
            <option value="calendar"${d.dayType !== 'working' ? ' selected' : ''}>Calendar days</option>
            <option value="working"${d.dayType === 'working' ? ' selected' : ''}>Working days</option>
          </select>
        </div>
        <div class="field"><label>Active</label>
          <select id="sla-del-active" ${canEdit ? '' : 'disabled'}>
            <option value="yes"${d.active !== false ? ' selected' : ''}>YES</option>
            <option value="no"${d.active === false ? ' selected' : ''}>NO</option>
          </select>
        </div>`;
    }

    const hist = $('sla-history-body');
    if (hist) {
      hist.innerHTML = (data.history || []).map((h) => {
        const changes = Array.isArray(h.detail) && h.detail.length
          ? h.detail.map((dd) => `${dd.status}.${dd.field}: ${dd.old} → ${dd.neu}`).join('<br>')
          : esc(h.newValue || '—');
        return `<tr>
          <td>${esc((h.at || '').replace('T', ' ').slice(0, 19))}</td>
          <td>${esc(h.admin || '—')}</td>
          <td>${esc(h.reason || '—')}</td>
          <td class="hint">${changes}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="4">No SLA changes yet</td></tr>';
    }

    if ($('sla-save')) $('sla-save').disabled = !canEdit;
    if ($('sla-add-rule')) $('sla-add-rule').disabled = !canEdit;
    if ($('sla-hint')) {
      $('sla-hint').textContent = canEdit
        ? 'Admin · changes apply to live VSND immediately after save'
        : 'View only · ask an admin to change SLA rules';
    }

    if (host && canEdit) {
      host.querySelectorAll('.sla-edit-row').forEach((btn) => {
        btn.addEventListener('click', () => openSlaRuleEditor(btn.dataset.id));
      });
    }
  }

  function openSlaRuleEditor(id) {
    if (!slaConfigState || !slaConfigState.canEdit) return;
    const rule = ((slaConfigState.control && slaConfigState.control.rules) || []).find((r) => r.id === id);
    if (!rule) return;
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div><h2>${esc(rule.status)} SLA</h2><p class="sub">Edit thresholds · hours</p></div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="field"><label>Warning After (hours)</label><input type="number" id="edit-warn" value="${esc(rule.warningValue)}" /></div>
      <div class="field"><label>Breach After (hours)</label><input type="number" id="edit-breach" value="${esc(rule.breachValue)}" /></div>
      <div class="field"><label>No Movement Warning</label><input type="number" id="edit-nmw" value="${esc(rule.noMoveWarnValue)}" /></div>
      <div class="field"><label>No Movement Breach</label><input type="number" id="edit-nmb" value="${esc(rule.noMoveBreachValue)}" /></div>
      <div class="field"><label>Active</label>
        <select id="edit-active"><option value="yes"${rule.active ? ' selected' : ''}>YES</option><option value="no"${!rule.active ? ' selected' : ''}>NO</option></select>
      </div>
      <button type="button" class="btn-primary" id="edit-sla-apply" style="margin-top:12px">Apply to form</button>
    `);
    const apply = $('edit-sla-apply');
    if (apply) {
      apply.onclick = () => {
        const tr = document.querySelector('#sla-body tr[data-rule-id="' + CSS.escape(id) + '"]');
        if (tr) {
          const set = (f, v) => {
            const el = tr.querySelector('[data-f="' + f + '"]');
            if (!el) return;
            if (el.type === 'checkbox') el.checked = !!v;
            else el.value = v;
          };
          set('warningValue', Number($('edit-warn').value));
          set('breachValue', Number($('edit-breach').value));
          set('noMoveWarnValue', Number($('edit-nmw').value));
          set('noMoveBreachValue', Number($('edit-nmb').value));
          set('active', $('edit-active').value === 'yes');
        }
        closeDrawer();
        toast('Updated in form — click Save SLA rules');
      };
    }
  }

  function collectControlFromForm() {
    const rules = [...document.querySelectorAll('#sla-body tr[data-rule-id]')].map((tr) => {
      const id = tr.dataset.ruleId;
      const prev = ((slaConfigState && slaConfigState.control && slaConfigState.control.rules) || [])
        .find((r) => r.id === id) || {};
      const val = (f) => {
        const el = tr.querySelector('[data-f="' + f + '"]');
        if (!el) return prev[f];
        if (el.type === 'checkbox') return el.checked;
        return Number(el.value);
      };
      const statusEl = tr.querySelector('b');
      return {
        id,
        status: prev.status || (statusEl ? statusEl.textContent : id),
        warningValue: val('warningValue'),
        breachValue: val('breachValue'),
        noMoveWarnValue: val('noMoveWarnValue'),
        noMoveBreachValue: val('noMoveBreachValue'),
        active: val('active'),
        warningUnit: 'hours',
        breachUnit: 'hours',
        noMoveWarnUnit: 'hours',
        noMoveBreachUnit: 'hours',
        calculationType: prev.calculationType || 'status_age',
      };
    });
    return {
      rules,
      delivery: {
        targetDays: Number(($('sla-del-target') && $('sla-del-target').value) || 5),
        warningDays: Number(($('sla-del-warn') && $('sla-del-warn').value) || 4),
        breachDays: Number(($('sla-del-breach') && $('sla-del-breach').value) || 5),
        startFrom: ($('sla-del-start') && $('sla-del-start').value) || 'proforma',
        dayType: ($('sla-del-type') && $('sla-del-type').value) || 'calendar',
        active: (($('sla-del-active') && $('sla-del-active').value) || 'yes') === 'yes',
        deliveredStatus: 'تم التسليم',
      },
      priority: (slaConfigState && slaConfigState.control && slaConfigState.control.priority) || undefined,
    };
  }

  async function loadSlaConfig() {
    renderSlaForm(await api('/schedule/config'));
    if (slaDash && slaDash.controlCenter) {
      renderControlKpis('sla-control-kpis', slaDash.controlCenter);
    }
  }

  async function saveSlaConfig() {
    if ($('sla-error')) $('sla-error').textContent = '';
    if (slaConfigState && slaConfigState.canEdit === false) {
      if ($('sla-error')) $('sla-error').textContent = 'Only admin can change SLA rules';
      return;
    }
    const reason = String(($('sla-reason') && $('sla-reason').value) || '').trim();
    if (!reason) {
      if ($('sla-error')) {
        $('sla-error').textContent = 'Enter a reason for this SLA change';
        $('sla-error').classList.add('ekpi-err');
      }
      return;
    }
    try {
      const data = await api('/schedule/config', {
        method: 'PUT',
        json: { control: collectControlFromForm(), reason },
      });
      toast('SLA rules saved');
      renderSlaForm(Object.assign({}, data, { canEdit: true }));
      if ($('sla-reason')) $('sla-reason').value = '';
      await loadDash();
    } catch (err) {
      if ($('sla-error')) {
        $('sla-error').textContent = err.message || 'Could not save';
        $('sla-error').classList.add('ekpi-err');
      }
    }
  }

  function addSlaCondition() {
    if (!slaConfigState || !slaConfigState.canEdit) return;
    const status = prompt('Status name (must match Live Sheet status exactly):');
    if (!status) return;
    const host = $('sla-body');
    if (!host) return;
    const id = 'custom_' + Date.now();
    const tr = document.createElement('tr');
    tr.dataset.ruleId = id;
    tr.innerHTML = `
      <td><b>${esc(status.trim())}</b></td>
      <td><input type="number" min="0" class="wgt-input sla-f" data-f="warningValue" value="24" /> h</td>
      <td><input type="number" min="0" class="wgt-input sla-f" data-f="breachValue" value="48" /> h</td>
      <td><input type="number" min="0" class="wgt-input sla-f" data-f="noMoveWarnValue" value="24" /> h</td>
      <td><input type="number" min="0" class="wgt-input sla-f" data-f="noMoveBreachValue" value="48" /> h</td>
      <td><input type="checkbox" class="sla-f" data-f="active" checked /></td>
      <td>New</td>`;
    host.appendChild(tr);
    if (!slaConfigState.control) slaConfigState.control = { rules: [] };
    slaConfigState.control.rules.push({
      id,
      status: status.trim(),
      warningValue: 24,
      breachValue: 48,
      noMoveWarnValue: 24,
      noMoveBreachValue: 48,
      active: true,
    });
    toast('Condition added — set reason and Save');
  }

  async function loadDash({ silent = false } = {}) {
    if (silent && dashInFlight) return;
    dashInFlight = true;
    try {
      if (!isCollector(getUser()) || !getToken()) {
        if (!silent) kickToGate('Collector session missing — sign in again');
        return;
      }
      const monthQs = empMonth ? `?month=${encodeURIComponent(empMonth)}` : '';
      const [dashData, perfData, slaData, backupData, invData] = await Promise.all([
        api('/admin/dashboard'),
        api(`/team-performance${monthQs}`).catch(() => null),
        api(`/schedule/dashboard${monthQs}`).catch(() => null),
        api('/backup').catch(() => null),
        api('/inventory').catch(() => null),
      ]);
      dash = dashData;
      if (perfData) {
        perf = perfData;
        empMonth = perfData.month || empMonth;
      }
      if (slaData) {
        slaDash = slaData;
        empMonth = slaData.month || empMonth;
      }
      if (backupData) backup = backupData;
      inventoryDash = invData;
      syncMonthInputs();
      renderKpis();
      renderBackup();
      renderAttendance();
      renderUsers();
      renderCities();
      renderEmployees();
      renderSchedule();
      renderInventoryPanel();
      renderFleetFreeLeft();
      renderDisplayCounter();
      renderCarrierPanel();
      renderPrints();
      if (kpiOpenId) loadEmployeeKpi().catch(() => {});
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (/forbidden/i.test(msg) || /session expired/i.test(msg) || /unauthorized/i.test(msg)) {
        if (!silent) kickToGate('Collector session expired or replaced — enter the password again');
        return;
      }
      throw err;
    } finally {
      dashInFlight = false;
    }
  }

  async function addList(type, form) {
    const name = String(form.name.value || '').trim();
    if (!name) return;
    try {
      await api('/admin/lists', { method: 'POST', json: { type, name } });
      form.reset();
      toast(`${type === 'company' ? 'Company' : 'City'} added`);
      $('list-hint').textContent = `Added ${name}. Attendance and coordinator lists updated.`;
      await loadDash();
    } catch (err) {
      alert(err.message || 'Could not add');
    }
  }

  function setTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.panel-tab').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
    document.body.classList.toggle('vsnd-screen', tab === 'dash');
    if (tab === 'weights') loadWeights().catch((err) => { if ($('weight-error')) $('weight-error').textContent = err.message; });
    if (tab === 'schedule') loadSlaConfig().catch((err) => { if ($('sla-error')) $('sla-error').textContent = err.message; });
  }

  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('detail-back').addEventListener('click', (e) => { if (e.target === $('detail-back')) closeDrawer(); });
  const empMonthInp = $('emp-month');
  if (empMonthInp) {
    empMonthInp.addEventListener('change', (e) => {
      setDashMonth(e.target.value || '').catch((err) => alert(err.message));
    });
  }
  const slaMonthInp = $('sla-month');
  if (slaMonthInp) {
    slaMonthInp.addEventListener('change', (e) => {
      setDashMonth(e.target.value || '').catch((err) => alert(err.message));
    });
  }
  if ($('vsnd-prev')) {
    $('vsnd-prev').addEventListener('click', () => {
      setDashMonth(shiftMonth(empMonth || (slaDash && slaDash.month) || '', -1)).catch((err) => alert(err.message));
    });
  }
  if ($('vsnd-next')) {
    $('vsnd-next').addEventListener('click', () => {
      setDashMonth(shiftMonth(empMonth || (slaDash && slaDash.month) || '', 1)).catch((err) => alert(err.message));
    });
  }
  if ($('vsnd-refresh')) {
    $('vsnd-refresh').addEventListener('click', () => {
      loadDash().catch((err) => alert(err.message));
    });
  }
  if ($('ekpi-back')) $('ekpi-back').addEventListener('click', showEmpList);
  if ($('ekpi-emp')) {
    $('ekpi-emp').addEventListener('change', (e) => {
      if (e.target.value) openEmployeeKpi(e.target.value, { keepExpand: kpiExpanded }).catch((err) => alert(err.message));
    });
  }
  if ($('ekpi-month')) {
    $('ekpi-month').addEventListener('change', (e) => {
      empMonth = e.target.value || empMonth;
      if (kpiOpenId) loadEmployeeKpi().catch((err) => alert(err.message));
    });
  }
  if ($('ekpi-overall')) {
    $('ekpi-overall').addEventListener('click', () => {
      kpiExpanded = !kpiExpanded;
      if (!kpiExpanded) kpiDetailKey = '';
      renderEmployeeKpi();
    });
  }
  if ($('weight-save')) $('weight-save').addEventListener('click', () => saveWeights());
  if ($('sla-save')) $('sla-save').addEventListener('click', () => saveSlaConfig());
  if ($('sla-add-rule')) $('sla-add-rule').addEventListener('click', () => addSlaCondition());
  async function runExport(path, filename) {
    try {
      await downloadFile(path, filename);
      toast('Excel downloaded');
    } catch (err) {
      alert(err.message || 'Could not extract Excel');
    }
  }
  if ($('xls-live')) {
    $('xls-live').addEventListener('click', () => runExport('/export/live-sheet', 'DT-Live-Sheet.xlsx'));
  }
  if ($('xls-admin')) {
    $('xls-admin').addEventListener('click', () => {
      const month = ($('ekpi-month') && $('ekpi-month').value) || empMonth || '';
      const qs = month ? `?month=${encodeURIComponent(month)}` : '';
      runExport(`/export/admin${qs}`, 'DT-Admin.xlsx');
    });
  }
  async function uploadFullExcel(file) {
    const hint = $('xls-all-hint');
    if (!file) return;
    if (!confirm('Replace all Delivery Transformation data with this Excel? Live Sheet, attendance, prints, targets, SLA, and KPI settings will match the file.')) return;
    if (hint) hint.textContent = `Uploading ${file.name}…`;
    try {
      const res = await fetch(`${window.DTX.API}/import/full`, {
        method: 'POST',
        headers: {
          'X-Delivery-Transform-Token': getToken(),
          'X-Filename': encodeURIComponent(file.name),
          'Content-Type': 'application/octet-stream',
        },
        body: await file.arrayBuffer(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Upload failed');
      const c = data.counts || {};
      const msg = `Matched the file · ${c.Vehicles || 0} VINs · ${data.pending || 0} pending · ${c.Attendance || 0} attendance · ${c.Prints || 0} prints · ${c.Audit || 0} audit · ${c.Meta || 0} settings`;
      if (hint) hint.textContent = msg;
      toast('All data matched');
      if (typeof loadDash === 'function') loadDash().catch(() => {});
    } catch (err) {
      if (hint) hint.textContent = err.message || 'Upload failed';
      alert(err.message || 'Could not match the Excel');
    }
  }
  function pickFullExcel() {
    const input = $('xls-all-file');
    if (input) input.click();
  }
  if ($('xls-all')) $('xls-all').addEventListener('click', () => runExport('/export/full', 'DT-All-Data.xlsx'));
  if ($('xls-all-card')) $('xls-all-card').addEventListener('click', () => runExport('/export/full', 'DT-All-Data.xlsx'));
  if ($('xls-all-upload')) $('xls-all-upload').addEventListener('click', pickFullExcel);
  if ($('xls-all-pick')) $('xls-all-pick').addEventListener('click', pickFullExcel);
  if ($('xls-all-file')) {
    $('xls-all-file').addEventListener('change', () => {
      const file = $('xls-all-file').files && $('xls-all-file').files[0];
      $('xls-all-file').value = '';
      uploadFullExcel(file).catch((err) => alert(err.message || 'Could not match the Excel'));
    });
  }
  if ($('backup-save')) {
    $('backup-save').addEventListener('click', async () => {
      $('backup-hint').textContent = 'Saving…';
      try {
        backup = await api('/backup', { method: 'POST' });
        renderBackup();
        $('backup-hint').textContent = 'Snapshot saved.';
        toast('Snapshot saved');
      } catch (err) {
        $('backup-hint').textContent = err.message || 'Could not save';
      }
    });
  }
  if ($('backup-restore')) {
    $('backup-restore').addEventListener('click', async () => {
      const when = backup && backup.lastAt ? fmtWhen(backup.lastAt) : 'the last snapshot';
      if (!confirm(`Restore employee.html and coordinator.html from ${when}? Current live data will be replaced.`)) return;
      $('backup-hint').textContent = 'Restoring…';
      try {
        backup = await api('/backup/restore', { method: 'POST' });
        renderBackup();
        await loadDash();
        $('backup-hint').textContent = `Restored ${when}.`;
        toast('Last data restored');
      } catch (err) {
        $('backup-hint').textContent = err.message || 'Could not restore';
      }
    });
  }
  $('pdf-min').addEventListener('click', () => $('pdf-win').classList.toggle('is-min'));

  (function enablePdfWinDrag() {
    const win = $('pdf-win');
    const bar = win && win.querySelector('.pdf-win-bar');
    if (!win || !bar) return;
    const POS_KEY = 'dt_xform_pdf_win_pos';
    let drag = null;

    function clamp(left, top) {
      const pad = 8;
      const w = win.offsetWidth || 200;
      const h = win.offsetHeight || 40;
      const maxL = Math.max(pad, window.innerWidth - w - pad);
      const maxT = Math.max(pad, window.innerHeight - h - pad);
      return {
        left: Math.min(maxL, Math.max(pad, left)),
        top: Math.min(maxT, Math.max(pad, top)),
      };
    }

    function applyPos(left, top) {
      const p = clamp(left, top);
      win.style.left = `${p.left}px`;
      win.style.top = `${p.top}px`;
      win.style.right = 'auto';
      win.style.bottom = 'auto';
      return p;
    }

    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        applyPos(saved.left, saved.top);
      }
    } catch {
      /* ignore */
    }

    bar.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea')) return;
      const rect = win.getBoundingClientRect();
      drag = {
        id: e.pointerId,
        ox: e.clientX - rect.left,
        oy: e.clientY - rect.top,
      };
      win.classList.add('is-dragging');
      try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });

    bar.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      applyPos(e.clientX - drag.ox, e.clientY - drag.oy);
    });

    function endDrag(e) {
      if (!drag || (e.pointerId != null && drag.id !== e.pointerId)) return;
      const rect = win.getBoundingClientRect();
      const p = applyPos(rect.left, rect.top);
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
      win.classList.remove('is-dragging');
      drag = null;
    }

    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
  })();
  $('pdf-search').addEventListener('input', (e) => {
    pdfQuery = e.target.value || '';
    renderPrints();
  });
  $('pdf-extract-all').addEventListener('click', () => {
    extractPrints(filteredPrints().map((p) => p.id));
  });
  $('add-company-form').addEventListener('submit', (e) => { e.preventDefault(); addList('company', e.target); });
  $('add-city-form').addEventListener('submit', (e) => { e.preventDefault(); addList('city', e.target); });

  setInterval(tickClock, 1000);
  tickClock();
  loadDash().catch((e) => alert(e.message));
  dashTimer = setInterval(() => {
    if (document.hidden) return;
    loadDash({ silent: true }).catch(() => {});
  }, 2000);

  // ——— VIN tools (existing admin sheet) ———
  (async function vinTools() {
    const meta = await DTXLive.loadMeta();
    $('add-employee').innerHTML = '<option value="">— Unassigned —</option>'
      + (meta.employees || []).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');

    function bars(el, counts) {
      const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...entries.map((e) => e[1]));
      el.innerHTML = entries.map(([k, n]) => `
        <div style="display:grid;grid-template-columns:120px 1fr 32px;gap:8px;align-items:center;margin:4px 0;font-size:.8rem">
          <span>${esc(k)}</span>
          <span style="height:8px;border-radius:4px;background:#e6edf4;overflow:hidden">
            <span style="display:block;height:100%;width:${(n / max) * 100}%;background:#143a5c"></span>
          </span>
          <b>${n}</b>
        </div>`).join('') || '<span class="hint">—</span>';
    }

    async function loadAll() {
      const q = $('search').value.trim();
      const [live, audit] = await Promise.all([
        api(`/live-sheet${q ? `?q=${encodeURIComponent(q)}` : ''}`),
        api('/audit?limit=100'),
      ]);
      const rows = live.rows || [];
      const assigned = rows.filter((r) => r.ops.assignedEmployeeId).length;
      const withCarrier = rows.filter((r) => String(r.ops.carrier || '').trim()).length;
      $('kpis').innerHTML = [
        ['Total VINs', live.total],
        ['Assigned', assigned],
        ['Unassigned', rows.length - assigned],
        ['With الناقل', withCarrier],
      ].map(([l, n]) => `<div class="kpi"><strong>${n}</strong><span>${esc(l)}</span></div>`).join('');
      bars($('by-status'), live.byStatus);
      bars($('by-employee'), live.byEmployee);
      bars($('by-carrier'), live.byCarrier);
      $('live-meta').textContent = `${live.total} VINs · synced ${new Date(live.at).toLocaleTimeString()}`;
      DTXLive.renderTable($('live-table'), rows, {
        mode: 'admin',
        onOpen: (vin) => DTXLive.openDrawer(vin, { mode: 'admin', onSaved: loadAll }),
      });
      $('audit-table').innerHTML = `<thead><tr><th>Time</th><th>User</th><th>VIN</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
        <tbody>${(audit.rows || []).map((a) => `<tr>
          <td>${esc(String(a.at || '').replace('T', ' ').slice(0, 19))}</td>
          <td>${esc(a.user)}</td><td>${esc(a.vin)}</td><td>${esc(a.action)}</td>
          <td>${esc(a.oldValue)}</td><td>${esc(a.newValue)}</td></tr>`).join('')
          || '<tr><td colspan="6">No changes yet.</td></tr>'}</tbody>`;
    }

    $('add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api('/vehicles', { method: 'POST', json: body });
        e.target.reset();
        toast('VIN added');
        loadAll();
      } catch (err) {
        alert(err.message);
      }
    });
    let t;
    $('search').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(loadAll, 250);
    });
    $('refresh-btn').addEventListener('click', loadAll);
    loadAll().catch((e) => console.error(e));
  }());

  window.addEventListener('beforeunload', () => { if (dashTimer) clearInterval(dashTimer); });
  }
})();
