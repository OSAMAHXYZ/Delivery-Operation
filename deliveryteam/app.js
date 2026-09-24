/* global fetch */
(() => {
  const API = '/api/delivery-team';
  const TOKEN_KEY = 'delivery_team_token_v1';
  const USER_KEY = 'delivery_team_user_v1';

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: null,
    meta: null,
    view: 'dashboard',
    filters: { q: '', status: '', employee: '', month: '', page: 1, limit: 40 },
    selectedVins: new Set(),
    reassignVins: new Set(),
    reassignFrom: '',
    reassignRows: [],
    assignPool: [],
    assignDisplay: [],
    assignEmployee: '',
    editsTimer: null,
    liveTimer: null,
    liveFilters: { q: '', employee: '', status: '', month: '', carrier: '' },
    liveFingerprint: '',
    monthFilter: '',
    targetMonth: '',
    guestTickTimer: null,
    hubRaw: null,
    tzOffset: -new Date().getTimezoneOffset(),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function na(v) {
    const s = String(v ?? '').trim();
    return s && s !== 'N/A' ? s : 'N/A';
  }

  /** Customer name, owner (raw N), and phone — open to all roles. */
  function displayName(value) {
    const s = String(value == null ? '' : value).trim();
    return s || '—';
  }

  function displayPhone(value) {
    const s = String(value == null ? '' : value).trim();
    return s || '—';
  }

  function ynBadge(v) {
    const s = String(v || '').trim();
    if (s === 'Yes') return '<span class="badge ok">🟢 Yes</span>';
    if (s === 'No') return '<span class="badge bad">🔴 No</span>';
    return '<span class="badge">—</span>';
  }

  function statusRowClass(s) {
    const v = String(s || '').trim();
    if (v === 'Claimed') return 'row-status-claimed';
    if (v === 'PSFU') return 'row-status-psfu';
    if (v === 'تم التسليم') return 'row-status-delivered';
    if (v === 'جاهز للتسليم') return 'row-status-ready';
    if (v === 'صادرة' || v === 'صادر') return 'row-status-issued';
    if (v === 'مرور') return 'row-status-traffic';
    if (v === 'رجوع مرور') return 'row-status-traffic-return';
    if (v === 'معلقة') return 'row-status-pending';
    if (v === 'الغاء') return 'row-status-cancel';
    return '';
  }

  function statusBadge(s) {
    const v = String(s || '').trim();
    if (!v) return '<span class="badge">—</span>';
    if (v === 'Claimed') return `<span class="badge info">${esc(v)}</span>`;
    if (v === 'PSFU') return `<span class="badge ok">${esc(v)}</span>`;
    if (v === 'تم التسليم') return `<span class="badge yellow">${esc(v)}</span>`;
    if (v === 'جاهز للتسليم') return `<span class="badge orange">${esc(v)}</span>`;
    if (v === 'صادرة' || v === 'صادر') return `<span class="badge ok">${esc(v)}</span>`;
    if (v === 'مرور') return `<span class="badge gray">${esc(v)}</span>`;
    if (v === 'رجوع مرور') return `<span class="badge purple">${esc(v)}</span>`;
    if (v === 'معلقة') return `<span class="badge navy">${esc(v)}</span>`;
    if (v === 'الغاء') return `<span class="badge bad">${esc(v)}</span>`;
    return `<span class="badge warn">${esc(v)}</span>`;
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) headers['X-Delivery-Team-Token'] = state.token;
    if (opts.json) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (res.status === 401) {
      logout(true);
      throw new Error('Session expired');
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }
    if (!res.ok) throw new Error(res.statusText);
    return res;
  }

  function canManage() {
    return state.user && (state.user.role === 'admin' || state.user.role === 'hanouf');
  }

  function canSetTargets() {
    return !!(state.user && state.user.role === 'hanouf');
  }

  function achPctClass(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return '';
    const n = Number(pct);
    if (n >= 100) return 'ach-good';
    if (n >= 70) return 'ach-mid';
    return 'ach-low';
  }

  function formatAchPct(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return '—';
    return `${Number(pct)}%`;
  }

  /** Ruba / Rasha / Hanouf / Admin — inline edit on Live Sheet */
  function canEditLiveSheet() {
    if (!state.user) return false;
    if (canManage()) return true;
    const id = String(state.user.id || '').trim().toLowerCase();
    const name = String(state.user.name || '').trim().toLowerCase();
    return id === 'ruba' || id === 'rasha' || name === 'ruba' || name === 'rasha';
  }

  function isRuba() {
    return state.user && (state.user.id === 'ruba' || state.user.name === 'Ruba');
  }

  function canEditGuest(row) {
    if (!state.user || !row) return false;
    if (canManage()) return true;
    if (!isRuba()) return false;
    const id = (row.ops && row.ops.assignedEmployeeId) || '';
    const name = (row.ops && row.ops.assignedEmployeeName) || '';
    return id === 'ruba' || name === 'Ruba';
  }

  function formatGuestAt(iso) {
    if (!iso) return '—';
    const s = String(iso);
    const d = s.slice(0, 10);
    const t = s.slice(11, 16);
    return t ? `${d} ${t}` : d;
  }

  function formatCountdown(ms) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    if (ms <= 0) return 'DUE NOW';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function guestCenterValue(r) {
    const ops = (r && r.ops) || {};
    const raw = String(ops.guestCenter || '').trim().toLowerCase();
    if (raw === 'yes' || raw === 'y') return 'Yes';
    if (raw === 'no' || raw === 'n') return 'No';
    if (r && r.guestCenter) return 'Yes';
    return '';
  }

  /** Guest Exp = simple Yes / No list (no modal button). */
  function guestCellHtml(r, { editable = false } = {}) {
    const val = guestCenterValue(r);
    const canEdit = editable || canEditGuest(r) || canEditLiveSheet();
    if (!canEdit) {
      if (val === 'Yes') return '<span class="guest-badge">Yes</span>';
      if (val === 'No') return '<span class="badge">No</span>';
      return '<span class="hint">—</span>';
    }
    return editableControl(r.vin, 'guestCenter', 'yn', val);
  }

  function bindGuestButtons(root = document) {
    $$('[data-guest-act]', root).forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGuestModal(b.dataset.vin, b.dataset.guestAct).catch((err) => alert(err.message));
      });
    });
  }

  function tickGuestTimers() {
    $$('[data-guest-timer]').forEach((el) => {
      const at = el.getAttribute('data-guest-timer');
      if (!at) return;
      const ms = new Date(at).getTime() - Date.now();
      el.textContent = formatCountdown(ms);
      el.classList.toggle('is-due', ms <= 0);
      if (ms <= 0 && state.view === 'my') {
        // soft refresh once due so Collected? buttons appear
        if (!el.dataset.refreshed) {
          el.dataset.refreshed = '1';
          loadMy().catch(() => {});
        }
      }
    });
  }

  async function openGuestModal(vin, action) {
    const data = await api(`/vehicles/${encodeURIComponent(vin)}`);
    const v = data.vehicle;
    const back = $('#guest-modal-back');
    const body = $('#guest-modal-body');
    const title = $('#guest-modal-title');
    const sub = $('#guest-modal-sub');
    const statuses = (state.meta && state.meta.statuses) || [];
    const existing = v.ops.guestCollectAt || '';
    const dateVal = existing.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const timeVal = existing.slice(11, 16) || '16:00';

    function close() {
      back.classList.remove('open');
    }
    $('#guest-modal-close').onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };

    if (action === 'collected-yes') {
      title.textContent = 'Guest collected?';
      sub.textContent = `${v.vin} · ${displayName(v.raw.userName)} · choose status after collection`;
      body.innerHTML = `
        <p class="hint">Appointment was <b>${esc(formatGuestAt(existing))}</b>. Confirm the car was collected, then set status.</p>
        <div class="field">
          <label>New status</label>
          <select id="guest-status">
            <option value="">— keep current (${esc(v.ops.opsStatus || 'none')}) —</option>
            ${statuses.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
        </div>
        <div class="guest-modal-actions">
          <button type="button" class="btn-primary" id="guest-save-yes">Yes — collected</button>
          <button type="button" class="btn" id="guest-cancel">Cancel</button>
        </div>`;
      $('#guest-cancel').onclick = close;
      $('#guest-save-yes').onclick = async () => {
        const status = $('#guest-status').value;
        await api(`/vehicles/${encodeURIComponent(vin)}/guest-collect`, {
          method: 'POST',
          json: { collected: true, status: status || undefined },
        });
        close();
        await refreshView();
      };
      back.classList.add('open');
      return;
    }

    if (action === 'collected-no') {
      title.textContent = 'Not collected — new time';
      sub.textContent = `${v.vin} · set another date & time for the customer`;
      body.innerHTML = `
        <div class="field"><label>New date</label><input type="date" id="guest-date" value="${esc(dateVal)}" /></div>
        <div class="field"><label>New time</label><input type="time" id="guest-time" value="${esc(timeVal)}" /></div>
        <div class="field"><label>Note (optional)</label><input type="text" id="guest-note" placeholder="Customer delayed…" /></div>
        <div class="guest-modal-actions">
          <button type="button" class="btn-primary" id="guest-save-no">Save new appointment</button>
          <button type="button" class="btn" id="guest-cancel">Cancel</button>
        </div>`;
      $('#guest-cancel').onclick = close;
      $('#guest-save-no').onclick = async () => {
        await api(`/vehicles/${encodeURIComponent(vin)}/guest-collect`, {
          method: 'POST',
          json: {
            collected: false,
            date: $('#guest-date').value,
            time: $('#guest-time').value,
            note: $('#guest-note').value,
          },
        });
        close();
        await refreshView();
      };
      back.classList.add('open');
      return;
    }

    // mark / schedule / reschedule
    title.textContent = action === 'mark' ? 'Mark Guest Experience' : 'Guest Exp · Schedule pickup';
    sub.textContent = `${v.vin} · ${displayName(v.raw.userName)} · ${na(v.raw.product)}`;
    body.innerHTML = `
      <p class="hint">Set the date and time for the customer to collect this VIN at Guest Experience.</p>
      <div class="field"><label>Collection date</label><input type="date" id="guest-date" value="${esc(dateVal)}" required /></div>
      <div class="field"><label>Collection time</label><input type="time" id="guest-time" value="${esc(timeVal)}" required /></div>
      <div class="field"><label>Note (optional)</label><input type="text" id="guest-note" value="${esc(v.ops.guestCollectNote || '')}" placeholder="Customer name / contact…" /></div>
      <div class="guest-modal-actions">
        <button type="button" class="btn-primary" id="guest-save-sched">Save appointment</button>
        <button type="button" class="btn" id="guest-cancel">Cancel</button>
      </div>`;
    $('#guest-cancel').onclick = close;
    $('#guest-save-sched').onclick = async () => {
      await api(`/vehicles/${encodeURIComponent(vin)}/guest-schedule`, {
        method: 'POST',
        json: {
          date: $('#guest-date').value,
          time: $('#guest-time').value,
          note: $('#guest-note').value,
        },
      });
      close();
      await refreshView();
    };
    back.classList.add('open');
  }

  function assignableNames() {
    const fromMeta = state.meta && state.meta.assignable;
    if (Array.isArray(fromMeta) && fromMeta.length) return fromMeta.slice();
    return ['Hanouf', 'Rasha', 'Ruba', 'Ibrahim', 'Abdullah'];
  }

  function currentMonthValue() {
    const d = new Date(Date.now() + state.tzOffset * 60000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function canUploadSalesRaw() {
    return canManage() || isRuba();
  }

  function formatRawUpdatedAt(iso) {
    if (!iso) return 'Not uploaded yet';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return String(iso);
    }
  }

  function renderRawStatus(raw) {
    const status = raw || state.hubRaw || null;
    state.hubRaw = status;
    const pill = $('#raw-status-pill');
    const timeEl = $('#raw-status-time');
    if (timeEl) {
      if (!status || !status.uploadedAt) {
        timeEl.textContent = 'Not uploaded yet';
        if (pill) {
          pill.classList.add('is-empty');
          pill.classList.remove('is-fresh');
        }
      } else {
        const by = status.uploadedByName ? ` · ${status.uploadedByName}` : '';
        timeEl.textContent = `${formatRawUpdatedAt(status.uploadedAt)}${by}`;
        if (pill) {
          pill.classList.remove('is-empty');
          pill.classList.add('is-fresh');
          pill.title = [
            status.filename || 'Sales Raw',
            status.sheetName ? `Sheet: ${status.sheetName}` : '',
            status.vehicleCount != null ? `${status.vehicleCount} vehicles` : '',
          ].filter(Boolean).join('\n');
        }
      }
    }
    const detail = $('#sales-raw-status-detail');
    if (detail) {
      if (!status || !status.uploadedAt) {
        detail.textContent = 'Not uploaded yet — Hanouf or Ruba can upload Sales Raw here';
      } else {
        const parts = [
          formatRawUpdatedAt(status.uploadedAt),
          status.uploadedByName ? `by ${status.uploadedByName}` : '',
          status.filename || '',
          status.vehicleCount != null ? `${status.vehicleCount} vehicles` : '',
        ].filter(Boolean);
        detail.textContent = parts.join(' · ');
      }
    }
  }

  function navItems() {
    const items = [
      { id: 'dashboard', label: 'Dashboard', roles: ['admin', 'hanouf', 'employee'] },
      { id: 'live', label: 'Live Sheet', roles: ['admin', 'hanouf', 'employee'] },
      { id: 'today', label: "This month's VINs", roles: ['admin', 'hanouf', 'employee'] },
      { id: 'my', label: 'My VINs', roles: ['employee', 'admin', 'hanouf'] },
      { id: 'assign', label: 'Assignment', roles: ['admin', 'hanouf'] },
      { id: 'all', label: 'All Vehicles', roles: ['admin', 'hanouf'] },
      { id: 'sales-raw', label: 'Sales Raw', roles: ['admin', 'hanouf', 'employee'], salesRawOnly: true },
      { id: 'upload', label: 'Upload Delivery sheet', roles: ['admin', 'hanouf'] },
      { id: 'audit', label: 'Audit Log', roles: ['admin', 'hanouf'] },
    ];
    return items.filter((i) => {
      if (!i.roles.includes(state.user.role)) return false;
      if (i.salesRawOnly) return canUploadSalesRaw();
      return true;
    });
  }

  function renderNav() {
    const nav = $('#side-nav');
    nav.innerHTML = `<p class="sec">Menu</p>` + navItems().map((i) =>
      `<button type="button" data-view="${i.id}" class="${state.view === i.id ? 'active' : ''}">${esc(i.label)}</button>`
    ).join('');
    $$('#side-nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#side-name').textContent = state.user.name;
    $('#side-role').textContent = state.user.role;
    $('#export-btn').hidden = !canManage();
  }

  function setView(view) {
    state.view = view;
    if (state.editsTimer) {
      clearInterval(state.editsTimer);
      state.editsTimer = null;
    }
    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = null;
    }
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${view}`));
    renderNav();
    const titles = {
      dashboard: ['Dashboard', 'Delivery Control Tower'],
      live: ['Live Sheet', 'All teammates’ schedules · Sales Type (cash / bank)'],
      today: ["This month's VINs", 'Archive proformas (Col P) · this month'],
      my: ['My VINs', 'Your schedule · edit your work · الناقل'],
      assign: ['Assignment', 'This month unique Col P · assign employee · الناقل'],
      all: ['All Vehicles', 'Full fleet · filters · export'],
      upload: ['Upload Delivery sheet', 'E sales layout · status · الناقل · مدينة الترحيل'],
      'sales-raw': ['Sales Raw', 'Hanouf / Ruba · shared inventory · everyone sees the update time'],
      audit: ['Audit Log', 'Full history of every edit'],
    };
    const t = titles[view] || ['Delivery Team', ''];
    $('#page-title').textContent = t[0];
    $('#page-sub').textContent = t[1];
    refreshView();
    if (view === 'dashboard' && canManage()) {
      state.editsTimer = setInterval(() => {
        loadDashboard().catch(() => {});
      }, 8000);
    }
    if (view === 'live') {
      state.liveTimer = setInterval(() => {
        loadLiveSheet({ silent: true }).catch(() => {});
      }, 5000);
    }
    if (!state.guestTickTimer) {
      state.guestTickTimer = setInterval(() => tickGuestTimers(), 1000);
    }
  }

  async function refreshView() {
    try {
      if (state.view === 'dashboard') await loadDashboard();
      if (state.view === 'live') await loadLiveSheet();
      if (state.view === 'today') await loadToday();
      if (state.view === 'my') await loadMy();
      if (state.view === 'assign') await loadAssign();
      if (state.view === 'all') await loadAll();
      if (state.view === 'sales-raw') await loadSalesRawPanel();
      if (state.view === 'audit') await loadAudit();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to load');
    }
  }

  async function loadLiveSheet({ silent = false } = {}) {
    const f = state.liveFilters;
    if (!f.month) f.month = currentMonthValue();
    const params = new URLSearchParams();
    params.set('tzOffset', String(state.tzOffset));
    params.set('sort', 'status');
    params.set('dir', 'asc');
    if (f.q) params.set('q', f.q);
    if (f.employee) params.set('employee', f.employee);
    if (f.status) params.set('status', f.status);
    if (f.carrier) params.set('carrier', f.carrier);
    params.set('month', f.month);
    const data = await api(`/live-sheet?${params}`);
    if (data.hubRaw) renderRawStatus(data.hubRaw);
    const rows = data.rows || [];
    const fingerprint = JSON.stringify(rows.map((r) => [
      r.vin,
      r.ops.opsStatus,
      r.ops.assignedEmployeeName,
      r.ops.carrier,
      r.ops.updatedAt,
      r.ops.notes,
      r.ops.guestSentDate,
      r.ops.signatureReceivedDate,
      r.ops.accountsSentDate,
      r.ops.accountsApprovalDate,
      r.ops.vin1502,
      r.ops.trafficFile,
      r.ops.trafficFeesOps,
      r.ops.insuranceOps,
      r.ops.registrationIssueDate,
      r.ops.transferCity,
      r.ops.guestCollectAt,
      r.ops.guestCollected,
      r.ops.guestCenter,
    ]));
    const changed = fingerprint !== state.liveFingerprint;
    state.liveFingerprint = fingerprint;

    const empSel = $('#live-employee');
    if (empSel && !empSel.dataset.filled) {
      empSel.innerHTML = `<option value="">All employees</option>${assignableNames().map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`
      ).join('')}`;
      empSel.value = f.employee || '';
      empSel.dataset.filled = '1';
    }

    const monthInp = $('#live-month');
    if (monthInp && monthInp.value !== (f.month || '')) {
      monthInp.value = f.month || '';
    }

    const statusSel = $('#live-status');
    if (statusSel && !statusSel.dataset.filled) {
      const statuses = (state.meta && state.meta.statuses) || [];
      statusSel.innerHTML = `<option value="">All statuses</option>${statuses.map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`
      ).join('')}`;
      statusSel.value = f.status || '';
      statusSel.dataset.filled = '1';
    }

    const carrierSel = $('#live-carrier');
    if (carrierSel) {
      const byCar = data.byCarrier || {};
      const carrierNames = Object.keys(byCar)
        .filter((k) => k && k !== '(empty)')
        .sort((a, b) => a.localeCompare(b, 'ar'));
      const metaCarriers = (state.meta && state.meta.carriers) || [];
      const allCarriers = [...new Set([...metaCarriers, ...carrierNames])];
      const prev = f.carrier || '';
      carrierSel.innerHTML = `<option value="">All الناقل</option>
        <option value="__empty__"${prev === '__empty__' ? ' selected' : ''}>بدون ناقل (فارغ)</option>
        ${allCarriers.map((c) =>
          `<option value="${esc(c)}"${prev === c ? ' selected' : ''}>${esc(c)}${byCar[c] != null ? ` (${byCar[c]})` : ''}</option>`
        ).join('')}`;
    }

    const chips = $('#live-chips');
    if (chips) {
      const byEmp = data.byEmployee || {};
      const bySt = data.byStatus || {};
      const byCar = data.byCarrier || {};
      chips.innerHTML = [
        `<span class="live-chip"><b>${data.total || 0}</b> assigned</span>`,
        ...Object.keys(byEmp).map((k) => `<button type="button" class="live-chip emp-filter ${f.employee === k ? 'active' : ''}" data-emp="${esc(k)}">${esc(k)} <b>${byEmp[k]}</b></button>`),
        ...Object.entries(byCar).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) =>
          `<button type="button" class="live-chip carrier-filter ${f.carrier === (k === '(empty)' ? '__empty__' : k) ? 'active' : ''}" data-carrier="${esc(k === '(empty)' ? '__empty__' : k)}">${esc(k === '(empty)' ? 'بدون ناقل' : k)} <b>${n}</b></button>`
        ),
        ...Object.entries(data.bySalesType || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) =>
          `<span class="live-chip">${esc(k)} <b>${n}</b></span>`
        ),
        ...Object.keys(bySt).filter((k) => k !== '(blank)').slice(0, 8).map((k) =>
          `<button type="button" class="live-chip status-filter ${f.status === k ? 'active' : ''}" data-status="${esc(k)}">${esc(k)} <b>${bySt[k]}</b></button>`
        ),
      ].join('');
      $$('.live-chip.status-filter', chips).forEach((b) => b.addEventListener('click', () => {
        state.liveFilters.status = state.liveFilters.status === b.dataset.status ? '' : b.dataset.status;
        if ($('#live-status')) $('#live-status').value = state.liveFilters.status;
        loadLiveSheet().catch((e) => alert(e.message));
      }));
      $$('.live-chip.emp-filter', chips).forEach((b) => b.addEventListener('click', () => {
        state.liveFilters.employee = state.liveFilters.employee === b.dataset.emp ? '' : b.dataset.emp;
        if ($('#live-employee')) $('#live-employee').value = state.liveFilters.employee;
        loadLiveSheet().catch((e) => alert(e.message));
      }));
      $$('.live-chip.carrier-filter', chips).forEach((b) => b.addEventListener('click', () => {
        state.liveFilters.carrier = state.liveFilters.carrier === b.dataset.carrier ? '' : b.dataset.carrier;
        if ($('#live-carrier')) $('#live-carrier').value = state.liveFilters.carrier;
        loadLiveSheet().catch((e) => alert(e.message));
      }));
    }

    const meta = $('#live-meta-text');
    const dot = $('#live-dot');
    if (meta) {
      const t = new Date(data.at || Date.now()).toLocaleTimeString();
      const monthNote = f.month ? ` · ${f.month}` : ' · all months';
      const editNote = canEditLiveSheet() ? ' · editable' : '';
      meta.textContent = `${data.total || 0} assigned VINs${monthNote}${editNote} · live · last sync ${t}${changed && silent ? ' · updated' : ''}`;
    }
    if (dot) {
      dot.classList.toggle('pulse', !!changed || !silent);
      setTimeout(() => dot && dot.classList.remove('pulse'), 900);
    }

    if (!changed && silent) return;

    const table = $('#live-table');
    const active = document.activeElement;
    const editingLive = !!(
      silent
      && active
      && table
      && active.classList
      && active.classList.contains('cell-edit')
      && table.contains(active)
    );
    if (editingLive) return;

    const liveEditable = canEditLiveSheet();
    const editHint = $('#live-edit-hint');
    if (editHint) editHint.hidden = !liveEditable;
    if (liveEditable) {
      fillCarrierLists();
      const cities = (state.meta && state.meta.transferCities) || [];
      const cityList = $('#edit-city-list');
      if (cityList) cityList.innerHTML = cities.map((c) => `<option value="${esc(c)}"></option>`).join('');
    }

    const opsCell = (r, field, type, value) => (
      liveEditable
        ? editableControl(r.vin, field, type, value)
        : (type === 'status'
          ? statusBadge(value)
          : (type === 'yn' ? ynBadge(value) : na(value)))
    );

    const cols = [
      { key: 'num', label: '#', html: (_r, i) => i + 1 },
      { key: 'employee', label: 'Employee', html: (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>` },
      { key: 'status', label: 'Status', html: (r) => (
        liveEditable
          ? editableControl(r.vin, 'opsStatus', 'status', r.ops.opsStatus)
          : `<span class="cell-status">${statusBadge(r.ops.opsStatus)}</span>`
      ) },
      { key: 'vin', label: 'VIN', html: (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>` },
      { key: 'proforma', label: 'Proforma', html: (r) => na(r.raw.proformaDate) },
      { key: 'order', label: 'Order', html: (r) => na(r.raw.salesOrder) },
      { key: 'product', label: 'Product', html: (r) => na(r.raw.product) },
      { key: 'salestype', label: 'Sales Type', html: (r) => na(r.raw.salesType) },
      { key: 'customer', label: 'Customer', html: (r) => displayName(r.raw.userName) },
      { key: 'owner', label: 'Owner', html: (r) => displayName(r.raw.invoiceOwner) },
      { key: 'sa', label: 'S/A', html: (r) => na(r.raw.salesAdvisor) },
      { key: 'phone', label: 'Phone', html: (r) => displayPhone(r.raw.phone) },
      { key: 'guest', label: 'Guest Exp', html: (r) => guestCellHtml(r, { editable: liveEditable }) },
      { key: 'gt', label: 'GT Loc', html: (r) => na(r.raw.gtLocation) },
      { key: 'veh', label: 'Veh Loc', html: (r) => na(r.raw.vehicleLocation) },
      { key: 'guestsent', label: 'إرسال الضيف', html: (r) => opsCell(r, 'guestSentDate', 'date', r.ops.guestSentDate) },
      { key: 'sig', label: 'استلام التواقيع', html: (r) => opsCell(r, 'signatureReceivedDate', 'date', r.ops.signatureReceivedDate) },
      { key: 'accsent', label: 'إرسال للحسابات', html: (r) => opsCell(r, 'accountsSentDate', 'date', r.ops.accountsSentDate) },
      { key: 'accok', label: 'موافقة الحسابات', html: (r) => opsCell(r, 'accountsApprovalDate', 'date', r.ops.accountsApprovalDate) },
      { key: 'vin1502', label: 'VIN 1502', html: (r) => opsCell(r, 'vin1502', 'yn', r.ops.vin1502) },
      { key: 'traffic', label: 'ملف المرور', html: (r) => opsCell(r, 'trafficFile', 'yn', r.ops.trafficFile) },
      { key: 'fees', label: 'Traffic Fees', html: (r) => opsCell(r, 'trafficFeesOps', 'yn', r.ops.trafficFeesOps) },
      { key: 'ins', label: 'Insurance', html: (r) => opsCell(r, 'insuranceOps', 'yn', r.ops.insuranceOps) },
      { key: 'reg', label: 'إصدار الاستمارة', html: (r) => opsCell(r, 'registrationIssueDate', 'date', r.ops.registrationIssueDate) },
      { key: 'city', label: 'مدينة الترحيل', html: (r) => opsCell(r, 'transferCity', 'city', r.ops.transferCity) },
      { key: 'carrier', label: 'الناقل', html: (r) => opsCell(r, 'carrier', 'carrier', r.ops.carrier) },
      { key: 'notes', label: 'ملاحظات', html: (r) => (
        liveEditable
          ? editableControl(r.vin, 'notes', 'notes', r.ops.notes)
          : esc(r.ops.notes || '')
      ) },
      { key: 'updated', label: 'Updated', html: (r) => esc((r.ops.updatedAt || '').replace('T', ' ').slice(0, 19) || '—') },
      { key: 'by', label: 'By', html: (r) => na(r.ops.updatedBy) },
    ];

    table.innerHTML = `<thead><tr>${cols.map((c) => `<th class="col-${c.key}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => {
        const statusCls = statusRowClass(r.ops.opsStatus);
        const guestCls = guestCenterValue(r) === 'Yes' ? 'row-guest-exp' : '';
        return `<tr class="${statusCls} ${guestCls}" data-vin="${esc(r.vin)}">${cols.map((c) =>
          `<td class="col-${c.key}">${c.html(r, i)}</td>`
        ).join('')}</tr>`;
      }).join('') || `<tr><td colspan="${cols.length}">No assigned VINs yet. Use Assignment to assign vehicles.</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindGuestButtons(table);
    if (liveEditable) bindEditableCells(table);
  }

  function openXferVinsModal(title, subtitle, vins) {
    const back = $('#xfer-vins-back');
    const list = Array.isArray(vins) ? vins.filter(Boolean) : [];
    $('#xfer-vins-title').textContent = title || 'VIN list';
    $('#xfer-vins-sub').textContent = subtitle || `${list.length} VIN(s)`;
    $('#xfer-vins-list').textContent = list.length ? list.join('\n') : '— لا توجد شاسيه —';
    back.classList.add('open');
    const close = () => back.classList.remove('open');
    $('#xfer-vins-close').onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };
  }

  function formatChangeAt(iso) {
    const s = String(iso || '').trim();
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 16).replace('T', ' ');
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function renderCarrierMoves(d) {
    const left = Array.isArray(d.carrierLeft) ? d.carrierLeft : [];
    const feed = Array.isArray(d.carrierChanges) ? d.carrierChanges : [];
    const leftChart = $('#dash-carrier-left-chart');
    const feedHost = $('#dash-carrier-change-feed');

    if (leftChart) {
      renderNamedBarChart(leftChart, left, {
        fillClass: 'is-carrier-left',
        empty: 'لا توجد نقلات ناقل بعد — عند تغيير الناقل تظهر هنا',
        onClick: (name) => {
          const row = left.find((r) => r.name === name);
          const vins = (row && row.vins) || [];
          const lines = vins.map((v) =>
            `${v.vin}  ·  ${name} → ${v.to || '—'}  ·  ${formatChangeAt(v.at)}${v.user ? `  ·  ${v.user}` : ''}`
          );
          openXferVinsModal(
            `غادرت من: ${name}`,
            `${vins.length} VIN(s) نُقلت إلى ناقل آخر`,
            lines.length ? lines : [`${(row && row.count) || 0} تغيير`]
          );
        },
      });
    }

    if (feedHost) {
      const moves = feed.filter((c) => c && c.from);
      if (!moves.length) {
        feedHost.innerHTML = '<p class="hint">لا سجل تغييرات ناقل بعد</p>';
      } else {
        feedHost.innerHTML = `<ul class="carrier-change-list">${moves.map((c) => `
          <li class="carrier-change-item">
            <button type="button" class="vin-link carrier-change-vin" data-vin="${esc(c.vin)}">${esc(c.vin)}</button>
            <span class="carrier-change-path">
              <span class="carrier-from">${esc(c.from)}</span>
              <span class="carrier-arrow" aria-hidden="true">→</span>
              <span class="carrier-to">${esc(c.to || '(empty)')}</span>
            </span>
            <span class="carrier-change-meta">${esc(formatChangeAt(c.at))}${c.user ? ` · ${esc(c.user)}` : ''}</span>
          </li>`).join('')}</ul>`;
        $$('.carrier-change-vin', feedHost).forEach((btn) => {
          btn.addEventListener('click', () => {
            const vin = btn.dataset.vin;
            if (vin) openVin(vin);
          });
        });
      }
    }
  }

  function renderXferDashboard(d) {
    const card = $('#dash-xfer-card');
    if (!card) return;
    if (!canManage()) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const ht = d.hubTransfer || {};
    const carriers = (ht.byCarrier && ht.byCarrier.length)
      ? ht.byCarrier
      : (d.byCarrier || []);
    const cities = ht.byCity || [];
    const changes = ht.companyChanges || [];
    const carrierLeft = Array.isArray(d.carrierLeft) ? d.carrierLeft : [];
    const carrierLeftTotal = Number(d.totals && d.totals.carrierMoveTotal) ||
      carrierLeft.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const t = d.totals || {};

    $('#dash-xfer-kpis').innerHTML = [
      ['الناقل معيّن', t.carriersAssigned || carriers.reduce((s, r) => s + (r.count || 0), 0), 'ok', 'carriers'],
      ['أنواع الناقل', t.carrierKinds || carriers.length, 'info', 'carriers'],
      ['عدد المدن', t.cityCount || cities.length, 'info', 'cities'],
      ['تحويلات المدن', t.cityTotal || cities.reduce((s, r) => s + (r.count || 0), 0), '', 'cities'],
      ['تغيير الشركة', t.companyChangeTotal || changes.length, changes.length ? 'warn' : 'ok', 'company-changes'],
      ['تغيير الناقل', carrierLeftTotal, carrierLeftTotal ? 'warn' : 'ok', 'carrier-moves'],
      ['شركة→مدينة', (ht.companyByCity || []).length, 'info', 'company-city'],
    ].map(([l, v, cls, kind]) =>
      `<button type="button" class="kpi kpi-btn ${cls}" data-xfer-kind="${kind}">
        <div class="lbl">${esc(l)}</div>
        <div class="val">${esc(v)}</div>
      </button>`
    ).join('');

    $$('#dash-xfer-kpis .kpi-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.xferKind;
        if (kind === 'company-changes') {
          const lines = changes.map((c) =>
            `${c.vin}  ·  ${c.from || '—'} → ${c.to || '—'}`
          );
          openXferVinsModal(
            'تغيير الشركة · Company changed',
            `${changes.length} VIN(s) أُعيد تعيينها من شركة إلى أخرى`,
            lines.length ? lines : changes.map((c) => c.vin)
          );
          return;
        }
        if (kind === 'carrier-moves') {
          const host = $('#dash-carrier-moves-wrap');
          if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const feed = Array.isArray(d.carrierChanges) ? d.carrierChanges.filter((c) => c.from) : [];
          const lines = feed.map((c) =>
            `${c.vin}  ·  ${c.from} → ${c.to || '—'}  ·  ${formatChangeAt(c.at)}`
          );
          openXferVinsModal(
            'تغيير الناقل · من → إلى',
            `${carrierLeftTotal} نقلات من ناقل إلى آخر`,
            lines.length ? lines : ['لا تغييرات بعد']
          );
          return;
        }
        if (kind === 'carriers') {
          const all = [];
          const vinMap = ht.carrierVins || {};
          carriers.forEach((r) => {
            const vins = vinMap[r.name] || [];
            vins.forEach((vin) => all.push(`${vin}  ·  ${r.name}`));
          });
          openXferVinsModal('الناقل · جميع الشاسيه', `${all.length} VIN(s)`, all);
          return;
        }
        if (kind === 'cities') {
          const all = [];
          const vinMap = ht.cityVins || {};
          cities.forEach((r) => {
            const vins = vinMap[r.name] || [];
            vins.forEach((vin) => all.push(`${vin}  ·  ${r.name}`));
          });
          openXferVinsModal('المدن / الفروع · جميع الشاسيه', `${all.length} VIN(s)`, all);
          return;
        }
        if (kind === 'company-city') {
          const host = $('#dash-company-city-wrap');
          if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    const carrierGrid = $('#dash-carrier-grid');
    if (carrierGrid) {
      const vinMap = ht.carrierVins || {};
      renderNamedBarChart(carrierGrid, carriers, {
        fillClass: 'is-carrier',
        empty: 'لا يوجد ناقل معيّن بعد',
        onClick: (name, count) => {
          const vins = vinMap[name] || [];
          openXferVinsModal(`الناقل: ${name}`, `${vins.length || count} VIN(s)`, vins);
          if (!vins.length) {
            state.liveFilters.carrier = name;
            state.liveFilters.month = state.monthFilter || '';
            if ($('#live-carrier')) {
              $('#live-carrier').value = name;
              $('#live-carrier').dataset.filled = '1';
            }
            setView('live');
          }
        },
      });
    }

    const cityGrid = $('#dash-city-grid');
    if (cityGrid) {
      const vinMap = ht.cityVins || {};
      renderNamedBarChart(cityGrid, cities, {
        fillClass: 'is-city',
        empty: 'لا توجد مدن من المسودات بعد — اطبع مذكرة أولاً',
        onClick: (name, count) => {
          const vins = vinMap[name] || [];
          openXferVinsModal(`المدينة: ${name}`, `${vins.length || count} VIN(s)`, vins);
        },
      });
    }

    renderCompanyCityChart(ht.companyByCity || []);
    renderCarrierMoves(d);
  }

  /** Horizontal bar chart for { name, count } rows (الناقل / المدن). */
  function renderNamedBarChart(host, rows, { fillClass = '', empty = '—', onClick } = {}) {
    if (!host) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      host.innerHTML = `<p class="hint">${esc(empty)}</p>`;
      return;
    }
    const max = Math.max(1, ...list.map((r) => Number(r.count) || 0));
    host.innerHTML = list.map((r, i) => {
      const count = Number(r.count) || 0;
      const pct = Math.max(4, Math.round((count / max) * 100));
      return `<button type="button" class="bar-chart-row" data-i="${i}" title="${esc(r.name)} · ${count}">
        <span class="bar-chart-label">${esc(r.name)}</span>
        <span class="bar-chart-track"><span class="bar-chart-fill ${esc(fillClass)}" style="width:${pct}%"></span></span>
        <span class="bar-chart-count">${esc(count)}</span>
      </button>`;
    }).join('');
    $$('.bar-chart-row', host).forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = list[Number(btn.dataset.i)];
        if (!row || typeof onClick !== 'function') return;
        onClick(row.name, Number(row.count) || 0);
      });
    });
  }

  function renderCompanyCityChart(rows) {
    const host = $('#dash-company-city');
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = '<p class="hint">لا توجد بيانات شركة→مدينة بعد — اطبع مذكرة ترحيل أولاً</p>';
      return;
    }
    const maxCity = Math.max(
      1,
      ...rows.flatMap((r) => (r.cities || []).map((c) => c.count || 0))
    );
    host.innerHTML = rows.map((row, ri) => {
      const cities = row.cities || [];
      const bars = cities.map((c, ci) => {
        const pct = Math.max(4, Math.round(((c.count || 0) / maxCity) * 100));
        return `<button type="button" class="company-city-bar" data-ci="${ri}" data-city-i="${ci}">
          <span class="company-city-label" title="${esc(c.city)}">${esc(c.city)}</span>
          <span class="company-city-track"><span class="company-city-fill" style="width:${pct}%"></span></span>
          <span class="company-city-count">${esc(c.count)}</span>
        </button>`;
      }).join('');
      return `<article class="company-city-row" data-ci="${ri}">
        <div class="company-city-head">
          <div class="company-city-name">${esc(row.company)}</div>
          <div class="company-city-total">${esc(row.total)} سيارة</div>
        </div>
        <div class="company-city-bars">${bars || '<p class="hint">لا مدن</p>'}</div>
      </article>`;
    }).join('');

    $$('#dash-company-city .company-city-bar').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ri = Number(btn.dataset.ci);
        const ci = Number(btn.dataset.cityI);
        const row = rows[ri];
        if (!row) return;
        const cityRow = (row.cities || [])[ci];
        if (!cityRow) return;
        const vins = (row.cityVins && row.cityVins[cityRow.city]) || [];
        openXferVinsModal(
          `${row.company} → ${cityRow.city}`,
          `${vins.length || cityRow.count} VIN(s)`,
          vins.length ? vins : [`${cityRow.count} سيارة (لا قائمة شاسيه)`]
        );
      });
    });
  }

  async function loadDashboard() {
    if (!state.monthFilter) state.monthFilter = currentMonthValue();
    const month = state.monthFilter;
    state.filters.month = month;
    const d = await api(`/dashboard?tzOffset=${state.tzOffset}&month=${encodeURIComponent(month)}`);
    if (d.hubRaw) renderRawStatus(d.hubRaw);
    if (d.targetMonth) state.targetMonth = d.targetMonth;
    const monthInp = $('#dash-month');
    if (monthInp && monthInp.value !== month) monthInp.value = month;
    const hint = $('#dash-month-hint');
    if (hint) hint.textContent = `Proforma month ${month} · other months ignored`;

    const t = d.totals || {};
    const kpis = canManage()
      ? [
        ['Total vehicles', t.total, ''],
        ['VINs assigned', t.assigned, 'ok'],
        ['Unassigned', t.unassigned, t.unassigned ? 'warn' : 'ok'],
        ["Today's proformas", t.todaysProformas, 'info'],
        ['Claimed', t.claimed, 'ok'],
        ['PSFU', t.psfu, 'info'],
        ['Ready for delivery', t.ready, 'info'],
        ['Delivered', t.delivered, 'ok'],
      ]
      : [
        ['Assigned to me', d.myWorkload?.assigned || 0, ''],
        ['Completed (Claimed)', d.myWorkload?.completed || 0, 'ok'],
        ['Remaining', d.myWorkload?.remaining || 0, 'warn'],
        ['Progress %', `${d.myWorkload?.progress || 0}%`, 'info'],
      ];
    $('#dash-kpis').innerHTML = kpis.map(([l, v, cls]) =>
      `<article class="kpi ${cls}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`
    ).join('');

    renderXferDashboard(d);

    const p = d.pipeline || {};
    $('#dash-pipeline').innerHTML = [
      ["Today's Proformas", p.todaysProformas],
      ['Assigned', p.assigned],
      ['PSFU', p.psfu],
      ['Ready', p.ready],
      ['Delivered / Claimed', p.delivered],
    ].map(([l, n]) => `<div class="pipe-step"><strong>${esc(n)}</strong><span>${esc(l)}</span></div>`).join('');

    const empCard = $('#dash-emp-card');
    const salesCard = $('#dash-sales-type-card');
    if (empCard) {
      empCard.hidden = false;
      const rows = d.employees || [];
      const targetMonth = d.targetMonth || state.monthFilter || '';
      const canEditTarget = canSetTargets();
      const hint = $('#dash-emp-hint');
      if (hint) {
        hint.textContent = canEditTarget
          ? `By sales type · Target month ${targetMonth || '—'} · Hanouf sets Target · Ach% = Claimed ÷ Target — click a name for Live Sheet`
          : `By sales type · Target month ${targetMonth || '—'} · click a name for Live Sheet`;
      }
      const showRows = rows.slice();
      const meId = state.user && state.user.id;
      const meName = state.user && state.user.name;

      // —— Schedule grouped by sales type ——
      const typeTotals = new Map();
      showRows.forEach((e) => {
        Object.entries(e.bySalesType || {}).forEach(([stype, n]) => {
          const key = stype || '(blank)';
          const count = Number(n) || 0;
          if (!count) return;
          if (!typeTotals.has(key)) typeTotals.set(key, { total: 0, employees: [] });
          const bucket = typeTotals.get(key);
          bucket.total += count;
          bucket.employees.push({
            id: e.id,
            name: e.name,
            count,
            isMe: e.id === meId || e.name === meName,
          });
        });
      });
      const typeBlocks = [...typeTotals.entries()]
        .sort((a, b) => b[1].total - a[1].total || String(a[0]).localeCompare(String(b[0])))
        .map(([stype, bucket]) => {
          const emps = bucket.employees.slice().sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
          const chips = emps.map((e) =>
            `<button type="button" class="emp-type-chip${e.isMe ? ' is-me' : ''}" data-emp="${esc(e.name)}" data-stype="${esc(stype)}" title="${esc(e.name)} · ${esc(stype)} · ${e.count}">
              <span class="emp-type-name">${esc(e.name)}${e.isMe ? ' · you' : ''}</span>
              <span class="emp-type-count">${e.count}</span>
            </button>`
          ).join('');
          return `<article class="emp-type-block">
            <div class="emp-type-head">
              <h3 class="emp-type-title">${esc(stype)}</h3>
              <span class="emp-type-total">${bucket.total} VIN(s)</span>
            </div>
            <div class="emp-type-chips">${chips || '<p class="hint">No employees</p>'}</div>
          </article>`;
        });
      const byTypeHost = $('#dash-emp-by-type');
      if (byTypeHost) {
        byTypeHost.innerHTML = typeBlocks.length
          ? typeBlocks.join('')
          : '<p class="hint">No sales types in this period — assign VINs with Sales Type from Sales Raw</p>';
        $$('.emp-type-chip', byTypeHost).forEach((btn) => {
          btn.addEventListener('click', () => {
            const emp = btn.dataset.emp;
            const stype = btn.dataset.stype || '';
            state.liveFilters.employee = emp || '';
            state.liveFilters.month = state.monthFilter || state.liveFilters.month || '';
            state.liveFilters.status = '';
            state.liveFilters.q = stype && stype !== '(blank)' ? stype : '';
            if ($('#live-employee')) {
              $('#live-employee').value = emp || '';
              $('#live-employee').dataset.filled = '1';
            }
            if ($('#live-month')) $('#live-month').value = state.liveFilters.month || '';
            if ($('#live-status')) $('#live-status').value = '';
            if ($('#live-q')) $('#live-q').value = state.liveFilters.q || '';
            setView('live');
          });
        });
      }

      // —— Compact targets / Ach% table ——
      $('#dash-emp-table').innerHTML = `<thead><tr>
          <th>Employee</th>
          <th class="num">Assigned</th>
          <th class="num">Claimed</th>
          <th class="num">Remaining</th>
          <th class="num">Progress %</th>
          <th class="num">Target</th>
          <th class="num">Ach%</th>
        </tr></thead>
        <tbody>${showRows.map((e) => {
          const isMe = e.id === meId || e.name === meName;
          const targetCell = canEditTarget
            ? `<input type="number" min="0" step="1" class="target-input" data-emp-id="${esc(e.id)}" data-emp-name="${esc(e.name)}" value="${e.target > 0 ? e.target : ''}" placeholder="—" title="Set monthly target (Hanouf)" />`
            : (e.target > 0 ? e.target : '—');
          const ach = formatAchPct(e.achPct);
          const achCls = achPctClass(e.achPct);
          return `<tr data-emp="${esc(e.name)}" class="${isMe ? 'is-me' : ''}" title="Open ${esc(e.name)} on Live Sheet">
          <td><b>${esc(e.name)}</b>${isMe ? ' <span class="badge info">you</span>' : ''}</td>
          <td class="num">${e.assigned}</td>
          <td class="num">${e.claimed}</td>
          <td class="num">${e.remaining}</td>
          <td class="num">${e.progress}%</td>
          <td class="num target-cell" data-stop-nav="1">${targetCell}</td>
          <td class="num ach-cell ${achCls}" data-emp-ach="${esc(e.id)}">${esc(ach)}</td>
        </tr>`;
        }).join('') || '<tr><td colspan="7">No employees</td></tr>'}</tbody>`;

      $$('#dash-emp-table .target-input').forEach((inp) => {
        inp.addEventListener('click', (ev) => ev.stopPropagation());
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            inp.blur();
          }
        });
        inp.addEventListener('change', async () => {
          const empId = inp.dataset.empId;
          const empName = inp.dataset.empName;
          const month = state.monthFilter || targetMonth || state.targetMonth;
          if (!month) {
            alert('Select a month first (top of dashboard), then set the target');
            return;
          }
          const raw = String(inp.value || '').trim();
          const target = raw === '' ? 0 : Number(raw);
          if (!Number.isFinite(target) || target < 0) {
            alert('Enter a valid target (≥ 0)');
            return;
          }
          try {
            inp.classList.add('is-saving');
            const res = await api('/targets', {
              method: 'POST',
              json: {
                month,
                employee: empId || empName,
                target,
                tzOffset: state.tzOffset,
              },
            });
            inp.classList.remove('is-saving');
            inp.classList.add('is-saved');
            const achEl = $(`#dash-emp-table [data-emp-ach="${empId}"]`);
            if (achEl) {
              achEl.textContent = formatAchPct(res.achPct);
              achEl.className = `num ach-cell ${achPctClass(res.achPct)}`;
            }
            setTimeout(() => inp.classList.remove('is-saved'), 1000);
          } catch (err) {
            inp.classList.remove('is-saving');
            alert(err.message || 'Failed to save target');
          }
        });
      });

      $$('#dash-emp-table tr[data-emp]').forEach((tr) => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (ev) => {
          if (ev.target.closest('[data-stop-nav]')) return;
          const emp = tr.dataset.emp;
          state.liveFilters.employee = emp || '';
          state.liveFilters.month = state.monthFilter || state.liveFilters.month || '';
          state.liveFilters.status = '';
          state.liveFilters.q = '';
          if ($('#live-employee')) {
            $('#live-employee').value = emp || '';
            $('#live-employee').dataset.filled = '1';
          }
          if ($('#live-month')) $('#live-month').value = state.liveFilters.month || '';
          if ($('#live-status')) $('#live-status').value = '';
          if ($('#live-q')) $('#live-q').value = '';
          setView('live');
        });
      });
    }

    if (salesCard) {
      const mix = d.bySalesType || {};
      const entries = Object.entries(mix).sort((a, b) => b[1] - a[1]);
      $('#dash-sales-types').innerHTML = entries.length
        ? entries.map(([k, n]) =>
          `<button type="button" class="status-chip" disabled><div class="n">${n}</div><div class="l">${esc(k)}</div></button>`
        ).join('')
        : '<p class="hint">No sales types in this period</p>';
    }

    const by = d.byStatus || {};
    const statuses = (state.meta && state.meta.statuses) || Object.keys(by);
    $('#dash-status').innerHTML = statuses.map((s) => {
      const n = by[s] || 0;
      return `<button type="button" class="status-chip" data-status="${esc(s)}"><div class="n">${n}</div><div class="l">${esc(s)}</div></button>`;
    }).join('') + (t.blankStatus
      ? `<button type="button" class="status-chip" data-status=""><div class="n">${t.blankStatus}</div><div class="l">(no status)</div></button>`
      : '');
    $$('#dash-status .status-chip').forEach((b) => b.addEventListener('click', () => {
      if (!b.dataset.status) return;
      state.liveFilters.status = b.dataset.status;
      state.liveFilters.month = state.monthFilter || state.liveFilters.month || '';
      state.liveFilters.employee = '';
      if ($('#live-status')) {
        $('#live-status').value = state.liveFilters.status;
        $('#live-status').dataset.filled = '1';
      }
      if ($('#live-month')) $('#live-month').value = state.liveFilters.month || '';
      if ($('#live-employee')) $('#live-employee').value = '';
      setView('live');
    }));

    const editsCard = $('#dash-edits-card');
    if (editsCard) {
      editsCard.hidden = !canManage();
      if (canManage()) {
        const edits = d.recentEdits || [];
        $('#dash-edits-table').innerHTML = `<thead><tr><th>Time</th><th>VIN</th><th>Who</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
          <tbody>${edits.map((a) => `<tr>
            <td>${esc((a.at || '').replace('T', ' ').slice(0, 19))}</td>
            <td>${esc(a.vin || '—')}</td>
            <td>${esc(a.user)}</td>
            <td>${esc(a.action)}</td>
            <td>${esc(a.oldValue)}</td>
            <td>${esc(a.newValue)}</td>
          </tr>`).join('') || '<tr><td colspan="6">No recent edits</td></tr>'}</tbody>`;
      }
    }
  }

  function fieldLabel(action) {
    const map = {
      guestSentDate: 'تاريخ إرسال الضيف',
      signatureReceivedDate: 'تاريخ استلام التواقيع',
      accountsSentDate: 'إرسال للحسابات',
      accountsApprovalDate: 'موافقة الحسابات',
      registrationIssueDate: 'إصدار الاستمارة',
      opsStatus: 'Status',
      vin1502: 'VIN 1502',
      trafficFile: 'ملف المرور',
      trafficFeesOps: 'Traffic Fees',
      insuranceOps: 'Insurance',
      transferCity: 'مدينة الترحيل',
      carrier: 'الناقل',
      notes: 'ملاحظات',
      assign: 'Assigned',
      reassign: 'Reassigned',
    };
    if (map[action]) return map[action];
    if (String(action).startsWith('update_')) return map[action.slice(7)] || action.slice(7);
    return action;
  }

  function editableControl(vin, field, type, value) {
    const v = value == null ? '' : String(value);
    const common = `class="cell-edit" data-vin="${esc(vin)}" data-field="${esc(field)}"`;
    if (type === 'status') {
      const statuses = (state.meta && state.meta.statuses) || [];
      return `<select ${common}><option value="">—</option>${statuses.map((s) =>
        `<option value="${esc(s)}" ${v === s ? 'selected' : ''}>${esc(s)}</option>`
      ).join('')}</select>`;
    }
    if (type === 'yn') {
      return `<select ${common}>
        <option value="">—</option>
        <option value="Yes" ${v === 'Yes' ? 'selected' : ''}>Yes</option>
        <option value="No" ${v === 'No' ? 'selected' : ''}>No</option>
      </select>`;
    }
    if (type === 'date') {
      return `<input type="date" ${common} value="${esc(v)}" />`;
    }
    if (type === 'city') {
      return `<input list="edit-city-list" ${common} value="${esc(v)}" placeholder="City…" />`;
    }
    if (type === 'carrier') {
      const carriers = (state.meta && state.meta.carriers) || [];
      // Hanouf 2-change lock is enforced on save; keep select available and show count in title
      return `<select ${common}><option value="">— الناقل —</option>${carriers.map((c) =>
        `<option value="${esc(c)}" ${v === c ? 'selected' : ''}>${esc(c)}</option>`
      ).join('')}</select>`;
    }
    if (type === 'notes') {
      return `<input type="text" ${common} value="${esc(v)}" placeholder="Notes…" style="min-width:140px" />`;
    }
    return esc(v || '—');
  }

  function scheduleColumns({ editable = false, carrierEditable = false } = {}) {
    const cols = [
      ['Proforma', (r) => na(r.raw.proformaDate)],
      ['Order', (r) => na(r.raw.salesOrder)],
      ['VIN', (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['Sales Type', (r) => na(r.raw.salesType)],
      ['Product', (r) => na(r.raw.product)],
    ];
    cols.push(
      ['Customer Name', (r) => displayName(r.raw.userName)],
      ['Owner', (r) => displayName(r.raw.invoiceOwner)],
      ['S/A', (r) => na(r.raw.salesAdvisor)],
      ['GT Loc', (r) => na(r.raw.gtLocation)],
      ['Veh Loc', (r) => na(r.raw.vehicleLocation)],
      ['Phone', (r) => displayPhone(r.raw.phone)],
    );
    cols.push(['Guest Exp', (r) => guestCellHtml(r, { editable })]);
    if (editable) {
      cols.push(
        ['Status', (r) => editableControl(r.vin, 'opsStatus', 'status', r.ops.opsStatus)],
        ['إرسال الضيف', (r) => editableControl(r.vin, 'guestSentDate', 'date', r.ops.guestSentDate)],
        ['استلام التواقيع', (r) => editableControl(r.vin, 'signatureReceivedDate', 'date', r.ops.signatureReceivedDate)],
        ['إرسال للحسابات', (r) => editableControl(r.vin, 'accountsSentDate', 'date', r.ops.accountsSentDate)],
        ['موافقة الحسابات', (r) => editableControl(r.vin, 'accountsApprovalDate', 'date', r.ops.accountsApprovalDate)],
        ['VIN 1502', (r) => editableControl(r.vin, 'vin1502', 'yn', r.ops.vin1502)],
        ['ملف المرور', (r) => editableControl(r.vin, 'trafficFile', 'yn', r.ops.trafficFile)],
        ['Traffic Fees', (r) => editableControl(r.vin, 'trafficFeesOps', 'yn', r.ops.trafficFeesOps)],
        ['Insurance', (r) => editableControl(r.vin, 'insuranceOps', 'yn', r.ops.insuranceOps)],
        ['إصدار الاستمارة', (r) => editableControl(r.vin, 'registrationIssueDate', 'date', r.ops.registrationIssueDate)],
        ['مدينة الترحيل', (r) => editableControl(r.vin, 'transferCity', 'city', r.ops.transferCity)],
        ['الناقل', (r) => editableControl(r.vin, 'carrier', 'carrier', r.ops.carrier)],
        ['ملاحظات', (r) => editableControl(r.vin, 'notes', 'notes', r.ops.notes)],
        ['Open', (r) => `<button type="button" class="btn vin-link" data-vin="${esc(r.vin)}">Full edit</button>`],
      );
    } else {
      cols.push(
        ['Status', (r) => statusBadge(r.ops.opsStatus)],
        ['إرسال الضيف', (r) => na(r.ops.guestSentDate)],
        ['استلام التواقيع', (r) => na(r.ops.signatureReceivedDate)],
        ['إرسال للحسابات', (r) => na(r.ops.accountsSentDate)],
        ['موافقة الحسابات', (r) => na(r.ops.accountsApprovalDate)],
        ['VIN 1502', (r) => ynBadge(r.ops.vin1502)],
        ['ملف المرور', (r) => ynBadge(r.ops.trafficFile)],
        ['Traffic Fees', (r) => ynBadge(r.ops.trafficFeesOps)],
        ['Insurance', (r) => ynBadge(r.ops.insuranceOps)],
        ['إصدار الاستمارة', (r) => na(r.ops.registrationIssueDate)],
        ['مدينة الترحيل', (r) => na(r.ops.transferCity)],
        ['الناقل', (r) => (carrierEditable
          ? editableControl(r.vin, 'carrier', 'carrier', r.ops.carrier)
          : na(r.ops.carrier))],
        ['ملاحظات', (r) => esc((r.ops.notes || '').slice(0, 40))],
        ['Employee', (r) => na(r.ops.assignedEmployeeName)],
      );
    }
    return cols;
  }

  async function saveCellEdit(el) {
    const vin = el.dataset.vin;
    const field = el.dataset.field;
    const value = el.value;
    if (!vin || !field) return;
    el.classList.add('is-saving');
    try {
      await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: { [field]: value } });
      el.classList.remove('is-saving');
      el.classList.add('is-saved');
      if (field === 'opsStatus') {
        const tr = el.closest('tr');
        if (tr) {
          tr.classList.remove(
            'row-status-claimed', 'row-status-psfu', 'row-status-ready', 'row-status-delivered',
            'row-status-issued', 'row-status-traffic', 'row-status-traffic-return',
            'row-status-pending', 'row-status-cancel'
          );
          const cls = statusRowClass(value);
          if (cls) tr.classList.add(cls);
          tr.dataset.status = value || '';
        }
      }
      if (field === 'guestCenter') {
        const tr = el.closest('tr');
        if (tr) tr.classList.toggle('row-guest-exp', value === 'Yes');
      }
      const toast = $('#live-save-toast') || $('#my-save-toast');
      if (toast) {
        toast.hidden = false;
        toast.textContent = `Saved ✓ ${fieldLabel(field)} · ${new Date().toLocaleTimeString()}`;
        setTimeout(() => { toast.hidden = true; }, 2200);
      }
      setTimeout(() => el.classList.remove('is-saved'), 1200);
    } catch (err) {
      el.classList.remove('is-saving');
      alert(err.message || 'Save failed');
    }
  }

  function bindEditableCells(tableEl) {
    $$('.cell-edit', tableEl).forEach((el) => {
      el.addEventListener('change', () => saveCellEdit(el));
      if (el.tagName === 'INPUT' && el.type === 'text') {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveCellEdit(el);
          }
        });
      }
    });
  }

  function fillCarrierLists() {
    const carriers = (state.meta && state.meta.carriers) || [];
    const html = carriers.map((c) => `<option value="${esc(c)}"></option>`).join('');
    ['#edit-carrier-list', '#all-carrier-list', '#assign-carrier-list'].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
    const bulk = $('#assign-bulk-carrier');
    if (bulk && bulk.tagName === 'SELECT' && !bulk.dataset.filled) {
      bulk.innerHTML = `<option value="">— اختر الناقل —</option>${carriers.map((c) =>
        `<option value="${esc(c)}">${esc(c)}</option>`
      ).join('')}`;
      bulk.dataset.filled = '1';
    }
  }

  function renderScheduleTable(tableEl, rows, {
    selectable = false,
    editable = false,
    carrierEditable = false,
    selectionSet = null,
  } = {}) {
    const selected = selectionSet || state.selectedVins;
    const cols = scheduleColumns({ editable, carrierEditable });
    const head = `<thead><tr>${selectable ? '<th></th>' : ''}${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows.map((r) => {
      const statusCls = statusRowClass(r.ops.opsStatus);
      const guestCls = guestCenterValue(r) === 'Yes' ? 'row-guest-exp' : '';
      const checked = selected.has(r.vin) ? 'checked' : '';
      return `<tr class="${statusCls} ${guestCls} ${checked ? 'selected' : ''}" data-vin="${esc(r.vin)}" data-status="${esc(r.ops.opsStatus || '')}">
        ${selectable ? `<td><input class="checkbox vin-select-check" type="checkbox" data-vin="${esc(r.vin)}" ${checked} /></td>` : ''}
        ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}
      </tr>`;
    }).join('')}</tbody>`;
    tableEl.innerHTML = head + body;
    $$('.vin-link', tableEl).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindGuestButtons(tableEl);
    if (editable || carrierEditable) bindEditableCells(tableEl);
    if (selectable) {
      $$('.vin-select-check', tableEl).forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.vin);
        else selected.delete(cb.dataset.vin);
        cb.closest('tr').classList.toggle('selected', cb.checked);
        updateMyReassignBar();
        updateLaneReassignCount();
      }));
    }
  }

  function otherEmployees(exceptName) {
    const all = assignableNames();
    const skip = String(exceptName || '').trim().toLowerCase();
    return all.filter((n) => n.toLowerCase() !== skip);
  }

  function updateMyReassignBar() {
    const countEl = $('#my-reassign-count');
    if (countEl) countEl.textContent = String(state.reassignVins.size);
  }

  function updateLaneReassignCount() {
    const countEl = $('#lane-reassign-count');
    if (countEl) countEl.textContent = String(state.reassignVins.size);
  }

  function renderReassignTargets(container, exceptName, onPick) {
    if (!container) return;
    const targets = otherEmployees(exceptName);
    container.innerHTML = targets.map((name) =>
      `<button type="button" class="btn reassign-target-btn" data-emp="${esc(name)}">→ ${esc(name)}</button>`
    ).join('');
    $$('.reassign-target-btn', container).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.emp)));
  }

  async function reassignSelected(toEmployee, { clearPanel = false } = {}) {
    const vins = [...state.reassignVins];
    if (!vins.length) return alert('Select at least one VIN first');
    if (!toEmployee) return alert('Choose an employee');
    if (!confirm(`Reassign ${vins.length} VIN(s) to ${toEmployee}?`)) return;
    const res = await api('/reassign', { method: 'POST', json: { vins, employee: toEmployee } });
    const ok = (res.results || []).filter((r) => r.ok).length;
    const fail = (res.results || []).filter((r) => !r.ok);
    alert(`Reassigned ${ok} VIN(s) to ${toEmployee}${fail.length ? `\n${fail.length} failed` : ''}`);
    state.reassignVins.clear();
    if (clearPanel) {
      state.reassignFrom = '';
      state.reassignRows = [];
      const panel = $('#lane-reassign-panel');
      if (panel) panel.hidden = true;
    }
    if (state.view === 'my') await loadMy();
    else if (state.view === 'assign') await loadAssign();
    else await refreshView();
  }

  function renderRecentEdits(edits) {
    const card = $('#dash-edits-card');
    const table = $('#dash-edits-table');
    if (!card || !table) return;
    if (!canManage()) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const rows = edits || [];
    if (!rows.length) {
      table.innerHTML = `<tbody><tr><td>No employee edits yet. Changes on assigned VINs will appear here live.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Time</th><th>Employee</th><th>VIN</th><th>Field</th><th>From</th><th>To</th></tr></thead>
      <tbody>${rows.map((a) => `<tr>
        <td>${esc((a.at || '').replace('T', ' ').slice(0, 19))}</td>
        <td><b>${esc(a.user)}</b></td>
        <td>${a.vin ? `<button type="button" class="vin-link" data-vin="${esc(a.vin)}">${esc(a.vin)}</button>` : '—'}</td>
        <td>${esc(fieldLabel(a.action))}</td>
        <td>${esc(a.oldValue)}</td>
        <td><b>${esc(a.newValue)}</b></td>
      </tr>`).join('')}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
  }

  function filterQuery(extra = {}) {
    const p = new URLSearchParams();
    p.set('tzOffset', String(state.tzOffset));
    p.set('page', String(state.filters.page || 1));
    p.set('limit', String(state.filters.limit || 40));
    if (state.filters.q) p.set('q', state.filters.q);
    if (state.filters.status) p.set('status', state.filters.status);
    if (state.filters.employee) p.set('employee', state.filters.employee);
    const month = state.filters.month || state.monthFilter || '';
    if (month) p.set('month', month);
    Object.entries(extra).forEach(([k, v]) => { if (v != null && v !== '') p.set(k, v); });
    return p.toString();
  }

  function renderPager(el, pack, onPage) {
    if (!el) return;
    el.innerHTML = `<span>${pack.total} rows · page ${pack.page}/${pack.pages}</span>
      <button type="button" class="btn" ${pack.page <= 1 ? 'disabled' : ''} data-p="${pack.page - 1}">Prev</button>
      <button type="button" class="btn" ${pack.page >= pack.pages ? 'disabled' : ''} data-p="${pack.page + 1}">Next</button>`;
    $$('button[data-p]', el).forEach((b) => b.addEventListener('click', () => onPage(Number(b.dataset.p))));
  }

  function buildToolbar(el, { showEmployee = true } = {}) {
    const statuses = (state.meta && state.meta.statuses) || [];
    const month = state.filters.month || state.monthFilter || '';
    el.innerHTML = `
      <label class="month-filter-label">Month <input type="month" data-f="month" value="${esc(month)}" /></label>
      <input type="search" data-f="q" placeholder="Search…" value="${esc(state.filters.q)}" />
      <select data-f="status"><option value="">All statuses</option>${statuses.map((s) => `<option ${state.filters.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      ${showEmployee && canManage() ? `<select data-f="employee"><option value="">All employees</option>${assignableNames().map((s) => `<option ${state.filters.employee === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
      <button type="button" class="btn" data-clear>Clear filters</button>
    `;
    $$('[data-f]', el).forEach((inp) => {
      const ev = inp.tagName === 'SELECT' || inp.type === 'month' ? 'change' : 'keydown';
      inp.addEventListener(ev, (e) => {
        if (ev === 'keydown' && e.key !== 'Enter') return;
        state.filters[inp.dataset.f] = inp.value;
        if (inp.dataset.f === 'month') state.monthFilter = inp.value;
        state.filters.page = 1;
        refreshView();
      });
    });
    $('[data-clear]', el)?.addEventListener('click', () => {
      state.filters = { q: '', status: '', employee: '', month: '', page: 1, limit: 40 };
      state.monthFilter = '';
      refreshView();
    });
  }

  async function loadToday() {
    fillCarrierLists();
    const monthInput = $('#month-pf-month');
    if (monthInput && !monthInput.value) {
      monthInput.value = currentMonthValue();
    }
    const month = (monthInput && monthInput.value) || currentMonthValue();
    const data = await api(`/month-proformas?tzOffset=${state.tzOffset}&month=${encodeURIComponent(month)}`);
    renderScheduleTable($('#today-table'), data.rows || [], { carrierEditable: canManage() });
    const hint = $('#month-pf-hint');
    if (hint) hint.textContent = `${data.total || 0} VIN(s) · proforma ${month}`;
  }

  async function loadAssignPool(mode) {
    let qs = `tzOffset=${state.tzOffset}`;
    let label = 'unassigned';
    if (mode === 'monthUnique' || mode === true) {
      const month = currentMonthValue();
      qs += `&monthUnique=1&month=${encodeURIComponent(month)}`;
      label = `this month ${month} · unique Col P · not on VIN sheets`;
    } else if (mode === 'today') {
      qs += '&today=1';
      label = "today’s unassigned";
    }
    const data = await api(`/unassigned?${qs}`);
    state.assignPool = data.rows || [];
    renderAssignPool();
    const extra = mode === 'monthUnique' || mode === true
      ? ` · skipped ${data.excludedDuplicates || 0} Excel dupes / ${data.excludedVinSheets || 0} VIN-sheet hits`
      : '';
    $('#assign-pool-hint').textContent = `${state.assignPool.length} ${label}${extra} · check VINs then Submit & display`;
  }

  async function loadMy() {
    // Hanouf "My VINs" = rows assigned to herself (she can receive assignments)
    if (state.user.role === 'hanouf') {
      state.filters.employee = 'Hanouf';
    }
    buildToolbar($('#my-toolbar'), { showEmployee: false });
    const cities = (state.meta && state.meta.transferCities) || [];
    const carriers = (state.meta && state.meta.carriers) || [];
    const cityList = $('#edit-city-list');
    const carrierList = $('#edit-carrier-list');
    if (cityList) cityList.innerHTML = cities.map((c) => `<option value="${esc(c)}"></option>`).join('');
    if (carrierList) carrierList.innerHTML = carriers.map((c) => `<option value="${esc(c)}"></option>`).join('');
    fillCarrierLists();

    // All of this user's VINs on one page · sorted by status pipeline
    const pack = await api(`/vehicles?${filterQuery({ all: '1', page: 1, sort: 'status', dir: 'asc' })}`);
    const dash = await api(`/dashboard?tzOffset=${state.tzOffset}${state.monthFilter ? `&month=${encodeURIComponent(state.monthFilter)}` : ''}`);
    const w = state.user.role === 'employee'
      ? (dash.myWorkload || {})
      : (dash.employees || []).find((e) => e.name === state.user.name) || {};
    const salesTypes = w.bySalesType || {};
    const typeKpis = Object.entries(salesTypes).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([l, v]) => [l, v, 'info']);
    $('#my-kpis').innerHTML = [
      ['Assigned', w.assigned || 0, ''],
      ['Completed', w.claimed != null ? w.claimed : (w.completed || 0), 'ok'],
      ['Remaining', w.remaining != null ? w.remaining : 0, 'warn'],
      ['Progress %', `${w.progress || 0}%`, 'info'],
      ...typeKpis,
    ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');
    renderScheduleTable($('#my-table'), pack.rows || [], {
      editable: true,
      selectable: true,
      selectionSet: state.reassignVins,
    });
    const pager = $('#my-pager');
    if (pager) {
      pager.innerHTML = `<span>${pack.total || 0} VIN(s) · all on this page</span>`;
    }
    const except = state.user.name;
    renderReassignTargets($('#my-reassign-targets'), except, (emp) => {
      reassignSelected(emp).catch((e) => alert(e.message));
    });
    updateMyReassignBar();
  }

  async function loadAll() {
    buildToolbar($('#all-toolbar'), { showEmployee: true });
    fillCarrierLists();
    const pack = await api(`/vehicles?${filterQuery()}`);
    renderScheduleTable($('#all-table'), pack.rows || [], { carrierEditable: canManage() });
    renderPager($('#all-pager'), pack, (p) => { state.filters.page = p; loadAll(); });
  }

  async function loadAssign() {
    state.selectedVins.clear();
    fillCarrierLists();
    renderAssignEmpGrid();
    await loadAssignPool('monthUnique');
    renderAssignDisplay();
    const dash = await api(`/dashboard?tzOffset=${state.tzOffset}${state.monthFilter ? `&month=${encodeURIComponent(state.monthFilter)}` : ''}`);
    $('#assign-lanes').innerHTML = (dash.employees || []).map((e) => {
      const types = Object.entries(e.bySalesType || {}).map(([k, n]) => `${k}: ${n}`).join(' · ');
      return `<div class="lane" data-emp="${esc(e.name)}">
        <div class="lane-top">
          <div>
            <h4>${esc(e.name)}</h4>
            <div class="count">${e.assigned} assigned · ${e.remaining} remaining · ${e.progress}%</div>
            ${types ? `<div class="count sales-type-line">${esc(types)}</div>` : ''}
          </div>
          <button type="button" class="btn lane-select-btn" data-emp="${esc(e.name)}" ${e.assigned ? '' : 'disabled'}>
            Select VINs
          </button>
        </div>
      </div>`;
    }).join('');
    $$('.lane-select-btn').forEach((b) => b.addEventListener('click', () => {
      openLaneReassign(b.dataset.emp).catch((e) => alert(e.message));
    }));
    if (state.reassignFrom) {
      await openLaneReassign(state.reassignFrom);
    } else {
      const panel = $('#lane-reassign-panel');
      if (panel) panel.hidden = true;
    }
  }

  function renderAssignEmpGrid() {
    const grid = $('#assign-emp-grid');
    if (!grid) return;
    grid.innerHTML = assignableNames().map((name) =>
      `<button type="button" class="assign-emp-btn${state.assignEmployee === name ? ' active' : ''}" data-emp="${esc(name)}">${esc(name)}</button>`
    ).join('');
    $$('.assign-emp-btn', grid).forEach((b) => b.addEventListener('click', () => {
      state.assignEmployee = b.dataset.emp;
      updateAssignConfirmState();
    }));
  }

  async function openLaneReassign(employeeName) {
    state.reassignFrom = employeeName;
    state.reassignVins.clear();
    const prevEmp = state.filters.employee;
    const prevPage = state.filters.page;
    const prevLimit = state.filters.limit;
    state.filters.employee = employeeName;
    state.filters.page = 1;
    state.filters.limit = 200;
    let data;
    try {
      data = await api(`/vehicles?${filterQuery()}`);
    } finally {
      state.filters.employee = prevEmp;
      state.filters.page = prevPage;
      state.filters.limit = prevLimit;
    }
    state.reassignRows = data.rows || [];
    const panel = $('#lane-reassign-panel');
    panel.hidden = false;
    $('#lane-reassign-title').textContent = `${employeeName} · select VINs to reassign`;
    $('#lane-reassign-hint').textContent = `${state.reassignRows.length} VIN(s) currently with ${employeeName}`;
    renderScheduleTable($('#lane-reassign-table'), state.reassignRows, {
      selectable: true,
      selectionSet: state.reassignVins,
    });
    renderReassignTargets($('#lane-reassign-targets'), employeeName, (emp) => {
      reassignSelected(emp, { clearPanel: true }).catch((e) => alert(e.message));
    });
    updateLaneReassignCount();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAssignPool() {
    const q = String($('#assign-pool-search')?.value || '').trim().toLowerCase();
    let rows = state.assignPool || [];
    if (q) {
      rows = rows.filter((r) =>
        `${r.vin} ${r.raw.product} ${r.raw.salesOrder} ${r.raw.salesType}`.toLowerCase().includes(q)
      );
    }
    const cols = [
      ['VIN', (r) => esc(r.vin)],
      ['Order', (r) => na(r.raw.salesOrder)],
      ['Product', (r) => na(r.raw.product)],
      ['Sales Type', (r) => na(r.raw.salesType)],
      ['Customer Name', (r) => displayName(r.raw.userName)],
      ['Owner', (r) => displayName(r.raw.invoiceOwner)],
      ['S/A', (r) => na(r.raw.salesAdvisor)],
      ['Proforma', (r) => na(r.raw.proformaDate)],
      ['Status', (r) => statusBadge(r.ops.opsStatus)],
      ['Currently', (r) => na(r.ops.assignedEmployeeName)],
    ];
    const head = `<thead><tr><th></th>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows.map((r) => {
      const checked = state.selectedVins.has(r.vin) ? 'checked' : '';
      return `<tr class="${checked ? 'selected' : ''}">
        <td><input class="checkbox assign-pool-check" type="checkbox" data-vin="${esc(r.vin)}" ${checked} /></td>
        ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}
      </tr>`;
    }).join('') || `<tr><td colspan="${cols.length + 1}">No unassigned VINs in this pool.</td></tr>`}</tbody>`;
    $('#assign-pool-table').innerHTML = head + body;
    $$('.assign-pool-check').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) state.selectedVins.add(cb.dataset.vin);
      else state.selectedVins.delete(cb.dataset.vin);
      cb.closest('tr').classList.toggle('selected', cb.checked);
    }));
  }

  function parseVinPaste(text) {
    return String(text || '')
      .split(/[\s,;]+/)
      .map((v) => v.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);
  }

  async function submitVinsForDisplay() {
    const fromChecks = [...state.selectedVins];
    const fromPaste = parseVinPaste($('#assign-vin-input').value);
    const vins = [...new Set([...fromChecks, ...fromPaste])];
    if (!vins.length) {
      alert('Select VINs from the pool and/or paste VINs, then Submit & display.');
      return;
    }
    const data = await api('/resolve-vins', { method: 'POST', json: { vins } });
    state.assignDisplay = data.rows || [];
    if (data.missing && data.missing.length) {
      alert(`${data.missing.length} VIN(s) not found in Raw Data:\n${data.missing.slice(0, 12).join('\n')}`);
    }
    if (!state.assignDisplay.length) {
      alert('None of the submitted VINs were found. Upload Raw Data first.');
      return;
    }
    state.selectedVins.clear();
    $('#assign-vin-input').value = '';
    renderAssignPool();
    renderAssignDisplay();
    $('#assign-step-2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAssignDisplay() {
    const empty = $('#assign-display-empty');
    const body = $('#assign-display-body');
    const rows = state.assignDisplay || [];
    if (!rows.length) {
      empty.hidden = false;
      body.hidden = true;
      $('#assign-confirm-btn').disabled = true;
      return;
    }
    empty.hidden = true;
    body.hidden = false;
    $('#assign-display-count').textContent = String(rows.length);
    fillCarrierLists();
    renderScheduleTable($('#assign-display-table'), rows, { selectable: false, carrierEditable: true });
    updateAssignConfirmState();
  }

  function updateAssignConfirmState() {
    const emp = state.assignEmployee;
    const has = (state.assignDisplay || []).length > 0;
    $('#assign-confirm-btn').disabled = !(emp && has);
    const carrier = String($('#assign-bulk-carrier')?.value || '').trim();
    $('#assign-picked-label').textContent = emp
      ? `Selected: ${emp}${carrier ? ` · الناقل: ${carrier}` : ''} · ${state.assignDisplay.length} VIN(s)`
      : 'No employee selected';
    $$('.assign-emp-btn').forEach((b) => b.classList.toggle('active', b.dataset.emp === emp));
    const carrierBtn = $('#assign-carrier-btn');
    if (carrierBtn) carrierBtn.disabled = !(has && carrier);
  }

  async function doAssign() {
    const employee = state.assignEmployee;
    const vins = (state.assignDisplay || []).map((r) => r.vin);
    const carrier = String($('#assign-bulk-carrier')?.value || '').trim();
    if (!employee) return alert('Choose an employee first');
    if (!vins.length) return alert('Submit & display VINs first');
    const res = await api('/assign', { method: 'POST', json: { vins, employee, carrier: carrier || undefined } });
    const ok = (res.results || []).filter((r) => r.ok).length;
    alert(`Assigned ${ok} VIN(s) to ${employee}${carrier ? ` · الناقل: ${carrier}` : ''}`);
    state.assignDisplay = [];
    state.assignEmployee = '';
    if ($('#assign-bulk-carrier')) $('#assign-bulk-carrier').value = '';
    await loadAssign();
  }

  async function doAssignCarrier() {
    const vins = (state.assignDisplay || []).map((r) => r.vin);
    const carrier = String($('#assign-bulk-carrier')?.value || '').trim();
    if (!vins.length) return alert('Submit & display VINs first');
    if (!carrier) return alert('اختر الناقل أولاً');
    const res = await api('/assign-carrier', { method: 'POST', json: { vins, carrier } });
    const ok = (res.results || []).filter((r) => r.ok).length;
    alert(`تم تعيين الناقل «${carrier}» لـ ${ok} VIN(s)`);
    // refresh displayed rows with updated carrier
    const data = await api('/resolve-vins', { method: 'POST', json: { vins } });
    state.assignDisplay = data.rows || [];
    renderAssignDisplay();
  }

  async function loadAudit() {
    const vin = $('#audit-vin').value.trim();
    const page = state.filters.page || 1;
    const pack = await api(`/audit?page=${page}&limit=50${vin ? `&vin=${encodeURIComponent(vin)}` : ''}`);
    $('#audit-table').innerHTML = `<thead><tr><th>Time</th><th>VIN</th><th>User</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
      <tbody>${(pack.rows || []).map((a) => `<tr>
        <td>${esc((a.at || '').replace('T', ' ').slice(0, 19))}</td>
        <td>${esc(a.vin || '—')}</td>
        <td>${esc(a.user)}</td>
        <td>${esc(a.action)}</td>
        <td>${esc(a.oldValue)}</td>
        <td>${esc(a.newValue)}</td>
      </tr>`).join('')}</tbody>`;
    renderPager($('#audit-pager'), { ...pack, pages: Math.max(1, Math.ceil(pack.total / pack.limit)) }, (p) => {
      state.filters.page = p;
      loadAudit();
    });
  }

  async function openVin(vin) {
    const data = await api(`/vehicles/${encodeURIComponent(vin)}`);
    const v = data.vehicle;
    const back = $('#vin-drawer-back');
    const drawer = $('#vin-drawer');
    const statuses = (state.meta && state.meta.statuses) || [];
    const cities = (state.meta && state.meta.transferCities) || [];
    const carriers = (state.meta && state.meta.carriers) || [];
    const isMine = !!(state.user && (
      (v.ops && v.ops.assignedEmployeeId === state.user.id)
      || (v.ops && v.ops.assignedEmployeeName === state.user.name)
    ));
    const canEdit = canManage() || canEditLiveSheet() || isMine;
    // Any user who can open an assigned VIN may change الناقل from this drawer
    const canEditCarrier = !!(v.ops && v.ops.assignedEmployeeId) || canEdit;
    const carrierLocked = !!v.carrierLocked;

    drawer.innerHTML = buildDrawerHtml(v, statuses, cities, carriers, {
      readOnly: !canEdit,
      carrierEditable: canEditCarrier && !carrierLocked,
      carrierLocked,
    });
    back.classList.add('open');
    $('#drawer-close', drawer).onclick = () => back.classList.remove('open');
    back.onclick = (e) => { if (e.target === back) back.classList.remove('open'); };

    async function savePatch(patch) {
      try {
        const res = await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: patch });
        const line = $('#save-line', drawer);
        if (line) {
          line.hidden = false;
          line.textContent = `Saved ✓ · ${new Date(res.lastUpdated || Date.now()).toLocaleTimeString()}`;
          setTimeout(() => { line.hidden = true; }, 2500);
        }
        const last = $('#last-updated', drawer);
        if (last && res.lastUpdated) last.textContent = `Last updated: ${res.lastUpdated}`;
        // Refresh drawer when carrier limit / value updates (Hanouf)
        if (patch.carrier != null && res.vehicle) {
          openVin(vin).catch(() => {});
          return;
        }
      } catch (err) {
        alert(err.message || 'Save failed');
      }
    }

    if (canEdit) {
      $$('[data-ops]', drawer).forEach((el) => {
        if (el.dataset.ops === 'carrier') return; // handled below
        el.addEventListener('change', () => savePatch({ [el.dataset.ops]: el.value }));
      });
      $$('[data-yn]', drawer).forEach((group) => {
        $$('button', group).forEach((b) => b.addEventListener('click', () => {
          $$('button', group).forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          savePatch({ [group.dataset.yn]: b.dataset.v });
        }));
      });
    }

    // الناقل editable from drawer for any user (even if other fields are view-only)
    const carrierEl = $('[data-ops="carrier"]', drawer);
    if (carrierEl && !carrierEl.disabled) {
      carrierEl.addEventListener('change', () => savePatch({ carrier: carrierEl.value }));
    }
  }

  function buildDrawerHtml(v, statuses, cities, carriers, opts = {}) {
    const readOnly = !!opts.readOnly;
    const carrierEditable = opts.carrierEditable !== false && !opts.carrierLocked;
    const carrierLocked = !!opts.carrierLocked;
    const used = Number(v.carrierChangeCount || 0) || 0;
    const limit = v.carrierChangeLimit;
    const remaining = v.carrierChangeRemaining;
    const hanoufHint = limit != null
      ? `<p class="hint">الناقل · Hanouf: ${used}/${limit} تغييرات${remaining === 0 ? ' · وصلت للحد' : ` · متبقي ${remaining}`}</p>`
      : '';
    const yn = (key, label, val) => readOnly
      ? `<div class="field"><label>${esc(label)}</label><input value="${esc(na(val))}" readonly /></div>`
      : `<div class="field"><label>${esc(label)}</label>
      <div class="yn" data-yn="${key}">
        <button type="button" class="yes ${val === 'Yes' ? 'active' : ''}" data-v="Yes">🟢 YES</button>
        <button type="button" class="no ${val === 'No' ? 'active' : ''}" data-v="No">🔴 NO</button>
      </div></div>`;
    const dt = (key, label, val) => readOnly
      ? `<div class="field"><label>${esc(label)}</label><input type="text" value="${esc(na(val))}" readonly /></div>`
      : `<div class="field"><label>${esc(label)}</label><input type="date" data-ops="${key}" value="${esc(val || '')}" /></div>`;
    const carrierField = carrierEditable
      ? `<div class="field"><label>الناقل</label>
            <select data-ops="carrier">
              <option value="">— الناقل —</option>
              ${carriers.map((c) => `<option value="${esc(c)}" ${v.ops.carrier === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
            ${hanoufHint}
          </div>`
      : `<div class="field"><label>الناقل</label><input value="${esc(na(v.ops.carrier))}" readonly />
            ${carrierLocked ? '<p class="hint">Hanouf وصلت لحد تغييرين للناقل على هذا الـ VIN</p>' : hanoufHint}
          </div>`;
    return `
      <div class="drawer-head">
        <div>
          <h2>${esc(na(v.raw.product))}</h2>
          <div class="meta-row">
            <span class="badge info">${esc(v.vin)}</span>
            <span class="badge">${esc(na(v.raw.salesOrder))}</span>
            ${statusBadge(v.ops.opsStatus)}
            <span class="badge">${esc(na(v.ops.assignedEmployeeName))}</span>
            ${readOnly ? '<span class="badge warn">View only</span>' : ''}
          </div>
        </div>
        <button type="button" class="btn" id="drawer-close">Close</button>
      </div>
      <div class="detail-grid">
        <div class="card">
          <h2>Vehicle information</h2>
          <p class="hint">Raw Data (read-only)</p>
          ${[
            ['Proforma Date', v.raw.proformaDate], ['Sales Order', v.raw.salesOrder],
            ['Sales Type', v.raw.salesType],
            ['Customer Name', displayName(v.raw.userName)],
            ['Owner', displayName(v.raw.invoiceOwner)],
            ['S/A', v.raw.salesAdvisor],
            ['GT Location', v.raw.gtLocation], ['Vehicle Location', v.raw.vehicleLocation],
            ['Phone', displayPhone(v.raw.phone)],
            ['PIC', v.raw.pic],
          ].map(([l, val]) => `<div class="field"><label>${esc(l)}</label><input value="${esc(na(val))}" readonly /></div>`).join('')}
        </div>
        <div class="card">
          <h2>Delivery information${readOnly ? ' (teammate — view only)' : ''}</h2>
          <p class="hint">${readOnly ? 'Read-only except الناقل · saves immediately' : 'Employee updates · saves immediately'}</p>
          <div id="save-line" class="save-toast" hidden>Saved ✓</div>
          ${dt('guestSentDate', 'تاريخ إرسال الضيف', v.ops.guestSentDate)}
          ${readOnly
            ? `<div class="field"><label>Guest Exp</label><input value="${esc(guestCenterValue(v) || '—')}" readonly /></div>`
            : `<div class="field"><label>Guest Exp</label>
            <select data-ops="guestCenter">
              <option value="">—</option>
              <option value="Yes" ${guestCenterValue(v) === 'Yes' ? 'selected' : ''}>Yes</option>
              <option value="No" ${guestCenterValue(v) === 'No' ? 'selected' : ''}>No</option>
            </select>
          </div>`}
          ${dt('signatureReceivedDate', 'تاريخ استلام التواقيع من الضيف', v.ops.signatureReceivedDate)}
          ${dt('accountsSentDate', 'تاريخ إرسال الملف للحسابات', v.ops.accountsSentDate)}
          ${dt('accountsApprovalDate', 'تاريخ موافقة الحسابات', v.ops.accountsApprovalDate)}
          ${readOnly
            ? `<div class="field"><label>Status</label><input value="${esc(na(v.ops.opsStatus))}" readonly /></div>`
            : `<div class="field"><label>Status</label>
            <select data-ops="opsStatus"><option value="">—</option>${statuses.map((s) => `<option ${v.ops.opsStatus === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          </div>`}
          ${yn('vin1502', 'Current VIN 1502?', v.ops.vin1502)}
          ${yn('trafficFile', 'ملف المرور', v.ops.trafficFile)}
          ${yn('trafficFeesOps', 'Traffic Fees', v.ops.trafficFeesOps)}
          ${yn('insuranceOps', 'Insurance', v.ops.insuranceOps)}
          ${dt('registrationIssueDate', 'تاريخ إصدار الاستمارة', v.ops.registrationIssueDate)}
          ${readOnly
            ? `<div class="field"><label>مدينة الترحيل</label><input value="${esc(na(v.ops.transferCity))}" readonly /></div>
               ${carrierField}
               <div class="field"><label>ملاحظات</label><textarea readonly>${esc(v.ops.notes || '')}</textarea></div>`
            : `<div class="field"><label>مدينة الترحيل</label>
            <input list="city-list" data-ops="transferCity" value="${esc(v.ops.transferCity || '')}" placeholder="Search city…" />
            <datalist id="city-list">${cities.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          </div>
          ${carrierField}
          <div class="field"><label>ملاحظات</label>
            <textarea data-ops="notes" rows="3">${esc(v.ops.notes || '')}</textarea>
          </div>`}
          <p class="hint" id="last-updated">Last updated: ${esc(v.ops.updatedAt || '—')}</p>
        </div>
      </div>
    `;
  }

  async function loadSalesRawPanel() {
    try {
      const data = await api('/raw-status');
      renderRawStatus(data.rawStatus);
    } catch {
      renderRawStatus(state.hubRaw);
    }
  }

  async function doSalesRawUpload(file) {
    if (!file) return;
    if (!canUploadSalesRaw()) {
      alert('Only Hanouf, Ruba, or Admin can upload Sales Raw');
      return;
    }
    const summary = $('#sales-raw-summary');
    summary.hidden = false;
    summary.innerHTML = `<p class="hint">Uploading ${esc(file.name)}…</p>`;
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`${API}/sales-raw`, {
        method: 'POST',
        headers: {
          'X-Delivery-Team-Token': state.token,
          'X-Filename': encodeURIComponent(file.name),
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (data.rawStatus) renderRawStatus(data.rawStatus);
      else await loadSalesRawPanel();
      state.liveFingerprint = '';
      summary.innerHTML = `
        <p><b>Sales Raw updated</b> · ${esc(data.sheetName || '')} · ${esc(data.filename || file.name)}</p>
        <div class="summary-grid">
          <div><strong>${data.imported || 0}</strong><span>Vehicles imported</span></div>
          <div><strong>${data.queueRefreshed || 0}</strong><span>Queue rows</span></div>
          <div><strong>${data.matchedUpdated || 0}</strong><span>Matched</span></div>
          <div><strong>${(data.deliveryTeamSync && data.deliveryTeamSync.upserted) || 0}</strong><span>Synced to team</span></div>
          <div><strong>${(data.deliveryTeamSync && data.deliveryTeamSync.updated) || 0}</strong><span>Rows refreshed</span></div>
          <div><strong>${(data.deliveryTeamSync && data.deliveryTeamSync.created) || 0}</strong><span>New on Live Sheet</span></div>
        </div>
        <p class="hint" style="margin-top:10px">Last update: <b>${esc(formatRawUpdatedAt(data.rawStatus && data.rawStatus.uploadedAt))}</b>
          ${data.rawStatus && data.rawStatus.uploadedByName ? ` · by ${esc(data.rawStatus.uploadedByName)}` : ''}
          — Live Sheet, Dashboard, Assignment &amp; All Vehicles refresh with this file</p>`;
      await refreshView();
    } catch (err) {
      summary.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  async function doUpload(file) {
    if (!file) return;
    const summary = $('#upload-summary');
    summary.hidden = false;
    summary.innerHTML = `<p class="hint">Uploading ${esc(file.name)}…</p>`;
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: {
          'X-Delivery-Team-Token': state.token,
          'X-Filename': encodeURIComponent(file.name),
          'X-Tz-Offset': String(state.tzOffset),
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const s = data.summary;
      summary.innerHTML = `
        <p><b>Sheet used:</b> ${esc(data.sheetName)} <span class="hint">(${esc(data.format || 'auto')})</span></p>
        <div class="summary-grid">
          <div><strong>${s.rowsProcessed}</strong><span>Rows processed</span></div>
          <div><strong>${s.newVins}</strong><span>New VINs</span></div>
          <div><strong>${s.updatedVins}</strong><span>Updated VINs</span></div>
          <div><strong>${s.assignedFromPic || 0}</strong><span>Assigned from PIC</span></div>
          <div><strong>${s.carriersSynced || 0}</strong><span>الناقل → company boards</span></div>
          <div><strong>${s.opsImported || 0}</strong><span>Ops / status imported</span></div>
          <div><strong>${s.todaysProformas}</strong><span>Today's dates</span></div>
          <div><strong>${s.skippedOtherMonth || 0}</strong><span>Skipped other months</span></div>
          <div><strong>${s.duplicateVins}</strong><span>Duplicate VINs</span></div>
          <div><strong>${s.errorCount}</strong><span>Errors</span></div>
        </div>
        ${s.skippedOtherMonth ? `<p class="hint" style="margin-top:8px">Ignored ${s.skippedOtherMonth} row(s) whose proforma is outside ${esc(s.currentMonth || 'this month')} — they do not appear on Live Sheet.</p>` : ''}
        ${s.picUnresolved ? `<p class="hint" style="color:var(--orange);margin-top:8px">${s.picUnresolved} PIC name(s) not matched (use Hanouf / Rasha / Ruba / Ibrahim·Ebrahim / Abdullah)</p>` : ''}
        ${s.errors && s.errors.length ? `<p class="hint" style="color:var(--red);margin-top:10px">${s.errors.slice(0, 8).map((e) => `Row ${e.row}: ${esc(e.error)}`).join(' · ')}</p>` : ''}`;
      state.liveFingerprint = '';
      await refreshView();
    } catch (err) {
      summary.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  async function doExport() {
    const res = await api('/export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-team-assigned.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showApp() {
    $('#login-screen').style.display = 'none';
    $('#app').classList.add('is-on');
    renderNav();
    if (state.user.role === 'hanouf') setView('live');
    else if (canManage()) setView('dashboard');
    else setView('my');
  }

  function logout(silent) {
    state.token = '';
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    $('#app').classList.remove('is-on');
    $('#login-screen').style.display = '';
    if (!silent) location.reload();
  }

  async function login() {
    const username = $('#login-user').value;
    const password = $('#login-pass').value;
    $('#login-error').textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', json: { username, password } });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message || 'Login failed';
    }
  }

  async function boot() {
    state.meta = await (await fetch(`${API}/meta`)).json();
    if (state.meta && state.meta.hubRaw) renderRawStatus(state.meta.hubRaw);
    const users = state.meta.users || [];
    $('#login-user').innerHTML = users.map((u) => `<option value="${esc(u.name)}">${esc(u.name)} (${esc(u.role)})</option>`).join('');
    $('#login-pills').innerHTML = users.map((u) =>
      `<button type="button" data-u="${esc(u.name)}">${esc(u.name)}</button>`
    ).join('');
    $$('#login-pills button').forEach((b) => b.addEventListener('click', () => {
      $('#login-user').value = b.dataset.u;
      $$('#login-pills button').forEach((x) => x.classList.toggle('active', x === b));
    }));

    if (state.token) {
      try {
        const me = await api('/auth/me');
        state.user = me.user;
        showApp();
        return;
      } catch {
        logout(true);
      }
    }
  }

  // Events
  $('#login-btn').addEventListener('click', login);
  $('#login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#logout-btn').addEventListener('click', () => logout());
  $('#refresh-btn').addEventListener('click', refreshView);
  $('#export-btn').addEventListener('click', () => doExport().catch((e) => alert(e.message)));
  $('#assign-submit-btn')?.addEventListener('click', () => submitVinsForDisplay().catch((e) => alert(e.message)));
  $('#assign-confirm-btn')?.addEventListener('click', () => doAssign().catch((e) => alert(e.message)));
  $('#assign-carrier-btn')?.addEventListener('click', () => doAssignCarrier().catch((e) => alert(e.message)));
  $('#assign-bulk-carrier')?.addEventListener('change', () => updateAssignConfirmState());
  $('#assign-load-month-unique')?.addEventListener('click', () => loadAssignPool('monthUnique').catch((e) => alert(e.message)));
  $('#assign-load-today')?.addEventListener('click', () => loadAssignPool('today').catch((e) => alert(e.message)));
  $('#assign-load-all-unassigned')?.addEventListener('click', () => loadAssignPool(false).catch((e) => alert(e.message)));
  $('#month-pf-month')?.addEventListener('change', () => loadToday().catch((e) => alert(e.message)));
  $('#month-pf-refresh')?.addEventListener('click', () => loadToday().catch((e) => alert(e.message)));
  $('#assign-clear-display')?.addEventListener('click', () => {
    state.assignDisplay = [];
    state.assignEmployee = '';
    renderAssignDisplay();
  });
  $('#my-reassign-clear')?.addEventListener('click', () => {
    state.reassignVins.clear();
    loadMy().catch((e) => alert(e.message));
  });
  $('#lane-reassign-close')?.addEventListener('click', () => {
    state.reassignFrom = '';
    state.reassignRows = [];
    state.reassignVins.clear();
    $('#lane-reassign-panel').hidden = true;
  });
  $('#lane-reassign-clear')?.addEventListener('click', () => {
    state.reassignVins.clear();
    renderScheduleTable($('#lane-reassign-table'), state.reassignRows, {
      selectable: true,
      selectionSet: state.reassignVins,
    });
    updateLaneReassignCount();
  });
  $('#lane-reassign-select-all')?.addEventListener('click', () => {
    (state.reassignRows || []).forEach((r) => state.reassignVins.add(r.vin));
    renderScheduleTable($('#lane-reassign-table'), state.reassignRows, {
      selectable: true,
      selectionSet: state.reassignVins,
    });
    updateLaneReassignCount();
  });
  $('#assign-pool-search')?.addEventListener('input', () => renderAssignPool());
  $('#dash-edits-refresh')?.addEventListener('click', () => loadDashboard().catch((e) => alert(e.message)));
  $('#dash-month')?.addEventListener('change', (e) => {
    state.monthFilter = e.target.value || '';
    state.filters.month = state.monthFilter;
    loadDashboard().catch((err) => alert(err.message));
  });
  $('#dash-month-all')?.addEventListener('click', () => {
    // Counts stay on current proforma month (other months are ignored)
    state.monthFilter = currentMonthValue();
    state.filters.month = state.monthFilter;
    if ($('#dash-month')) $('#dash-month').value = state.monthFilter;
    loadDashboard().catch((err) => alert(err.message));
  });
  $('#live-refresh')?.addEventListener('click', () => loadLiveSheet().catch((e) => alert(e.message)));
  $('#live-q')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    state.liveFilters.q = e.target.value.trim();
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#live-employee')?.addEventListener('change', (e) => {
    state.liveFilters.employee = e.target.value;
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#live-carrier')?.addEventListener('change', (e) => {
    state.liveFilters.carrier = e.target.value;
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#live-status')?.addEventListener('change', (e) => {
    state.liveFilters.status = e.target.value;
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#live-month')?.addEventListener('change', (e) => {
    state.liveFilters.month = e.target.value || currentMonthValue();
    if ($('#live-month')) $('#live-month').value = state.liveFilters.month;
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#audit-refresh').addEventListener('click', () => { state.filters.page = 1; loadAudit(); });
  $('#audit-vin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.filters.page = 1; loadAudit(); }
  });
  $('#global-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    state.filters.q = e.target.value.trim();
    state.filters.page = 1;
    setView(canManage() ? 'all' : 'my');
  });

  const drop = $('#upload-drop');
  const fileInput = $('#upload-file');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => doUpload(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    doUpload(e.dataTransfer.files[0]);
  });

  const salesRawDrop = $('#sales-raw-drop');
  const salesRawFile = $('#sales-raw-file');
  if (salesRawDrop && salesRawFile) {
    salesRawDrop.addEventListener('click', () => salesRawFile.click());
    salesRawFile.addEventListener('change', () => {
      doSalesRawUpload(salesRawFile.files[0]);
      salesRawFile.value = '';
    });
    salesRawDrop.addEventListener('dragover', (e) => { e.preventDefault(); salesRawDrop.classList.add('drag'); });
    salesRawDrop.addEventListener('dragleave', () => salesRawDrop.classList.remove('drag'));
    salesRawDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      salesRawDrop.classList.remove('drag');
      doSalesRawUpload(e.dataTransfer.files[0]);
    });
  }

  boot().catch((err) => {
    console.error(err);
    $('#login-error').textContent = 'Cannot reach server';
  });
})();
