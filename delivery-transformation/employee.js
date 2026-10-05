/* Delivery Transformation — employee app (same layout & flow as deliveryteam) */
(() => {
  const { api, esc, getToken, getUser, setSession, clearSession, downloadFile, useSessionScope, migrateLegacySession } = window.DTX;
  useSessionScope('employee');
  migrateLegacySession((u) => u.role === 'hanouf' || u.role === 'employee');

  const state = {
    user: null,
    meta: null,
    view: 'dashboard',
    monthFilter: '',
    liveFilters: { q: '', employee: '', status: '', month: '', carrier: '' },
    myFilters: { q: '', status: '' },
    liveFingerprint: '',
    liveTimer: null,
    liveInFlight: false,
    guestTick: null,
    appointmentOpen: 0,
    appointmentDue: 0,
    selected: new Set(),
    selInfo: {},
    rowIndex: {},
    liveOnlySelected: false,
    liveCols: [],
    liveColFilters: {},
    liveSel: null,
    liveCopyFlash: false,
    liveCopyTimer: null,
  };

  const sheetGrids = {
    live: { prefix: 'live', cols: [], filters: {}, sel: null, copyFlash: false, cfNote: '', copyTimer: null },
    my: { prefix: 'my', cols: [], filters: {}, sel: null, copyFlash: false, cfNote: '', copyTimer: null },
  };
  let grid = sheetGrids.live;
  const gTable = () => $(`#${grid.prefix}-table`);
  const gInfo = () => $(`#${grid.prefix}-copy-info`);
  const gCopy = () => $(`#${grid.prefix}-copy-btn`);
  const gVals = () => $(`#${grid.prefix}-copy-values`);
  const gClear = () => $(`#${grid.prefix}-cf-clear`);
  const gList = () => $(`#${grid.prefix}-cf-list`);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function na(v) {
    const s = String(v ?? '').trim();
    return s && s !== 'N/A' ? s : 'N/A';
  }

  function isAdmin() {
    return !!(state.user && state.user.role === 'admin');
  }

  /** Admin + Hanouf: see and edit every VIN, upload VINs and Sales Raw. */
  function isManager() {
    return !!(state.user && (state.user.role === 'admin' || state.user.role === 'hanouf'));
  }

  function canUploadSalesRaw() {
    return isManager() || !!(state.user && state.user.canUploadSalesRaw);
  }

  function canEditAnyVin() {
    return isManager() || !!(state.user && state.user.canEditAnyVin);
  }

  /** Hanouf + Rasha only: assign الناقل (carrier company). */
  function canAssignCarrier() {
    return !!(state.user && state.user.canAssignCarrier);
  }

  function isRuba() {
    return !!(state.user && state.user.id === 'ruba');
  }

  function canManageAppointments() {
    return isRuba() || !!(state.user && state.user.canManageAppointments);
  }

  function isGuestYes(r) {
    const raw = String((r && r.ops && r.ops.guestCenter) || '').trim().toLowerCase();
    return raw === 'yes' || raw === 'y';
  }

  function parseGuestAt(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, '0')}s`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }

  function formatCountdown(iso) {
    const t = parseGuestAt(iso);
    if (!t) return { text: 'Set time', due: false };
    const ms = t - Date.now();
    if (ms <= 0) return { text: `Due ${formatDuration(Math.abs(ms))} ago`, due: true };
    return { text: formatDuration(ms), due: false };
  }

  function splitLocalAt(at) {
    const m = String(at || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    return { date: m ? m[1] : '', time: m ? m[2] : '' };
  }

  function guestTimerHtml(ops) {
    const at = (ops && ops.guestCollectAt) || '';
    if (!at) return '<span class="guest-timer" data-guest-timer="">Set time</span>';
    const c = formatCountdown(at);
    const when = at.replace('T', ' ').slice(0, 16);
    return `<span class="guest-timer ${c.due ? 'is-due' : ''}" data-guest-timer="${esc(at)}" title="${esc(when)}">${esc(c.text)}</span>`;
  }

  function tickGuestTimers() {
    $$('[data-guest-timer]').forEach((el) => {
      const at = el.getAttribute('data-guest-timer');
      if (!at) {
        el.textContent = 'Set time';
        el.classList.remove('is-due');
        return;
      }
      const c = formatCountdown(at);
      el.textContent = c.text;
      el.classList.toggle('is-due', c.due);
    });
  }

  function startGuestTick() {
    if (state.guestTick) return;
    state.guestTick = setInterval(tickGuestTimers, 1000);
  }

  function formatWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  function renderImports(imports) {
    const raw = (imports && imports.lastSalesRaw) || null;
    const pill = $('#raw-status-pill');
    if (pill) {
      pill.classList.toggle('is-empty', !raw);
      pill.classList.toggle('is-fresh', !!raw
        && Date.now() - new Date(raw.at).getTime() < 24 * 60 * 60 * 1000);
      $('#raw-status-time').textContent = raw ? formatWhen(raw.at) : 'Not uploaded';
      pill.title = raw ? `Sales Raw by ${raw.by} · ${raw.filename}` : 'Sales Raw not uploaded yet';
    }
    const rawCard = $('#sales-raw-last');
    if (rawCard) {
      rawCard.textContent = raw
        ? `${formatWhen(raw.at)} · ${raw.by} · ${raw.filename} · ${raw.updated} VIN(s) updated`
        : 'Not uploaded yet';
    }
    const up = (imports && imports.lastUpload) || null;
    const upCard = $('#upload-last');
    if (upCard) {
      upCard.textContent = up
        ? `${formatWhen(up.at)} · ${up.by} · ${up.filename} · ${up.month}: ${up.created} new, ${up.updated} updated`
        : 'Not uploaded yet';
    }
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
    if (v === 'تسليم متقدم') return 'row-status-advance';
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
    if (v === 'تسليم متقدم') return `<span class="badge st-advance">${esc(v)}</span>`;
    if (v === 'صادرة' || v === 'صادر') return `<span class="badge st-issued">${esc(v)}</span>`;
    if (v === 'مرور') return `<span class="badge">${esc(v)}</span>`;
    if (v === 'رجوع مرور') return `<span class="badge purple">${esc(v)}</span>`;
    if (v === 'معلقة') return `<span class="badge st-hold">${esc(v)}</span>`;
    if (v === 'الغاء') return `<span class="badge bad">${esc(v)}</span>`;
    return `<span class="badge warn">${esc(v)}</span>`;
  }

  const FIELD_LABELS = {
    opsStatus: 'Status',
    guestSentDate: 'إرسال الضيف',
    signatureReceivedDate: 'استلام التواقيع',
    accountsSentDate: 'إرسال للحسابات',
    accountsApprovalDate: 'موافقة الحسابات',
    vin1502: 'VIN 1502',
    trafficFile: 'ملف المرور',
    trafficFeesOps: 'Traffic Fees',
    insuranceOps: 'Insurance',
    registrationIssueDate: 'إصدار الاستمارة',
    transferCity: 'مدينة الترحيل',
    carrier: 'الناقل',
    notes: 'ملاحظات',
    guestCenter: 'Guest Exp',
  };

  function isMine(r) {
    return !!(state.user && r && r.ops && r.ops.assignedEmployeeId === state.user.id);
  }

  function isDone(r) {
    const s = r && r.ops && r.ops.opsStatus;
    return s === 'Claimed' || s === 'تم التسليم';
  }

  function employeeNames() {
    return ((state.meta && state.meta.employees) || []).map((e) => e.name);
  }

  // ——— Editable cells ———
  function editableControl(vin, field, type, value) {
    const v = value == null ? '' : String(value);
    const common = `class="cell-edit" data-vin="${esc(vin)}" data-field="${esc(field)}"`;
    const options = (list, placeholder) => `<option value="">${placeholder}</option>${list.map((s) =>
      `<option value="${esc(s)}" ${v === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
    if (type === 'status') return stickyControl(vin, 'opsStatus', v);
    if (type === 'yn') return `<select ${common}>${options(['Yes', 'No'], '—')}</select>`;
    if (type === 'date') return `<input type="date" ${common} value="${esc(v)}" />`;
    if (type === 'city') return `<input list="edit-city-list" ${common} value="${esc(v)}" placeholder="City…" />`;
    if (type === 'carrier') return stickyControl(vin, 'carrier', v);
    if (type === 'notes') return `<input type="text" ${common} value="${esc(v)}" placeholder="Notes…" style="min-width:140px" />`;
    return esc(v || '—');
  }

  /** Status and الناقل save on the first choice, then stay locked until a double-click. */
  function stickyField(field) {
    return field === 'carrier' || field === 'opsStatus';
  }

  function stickyMeta(field) {
    if (field === 'opsStatus') {
      return {
        title: 'Double-click to change status',
        placeholder: '—',
        options: () => (state.meta && state.meta.statuses) || [],
      };
    }
    return {
      title: 'Double-click to reassign الناقل',
      placeholder: '— الناقل —',
      options: () => (state.meta && state.meta.carriers) || [],
    };
  }

  function choiceOptionsHtml(field, selected, allowEmpty) {
    const meta = stickyMeta(field);
    const blank = allowEmpty ? `<option value="">${esc(meta.placeholder)}</option>` : '';
    return `${blank}${meta.options().map((s) =>
      `<option value="${esc(s)}" ${selected === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
  }

  function stickyControl(vin, field, value) {
    const v = String(value || '').trim();
    const meta = stickyMeta(field);
    if (v) {
      const label = field === 'opsStatus' ? statusBadge(v) : esc(v);
      return `<button type="button" class="choice-lock${field === 'carrier' ? ' is-carrier' : ''}" data-vin="${esc(vin)}" data-field="${esc(field)}" data-choice="${esc(v)}" title="${esc(meta.title)}">${label}</button>`;
    }
    return `<select class="cell-edit" data-vin="${esc(vin)}" data-field="${esc(field)}">${choiceOptionsHtml(field, '', true)}</select>`;
  }

  function paintStatusRow(el, value) {
    const tr = el && el.closest ? el.closest('tr') : null;
    if (!tr) return;
    tr.className = tr.className.split(' ').filter((c) => !c.startsWith('row-status-')).join(' ');
    const cls = statusRowClass(value);
    if (cls) tr.classList.add(cls);
  }

  function lockChoiceEl(el, field, value) {
    const key = field || el.dataset.field || el.dataset.ops;
    const next = String(value || '').trim();
    if (!next || !el || !el.parentNode || !stickyField(key)) return;
    const meta = stickyMeta(key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `choice-lock is-saved${key === 'carrier' ? ' is-carrier' : ''}`;
    btn.dataset.vin = el.dataset.vin || '';
    btn.dataset.field = key;
    btn.dataset.choice = next;
    btn.title = meta.title;
    if (key === 'opsStatus') {
      paintStatusRow(el, next);
      btn.innerHTML = statusBadge(next);
    } else {
      btn.textContent = next;
    }
    el.replaceWith(btn);
    bindChoiceLock(btn);
    setTimeout(() => btn.classList.remove('is-saved'), 1200);
  }

  function openChoiceReassign(btn) {
    const field = btn.dataset.field || '';
    const current = String(btn.dataset.choice || '').trim();
    const sel = document.createElement('select');
    sel.className = 'cell-edit';
    sel.dataset.vin = btn.dataset.vin || '';
    sel.dataset.field = field;
    sel.innerHTML = choiceOptionsHtml(field, current, false);
    btn.replaceWith(sel);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      const next = String(value || '').trim() || current;
      if (next && next !== current && sel.dataset.vin) {
        queueCellEdit(sel, { immediate: true });
      }
      if (sel.isConnected) lockChoiceEl(sel, field, next);
    };
    sel.addEventListener('change', () => finish(sel.value));
    sel.addEventListener('blur', () => {
      setTimeout(() => { if (!done) finish(current); }, 180);
    });
    sel.focus();
    if (typeof sel.showPicker === 'function') {
      try { sel.showPicker(); } catch { /* picker already opening */ }
    }
  }

  function bindChoiceLock(btn) {
    if (!btn || btn.dataset.lockBound) return;
    btn.dataset.lockBound = '1';
    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openChoiceReassign(btn);
    });
  }

  /** Coordinator printed with another company than the الناقل Hanouf / Rasha set — "from ← to" under the cell. */
  function carrierChangeNote(ops) {
    const from = String((ops && ops.carrierChangedFrom) || '').trim();
    if (!from) return '';
    const to = String((ops && ops.carrier) || '').trim();
    const by = String((ops && ops.carrierChangedBy) || '').trim();
    const at = String((ops && ops.carrierChangedAt) || '').replace('T', ' ').slice(0, 16);
    const tip = ['غيّره المنسق', by, at].filter(Boolean).join(' · ');
    return `<div class="carrier-changed" dir="rtl" title="${esc(tip)}">تغيّر من ${esc(from)} ← ${esc(to || '—')}</div>`;
  }

  function readOnlyValue(type, value) {
    if (type === 'status') return `<span class="cell-status">${statusBadge(value)}</span>`;
    if (type === 'yn') return ynBadge(value);
    if (type === 'notes') return esc(String(value || '').slice(0, 40));
    return esc(na(value));
  }

  function ensureDatalists() {
    if ($('#edit-city-list')) return;
    const dl = document.createElement('datalist');
    dl.id = 'edit-city-list';
    dl.innerHTML = ((state.meta && state.meta.transferCities) || [])
      .map((c) => `<option value="${esc(c)}"></option>`).join('');
    document.body.appendChild(dl);
  }

  /** Pending entry edits — survive refresh/logout until the server acknowledges them */
  const pendingOps = new Map();
  const saveTimers = new Map();
  let flushInFlight = null;

  function pendKey(vin, field) {
    return `${vin}::${field}`;
  }

  function draftStorageKey() {
    return `dt_xform_ops_draft_${state.user ? state.user.id : 'anon'}`;
  }

  function persistDrafts() {
    if (!state.user) return;
    const obj = {};
    pendingOps.forEach((v, k) => {
      obj[k] = { vin: v.vin, field: v.field, value: v.value };
    });
    try {
      localStorage.setItem(draftStorageKey(), JSON.stringify(obj));
    } catch {
      /* ignore quota */
    }
  }

  function loadDrafts() {
    pendingOps.clear();
    if (!state.user) return;
    try {
      const raw = JSON.parse(localStorage.getItem(draftStorageKey()) || '{}');
      Object.entries(raw).forEach(([k, v]) => {
        if (v && v.vin && v.field != null) {
          pendingOps.set(k, { vin: v.vin, field: v.field, value: v.value == null ? '' : String(v.value) });
        }
      });
    } catch {
      pendingOps.clear();
    }
  }

  function markPending(vin, field, value) {
    const key = pendKey(vin, field);
    pendingOps.set(key, { vin, field, value: value == null ? '' : String(value) });
    if (state.rowIndex[vin] && state.rowIndex[vin].ops) {
      state.rowIndex[vin].ops[field] = pendingOps.get(key).value;
      if (state.rowIndex[vin].ops.updatedAt !== undefined) {
        state.rowIndex[vin].ops.updatedAt = new Date().toISOString();
      }
    }
    persistDrafts();
  }

  function applyPendingToRows(rows) {
    (rows || []).forEach((r) => {
      if (!r || !r.ops) return;
      pendingOps.forEach((p) => {
        if (p.vin === r.vin) r.ops[p.field] = p.value;
      });
    });
    return rows;
  }

  function hasPendingEdits() {
    return pendingOps.size > 0;
  }

  function showSaveToast(field, ok) {
    const toast = (state.view === 'live' ? $('#live-save-toast') : $('#my-save-toast'));
    if (!toast) return;
    toast.hidden = false;
    toast.textContent = ok
      ? `Saved ✓ ${FIELD_LABELS[field] || field} · ${new Date().toLocaleTimeString()}`
      : `Saving… ${FIELD_LABELS[field] || field}`;
    if (ok) setTimeout(() => { toast.hidden = true; }, 2200);
  }

  async function pushOpsPatch(vin, field, value, { keepalive = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['X-Delivery-Transform-Token'] = token;
    const res = await fetch(`/api/delivery-transformation/vehicles/${encodeURIComponent(vin)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ [field]: value }),
      keepalive: !!keepalive,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => null) : null;
    if (!res.ok) throw new Error((data && data.error) || res.statusText || 'Save failed');
    return data;
  }

  async function commitPending(vin, field, value, el) {
    const key = pendKey(vin, field);
    markPending(vin, field, value);
    if (el) {
      el.classList.add('is-saving');
      el.classList.remove('is-saved');
    }
    showSaveToast(field, false);
    try {
      await pushOpsPatch(vin, field, value);
      const cur = pendingOps.get(key);
      if (cur && String(cur.value) === String(value)) {
        pendingOps.delete(key);
        persistDrafts();
      }
      if (el) {
        el.classList.remove('is-saving');
        el.classList.add('is-saved');
        setTimeout(() => el.classList.remove('is-saved'), 1200);
      }
      if (field === 'opsStatus' && el) {
        const tr = el.closest('tr');
        if (tr) {
          tr.className = tr.className.split(' ').filter((c) => !c.startsWith('row-status-')).join(' ');
          const cls = statusRowClass(value);
          if (cls) tr.classList.add(cls);
        }
      }
      showSaveToast(field, true);
      if (field === 'guestCenter') loadAppointmentBadge().catch(() => {});
      // Invalidate fingerprint so next poll picks up server truth without wiping now
      state.liveFingerprint = '';
    } catch (err) {
      if (el) el.classList.remove('is-saving');
      throw err;
    }
  }

  function savedOpsValue(vin, field) {
    const row = state.rowIndex[vin];
    if (!row || !row.ops || row.ops[field] == null) return '';
    return String(row.ops[field]);
  }

  /** Blank input must not replace a value that is already on the VIN. */
  function wouldClearSaved(vin, field, value) {
    return !String(value || '').trim() && !!savedOpsValue(vin, field).trim();
  }

  function queueCellEdit(el, { immediate = false } = {}) {
    const vin = el.dataset.vin;
    const field = el.dataset.field;
    if (!vin || !field) return;
    const value = el.value;
    if (wouldClearSaved(vin, field, value)) return;
    markPending(vin, field, value);
    const key = pendKey(vin, field);
    if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
    const run = () => {
      saveTimers.delete(key);
      commitPending(vin, field, value, el).catch((err) => {
        alert(err.message || 'Save failed — your entry is kept locally until it syncs');
      });
    };
    if (immediate) run();
    else saveTimers.set(key, setTimeout(run, 350));
  }

  async function flushPendingOps({ keepalive = false } = {}) {
    if (flushInFlight && !keepalive) return flushInFlight;
    // Capture in-progress inputs before leaving. Never persist a blank الناقل.
    $$('.cell-edit').forEach((el) => {
      if (!el.dataset.vin || !el.dataset.field) return;
      if (wouldClearSaved(el.dataset.vin, el.dataset.field, el.value)) return;
      markPending(el.dataset.vin, el.dataset.field, el.value);
    });
    if (state._drawerVin) {
      $$('#vin-drawer [data-ops]').forEach((el) => {
        if (!el.dataset.ops) return;
        if (wouldClearSaved(state._drawerVin, el.dataset.ops, el.value)) return;
        markPending(state._drawerVin, el.dataset.ops, el.value);
      });
    }
    saveTimers.forEach((t) => clearTimeout(t));
    saveTimers.clear();
    const items = [...pendingOps.values()];
    if (!items.length) return;

    if (keepalive) {
      persistDrafts();
      const token = getToken();
      items.forEach((item) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-Delivery-Transform-Token'] = token;
        try {
          fetch(`/api/delivery-transformation/vehicles/${encodeURIComponent(item.vin)}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ [item.field]: item.value }),
            keepalive: true,
          });
        } catch {
          /* drafts remain in localStorage */
        }
      });
      return;
    }

    flushInFlight = (async () => {
      for (const item of items) {
        try {
          await pushOpsPatch(item.vin, item.field, item.value);
          const key = pendKey(item.vin, item.field);
          const cur = pendingOps.get(key);
          if (cur && String(cur.value) === String(item.value)) {
            pendingOps.delete(key);
          }
        } catch (err) {
          console.error('[entry save]', err.message || err);
        }
      }
      persistDrafts();
      flushInFlight = null;
    })();
    return flushInFlight;
  }

  function bindEditableCells(tableEl) {
    $$('.choice-lock', tableEl).forEach(bindChoiceLock);
    $$('.cell-edit', tableEl).forEach((el) => {
      if (stickyField(el.dataset.field)) {
        el.addEventListener('change', () => {
          const value = String(el.value || '').trim();
          if (!value) return;
          queueCellEdit(el, { immediate: true });
          lockChoiceEl(el, el.dataset.field, value);
        });
        return;
      }
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const isSelect = tag === 'select';
      const isInstant = isSelect || type === 'date' || type === 'checkbox';
      el.addEventListener('change', () => queueCellEdit(el, { immediate: true }));
      if (!isInstant) {
        el.addEventListener('input', () => queueCellEdit(el, { immediate: false }));
      }
      el.addEventListener('blur', () => queueCellEdit(el, { immediate: true }));
    });
  }

  function canUseInventory() {
    return !!(state.user && state.user.canInventory);
  }

  // ——— Nav / views ———
  function navItems() {
    return [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'live', label: 'Live Sheet' },
      ...(state.user && state.user.id === 'hanouf' ? [{ id: 'mine', label: 'My VINs' }] : []),
      { id: 'my', label: isManager() ? 'All VINs' : 'My VINs' },
      ...(canUploadSalesRaw() ? [{
        id: 'assignment',
        label: `Assignment${state.meta && state.meta.pendingAssignments ? ` (${state.meta.pendingAssignments})` : ''}`,
      }] : []),
      ...(isManager() ? [
        { id: 'targets', label: 'Team Targets' },
        { id: 'upload', label: 'Upload VINs' },
      ] : []),
      ...(canUploadSalesRaw() ? [{ id: 'sales-raw', label: 'Sales Raw' }] : []),
      ...(isRuba() ? [{
        id: 'appointment',
        label: (state.appointmentOpen || state.appointmentDue)
          ? `Appointment (${(state.appointmentOpen || 0) + (state.appointmentDue || 0)})`
          : 'Appointment',
      }] : []),
      ...(canUseInventory() ? [{ href: 'inventory-managment.html', label: 'Inventory' }] : []),
    ];
  }

  function renderNav() {
    const nav = $('#side-nav');
    nav.innerHTML = `<p class="sec">Menu</p>${navItems().map((i) =>
      i.href
        ? `<button type="button" data-href="${esc(i.href)}">${esc(i.label)}</button>`
        : `<button type="button" data-view="${i.id}" class="${state.view === i.id ? 'active' : ''}">${esc(i.label)}</button>`
    ).join('')}`;
    $$('#side-nav button[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('#side-nav button[data-href]').forEach((b) => b.addEventListener('click', () => { location.href = b.dataset.href; }));
    $('#side-name').textContent = state.user.name;
    $('#side-role').textContent = state.user.role;
  }

  function stopLivePoll() {
    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = null;
    }
  }

  function startLivePoll() {
    stopLivePoll();
    const ms = (state.view === 'live' || state.view === 'appointment') ? 1200 : 2000;
    state.liveTimer = setInterval(() => {
      if (document.hidden || state.liveInFlight) return;
      refreshViewSilent().catch(() => {});
    }, ms);
  }

  function refreshViewSilent() {
    if (state.view === 'live') return loadLiveSheet({ silent: true });
    if (state.view === 'dashboard') return loadDashboard();
    if (state.view === 'my' || state.view === 'mine') return loadMy({ silent: true });
    if (state.view === 'appointment') return loadAppointments({ silent: true });
    return Promise.resolve();
  }

  function setView(view) {
    state.view = view;
    stopLivePoll();
    const panel = view === 'mine' ? 'my' : view;
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${panel}`));
    renderNav();
    const titles = {
      dashboard: ['Dashboard', 'Delivery Control Tower'],
      live: ['Live Sheet', 'All teammates’ schedules · Sales Type (cash / bank)'],
      mine: ['My VINs', 'VIN numbers assigned to Hanouf'],
      my: isManager()
        ? ['All VINs', 'Every VIN · edit · hand over to an employee']
        : ['My VINs', 'Your schedule · edit your work'],
      assignment: ['Assignment', 'VIN numbers only · Proforma Date (column P) filled · Invoice Date (column V) empty · no duplicate VINs'],
      targets: ['Team Targets', 'Each employee · VINs by sales type · total · target · Ach%'],
      upload: ['Upload VINs', `Delivery sheet · ${state.meta.currentMonth || 'this month'} all VINs · ${state.meta.previousMonth || 'last month'} only فسح، الغاء، بطاقة، صادرة، مرور، رجوع مرور`],
      'sales-raw': ['Sales Raw', 'Refreshes vehicle details on every VIN · everyone sees the update time'],
      appointment: ['Appointment', 'Guest Exp = Yes · set date, time, and a timer for everyone'],
    };
    const t = titles[view] || ['Delivery Transformation', ''];
    $('#page-title').textContent = t[0];
    $('#page-sub').textContent = t[1];
    refreshView();
    startLivePoll();
  }

  async function refreshView() {
    try {
      if (state.view === 'dashboard') await loadDashboard();
      if (state.view === 'live') await loadLiveSheet();
      if (state.view === 'my' || state.view === 'mine') await loadMy();
      if (state.view === 'targets') await loadTargets();
      if (state.view === 'assignment') await loadAssignment();
      if (state.view === 'upload' || state.view === 'sales-raw') await loadImportPanels();
      if (state.view === 'appointment') await loadAppointments();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to load');
    }
  }

  async function fetchLive(params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const data = await api(`/live-sheet${qs.toString() ? `?${qs}` : ''}`);
    renderImports(data.imports);
    applyPendingToRows(data.rows || []);
    (data.rows || []).forEach((r) => { state.rowIndex[r.vin] = r; });
    rememberSelInfo(data.rows || []);
    return data;
  }

  // ——— Selected VINs (every user · kept in view while working) ———
  function selKey() {
    return `dt_xform_sel_${state.user ? state.user.id : ''}`;
  }

  function loadSelection() {
    try {
      const saved = JSON.parse(localStorage.getItem(selKey()) || '{}');
      state.selected = new Set(Array.isArray(saved.vins) ? saved.vins : []);
      state.selInfo = saved.info && typeof saved.info === 'object' ? saved.info : {};
    } catch {
      state.selected = new Set();
      state.selInfo = {};
    }
  }

  function saveSelection() {
    const info = {};
    state.selected.forEach((vin) => { if (state.selInfo[vin]) info[vin] = state.selInfo[vin]; });
    state.selInfo = info;
    localStorage.setItem(selKey(), JSON.stringify({ vins: [...state.selected], info }));
  }

  function rememberSelInfo(rows) {
    let touched = false;
    rows.forEach((r) => {
      if (!state.selected.has(r.vin)) return;
      state.selInfo[r.vin] = {
        product: r.raw.product || '',
        employee: r.ops.assignedEmployeeName || '',
        status: r.ops.opsStatus || '',
      };
      touched = true;
    });
    if (touched) saveSelection();
  }

  function setSelected(vin, on) {
    if (on) state.selected.add(vin);
    else state.selected.delete(vin);
    if (on && state.rowIndex[vin]) rememberSelInfo([state.rowIndex[vin]]);
    saveSelection();
    $$(`tr[data-vin="${CSS.escape(vin)}"]`).forEach((tr) => {
      tr.classList.toggle('selected', on);
      const cb = $('input.sel-check', tr);
      if (cb) cb.checked = on;
    });
    renderSelBars();
  }

  function renderSelBars() {
    ['#live-sel-bar', '#my-sel-bar'].forEach((sel) => {
      const el = $(sel);
      if (el) renderSelBar(el, sel === '#live-sel-bar');
    });
  }

  function renderSelBar(el, isLive) {
    const vins = [...state.selected];
    if (!el.dataset.wired) wireSelBar(el);
    if (!vins.length) {
      el.classList.remove('has-sel');
      el.innerHTML = '<span class="hint">Tick ☐ next to any VIN to keep it here while you work · then assign, unassign or remove it.</span>';
      return;
    }
    el.classList.add('has-sel');
    const away = new Set(((state.meta && state.meta.employees) || []).filter((e) => e.onVacation).map((e) => e.name));
    const others = employeeNames().filter((n) => n !== state.user.name);
    const assignBtn = (name, label, extra = '') => (away.has(name)
      ? `<button type="button" class="btn sel-assign ${extra}" disabled title="${esc(name)} is on vacation">${esc(label)} 🌴</button>`
      : `<button type="button" class="btn sel-assign ${extra}" data-emp="${esc(name)}">${esc(label)}</button>`);
    const meBtn = (state.user.role === 'employee' || state.user.role === 'hanouf')
      ? assignBtn(state.user.name, '→ Me', 'me') : '';
    el.innerHTML = `
      <div class="sel-head">
        <strong>${vins.length}</strong> VIN(s) selected
        ${isLive ? `<label class="sel-only"><input type="checkbox" class="sel-only-cb" ${state.liveOnlySelected ? 'checked' : ''} /> Show only selected</label>` : ''}
        <button type="button" class="btn sel-clear">Clear</button>
      </div>
      <div class="sel-chips">${vins.map((vin) => {
        const i = state.selInfo[vin] || {};
        return `<span class="sel-chip">
          <button type="button" class="sel-open" data-vin="${esc(vin)}" title="Open">${esc(vin)}</button>
          <small>${esc(i.product || '')}${i.employee ? ` · ${esc(i.employee)}` : ' · unassigned'}${i.status ? ` · ${esc(i.status)}` : ''}</small>
          <button type="button" class="sel-x" data-vin="${esc(vin)}" title="Unselect">×</button>
        </span>`;
      }).join('')}</div>
      <div class="sel-actions">
        <span class="lbl">Assign to:</span>
        ${meBtn}
        ${others.map((n) => assignBtn(n, `→ ${n}`)).join('')}
        <span class="sel-sep"></span>
        <button type="button" class="btn sel-unassign">Unassign</button>
        <button type="button" class="btn sel-remove">Remove from sheet</button>
      </div>`;
  }

  function wireSelBar(el) {
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('sel-open')) openVin(b.dataset.vin).catch((err) => alert(err.message));
      else if (b.classList.contains('sel-x')) setSelected(b.dataset.vin, false);
      else if (b.classList.contains('sel-clear')) clearSelection();
      else if (b.classList.contains('sel-assign')) selAction('assign', b.dataset.emp);
      else if (b.classList.contains('sel-unassign')) selAction('unassign');
      else if (b.classList.contains('sel-remove')) selAction('remove');
    });
    el.addEventListener('change', (e) => {
      if (!e.target.classList.contains('sel-only-cb')) return;
      state.liveOnlySelected = e.target.checked;
      state.liveFingerprint = '';
      loadLiveSheet().catch((err) => alert(err.message));
    });
  }

  function clearSelection() {
    state.selected.clear();
    state.liveOnlySelected = false;
    saveSelection();
    $$('tr.selected').forEach((tr) => tr.classList.remove('selected'));
    $$('input.sel-check').forEach((cb) => { cb.checked = false; });
    state.liveFingerprint = '';
    refreshView();
  }

  async function selAction(kind, employee) {
    const vins = [...state.selected];
    if (!vins.length) return;
    const n = vins.length;
    const ask = {
      assign: `Assign ${n} VIN(s) to ${employee}?`,
      unassign: `Unassign ${n} VIN(s)? They stay on the Live Sheet with no employee.`,
      remove: `Remove ${n} VIN(s) from the Live Sheet for everyone?\n\n${vins.join('\n')}`,
    }[kind];
    if (!confirm(ask)) return;
    try {
      const res = kind === 'assign'
        ? await api('/reassign', { method: 'POST', json: { vins, employee } })
        : await api(`/${kind}`, { method: 'POST', json: { vins } });
      const results = res.results || [];
      const ok = results.filter((r) => r.ok);
      const fail = results.filter((r) => !r.ok);
      if (kind === 'remove') ok.forEach((r) => state.selected.delete(r.vin));
      saveSelection();
      const verb = { assign: `assigned to ${employee}`, unassign: 'unassigned', remove: 'removed' }[kind];
      alert(`${ok.length} VIN(s) ${verb}${fail.length
        ? `\n${fail.length} skipped:\n${fail.map((f) => `${f.vin} — ${f.error}`).join('\n')}` : ''}`);
    } catch (err) {
      alert(err.message || 'Action failed');
    }
    state.liveFingerprint = '';
    refreshView();
  }

  // ——— Assignment (VIN numbers only · auto-split evenly by sales type) ———
  async function loadAssignment(data) {
    const d = data || await api('/assignment');
    state.asg = d;
    if (!state.asgSel) state.asgSel = new Set();
    const live = new Set(d.rows.map((r) => r.vin));
    [...state.asgSel].forEach((v) => { if (!live.has(v)) state.asgSel.delete(v); });
    state.meta.pendingAssignments = d.rows.length;
    renderNav();

    const can = !!d.canConfirm;
    const away = new Set((d.employees || []).filter((e) => e.onVacation).map((e) => e.id));
    if (state.meta.employees) {
      state.meta.employees = state.meta.employees.map((e) => ({ ...e, onVacation: away.has(e.id) }));
    }
    $('#asg-kpis').innerHTML = [
      ['Ready to assign', d.rows.length, d.rows.length ? 'warn' : 'ok'],
      ['Unique VINs', d.rows.length, ''],
    ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');

    $('#asg-actions').style.display = can && d.rows.length ? '' : 'none';
    const list = $('#asg-table');
    list.innerHTML = d.rows.length
      ? d.rows.map((r) => `<button type="button" class="asg-vin ${state.asgSel.has(r.vin) ? 'selected' : ''}" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`).join('')
      : '<p class="hint">No unique VINs with Proforma Date (column P) filled and Invoice Date (column V) empty.</p>';
    $$('.asg-vin', list).forEach((b) => b.addEventListener('click', () => {
      if (!can) return;
      if (state.asgSel.has(b.dataset.vin)) state.asgSel.delete(b.dataset.vin);
      else state.asgSel.add(b.dataset.vin);
      b.classList.toggle('selected');
    }));
    renderAssignmentBalance();
  }

  function renderAssignmentBalance() {
    const d = state.asg;
    const can = !!d.canConfirm;
    const types = d.salesTypes || [];
    const cell = (now, after) => (now === after
      ? `<td class="num">${now}</td>`
      : `<td class="num">${now} <span class="asg-after">→ ${after}</span></td>`);
    $('#asg-map-table').innerHTML = `<thead><tr><th>Employee</th>${types.map((t) => `<th>${esc(t)}</th>`).join('')}<th>Total</th><th>Vacation 🌴</th></tr></thead>
      <tbody>${(d.employees || []).map((e) => {
        const nowT = types.reduce((s, t) => s + ((e.bySalesType && e.bySalesType[t]) || 0), 0);
        const afterT = types.reduce((s, t) => s + ((e.afterBySalesType && e.afterBySalesType[t]) || 0), 0);
        return `<tr class="${e.onVacation ? 'is-vacation' : ''}">
        <td><b>${esc(e.name)}</b>${e.onVacation ? ' <span class="badge warn">On vacation</span>' : ''}</td>
        ${types.map((t) => cell((e.bySalesType && e.bySalesType[t]) || 0, (e.afterBySalesType && e.afterBySalesType[t]) || 0)).join('')}
        ${cell(nowT, afterT)}
        <td class="vac-cell">
          <label class="vac-toggle"><input type="checkbox" class="checkbox vac-cb" data-emp="${esc(e.id)}"
            ${e.onVacation ? 'checked' : ''} ${can ? '' : 'disabled'} /> ${e.onVacation ? 'On vacation' : 'Working'}</label>
          ${can ? `<label class="vac-until">until <input type="date" class="vac-date" data-emp="${esc(e.id)}" value="${esc(e.vacationUntil || '')}"
            min="${esc(d.today)}" title="Leave empty = until you turn it off" /></label>`
            : (e.vacationUntil ? `<span class="hint">until ${esc(e.vacationUntil)}</span>` : '')}
        </td>
      </tr>`;
      }).join('')}</tbody>`;
    const setVac = async (empId, on, until) => {
      const res = await api('/vacation', { method: 'PUT', json: { employeeId: empId, onVacation: on, until } });
      await loadAssignment(res);
    };
    $$('.vac-cb').forEach((cb) => cb.addEventListener('change', () => {
      const date = $(`.vac-date[data-emp="${cb.dataset.emp}"]`);
      setVac(cb.dataset.emp, cb.checked, date ? date.value : '').catch((err) => alert(err.message));
    }));
    $$('.vac-date').forEach((inp) => inp.addEventListener('change', () => {
      const cb = $(`.vac-cb[data-emp="${inp.dataset.emp}"]`);
      if (!inp.value && !cb.checked) return;
      setVac(inp.dataset.emp, true, inp.value).catch((err) => alert(err.message));
    }));
  }

  async function confirmAssignments() {
    if (!state.asg.rows.length) return alert('Nothing to assign');
    if (!confirm(`Assign ${state.asg.rows.length} VIN(s) automatically so each employee has the same number in every sales type?`)) return;
    const res = await api('/assignment/confirm', { method: 'POST', json: { all: true } });
    const ok = (res.results || []).filter((r) => r.ok);
    const fail = (res.results || []).filter((r) => !r.ok);
    state.asgSel.clear();
    alert(`${ok.length} VIN(s) assigned and added to the Live Sheet${fail.length
      ? `\n${fail.length} skipped:\n${fail.map((f) => `${f.vin} — ${f.error}`).join('\n')}` : ''}`);
    await loadAssignment(res);
  }

  async function dismissAssignments() {
    const vins = [...state.asgSel];
    if (!vins.length) return alert('Tick at least one VIN');
    if (!confirm(`Dismiss ${vins.length} VIN(s)? They will not be added to the Live Sheet.\n\n${vins.join('\n')}`)) return;
    const res = await api('/assignment/dismiss', { method: 'POST', json: { vins } });
    state.asgSel.clear();
    await loadAssignment(res);
  }

  // ——— Team Targets (Hanouf / Admin) ———
  function achCell(pct) {
    if (pct == null) return '<span class="hint">no target</span>';
    const cls = pct >= 100 ? 'ok' : pct >= 70 ? 'warn' : 'bad';
    return `<div class="ach ach-${cls}"><div class="ach-bar"><span style="width:${Math.min(pct, 100)}%"></span></div><b>${pct}%</b></div>`;
  }

  async function loadTargets() {
    const inp = $('#tgt-month');
    if (!state.targetMonth) state.targetMonth = state.meta.currentMonth;
    if (inp.value !== state.targetMonth) inp.value = state.targetMonth;
    const basis = $('#tgt-basis').value;
    const data = await api(`/team-performance?month=${encodeURIComponent(state.targetMonth)}`);
    state.targetData = data;
    const types = data.salesTypes || [];
    const t = data.totals;
    const pctKey = basis === 'delivered' ? 'deliveredPct' : 'achPct';
    $('#tgt-hint').textContent = `Showing ${data.month}${data.month === data.currentMonth ? ' (this month)' : ''}`;

    $('#tgt-kpis').innerHTML = [
      ['Team VINs', t.total, ''],
      ['Delivered / Claimed', t.delivered, 'ok'],
      ['Team target', t.target || '—', 'info'],
      ['Team Ach%', t[pctKey] == null ? '—' : `${t[pctKey]}%`,
        t[pctKey] == null ? '' : t[pctKey] >= 100 ? 'ok' : t[pctKey] >= 70 ? 'warn' : 'bad'],
    ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');

    const head = `<thead><tr><th>Employee</th>${types.map((s) => `<th>${esc(s)}</th>`).join('')}
      <th>Total</th><th>Delivered</th><th>Target</th><th>Ach%</th></tr></thead>`;
    const body = (data.rows || []).map((r) => `<tr>
        <td><b>${esc(r.name)}</b></td>
        ${types.map((s) => `<td class="num">${r.bySalesType[s] || 0}</td>`).join('')}
        <td class="num"><b>${r.total}</b></td>
        <td class="num">${r.delivered}</td>
        <td><input type="number" min="0" step="1" class="tgt-input" data-emp="${esc(r.id)}" value="${r.target || ''}" placeholder="0" /></td>
        <td>${achCell(r[pctKey])}</td>
      </tr>`).join('');
    const foot = `<tfoot><tr><td><b>Total</b></td>
      ${types.map((s) => `<td class="num"><b>${t.bySalesType[s] || 0}</b></td>`).join('')}
      <td class="num"><b>${t.total}</b></td><td class="num"><b>${t.delivered}</b></td>
      <td class="num"><b>${t.target || '—'}</b></td><td>${achCell(t[pctKey])}</td></tr></tfoot>`;
    $('#tgt-table').innerHTML = `${head}<tbody>${body}</tbody>${foot}`;
    $('#tgt-unassigned').textContent = data.unassigned
      ? `${data.unassigned} VIN(s) this month are not assigned to any employee` : '';
  }

  async function saveTargets() {
    const targets = {};
    $$('#tgt-table .tgt-input').forEach((el) => { targets[el.dataset.emp] = el.value; });
    const res = await api('/targets', { method: 'PUT', json: { month: state.targetMonth, targets } });
    const toast = $('#tgt-save-toast');
    toast.hidden = false;
    toast.textContent = `Saved ✓ targets for ${res.month} · ${new Date().toLocaleTimeString()}`;
    setTimeout(() => { toast.hidden = true; }, 2500);
    await loadTargets();
  }

  // ——— Upload VINs / Sales Raw (Hanouf / Admin) ———
  async function loadImportPanels() {
    state.meta = await api('/meta');
    $('#upload-month').textContent = state.meta.currentMonth || 'this month';
    const prevMonthEl = $('#upload-prev-month');
    if (prevMonthEl) prevMonthEl.textContent = state.meta.previousMonth || 'last month';
    renderImports(state.meta.imports);
  }

  async function sendFile(path, file) {
    const res = await fetch(`${window.DTX.API}${path}`, {
      method: 'POST',
      headers: {
        'X-Delivery-Transform-Token': getToken(),
        'X-Filename': encodeURIComponent(file.name),
        'Content-Type': 'application/octet-stream',
      },
      body: await file.arrayBuffer(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function doUpload(file) {
    if (!file) return;
    const box = $('#upload-summary');
    box.hidden = false;
    box.innerHTML = `<p class="hint">Uploading ${esc(file.name)}…</p>`;
    try {
      const { summary: s } = await sendFile('/upload', file);
      box.innerHTML = `
        <p><b>Sheet used:</b> ${esc(s.sheet)} · <b>Month applied:</b> ${esc(s.month)}</p>
        <div class="summary-grid">
          <div><strong>${s.rows}</strong><span>Rows read</span></div>
          <div><strong>${s.created}</strong><span>New VINs</span></div>
          <div><strong>${s.updated}</strong><span>VINs updated</span></div>
          <div><strong>${s.updatedOtherMonth || 0}</strong><span>Existing VINs refreshed · other month</span></div>
          <div><strong>${s.assigned}</strong><span>Assigned from PIC</span></div>
          <div><strong>${s.skippedVacation || 0}</strong><span>Not assigned · PIC on vacation</span></div>
          <div><strong>${s.keptLastMonth || 0}</strong><span>Last month kept · فسح / الغاء / بطاقة / صادرة / مرور / رجوع مرور</span></div>
          <div><strong>${s.skippedLastMonthStatus || 0}</strong><span>Last month skipped · other status</span></div>
          <div><strong>${s.skippedOtherMonth}</strong><span>Skipped · older than last month</span></div>
          <div><strong>${s.skippedNoDate}</strong><span>New VINs skipped · no proforma date</span></div>
        </div>
        <p class="hint" style="margin-top:8px">Upload only adds new VINs and fills in existing ones · nothing on the Live Sheet is removed or cleared.</p>`;
      await loadImportPanels();
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  async function doSalesRaw(file) {
    if (!file) return;
    const box = $('#sales-raw-summary');
    box.hidden = false;
    box.innerHTML = `<p class="hint">Uploading ${esc(file.name)}…</p>`;
    try {
      const { summary: s } = await sendFile('/sales-raw', file);
      box.innerHTML = `
        <p><b>Sales Raw applied</b> · ${esc(s.sheet)} · ${esc(s.filename)}</p>
        <div class="summary-grid">
          <div><strong>${s.rows}</strong><span>Rows read</span></div>
          <div><strong>${s.matched}</strong><span>VINs matched</span></div>
          <div><strong>${s.updated}</strong><span>VINs with new details</span></div>
          <div><strong>${s.notOnSheet}</strong><span>Not on Live Sheet</span></div>
          <div><strong>${s.assignable || 0}</strong><span>To Assignment · P filled · V empty</span></div>
          <div><strong>${s.skippedInvoiced || 0}</strong><span>Skipped · has Invoice Date (V)</span></div>
          <div><strong>${s.skippedOnSystem || 0}</strong><span>Skipped · already on system</span></div>
          <div><strong>${s.duplicates || 0}</strong><span>Duplicate VINs ignored</span></div>
        </div>
        ${s.assignable ? `<p style="margin-top:10px"><b>${s.assignable}</b> unique VIN(s) with Proforma Date and no Invoice Date
          ${isManager() ? 'are waiting for your confirmation.' : 'were sent to Hanouf to confirm the assignment.'}
          <button type="button" class="btn" id="go-assignment">Open Assignment</button></p>` : ''}`;
      const go = $('#go-assignment');
      if (go) go.addEventListener('click', () => setView('assignment'));
      await loadImportPanels();
      renderNav();
      if (s.assignable && isManager()
        && confirm(`${s.assignable} unique VIN(s) have a Proforma Date and no Invoice Date (column V).\n\nReview and assign them now?`)) {
        setView('assignment');
      }
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  function wireDrop(dropSel, inputSel, handler) {
    const drop = $(dropSel);
    const input = $(inputSel);
    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      handler(input.files[0]);
      input.value = '';
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
      handler(e.dataTransfer.files[0]);
    });
  }

  function myWorkload(rows) {
    const mine = isManager() ? rows : rows.filter(isMine);
    const completed = mine.filter(isDone).length;
    const bySalesType = {};
    const byStatus = {};
    mine.forEach((r) => {
      const t = r.raw.salesType || '(blank)';
      bySalesType[t] = (bySalesType[t] || 0) + 1;
      const s = r.ops.opsStatus || '';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    return {
      rows: mine,
      assigned: mine.length,
      completed,
      remaining: mine.length - completed,
      progress: mine.length ? Math.round((completed / mine.length) * 100) : 0,
      bySalesType,
      byStatus,
    };
  }

  // ——— Dashboard ———
  async function loadDashboard() {
    const month = state.monthFilter || '';
    const monthInp = $('#dash-month');
    if (monthInp && monthInp.value !== month) monthInp.value = month;
    $('#dash-month-hint').textContent = month ? `Showing ${month}` : 'Showing all months';

    const data = await fetchLive({ month });
    const w = myWorkload(data.rows || []);
    const kpis = [
      [isManager() ? 'All VINs' : 'Assigned to me', w.assigned, ''],
      ['Completed (Claimed)', w.completed, 'ok'],
      ['Remaining', w.remaining, 'warn'],
      ['Progress %', `${w.progress}%`, 'info'],
    ];
    $('#dash-kpis').innerHTML = kpis.map(([l, v, cls]) =>
      `<article class="kpi ${cls}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`
    ).join('');

    const by = w.byStatus;
    $('#dash-pipeline').innerHTML = [
      ['Assigned', w.assigned],
      ['PSFU', by.PSFU || 0],
      ['Ready', by['جاهز للتسليم'] || 0],
      ['Delivered / Claimed', w.completed],
    ].map(([l, n]) => `<div class="pipe-step"><strong>${esc(n)}</strong><span>${esc(l)}</span></div>`).join('');

    const mix = Object.entries(w.bySalesType).sort((a, b) => b[1] - a[1]);
    $('#dash-sales-types').innerHTML = mix.length
      ? mix.map(([k, n]) =>
        `<button type="button" class="status-chip" disabled><div class="n">${n}</div><div class="l">${esc(k)}</div></button>`
      ).join('')
      : '<p class="hint">No sales types in this period</p>';

    const statuses = (state.meta && state.meta.statuses) || [];
    $('#dash-status').innerHTML = statuses.map((s) =>
      `<button type="button" class="status-chip" data-status="${esc(s)}"><div class="n">${by[s] || 0}</div><div class="l">${esc(s)}</div></button>`
    ).join('') + (by['']
      ? `<button type="button" class="status-chip" data-status=""><div class="n">${by['']}</div><div class="l">(no status)</div></button>`
      : '');
    $$('#dash-status .status-chip').forEach((b) => b.addEventListener('click', () => {
      if (!b.dataset.status) return;
      state.liveFilters = {
        ...state.liveFilters,
        status: b.dataset.status,
        month: state.monthFilter || '',
        employee: isManager() ? '' : state.user.name,
      };
      setView('live');
    }));

    const roster = (state.meta && state.meta.employees) || [];
    const byEmp = {};
    roster.forEach((e) => {
      byEmp[e.id] = {
        id: e.id,
        name: e.name,
        onVacation: !!e.onVacation,
        vacationUntil: e.until || '',
        total: 0,
        delivered: 0,
        bySalesType: {},
      };
    });
    let unassigned = 0;
    (data.rows || []).forEach((r) => {
      const id = r.ops && r.ops.assignedEmployeeId;
      const row = byEmp[id];
      if (!row) { unassigned += 1; return; }
      row.total += 1;
      if (isDone(r)) row.delivered += 1;
      const t = (r.raw && r.raw.salesType) || '(blank)';
      row.bySalesType[t] = (row.bySalesType[t] || 0) + 1;
    });
    const cards = Object.values(byEmp).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    $('#dash-employees').innerHTML = cards.map((e) => {
      const types = Object.entries(e.bySalesType).sort((a, b) => b[1] - a[1]);
      return `<button type="button" class="emp-card ${e.onVacation ? 'is-vacation' : ''}" data-emp="${esc(e.name)}">
        <div class="emp-card-top">
          <strong>${esc(e.name)}</strong>
          ${e.onVacation ? `<span class="badge warn">Vacation${e.vacationUntil ? ` · ${esc(e.vacationUntil)}` : ''}</span>` : ''}
        </div>
        <div class="emp-card-got"><b>${e.total}</b><span>VIN(s) got</span></div>
        <div class="emp-card-meta">${e.delivered} delivered · ${e.total - e.delivered} remaining</div>
        <div class="emp-card-types">${types.length
          ? types.map(([t, n]) => `<span><b>${n}</b> ${esc(t)}</span>`).join('')
          : '<span class="hint">No VINs</span>'}</div>
      </button>`;
    }).join('') + (unassigned
      ? `<div class="emp-card is-empty"><strong>Unassigned</strong><div class="emp-card-got"><b>${unassigned}</b><span>VIN(s)</span></div></div>`
      : '');
    $$('#dash-employees .emp-card[data-emp]').forEach((b) => b.addEventListener('click', () => {
      state.liveFilters = { ...state.liveFilters, employee: b.dataset.emp, month: state.monthFilter || '', status: '' };
      setView('live');
    }));
  }

  // ——— Live Sheet ———
  function liveFingerprint(rows) {
    return JSON.stringify((rows || []).map((r) => [r.vin, r.canEdit, r.raw, r.ops]));
  }

  async function loadLiveSheet({ silent = false } = {}) {
    grid = sheetGrids.live;
    if (silent && state.liveInFlight) return;
    state.liveInFlight = true;
    const f = state.liveFilters;
    let data;
    try {
      data = await fetchLive(f);
    } catch (err) {
      state.liveInFlight = false;
      throw err;
    }
    state.liveInFlight = false;
    const rows = data.rows || [];
    const fingerprint = liveFingerprint(rows);
    const changed = fingerprint !== state.liveFingerprint;
    state.liveFingerprint = fingerprint;

    const empSel = $('#live-employee');
    if (empSel && !empSel.dataset.filled) {
      empSel.innerHTML = `<option value="">All employees</option>${employeeNames().map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
      empSel.dataset.filled = '1';
    }
    if (empSel) empSel.value = f.employee || '';

    const statusSel = $('#live-status');
    if (statusSel && !statusSel.dataset.filled) {
      statusSel.innerHTML = `<option value="">All statuses</option>${(state.meta.statuses || []).map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
      statusSel.dataset.filled = '1';
    }
    if (statusSel) statusSel.value = f.status || '';

    const monthInp = $('#live-month');
    if (monthInp && monthInp.value !== (f.month || '')) monthInp.value = f.month || '';

    const carrierSel = $('#live-carrier');
    if (carrierSel && document.activeElement !== carrierSel) {
      const byCar = data.byCarrier || {};
      const all = [...new Set([...(state.meta.carriers || []),
        ...Object.keys(byCar).filter((k) => k && k !== '(empty)')])];
      carrierSel.innerHTML = `<option value="">All الناقل</option>
        <option value="__empty__"${f.carrier === '__empty__' ? ' selected' : ''}>بدون ناقل (فارغ)</option>
        ${all.map((c) => `<option value="${esc(c)}"${f.carrier === c ? ' selected' : ''}>${esc(c)}${byCar[c] != null ? ` (${byCar[c]})` : ''}</option>`).join('')}`;
    }

    const chips = $('#live-chips');
    if (chips) {
      const byEmp = data.byEmployee || {};
      const bySt = data.byStatus || {};
      const byCar = data.byCarrier || {};
      chips.innerHTML = [
        `<span class="live-chip"><b>${data.total || 0}</b> VINs</span>`,
        ...Object.keys(byEmp).map((k) => `<button type="button" class="live-chip emp-filter ${f.employee === k ? 'active' : ''}" data-emp="${esc(k)}">${esc(k)} <b>${byEmp[k]}</b></button>`),
        ...Object.entries(byCar).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => {
          const key = k === '(empty)' ? '__empty__' : k;
          return `<button type="button" class="live-chip carrier-filter ${f.carrier === key ? 'active' : ''}" data-carrier="${esc(key)}">${esc(k === '(empty)' ? 'بدون ناقل' : k)} <b>${n}</b></button>`;
        }),
        ...Object.entries(data.bySalesType || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) =>
          `<span class="live-chip">${esc(k)} <b>${n}</b></span>`),
        ...Object.keys(bySt).filter((k) => k !== '(blank)').slice(0, 8).map((k) =>
          `<button type="button" class="live-chip status-filter ${f.status === k ? 'active' : ''}" data-status="${esc(k)}">${esc(k)} <b>${bySt[k]}</b></button>`),
      ].join('');
      const toggle = (key, val) => {
        state.liveFilters[key] = state.liveFilters[key] === val ? '' : val;
        loadLiveSheet().catch((e) => alert(e.message));
      };
      $$('.status-filter', chips).forEach((b) => b.addEventListener('click', () => toggle('status', b.dataset.status)));
      $$('.emp-filter', chips).forEach((b) => b.addEventListener('click', () => toggle('employee', b.dataset.emp)));
      $$('.carrier-filter', chips).forEach((b) => b.addEventListener('click', () => toggle('carrier', b.dataset.carrier)));
    }

    const meta = $('#live-meta-text');
    if (meta) {
      const monthNote = f.month ? ` · ${f.month}` : ' · all months';
      meta.textContent = `${data.total || 0} VINs${monthNote} · live · last sync ${new Date(data.at || Date.now()).toLocaleTimeString()}${changed && silent ? ' · updated' : ''}${grid.cfNote || ''}`;
    }
    const dot = $('#live-dot');
    if (dot) {
      dot.classList.toggle('pulse', changed || !silent);
      setTimeout(() => dot.classList.remove('pulse'), 900);
    }

    renderSelBars();
    if (!changed && silent) return;
    const table = $('#live-table');
    const active = document.activeElement;
    // Never wipe mid-edit: keep typing / pending drafts on screen
    if (silent && active && active.classList && active.classList.contains('cell-edit') && table.contains(active)) return;

    ensureDatalists();
    const cell = (r, field, type) => (r.canEdit && (field !== 'carrier' || canAssignCarrier())
      ? editableControl(r.vin, field, type, r.ops[field])
      : readOnlyValue(type, r.ops[field]));

    const cols = [
      {
        key: 'num',
        label: '<input type="checkbox" class="checkbox sel-all" title="Select all shown" />',
        raw: true,
        html: (r, i) => `<label class="sel-cell"><input type="checkbox" class="checkbox sel-check" data-vin="${esc(r.vin)}" ${state.selected.has(r.vin) ? 'checked' : ''} /><span>${i + 1}</span></label>`,
      },
      { key: 'employee', label: 'Employee', html: (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>` },
      { key: 'status', label: 'Status', html: (r) => cell(r, 'opsStatus', 'status') },
      { key: 'vin', label: 'VIN', html: (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>` },
      { key: 'proforma', label: 'Proforma', html: (r) => esc(na(r.raw.proformaDate)) },
      { key: 'order', label: 'Order', html: (r) => esc(na(r.raw.salesOrder)) },
      { key: 'product', label: 'Product', html: (r) => esc(na(r.raw.product)) },
      { key: 'salestype', label: 'Sales Type', html: (r) => esc(na(r.raw.salesType)) },
      { key: 'customer', label: 'Customer', html: (r) => `<span title="${esc(r.raw.userName || '')}">${esc(na(r.raw.userName))}</span>` },
      { key: 'owner', label: 'Invoice Owner', html: (r) => `<span title="${esc(r.raw.invoiceOwner || '')}">${esc(na(r.raw.invoiceOwner))}</span>` },
      { key: 'phone', label: 'Phone', html: (r) => (r.raw.phone
        ? `<a href="tel:${esc(r.raw.phone)}" class="phone-link">${esc(r.raw.phone)}</a>` : 'N/A') },
      { key: 'sa', label: 'S/A', html: (r) => esc(na(r.raw.salesAdvisor)) },
      { key: 'guest', label: 'Guest Exp', html: (r) => cell(r, 'guestCenter', 'yn') },
      { key: 'appt', label: 'Appointment', html: (r) => (isGuestYes(r) ? guestTimerHtml(r.ops) : '—') },
      { key: 'gt', label: 'GT Loc', html: (r) => esc(na(r.raw.gtLocation)) },
      { key: 'veh', label: 'Veh Loc', html: (r) => esc(na(r.raw.vehicleLocation)) },
      { key: 'guestsent', label: 'إرسال الضيف', html: (r) => cell(r, 'guestSentDate', 'date') },
      { key: 'sig', label: 'استلام التواقيع', html: (r) => cell(r, 'signatureReceivedDate', 'date') },
      { key: 'accsent', label: 'إرسال للحسابات', html: (r) => cell(r, 'accountsSentDate', 'date') },
      { key: 'accok', label: 'موافقة الحسابات', html: (r) => cell(r, 'accountsApprovalDate', 'date') },
      { key: 'vin1502', label: 'VIN 1502', html: (r) => cell(r, 'vin1502', 'yn') },
      { key: 'traffic', label: 'ملف المرور', html: (r) => cell(r, 'trafficFile', 'yn') },
      { key: 'fees', label: 'Traffic Fees', html: (r) => cell(r, 'trafficFeesOps', 'yn') },
      { key: 'ins', label: 'Insurance', html: (r) => cell(r, 'insuranceOps', 'yn') },
      { key: 'reg', label: 'إصدار الاستمارة', html: (r) => cell(r, 'registrationIssueDate', 'date') },
      { key: 'city', label: 'مدينة الترحيل', html: (r) => cell(r, 'transferCity', 'city') },
      { key: 'carrier', label: 'الناقل', html: (r) => cell(r, 'carrier', 'carrier') + carrierChangeNote(r.ops) },
      { key: 'notes', label: 'ملاحظات', html: (r) => cell(r, 'notes', 'notes') },
      { key: 'updated', label: 'Updated', html: (r) => esc((r.ops.updatedAt || '').replace('T', ' ').slice(0, 19) || '—') },
      { key: 'by', label: 'By', html: (r) => esc(na(r.ops.updatedBy)) },
    ];

    const shown = state.liveOnlySelected ? rows.filter((r) => state.selected.has(r.vin)) : rows;
    const keepCf = active && active.classList && active.classList.contains('live-cf') && table.contains(active)
      ? { key: active.dataset.cf, start: active.selectionStart, end: active.selectionEnd }
      : null;
    grid.cols = cols;
    state.liveCols = cols;
    const cf = grid.filters;
    const cfOn = activeLiveColRules().length;
    const frow = `<tr class="live-frow">${cols.map((c) => (c.key === 'num'
      ? `<th class="col-num">${cfOn ? '<button type="button" class="live-cf-x" data-cf-clear title="Clear column filters">✕</button>' : ''}</th>`
      : `<th class="col-${c.key}${cf[c.key] ? ' is-on' : ''}"><input type="search" class="live-cf" data-cf="${esc(c.key)}" value="${esc(cf[c.key] || '')}" list="live-cf-list" placeholder="Filter…" autocomplete="off" spellcheck="false" title="${esc(`${colPlainLabel(c)}: ${LIVE_CF_HINT}`)}" aria-label="Filter ${esc(colPlainLabel(c))}" /></th>`)).join('')}</tr>`;
    table.innerHTML = `<thead><tr class="live-hrow">${cols.map((c) => `<th class="col-${c.key}">${c.raw ? c.label : esc(c.label)}</th>`).join('')}</tr>${frow}</thead>
      <tbody>${shown.map((r, i) => `<tr class="${statusRowClass(r.ops.opsStatus)}${isGuestYes(r) ? ' row-guest-exp' : ''}${state.selected.has(r.vin) ? ' selected' : ''}" data-vin="${esc(r.vin)}">${cols.map((c) =>
        `<td class="col-${c.key}">${c.html(r, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">${state.liveOnlySelected ? 'None of the selected VINs match these filters.' : 'No VINs on the Live Sheet yet.'}</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindEditableCells(table);
    bindSelChecks(table, shown);
    afterLiveRender(keepCf);
  }

  // ——— Live Sheet · column filters (every user) ———
  const LIVE_CF_HINT = 'text = contains · =text exact · !text excludes · empty / !empty';

  function colPlainLabel(c) {
    return c.key === 'num' ? '#' : c.label;
  }

  function liveCfStoreKey() {
    const who = state.user ? state.user.id : 'anon';
    return `dt_${grid.prefix}_colfilters_${who}`;
  }

  function loadLiveColFilters() {
    const who = state.user ? state.user.id : 'anon';
    ['live', 'my'].forEach((prefix) => {
      const g = sheetGrids[prefix];
      try {
        g.filters = JSON.parse(localStorage.getItem(`dt_${prefix}_colfilters_${who}`) || '{}') || {};
      } catch {
        g.filters = {};
      }
    });
    state.liveColFilters = sheetGrids.live.filters;
  }

  function saveLiveColFilters() {
    const clean = {};
    Object.entries(grid.filters).forEach(([k, v]) => { if (String(v || '').trim()) clean[k] = v; });
    grid.filters = clean;
    if (grid.prefix === 'live') state.liveColFilters = clean;
    try {
      const key = liveCfStoreKey();
      if (Object.keys(clean).length) localStorage.setItem(key, JSON.stringify(clean));
      else localStorage.removeItem(key);
    } catch {
      /* ignore quota */
    }
  }

  function activeLiveColRules() {
    return Object.entries(grid.filters || {})
      .map(([key, v]) => ({ key, rule: String(v || '').trim().toLowerCase() }))
      .filter((x) => x.rule);
  }

  function liveCellText(td) {
    if (!td) return '';
    const ctl = td.querySelector('select.cell-edit, input.cell-edit, textarea.cell-edit');
    let s;
    if (ctl) s = ctl.value;
    else if (td.classList.contains('col-num')) s = (td.querySelector('.sel-cell span') || td).textContent;
    else s = td.textContent;
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s === 'N/A' || s === '—' || s === '-' ? '' : s;
  }

  function matchLiveRule(text, rule) {
    const t = String(text || '').toLowerCase();
    if (rule === 'empty' || rule === 'فارغ') return !t;
    if (rule === '!empty' || rule === '!فارغ') return !!t;
    if (rule.startsWith('=')) return t === rule.slice(1).trim();
    if (rule.startsWith('!')) {
      const x = rule.slice(1).trim();
      return !x || !t.includes(x);
    }
    return t.includes(rule);
  }

  function liveDataRows() {
    const table = gTable();
    const body = table && table.tBodies[0];
    return body ? [...body.rows].filter((tr) => tr.dataset.vin) : [];
  }

  function liveVisibleRows() {
    return liveDataRows().filter((tr) => tr.style.display !== 'none');
  }

  function liveColIndex(key) {
    return (grid.cols || []).findIndex((c) => c.key === key);
  }

  function applyLiveColFilters() {
    const rules = activeLiveColRules()
      .map((r) => ({ ...r, idx: liveColIndex(r.key) }))
      .filter((r) => r.idx >= 0);
    let visible = 0;
    const all = liveDataRows();
    all.forEach((tr) => {
      const ok = rules.every((r) => matchLiveRule(liveCellText(tr.cells[r.idx]), r.rule));
      tr.style.display = ok ? '' : 'none';
      if (ok) visible += 1;
    });
    const table = gTable();
    if (table) {
      $$('thead tr.live-frow th', table).forEach((th, i) => {
        const col = grid.cols && grid.cols[i];
        if (col && col.key !== 'num') th.classList.toggle('is-on', !!String(grid.filters[col.key] || '').trim());
      });
      const corner = $('thead tr.live-frow th.col-num', table);
      if (corner) {
        corner.innerHTML = rules.length
          ? '<button type="button" class="live-cf-x" data-cf-clear title="Clear column filters">✕</button>'
          : '';
      }
    }
    const clearBtn = gClear();
    if (clearBtn) {
      clearBtn.hidden = !rules.length;
      clearBtn.textContent = rules.length ? `Clear column filters (${rules.length})` : 'Clear column filters';
    }
    grid.cfNote = rules.length ? ` · ${visible} shown by column filters` : '';
    const meta = grid.prefix === 'live' ? $('#live-meta-text') : null;
    if (meta) meta.textContent = meta.textContent.replace(/ · \d+ shown by column filters$/, '') + grid.cfNote;
    const sa = table && $('.sel-all', table);
    if (sa) {
      const vis = liveVisibleRows();
      sa.checked = vis.length > 0 && vis.every((tr) => state.selected.has(tr.dataset.vin));
    }
  }

  function clearLiveColFilters() {
    grid.filters = {};
    saveLiveColFilters();
    const table = gTable();
    if (table) $$('.live-cf', table).forEach((el) => { el.value = ''; });
    applyLiveColFilters();
    paintLiveSel();
  }

  function fillLiveCfList(key) {
    const list = gList();
    const idx = liveColIndex(key);
    if (!list || idx < 0) return;
    const seen = new Map();
    liveDataRows().forEach((tr) => {
      const t = liveCellText(tr.cells[idx]);
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    });
    list.innerHTML = [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, 200)
      .map((v) => `<option value="${esc(v)}"></option>`).join('');
  }

  // ——— Live Sheet · cell selection + copy as table (every user) ———
  function liveSelBounds() {
    const s = grid.sel;
    if (!s) return null;
    const rows = liveVisibleRows();
    const r1 = rows.findIndex((tr) => tr.dataset.vin === s.anchor.vin);
    const r2 = rows.findIndex((tr) => tr.dataset.vin === s.focus.vin);
    const c1 = liveColIndex(s.anchor.key);
    const c2 = liveColIndex(s.focus.key);
    if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return null;
    return {
      rows: rows.slice(Math.min(r1, r2), Math.max(r1, r2) + 1),
      c1: Math.min(c1, c2),
      c2: Math.max(c1, c2),
      focusTr: rows[r2],
      focusC: c2,
    };
  }

  function paintLiveSel() {
    const table = gTable();
    if (!table) return;
    $$('td.is-range, td.is-sel', table).forEach((td) => td.classList.remove('is-range', 'is-sel'));
    $$('thead th.is-colsel', table).forEach((th) => th.classList.remove('is-colsel'));
    const b = liveSelBounds();
    const info = gInfo();
    const copyBtn = gCopy();
    const valBtn = gVals();
    if (!b) {
      if (info && !grid.copyFlash) info.textContent = 'Click a cell, drag or Shift+click to select · Ctrl+C copies as a table with headers';
      if (copyBtn) copyBtn.disabled = true;
      if (valBtn) valBtn.disabled = true;
      return;
    }
    const multi = b.rows.length > 1 || b.c1 !== b.c2;
    b.rows.forEach((tr) => {
      for (let c = b.c1; c <= b.c2; c += 1) {
        const td = tr.cells[c];
        if (td && multi) td.classList.add('is-range');
      }
    });
    const ftd = b.focusTr.cells[b.focusC];
    if (ftd) ftd.classList.add('is-sel');
    const head = table.tHead && table.tHead.rows[0];
    if (head) for (let c = b.c1; c <= b.c2; c += 1) if (head.cells[c]) head.cells[c].classList.add('is-colsel');
    const n = b.rows.length * (b.c2 - b.c1 + 1);
    if (info && !grid.copyFlash) {
      info.textContent = multi
        ? `${b.rows.length} row(s) × ${b.c2 - b.c1 + 1} column(s) · ${n} cells · Ctrl+C copies as a table with headers`
        : `${colPlainLabel(grid.cols[b.focusC])}: ${liveCellText(ftd) || '(empty)'} · Ctrl+C to copy`;
    }
    if (copyBtn) {
      copyBtn.disabled = false;
      copyBtn.textContent = multi ? `Copy ${n} cells` : 'Copy';
    }
    if (valBtn) valBtn.disabled = !multi;
  }

  function setLiveSel(td, extend) {
    const tr = td && td.parentElement;
    const col = grid.cols && grid.cols[td.cellIndex];
    if (!tr || !tr.dataset.vin || !col) return;
    const point = { vin: tr.dataset.vin, key: col.key };
    if (extend && grid.sel) grid.sel = { anchor: grid.sel.anchor, focus: point };
    else grid.sel = { anchor: point, focus: point };
    paintLiveSel();
  }

  function selectLiveColumn(idx, extend) {
    const rows = liveVisibleRows();
    const col = grid.cols && grid.cols[idx];
    if (!rows.length || !col) return;
    const startKey = extend && grid.sel ? grid.sel.anchor.key : col.key;
    grid.sel = {
      anchor: { vin: rows[0].dataset.vin, key: startKey },
      focus: { vin: rows[rows.length - 1].dataset.vin, key: col.key },
    };
    paintLiveSel();
  }

  function buildLiveCopy(withHeaders) {
    const b = liveSelBounds();
    if (!b) return null;
    const cols = grid.cols.slice(b.c1, b.c2 + 1);
    const grid = b.rows.map((tr) => cols.map((_c, i) => liveCellText(tr.cells[b.c1 + i])));
    const single = grid.length === 1 && cols.length === 1;
    const heads = withHeaders && !single ? cols.map(colPlainLabel) : null;
    const tsvRows = heads ? [heads, ...grid] : grid;
    const text = tsvRows.map((r) => r.map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
    const asText = (v) => (/^0\d|^\d{11,}$/.test(v) ? ' style="mso-number-format:\'\\@\';border:1px solid #cbd5e1;padding:4px 8px"' : ' style="border:1px solid #cbd5e1;padding:4px 8px"');
    const thStyle = 'background:#1e3a5f;color:#ffffff;font-weight:bold;border:1px solid #94a3b8;padding:5px 8px;text-align:left';
    const html = `<table border="1" cellspacing="0" style="border-collapse:collapse;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt">${
      heads ? `<thead><tr>${heads.map((h) => `<th style="${thStyle}">${esc(h)}</th>`).join('')}</tr></thead>` : ''
    }<tbody>${grid.map((r) => `<tr>${r.map((v) => `<td dir="auto"${asText(v)}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return { text, html, cells: grid.length * cols.length, rows: grid.length, cols: cols.length, single };
  }

  let livePendingCopy = null;
  document.addEventListener('copy', (e) => {
    if (!livePendingCopy) return;
    e.clipboardData.setData('text/plain', livePendingCopy.text);
    if (!livePendingCopy.single) e.clipboardData.setData('text/html', livePendingCopy.html);
    e.preventDefault();
  });

  function copyLiveSelection(withHeaders = true) {
    const payload = buildLiveCopy(withHeaders);
    if (!payload) return false;
    livePendingCopy = payload;
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    livePendingCopy = null;
    if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload.text).catch(() => {});
      ok = true;
    }
    const info = gInfo();
    if (info) {
      const painted = grid;
      grid.copyFlash = true;
      info.textContent = payload.single
        ? 'Copied ✓'
        : `Copied ✓ ${payload.rows} row(s) × ${payload.cols} column(s)${withHeaders ? ' as a table with headers' : ' · values only'} — paste into Excel, email or WhatsApp Web`;
      info.classList.add('is-flash');
      clearTimeout(grid.copyTimer);
      grid.copyTimer = setTimeout(() => {
        painted.copyFlash = false;
        info.classList.remove('is-flash');
        const prev = grid;
        grid = painted;
        paintLiveSel();
        grid = prev;
      }, 2600);
    }
    return ok;
  }

  function afterLiveRender(keepCf) {
    const table = gTable();
    if (!table) return;
    const head = table.tHead && table.tHead.rows[0];
    if (head) table.style.setProperty('--live-ftop', `${head.offsetHeight || 30}px`);
    applyLiveColFilters();
    paintLiveSel();
    if (keepCf) {
      const el = $(`.live-cf[data-cf="${CSS.escape(keepCf.key)}"]`, table);
      if (el) {
        el.focus({ preventScroll: true });
        try { el.setSelectionRange(keepCf.start, keepCf.end); } catch { /* search inputs */ }
      }
    }
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea' || el.isContentEditable;
  }

  function bindLiveSheetGrid(prefix = 'live') {
    const g = sheetGrids[prefix] || sheetGrids.live;
    const table = $(`#${g.prefix}-table`);
    if (!table || table.dataset.gridBound) return;
    table.dataset.gridBound = '1';
    const use = () => { grid = g; };
    let dragging = false;
    let dragMoved = false;
    let cfTimer = null;

    table.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      use();
      const th = e.target.closest('thead tr.live-hrow th');
      if (th && !e.target.closest('input, label')) {
        e.preventDefault();
        selectLiveColumn(th.cellIndex, e.shiftKey);
        return;
      }
      const td = e.target.closest('tbody td');
      if (!td || !td.parentElement.dataset.vin) return;
      if (e.target.closest('input, select, textarea, label')) return;
      const isLink = !!e.target.closest('a, button');
      if (!isLink) {
        e.preventDefault();
        if (isTypingTarget(document.activeElement)) document.activeElement.blur();
      }
      setLiveSel(td, e.shiftKey);
      dragging = true;
      dragMoved = false;
    });
    table.addEventListener('mouseover', (e) => {
      if (!dragging) return;
      use();
      const td = e.target.closest('tbody td');
      if (!td || !td.parentElement.dataset.vin) return;
      const col = grid.cols && grid.cols[td.cellIndex];
      const s = grid.sel;
      if (!col || !s) return;
      if (s.focus.vin === td.parentElement.dataset.vin && s.focus.key === col.key) return;
      dragMoved = true;
      setLiveSel(td, true);
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    table.addEventListener('click', (e) => {
      if (dragMoved && e.target.closest('a, button')) {
        e.preventDefault();
        e.stopPropagation();
      }
      dragMoved = false;
      const clr = e.target.closest('[data-cf-clear]');
      if (clr) {
        use();
        clearLiveColFilters();
      }
    }, true);

    table.addEventListener('input', (e) => {
      const el = e.target.closest('.live-cf');
      if (!el) return;
      use();
      grid.filters[el.dataset.cf] = el.value;
      saveLiveColFilters();
      clearTimeout(cfTimer);
      cfTimer = setTimeout(() => {
        use();
        applyLiveColFilters();
        paintLiveSel();
      }, 160);
    });
    table.addEventListener('focusin', (e) => {
      const el = e.target.closest('.live-cf');
      if (!el) return;
      use();
      fillLiveCfList(el.dataset.cf);
    });

    if (prefix === 'live') {
      document.addEventListener('keydown', (e) => {
        const onMy = state.view === 'my' || state.view === 'mine';
        const onLive = state.view === 'live';
        if (!onMy && !onLive) return;
        grid = onMy ? sheetGrids.my : sheetGrids.live;
        if (!grid.sel) return;
        const active = document.activeElement;
        if (isTypingTarget(active)) return;
        if (document.querySelector('#vin-drawer-back.open')) return;
        const k = String(e.key || '').toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 'c') {
          e.preventDefault();
          copyLiveSelection(true);
        } else if (k === 'escape') {
          grid.sel = null;
          paintLiveSel();
        }
      });
    }

    const copyBtn = $(`#${g.prefix}-copy-btn`);
    if (copyBtn) copyBtn.addEventListener('click', () => { use(); copyLiveSelection(true); });
    const valBtn = $(`#${g.prefix}-copy-values`);
    if (valBtn) valBtn.addEventListener('click', () => { use(); copyLiveSelection(false); });
    const clearBtn = $(`#${g.prefix}-cf-clear`);
    if (clearBtn) clearBtn.addEventListener('click', () => { use(); clearLiveColFilters(); });
  }

  function bindSelChecks(table, rows) {
    $$('.sel-check', table).forEach((cb) => cb.addEventListener('change', () => setSelected(cb.dataset.vin, cb.checked)));
    const all = $('.sel-all', table);
    if (!all) return;
    const visibleRows = () => rows.filter((r) => {
      const tr = table.querySelector(`tbody tr[data-vin="${CSS.escape(r.vin)}"]`);
      return !tr || tr.style.display !== 'none';
    });
    all.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.vin));
    all.addEventListener('change', () => {
      const vis = visibleRows();
      vis.forEach((r) => {
        if (all.checked) state.selected.add(r.vin);
        else state.selected.delete(r.vin);
      });
      rememberSelInfo(rows);
      saveSelection();
      $$('.sel-check', table).forEach((cb) => {
        const tr = cb.closest('tr');
        if (tr && tr.style.display === 'none') return;
        cb.checked = all.checked;
        tr.classList.toggle('selected', all.checked);
      });
      renderSelBars();
    });
  }

  // ——— My VINs ———
  function scheduleColumns() {
    return [
      ['Proforma', (r) => esc(na(r.raw.proformaDate))],
      ['Order', (r) => esc(na(r.raw.salesOrder))],
      ['VIN', (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['Sales Type', (r) => esc(na(r.raw.salesType))],
      ['Customer', (r) => esc(na(r.raw.userName))],
      ['Invoice Owner', (r) => esc(na(r.raw.invoiceOwner))],
      ['Phone', (r) => (r.raw.phone ? `<a href="tel:${esc(r.raw.phone)}" class="phone-link">${esc(r.raw.phone)}</a>` : 'N/A')],
      ['Product', (r) => esc(na(r.raw.product))],
      ['S/A', (r) => esc(na(r.raw.salesAdvisor))],
      ['GT Loc', (r) => esc(na(r.raw.gtLocation))],
      ['Veh Loc', (r) => esc(na(r.raw.vehicleLocation))],
      ['Guest Exp', (r) => editableControl(r.vin, 'guestCenter', 'yn', r.ops.guestCenter)],
      ['Appointment', (r) => (isGuestYes(r) ? guestTimerHtml(r.ops) : '—')],
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
      ['الناقل', (r) => (canAssignCarrier()
        ? editableControl(r.vin, 'carrier', 'carrier', r.ops.carrier)
        : readOnlyValue('carrier', r.ops.carrier)) + carrierChangeNote(r.ops)],
      ['ملاحظات', (r) => editableControl(r.vin, 'notes', 'notes', r.ops.notes)],
      ['Open', (r) => `<button type="button" class="btn vin-link" data-vin="${esc(r.vin)}">Full edit</button>`],
    ];
  }

  async function loadMy({ silent = false } = {}) {
    const statusSel = $('#my-status');
    if (statusSel && !statusSel.dataset.filled) {
      statusSel.innerHTML = `<option value="">All statuses</option>${(state.meta.statuses || []).map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
      statusSel.dataset.filled = '1';
    }
    grid = sheetGrids.my;
    const data = await fetchLive({
      q: state.myFilters.q,
      status: state.myFilters.status,
      employee: (state.view === 'mine' || !isManager()) ? state.user.name : '',
    });
    const table = $('#my-table');
    const active = document.activeElement;
    if (silent && table && active && table.contains(active) && active.classList
      && (active.classList.contains('cell-edit') || active.classList.contains('live-cf'))) {
      return;
    }
    const w = myWorkload(data.rows || []);
    const typeKpis = Object.entries(w.bySalesType).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([l, v]) => [l, v, 'info']);
    $('#my-kpis').innerHTML = [
      ['Assigned', w.assigned, ''],
      ['Completed', w.completed, 'ok'],
      ['Remaining', w.remaining, 'warn'],
      ['Progress %', `${w.progress}%`, 'info'],
      ...typeKpis,
    ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');

    ensureDatalists();
    const cols = [
      {
        key: 'num',
        label: '<input type="checkbox" class="checkbox sel-all" title="Select all shown" />',
        raw: true,
        html: (r, i) => `<label class="sel-cell"><input type="checkbox" class="checkbox sel-check" data-vin="${esc(r.vin)}" ${state.selected.has(r.vin) ? 'checked' : ''} /><span>${i + 1}</span></label>`,
      },
      { key: 'employee', label: 'Employee', html: (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>` },
      { key: 'status', label: 'Status', html: (r) => (r.canEdit ? editableControl(r.vin, 'opsStatus', 'status', r.ops.opsStatus) : readOnlyValue('status', r.ops.opsStatus)) },
      { key: 'vin', label: 'VIN', html: (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>` },
      { key: 'proforma', label: 'Proforma', html: (r) => esc(na(r.raw.proformaDate)) },
      { key: 'order', label: 'Order', html: (r) => esc(na(r.raw.salesOrder)) },
      { key: 'product', label: 'Product', html: (r) => esc(na(r.raw.product)) },
      { key: 'salestype', label: 'Sales Type', html: (r) => esc(na(r.raw.salesType)) },
      { key: 'customer', label: 'Customer', html: (r) => `<span title="${esc(r.raw.userName || '')}">${esc(na(r.raw.userName))}</span>` },
      { key: 'owner', label: 'Invoice Owner', html: (r) => `<span title="${esc(r.raw.invoiceOwner || '')}">${esc(na(r.raw.invoiceOwner))}</span>` },
      { key: 'phone', label: 'Phone', html: (r) => (r.raw.phone ? `<a href="tel:${esc(r.raw.phone)}" class="phone-link">${esc(r.raw.phone)}</a>` : 'N/A') },
      { key: 'sa', label: 'S/A', html: (r) => esc(na(r.raw.salesAdvisor)) },
      { key: 'guest', label: 'Guest Exp', html: (r) => (r.canEdit ? editableControl(r.vin, 'guestCenter', 'yn', r.ops.guestCenter) : readOnlyValue('yn', r.ops.guestCenter)) },
      { key: 'appt', label: 'Appointment', html: (r) => (isGuestYes(r) ? guestTimerHtml(r.ops) : '—') },
      { key: 'gt', label: 'GT Loc', html: (r) => esc(na(r.raw.gtLocation)) },
      { key: 'veh', label: 'Veh Loc', html: (r) => esc(na(r.raw.vehicleLocation)) },
      { key: 'guestsent', label: 'إرسال الضيف', html: (r) => (r.canEdit ? editableControl(r.vin, 'guestSentDate', 'date', r.ops.guestSentDate) : readOnlyValue('date', r.ops.guestSentDate)) },
      { key: 'sig', label: 'استلام التواقيع', html: (r) => (r.canEdit ? editableControl(r.vin, 'signatureReceivedDate', 'date', r.ops.signatureReceivedDate) : readOnlyValue('date', r.ops.signatureReceivedDate)) },
      { key: 'accsent', label: 'إرسال للحسابات', html: (r) => (r.canEdit ? editableControl(r.vin, 'accountsSentDate', 'date', r.ops.accountsSentDate) : readOnlyValue('date', r.ops.accountsSentDate)) },
      { key: 'accok', label: 'موافقة الحسابات', html: (r) => (r.canEdit ? editableControl(r.vin, 'accountsApprovalDate', 'date', r.ops.accountsApprovalDate) : readOnlyValue('date', r.ops.accountsApprovalDate)) },
      { key: 'vin1502', label: 'VIN 1502', html: (r) => (r.canEdit ? editableControl(r.vin, 'vin1502', 'yn', r.ops.vin1502) : readOnlyValue('yn', r.ops.vin1502)) },
      { key: 'traffic', label: 'ملف المرور', html: (r) => (r.canEdit ? editableControl(r.vin, 'trafficFile', 'yn', r.ops.trafficFile) : readOnlyValue('yn', r.ops.trafficFile)) },
      { key: 'fees', label: 'Traffic Fees', html: (r) => (r.canEdit ? editableControl(r.vin, 'trafficFeesOps', 'yn', r.ops.trafficFeesOps) : readOnlyValue('yn', r.ops.trafficFeesOps)) },
      { key: 'ins', label: 'Insurance', html: (r) => (r.canEdit ? editableControl(r.vin, 'insuranceOps', 'yn', r.ops.insuranceOps) : readOnlyValue('yn', r.ops.insuranceOps)) },
      { key: 'reg', label: 'إصدار الاستمارة', html: (r) => (r.canEdit ? editableControl(r.vin, 'registrationIssueDate', 'date', r.ops.registrationIssueDate) : readOnlyValue('date', r.ops.registrationIssueDate)) },
      { key: 'city', label: 'مدينة الترحيل', html: (r) => (r.canEdit ? editableControl(r.vin, 'transferCity', 'city', r.ops.transferCity) : readOnlyValue('city', r.ops.transferCity)) },
      { key: 'carrier', label: 'الناقل', html: (r) => ((r.canEdit && canAssignCarrier()) ? editableControl(r.vin, 'carrier', 'carrier', r.ops.carrier) : readOnlyValue('carrier', r.ops.carrier)) + carrierChangeNote(r.ops) },
      { key: 'notes', label: 'ملاحظات', html: (r) => (r.canEdit ? editableControl(r.vin, 'notes', 'notes', r.ops.notes) : readOnlyValue('notes', r.ops.notes)) },
      { key: 'updated', label: 'Updated', html: (r) => esc((r.ops.updatedAt || '').replace('T', ' ').slice(0, 19) || '—') },
      { key: 'by', label: 'By', html: (r) => esc(na(r.ops.updatedBy)) },
    ];
    const keepCf = active && active.classList && active.classList.contains('live-cf') && table && table.contains(active)
      ? { key: active.dataset.cf, start: active.selectionStart, end: active.selectionEnd }
      : null;
    grid.cols = cols;
    const cf = grid.filters;
    const cfOn = activeLiveColRules().length;
    const frow = `<tr class="live-frow">${cols.map((c) => (c.key === 'num'
      ? `<th class="col-num">${cfOn ? '<button type="button" class="live-cf-x" data-cf-clear title="Clear column filters">✕</button>' : ''}</th>`
      : `<th class="col-${c.key}${cf[c.key] ? ' is-on' : ''}"><input type="search" class="live-cf" data-cf="${esc(c.key)}" value="${esc(cf[c.key] || '')}" list="my-cf-list" placeholder="Filter…" autocomplete="off" spellcheck="false" title="${esc(`${colPlainLabel(c)}: ${LIVE_CF_HINT}`)}" aria-label="Filter ${esc(colPlainLabel(c))}" /></th>`)).join('')}</tr>`;
    const empty = isManager() && state.view !== 'mine' ? 'No VINs on the sheet yet.' : 'No VINs assigned to you yet.';
    table.innerHTML = `<thead><tr class="live-hrow">${cols.map((c) => `<th class="col-${c.key}">${c.raw ? c.label : esc(c.label)}</th>`).join('')}</tr>${frow}</thead>
      <tbody>${w.rows.map((r, i) => `<tr class="${statusRowClass(r.ops.opsStatus)}${isGuestYes(r) ? ' row-guest-exp' : ''}${state.selected.has(r.vin) ? ' selected' : ''}" data-vin="${esc(r.vin)}">${cols.map((c) =>
        `<td class="col-${c.key}">${c.html(r, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">${empty}</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindEditableCells(table);
    bindSelChecks(table, w.rows);
    $('#my-pager').innerHTML = `<span>${w.assigned} VIN(s) · all on this page</span>`;
    renderSelBars();
    afterLiveRender(keepCf);
  }

  // ——— Appointment (Ruba · Guest Exp = Yes) ———
  async function loadAppointmentBadge() {
    if (!isRuba()) return;
    try {
      const data = await api('/appointments');
      state.appointmentOpen = data.open || 0;
      state.appointmentDue = data.due || 0;
      renderNav();
    } catch {
      /* keep last badge */
    }
  }

  async function loadAppointments({ silent = false } = {}) {
    const data = await api('/appointments');
    state.appointmentOpen = data.open || 0;
    state.appointmentDue = data.due || 0;
    renderNav();
    const kpis = $('#appt-kpis');
    if (kpis) {
      kpis.innerHTML = [
        ['Guest Exp Yes', data.total || 0, ''],
        ['Need time', data.open || 0, 'warn'],
        ['Due now', data.due || 0, 'bad'],
      ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');
    }
    const host = $('#appt-list');
    if (!host) return;
    const active = document.activeElement;
    if (silent && active && host.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'BUTTON')) {
      tickGuestTimers();
      return;
    }
    const rows = data.rows || [];
    if (!rows.length) {
      host.innerHTML = '<p class="appt-empty">No Guest Exp cars yet. When anyone marks Guest Exp = Yes, the VIN appears here so you can set the appointment.</p>';
      return;
    }
    host.innerHTML = rows.map((r) => {
      const at = (r.ops && r.ops.guestCollectAt) || '';
      const due = !!(parseGuestAt(at) && parseGuestAt(at) <= Date.now());
      const parts = splitLocalAt(at);
      const note = (r.ops && r.ops.guestCollectNote) || '';
      return `<article class="appt-card ${at ? '' : 'is-open'} ${due ? 'is-due' : ''}" data-vin="${esc(r.vin)}">
        <div class="appt-head">
          <div class="appt-vin">
            <button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>
            <span class="guest-badge">Guest Exp</span>
            ${statusBadge(r.ops && r.ops.opsStatus)}
          </div>
          ${guestTimerHtml(r.ops)}
        </div>
        <div class="appt-meta">
          <span>${esc(na(r.raw.userName))}</span>
          <span>${esc(na(r.raw.product))}</span>
          <span>${esc(na(r.ops.assignedEmployeeName))}</span>
          ${r.raw.phone ? `<a href="tel:${esc(r.raw.phone)}" class="phone-link">${esc(r.raw.phone)}</a>` : ''}
        </div>
        <form class="appt-form" data-vin="${esc(r.vin)}">
          <label>Date <input type="date" name="date" required value="${esc(parts.date)}" /></label>
          <label>Time <input type="time" name="time" required value="${esc(parts.time)}" /></label>
          <label class="grow">Note <input type="text" name="note" value="${esc(note)}" placeholder="Visit note…" /></label>
          <button type="submit" class="btn-primary" style="width:auto">Save appointment</button>
        </form>
      </article>`;
    }).join('');
    $$('.vin-link', host).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    $$('.appt-form', host).forEach((form) => form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveAppointment(form).catch((err) => alert(err.message || 'Could not save appointment'));
    }));
  }

  async function saveAppointment(form) {
    const vin = form.dataset.vin;
    const date = form.querySelector('[name="date"]').value;
    const time = form.querySelector('[name="time"]').value;
    const note = form.querySelector('[name="note"]').value;
    const btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    try {
      await api(`/vehicles/${encodeURIComponent(vin)}/appointment`, {
        method: 'POST',
        json: { date, time, note },
      });
      await loadAppointments();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save appointment';
      }
    }
  }

  // ——— VIN drawer ———
  function buildDrawerHtml(v, readOnly) {
    const cities = state.meta.transferCities || [];
    const ro = (label, val) => `<div class="field"><label>${esc(label)}</label><input value="${esc(na(val))}" readonly /></div>`;
    const yn = (key, label, val) => (readOnly ? ro(label, val)
      : `<div class="field"><label>${esc(label)}</label>
        <div class="yn" data-yn="${key}">
          <button type="button" class="yes ${val === 'Yes' ? 'active' : ''}" data-v="Yes">🟢 YES</button>
          <button type="button" class="no ${val === 'No' ? 'active' : ''}" data-v="No">🔴 NO</button>
        </div></div>`);
    const dt = (key, label, val) => (readOnly ? ro(label, val)
      : `<div class="field"><label>${esc(label)}</label><input type="date" data-ops="${key}" value="${esc(val || '')}" /></div>`);
    const sel = (key, label, list, val, placeholder) => (readOnly ? ro(label, val)
      : `<div class="field"><label>${esc(label)}</label>
        <select data-ops="${key}"><option value="">${placeholder}</option>${list.map((s) =>
          `<option value="${esc(s)}" ${val === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>`);

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
            ['Sales Type', v.raw.salesType], ['S/A', v.raw.salesAdvisor],
            ['Customer Name', v.raw.userName], ['Invoice Owner', v.raw.invoiceOwner],
            ['Phone', v.raw.phone],
            ['GT Location', v.raw.gtLocation], ['Vehicle Location', v.raw.vehicleLocation],
            ['PIC', v.raw.pic],
          ].map(([l, val]) => ro(l, val)).join('')}
        </div>
        <div class="card">
          <h2>Delivery information${readOnly ? ' (teammate — view only)' : ''}</h2>
          <p class="hint">${readOnly ? 'Only the assigned employee can edit this VIN' : 'Employee updates · saves immediately'}</p>
          <div id="save-line" class="save-toast" hidden>Saved ✓</div>
          ${dt('guestSentDate', 'تاريخ إرسال الضيف', v.ops.guestSentDate)}
          ${sel('guestCenter', 'Guest Exp', ['Yes', 'No'], v.ops.guestCenter, '—')}
          ${isGuestYes(v) ? `<div class="field"><label>Appointment</label><div>${guestTimerHtml(v.ops)}${v.ops.guestCollectNote ? ` <span class="hint">${esc(v.ops.guestCollectNote)}</span>` : ''}</div></div>` : ''}
          ${dt('signatureReceivedDate', 'تاريخ استلام التواقيع من الضيف', v.ops.signatureReceivedDate)}
          ${dt('accountsSentDate', 'تاريخ إرسال الملف للحسابات', v.ops.accountsSentDate)}
          ${dt('accountsApprovalDate', 'تاريخ موافقة الحسابات', v.ops.accountsApprovalDate)}
          ${readOnly
            ? ro('Status', v.ops.opsStatus)
            : `<div class="field"><label>Status</label>${String(v.ops.opsStatus || '').trim()
              ? `${stickyControl(v.vin, 'opsStatus', v.ops.opsStatus)}<p class="hint">Set once. Double-click to change.</p>`
              : `<select class="cell-edit" data-ops="opsStatus" data-field="opsStatus" data-vin="${esc(v.vin)}">${choiceOptionsHtml('opsStatus', '', true)}</select>`}</div>`}
          ${yn('vin1502', 'Current VIN 1502?', v.ops.vin1502)}
          ${yn('trafficFile', 'ملف المرور', v.ops.trafficFile)}
          ${yn('trafficFeesOps', 'Traffic Fees', v.ops.trafficFeesOps)}
          ${yn('insuranceOps', 'Insurance', v.ops.insuranceOps)}
          ${dt('registrationIssueDate', 'تاريخ إصدار الاستمارة', v.ops.registrationIssueDate)}
          ${readOnly ? ro('مدينة الترحيل', v.ops.transferCity) : `<div class="field"><label>مدينة الترحيل</label>
            <input list="city-list" data-ops="transferCity" value="${esc(v.ops.transferCity || '')}" placeholder="Search city…" />
            <datalist id="city-list">${cities.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          </div>`}
          ${canAssignCarrier()
            ? `<div class="field"><label>الناقل</label>${String(v.ops.carrier || '').trim()
              ? `${stickyControl(v.vin, 'carrier', v.ops.carrier)}<p class="hint">Assigned once. Double-click to reassign.</p>`
              : `<select class="cell-edit" data-ops="carrier" data-field="carrier" data-vin="${esc(v.vin)}">${choiceOptionsHtml('carrier', '', true)}</select>`}</div>`
            : ro('الناقل', v.ops.carrier)}
          ${carrierChangeNote(v.ops)}
          ${readOnly
            ? `<div class="field"><label>ملاحظات</label><textarea readonly>${esc(v.ops.notes || '')}</textarea></div>`
            : `<div class="field"><label>ملاحظات</label><textarea data-ops="notes" rows="3">${esc(v.ops.notes || '')}</textarea></div>`}
          <p class="hint" id="last-updated">Last updated: ${esc(v.ops.updatedAt || '—')}</p>
        </div>
      </div>`;
  }

  async function openVin(vin) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    applyPendingToRows([v]);
    state._drawerVin = vin;
    const back = $('#vin-drawer-back');
    const drawer = $('#vin-drawer');
    const readOnly = !v.canEdit;
    drawer.innerHTML = buildDrawerHtml(v, readOnly);
    drawer.dataset.drawerVin = vin;
    back.classList.add('open');
    const close = async () => {
      await flushPendingOps().catch(() => {});
      back.classList.remove('open');
      state._drawerVin = '';
      refreshView();
    };
    $('#drawer-close', drawer).onclick = () => { close().catch(() => {}); };
    back.onclick = (e) => { if (e.target === back) close().catch(() => {}); };
    if (readOnly) return;

    async function savePatch(patch, el) {
      const field = Object.keys(patch)[0];
      const value = patch[field];
      if (wouldClearSaved(vin, field, value)) return true;
      try {
        markPending(vin, field, value);
        await pushOpsPatch(vin, field, value);
        const key = pendKey(vin, field);
        const cur = pendingOps.get(key);
        if (cur && String(cur.value) === String(value)) {
          pendingOps.delete(key);
          persistDrafts();
        }
        if (v.ops) v.ops[field] = value;
        const line = $('#save-line', drawer);
        if (line) {
          line.hidden = false;
          line.textContent = `Saved ✓ · ${new Date().toLocaleTimeString()}`;
          setTimeout(() => { line.hidden = true; }, 2500);
        }
        const last = $('#last-updated', drawer);
        if (last) last.textContent = `Last updated: ${new Date().toISOString()}`;
        if (el) {
          el.classList.add('is-saved');
          setTimeout(() => el.classList.remove('is-saved'), 1200);
        }
        return true;
      } catch (err) {
        alert(err.message || 'Save failed — entry kept locally until it syncs');
        return false;
      }
    }
    $$('.choice-lock', drawer).forEach(bindChoiceLock);
    $$('[data-ops]', drawer).forEach((el) => {
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const instant = tag === 'select' || type === 'date';
      if (stickyField(el.dataset.ops)) {
        el.addEventListener('change', () => {
          const value = String(el.value || '').trim();
          if (!value) return;
          const field = el.dataset.ops;
          el.dataset.field = field;
          el.dataset.vin = el.dataset.vin || vin;
          savePatch({ [field]: value }, el).then((ok) => {
            if (ok) lockChoiceEl(el, field, value);
          });
        });
        return;
      }
      el.addEventListener('change', () => savePatch({ [el.dataset.ops]: el.value }, el));
      if (!instant) {
        el.addEventListener('input', () => {
          if (wouldClearSaved(vin, el.dataset.ops, el.value)) return;
          markPending(vin, el.dataset.ops, el.value);
          const key = pendKey(vin, el.dataset.ops);
          if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
          saveTimers.set(key, setTimeout(() => {
            saveTimers.delete(key);
            savePatch({ [el.dataset.ops]: el.value }, el);
          }, 350));
        });
      }
      el.addEventListener('blur', () => savePatch({ [el.dataset.ops]: el.value }, el));
    });
    $$('[data-yn]', drawer).forEach((group) => {
      $$('button', group).forEach((b) => b.addEventListener('click', () => {
        $$('button', group).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        savePatch({ [group.dataset.yn]: b.dataset.v });
      }));
    });
  }

  // ——— Session ———
  function renderMonthCloseBanner(mc) {
    const ban = $('#month-close-banner');
    if (!ban) return;
    const show = !!(isManager() && mc && mc.pending);
    ban.classList.toggle('hidden', !show);
    if (!show) return;
    const title = $('#month-close-title');
    const text = $('#month-close-text');
    const applyBtn = $('#month-close-apply');
    if (title) title.textContent = `Month ${mc.forMonth || ''} archive ready`;
    if (text) {
      text.textContent = mc.downloaded
        ? `Excel downloaded · click Clear Live Sheet to remove ${mc.willRemove || 0} VIN(s) with status PSFU / Claimed / تم التسليم (keep ${mc.willKeep || 0}).`
        : `Day-1 archive · download Excel first (${mc.total || 0} VINs). Then clear PSFU / Claimed / تم التسليم from the Live Sheet (keep other statuses).`;
    }
    if (applyBtn) applyBtn.disabled = !mc.downloaded;
  }

  async function refreshMonthClose() {
    if (!isManager()) return;
    try {
      const mc = await api('/month-close');
      renderMonthCloseBanner(mc);
    } catch {
      /* ignore */
    }
  }

  async function extractLiveSheet() {
    await downloadFile('/export/live-sheet', 'DT-Live-Sheet.xlsx');
  }

  async function downloadMonthClose() {
    await downloadFile('/month-close/download', `DT-Month-Close.xlsx`);
    await refreshMonthClose();
    alert('Excel downloaded. After you save it, click Clear Live Sheet.');
  }

  async function applyMonthClose() {
    if (!confirm('Remove all VINs with status PSFU, Claimed, or تم التسليم from the Live Sheet? Other statuses stay.')) return;
    const res = await api('/month-close/apply', { method: 'POST', json: {} });
    renderMonthCloseBanner(res.monthClose);
    alert(`Done · kept ${res.kept || 0} · removed ${res.removed || 0}`);
    refreshView().catch(() => {});
  }

  function showApp() {
    $('#login-screen').style.display = 'none';
    $('#app').classList.add('is-on');
    loadSelection();
    loadLiveColFilters();
    bindLiveSheetGrid('live');
    bindLiveSheetGrid('my');
    loadDrafts();
    startGuestTick();
    const extractBtn = $('#extract-live');
    if (extractBtn) extractBtn.hidden = !(state.user && state.user.id === 'hanouf');
    const who = canEditAnyVin() ? 'every VIN' : 'your VINs';
    const lockNote = canAssignCarrier()
      ? ' Status and الناقل save on the first choice. Double-click either one to change it.'
      : ' Status saves on the first choice. Double-click it to change.';
    const hint = $('#live-edit-hint');
    if (hint) hint.textContent = `${state.user.name} can edit ${who} directly on this sheet.${lockNote}`;
    loadAppointmentBadge().catch(() => {});
    setView('dashboard');
    flushPendingOps().catch(() => {});
    refreshMonthClose().catch(() => {});
  }

  async function logout() {
    try {
      await flushPendingOps({ keepalive: true });
    } catch {
      /* keep going */
    }
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    location.reload();
  }

  async function login() {
    $('#login-error').textContent = '';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: { username: $('#login-user').value, password: $('#login-pass').value },
      });
      if (data.user.role === 'coordinator' || data.user.role === 'admin') {
        $('#login-error').textContent = 'This page is for delivery employees. Open the coordinator page to sign in.';
        return;
      }
      setSession(data.token, data.user);
      state.user = data.user;
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message || 'Login failed';
    }
  }

  async function boot() {
    state.meta = await api('/meta');
    const users = (state.meta.users || []).filter((u) => u.role === 'employee' || u.role === 'hanouf');
    $('#login-user').innerHTML = users.map((u) =>
      `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.role)})</option>`).join('');
    $('#login-pills').innerHTML = users.map((u) =>
      `<button type="button" data-u="${esc(u.id)}">${esc(u.name)}</button>`).join('');
    $$('#login-pills button').forEach((b) => b.addEventListener('click', () => {
      $('#login-user').value = b.dataset.u;
      $$('#login-pills button').forEach((x) => x.classList.toggle('active', x === b));
    }));

    if (getToken() && getUser()) {
      try {
        const me = await api('/auth/me');
        if (me.user.role === 'coordinator' || me.user.role === 'admin') {
          return;
        }
        state.user = me.user;
        showApp();
      } catch {
        clearSession();
      }
    }
  }

  // ——— Events ———
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushPendingOps({ keepalive: true }).catch(() => {});
      return;
    }
    if (state.user && $('#app').classList.contains('is-on')) {
      refreshViewSilent().catch(() => {});
    }
  });
  window.addEventListener('pagehide', () => {
    flushPendingOps({ keepalive: true }).catch(() => {});
  });
  window.addEventListener('beforeunload', () => {
    // Capture + persist drafts synchronously; keepalive fetch runs in pagehide
    $$('.cell-edit').forEach((el) => {
      if (!el.dataset.vin || !el.dataset.field) return;
      if (wouldClearSaved(el.dataset.vin, el.dataset.field, el.value)) return;
      markPending(el.dataset.vin, el.dataset.field, el.value);
    });
    persistDrafts();
  });
  window.addEventListener('focus', () => {
    if (state.user && $('#app').classList.contains('is-on')) {
      refreshViewSilent().catch(() => {});
    }
  });
  $('#login-btn').addEventListener('click', login);
  $('#login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#logout-btn').addEventListener('click', () => { logout().catch(() => location.reload()); });
  $('#refresh-btn').addEventListener('click', () => {
    flushPendingOps().then(() => refreshView()).catch(() => refreshView());
    refreshMonthClose().catch(() => {});
  });
  if ($('#extract-live')) {
    $('#extract-live').addEventListener('click', () => {
      extractLiveSheet().catch((err) => alert(err.message || 'Could not extract the Live Sheet'));
    });
  }
  if ($('#month-close-download')) {
    $('#month-close-download').addEventListener('click', () => {
      downloadMonthClose().catch((err) => alert(err.message || 'Download failed'));
    });
  }
  if ($('#month-close-apply')) {
    $('#month-close-apply').addEventListener('click', () => {
      applyMonthClose().catch((err) => alert(err.message || 'Clear failed'));
    });
  }
  $('#global-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    state.liveFilters.q = e.target.value.trim();
    if ($('#live-q')) $('#live-q').value = state.liveFilters.q;
    setView('live');
  });
  $('#dash-month').addEventListener('change', (e) => { state.monthFilter = e.target.value; loadDashboard(); });
  $('#dash-month-all').addEventListener('click', () => { state.monthFilter = ''; loadDashboard(); });

  let liveQTimer;
  $('#live-q').addEventListener('input', (e) => {
    clearTimeout(liveQTimer);
    liveQTimer = setTimeout(() => { state.liveFilters.q = e.target.value.trim(); loadLiveSheet(); }, 250);
  });
  $('#live-month').addEventListener('change', (e) => { state.liveFilters.month = e.target.value; loadLiveSheet(); });
  $('#live-employee').addEventListener('change', (e) => { state.liveFilters.employee = e.target.value; loadLiveSheet(); });
  $('#live-status').addEventListener('change', (e) => { state.liveFilters.status = e.target.value; loadLiveSheet(); });
  $('#live-carrier').addEventListener('change', (e) => { state.liveFilters.carrier = e.target.value; loadLiveSheet(); });
  $('#live-refresh').addEventListener('click', () => loadLiveSheet());

  let myQTimer;
  $('#my-q').addEventListener('input', (e) => {
    clearTimeout(myQTimer);
    myQTimer = setTimeout(() => { state.myFilters.q = e.target.value.trim(); loadMy(); }, 250);
  });
  $('#my-status').addEventListener('change', (e) => { state.myFilters.status = e.target.value; loadMy(); });
  $('#my-clear').addEventListener('click', () => {
    state.myFilters = { q: '', status: '' };
    $('#my-q').value = '';
    $('#my-status').value = '';
    loadMy();
  });
  const fail = (err) => alert(err.message || 'Failed');
  $('#asg-confirm-all').addEventListener('click', () => confirmAssignments().catch(fail));
  $('#asg-dismiss').addEventListener('click', () => dismissAssignments().catch(fail));
  $('#tgt-month').addEventListener('change', (e) => {
    state.targetMonth = e.target.value || state.meta.currentMonth;
    loadTargets().catch((err) => alert(err.message));
  });
  $('#tgt-month-now').addEventListener('click', () => {
    state.targetMonth = state.meta.currentMonth;
    loadTargets().catch((err) => alert(err.message));
  });
  $('#tgt-basis').addEventListener('change', () => loadTargets().catch((err) => alert(err.message)));
  $('#tgt-save').addEventListener('click', () => saveTargets().catch((err) => alert(err.message)));
  $('#tgt-table').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('tgt-input')) saveTargets().catch((err) => alert(err.message));
  });
  wireDrop('#upload-drop', '#upload-file', doUpload);
  wireDrop('#sales-raw-drop', '#sales-raw-file', doSalesRaw);

  boot().catch((e) => { $('#login-error').textContent = e.message; });
})();
