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
    liveFilters: { q: '', employee: '', status: '', month: '', carrier: '', proforma: '' },
    liveFingerprint: '',
    monthFilter: '',
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

  /** Customer / phone / invoice owner — Admin + Hanouf. */
  function canSeePii() {
    return !!(state.user && (state.user.role === 'admin' || state.user.role === 'hanouf'));
  }

  function displayName(value) {
    if (!canSeePii()) return '—';
    const s = String(value == null ? '' : value).trim();
    return s || '—';
  }

  function displayPhone(value) {
    if (!canSeePii()) return '—';
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
    if (v === 'جاهز للتسليم') return 'row-status-ready';
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
    if (v === 'PSFU' || v === 'تم التسليم') return `<span class="badge ok">${esc(v)}</span>`;
    if (v === 'جاهز للتسليم') return `<span class="badge warn">${esc(v)}</span>`;
    if (v === 'مرور') return `<span class="badge">${esc(v)}</span>`;
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

  function canEditVinOps(row) {
    if (canManage()) return true;
    if (!state.user || !row || !row.ops) return false;
    return row.ops.assignedEmployeeId === state.user.id
      || row.ops.assignedEmployeeName === state.user.name;
  }

  /** الناقل locked after first selection (Admin may still change). */
  function isCarrierLocked(row) {
    const has = !!(row && row.ops && String(row.ops.carrier || '').trim());
    if (!has) return false;
    return !(state.user && state.user.role === 'admin');
  }

  function carrierCellHtml(row, { allowEdit = false } = {}) {
    const val = row && row.ops ? row.ops.carrier : '';
    if (allowEdit && !isCarrierLocked(row)) {
      return editableControl(row.vin, 'carrier', 'carrier', val);
    }
    const label = na(val);
    if (String(val || '').trim()) {
      return `<span class="badge" title="الناقل مقفل بعد التعيين">${esc(label)}</span>`;
    }
    return esc(label);
  }

  function hubSyncToast(hubSync) {
    if (!hubSync || typeof hubSync !== 'object') return '';
    const moved = Number(hubSync.added || 0) + Number(hubSync.reassigned || 0);
    const city = Number(hubSync.cityUpdated || 0);
    const parts = [];
    if (moved) parts.push(`${moved} → لوحة الشركة`);
    if (city) parts.push(`مدينة ${city}`);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
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

  function guestCellHtml(r) {
    const ops = r.ops || {};
    const isGuest = !!(r.guestCenter || String(ops.guestCenter || '').toLowerCase() === 'yes' || ops.guestCollectAt);
    const collected = String(ops.guestCollected || '') === 'Yes';
    const due = !!r.guestDue || (ops.guestCollectAt && (r.guestTimerMs == null ? false : r.guestTimerMs <= 0) && !collected);
    const canEdit = canEditGuest(r);

    if (collected) {
      return `<span class="guest-badge collected">Collected ✓</span>
        <div class="hint">${esc(formatGuestAt(ops.guestCollectAt))}</div>`;
    }

    if (!isGuest) {
      if (!canEdit) return '<span class="hint">—</span>';
      return `<button type="button" class="btn-guest" data-guest-act="mark" data-vin="${esc(r.vin)}">Guest Exp</button>`;
    }

    if (!ops.guestCollectAt) {
      if (!canEdit) return `<span class="guest-badge">Guest Exp</span>`;
      return `<button type="button" class="btn-guest" data-guest-act="schedule" data-vin="${esc(r.vin)}">Schedule pickup</button>`;
    }

    if (due && canEdit) {
      return `<span class="guest-timer is-due">DUE NOW</span>
        <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">
          <button type="button" class="btn-guest due" data-guest-act="collected-yes" data-vin="${esc(r.vin)}">Collected?</button>
          <button type="button" class="btn-guest" data-guest-act="collected-no" data-vin="${esc(r.vin)}">Not yet</button>
        </div>
        <div class="hint">${esc(formatGuestAt(ops.guestCollectAt))}</div>`;
    }

    const ms = r.guestTimerMs != null
      ? r.guestTimerMs
      : (ops.guestCollectAt ? new Date(ops.guestCollectAt).getTime() - Date.now() : null);
    return `<span class="guest-badge">Guest Exp</span>
      <span class="guest-timer" data-guest-timer="${esc(ops.guestCollectAt)}">${esc(formatCountdown(ms))}</span>
      <div class="hint">${esc(formatGuestAt(ops.guestCollectAt))}</div>
      ${canEdit ? `<button type="button" class="btn-guest" data-guest-act="schedule" data-vin="${esc(r.vin)}" style="margin-top:4px">Reschedule</button>` : ''}`;
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
      { id: 'today', label: "Today's Vehicles", roles: ['admin', 'hanouf'] },
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
      today: ["Today's Vehicles", 'Proforma Date = today'],
      my: ['My VINs', 'Your schedule · edit your work · الناقل'],
      assign: ['Assignment', 'Upload → assign employee (incl. Hanouf) → الناقل'],
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
    const params = new URLSearchParams();
    params.set('tzOffset', String(state.tzOffset));
    params.set('sort', 'updatedAt');
    params.set('dir', 'desc');
    if (f.q) params.set('q', f.q);
    if (f.employee) params.set('employee', f.employee);
    if (f.status) params.set('status', f.status);
    if (f.carrier) params.set('carrier', f.carrier);
    if (f.month) params.set('month', f.month);
    if (f.proforma) params.set('proforma', f.proforma);
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
      meta.textContent = `${data.total || 0} assigned VINs${monthNote} · live · last sync ${t}${changed && silent ? ' · updated' : ''}`;
    }
    if (dot) {
      dot.classList.toggle('pulse', !!changed || !silent);
      setTimeout(() => dot && dot.classList.remove('pulse'), 900);
    }

    if (!changed && silent) return;

    fillCarrierLists();
    fillCityLists();

    const cols = [
      { key: 'num', label: '#', html: (_r, i) => i + 1 },
      { key: 'employee', label: 'Employee', html: (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>` },
      { key: 'status', label: 'Status', html: (r) => `<span class="cell-status">${statusBadge(r.ops.opsStatus)}</span>` },
      { key: 'vin', label: 'VIN', html: (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>` },
      { key: 'proforma', label: 'Proforma', html: (r) => na(r.raw.proformaDate) },
      { key: 'order', label: 'Order', html: (r) => na(r.raw.salesOrder) },
      { key: 'product', label: 'Product', html: (r) => na(r.raw.product) },
      { key: 'salestype', label: 'Sales Type', html: (r) => na(r.raw.salesType) },
      ...(canSeePii() ? [
        { key: 'owner', label: 'Owner', html: (r) => na(r.raw.invoiceOwner) },
        { key: 'customer', label: 'Customer', html: (r) => displayName(r.raw.userName) },
      ] : []),
      { key: 'sa', label: 'S/A', html: (r) => na(r.raw.salesAdvisor) },
      ...(canSeePii() ? [
        { key: 'phone', label: 'Phone', html: (r) => displayPhone(r.raw.phone) },
      ] : []),
      { key: 'guest', label: 'Guest Exp', html: (r) => guestCellHtml(r) },
      { key: 'gt', label: 'GT Loc', html: (r) => na(r.raw.gtLocation) },
      { key: 'veh', label: 'Veh Loc', html: (r) => na(r.raw.vehicleLocation) },
      { key: 'guestsent', label: 'إرسال الضيف', html: (r) => na(r.ops.guestSentDate) },
      { key: 'sig', label: 'استلام التواقيع', html: (r) => na(r.ops.signatureReceivedDate) },
      { key: 'accsent', label: 'إرسال للحسابات', html: (r) => na(r.ops.accountsSentDate) },
      { key: 'accok', label: 'موافقة الحسابات', html: (r) => na(r.ops.accountsApprovalDate) },
      { key: 'vin1502', label: 'VIN 1502', html: (r) => ynBadge(r.ops.vin1502) },
      { key: 'traffic', label: 'ملف المرور', html: (r) => ynBadge(r.ops.trafficFile) },
      { key: 'fees', label: 'Traffic Fees', html: (r) => ynBadge(r.ops.trafficFeesOps) },
      { key: 'ins', label: 'Insurance', html: (r) => ynBadge(r.ops.insuranceOps) },
      { key: 'reg', label: 'إصدار الاستمارة', html: (r) => na(r.ops.registrationIssueDate) },
      {
        key: 'city',
        label: 'مدينة الترحيل',
        html: (r) => (canEditVinOps(r)
          ? editableControl(r.vin, 'transferCity', 'city', r.ops.transferCity)
          : na(r.ops.transferCity)),
      },
      {
        key: 'carrier',
        label: 'الناقل',
        html: (r) => carrierCellHtml(r, { allowEdit: canEditVinOps(r) }),
      },
      { key: 'notes', label: 'ملاحظات', html: (r) => esc(r.ops.notes || '') },
      { key: 'updated', label: 'Updated', html: (r) => esc((r.ops.updatedAt || '').replace('T', ' ').slice(0, 19) || '—') },
      { key: 'by', label: 'By', html: (r) => na(r.ops.updatedBy) },
    ];

    const table = $('#live-table');
    table.innerHTML = `<thead><tr>${cols.map((c) => `<th class="col-${c.key}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => {
        const statusCls = statusRowClass(r.ops.opsStatus);
        const guestCls = (r.guestCenter || r.ops.guestCollectAt) ? 'row-guest-exp' : '';
        return `<tr class="${statusCls} ${guestCls}" data-vin="${esc(r.vin)}">${cols.map((c) =>
          `<td class="col-${c.key}">${c.html(r, i)}</td>`
        ).join('')}</tr>`;
      }).join('') || `<tr><td colspan="${cols.length}">No assigned VINs yet. Use Assignment to assign vehicles.</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindGuestButtons(table);
    bindEditableCells(table);
  }

  async function loadDashboard() {
    const month = state.monthFilter || '';
    const d = await api(`/dashboard?tzOffset=${state.tzOffset}${month ? `&month=${encodeURIComponent(month)}` : ''}`);
    if (d.hubRaw) renderRawStatus(d.hubRaw);
    const monthInp = $('#dash-month');
    if (monthInp && monthInp.value !== month) monthInp.value = month;
    const hint = $('#dash-month-hint');
    if (hint) hint.textContent = month ? `Showing ${month}` : 'Showing all months';

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
      // Everyone sees the full team schedule (assigned / claimed / cash·bank sales types)
      const showRows = rows.filter((e) => e.assigned > 0 || canManage());
      const typeKeys = [...new Set(showRows.flatMap((e) => Object.keys(e.bySalesType || {})))].sort();
      const meId = state.user && state.user.id;
      const meName = state.user && state.user.name;
      $('#dash-emp-table').innerHTML = `<thead><tr>
          <th>Employee</th>
          <th class="num">Assigned</th>
          <th class="num">Claimed</th>
          <th class="num">Remaining</th>
          <th class="num">Progress %</th>
          ${typeKeys.map((k) => `<th class="num">${esc(k)}</th>`).join('')}
        </tr></thead>
        <tbody>${showRows.map((e) => {
          const isMe = e.id === meId || e.name === meName;
          return `<tr data-emp="${esc(e.name)}" class="${isMe ? 'is-me' : ''}" style="cursor:pointer" title="Open ${esc(e.name)} schedule on Live Sheet">
          <td><b>${esc(e.name)}</b>${isMe ? ' <span class="badge info">you</span>' : ''}</td>
          <td class="num">${e.assigned}</td>
          <td class="num">${e.claimed}</td>
          <td class="num">${e.remaining}</td>
          <td class="num">${e.progress}%</td>
          ${typeKeys.map((k) => `<td class="num">${(e.bySalesType && e.bySalesType[k]) || 0}</td>`).join('')}
        </tr>`;
        }).join('') || '<tr><td colspan="5">No assigned VINs in this month</td></tr>'}</tbody>`;
      $$('#dash-emp-table tr[data-emp]').forEach((tr) => {
        tr.addEventListener('click', () => {
          state.liveFilters.employee = tr.dataset.emp || '';
          state.liveFilters.month = state.monthFilter || state.liveFilters.month || '';
          state.liveFilters.status = '';
          state.liveFilters.q = '';
          if ($('#live-employee')) {
            $('#live-employee').value = state.liveFilters.employee;
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
        <option value="Yes" ${v === 'Yes' ? 'selected' : ''}>🟢 Yes</option>
        <option value="No" ${v === 'No' ? 'selected' : ''}>🔴 No</option>
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
      return `<select ${common}><option value="">— الناقل —</option>${carriers.map((c) =>
        `<option value="${esc(c)}" ${v === c ? 'selected' : ''}>${esc(c)}</option>`
      ).join('')}</select>`;
    }
    if (type === 'notes') {
      return `<input type="text" ${common} value="${esc(v)}" placeholder="Notes…" style="min-width:140px" />`;
    }
    return esc(v || '—');
  }

  function scheduleColumns({ editable = false, carrierEditable = false, hideCarrier = false } = {}) {
    const cols = [
      ['Proforma', (r) => na(r.raw.proformaDate)],
      ['Order', (r) => na(r.raw.salesOrder)],
      ['VIN', (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['S/A name', (r) => na(r.raw.salesAdvisor)],
      ['Sales Type', (r) => na(r.raw.salesType)],
      ['Product', (r) => na(r.raw.product)],
    ];
    if (canSeePii()) {
      cols.push(
        ['Invoice Owner', (r) => na(r.raw.invoiceOwner)],
        ['Customer Name', (r) => displayName(r.raw.userName)],
      );
    }
    cols.push(
      ['GT Loc', (r) => na(r.raw.gtLocation)],
      ['Veh Loc', (r) => na(r.raw.vehicleLocation)],
    );
    if (canSeePii()) {
      cols.push(['Phone', (r) => displayPhone(r.raw.phone)]);
    }
    cols.push(['Guest Exp', (r) => guestCellHtml(r)]);
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
      );
      if (!hideCarrier) {
        cols.push(['الناقل', (r) => carrierCellHtml(r, { allowEdit: true })]);
      }
      cols.push(
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
      );
      if (!hideCarrier) {
        cols.push(['الناقل', (r) => (carrierEditable
          ? carrierCellHtml(r, { allowEdit: true })
          : carrierCellHtml(r, { allowEdit: false }))]);
      }
      cols.push(
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
      const res = await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: { [field]: value } });
      el.classList.remove('is-saving');
      el.classList.add('is-saved');
      if (field === 'opsStatus') {
        const tr = el.closest('tr');
        if (tr) {
          tr.classList.remove(
            'row-status-claimed', 'row-status-psfu', 'row-status-ready',
            'row-status-traffic', 'row-status-traffic-return', 'row-status-pending', 'row-status-cancel'
          );
          const cls = statusRowClass(value);
          if (cls) tr.classList.add(cls);
          tr.dataset.status = value || '';
        }
      }
      const toast = $('#my-save-toast');
      if (toast) {
        toast.hidden = false;
        toast.textContent = `Saved ✓ ${fieldLabel(field)}${hubSyncToast(res.hubSync)} · ${new Date().toLocaleTimeString()}`;
        setTimeout(() => { toast.hidden = true; }, 2800);
      } else if (field === 'carrier' || field === 'transferCity') {
        const note = hubSyncToast(res.hubSync);
        if (note) {
          // Live Sheet has no toast strip — brief title flash
          const prev = document.title;
          document.title = `Saved${note}`;
          setTimeout(() => { document.title = prev; }, 2000);
        }
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
    ['#edit-carrier-list', '#all-carrier-list'].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
  }

  function fillCityLists() {
    const cities = (state.meta && state.meta.transferCities) || [];
    const html = cities.map((c) => `<option value="${esc(c)}"></option>`).join('');
    const el = $('#edit-city-list');
    if (el) el.innerHTML = html;
  }

  function renderScheduleTable(tableEl, rows, {
    selectable = false,
    editable = false,
    carrierEditable = false,
    hideCarrier = false,
    selectionSet = null,
  } = {}) {
    const selected = selectionSet || state.selectedVins;
    const cols = scheduleColumns({ editable, carrierEditable, hideCarrier });
    const head = `<thead><tr>${selectable ? '<th></th>' : ''}${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows.map((r) => {
      const statusCls = statusRowClass(r.ops.opsStatus);
      const guestCls = (r.guestCenter || r.ops.guestCollectAt) ? 'row-guest-exp' : '';
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
    const data = await api(`/todays-proformas?tzOffset=${state.tzOffset}`);
    renderScheduleTable($('#today-table'), data.rows || [], { carrierEditable: canManage() });
  }

  async function loadMy() {
    // Hanouf "My VINs" = her assignments with today's proforma only
    if (state.user.role === 'hanouf') {
      state.filters.employee = 'Hanouf';
    }
    const myHint = $('#my-vins-hint');
    if (myHint) {
      myHint.textContent = state.user.role === 'hanouf'
        ? 'Today’s Proforma only · edit your work · select VINs to hand over'
        : 'Edit your work below · select VINs to hand over to another employee';
    }
    buildToolbar($('#my-toolbar'), { showEmployee: false });
    const cities = (state.meta && state.meta.transferCities) || [];
    const carriers = (state.meta && state.meta.carriers) || [];
    const cityList = $('#edit-city-list');
    const carrierList = $('#edit-carrier-list');
    if (cityList) cityList.innerHTML = cities.map((c) => `<option value="${esc(c)}"></option>`).join('');
    if (carrierList) carrierList.innerHTML = carriers.map((c) => `<option value="${esc(c)}"></option>`).join('');
    fillCarrierLists();

    const pack = await api(`/vehicles?${filterQuery(
      state.user.role === 'hanouf' ? { proforma: 'today' } : {}
    )}`);
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
    renderPager($('#my-pager'), pack, (p) => { state.filters.page = p; loadMy(); });
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
    await loadAssignPool();
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

  async function loadAssignPool() {
    const data = await api(`/unassigned?tzOffset=${state.tzOffset}`);
    state.assignPool = data.rows || [];
    renderAssignPool();
    const today = data.today || '';
    const yesterday = data.yesterday || '';
    $('#assign-pool-hint').textContent = `${state.assignPool.length} unassigned · proforma ${today || 'today'} / ${yesterday || 'yesterday'} · check VINs then Submit & display`;
  }

  function renderAssignPool() {
    const q = String($('#assign-pool-search')?.value || '').trim().toLowerCase();
    let rows = state.assignPool || [];
    if (q) {
      rows = rows.filter((r) =>
        `${r.vin} ${r.raw.product} ${r.raw.salesOrder} ${r.raw.salesType} ${r.raw.salesAdvisor}`.toLowerCase().includes(q)
      );
    }
    const cols = [
      ['VIN', (r) => esc(r.vin)],
      ['S/A name', (r) => na(r.raw.salesAdvisor)],
      ['Order', (r) => na(r.raw.salesOrder)],
      ['Product', (r) => na(r.raw.product)],
      ['Sales Type', (r) => na(r.raw.salesType)],
      ['Proforma', (r) => na(r.raw.proformaDate)],
      ['Status', (r) => statusBadge(r.ops.opsStatus)],
    ];
    const head = `<thead><tr><th></th>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows.map((r) => {
      const checked = state.selectedVins.has(r.vin) ? 'checked' : '';
      return `<tr class="${checked ? 'selected' : ''}">
        <td><input class="checkbox assign-pool-check" type="checkbox" data-vin="${esc(r.vin)}" ${checked} /></td>
        ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}
      </tr>`;
    }).join('') || '<tr><td colspan="8">No unassigned VINs with today’s or yesterday’s proforma.</td></tr>'}</tbody>`;
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
    const data = await api('/resolve-vins', {
      method: 'POST',
      json: { vins, tzOffset: state.tzOffset },
    });
    state.assignDisplay = data.rows || [];
    const notes = [];
    if (data.missing && data.missing.length) {
      notes.push(`${data.missing.length} not found in Raw Data:\n${data.missing.slice(0, 12).join('\n')}`);
    }
    if (data.alreadyAssigned && data.alreadyAssigned.length) {
      notes.push(
        `${data.alreadyAssigned.length} already assigned (skipped):\n`
        + data.alreadyAssigned.slice(0, 12).map((x) => `${x.vin} → ${x.employee || '—'}`).join('\n')
      );
    }
    if (data.outOfWindow && data.outOfWindow.length) {
      notes.push(
        `${data.outOfWindow.length} skipped (proforma must be today ${data.today || ''} or yesterday ${data.yesterday || ''}):\n`
        + data.outOfWindow.slice(0, 12).map((x) => `${x.vin} · ${x.proformaDate}`).join('\n')
      );
    }
    if (notes.length) alert(notes.join('\n\n'));
    if (!state.assignDisplay.length) {
      alert('No assignable VINs left. Already assigned / out of date / missing from Raw Data.');
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
    renderScheduleTable($('#assign-display-table'), rows, { selectable: false, hideCarrier: true });
    updateAssignConfirmState();
  }

  function updateAssignConfirmState() {
    const emp = state.assignEmployee;
    const has = (state.assignDisplay || []).length > 0;
    $('#assign-confirm-btn').disabled = !(emp && has);
    $('#assign-picked-label').textContent = emp
      ? `Selected: ${emp} · ${state.assignDisplay.length} VIN(s)`
      : 'No employee selected';
    $$('.assign-emp-btn').forEach((b) => b.classList.toggle('active', b.dataset.emp === emp));
  }

  async function doAssign() {
    const employee = state.assignEmployee;
    const vins = (state.assignDisplay || []).map((r) => r.vin);
    if (!employee) return alert('Choose an employee first');
    if (!vins.length) return alert('Submit & display VINs first');
    const res = await api('/assign', {
      method: 'POST',
      json: { vins, employee, tzOffset: state.tzOffset },
    });
    const ok = (res.results || []).filter((r) => r.ok).length;
    const failed = (res.results || []).filter((r) => !r.ok);
    let msg = `Assigned ${ok} VIN(s) to ${employee}`;
    if (failed.length) {
      msg += `\n${failed.length} failed:\n${failed.slice(0, 8).map((r) => `${r.vin}: ${r.error}`).join('\n')}`;
    }
    alert(msg);
    state.assignDisplay = [];
    state.assignEmployee = '';
    await loadAssign();
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
    const canEdit = canManage() || isMine;

    drawer.innerHTML = buildDrawerHtml(v, statuses, cities, carriers, { readOnly: !canEdit });
    back.classList.add('open');
    $('#drawer-close', drawer).onclick = () => back.classList.remove('open');
    back.onclick = (e) => { if (e.target === back) back.classList.remove('open'); };

    if (!canEdit) return;

    async function savePatch(patch) {
      try {
        const res = await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: patch });
        const line = $('#save-line', drawer);
        line.hidden = false;
        line.textContent = `Saved ✓${hubSyncToast(res.hubSync)} · ${new Date(res.lastUpdated).toLocaleTimeString()}`;
        $('#last-updated', drawer).textContent = `Last updated: ${res.lastUpdated}`;
        setTimeout(() => { line.hidden = true; }, 2800);
      } catch (err) {
        alert(err.message || 'Save failed');
      }
    }

    $$('[data-ops]', drawer).forEach((el) => {
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

  function buildDrawerHtml(v, statuses, cities, carriers, opts = {}) {
    const readOnly = !!opts.readOnly;
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
            ...(canSeePii() ? [
              ['Invoice Owner', v.raw.invoiceOwner],
              ['Customer Name', displayName(v.raw.userName)],
            ] : []),
            ['S/A', v.raw.salesAdvisor],
            ['GT Location', v.raw.gtLocation], ['Vehicle Location', v.raw.vehicleLocation],
            ...(canSeePii() ? [['Phone', displayPhone(v.raw.phone)]] : []),
            ['PIC', v.raw.pic],
          ].map(([l, val]) => `<div class="field"><label>${esc(l)}</label><input value="${esc(na(val))}" readonly /></div>`).join('')}
        </div>
        <div class="card">
          <h2>Delivery information${readOnly ? ' (teammate — view only)' : ''}</h2>
          <p class="hint">${readOnly ? 'Read-only · teammate schedule' : 'Employee updates · saves immediately'}</p>
          <div id="save-line" class="save-toast" hidden>Saved ✓</div>
          ${dt('guestSentDate', 'تاريخ إرسال الضيف', v.ops.guestSentDate)}
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
               <div class="field"><label>الناقل</label><input value="${esc(na(v.ops.carrier))}" readonly /></div>
               <div class="field"><label>ملاحظات</label><textarea readonly>${esc(v.ops.notes || '')}</textarea></div>`
            : `<div class="field"><label>مدينة الترحيل</label>
            <input list="city-list" data-ops="transferCity" value="${esc(v.ops.transferCity || '')}" placeholder="Search city…" />
            <datalist id="city-list">${cities.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          </div>
          <div class="field"><label>الناقل${String(v.ops.carrier || '').trim() && state.user.role !== 'admin' ? ' (مقفل)' : ''}</label>
            ${String(v.ops.carrier || '').trim() && state.user.role !== 'admin'
              ? `<input value="${esc(na(v.ops.carrier))}" readonly title="الناقل مقفل بعد التعيين" />`
              : `<input list="carrier-list" data-ops="carrier" value="${esc(v.ops.carrier || '')}" placeholder="Search carrier…" />
            <datalist id="carrier-list">${carriers.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>`}
          </div>
          <div class="field"><label>ملاحظات</label>
            <textarea data-ops="notes">${esc(v.ops.notes || '')}</textarea>
          </div>`}
          <p class="hint" id="last-updated">Last updated: ${esc(v.ops.updatedAt || '—')}</p>
        </div>
      </div>`;
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
      summary.innerHTML = `
        <p><b>Sales Raw updated</b> · ${esc(data.sheetName || '')} · ${esc(data.filename || file.name)}</p>
        <div class="summary-grid">
          <div><strong>${data.imported || 0}</strong><span>Vehicles imported</span></div>
          <div><strong>${data.queueRefreshed || 0}</strong><span>Queue rows</span></div>
          <div><strong>${data.matchedUpdated || 0}</strong><span>Matched</span></div>
          <div><strong>${(data.deliveryTeamSync && data.deliveryTeamSync.upserted) || 0}</strong><span>Synced to team</span></div>
        </div>
        <p class="hint" style="margin-top:10px">Last update: <b>${esc(formatRawUpdatedAt(data.rawStatus && data.rawStatus.uploadedAt))}</b>
          ${data.rawStatus && data.rawStatus.uploadedByName ? ` · by ${esc(data.rawStatus.uploadedByName)}` : ''}
          — visible to all users</p>`;
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
          <div><strong>${s.duplicateVins}</strong><span>Duplicate VINs</span></div>
          <div><strong>${s.errorCount}</strong><span>Errors</span></div>
        </div>
        ${s.picUnresolved ? `<p class="hint" style="color:var(--orange);margin-top:8px">${s.picUnresolved} PIC name(s) not matched (use Hanouf / Rasha / Ruba / Ibrahim·Ebrahim / Abdullah)</p>` : ''}
        ${s.errors && s.errors.length ? `<p class="hint" style="color:var(--red);margin-top:10px">${s.errors.slice(0, 8).map((e) => `Row ${e.row}: ${esc(e.error)}`).join(' · ')}</p>` : ''}`;
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
  $('#assign-load-today')?.addEventListener('click', () => loadAssignPool().catch((e) => alert(e.message)));
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
    state.monthFilter = '';
    state.filters.month = '';
    if ($('#dash-month')) $('#dash-month').value = '';
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
    state.liveFilters.month = e.target.value || '';
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
