(() => {
  const API = '/api/delivery-transformation/vin-finder';
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusClass(s) {
    const v = String(s || '').trim();
    if (v === 'Claimed' || v === 'تم التسليم') return 'ok';
    if (v === 'جاهز للتسليم' || v === 'PSFU') return 'warn';
    return '';
  }

  function card(row) {
    const status = row.status || '—';
    const fields = Array.isArray(row.raw) && row.raw.length
      ? row.raw
      : [
        { label: 'VIN', value: row.vin },
        { label: 'Sales Order', value: row.order },
      ];
    const head = fields.map((field) => {
      const letter = field.letter ? `<span>${esc(field.letter)}</span>` : '';
      return `<th>${letter}${esc(field.label || field.letter || '')}</th>`;
    }).join('');
    const body = fields.map((field) => `<td>${esc(field.value || '—')}</td>`).join('');
    const note = row.full
      ? ''
      : '<p class="raw-note">Showing the saved fields. Upload Sales Raw again to fill every Excel column.</p>';
    return `<article class="card">
      <h2>${esc(row.vin)}</h2>
      <div class="grid meta">
        <div><span>Current status</span><strong><span class="badge ${statusClass(status)}">${esc(status)}</span></strong></div>
        <div><span>Employee</span><strong>${esc(row.employee || '—')}</strong></div>
      </div>
      <h3>Sales Raw · ${fields.length} columns</h3>
      <div class="raw-scroll">
        <table class="raw-cols">
          <thead><tr>${head}</tr></thead>
          <tbody><tr>${body}</tr></tbody>
        </table>
      </div>
      ${note}
    </article>`;
  }

  async function search(q) {
    const hint = $('hint');
    const host = $('results');
    hint.classList.remove('err');
    if (q.replace(/[^A-Za-z0-9]/g, '').length < 4) {
      hint.classList.add('err');
      hint.textContent = 'Type at least 4 characters of the VIN or order number.';
      host.innerHTML = '';
      return;
    }
    hint.textContent = 'Searching Live Sheet…';
    try {
      const res = await fetch(`${API}?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      const rows = data.rows || [];
      hint.textContent = rows.length
        ? `${rows.length} Sales Raw row${rows.length === 1 ? '' : 's'}`
        : 'No VIN or order found in the uploaded Sales Raw.';
      host.innerHTML = rows.length
        ? rows.map(card).join('')
        : '<p class="empty">No car matches this VIN or order number.</p>';
    } catch (err) {
      hint.classList.add('err');
      hint.textContent = err.message || 'Search failed';
      host.innerHTML = '';
    }
  }

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value.trim();
    const url = new URL(location.href);
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    search(q);
  });

  const start = new URLSearchParams(location.search).get('q') || '';
  if (start) {
    $('q').value = start;
    search(start);
  }
})();
