'use strict';

/**
 * Company performance: coordinator assignment → Hanouf Sales Raw sales date.
 *
 * Assignment source: ops.coordinatorPrintCompany + ops.coordinatorPrintedAt
 * Sales source: meta.hanoufSalesByVin (Sales Raw uploads by Hanouf only)
 */

const HANOUF_IDS = new Set(['hanouf']);
const HANOUF_NAMES = new Set(['hanouf', 'حنوف']);

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function dayKey(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function diffCalendarDays(from, to) {
  const a = dayKey(from);
  const b = dayKey(to);
  if (!a || !b) return null;
  const [ay, amo, ad] = a.split('-').map(Number);
  const [by, bmo, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bmo - 1, bd) - Date.UTC(ay, amo - 1, ad)) / 86400000);
}

function isHanoufUser(user) {
  if (!user) return false;
  const id = String(user.id || '').trim().toLowerCase();
  const name = String(user.name || '').trim().toLowerCase();
  return HANOUF_IDS.has(id) || HANOUF_NAMES.has(name);
}

/**
 * Persist Hanouf Sales Raw invoice dates by VIN (unique key).
 * Call only when the uploader is Hanouf.
 */
function recordHanoufSalesRaw(store, items, meta) {
  if (!store || !store.data) return;
  if (!store.data.meta || typeof store.data.meta !== 'object') store.data.meta = {};
  if (!store.data.meta.hanoufSalesByVin || typeof store.data.meta.hanoufSalesByVin !== 'object') {
    store.data.meta.hanoufSalesByVin = {};
  }
  const map = store.data.meta.hanoufSalesByVin;
  const at = (meta && meta.at) || new Date().toISOString();
  const filename = (meta && meta.filename) || '';
  let saved = 0;
  (items || []).forEach((item) => {
    const vin = normVin(item && item.vin);
    if (!vin) return;
    const salesDate = dayKey(item.raw && item.raw.invoiceDate);
    if (!salesDate) return;
    const prev = map[vin];
    // Earliest valid sales date wins if already present (stable KPI)
    if (prev && prev.salesDate && prev.salesDate <= salesDate) {
      map[vin] = {
        ...prev,
        updatedAt: at,
        filename: filename || prev.filename || '',
        multiMatch: true,
      };
      return;
    }
    map[vin] = {
      salesDate,
      updatedAt: at,
      filename,
      multiMatch: !!(prev && prev.salesDate && prev.salesDate !== salesDate),
    };
    saved += 1;
  });
  return saved;
}

function getHanoufSalesMap(store) {
  const map = (store && store.data && store.data.meta && store.data.meta.hanoufSalesByVin) || {};
  return map && typeof map === 'object' ? map : {};
}

/**
 * One-time bootstrap: if Hanouf's index is empty but last Sales Raw upload
 * was by Hanouf, seed from Live Sheet invoice dates (historical catch-up).
 */
function bootstrapHanoufSalesFromLiveSheet(store) {
  if (!store || !store.data) return false;
  if (!store.data.meta || typeof store.data.meta !== 'object') store.data.meta = {};
  const existing = store.data.meta.hanoufSalesByVin;
  if (existing && typeof existing === 'object' && Object.keys(existing).length) return false;

  const imports = store.data.meta.imports || store.data.meta.lastSalesRaw || null;
  const last = (imports && imports.lastSalesRaw) || store.data.meta.lastSalesRaw || null;
  const by = last && (last.by || last.user || last.name);
  if (!isHanoufUser({ name: by, id: String(by || '').toLowerCase() })) return false;

  const vehicles = typeof store.allVehicles === 'function' ? store.allVehicles() : [];
  const items = vehicles.map((v) => ({
    vin: v.vin,
    raw: { invoiceDate: (v.raw && v.raw.invoiceDate) || '' },
  }));
  recordHanoufSalesRaw(store, items, {
    at: (last && last.at) || new Date().toISOString(),
    filename: (last && last.filename) || 'bootstrap-live-sheet',
  });
  return true;
}

/**
 * Unique coordinator assignments: latest memo print per VIN with a company.
 */
function collectAssignments(vehicles, { from, to } = {}) {
  const byVin = new Map();
  const quality = {
    blankVin: 0,
    warehouseSkipped: 0,
    missingCompany: 0,
    invalidAssignmentDate: 0,
    duplicateVinKeptLatest: 0,
  };

  (vehicles || []).forEach((v) => {
    const vin = normVin(v && v.vin);
    if (!vin) {
      quality.blankVin += 1;
      return;
    }
    const ops = (v && v.ops) || {};
    if (!ops.coordinatorPrintedAt) return;
    if (String(ops.coordinatorPrintKind || '') === 'warehouse') {
      quality.warehouseSkipped += 1;
      return;
    }
    const company = String(ops.coordinatorPrintCompany || '').trim();
    if (!company) {
      quality.missingCompany += 1;
      return;
    }
    const assignmentDate = dayKey(ops.coordinatorPrintedAt);
    if (!assignmentDate) {
      quality.invalidAssignmentDate += 1;
      return;
    }
    if (from && assignmentDate < from) return;
    if (to && assignmentDate > to) return;

    const row = {
      vin,
      company,
      assignmentDate,
      assignmentAt: ops.coordinatorPrintedAt,
      printedBy: ops.coordinatorPrintedBy || '',
      city: ops.coordinatorPrintCity || ops.transferCity || '',
    };
    const prev = byVin.get(vin);
    if (prev) {
      quality.duplicateVinKeptLatest += 1;
      // Prefer latest assignment event
      if (String(row.assignmentAt) >= String(prev.assignmentAt)) byVin.set(vin, row);
    } else {
      byVin.set(vin, row);
    }
  });

  return { byVin, quality };
}

function matchSales(assignment, hanoufMap) {
  const entry = hanoufMap[assignment.vin];
  if (!entry || !entry.salesDate) {
    return {
      salesDate: null,
      daysToSales: null,
      status: 'PENDING',
      qualityFlag: null,
    };
  }
  const salesDate = dayKey(entry.salesDate);
  if (!salesDate) {
    return {
      salesDate: null,
      daysToSales: null,
      status: 'PENDING',
      qualityFlag: 'INVALID_SALES_DATE',
    };
  }
  const days = diffCalendarDays(assignment.assignmentDate, salesDate);
  if (days == null) {
    return {
      salesDate,
      daysToSales: null,
      status: 'PENDING',
      qualityFlag: 'INVALID_DURATION',
    };
  }
  if (days < 0) {
    return {
      salesDate,
      daysToSales: null,
      status: 'DATA_QUALITY',
      qualityFlag: 'SALES_BEFORE_ASSIGNMENT',
    };
  }
  return {
    salesDate,
    daysToSales: days,
    status: 'COMPLETED',
    qualityFlag: entry.multiMatch ? 'MULTI_SALES_RAW_MATCH' : null,
  };
}

const DAYS_BUCKETS = Object.freeze([
  { id: 'd0', label: '0 Days', min: 0, max: 0, color: '#16a34a' },
  { id: 'd12', label: '1-2 Days', min: 1, max: 2, color: '#22c55e' },
  { id: 'd34', label: '3-4 Days', min: 3, max: 4, color: '#84cc16' },
  { id: 'd5', label: '5 Days', min: 5, max: 5, color: '#eab308' },
  { id: 'd67', label: '6-7 Days', min: 6, max: 7, color: '#f97316' },
  { id: 'd8', label: '8+ Days', min: 8, max: 9999, color: '#ef4444' },
]);

function buildCompanyPerformance(store, opts = {}) {
  bootstrapHanoufSalesFromLiveSheet(store);
  const from = dayKey(opts.from) || '';
  const to = dayKey(opts.to) || '';
  const vehicles = typeof store.allVehicles === 'function' ? store.allVehicles() : [];
  const hanoufMap = getHanoufSalesMap(store);
  const { byVin, quality } = collectAssignments(vehicles, { from, to });

  const debugRows = [];
  const companyMap = new Map();

  byVin.forEach((asg) => {
    const match = matchSales(asg, hanoufMap);
    let bucket = null;
    if (match.status === 'COMPLETED' && match.daysToSales != null) {
      const days = match.daysToSales;
      const meta = DAYS_BUCKETS.find((b) => days >= b.min && days <= b.max) || DAYS_BUCKETS[DAYS_BUCKETS.length - 1];
      bucket = meta.label;
    }
    const row = {
      company: asg.company,
      vin: asg.vin,
      assignmentDate: asg.assignmentDate,
      salesDate: match.salesDate,
      daysToSales: match.daysToSales,
      bucket,
      status: match.status === 'COMPLETED' ? 'SOLD' : (match.status === 'DATA_QUALITY' ? 'DATA_QUALITY' : 'PENDING'),
      qualityFlag: match.qualityFlag,
      city: asg.city,
      printedBy: asg.printedBy,
    };
    debugRows.push(row);

    if (!companyMap.has(asg.company)) {
      companyMap.set(asg.company, {
        companyName: asg.company,
        totalUniqueVins: 0,
        completedVins: 0,
        pendingVins: 0,
        qualityIssues: 0,
        sumDays: 0,
        averageDaysToSales: null,
      });
    }
    const c = companyMap.get(asg.company);
    c.totalUniqueVins += 1;
    if (match.status === 'COMPLETED') {
      c.completedVins += 1;
      c.sumDays += match.daysToSales;
    } else if (match.status === 'DATA_QUALITY') {
      c.qualityIssues += 1;
      c.pendingVins += 1;
    } else {
      c.pendingVins += 1;
    }
  });

  const companies = [...companyMap.values()].map((c) => {
    const averageDaysToSales = c.completedVins > 0
      ? Math.round((c.sumDays / c.completedVins) * 10) / 10
      : null;
    return {
      companyName: c.companyName,
      totalUniqueVins: c.totalUniqueVins,
      completedVins: c.completedVins,
      pendingVins: c.pendingVins,
      qualityIssues: c.qualityIssues,
      averageDaysToSales,
    };
  }).sort((a, b) => {
    const aa = a.averageDaysToSales == null ? 9999 : a.averageDaysToSales;
    const bb = b.averageDaysToSales == null ? 9999 : b.averageDaysToSales;
    return aa - bb || b.totalUniqueVins - a.totalUniqueVins
      || a.companyName.localeCompare(b.companyName, 'ar');
  });

  const companyPerformance = {};
  companies.forEach((c) => {
    companyPerformance[c.companyName] = {
      totalUniqueVins: c.totalUniqueVins,
      completedVins: c.completedVins,
      pendingVins: c.pendingVins,
      averageDaysToSales: c.averageDaysToSales,
    };
  });

  const completed = debugRows.filter((r) => r.status === 'SOLD');
  const buckets = DAYS_BUCKETS.map((b) => ({ ...b, count: 0 }));
  completed.forEach((r) => {
    const days = r.daysToSales;
    const bucket = buckets.find((b) => days >= b.min && days <= b.max) || buckets[buckets.length - 1];
    bucket.count += 1;
  });
  const completedTotal = completed.length;
  const daysDist = buckets.map((b) => ({
    ...b,
    pct: completedTotal ? Math.round((b.count / completedTotal) * 1000) / 10 : 0,
  }));

  const fastestSale = completedTotal
    ? Math.min(...completed.map((r) => r.daysToSales))
    : null;
  const eightPlus = completed.filter((r) => r.daysToSales >= 8).length;

  const totals = {
    totalUniqueVins: debugRows.length,
    completedVins: completedTotal,
    pendingVins: debugRows.filter((r) => r.status === 'PENDING' || r.status === 'DATA_QUALITY').length,
    qualityIssues: debugRows.filter((r) => r.status === 'DATA_QUALITY').length,
    averageDaysToSales: completedTotal
      ? Math.round((completed.reduce((s, r) => s + r.daysToSales, 0) / completedTotal) * 10) / 10
      : null,
    fastestSale,
    eightPlus,
    hanoufSalesVinCount: Object.keys(hanoufMap).length,
  };

  return {
    from: from || null,
    to: to || null,
    at: new Date().toISOString(),
    totals,
    companies,
    companyPerformance,
    daysDist,
    debug: debugRows.sort((a, b) => a.company.localeCompare(b.company, 'ar') || a.vin.localeCompare(b.vin)),
    quality,
  };
}

module.exports = {
  normVin,
  dayKey,
  diffCalendarDays,
  isHanoufUser,
  recordHanoufSalesRaw,
  bootstrapHanoufSalesFromLiveSheet,
  getHanoufSalesMap,
  collectAssignments,
  buildCompanyPerformance,
  DAYS_BUCKETS,
};
