'use strict';

const RUBA_ID = 'ruba';
const RETAIL = 'retail electronic sales';
const STOCK_LOCATIONS = Object.freeze([
  '7022 telesales north',
  '7277 ecommerce sales - retail',
]);

function normText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function normVin(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function locationRuleApplies(user) {
  const id = typeof user === 'string' ? user : (user && (user.userId || user.id));
  return id !== RUBA_ID;
}

function isSpecialStockLocation(location) {
  return STOCK_LOCATIONS.includes(normText(location));
}

function isRetailElectronic(area) {
  return normText(area) === RETAIL;
}

function classifyRtlRow(prev, row, { printed = false, fileDate = '' } = {}) {
  const location = String((row && row.location) || '').trim();
  const searchArea = String((row && (row.vehicleSearchArea || row.searchAreaDesc)) || '').trim();
  const secondary = String((row && row.secondaryStatus) || '').trim();
  const age = String(row && row.age != null ? row.age : '').trim();
  const allocationDate = String((row && row.allocationDate) || '').trim().slice(0, 10);
  const fileDay = String(fileDate || '').trim().slice(0, 10);
  const wasRetail = isRetailElectronic(prev && prev.searchArea);
  const nowRetail = isRetailElectronic(searchArea);
  let stockClass = 'UNDEFINED';
  let reason = 'No stock-in rule matched this location.';
  if (printed) {
    stockClass = 'WITH DELIVERY NOTE';
    reason = 'A delivery note is saved. The VIN stays out of available stock and is not physically delivered by the note alone.';
  } else if (prev && prev.searchArea && wasRetail && !nowRetail) {
    stockClass = 'SWAPPED OUT';
    reason = 'Moved out of Retail Electronic Sales. Last location is kept.';
  } else if (prev && prev.searchArea && !wasRetail && nowRetail) {
    stockClass = 'SWAPPED IN';
    reason = 'Moved into Retail Electronic Sales from another area. Not a new allocation for the current user.';
  } else if (isSpecialStockLocation(location)) {
    stockClass = 'STOCK IN';
    reason = 'Location is 7022 Telesales North or 7277 eCommerce Sales – Retail. Available until a delivery note is saved.';
  } else if (nowRetail && age === '0' && allocationDate && fileDay && allocationDate === fileDay) {
    stockClass = 'NEW ALLOCATION';
    reason = 'Retail Electronic Sales allocation on the RTL file date with allocation age 0.';
  } else if (normText(secondary) === 'vehicle allocation completed') {
    stockClass = 'FREE IN MY STOCK';
    reason = 'Secondary status is Vehicle allocation completed.';
  }
  return {
    vin: normVin(row && row.vin),
    product: String((row && row.product) || '').trim(),
    location,
    searchArea,
    secondary,
    age,
    allocationDate,
    stockClass,
    reason,
    missing: false,
  };
}

function printedVin(store, vin) {
  const vehicle = store.getVehicle(vin);
  const at = vehicle && vehicle.ops && vehicle.ops.coordinatorPrintedAt;
  return Boolean(String(at || '').trim());
}

function applyRtlPush(store, vehicles, info = {}) {
  const meta = store.data.meta && typeof store.data.meta === 'object'
    ? store.data.meta
    : (store.data.meta = {});
  if (!meta.rtlSync || typeof meta.rtlSync !== 'object') meta.rtlSync = { ids: [], last: null };
  if (!Array.isArray(meta.rtlSync.ids)) meta.rtlSync.ids = [];
  const snapshotId = String(info.id || '').trim();
  if (snapshotId && meta.rtlSync.ids.includes(snapshotId)) {
    return { ok: true, skipped: true, snapshotId, unique: 0, duplicate: 0, rejected: 0, movements: 0 };
  }
  const stock = meta.rtlStock && typeof meta.rtlStock === 'object' ? meta.rtlStock : {};
  const incoming = new Map();
  let rejected = 0;
  let duplicate = 0;
  (vehicles || []).forEach((row) => {
    const vin = normVin(row && row.vin);
    if (!vin) {
      rejected += 1;
      return;
    }
    if (incoming.has(vin)) {
      duplicate += 1;
      return;
    }
    incoming.set(vin, row);
  });
  const movements = [];
  const at = info.at || new Date().toISOString();
  incoming.forEach((row, vin) => {
    const prev = stock[vin] || {};
    const next = classifyRtlRow(prev, row, { printed: printedVin(store, vin), fileDate: info.date });
    next.snapshotId = snapshotId;
    next.updatedAt = at;
    stock[vin] = next;
    const vehicle = store.getVehicle(vin);
    if (vehicle) {
      if (!vehicle.ops) vehicle.ops = {};
      vehicle.ops.rtlLocation = next.location;
      vehicle.ops.rtlSearchArea = next.searchArea;
      vehicle.ops.rtlStockClass = next.stockClass;
      vehicle.ops.rtlSnapshotId = snapshotId;
      store.upsertVehicle(vin, vehicle);
    }
    if ((prev.location || '') !== next.location || (prev.stockClass || '') !== next.stockClass) {
      movements.push({
        vin,
        at,
        snapshotId,
        previousLocation: prev.location || '',
        currentLocation: next.location,
        previousStatus: prev.stockClass || '',
        currentStatus: next.stockClass,
        reason: next.reason,
      });
    }
  });
  Object.keys(stock).forEach((vin) => {
    if (incoming.has(vin)) return;
    const prev = stock[vin];
    if (!prev || prev.stockClass === 'MISSING FROM RTL') return;
    const printed = printedVin(store, vin) || prev.stockClass === 'WITH DELIVERY NOTE';
    const nextClass = printed ? 'WITH DELIVERY NOTE' : 'MISSING FROM RTL';
    stock[vin] = {
      ...prev,
      stockClass: nextClass,
      missing: !printed,
      snapshotId,
      updatedAt: at,
      reason: printed
        ? 'Missing from the latest RTL. The saved delivery note is kept.'
        : 'Missing from the latest RTL. History is kept.',
    };
    movements.push({
      vin,
      at,
      snapshotId,
      previousLocation: prev.location || '',
      currentLocation: prev.location || '',
      previousStatus: prev.stockClass || '',
      currentStatus: nextClass,
      reason: stock[vin].reason,
    });
  });
  meta.rtlStock = stock;
  meta.rtlMovements = (Array.isArray(meta.rtlMovements) ? meta.rtlMovements : []).concat(movements).slice(-8000);
  if (snapshotId) meta.rtlSync.ids = meta.rtlSync.ids.concat(snapshotId).slice(-200);
  const summary = {
    ok: true,
    skipped: false,
    snapshotId,
    at,
    fileName: info.fileName || '',
    processed: (vehicles || []).length,
    unique: incoming.size,
    matched: movements.filter((m) => m.previousStatus).length,
    duplicate,
    rejected,
    movements: movements.length,
    errors: [],
  };
  meta.rtlSync.last = summary;
  if (typeof store.pushAudit === 'function') {
    store.pushAudit({
      vin: '',
      user: 'RTL',
      action: 'rtl_sync',
      oldValue: snapshotId,
      newValue: `unique ${summary.unique} · duplicate ${duplicate} · rejected ${rejected} · movements ${movements.length}`,
    });
  }
  if (typeof store.save === 'function') store.save();
  return summary;
}

function markDeliveryNote(store, vin) {
  const key = normVin(vin);
  const stock = store.data.meta && store.data.meta.rtlStock;
  if (!stock || !stock[key]) return;
  stock[key].stockClass = 'WITH DELIVERY NOTE';
  stock[key].reason = 'A delivery note is saved. The VIN stays out of available stock and is not physically delivered by the note alone.';
  stock[key].missing = false;
}

module.exports = {
  RUBA_ID,
  normVin,
  locationRuleApplies,
  isSpecialStockLocation,
  classifyRtlRow,
  applyRtlPush,
  markDeliveryNote,
};
