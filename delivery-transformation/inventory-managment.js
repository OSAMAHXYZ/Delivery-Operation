/* Inventory Management — Ruba / الفاضل / البراء */
(() => {
  const { api, esc, getToken, getUser, setSession, clearSession, useSessionScope, migrateLegacySession } = window.DTX;
  useSessionScope('inventory');

  const ALLOWED = [
    { id: 'ruba', name: 'Ruba' },
    { id: 'alfadel', name: 'الفاضل' },
    { id: 'albara', name: 'البراء' },
  ];
  migrateLegacySession((u) => !!(u && (u.canInventory || ALLOWED.some((a) => a.id === u.id))));

  const $ = (id) => document.getElementById(id);
  const state = {
    view: 'all',
    q: '',
    pool: [],
    selected: new Set(),
    poll: null,
    user: null,
    label: 'delivery',
    labelWait: null,
  };

  function showApp(on) {
    $('login-screen').classList.toggle('hidden', on);
    $('app').classList.toggle('is-on', on);
  }

  function canUse(user) {
    return !!(user && (user.canInventory || ALLOWED.some((u) => u.id === user.id)));
  }

  function isRuba() {
    const u = state.user;
    if (!u) return false;
    return u.id === 'ruba' || String(u.name || '').toLowerCase() === 'ruba';
  }

  function fillLogin() {
    $('login-user').innerHTML = '<option value="">— Choose user —</option>'
      + ALLOWED.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    $('login-pills').innerHTML = ALLOWED.map((u) => (
      `<button type="button" data-id="${esc(u.id)}">${esc(u.name)}</button>`
    )).join('');
    $('login-pills').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      $('login-user').value = btn.dataset.id;
      $$('login-pills button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  }

  function $$(sel) {
    return [...document.querySelectorAll(sel)];
  }

  async function login() {
    $('login-error').textContent = '';
    const username = $('login-user').value;
    if (!username) {
      $('login-error').textContent = 'Choose Ruba, الفاضل, or البراء';
      return;
    }
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: { username, password: $('login-pass').value },
      });
      if (!canUse(data.user)) {
        $('login-error').textContent = 'This page is only for Ruba, الفاضل, and البراء';
        return;
      }
      setSession(data.token, data.user);
      enter(data.user);
    } catch (err) {
      $('login-error').textContent = err.message || 'Sign in failed';
    }
  }

  function logout() {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    stopPoll();
    location.reload();
  }

  function syncRubaToolbar() {
    const ruba = isRuba();
    const labelBar = $('label-bar');
    if (labelBar) labelBar.classList.toggle('hidden', !ruba);
    if ($('claim-btn')) $('claim-btn').classList.toggle('hidden', ruba);
    if ($('claim-display-btn')) $('claim-display-btn').classList.toggle('hidden', !ruba);
    if ($('claim-delivery-btn')) $('claim-delivery-btn').classList.toggle('hidden', !ruba);
  }

  function enter(user) {
    state.user = user;
    $('side-name').textContent = user.name;
    syncRubaToolbar();
    syncLabelPills();
    showApp(true);
    load().catch((e) => { $('login-error').textContent = e.message; });
    startPoll();
  }

  function syncLabelPills() {
    $$('#label-pills button').forEach((b) => {
      b.classList.toggle('active', b.dataset.label === state.label);
    });
  }

  function startPoll() {
    stopPoll();
    state.poll = setInterval(() => load({ silent: true }).catch(() => {}), 4000);
  }

  function stopPoll() {
    if (state.poll) { clearInterval(state.poll); state.poll = null; }
  }

  function applyPayload(data) {
    state.pool = data.pool || [];
    const keep = new Set(state.pool.map((r) => r.vin));
    state.selected.forEach((vin) => { if (!keep.has(vin)) state.selected.delete(vin); });
    const extras = isRuba()
      ? [
        kpi('Display', data.display || 0),
        kpi('Delivery', data.delivery || 0),
      ]
      : [];
    $('kpi-row').innerHTML = [
      kpi('Open VINs', data.total || 0),
      kpi('Unclaimed', data.unclaimed || 0),
      kpi('My stock', data.mine || 0),
      ...extras,
      ...(data.users || []).map((u) => kpi(u.name, u.stockIn != null ? u.stockIn : (Array.isArray(u.stock) ? u.stock.length : (u.stock || 0)))),
    ].join('');
    render();
  }

  function kpi(label, n) {
    return `<div class="kpi"><span>${esc(label)}</span><strong>${esc(n)}</strong></div>`;
  }

  async function load() {
    const data = await api('/inventory');
    applyPayload(data);
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const me = state.user && state.user.id;
    return state.pool.filter((r) => {
      if (state.view === 'mine' && r.stockOwnerId !== me) return false;
      if (state.view === 'open' && r.stockOwnerId) return false;
      if (state.view === 'display' && r.label !== 'display') return false;
      if (state.view === 'delivery' && r.label !== 'delivery') return false;
      if (!q) return true;
      const hay = [r.vin, r.product, r.salesType, r.customer, r.employee, r.stockOwner, r.source, r.label]
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function labelBadge(label) {
    if (label === 'display') return '<span class="badge display">Display</span>';
    if (label === 'delivery') return '<span class="badge delivery">Delivery</span>';
    return '<span class="badge">—</span>';
  }

  function render() {
    const rows = filtered();
    const me = state.user && state.user.id;
    const ruba = isRuba();
    $('empty').classList.toggle('hidden', rows.length > 0);
    $('rows').innerHTML = rows.map((r) => {
      const mine = r.stockOwnerId === me;
      const checked = state.selected.has(r.vin) ? ' checked' : '';
      let action = '';
      if (mine) {
        action = `<button type="button" class="row-btn release" data-act="release" data-vin="${esc(r.vin)}">Release</button>`;
        if (ruba) {
          action += `
            <button type="button" class="row-btn label-display${r.label === 'display' ? ' is-on' : ''}" data-act="label" data-label="display" data-vin="${esc(r.vin)}">Display</button>
            <button type="button" class="row-btn label-delivery${r.label === 'delivery' ? ' is-on' : ''}" data-act="label" data-label="delivery" data-vin="${esc(r.vin)}">Delivery</button>`;
        }
      } else if (ruba) {
        action = `
          <button type="button" class="row-btn claim" data-act="claim" data-label="display" data-vin="${esc(r.vin)}">Display</button>
          <button type="button" class="row-btn claim" data-act="claim" data-label="delivery" data-vin="${esc(r.vin)}">Delivery</button>`;
      } else {
        action = `<button type="button" class="row-btn claim" data-act="claim" data-vin="${esc(r.vin)}">To my stock</button>`;
      }
      return `<tr class="${mine ? 'mine' : ''}">
        <td class="chk"><input type="checkbox" data-vin="${esc(r.vin)}"${checked} /></td>
        <td><strong>${esc(r.vin)}</strong></td>
        <td>${esc(r.product || '—')}</td>
        <td>${esc(r.salesType || '—')}</td>
        <td>${esc(r.proformaDate || '—')}</td>
        <td>${esc(r.customer || '—')}</td>
        <td>${esc(r.employee || '—')}</td>
        <td><span class="badge ${r.source === 'raw' ? 'warn' : 'info'}">${r.source === 'raw' ? 'Sales Raw' : 'Live Sheet'}</span></td>
        <td>${r.stockOwner ? `<span class="badge ok">${esc(r.stockOwner)}</span>` : '<span class="badge">Open</span>'}</td>
        <td>${labelBadge(r.label)}</td>
        <td class="acts">${action}</td>
      </tr>`;
    }).join('');
    syncCheckAll();
  }

  function syncCheckAll() {
    const boxes = $$('#rows input[type="checkbox"]');
    $('check-all').checked = boxes.length > 0 && boxes.every((b) => b.checked);
  }

  function selectedVins() {
    return [...state.selected];
  }

  function openLabelModal(vins) {
    const list = (vins || []).filter(Boolean);
    return new Promise((resolve) => {
      const modal = $('label-modal');
      if (!modal || !list.length) {
        resolve('');
        return;
      }
      if (state.labelWait) {
        state.labelWait('');
        state.labelWait = null;
      }
      state.labelWait = resolve;
      $('label-modal-title').textContent = list.length === 1
        ? 'Label this car'
        : `Label ${list.length} cars`;
      $('label-modal-sub').textContent = 'Choose Display or Delivery before adding to your stock.';
      $('label-modal-vins').textContent = list.join('\n');
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    });
  }

  function closeLabelModal(pick) {
    const modal = $('label-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    const fn = state.labelWait;
    state.labelWait = null;
    if (fn) fn(pick || '');
  }

  async function askLabel(vins) {
    if (!isRuba()) return state.label || 'delivery';
    return openLabelModal(vins);
  }

  async function claim(vins, label) {
    if (!vins.length) return;
    const body = { vins };
    if (isRuba()) {
      body.label = label || state.label;
      if (!body.label) throw new Error('Choose Display or Delivery');
    }
    const data = await api('/inventory/claim', { method: 'POST', json: body });
    vins.forEach((vin) => state.selected.delete(vin));
    applyPayload(data);
    noteGuestExp(data);
  }

  /** Ruba → Delivery sets Guest Exp = Yes on the Live Sheet (server side); confirm it. */
  function noteGuestExp(data) {
    const vins = (data && data.guestExp) || [];
    if (!vins.length) return;
    window.DTX.toast(vins.length === 1
      ? `${vins[0]} · Live Sheet → Guest Exp = Yes`
      : `${vins.length} VINs · Live Sheet → Guest Exp = Yes`);
  }

  async function claimSelectedWith(label) {
    const vins = selectedVins();
    if (!vins.length) {
      alert('Select at least one VIN');
      return;
    }
    await claim(vins, label);
  }

  async function claimSelectedAsk() {
    const vins = selectedVins();
    if (!vins.length) {
      alert('Select at least one VIN');
      return;
    }
    if (!isRuba()) {
      await claim(vins);
      return;
    }
    const label = await askLabel(vins);
    if (!label) return;
    state.label = label;
    syncLabelPills();
    await claim(vins, label);
  }

  async function release(vins) {
    if (!vins.length) return;
    const data = await api('/inventory/release', { method: 'POST', json: { vins } });
    applyPayload(data);
  }

  async function setLabel(vins, label) {
    if (!vins.length) return;
    const data = await api('/inventory/label', { method: 'POST', json: { vins, label } });
    applyPayload(data);
    noteGuestExp(data);
  }

  function bind() {
    $('login-btn').addEventListener('click', login);
    $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('logout-btn').addEventListener('click', logout);
    $('refresh-btn').addEventListener('click', () => load().catch((e) => alert(e.message)));
    $('search').addEventListener('input', () => {
      state.q = $('search').value;
      render();
    });
    $('view-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      state.view = btn.dataset.view;
      $$('#view-tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
    if ($('label-pills')) {
      $('label-pills').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-label]');
        if (!btn) return;
        state.label = btn.dataset.label;
        syncLabelPills();
      });
    }
    $('claim-btn').addEventListener('click', () => {
      claimSelectedAsk().catch((e) => alert(e.message));
    });
    if ($('claim-display-btn')) {
      $('claim-display-btn').addEventListener('click', () => {
        claimSelectedWith('display').catch((e) => alert(e.message));
      });
    }
    if ($('claim-delivery-btn')) {
      $('claim-delivery-btn').addEventListener('click', () => {
        claimSelectedWith('delivery').catch((e) => alert(e.message));
      });
    }
    $('release-btn').addEventListener('click', () => {
      release(selectedVins()).catch((e) => alert(e.message));
    });
    if ($('label-modal-cancel')) {
      $('label-modal-cancel').addEventListener('click', () => closeLabelModal(''));
    }
    $$('#label-modal .label-pick').forEach((btn) => {
      btn.addEventListener('click', () => closeLabelModal(btn.dataset.pick || ''));
    });
    $('label-modal')?.addEventListener('click', (e) => {
      if (e.target === $('label-modal')) closeLabelModal('');
    });
    $('check-all').addEventListener('change', () => {
      const on = $('check-all').checked;
      filtered().forEach((r) => {
        if (on) state.selected.add(r.vin);
        else state.selected.delete(r.vin);
      });
      render();
    });
    $('rows').addEventListener('change', (e) => {
      const box = e.target.closest('input[type="checkbox"][data-vin]');
      if (!box) return;
      const vin = box.dataset.vin;
      if (!box.checked) {
        state.selected.delete(vin);
        syncCheckAll();
        return;
      }
      state.selected.add(vin);
      syncCheckAll();
      // Ruba: selecting an open car → choose Display / Delivery, then claim
      if (isRuba()) {
        const row = state.pool.find((r) => r.vin === vin);
        if (row && !row.stockOwnerId) {
          askLabel([vin]).then(async (label) => {
            if (!label) {
              box.checked = false;
              state.selected.delete(vin);
              syncCheckAll();
              return;
            }
            state.label = label;
            syncLabelPills();
            try {
              await claim([vin], label);
            } catch (err) {
              alert(err.message || 'Claim failed');
              box.checked = false;
              state.selected.delete(vin);
              syncCheckAll();
            }
          });
        }
      }
    });
    $('rows').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const vin = btn.dataset.vin;
      let run;
      if (btn.dataset.act === 'release') run = release([vin]);
      else if (btn.dataset.act === 'label') run = setLabel([vin], btn.dataset.label);
      else run = claim([vin], btn.dataset.label);
      run.catch((err) => alert(err.message));
    });
  }

  async function boot() {
    fillLogin();
    bind();
    if (getToken() && getUser()) {
      try {
        const me = await api('/auth/me');
        if (!canUse(me.user)) {
          showApp(false);
          return;
        }
        setSession(getToken(), me.user);
        enter(me.user);
        return;
      } catch {
        clearSession();
      }
    }
    showApp(false);
  }

  boot().catch((e) => { $('login-error').textContent = e.message; });
})();
