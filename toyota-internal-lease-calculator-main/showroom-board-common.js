window.ShowroomBoard = (function () {
  const REFRESH_MS = 5000;
  const DASHBOARD_REFRESH_MS = 4000;
  const RECORDS_POLL_MS = 8000;
  const UPLOADER_POLL_MS = 10000;
  const DASHBOARD_LIVE_TICK_MS = 1000;
  const CONTROLLER_POOL_RENDER_LIMIT = 48;
  const CONTROLLER_POOL_SEARCH_HINT = 24;
  const DELIVERY_REMINDER_MS = 15 * 60 * 1000;
  const DELIVERY_PREP_REMINDER_MS = 60 * 60 * 1000;
  const DELIVERY_SLOT_MS = 30 * 60 * 1000;
  const DELAYED_ZONE_SLOTS = [8, 9, 10];
  const STATUS_COLORS = {
    'Available': 'bg-green-500/20 text-green-300',
    'Reserved': 'bg-blue-500/20 text-blue-300',
    'Invoice Created': 'bg-yellow-500/20 text-yellow-300',
    'Leaving Soon': 'bg-orange-500/20 text-orange-300',
    'Final Call': 'bg-red-500/20 text-red-300',
    'Delivered': 'bg-gray-500/20 text-gray-400',
    'Replacement Arriving': 'bg-cyan-500/20 text-cyan-300',
    'Delayed': 'bg-purple-500/20 text-purple-300',
    'Occupied': 'bg-yellow-500/20 text-yellow-300',
    'Empty': 'bg-white/10 text-gray-400',
    'Departed': 'bg-gray-500/20 text-gray-400',
    'Awaiting Replacement': 'bg-cyan-500/20 text-cyan-300',
    'Delivery Booked': 'bg-blue-500/20 text-blue-300',
    'Delivering': 'bg-orange-500/20 text-orange-300',
    'Confirm Delivery': 'bg-red-500/20 text-red-300',
    'Delivery in 15 Min': 'bg-orange-500/20 text-orange-300'
  };

  const PRODUCT_IMAGE_ALIASES = {
    '86': ['gr86'], 'gr 86': ['gr86'], 'gr86': ['gr86'],
    'hilux dc': ['hilux double cab'], 'hilux double cab': ['hilux double cab'],
    'hilux sc': ['hilux single cab'], 'hilux single cab': ['hilux single cab'],
    'lc70': ['land cruiser hard top', 'land cruiser pickup', 'land cruiser'],
    'lc 70': ['land cruiser hard top', 'land cruiser pickup', 'land cruiser'],
    'land cruiser 70': ['land cruiser hard top', 'land cruiser pickup', 'land cruiser'],
    'lc300': ['land cruiser'], 'lc 300': ['land cruiser'], 'land cruiser 300': ['land cruiser'],
    'land cruiser': ['land cruiser'], 'land cruiser pickup': ['land cruiser pickup'],
    'land cruiser hard top': ['land cruiser hard top'],
    'rav 4': ['rav4'], 'rav4': ['rav4'], 'corolla cross': ['corolla cross'],
    'urban cruiser': ['urban cruiser'], 'yaris': ['yaris'], 'yaris sd': ['yaris'],
    'coaster': ['coaster'], 'supra': ['supra'], 'gr supra': ['supra'],
    'lite ace': ['lite ace'], 'liteace': ['lite ace'],
    'hiace bus': ['hiace bus'], 'hiace van': ['hiace van'],
    'camry': ['camry'], 'corolla': ['corolla'], 'fortuner': ['fortuner'],
    'innova': ['innova'], 'veloz': ['veloz'], 'raize': ['raize']
  };

  function productSlug(name) {
    return String(name || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function productImageCandidates(productName) {
    const lower = String(productName || '').toLowerCase().trim();
    const noSpace = lower.replace(/\s+/g, '');
    const slug = productSlug(productName);
    const aliasNames = PRODUCT_IMAGE_ALIASES[lower] || [];
    const exts = ['png', 'jpg', 'jpeg', 'webp'];
    const candidates = new Set();
    aliasNames.forEach((basename) => {
      exts.forEach((ext) => candidates.add(`/images/cars/${encodeURIComponent(basename)}.${ext}`));
    });
    exts.forEach((ext) => {
      if (lower) candidates.add(`/images/cars/${encodeURIComponent(lower)}.${ext}`);
      if (noSpace) candidates.add(`/images/cars/${noSpace}.${ext}`);
      if (slug) candidates.add(`/images/cars/${slug}.${ext}`);
    });
    return Array.from(candidates);
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function parkingCarImageHtml(productName, slotNum) {
    const urls = productImageCandidates(productName);
    const id = `parking-img-${slotNum}`;
    const fb = `parking-img-fb-${slotNum}`;
    if (!urls.length) {
      return `<div class="parking-car-fallback" id="${fb}">🚗</div>`;
    }
    const urlsJson = esc(JSON.stringify(urls));
    return `<div class="parking-car-img-wrap">
      <img id="${id}" class="parking-car-img" alt="" data-img-candidates="${urlsJson}" src="${esc(urls[0])}" onerror="window.ShowroomBoard._imgFallback(this)">
      <div class="parking-car-fallback hidden" id="${fb}">🚗</div>
    </div>`;
  }

  function _imgFallback(img) {
    try {
      const urls = JSON.parse(img.dataset.imgCandidates || '[]');
      const i = Number(img.dataset.imgIdx || 0) + 1;
      if (i < urls.length) {
        img.dataset.imgIdx = String(i);
        img.src = urls[i];
        return;
      }
    } catch (e) {}
    img.style.display = 'none';
    const fb = img.parentElement?.querySelector('.parking-car-fallback');
    if (fb) fb.classList.remove('hidden');
  }

  function formatReplacement(v) {
    return v.replacementVin || v.replacementVehicleNumber || '—';
  }

  function pickSalesRawColumns(rows) {
    if (!rows.length) return [];
    const keySet = new Set();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => keySet.add(k)));
    const score = (k) => {
      if (k === '_sheet') return 200;
      if (/vin|chassis|serial/i.test(k)) return 100;
      if (/vehicle|stock|order|unit|car\s*#?/i.test(k)) return 90;
      if (/model|product|desc/i.test(k)) return 80;
      if (/invoice|inv/i.test(k)) return 70;
      if (/status/i.test(k)) return 60;
      return 10;
    };
    return [...keySet].sort((a, b) => score(b) - score(a));
  }

  function formatLiveTimer(vehicle) {
    if (!vehicle?.departureAt) return vehicle?.timeRemainingLabel || '—';
    const ms = vehicle.departureAt - Date.now();
    if (ms <= 0) return 'DEPARTED';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function auth(role, password) {
    const res = await fetch('/api/showroom-board/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid password');
    return data;
  }

  async function parseJsonResponse(res) {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const snippet = (await res.text()).slice(0, 80);
      if (snippet.startsWith('<!DOCTYPE') || snippet.startsWith('<html')) {
        throw new Error(`Server error (${res.status}) — page loaded instead of data. Try refresh or re-login.`);
      }
      throw new Error(`Unexpected server response (${res.status})`);
    }
    return res.json();
  }

  async function fetchBoardData() {
    const res = await fetch('/api/showroom-board');
    const data = await parseJsonResponse(res);
    if (!data.success) throw new Error(data.error || 'Load failed');
    return data;
  }

  async function fetchSalesRawData() {
    const res = await fetch('/api/showroom-board/sales-raw');
    const data = await parseJsonResponse(res);
    if (!data.success) throw new Error(data.error || 'Load failed');
    return data;
  }

  function flattenLeadsMatchRow(match) {
    const out = {
      'Transaction Number': match.transactionNumber ?? '—',
      'CRM Lead ID': match.crmLeadId ?? '—'
    };
    Object.entries(match.leads || {}).forEach(([k, v]) => {
      if (k === '_sheet') return;
      out[`Leads · ${k}`] = v;
    });
    Object.entries(match.salesRaw || {}).forEach(([k, v]) => {
      if (k === '_sheet') return;
      out[`Sales · ${k}`] = v;
    });
    return out;
  }

  function pickMatchedTableColumns(flatRows) {
    if (!flatRows.length) return ['Transaction Number', 'CRM Lead ID'];
    const keySet = new Set(['Transaction Number', 'CRM Lead ID']);
    flatRows.forEach((row) => Object.keys(row).forEach((k) => keySet.add(k)));
    const score = (k) => {
      if (k === 'Transaction Number' || k === 'CRM Lead ID') return 200;
      if (/vin|chassis/i.test(k)) return 100;
      if (/customer|client|buyer/i.test(k)) return 90;
      if (/product|model|suffix/i.test(k)) return 80;
      if (/status/i.test(k)) return 70;
      if (/invoice/i.test(k)) return 65;
      if (k.startsWith('Leads ·')) return 60;
      if (k.startsWith('Sales ·')) return 55;
      return 10;
    };
    return [...keySet].sort((a, b) => score(b) - score(a)).slice(0, 24);
  }

  function renderLeadsMatchTable(boardData) {
    const matches = boardData.leadsMatches || [];
    const meta = document.getElementById('matchedDataMeta');
    const empty = document.getElementById('matchedDataEmpty');
    const head = document.getElementById('matchedDataHead');
    const body = document.getElementById('matchedDataBody');
    const countEl = document.getElementById('matchedCountBadge');
    if (!head || !body) return;

    const salesCount = boardData.salesRaw?.rows?.length || 0;
    const leadsCount = boardData.leadsInProgress?.rows?.length || 0;
    const crmCol = boardData.leadsMatchColumns?.crmLeadId;
    const txnCol = boardData.leadsMatchColumns?.transactionNumber;

    if (countEl) {
      countEl.textContent = matches.length ? `${matches.length} matched` : '0 matched';
      countEl.className = matches.length
        ? 'rounded-full bg-green-500/20 px-3 py-1 text-xs font-semibold text-green-300'
        : 'rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-gray-400';
    }

    if (meta) {
      const parts = [];
      if (salesCount) parts.push(`Sales Raw: ${salesCount} rows`);
      if (leadsCount) parts.push(`Leads: ${leadsCount} rows`);
      if (txnCol) parts.push(`Leads column: "${txnCol}"`);
      if (crmCol) parts.push(`Sales column: "${crmCol}"`);
      parts.push(`Match rule: Transaction Number = CRM Lead ID`);
      meta.textContent = parts.join(' · ');
    }

    if (!matches.length) {
      head.innerHTML = '';
      body.innerHTML = '';
      empty?.classList.remove('hidden');
      if (empty) {
        if (!salesCount && !leadsCount) {
          empty.textContent = 'Upload Sales Raw Data and Leads in Progress to see matched records.';
        } else if (!salesCount) {
          empty.textContent = 'Upload Sales Raw Data to match against Leads in Progress.';
        } else if (!leadsCount) {
          empty.textContent = 'Upload Leads in Progress to match Transaction Number with CRM Lead ID.';
        } else if (!crmCol || !txnCol) {
          empty.textContent = `Column not found. Need "Transaction Number" in Leads and "CRM Lead ID" in Sales Raw Data.${!crmCol ? ' (CRM Lead ID missing)' : ''}${!txnCol ? ' (Transaction Number missing)' : ''}`;
        } else {
          empty.textContent = 'No matches found. Check that Transaction Number (Leads) equals CRM Lead ID (Sales Raw Data).';
        }
      }
      return;
    }

    empty?.classList.add('hidden');
    const flatRows = matches.map(flattenLeadsMatchRow);
    const cols = pickMatchedTableColumns(flatRows);
    head.innerHTML = `<tr>
      <th class="bg-yellow-500/10">Transaction Number</th>
      <th class="bg-yellow-500/10">CRM Lead ID</th>
      ${cols.filter((c) => c !== 'Transaction Number' && c !== 'CRM Lead ID').map((c) => {
        const isLeads = c.startsWith('Leads ·');
        const isSales = c.startsWith('Sales ·');
        const cls = isLeads ? 'bg-cyan-500/10' : isSales ? 'bg-green-500/10' : '';
        return `<th class="${cls}">${esc(c)}</th>`;
      }).join('')}
    </tr>`;
    body.innerHTML = flatRows.map((row) =>
      `<tr>
        <td class="mono text-xs font-semibold text-yellow-300">${esc(row['Transaction Number'] ?? '—')}</td>
        <td class="mono text-xs font-semibold text-yellow-300">${esc(row['CRM Lead ID'] ?? '—')}</td>
        ${cols.filter((c) => c !== 'Transaction Number' && c !== 'CRM Lead ID').map((c) => {
          const isVin = /vin|chassis|serial/i.test(c);
          const cls = isVin ? 'mono vin-full text-yellow-200' : 'mono text-xs';
          return `<td class="${cls}">${esc(row[c] ?? '—')}</td>`;
        }).join('')}
      </tr>`
    ).join('');
  }

  function renderUploaderMeta(boardData) {
    const salesMeta = document.getElementById('salesRawMeta');
    const leadsMeta = document.getElementById('leadsMeta');
    const salesRows = boardData.salesRaw?.rows || [];
    const leadsRows = boardData.leadsInProgress?.rows || [];

    if (salesMeta) {
      if (!boardData.salesRaw?.uploadedAt) {
        salesMeta.textContent = '';
      } else {
        const uploadedAt = new Date(boardData.salesRaw.uploadedAt).toLocaleString();
        salesMeta.textContent = `${salesRows.length} rows · Sheet: ${boardData.salesRaw.sheetName || 'Sales Raw Data'} · Uploaded ${uploadedAt}`;
      }
    }
    if (leadsMeta) {
      if (!boardData.leadsInProgress?.uploadedAt) {
        leadsMeta.textContent = '';
      } else {
        const uploadedAt = new Date(boardData.leadsInProgress.uploadedAt).toLocaleString();
        leadsMeta.textContent = `${leadsRows.length} rows · Sheet: ${boardData.leadsInProgress.sheetName || 'raw data all status'} · Uploaded ${uploadedAt}`;
      }
    }
  }

  function renderSalesRawTable(boardData) {
    const rows = boardData.salesRaw?.rows || [];
    const meta = document.getElementById('salesRawMeta');
    const empty = document.getElementById('salesRawEmpty');
    const head = document.getElementById('salesRawHead');
    const body = document.getElementById('salesRawBody');
    if (!head || !body) return;

    if (!rows.length) {
      head.innerHTML = '';
      body.innerHTML = '';
      empty?.classList.remove('hidden');
      if (meta) meta.textContent = '';
      return;
    }
    empty?.classList.add('hidden');
    const uploadedAt = boardData.salesRaw.uploadedAt
      ? new Date(boardData.salesRaw.uploadedAt).toLocaleString()
      : '';
    if (meta) {
      const cols = pickSalesRawColumns(rows);
      meta.textContent = `${rows.length} rows · ${cols.length} columns · Sheet: ${boardData.salesRaw.sheetName || 'Sales Raw Data'}${uploadedAt ? ' · Uploaded ' + uploadedAt : ''}`;
    }

    const cols = pickSalesRawColumns(rows);
    head.innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    body.innerHTML = rows.map((row) =>
      `<tr>${cols.map((c) => {
        const isVin = /vin|chassis|serial/i.test(c);
        const cls = isVin ? 'mono vin-full text-yellow-200' : 'mono text-xs';
        return `<td class="${cls}">${esc(row[c] ?? '—')}</td>`;
      }).join('')}</tr>`
    ).join('');
  }

  function renderBoard(boardData, options = {}) {
    const {
      search = '',
      statusFilter = '',
      selectedVehicleId = null,
      clickable = false,
      onRowClick = null
    } = options;

    let rows = boardData.vehicles || [];
    const q = search.toLowerCase();
    if (q) {
      rows = rows.filter((v) =>
        (v.vehicleNumber || '').toLowerCase().includes(q) ||
        (v.model || '').toLowerCase().includes(q) ||
        (v.vin || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter) rows = rows.filter((v) => v.displayStatus === statusFilter);

    const stats = boardData.stats || {};
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpiTotal', stats.totalInShowroom ?? 0);
    set('kpiLeaving', stats.leavingToday ?? 0);
    set('kpiArrivals', stats.arrivalsToday ?? 0);
    set('kpiDelayed', stats.delayedArrivals ?? 0);
    set('kpiAvailable', stats.availableDisplay ?? 0);

    const tbody = document.getElementById('boardBody');
    const empty = document.getElementById('emptyState');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '';
      empty?.classList.toggle('hidden', (boardData.vehicles || []).length > 0);
      return;
    }
    empty?.classList.add('hidden');

    tbody.innerHTML = rows.map((v, i) => {
      const pill = STATUS_COLORS[v.displayStatus] || 'bg-white/10 text-gray-300';
      const rowClickable = clickable ? 'board-row-clickable' : '';
      const selected = selectedVehicleId === v.id ? 'board-row-selected' : '';
      const timerClass = v.displayStatus === 'Final Call' ? 'text-red-400' : 'text-yellow-300';
      return `<tr class="${v.rowTone} ${rowClickable} ${selected}" data-vehicle-id="${esc(v.id)}" style="animation-delay:${Math.min(i * 30, 400)}ms">
        <td class="mono font-semibold">${esc(v.vehicleNumber)}</td>
        <td>${esc(v.model || '—')}</td>
        <td class="mono vin-full text-gray-300">${esc(v.vin || '—')}</td>
        <td><span class="status-pill ${pill}">${esc(v.displayStatus)}</span></td>
        <td class="text-sm text-cyan-200">${esc(v.currentLocation || 'Showroom Floor')}</td>
        <td class="mono">${esc(v.invoiceDateDisplay)}</td>
        <td class="mono font-bold ${timerClass}" data-timer-id="${esc(v.id)}">${esc(formatLiveTimer(v))}</td>
        <td class="mono text-xs text-cyan-300">${esc(formatReplacement(v))}</td>
        <td class="mono">${esc(v.expectedArrivalDisplay)}</td>
        <td>${esc(v.arrivalStatus || '—')}</td>
      </tr>`;
    }).join('');

    if (clickable && onRowClick) {
      tbody.querySelectorAll('[data-vehicle-id]').forEach((row) => {
        row.addEventListener('click', () => onRowClick(row.dataset.vehicleId));
      });
    }
  }

  function updateLiveTimers(boardData, selectedVehicleId) {
    if (!boardData.vehicles?.length) return;
    boardData.vehicles.forEach((v) => {
      if (v.departureAt) v.timeRemainingLabel = formatLiveTimer(v);
    });
    document.querySelectorAll('[data-timer-id]').forEach((el) => {
      const v = boardData.vehicles.find((x) => x.id === el.dataset.timerId);
      if (v) el.textContent = formatLiveTimer(v);
    });
    if (selectedVehicleId) {
      const detailVehicle = boardData.vehicles.find((x) => x.id === selectedVehicleId);
      const detailTimer = document.getElementById('detailTimer');
      if (detailVehicle && detailTimer) detailTimer.textContent = formatLiveTimer(detailVehicle);
    }
  }

  function startClock(clockId) {
    const el = document.getElementById(clockId || 'liveClock');
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
    };
    tick();
    setInterval(tick, 1000);
  }

  function connectWs(onUpdate, options = {}) {
    const { onStatus = null } = options;
    let ws = null;
    let reconnectTimer = null;
    let pingTimer = null;
    let closed = false;

    function setStatus(status) {
      if (onStatus) onStatus(status);
    }

    function connect() {
      if (closed) return;
      try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host);
        ws.onopen = () => {
          setStatus('live');
          try {
            ws.send(JSON.stringify({ type: 'subscribe_showroom' }));
          } catch (e) {}
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'showroom_updated' && msg.data && onUpdate) {
              onUpdate(msg.data);
            }
          } catch (e) {}
        };
        ws.onclose = () => {
          setStatus('reconnecting');
          if (!closed) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 3000);
          }
        };
        ws.onerror = () => setStatus('reconnecting');
      } catch (e) {
        setStatus('poll');
        if (!closed) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    }

    connect();
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
      }
    }, 25000);

    return {
      close() {
        closed = true;
        clearTimeout(reconnectTimer);
        clearInterval(pingTimer);
        if (ws) {
          ws.onclose = null;
          ws.close();
        }
      },
      getStatus() {
        if (closed) return 'closed';
        if (ws?.readyState === WebSocket.OPEN) return 'live';
        if (ws?.readyState === WebSocket.CONNECTING) return 'connecting';
        return 'reconnecting';
      }
    };
  }

  function renderLivePill(elementId, status) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.dataset.status = status;
    const label = status === 'live' ? 'LIVE'
      : status === 'reconnecting' ? 'Reconnecting'
      : status === 'connecting' ? 'Connecting'
      : 'Polling';
    el.innerHTML = `<span class="kb-live-dot"></span> ${label}`;
  }

  function formatLastRefresh(source, liveStatus, pollSec) {
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const mode = liveStatus === 'live' ? 'WebSocket live'
      : liveStatus === 'reconnecting' ? 'Reconnecting…'
      : `Backup poll (${pollSec}s)`;
    const src = source === 'live' ? 'Live push' : source === 'focus' ? 'Tab focus' : 'Poll';
    return `${time} · ${src} · ${mode}`;
  }

  function initShowroomLive(options = {}) {
    const {
      pollMs = REFRESH_MS,
      pollMsWhenLive = Math.max(pollMs * 2, 10000),
      tickMs = null,
      onTick = null,
      fetchData = fetchBoardData,
      onData = null,
      onStatus = null,
      onError = null,
      livePillId = null
    } = options;

    let wsConn = null;
    let pollTimer = null;
    let tickTimer = null;
    let liveStatus = 'connecting';
    let closed = false;

    function setStatus(status) {
      liveStatus = status;
      if (livePillId) renderLivePill(livePillId, status);
      if (onStatus) onStatus(status);
      resetPoll();
    }

    function resetPoll() {
      clearInterval(pollTimer);
      if (closed) return;
      const interval = liveStatus === 'live' ? pollMsWhenLive : pollMs;
      pollTimer = setInterval(() => refresh('poll'), interval);
    }

    async function refresh(source = 'poll') {
      if (closed) return;
      try {
        const data = await fetchData();
        if (onData) onData(data, source, liveStatus);
      } catch (e) {
        if (onError) onError(e, source);
      }
    }

    wsConn = connectWs((data) => {
      if (onData) onData(data, 'live', 'live');
    }, { onStatus: setStatus });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !closed) refresh('focus');
    });

    if (livePillId) renderLivePill(livePillId, 'connecting');
    refresh('init');
    resetPoll();

    if (tickMs && onTick) {
      tickTimer = setInterval(onTick, tickMs);
    }

    return {
      close() {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(tickTimer);
        wsConn?.close();
      },
      refresh,
      getStatus: () => liveStatus
    };
  }

  function parkingBoxClass(slot) {
    if (slot.isDelayedZone && !slot.isOccupied) return 'parking-box-delayed-zone parking-box-empty';
    switch (slot.parkingStatus) {
      case 'Delayed': return 'parking-box-delayed';
      case 'Confirm Delivery': return 'parking-box-confirm';
      case 'Delivery in 15 Min': return 'parking-box-leaving';
      case 'Final Call': return 'parking-box-final';
      case 'Leaving Soon':
      case 'Delivering': return 'parking-box-leaving';
      case 'Departed': return 'parking-box-departed';
      case 'Awaiting Replacement': return 'parking-box-awaiting';
      case 'Delivery Booked': return 'parking-box-occupied';
      case 'Delivered': return 'parking-box-departed';
      case 'Occupied': return 'parking-box-occupied';
      default:
        return slot.isDelayedZone ? 'parking-box-delayed-zone parking-box-empty' : 'parking-box-empty';
    }
  }

  function renderParkingAlerts(boardData) {
    const el = document.getElementById('parkingAlerts');
    if (!el) return;
    const alerts = boardData.parkingAlerts || [];
    if (!alerts.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = alerts.map((a) => {
      const cls = a.type === 'prep' ? 'parking-alert-prep' : a.type === 'checklist' ? 'parking-alert-checklist' : '';
      return `<div class="parking-alert-item ${cls}" role="alert">
        <span class="parking-alert-icon">${a.type === 'prep' ? '🧼' : a.type === 'checklist' ? '✓' : '⚠'}</span>
        <span>${esc(a.message)}${a.customerName ? ` · <strong>${esc(a.customerName)}</strong>` : ''}</span>
      </div>`;
    }).join('');
  }

  function parkingSlotHtml(slot, options = {}) {
    const { readOnly = false, showImages = false, compact = false, dashboardMode = false, controllerMode = false } = options;
    const tag = readOnly ? 'div' : 'button';
    const typeAttr = readOnly ? '' : ' type="button"';
    const readOnlyCls = readOnly ? ' parking-box-readonly' : '';
    const controllerCls = controllerMode ? ' ctl-drop-target' : '';
    const dropAttrs = controllerMode ? ` data-drop-slot="${slot.slot}"` : '';
    const imageMode = showImages || readOnly || dashboardMode;
    const delayedZoneCls = slot.isDelayedZone ? ' parking-box-delayed-zone' : '';
    const cls = parkingBoxClass(slot);
    const readyCls = slot.carReadyForCustomer ? ' parking-box-ready' : '';
    if (!slot.isOccupied) {
      const zoneLabel = slot.isDelayedZone ? '<div class="parking-zone-tag">Delayed zone</div>' : '';
      return `<${tag}${typeAttr} class="parking-box parking-box-empty ${cls}${delayedZoneCls}${readOnlyCls}${controllerCls}" data-parking-slot="${slot.slot}"${dropAttrs}>
          <div class="parking-slot-label">${String(slot.slot).padStart(2, '0')}</div>
          ${zoneLabel}
          <div class="text-sm">${readOnly || dashboardMode ? (slot.isDelayedZone ? 'Delayed' : 'Empty') : '+ Assign car'}</div>
        </${tag}>`;
    }
    const timerClass = slot.parkingStatus === 'Delivery in 15 Min' ? 'text-orange-300'
      : slot.parkingStatus === 'Final Call' ? 'text-red-400'
      : slot.parkingStatus === 'Delayed' ? 'text-purple-300'
      : slot.parkingStatus === 'Confirm Delivery' ? 'text-red-300'
      : slot.istimaraIssued ? 'text-yellow-300'
      : 'text-gray-400';
    const carImg = imageMode ? parkingCarImageHtml(slot.showroomProduct || slot.showroomModel, slot.slot) : '';
    const timerLabel = slot.istimaraIssued && slot.deliveryAppointmentMs
      ? (slot.timeRemainingLabel || '—')
      : (dashboardMode ? '' : '—');
    const dashboardBody = dashboardMode ? `
        ${carImg}
        <div class="parking-customer-name">${esc(slot.showroomCustomer || '—')}</div>
        ${slot.istimaraIssued ? `<div class="parking-timer mono ${timerClass}" data-parking-timer="${slot.slot}">${esc(timerLabel)}</div>` : ''}
        ${slot.customerReadyMessage ? `<div class="parking-ready-msg">${esc(slot.customerReadyMessage)}</div>` : ''}
      ` : '';
    const compactBody = compact ? `
        ${carImg}
        <div class="parking-vin mono text-yellow-200">${esc(slot.showroomVin)}</div>
        <div class="parking-meta">${esc(slot.showroomProduct || '—')}</div>
        ${slot.replacementVin ? `<div class="ctl-next-car-badge">Next: ${esc(slot.replacementVin.slice(-6))}</div>` : ''}
        ${slot.istimaraIssued && slot.deliveryAppointmentMs ? `<div class="parking-timer mono ${timerClass}" data-parking-timer="${slot.slot}">${esc(timerLabel)}</div>` : ''}
      ` : `
        ${carImg}
        <div class="parking-vin mono text-yellow-200">${esc(slot.showroomVin)}</div>
        <div class="parking-meta"><strong>Product:</strong> ${esc(slot.showroomProduct || '—')} · <strong>Suffix:</strong> ${esc(slot.showroomSuffix || '—')}</div>
        <div class="parking-meta"><strong>Customer:</strong> ${esc(slot.showroomCustomer || '—')}</div>
        <div class="parking-meta"><strong>Location:</strong> ${esc(slot.showroomLocation || '—')}</div>
        ${slot.deliveryAppointmentDisplay && slot.deliveryAppointmentDisplay !== '—' ? `<div class="parking-meta"><strong>Delivery:</strong> ${esc(slot.deliveryAppointmentDisplay)} (30 min slot)</div>` : ''}
        ${slot.controllerStatus ? `<div class="parking-meta"><strong>Status:</strong> ${esc(formatControllerStatus(slot.controllerStatus))}</div>` : ''}
        ${slot.originSlot && slot.originSlot !== slot.slot ? `<div class="parking-meta"><strong>From parking:</strong> ${esc(slot.originSlot)}</div>` : ''}
      `;
    const body = dashboardMode ? dashboardBody : compactBody;
    const zoneLabel = slot.isDelayedZone && !dashboardMode ? '<div class="parking-zone-tag">Delayed zone</div>' : '';
    const confirmHint = slot.awaitingDeliveryConfirm && !readOnly && !dashboardMode
      ? '<div class="parking-confirm-hint">Tap to complete delivery checklist</div>' : '';
    const statusHtml = dashboardMode ? '' : `<div class="flex items-center justify-between gap-2">
          <div class="parking-slot-label">${String(slot.slot).padStart(2, '0')}</div>
          <span class="status-pill ${STATUS_COLORS[slot.parkingStatus] || 'bg-white/10 text-gray-300'}">${esc(slot.parkingStatus)}</span>
        </div>`;
    const slotLabelOnly = dashboardMode ? `<div class="parking-slot-label">Parking ${slot.slot}</div>` : statusHtml;
    const timerHtml = dashboardMode || compact
      ? ''
      : `<div class="parking-timer mono ${timerClass}" data-parking-timer="${slot.slot}">${esc(slot.timeRemainingLabel)}</div>`;
    return `<${tag}${typeAttr} class="parking-box ${cls}${delayedZoneCls}${readyCls}${readOnlyCls}${dashboardMode ? ' parking-box-dashboard' : ''}${controllerCls}" data-parking-slot="${slot.slot}"${dropAttrs}>
        ${slotLabelOnly}
        ${zoneLabel}
        ${body}
        ${timerHtml}
        ${confirmHint}
      </${tag}>`;
  }

  function renderParkingGrid(boardData, options = {}) {
    const { readOnly = false, showImages = false, compact = false, dashboardMode = false, controllerMode = false } = options;
    const grid = document.getElementById('parkingGrid');
    if (!grid) return;
    const slots = boardData.parkingSlots || [];
    grid.innerHTML = slots.map((slot) => parkingSlotHtml(slot, { readOnly, showImages, compact, dashboardMode, controllerMode })).join('');
  }

  function updateParkingTimers(boardData) {
    if (!boardData.parkingSlots?.length) return;
    const now = Date.now();
    boardData.parkingSlots.forEach((slot) => {
      if (!slot.istimaraIssued || !slot.deliveryAppointmentMs) return;
      const dueMs = slot.deliveryAppointmentMs;
      slot.timeRemainingMs = dueMs - now;
      slot.timeRemainingLabel = slot.timeRemainingMs > 0
        ? formatLiveTimer({ departureAt: dueMs })
        : 'DELIVERING';
      const el = document.querySelector(`[data-parking-timer="${slot.slot}"]`);
      if (el) el.textContent = slot.timeRemainingLabel;
    });
  }

  function lookupVinEntry(boardData, vin) {
    const target = String(vin || '').trim().toUpperCase();
    if (!target) return null;
    const pool = boardData.parkingPool || boardData.availableParkingPool || [];
    const fromPool = pool.find((e) => e.vin === target || e.refKey === target);
    if (fromPool) return fromPool;
    return (boardData.allRawVinEntries || []).find((e) => e.vin === target || e.refKey === target) || null;
  }

  function formatControllerStatus(status) {
    if (status === 'delivered') return 'Delivered';
    if (status === 'delayed') return 'Delayed';
    if (status === 'in_process') return 'In Process';
    return status || '—';
  }

  function controllerStatusClass(status) {
    if (status === 'delivered') return 'ctl-status-delivered';
    if (status === 'delayed') return 'ctl-status-delayed';
    return 'ctl-status-process';
  }

  function renderControllerStatusTable(boardData) {
    const body = document.getElementById('controllerStatusBody');
    const empty = document.getElementById('controllerStatusEmpty');
    const queueEl = document.getElementById('controllerQueuePanel');
    if (!body) return;

    const rows = [];
    (boardData.parkingSlots || []).forEach((slot) => {
      if (!slot.isOccupied) return;
      rows.push({
        vin: slot.showroomVin,
        customer: slot.showroomCustomer,
        product: slot.showroomProductLabel || slot.showroomProduct,
        delivery: slot.deliveryAppointmentDisplay,
        status: slot.controllerStatus || 'in_process',
        slot: slot.slot,
        kind: 'parking'
      });
    });
    (boardData.parkingQueue || []).forEach((q) => {
      rows.push({
        vin: q.vin,
        customer: q.customerName,
        product: q.productLabel || q.product,
        delivery: q.targetSlot ? `→ P${q.targetSlot}` : 'Waiting',
        status: 'in_process',
        slot: 'Q',
        kind: 'queue',
        queueId: q.id
      });
    });

    if (queueEl) {
      const waiting = (boardData.parkingQueue || []).length;
      queueEl.innerHTML = waiting
        ? `<div class="ctl-queue-banner">${waiting} car(s) waiting in queue</div>`
        : '';
    }

    const addQueueBtn = document.getElementById('btnAddToQueue');
    if (addQueueBtn) {
      addQueueBtn.classList.toggle('hidden', !boardData.parkingFull);
    }

    if (!rows.length) {
      body.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    body.innerHTML = rows.map((r) => `<tr>
      <td class="mono vin-full text-yellow-200">${esc(r.vin || '—')}</td>
      <td>${esc(r.customer || '—')}</td>
      <td>${esc(r.product || '—')}</td>
      <td class="mono text-xs">${esc(r.delivery || '—')}</td>
      <td><span class="ctl-status-pill ${controllerStatusClass(r.status)}">${esc(formatControllerStatus(r.status))}${r.kind === 'queue' ? ' (Queue)' : ''}</span></td>
      <td class="mono text-xs">${r.kind === 'queue' ? 'Queue' : `P${r.slot}`}</td>
    </tr>`).join('');
  }

  function filterPoolEntries(boardData, query, excludeVin, selectedVin) {
    const q = String(query || '').trim().toUpperCase();
    const options = boardData.parkingPool || [];
    return options.filter((e) => {
      if (excludeVin && e.vin === excludeVin && e.vin !== selectedVin) return false;
      if (!q) return true;
      const hay = [e.vin, e.refKey, e.productLabel, e.customerName, e.product, e.model]
        .filter(Boolean).join(' ').toUpperCase();
      return hay.includes(q);
    });
  }

  function renderVinAutocomplete(boardData, options = {}) {
    const {
      inputId,
      listId,
      hiddenVinId,
      onSelect,
      excludeVin = null,
      selectedVin = ''
    } = options;
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    const hidden = hiddenVinId ? document.getElementById(hiddenVinId) : null;
    if (!input || !list) return;

    const q = input.value;
    const entries = filterPoolEntries(boardData, q, excludeVin, selectedVin || hidden?.value);
    const selectable = entries.filter((e) => e.available || e.vin === (hidden?.value || selectedVin));

    list.innerHTML = selectable.slice(0, 12).map((e) =>
      `<button type="button" class="ctl-ac-item" data-vin="${esc(e.vin)}">${esc(formatPoolCarLabel(e))}</button>`
    ).join('');

    list.classList.toggle('hidden', !selectable.length || !q.trim());

    list.querySelectorAll('.ctl-ac-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const vin = btn.dataset.vin;
        input.value = vin;
        if (hidden) hidden.value = vin;
        list.classList.add('hidden');
        if (onSelect) onSelect(vin);
      });
    });

    if (q.trim()) {
      const exact = selectable.find((e) => e.vin === q.trim().toUpperCase() || e.refKey === q.trim().toUpperCase());
      if (exact && hidden) {
        hidden.value = exact.vin;
        if (onSelect) onSelect(exact.vin);
      }
    }
  }

  function controllerCarCardHtml(entry, boardData, options = {}) {
    if (!entry?.vin) return '';
    const { arrived = false, compact = false } = options;
    const inUse = !arrived && !entry.available;
    const product = entry.product || entry.model || '';
    const urls = productImageCandidates(product);
    const urlsJson = esc(JSON.stringify(urls));
    const badge = arrived
      ? '<span class="ctl-next-car-badge" style="background:rgba(59,130,246,0.25);color:#93c5fd">Arrived</span>'
      : (inUse ? '<span class="ctl-next-car-badge">In use</span>' : '<span class="ctl-next-car-badge ctl-badge-ready">Drag →</span>');

    if (compact) {
      const thumb = urls.length
        ? `<img alt="" class="ctl-compact-thumb" data-img-candidates="${urlsJson}" src="${esc(urls[0])}" onerror="window.ShowroomBoard._imgFallback(this)" draggable="false">`
        : '<span class="ctl-compact-thumb ctl-compact-thumb-fallback">🚗</span>';
      return `<div class="ctl-car-card ctl-car-card--compact${arrived ? ' ctl-arrived-card' : ''}${inUse ? ' ctl-in-use' : ''}" draggable="${inUse ? 'false' : 'true'}" data-car-vin="${esc(entry.vin)}" role="button" tabindex="0">
        ${thumb}
        <div class="ctl-compact-body">
          <div class="ctl-compact-vin">${esc(entry.vin)}</div>
          <div class="ctl-compact-meta"><strong>${esc(entry.customerName || 'Unknown')}</strong> · ${esc(entry.productLabel || product || '—')}</div>
        </div>
        ${badge}
      </div>`;
    }

    const img = urls.length
      ? `<img alt="" data-img-candidates="${urlsJson}" src="${esc(urls[0])}" onerror="window.ShowroomBoard._imgFallback(this)" draggable="false" loading="lazy">`
      : '<span class="fallback">🚗</span>';
    return `<div class="ctl-car-card${arrived ? ' ctl-arrived-card' : ''}${inUse ? ' ctl-in-use' : ''}" draggable="${inUse ? 'false' : 'true'}" data-car-vin="${esc(entry.vin)}" role="button" tabindex="0">
      <div class="ctl-car-card-vin" title="${esc(entry.vin)}">${esc(entry.vin)}</div>
      <div class="ctl-car-card-img">${img}</div>
      <div class="ctl-car-card-meta">
        <strong>${esc(entry.customerName || 'Unknown customer')}</strong>
        ${esc(entry.productLabel || product || '—')}
        ${badge}
      </div>
    </div>`;
  }

  function controllerPoolSearchHint(total, shown) {
    return `<div class="ctl-pool-hint">
      <div class="ctl-pool-hint-icon">🔍</div>
      <div class="ctl-pool-hint-title">${total.toLocaleString()} cars in Sales Raw</div>
      <p class="ctl-pool-hint-text">Search by VIN, customer, or product to find a car — then drag it to a bay.</p>
      ${shown < total ? `<p class="ctl-pool-hint-sub">Preview: first ${shown} shown below · refine search for exact match</p>` : ''}
    </div>`;
  }

  function filterControllerPoolEntries(boardData, search) {
    const q = String(search || '').trim().toUpperCase();
    const arrivedVins = new Set((boardData.arrivedCars || []).map((a) => a.vin));
    return (boardData.parkingPool || []).filter((e) => {
      if (arrivedVins.has(e.vin)) return false;
      if (!q) return true;
      const hay = [e.vin, e.refKey, e.productLabel, e.customerName, e.product, e.model]
        .filter(Boolean).join(' ').toUpperCase();
      return hay.includes(q);
    });
  }

  function renderControllerCarCards(boardData, options = {}) {
    const { search = '', selectedVin = '' } = options;
    const grid = document.getElementById('controllerCarCards');
    if (!grid) return;
    const q = String(search || '').trim();
    const entries = filterControllerPoolEntries(boardData, search);
    const total = entries.length;

    if (!total) {
      grid.innerHTML = q
        ? `<div class="ctl-pool-empty">No cars match “${esc(q)}”</div>`
        : `<div class="ctl-pool-empty">No cars in Sales Raw Data. Upload via Data Uploader first.</div>`;
      return;
    }

    const useCompact = total > CONTROLLER_POOL_SEARCH_HINT && (!q || total > 8);
    const previewCount = q ? Math.min(total, CONTROLLER_POOL_RENDER_LIMIT) : Math.min(total, 12);
    const slice = entries.slice(0, previewCount);
    const parts = [];

    if (!q && total > CONTROLLER_POOL_SEARCH_HINT) {
      parts.push(controllerPoolSearchHint(total, previewCount));
    } else if (q && total > CONTROLLER_POOL_RENDER_LIMIT) {
      parts.push(`<div class="ctl-pool-footer">${total.toLocaleString()} matches — showing ${previewCount}</div>`);
    }

    parts.push(slice.map((e) => controllerCarCardHtml(e, boardData, { compact: useCompact })).join(''));
    grid.innerHTML = parts.join('');
    grid.querySelectorAll('.ctl-car-card').forEach((el) => {
      if (el.dataset.carVin === selectedVin) el.classList.add('ctl-selected');
    });
  }

  function renderControllerArrivedCars(boardData, options = {}) {
    const grid = document.getElementById('controllerArrivedCards');
    const empty = document.getElementById('controllerArrivedEmpty');
    if (!grid) return;
    const list = boardData.arrivedCars || [];
    if (!list.length) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    grid.innerHTML = list.map((ac) => {
      const entry = { vin: ac.vin, customerName: ac.customerName, productLabel: ac.productLabel, product: ac.product, available: true };
      return controllerCarCardHtml(entry, boardData, { arrived: true });
    }).join('');
  }

  function renderControllerDelayedCars(boardData) {
    const grid = document.getElementById('controllerDelayedCards');
    const empty = document.getElementById('controllerDelayedEmpty');
    if (!grid) return;
    const list = boardData.delayedCars || [];
    if (!list.length) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    grid.innerHTML = list.map((d) => `
      <button type="button" class="ctl-delayed-row" data-delayed-slot="${d.slot}" data-delayed-vin="${esc(d.vin)}">
        <div class="mono text-xs text-purple-200">${esc(d.vin)}</div>
        <div class="text-sm font-semibold">${esc(d.customerName || '—')}</div>
        <div class="text-xs text-gray-500">${esc(d.productLabel || '—')} · Bay P${d.slot}</div>
        <span class="ctl-next-car-badge" style="background:rgba(168,85,247,0.25);color:#d8b4fe">Reschedule →</span>
      </button>
    `).join('');
  }

  function renderControllerParkingGrid(boardData) {
    renderParkingGrid(boardData, {
      compact: true,
      showImages: true,
      controllerMode: true
    });
  }

  function updateControllerHeaderCounts(boardData) {
    const total = (boardData.parkingPool || []).length;
    const avail = (boardData.availableParkingPool || []).length;
    const arrived = (boardData.arrivedCars || []).length;
    const poolCount = document.getElementById('poolCount');
    const occupiedCount = document.getElementById('parkingOccupiedCount');
    if (poolCount) poolCount.textContent = `${total.toLocaleString()} cars · ${avail.toLocaleString()} free`;
    if (occupiedCount) {
      occupiedCount.textContent = `${(boardData.parkingSlots || []).filter((s) => s.isOccupied).length} / 10`;
    }
  }

  function removeControllerCarCard(vin) {
    const target = String(vin || '').trim().toUpperCase();
    if (!target) return;
    document.querySelectorAll(`#controllerCarPanel .ctl-car-card[data-car-vin="${target}"]`).forEach((el) => el.remove());
    const matched = document.getElementById('controllerCarCards');
    const arrived = document.getElementById('controllerArrivedCards');
    const arrivedEmpty = document.getElementById('controllerArrivedEmpty');
    if (matched && !matched.querySelector('.ctl-car-card') && !String(document.getElementById('carSearch')?.value || '').trim()) {
      matched.innerHTML = `<div class="py-8 text-center text-sm text-gray-500">No cars in Sales Raw Data.</div>`;
    }
    if (arrived && !arrived.querySelector('.ctl-car-card')) {
      arrived.innerHTML = '';
      arrivedEmpty?.classList.remove('hidden');
    }
  }

  function patchControllerParkingSlot(boardData, slotNumber, flash = true) {
    const grid = document.getElementById('parkingGrid');
    const slot = (boardData.parkingSlots || []).find((s) => s.slot === slotNumber);
    if (!grid || !slot) return;
    const existing = grid.querySelector(`[data-parking-slot="${slotNumber}"]`);
    if (!existing) return;
    existing.outerHTML = parkingSlotHtml(slot, { compact: true, showImages: true, controllerMode: true });
    if (!flash) return;
    const el = grid.querySelector(`[data-parking-slot="${slotNumber}"]`);
    el?.classList.add('ctl-slot-flash');
    setTimeout(() => el?.classList.remove('ctl-slot-flash'), 320);
  }

  function buildOptimisticAssignState(boardData, vin, slotNumber) {
    const targetVin = String(vin || '').trim().toUpperCase();
    const entry = lookupVinEntry(boardData, targetVin)
      || (boardData.arrivedCars || []).find((a) => a.vin === targetVin);
    const arrivedEntry = (boardData.arrivedCars || []).find((a) => a.vin === targetVin);
    const parkingSlots = (boardData.parkingSlots || []).map((s) => {
      if (s.slot !== slotNumber) return s;
      return {
        ...s,
        isOccupied: true,
        showroomVin: targetVin,
        showroomCustomer: entry?.customerName || arrivedEntry?.customerName || s.showroomCustomer,
        showroomProduct: entry?.product || arrivedEntry?.product || s.showroomProduct,
        showroomSuffix: entry?.suffix || arrivedEntry?.suffix || s.showroomSuffix,
        showroomProductLabel: entry?.productLabel || arrivedEntry?.productLabel || s.showroomProductLabel,
        showroomLocation: entry?.location || arrivedEntry?.location || s.showroomLocation,
        parkingStatus: 'Occupied',
        controllerStatus: 'in_process',
        securityEntranceAt: arrivedEntry?.securityEntranceAt || s.securityEntranceAt || null,
        securityIstimaraVerified: Boolean(arrivedEntry?.securityIstimaraVerified || s.securityIstimaraVerified),
        securityIstimaraVerifiedAt: arrivedEntry?.securityIstimaraVerifiedAt || s.securityIstimaraVerifiedAt || null
      };
    });
    return {
      ...boardData,
      parkingSlots,
      arrivedCars: (boardData.arrivedCars || []).filter((a) => a.vin !== targetVin),
      availableParkingPool: (boardData.availableParkingPool || []).filter((e) => e.vin !== targetVin)
    };
  }

  function applyFastAssignUI(boardData, vin, slotNumber) {
    removeControllerCarCard(vin);
    patchControllerParkingSlot(boardData, slotNumber);
    updateControllerHeaderCounts(boardData);
  }

  let controllerDragVin = null;
  let controllerDropGuard = false;
  let controllerDropHover = null;
  let controllerHandlers = { onDrop: null, onCardClick: null, onSlotClick: null };
  let controllerInteractionsReady = false;

  function clearControllerDropHover() {
    if (controllerDropHover) {
      controllerDropHover.classList.remove('ctl-drop-hover');
      controllerDropHover = null;
    }
  }

  function setControllerDropHover(zone) {
    if (zone === controllerDropHover) return;
    clearControllerDropHover();
    if (zone) {
      controllerDropHover = zone;
      zone.classList.add('ctl-drop-hover');
    }
  }

  function setControllerHandlers(handlers = {}) {
    controllerHandlers = { ...controllerHandlers, ...handlers };
  }

  function initControllerInteractions(handlers = {}) {
    setControllerHandlers(handlers);
    if (controllerInteractionsReady) return;
    controllerInteractionsReady = true;

    const parkingRoot = document.getElementById('parkingGrid');
    const carPanel = document.getElementById('controllerCarPanel');
    if (!parkingRoot || !carPanel) return;

    carPanel.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.ctl-car-card[draggable="true"]');
      if (!card) return;
      controllerDragVin = card.dataset.carVin;
      card.classList.add('ctl-dragging');
      document.body.classList.add('ctl-dnd-active');
      e.dataTransfer.setData('text/plain', controllerDragVin);
      e.dataTransfer.effectAllowed = 'move';
    });

    carPanel.addEventListener('dragend', (e) => {
      const card = e.target.closest('.ctl-car-card');
      card?.classList.remove('ctl-dragging');
      controllerDragVin = null;
      document.body.classList.remove('ctl-dnd-active');
      clearControllerDropHover();
    });

    carPanel.addEventListener('click', (e) => {
      const card = e.target.closest('.ctl-car-card');
      if (card?.dataset.carVin && controllerHandlers.onCardClick) {
        controllerHandlers.onCardClick(card.dataset.carVin);
      }
    });

    parkingRoot.addEventListener('click', (e) => {
      if (controllerDragVin || controllerDropGuard) return;
      const zone = e.target.closest('[data-parking-slot]');
      if (zone && controllerHandlers.onSlotClick) {
        controllerHandlers.onSlotClick(Number(zone.dataset.parkingSlot));
      }
    });

    parkingRoot.addEventListener('dragover', (e) => {
      const zone = e.target.closest('.ctl-drop-target');
      if (!zone) {
        setControllerDropHover(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setControllerDropHover(zone);
    });

    parkingRoot.addEventListener('dragleave', (e) => {
      if (!parkingRoot.contains(e.relatedTarget)) clearControllerDropHover();
    });

    parkingRoot.addEventListener('drop', (e) => {
      const zone = e.target.closest('.ctl-drop-target');
      if (!zone) return;
      e.preventDefault();
      e.stopPropagation();
      clearControllerDropHover();
      const vin = e.dataTransfer.getData('text/plain') || controllerDragVin;
      const slot = Number(zone.dataset.dropSlot);
      controllerDropGuard = true;
      if (vin && slot && controllerHandlers.onDrop) controllerHandlers.onDrop(vin, slot);
      controllerDragVin = null;
      document.body.classList.remove('ctl-dnd-active');
      setTimeout(() => { controllerDropGuard = false; }, 40);
    });
  }

  function bindControllerDragDrop(handlers = {}) {
    setControllerHandlers(handlers);
    initControllerInteractions(handlers);
  }

  function formatPoolCarLabel(entry) {
    if (!entry) return '';
    const parts = [entry.vin];
    if (entry.productLabel && entry.productLabel !== '—') parts.push(entry.productLabel);
    if (entry.customerName) parts.push(entry.customerName);
    return parts.join(' · ');
  }

  function toDateInputValue(value) {
    const ms = Date.parse(String(value || ''));
    if (isNaN(ms)) return '';
    return new Date(ms).toISOString().slice(0, 10);
  }

  function toDateTimeLocalValue(value) {
    const ms = Date.parse(String(value || ''));
    if (isNaN(ms)) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function dateTimeLocalToISO(localValue) {
    if (!localValue) return null;
    const ms = new Date(localValue).getTime();
    if (isNaN(ms)) return null;
    return new Date(ms).toISOString();
  }

  function recordYesNo(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return '—';
  }

  function renderParkingRecords(records) {
    const body = document.getElementById('recordsBody');
    const empty = document.getElementById('recordsEmpty');
    if (!body) return;
    const rows = records || [];
    if (!rows.length) {
      body.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    body.innerHTML = rows.map((r) => `<tr>
      <td class="mono text-xs">${esc(new Date(r.recordedAt).toLocaleString('en-GB'))}</td>
      <td>${r.slot ? `P${esc(r.slot)}` : '—'}</td>
      <td>${esc(r.eventType)}</td>
      <td>${esc(r.kanbanStatus || '—')}</td>
      <td>${esc(formatControllerStatus(r.controllerStatus) || '—')}</td>
      <td class="mono vin-full">${esc(r.showroomVin || '—')}</td>
      <td>${esc(r.showroomProduct || '—')} · ${esc(r.showroomSuffix || '—')}</td>
      <td>${esc(r.showroomCustomer || '—')}</td>
      <td class="mono text-xs">${esc(r.deliveryAppointmentTime ? new Date(r.deliveryAppointmentTime).toLocaleString('en-GB') : '—')}</td>
      <td class="mono text-xs">${esc(r.securityEntranceAt ? new Date(r.securityEntranceAt).toLocaleString('en-GB') : '—')}</td>
      <td class="mono text-xs">${esc(r.securityIstimaraVerifiedAt ? new Date(r.securityIstimaraVerifiedAt).toLocaleString('en-GB') : (r.securityIstimaraVerified ? 'Yes' : '—'))}</td>
      <td>${recordYesNo(r.checklistWashed)}</td>
      <td>${recordYesNo(r.checklistStickersRemoved)}</td>
      <td>${recordYesNo(r.checklistNotDamaged)}</td>
      <td>${recordYesNo(r.checklistPlated)}</td>
      <td>${recordYesNo(r.checklistCarArrived)}</td>
      <td class="text-xs text-gray-400">${esc(r.notes || '')}</td>
    </tr>`).join('');
  }

  function isSameLocalDay(ms, ref = Date.now()) {
    const a = new Date(ms);
    const b = new Date(ref);
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function formatKanbanTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function formatKanbanDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function kanbanProductLine(slot) {
    const parts = [slot.showroomProduct, slot.showroomSuffix].filter(Boolean);
    return parts.join(' · ').toUpperCase() || 'TOYOTA VEHICLE';
  }

  function kanbanCardImageHtml(productName, id, size = 'card') {
    const urls = productImageCandidates(productName);
    const cls = size === 'guest' ? 'kb-guest-car-img' : '';
    if (!urls.length) {
      return `<div class="kb-card-img"><span class="fallback">🚗</span></div>`;
    }
    const urlsJson = esc(JSON.stringify(urls));
    if (size === 'guest') {
      const imgId = id ? ` id="${esc(id)}"` : ' id="kb-guest-img"';
      return `<img class="${cls}"${imgId} alt="" data-img-candidates="${urlsJson}" src="${esc(urls[0])}" onerror="window.ShowroomBoard._imgFallback(this)">`;
    }
    return `<div class="kb-card-img">
      <img alt="" data-img-candidates="${urlsJson}" src="${esc(urls[0])}" onerror="window.ShowroomBoard._imgFallback(this)">
    </div>`;
  }

  function refreshSlotsLiveState(boardData, now = Date.now()) {
    (boardData.parkingSlots || []).forEach((slot) => {
      if (!slot.isOccupied) return;
      if (slot.istimaraIssued && slot.deliveryAppointmentMs) {
        const appt = slot.deliveryAppointmentMs;
        const reminderAt = appt - DELIVERY_REMINDER_MS;
        const prepAt = appt - DELIVERY_PREP_REMINDER_MS;
        slot.timeRemainingMs = appt - now;
        slot.timeRemainingLabel = now >= appt ? 'DELIVERING' : formatLiveTimer({ departureAt: appt });
        slot.prepReminderActive = now >= prepAt && now < appt;
        slot.deliveryReminderActive = now >= reminderAt && now < appt;
        slot.carReadyForCustomer = now >= reminderAt && now < appt + DELIVERY_SLOT_MS;
        const customerName = (slot.showroomCustomer || '').trim();
        slot.customerReadyMessage = slot.carReadyForCustomer && customerName
          ? `${customerName}, your car is ready`
          : null;
        if (slot.deliveryReminderActive) slot.parkingStatus = 'Delivery in 15 Min';
        else if (slot.awaitingDeliveryConfirm || now >= appt) slot.parkingStatus = 'Delivering';
        else if (appt && now < appt) slot.parkingStatus = 'Delivery Booked';
        slot.kanbanColumn = classifyKanbanColumn(slot, now);
        slot.kanbanStatusLabel = getKanbanStatusLabel(slot.kanbanColumn);
      }
    });
  }

  let _kanbanFingerprint = '';

  function kanbanFingerprint(model) {
    const c = model.columns;
    return [
      model.kpis.ready, model.kpis.process, model.kpis.scheduled, model.kpis.prep, model.kpis.completed,
      model.nextGuest?.slot,
      (model.readyCustomers || []).map((s) => s.slot).join(','),
      c.ready.map((s) => s.slot).join(','),
      c.scheduled.map((s) => `${s.slot}:${s.securityEntranceAt || ''}:${s.securityIstimaraVerified || ''}`).join(','),
      c.process.map((s) => s.slot).join(',')
    ].join('|');
  }

  function tickKanbanLive(boardData, onFullRender) {
    refreshSlotsLiveState(boardData);
    const model = buildKanbanModel(boardData);
    const fp = kanbanFingerprint(model);
    if (fp !== _kanbanFingerprint) {
      _kanbanFingerprint = fp;
      if (onFullRender) onFullRender(boardData);
    } else {
      (boardData.parkingSlots || []).forEach((slot) => {
        const el = document.querySelector(`[data-parking-timer="${slot.slot}"]`);
        if (el && slot.timeRemainingLabel) el.textContent = slot.timeRemainingLabel;
      });
      const guestEl = document.querySelector('[data-parking-timer="guest"]');
      if (guestEl && model.nextGuest?.deliveryAppointmentMs) {
        const ms = model.nextGuest.deliveryAppointmentMs - Date.now();
        guestEl.textContent = ms > 0
          ? formatLiveTimer({ departureAt: model.nextGuest.deliveryAppointmentMs })
          : 'DELIVERING';
      }
    }
  }

  function classifyKanbanColumn(slot, now = Date.now()) {
    if (!slot.isOccupied && !slot.isArrivedEntry) return null;
    if (slot.kanbanColumn && !slot.isArrivedEntry) return slot.kanbanColumn;

    const appt = slot.deliveryAppointmentMs;
    const istimaraIssued = Boolean(slot.istimaraIssued);

    if (slot.parkingStatus === 'Delivering' || slot.awaitingDeliveryConfirm
        || (istimaraIssued && appt && now >= appt)) {
      return 'process';
    }

    const prepAt = appt ? appt - DELIVERY_PREP_REMINDER_MS : null;
    if (slot.securityIstimaraVerified && appt && prepAt && now >= prepAt && now < appt) {
      return 'ready';
    }
    if (slot.deliveryReminderActive || slot.carReadyForCustomer) {
      return 'ready';
    }

    if (slot.securityIstimaraVerified && appt && (!prepAt || now < prepAt)) {
      return 'scheduled';
    }

    if (slot.securityEntranceAt && !slot.securityIstimaraVerified) {
      return 'prep';
    }

    if (slot.deliveryDelayed || slot.parkingStatus === 'Delayed') {
      return 'scheduled';
    }

    if (slot.parkingStatus === 'Delivery Booked' || (istimaraIssued && appt)) {
      return 'scheduled';
    }

    return 'prep';
  }

  const KANBAN_STATUS_LABELS = {
    ready: 'Ready for Delivery',
    scheduled: 'Scheduled Today',
    process: 'In Delivery Process',
    prep: 'Quality Check',
    done: 'Completed Today'
  };

  function getKanbanStatusLabel(column) {
    return KANBAN_STATUS_LABELS[column] || column || '—';
  }

  function kanbanStatusClass(column) {
    if (column === 'ready') return 'sec-status-ready';
    if (column === 'scheduled') return 'sec-status-scheduled';
    if (column === 'process') return 'sec-status-process';
    if (column === 'done') return 'sec-status-done';
    return 'sec-status-prep';
  }

  function buildKanbanModel(boardData, now = Date.now()) {
    const slots = boardData.parkingSlots || [];
    const records = boardData.parkingRecords || [];
    const columns = { ready: [], scheduled: [], process: [], prep: [], done: [] };

    slots.forEach((slot) => {
      const col = classifyKanbanColumn(slot, now);
      if (col) columns[col].push(slot);
    });

    (boardData.arrivedCars || []).forEach((ac) => {
      const virtual = {
        isArrivedEntry: true,
        isOccupied: true,
        slot: ac.slot || '—',
        showroomVin: ac.vin,
        showroomCustomer: ac.customerName,
        showroomProduct: ac.product,
        showroomSuffix: ac.suffix,
        showroomProductLabel: ac.productLabel,
        securityEntranceAt: ac.securityEntranceAt,
        securityEntranceDisplay: ac.securityEntranceDisplay,
        securityIstimaraVerified: ac.securityIstimaraVerified,
        kanbanColumn: 'prep'
      };
      if (!slots.some((s) => s.showroomVin === ac.vin)) {
        columns.prep.push(virtual);
      }
    });

    columns.ready.sort((a, b) => (a.deliveryAppointmentMs || 0) - (b.deliveryAppointmentMs || 0));
    columns.scheduled.sort((a, b) => (a.deliveryAppointmentMs || 0) - (b.deliveryAppointmentMs || 0));
    columns.process.sort((a, b) => (a.deliveryAppointmentMs || 0) - (b.deliveryAppointmentMs || 0));
    columns.prep.sort((a, b) => {
      const ta = Date.parse(a.securityEntranceAt || '') || 0;
      const tb = Date.parse(b.securityEntranceAt || '') || 0;
      return tb - ta;
    });

    records.forEach((r) => {
      if (r.eventType !== 'delivered') return;
      const t = Date.parse(r.recordedAt);
      if (isNaN(t) || !isSameLocalDay(t, now)) return;
      columns.done.push({
        isRecord: true,
        slot: r.slot,
        showroomProduct: r.showroomProduct,
        showroomSuffix: r.showroomSuffix,
        showroomCustomer: r.showroomCustomer,
        showroomVin: r.showroomVin,
        completedMs: t,
        completedDisplay: formatKanbanTime(t)
      });
    });

    const scheduledToday = slots.filter((s) =>
      s.istimaraIssued && s.deliveryAppointmentMs && isSameLocalDay(s.deliveryAppointmentMs, now)
    ).length;
    const completedToday = columns.done.length;
    const onTime = scheduledToday > 0
      ? Math.min(100, Math.round((completedToday / scheduledToday) * 100))
      : (completedToday > 0 ? 100 : 0);

    let nextGuest = columns.ready[0] || columns.scheduled.find((s) => s.deliveryAppointmentMs > now) || columns.process[0] || null;
    const readyCustomers = slots
      .filter((s) => s.isOccupied && s.carReadyForCustomer && s.customerReadyMessage)
      .sort((a, b) => (a.deliveryAppointmentMs || 0) - (b.deliveryAppointmentMs || 0));

    return {
      columns,
      kpis: {
        todaysDeliveries: scheduledToday + completedToday,
        ready: columns.ready.length,
        prep: columns.prep.length,
        process: columns.process.length,
        completed: completedToday,
        onTime
      },
      nextGuest,
      readyCustomers
    };
  }

  function renderKanbanCard(slot, col) {
    if (slot.isRecord) {
      return `<div class="kb-card">
        ${kanbanCardImageHtml(slot.showroomProduct, slot.slot)}
        <div class="kb-card-body">
          <div class="kb-card-id">DLV-P${String(slot.slot).padStart(2, '0')}</div>
          <div class="kb-card-title">${esc(kanbanProductLine(slot))}</div>
          <div class="kb-card-meta"><span class="kb-badge done">Completed ${esc(slot.completedDisplay)}</span></div>
        </div>
      </div>`;
    }

    const id = `DLV-P${String(slot.slot).padStart(2, '0')}`;
    const title = kanbanProductLine(slot);
    const img = kanbanCardImageHtml(slot.showroomProduct || slot.showroomModel, slot.slot);
    let badges = `<span class="kb-badge bay">Bay ${String(slot.slot).padStart(2, '0')}</span>`;
    let extra = '';

    if (col === 'ready') {
      badges += `<span class="kb-badge ready">Ready</span>`;
      if (slot.istimaraIssued) {
        extra = `<div class="kb-card-timer" data-parking-timer="${slot.slot}">${esc(slot.timeRemainingLabel || '—')}</div>`;
      }
    } else if (col === 'scheduled') {
      badges += `<span class="kb-badge time">${esc(formatKanbanTime(slot.deliveryAppointmentMs))}</span>`;
      if (slot.showroomCustomer) {
        extra = `<div class="kb-card-timer">${esc(slot.showroomCustomer.split(/\s+/)[0])}</div>`;
      }
    } else if (col === 'process') {
      badges += `<span class="kb-badge process">In Delivery</span>`;
      extra = `<div class="kb-card-timer">Vehicle Presentation</div>`;
    } else if (col === 'prep') {
      badges += `<span class="kb-badge bay">${slot.isArrivedEntry ? 'Gate Arrival' : (slot.securityEntranceAt ? 'QC Check' : 'Occupied')}</span>`;
      if (slot.securityEntranceDisplay && slot.securityEntranceDisplay !== '—') {
        extra = `<div class="kb-card-timer">Arrived ${esc(slot.securityEntranceDisplay)}</div>`;
      }
    }

    return `<div class="kb-card">
      ${img}
      <div class="kb-card-body">
        <div class="kb-card-id">${esc(id)}</div>
        <div class="kb-card-title">${esc(title)}</div>
        <div class="kb-card-meta">${badges}</div>
        ${extra}
      </div>
    </div>`;
  }

  function renderKanbanColumn(colId, title, cssClass, items) {
    const body = items.length
      ? items.map((s) => renderKanbanCard(s, colId)).join('')
      : `<div class="kb-col-empty"><span class="kb-col-empty-icon" aria-hidden="true"></span><span>No vehicles</span></div>`;
    return `<div class="kb-column kb-column--${cssClass}">
      <div class="kb-col-head ${cssClass}"><span>${title}</span><span class="kb-col-count">${items.length}</span></div>
      <div class="kb-col-body">${body}</div>
    </div>`;
  }

  function getReadyCustomerSlots(boardData) {
    refreshSlotsLiveState(boardData);
    return (boardData.parkingSlots || [])
      .filter((s) => s.isOccupied && s.carReadyForCustomer && s.customerReadyMessage)
      .sort((a, b) => (a.deliveryAppointmentMs || 0) - (b.deliveryAppointmentMs || 0));
  }

  function renderKanbanReadyCenter(boardData) {
    const el = document.getElementById('kbReadyCenter');
    if (!el) return;
    const ready = getReadyCustomerSlots(boardData);
    if (!ready.length) {
      el.classList.add('kb-ready-center--hidden');
      el.innerHTML = '';
      document.body.classList.remove('kb-ready-active');
      return;
    }
    const slot = ready[0];
    const productLine = kanbanProductLine(slot);
    const img = kanbanCardImageHtml(slot.showroomProduct || slot.showroomModel, 'center-ready', 'guest');
    const firstName = (slot.showroomCustomer || 'Guest').split(/\s+/)[0];
    document.body.classList.add('kb-ready-active');
    el.classList.remove('kb-ready-center--hidden');
    el.innerHTML = `
      <div class="kb-ready-center-backdrop" aria-hidden="true"></div>
      <div class="kb-ready-center-card">
        <div class="kb-ready-center-kicker">Your vehicle is ready</div>
        <div class="kb-ready-center-title">${esc(slot.customerReadyMessage)}</div>
        <div class="kb-ready-center-welcome">Welcome, ${esc(firstName)}</div>
        <div class="kb-ready-center-car">${img}</div>
        <div class="kb-ready-center-product">${esc(productLine)}</div>
        <div class="kb-ready-center-bay">Parking Bay <strong>P${String(slot.slot).padStart(2, '0')}</strong></div>
        <div class="kb-ready-center-sub">Please see our delivery team at the guest experience desk</div>
      </div>
    `;
  }

  function renderKanbanGuestPanel(guest) {
    const panel = document.getElementById('kbGuestPanel');
    if (!panel) return;
    if (!guest) {
      panel.innerHTML = `<div class="kb-guest-label">Today's Next Guest</div>
        <div class="kb-guest-empty-state">
          <div class="kb-guest-empty-icon" aria-hidden="true"><iconify-icon icon="ant-design:calendar-outlined"></iconify-icon></div>
          <p class="kb-guest-empty-title">No upcoming delivery at this time</p>
          <p class="kb-guest-empty-sub">Have a great day!</p>
        </div>`;
      return;
    }
    const firstName = (guest.showroomCustomer || 'Guest').split(/\s+/)[0];
    const productLine = kanbanProductLine(guest);
    const img = kanbanCardImageHtml(guest.showroomProduct || guest.showroomModel, 'guest', 'guest');
    const timer = guest.istimaraIssued && guest.deliveryAppointmentMs
      ? `<div class="kb-guest-timer" data-parking-timer="guest">${esc(guest.timeRemainingLabel || formatLiveTimer({ departureAt: guest.deliveryAppointmentMs }))}</div>`
      : '';
    const readyMsg = guest.customerReadyMessage
      ? `<div class="kb-guest-ready-banner">${esc(guest.customerReadyMessage)}</div>`
      : `<div class="kb-guest-message" style="background:rgba(59,130,246,0.15);border-color:rgba(59,130,246,0.35);color:#93c5fd">
          Thank you for choosing Toyota. We look forward to your delivery.</div>`;

    panel.innerHTML = `
      <div class="kb-guest-label">Today's Next Guest</div>
      <div class="kb-guest-welcome">WELCOME Mr. ${esc(firstName)}</div>
      <div class="kb-guest-welcome-ar">مرحباً ${esc(firstName)}</div>
      <div class="kb-guest-car-wrap">${img}</div>
      <div class="kb-guest-product">${esc(productLine)}</div>
      ${timer}
      <div class="kb-guest-appt">
        <div class="kb-guest-appt-row"><span>Appointment</span><strong>${esc(formatKanbanDate(guest.deliveryAppointmentMs))}</strong></div>
        <div class="kb-guest-appt-row"><span>Time</span><strong>${esc(formatKanbanTime(guest.deliveryAppointmentMs))}</strong></div>
        <div class="kb-guest-appt-row"><span>Parking</span><strong>Bay ${String(guest.slot).padStart(2, '0')}</strong></div>
      </div>
      ${readyMsg}
    `;
  }

  function renderKanbanDashboard(boardData) {
    refreshSlotsLiveState(boardData);
    const model = buildKanbanModel(boardData);
    _kanbanFingerprint = kanbanFingerprint(model);
    const k = model.kpis;

    const setKpi = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setKpi('kpiDeliveries', k.todaysDeliveries);
    setKpi('kpiReady', k.ready);
    setKpi('kpiPrep', k.prep);
    setKpi('kpiProcess', k.process);
    setKpi('kpiCompleted', k.completed);
    setKpi('kpiOnTime', `${k.onTime}%`);
    const gaugeEl = document.getElementById('kpiOnTimeGauge');
    if (gaugeEl) gaugeEl.style.setProperty('--gauge-pct', String(k.onTime));

    const board = document.getElementById('kanbanBoard');
    if (board) {
      const c = model.columns;
      board.innerHTML =
        renderKanbanColumn('ready', 'Ready for Delivery', 'ready', c.ready) +
        renderKanbanColumn('scheduled', 'Scheduled Today', 'scheduled', c.scheduled) +
        renderKanbanColumn('process', 'In Delivery Process', 'process', c.process) +
        renderKanbanColumn('prep', 'Quality Check', 'prep', c.prep) +
        renderKanbanColumn('done', 'Completed Today', 'done', c.done);
    }

    renderKanbanGuestPanel(model.nextGuest);
    renderKanbanReadyCenter(boardData);

    const dateEl = document.getElementById('kbDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    }
  }

  function updateKanbanTimers(boardData) {
    updateParkingTimers(boardData);
    const guest = buildKanbanModel(boardData).nextGuest;
    if (guest?.deliveryAppointmentMs) {
      const el = document.querySelector('[data-parking-timer="guest"]');
      if (el) {
        const ms = guest.deliveryAppointmentMs - Date.now();
        el.textContent = ms > 0 ? formatLiveTimer({ departureAt: guest.deliveryAppointmentMs }) : 'DELIVERING';
      }
    }
  }

  return {
    REFRESH_MS,
    DASHBOARD_REFRESH_MS,
    RECORDS_POLL_MS,
    UPLOADER_POLL_MS,
    DASHBOARD_LIVE_TICK_MS,
    DELAYED_ZONE_SLOTS,
    STATUS_COLORS,
    esc,
    auth,
    fetchBoardData,
    fetchSalesRawData,
    parseJsonResponse,
    pickSalesRawColumns,
    formatLiveTimer,
    formatReplacement,
    readFileAsDataUrl,
    renderSalesRawTable,
    renderLeadsMatchTable,
    renderUploaderMeta,
    renderBoard,
    renderParkingGrid,
    renderParkingAlerts,
    renderControllerStatusTable,
    renderControllerCarCards,
    renderControllerArrivedCars,
    renderControllerDelayedCars,
    renderControllerParkingGrid,
    initControllerInteractions,
    bindControllerDragDrop,
    buildOptimisticAssignState,
    applyFastAssignUI,
    patchControllerParkingSlot,
    updateControllerHeaderCounts,
    removeControllerCarCard,
    controllerCarCardHtml,
    productImageCandidates,
    renderVinAutocomplete,
    filterPoolEntries,
    formatControllerStatus,
    getKanbanStatusLabel,
    kanbanStatusClass,
    renderKanbanDashboard,
    tickKanbanLive,
    updateKanbanTimers,
    updateParkingTimers,
    lookupVinEntry,
    formatPoolCarLabel,
    toDateInputValue,
    toDateTimeLocalValue,
    dateTimeLocalToISO,
    renderParkingRecords,
    updateLiveTimers,
    startClock,
    connectWs,
    initShowroomLive,
    renderLivePill,
    formatLastRefresh,
    _imgFallback
  };
})();
