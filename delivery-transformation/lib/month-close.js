'use strict';

/**
 * Month-close (day 1): archive Live Sheet to Excel, then purge
 * PSFU / Claimed / تم التسليم — keep all other statuses on employee.html.
 */

const fs = require('fs');
const path = require('path');
const exportExcel = require('./export-excel');

/** Statuses removed after manager downloads the month archive */
const PURGE_STATUSES = Object.freeze(['PSFU', 'Claimed', 'تم التسليم']);

function riyadhParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    ym: `${parts.year}-${parts.month}`,
  };
}

function previousMonthKey(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

function shouldKeepVin(vehicle) {
  const status = String((vehicle && vehicle.ops && vehicle.ops.opsStatus) || '').trim();
  return !PURGE_STATUSES.includes(status);
}

function archivePathFor(dataFile, forMonth) {
  const dir = path.dirname(dataFile);
  return path.join(dir, `delivery-transformation-month-close-${forMonth}.xlsx`);
}

function buildMonthCloseWorkbook(vehicles, forMonth) {
  const list = vehicles || [];
  const wb = exportExcel.buildLiveSheetWorkbook(list);
  const summary = [
    { Field: 'Closed month', Value: forMonth },
    { Field: 'Prepared (UTC)', Value: new Date().toISOString() },
    { Field: 'Total VINs archived', Value: list.length },
    { Field: 'Will keep (not PSFU/Claimed/تم التسليم)', Value: list.filter(shouldKeepVin).length },
    { Field: 'Will remove (PSFU/Claimed/تم التسليم)', Value: list.filter((v) => !shouldKeepVin(v)).length },
  ];
  exportExcel.appendSheet(wb, 'Month Close', summary);
  return wb;
}

/**
 * On Riyadh day 1, prepare archive of all Live Sheet VINs for the previous month key.
 * Does not purge until manager downloads + confirms.
 */
function scanMonthClose(store) {
  const now = riyadhParts();
  if (now.day !== 1) return store.data.meta && store.data.meta.monthClose;

  const forMonth = previousMonthKey(now.ym);
  if (!forMonth) return null;

  if (!store.data.meta || typeof store.data.meta !== 'object') store.data.meta = {};
  const prev = store.data.meta.monthClose;
  if (prev && prev.forMonth === forMonth && prev.preparedAt && !prev.cancelled) {
    return prev;
  }

  const vehicles = store.allVehicles();
  const file = archivePathFor(store.filePath, forMonth);
  const wb = buildMonthCloseWorkbook(vehicles, forMonth);
  const buf = exportExcel.writeBuffer(wb);
  fs.writeFileSync(file, buf);

  const keep = vehicles.filter(shouldKeepVin).length;
  const remove = vehicles.length - keep;
  const entry = {
    forMonth,
    preparedAt: new Date().toISOString(),
    preparedOn: now.ymd,
    downloadedAt: '',
    purgedAt: '',
    cancelled: false,
    archiveFile: file,
    total: vehicles.length,
    willKeep: keep,
    willRemove: remove,
    kept: 0,
    removed: 0,
  };
  store.data.meta.monthClose = entry;
  store.pushAudit({
    vin: '',
    user: 'System',
    action: 'month_close_prepared',
    oldValue: forMonth,
    newValue: `${vehicles.length} VINs · remove ${remove} · keep ${keep}`,
  });
  store.save();
  return entry;
}

function monthCloseStatus(store) {
  scanMonthClose(store);
  const mc = store.data.meta && store.data.meta.monthClose;
  if (!mc || mc.cancelled) {
    return { pending: false, ready: false, purged: false };
  }
  const fileOk = !!(mc.archiveFile && fs.existsSync(mc.archiveFile));
  return {
    pending: !mc.purgedAt && fileOk,
    ready: fileOk && !mc.purgedAt,
    purged: !!mc.purgedAt,
    downloaded: !!mc.downloadedAt,
    forMonth: mc.forMonth || '',
    preparedAt: mc.preparedAt || '',
    downloadedAt: mc.downloadedAt || '',
    purgedAt: mc.purgedAt || '',
    total: mc.total || 0,
    willKeep: mc.willKeep || 0,
    willRemove: mc.willRemove || 0,
    kept: mc.kept || 0,
    removed: mc.removed || 0,
    purgeStatuses: [...PURGE_STATUSES],
  };
}

function markDownloaded(store, by) {
  if (!store.data.meta || !store.data.meta.monthClose) return null;
  const mc = store.data.meta.monthClose;
  if (!mc.downloadedAt) {
    mc.downloadedAt = new Date().toISOString();
    mc.downloadedBy = by || '';
    store.pushAudit({
      vin: '',
      user: by || 'Manager',
      action: 'month_close_downloaded',
      oldValue: mc.forMonth || '',
      newValue: mc.archiveFile || '',
    });
    store.save();
  }
  return mc;
}

function applyMonthClosePurge(store, by) {
  const mc = store.data.meta && store.data.meta.monthClose;
  if (!mc || mc.purgedAt) {
    throw new Error(mc && mc.purgedAt ? 'Month close already applied' : 'No month archive ready');
  }
  if (!mc.downloadedAt) {
    throw new Error('Download the Excel archive first');
  }

  const all = store.allVehicles();
  let kept = 0;
  let removed = 0;
  all.forEach((v) => {
    if (shouldKeepVin(v)) {
      kept += 1;
      return;
    }
    const key = String(v.vin || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    store.deleteVehicle(key);
    removed += 1;
    store.pushAudit({
      vin: v.vin,
      user: by || 'Manager',
      action: 'month_close_purge',
      oldValue: String((v.ops && v.ops.opsStatus) || ''),
      newValue: 'removed',
    });
  });

  mc.purgedAt = new Date().toISOString();
  mc.purgedBy = by || '';
  mc.kept = kept;
  mc.removed = removed;
  store.pushAudit({
    vin: '',
    user: by || 'Manager',
    action: 'month_close_applied',
    oldValue: mc.forMonth || '',
    newValue: `kept ${kept} · removed ${removed}`,
  });
  store.save();
  return { kept, removed, forMonth: mc.forMonth };
}

function forcePrepare(store, by) {
  const now = riyadhParts();
  const forMonth = previousMonthKey(now.ym);
  if (!store.data.meta || typeof store.data.meta !== 'object') store.data.meta = {};
  const vehicles = store.allVehicles();
  const file = archivePathFor(store.filePath, forMonth);
  const wb = buildMonthCloseWorkbook(vehicles, forMonth);
  const buf = exportExcel.writeBuffer(wb);
  fs.writeFileSync(file, buf);
  const keep = vehicles.filter(shouldKeepVin).length;
  const entry = {
    forMonth,
    preparedAt: new Date().toISOString(),
    preparedOn: now.ymd,
    downloadedAt: '',
    purgedAt: '',
    cancelled: false,
    archiveFile: file,
    total: vehicles.length,
    willKeep: keep,
    willRemove: vehicles.length - keep,
    kept: 0,
    removed: 0,
    manual: true,
  };
  store.data.meta.monthClose = entry;
  store.pushAudit({
    vin: '',
    user: by || 'System',
    action: 'month_close_prepared',
    oldValue: forMonth,
    newValue: `manual · ${vehicles.length} VINs · remove ${entry.willRemove} · keep ${keep}`,
  });
  store.save();
  return entry;
}

function startMonthCloseScanner(store) {
  const tick = () => {
    try {
      scanMonthClose(store);
    } catch (err) {
      console.error('[delivery-transformation] month-close scan failed:', err.message);
    }
  };
  tick();
  const timer = setInterval(tick, 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  PURGE_STATUSES,
  riyadhParts,
  previousMonthKey,
  shouldKeepVin,
  scanMonthClose,
  monthCloseStatus,
  markDownloaded,
  applyMonthClosePurge,
  forcePrepare,
  startMonthCloseScanner,
  archivePathFor,
};
