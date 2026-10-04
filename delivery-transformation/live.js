/* Delivery Transformation — Live Sheet table + VIN drawer (admin / employee / coordinator) */
(function (global) {
  const { api, esc, na, statusBadge, toast } = global.DTX;

  const RAW_COLS = [
    ['proformaDate', 'Proforma'],
    ['salesOrder', 'Order'],
    ['product', 'Product'],
    ['salesType', 'Sales Type'],
    ['salesAdvisor', 'S/A'],
    ['gtLocation', 'GT Loc'],
    ['vehicleLocation', 'Veh Loc'],
  ];
  const PII_COLS = [
    ['invoiceOwner', 'Owner'],
    ['userName', 'Customer'],
    ['phone', 'Phone'],
  ];
  const OPS_COLS = [
    ['opsStatus', 'Status', 'status'],
    ['guestSentDate', 'إرسال الضيف', 'date'],
    ['signatureReceivedDate', 'استلام التواقيع', 'date'],
    ['accountsSentDate', 'إرسال للحسابات', 'date'],
    ['accountsApprovalDate', 'موافقة الحسابات', 'date'],
    ['vin1502', 'VIN 1502', 'yn'],
    ['trafficFile', 'ملف المرور', 'yn'],
    ['trafficFeesOps', 'Traffic Fees', 'yn'],
    ['insuranceOps', 'Insurance', 'yn'],
    ['registrationIssueDate', 'إصدار الاستمارة', 'date'],
    ['transferCity', 'مدينة الترحيل', 'city'],
    ['carrier', 'الناقل', 'carrier'],
    ['notes', 'ملاحظات', 'text'],
  ];

  let meta = null;

  async function loadMeta() {
    if (!meta) meta = await api('/meta');
    return meta;
  }

  function control(vin, field, type, value) {
    const v = value == null ? '' : String(value);
    const attrs = `class="cell-edit" data-vin="${esc(vin)}" data-field="${esc(field)}"`;
    const opts = (list, placeholder) => `<option value="">${placeholder}</option>${list.map((x) =>
      `<option value="${esc(x)}" ${v === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
    if (type === 'status') return `<select ${attrs}>${opts(meta.statuses || [], '—')}</select>`;
    if (type === 'yn') return `<select ${attrs}>${opts(meta.yesNo || ['Yes', 'No'], '—')}</select>`;
    if (type === 'carrier') return `<select ${attrs}>${opts(meta.carriers || [], '— الناقل —')}</select>`;
    if (type === 'city') return `<select ${attrs}>${opts(meta.transferCities || [], '— المدينة —')}</select>`;
    if (type === 'date') return `<input type="date" ${attrs} value="${esc(v)}" />`;
    return `<input type="text" ${attrs} value="${esc(v)}" />`;
  }

  function display(type, value) {
    if (type === 'status') return statusBadge(value);
    return esc(na(value));
  }

  /**
   * mode: 'admin' | 'employee' | 'coordinator'
   * Coordinator never gets ops columns (server also strips them).
   */
  function renderTable(tableEl, rows, { mode, onOpen }) {
    const showOps = mode !== 'coordinator';
    const showPii = mode === 'admin';
    const cols = [
      { label: '#', html: (_r, i) => i + 1 },
      {
        label: 'VIN',
        html: (r) => `<button type="button" class="vin-btn" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`,
      },
      ...RAW_COLS.map(([k, label]) => ({ label, html: (r) => esc(na(r.raw[k])) })),
      ...(showPii ? PII_COLS.map(([k, label]) => ({ label, html: (r) => esc(na(r.raw[k])) })) : []),
    ];
    if (showOps) {
      cols.push({ label: 'Employee', html: (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>` });
      OPS_COLS.forEach(([k, label, type]) => cols.push({
        label,
        html: (r) => (r.canEdit && type !== 'carrier' ? control(r.vin, k, type, r.ops[k]) : display(type, r.ops[k])),
      }));
      cols.push({ label: 'Updated', html: (r) => esc(na((r.ops.updatedAt || '').replace('T', ' ').slice(0, 16))) });
      cols.push({ label: 'By', html: (r) => esc(na(r.ops.updatedBy)) });
    }

    tableEl.innerHTML = `<thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr>${cols.map((c) => `<td>${c.html(r, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">No VINs on the Live Sheet yet.</td></tr>`}</tbody>`;

    tableEl.querySelectorAll('.vin-btn').forEach((b) => b.addEventListener('click', () => onOpen(b.dataset.vin)));
    tableEl.querySelectorAll('.cell-edit').forEach((el) => {
      el.addEventListener('change', () => saveField(el.dataset.vin, el.dataset.field, el.value));
    });
  }

  async function saveField(vin, field, value) {
    try {
      await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: { [field]: value } });
      toast(`Saved ${vin}`);
    } catch (e) {
      alert(e.message || 'Save failed');
    }
  }

  function ensureDrawer() {
    let back = document.getElementById('vin-drawer-back');
    if (back) return back;
    back = document.createElement('div');
    back.id = 'vin-drawer-back';
    back.className = 'drawer-back';
    back.innerHTML = '<aside class="drawer" id="vin-drawer"></aside>';
    back.addEventListener('click', (e) => { if (e.target === back) back.classList.remove('open'); });
    document.body.appendChild(back);
    return back;
  }

  async function openDrawer(vin, { mode, onSaved }) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    const back = ensureDrawer();
    const drawer = back.querySelector('#vin-drawer');
    const isAdmin = mode === 'admin';
    const showOps = mode !== 'coordinator';
    const row = (label, html) => `<div class="row"><label>${esc(label)}</label><div>${html}</div></div>`;

    const rawFields = [...RAW_COLS, ...(isAdmin || mode === 'coordinator' ? PII_COLS : [])];
    const rawHtml = rawFields.map(([k, label]) => row(label, isAdmin
      ? `<input class="cell-edit" data-field="${esc(k)}" value="${esc(v.raw[k] || '')}" />`
      : esc(na(v.raw[k])))).join('');

    let opsHtml = '';
    if (showOps) {
      const employees = meta.employees || [];
      const empHtml = isAdmin
        ? `<select class="cell-edit" data-field="assignedEmployeeId"><option value="">— Unassigned —</option>${employees.map((e) =>
          `<option value="${esc(e.id)}" ${v.ops.assignedEmployeeId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`
        : esc(na(v.ops.assignedEmployeeName));
      opsHtml = `<h3 style="margin:14px 0 6px;font-size:.85rem">Delivery employee entry</h3>
        <div class="drawer-grid">
          ${row('Employee', empHtml)}
          ${OPS_COLS.map(([k, label, type]) => row(label, v.canEdit && type !== 'carrier'
            ? control(v.vin, k, type, v.ops[k]).replace(/ data-vin="[^"]*"/, '')
            : display(type, v.ops[k]))).join('')}
          ${row('Updated', esc(na((v.ops.updatedAt || '').replace('T', ' ').slice(0, 16))))}
          ${row('By', esc(na(v.ops.updatedBy)))}
        </div>`;
    }

    drawer.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <div><h2>${esc(v.vin)}</h2><div class="sub">${esc(na(v.raw.product))} · ${esc(na(v.raw.salesType))}</div></div>
        <button type="button" class="btn" id="drawer-close">Close</button>
      </div>
      ${mode === 'coordinator' ? '<div class="readonly-note">View only — VIN details from the Live Sheet. Employee entries are not shown.</div>' : ''}
      <h3 style="margin:10px 0 6px;font-size:.85rem">Vehicle details</h3>
      <div class="drawer-grid">${row('VIN', esc(v.vin))}${rawHtml}</div>
      ${opsHtml}
      ${isAdmin ? '<div style="margin-top:16px;display:flex;gap:8px"><button type="button" class="btn" id="drawer-delete" style="color:#b91c1c">Delete VIN</button></div>' : ''}
    `;
    back.classList.add('open');
    drawer.querySelector('#drawer-close').onclick = () => back.classList.remove('open');

    drawer.querySelectorAll('.cell-edit').forEach((el) => {
      el.addEventListener('change', async () => {
        try {
          await api(`/vehicles/${encodeURIComponent(v.vin)}`, {
            method: 'PATCH',
            json: { [el.dataset.field]: el.value },
          });
          toast('Saved');
          if (onSaved) onSaved();
        } catch (e) {
          alert(e.message || 'Save failed');
        }
      });
    });

    const del = drawer.querySelector('#drawer-delete');
    if (del) {
      del.onclick = async () => {
        if (!confirm(`Delete ${v.vin}?`)) return;
        await api(`/vehicles/${encodeURIComponent(v.vin)}`, { method: 'DELETE' });
        back.classList.remove('open');
        toast('Deleted');
        if (onSaved) onSaved();
      };
    }
  }

  function wireHeader(user) {
    const name = document.getElementById('who');
    if (name) name.textContent = `${user.name} · ${user.role}`;
    const out = document.getElementById('logout-btn');
    if (out) {
      out.addEventListener('click', async () => {
        try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
        global.DTX.clearSession();
        location.href = 'index.html';
      });
    }
  }

  global.DTXLive = { loadMeta, renderTable, openDrawer, wireHeader };
})(window);
