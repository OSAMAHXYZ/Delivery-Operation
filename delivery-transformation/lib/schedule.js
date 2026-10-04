'use strict';

/**
 * VIN schedule / SLA engine.
 * Day 1 is always that VIN's Proforma Date — never the calendar day of the month.
 * Hour-based SLA conditions live in ./sla-engine (admin-controlled).
 */

const { USERS } = require('./constants');
const slaEngine = require('./sla-engine');

const DEFAULT_SLA = Object.freeze([
  { id: 'psfu', label: 'PSFU', statuses: ['PSFU'], targetDay: 5, enabled: true },
  { id: 'claimed', label: 'CLAIMED', statuses: ['Claimed'], targetDay: 5, enabled: true },
  { id: 'registration', label: 'REGISTRATION', statuses: ['مرور'], dateField: 'registrationIssueDate', targetDay: 6, enabled: true },
  { id: 'center', label: 'CENTER ARRIVAL', statuses: ['جاهز للتسليم'], targetDay: 7, enabled: true },
  { id: 'delivered', label: 'DELIVERED', statuses: ['تم التسليم'], targetDay: 8, enabled: true },
]);

/** Collector entry-accuracy board — fixed roster */
const ENTRY_ACCURACY_IDS = Object.freeze([
  'alfadel', 'albara', 'ruba', 'hanouf', 'ibrahim', 'abdullah', 'rasha',
]);

/** Live Sheet fields that count toward entry accuracy (empty = missing) */
const ENTRY_CHECK_FIELDS = Object.freeze([
  'opsStatus',
  'guestSentDate',
  'signatureReceivedDate',
  'accountsSentDate',
  'accountsApprovalDate',
  'vin1502',
  'trafficFile',
  'trafficFeesOps',
  'insuranceOps',
  'registrationIssueDate',
  'transferCity',
  'carrier',
  'guestCenter',
]);

const ENTRY_FIELD_LABELS = Object.freeze({
  opsStatus: 'Status',
  guestSentDate: 'Guest sent',
  signatureReceivedDate: 'Signature received',
  accountsSentDate: 'Accounts sent',
  accountsApprovalDate: 'Accounts approval',
  vin1502: 'VIN 1502',
  trafficFile: 'Traffic file',
  trafficFeesOps: 'Traffic fees',
  insuranceOps: 'Insurance',
  registrationIssueDate: 'Registration date',
  transferCity: 'Transfer city',
  carrier: 'Carrier',
  guestCenter: 'Guest Exp',
});

function dayKey(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function addDays(key, n) {
  const k = dayKey(key);
  if (!k) return '';
  const [y, mo, d] = k.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + Number(n || 0)));
  return dt.toISOString().slice(0, 10);
}

function diffDays(from, to) {
  const a = dayKey(from);
  const b = dayKey(to);
  if (!a || !b) return null;
  const [ay, amo, ad] = a.split('-').map(Number);
  const [by, bmo, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bmo - 1, bd) - Date.UTC(ay, amo - 1, ad)) / 86400000);
}

function actualDays(proforma, when) {
  const d = diffDays(proforma, when);
  return d == null ? null : d + 1;
}

function cloneSla(list) {
  return JSON.parse(JSON.stringify(list || DEFAULT_SLA));
}

function normalizeSla(input) {
  const base = cloneSla(DEFAULT_SLA);
  if (!Array.isArray(input) || !input.length) return base;
  const byId = new Map(input.map((x) => [x && x.id, x]));
  return base.map((item) => {
    const src = byId.get(item.id) || {};
    const day = Math.round(Number(src.targetDay));
    return {
      ...item,
      label: String(src.label || item.label).trim() || item.label,
      targetDay: Number.isFinite(day) && day >= 1 ? Math.min(60, day) : item.targetDay,
      enabled: src.enabled === false ? false : true,
      statuses: Array.isArray(src.statuses) && src.statuses.length
        ? src.statuses.map((s) => String(s || '').trim()).filter(Boolean)
        : item.statuses,
      dateField: src.dateField || item.dateField || '',
    };
  });
}

function recordStatusEnter(ops, status, at, by) {
  return slaEngine.recordStatusEnter(ops, status, at, by);
}

function recordStatusTransition(ops, previousStatus, newStatus, at, by) {
  return slaEngine.recordStatusTransition(ops, previousStatus, newStatus, at, by);
}

function backfillFromAudit(vehicle, auditRows) {
  if (!vehicle || !vehicle.ops) return;
  if (!Array.isArray(vehicle.ops.statusHistory)) vehicle.ops.statusHistory = [];
  const rows = (auditRows || [])
    .filter((a) => a && a.action === 'update' && String(a.newValue || '').startsWith('opsStatus:'))
    .slice()
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  rows.forEach((a) => {
    const status = String(a.newValue || '').replace(/^opsStatus:\s*/, '').trim();
    if (status && status !== '(empty)') recordStatusEnter(vehicle.ops, status, a.at);
  });
  if (vehicle.ops.opsStatus) {
    recordStatusEnter(
      vehicle.ops,
      vehicle.ops.opsStatus,
      vehicle.ops.updatedAt || vehicle.ops.assignedAt || new Date().toISOString(),
    );
  }
}

function firstAchievedAt(vehicle, sla, auditRows) {
  const statuses = new Set((sla.statuses || []).map((s) => s.toLowerCase()));
  const hist = (vehicle.ops && vehicle.ops.statusHistory) || [];
  const fromHist = hist
    .filter((h) => h && statuses.has(String(h.status || '').toLowerCase()))
    .map((h) => dayKey(h.at))
    .filter(Boolean)
    .sort();
  if (fromHist[0]) return { at: fromHist[0], source: 'history' };

  if (sla.dateField && vehicle.ops) {
    const fieldDay = dayKey(vehicle.ops[sla.dateField]);
    if (fieldDay) return { at: fieldDay, source: sla.dateField };
  }

  const fromAudit = (auditRows || [])
    .filter((a) => a && a.action === 'update' && String(a.newValue || '').startsWith('opsStatus:'))
    .map((a) => {
      const status = String(a.newValue || '').replace(/^opsStatus:\s*/, '').trim();
      return { status, at: dayKey(a.at) };
    })
    .filter((x) => x.at && statuses.has(x.status.toLowerCase()))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (fromAudit[0]) return { at: fromAudit[0].at, source: 'audit' };

  const current = String((vehicle.ops && vehicle.ops.opsStatus) || '').trim();
  if (current && statuses.has(current.toLowerCase())) {
    const fallback = dayKey((vehicle.ops && (vehicle.ops.updatedAt || vehicle.ops.assignedAt)) || '');
    if (fallback) return { at: fallback, source: 'inferred' };
  }
  return { at: '', source: '' };
}

function classify({ proforma, targetDay, actualAt, today }) {
  const targetDate = addDays(proforma, targetDay - 1);
  if (!proforma || !targetDate) {
    return {
      result: 'NO DATA',
      zone: 'empty',
      targetDate: '',
      actualAt: '',
      actualDays: null,
      label: 'No Proforma Date',
      daysLate: null,
      daysRemaining: null,
    };
  }
  if (actualAt) {
    const days = actualDays(proforma, actualAt);
    const late = diffDays(targetDate, actualAt);
    if (late > 0) {
      return {
        result: 'LATE',
        zone: 'red',
        targetDate,
        actualAt,
        actualDays: days,
        label: `${late} day${late === 1 ? '' : 's'} late`,
        daysLate: late,
        daysRemaining: 0,
      };
    }
    if (late === 0) {
      return {
        result: 'ON TIME',
        zone: 'green',
        targetDate,
        actualAt,
        actualDays: days,
        label: `Day ${days}`,
        daysLate: 0,
        daysRemaining: 0,
      };
    }
    return {
      result: 'ON TRACK',
      zone: 'green',
      targetDate,
      actualAt,
      actualDays: days,
      label: `Day ${days}`,
      daysLate: 0,
      daysRemaining: Math.abs(late),
    };
  }
  const remain = diffDays(today, targetDate);
  if (remain > 0) {
    return {
      result: 'PENDING',
      zone: 'green',
      targetDate,
      actualAt: '',
      actualDays: null,
      label: `${remain} day${remain === 1 ? '' : 's'} remaining`,
      daysLate: null,
      daysRemaining: remain,
    };
  }
  if (remain === 0) {
    return {
      result: 'DUE TODAY',
      zone: 'green',
      targetDate,
      actualAt: '',
      actualDays: null,
      label: 'Due today',
      daysLate: 0,
      daysRemaining: 0,
    };
  }
  const overdue = Math.abs(remain);
  return {
    result: 'LATE',
    zone: 'red',
    targetDate,
    actualAt: '',
    actualDays: null,
    label: `${overdue} day${overdue === 1 ? '' : 's'} overdue`,
    daysLate: overdue,
    daysRemaining: 0,
  };
}

function computeVinSla(vehicle, sla, today, auditRows) {
  const proforma = dayKey(vehicle.raw && vehicle.raw.proformaDate);
  const hit = firstAchievedAt(vehicle, sla, auditRows);
  const row = classify({
    proforma,
    targetDay: sla.targetDay,
    actualAt: hit.at,
    today,
  });
  return {
    slaId: sla.id,
    slaLabel: sla.label,
    targetDay: sla.targetDay,
    proforma,
    source: hit.source,
    vin: vehicle.vin,
    employee: (vehicle.ops && vehicle.ops.assignedEmployeeName) || '',
    status: (vehicle.ops && vehicle.ops.opsStatus) || '',
    ...row,
  };
}

function computeDashboard({ vehicles, slaItems, slaControl: slaControlRaw, today, month, audit, now }) {
  const items = normalizeSla(slaItems).filter((s) => s.enabled);
  const auditByVin = {};
  (audit || []).forEach((a) => {
    const vin = String((a && a.vin) || '').trim().toUpperCase();
    if (!vin) return;
    if (!auditByVin[vin]) auditByVin[vin] = [];
    auditByVin[vin].push(a);
  });

  const pool = (vehicles || []).filter((v) => {
    const p = dayKey(v.raw && v.raw.proformaDate);
    if (!p) return false;
    if (month && p.slice(0, 7) !== month) return false;
    return true;
  });

  const bySla = items.map((sla) => {
    const rows = pool.map((v) => {
      backfillFromAudit(v, auditByVin[v.vin] || []);
      return computeVinSla(v, sla, today, auditByVin[v.vin] || []);
    });
    const green = rows.filter((r) => r.zone === 'green').length;
    const red = rows.filter((r) => r.zone === 'red').length;
    const onTime = rows.filter((r) => r.result === 'ON TIME').length;
    const onTrack = rows.filter((r) => r.result === 'ON TRACK').length;
    const pending = rows.filter((r) => r.result === 'PENDING' || r.result === 'DUE TODAY').length;
    const late = rows.filter((r) => r.result === 'LATE').length;
    return {
      id: sla.id,
      label: sla.label,
      targetDay: sla.targetDay,
      statuses: sla.statuses,
      total: rows.length,
      green,
      red,
      onTime,
      onTrack,
      pending,
      late,
      rows,
    };
  });

  const focus = bySla[0] || { total: 0, green: 0, red: 0 };
  const slaControl = slaEngine.readControl({
    slaControl: slaControlRaw,
    sla: slaItems,
  });
  const nowIso = now || new Date().toISOString();
  const controlEval = slaEngine.evaluatePool(pool, slaControl, nowIso, { month });
  const calendar = computeVsndCalendar({
    vehicles: vehicles || [],
    today,
    month,
    slaItems: items,
    slaControl,
    now: nowIso,
  });
  if (calendar && calendar.analytics) {
    calendar.analytics.entryAccuracy = computeEntryAccuracy({
      vehicles: vehicles || [],
      audit: audit || [],
      month,
    });
  }
  return {
    today,
    month,
    noProforma: (vehicles || []).filter((v) => {
      const p = dayKey(v.raw && v.raw.proformaDate);
      if (p) return false;
      if (!month) return true;
      return String((v.raw && v.raw.date) || (v.ops && v.ops.assignedAt) || '').slice(0, 7) === month;
    }).length,
    totals: {
      vins: pool.length,
      green: bySla.reduce((s, x) => s + x.green, 0),
      red: bySla.reduce((s, x) => s + x.red, 0),
    },
    controlCenter: controlEval.kpis,
    conditionRows: controlEval.rows,
    slaControl,
    sla: bySla,
    focusId: focus.id || '',
    calendar,
  };
}

/** Status × calendar-day grid (VSND Schedule) — Proforma day of month × current ops status. */
const VSND_ROWS = Object.freeze([
  { status: 'Claimed', label: 'CLAIMED', tone: 'claimed', icon: '✓' },
  { status: 'PSFU', label: 'PSFU', tone: 'psfu', icon: '🚚' },
  { status: 'تم التسليم', label: 'تم التسليم', tone: 'delivered', icon: '🚗' },
  { status: 'جاهز للتسليم', label: 'جاهز للتسليم', tone: 'ready', icon: '📦' },
  { status: 'تسليم متقدم', label: 'تسليم متقدم', tone: 'advance', icon: '🚐' },
  { status: 'صادرة', label: 'صادر', tone: 'issued', icon: '📋' },
  { status: 'مرور', label: 'مرور', tone: 'traffic', icon: '📄' },
  { status: 'بطاقة', label: 'بطاقة', tone: 'card', icon: '🪪' },
  { status: 'فسح', label: 'فسح', tone: 'clearance', icon: '🏢' },
  { status: 'معلقة', label: 'معلقة', tone: 'hold', icon: '⏸' },
  { status: 'الغاء', label: 'الغاء', tone: 'cancel', icon: '✕' },
]);

function daysInMonth(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return 31;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

function weekdayShort(ym, day) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day));
  return dt.toLocaleString('en', { weekday: 'short', timeZone: 'UTC' });
}

function computeVsndCalendar({ vehicles, today, month, slaItems, slaControl, now }) {
  const ym = month || String(today || '').slice(0, 7);
  const days = daysInMonth(ym);
  const todayDay = String(today || '').slice(0, 7) === ym
    ? Number(String(today).slice(8, 10))
    : days;
  const psfuSla = (slaItems || []).find((s) => s.id === 'psfu') || { targetDay: 5 };
  const psfuTarget = Number(psfuSla.targetDay) || 5;
  const control = slaControl || slaEngine.readControl({ sla: slaItems });
  const nowIso = now || new Date().toISOString();

  const rows = VSND_ROWS.map((meta) => ({
    ...meta,
    days: Array.from({ length: days }, () => 0),
    zones: Array.from({ length: days }, () => 'empty'),
    total: 0,
  }));
  const byStatus = new Map(rows.map((r) => [r.status, r]));
  const dayTotals = Array.from({ length: days }, () => 0);
  const seenDelivered = new Set();
  const seenVsnd = new Set();
  const seenGrid = new Set();
  let delivered = 0;
  let notDelivered = 0;
  const vinIndex = [];

  (vehicles || []).forEach((v) => {
    const vinKey = String((v && v.vin) || '').trim().toUpperCase();
    const p = dayKey(v.raw && v.raw.proformaDate);
    const inv = dayKey(v.raw && v.raw.invoiceDate);
    const status = String((v.ops && v.ops.opsStatus) || '').trim();

    if (inv && inv.slice(0, 7) === ym) {
      if (vinKey && !seenDelivered.has(vinKey)) {
        seenDelivered.add(vinKey);
        delivered += 1;
      }
    }

    const isVsnd = !!(p && p.slice(0, 7) === ym && !inv);
    if (isVsnd && vinKey && !seenVsnd.has(vinKey)) {
      seenVsnd.add(vinKey);
      notDelivered += 1;
    }

    if (!p || p.slice(0, 7) !== ym) return;
    const day = Number(p.slice(8, 10));
    if (!day || day < 1 || day > days) return;

    // Unique VIN once on the schedule grid
    if (vinKey) {
      if (seenGrid.has(vinKey)) return;
      seenGrid.add(vinKey);
    }

    const row = byStatus.get(status);
    const evalRow = slaEngine.evaluateVin(v, control, nowIso);
    const entry = {
      vin: v.vin,
      employee: (v.ops && v.ops.assignedEmployeeName) || '',
      status,
      proforma: p,
      invoiceDate: inv || '',
      day,
      product: (v.raw && v.raw.product) || '',
      city: String((v.ops && (v.ops.transferCity || v.ops.coordinatorPrintCity)) || '').trim(),
      isVsnd,
      isDelivered: !!inv,
      statusChangedAt: evalRow.statusChangedAt,
      statusAgeHours: evalRow.statusAgeHours,
      slaWarning: evalRow.slaWarning,
      slaBreach: evalRow.slaBreach,
      condition: evalRow.condition,
      conditionLabel: evalRow.conditionLabel,
      zone: evalRow.zone,
      deliveryDueDate: evalRow.deliveryDueDate,
      deliveryDate: evalRow.deliveryDate,
      deliverySlaResult: evalRow.deliverySlaResult,
    };
    vinIndex.push(entry);
    if (!row) return;
    row.days[day - 1] += 1;
    row.total += 1;
    dayTotals[day - 1] += 1;
    const cellZones = row._cellZones || (row._cellZones = Array.from({ length: days }, () => []));
    cellZones[day - 1].push(evalRow.zone);
  });

  const dayHeaders = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    weekday: weekdayShort(ym, i + 1),
    future: i + 1 > todayDay,
  }));

  const analytics = buildVsndAnalytics({
    vehicles: vehicles || [],
    ym,
    today,
    todayDay,
    days,
    psfuTarget,
    rows,
  });

  const gridTotal = dayTotals.reduce((s, n) => s + n, 0);

  return {
    month: ym,
    today,
    todayDay,
    days,
    dayHeaders,
    psfuTarget,
    delivered,
    notDelivered,
    grandTotal: gridTotal,
    dayTotals,
    rows: rows.map((r) => {
      const zones = r.days.map((n, i) => {
        const day = i + 1;
        if (day > todayDay) return 'future';
        if (!n) {
          // empty future-relative day styling from legacy PSFU day bands
          if (day < psfuTarget) return 'ok';
          if (day === psfuTarget) return 'due';
          return 'late';
        }
        const cellList = (r._cellZones && r._cellZones[i]) || [];
        const worst = slaEngine.worstZone(cellList);
        if (worst === 'red') return 'late';
        if (worst === 'yellow') return 'due';
        if (worst === 'green') return 'ok';
        if (worst === 'grey') return 'future';
        return 'ok';
      });
      return {
        status: r.status,
        label: r.label,
        tone: r.tone,
        icon: r.icon,
        days: r.days,
        zones,
        total: r.total,
      };
    }),
    vins: vinIndex,
    analytics,
  };
}

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function parseAuditFieldChange(value) {
  const s = String(value || '');
  const m = s.match(/^([^:]+):\s*([\s\S]*)$/);
  if (!m) return null;
  return { field: m[1].trim(), value: m[2].trim() };
}

function findAccuracyUser(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return USERS.find((u) => ENTRY_ACCURACY_IDS.includes(u.id) && u.name.toLowerCase() === key) || null;
}

/**
 * Entry accuracy /100 per named user.
 * Uses assigned + audit-touched VINs for the month; empty Live Sheet fields = missing.
 * Audit clears to (empty) also count as missing signals when the field is still blank.
 */
function computeEntryAccuracy({ vehicles, audit, month }) {
  const roster = ENTRY_ACCURACY_IDS
    .map((id) => USERS.find((u) => u.id === id))
    .filter(Boolean);

  const vinMap = new Map();
  (vehicles || []).forEach((v) => {
    if (!v || !v.vin) return;
    vinMap.set(String(v.vin).toUpperCase(), v);
  });

  const touched = new Map(roster.map((u) => [u.id, new Set()]));
  const clearHits = new Map(roster.map((u) => [u.id, []]));

  (vehicles || []).forEach((v) => {
    const p = dayKey(v.raw && v.raw.proformaDate);
    if (month && (!p || p.slice(0, 7) !== month)) return;
    const vin = String(v.vin || '').toUpperCase();
    if (!vin) return;
    const empId = String((v.ops && v.ops.assignedEmployeeId) || '').toLowerCase();
    if (touched.has(empId)) touched.get(empId).add(vin);
    const updater = findAccuracyUser(v.ops && v.ops.updatedBy);
    if (updater) touched.get(updater.id).add(vin);
  });

  (audit || []).forEach((a) => {
    if (!a || a.action !== 'update') return;
    const u = findAccuracyUser(a.user);
    if (!u) return;
    const atMonth = String(a.at || '').slice(0, 7);
    const vin = String(a.vin || '').toUpperCase();
    const v = vin ? vinMap.get(vin) : null;
    const p = v ? dayKey(v.raw && v.raw.proformaDate) : '';
    const inMonthVin = !!(month && p && p.slice(0, 7) === month);
    const inMonthAudit = !!(month && atMonth === month);
    if (month && !inMonthVin && !inMonthAudit) return;
    if (vin) touched.get(u.id).add(vin);

    const parsed = parseAuditFieldChange(a.newValue);
    if (
      parsed
      && ENTRY_CHECK_FIELDS.includes(parsed.field)
      && (!parsed.value || parsed.value === '(empty)')
    ) {
      clearHits.get(u.id).push({
        vin,
        field: parsed.field,
        label: ENTRY_FIELD_LABELS[parsed.field] || parsed.field,
        at: a.at || '',
      });
    }
  });

  const users = roster.map((u) => {
    let filled = 0;
    let missing = 0;
    const gaps = [];
    const vinList = [];

    touched.get(u.id).forEach((vin) => {
      const v = vinMap.get(vin);
      if (!v) return;
      const p = dayKey(v.raw && v.raw.proformaDate);
      if (month && (!p || p.slice(0, 7) !== month)) return;
      const rowGaps = [];
      const status = String((v.ops && v.ops.opsStatus) || '').trim();
      if (!status) {
        missing += 1;
        rowGaps.push({ field: 'opsStatus', label: ENTRY_FIELD_LABELS.opsStatus });
      } else {
        filled += 1;
        ENTRY_CHECK_FIELDS.forEach((field) => {
          if (field === 'opsStatus') return;
          const val = String((v.ops && v.ops[field]) || '').trim();
          if (val) {
            filled += 1;
          } else {
            missing += 1;
            rowGaps.push({
              field,
              label: ENTRY_FIELD_LABELS[field] || field,
            });
          }
        });
      }
      vinList.push({
        vin,
        missing: rowGaps.length,
        gaps: rowGaps,
        status,
      });
      rowGaps.forEach((g) => gaps.push({ vin, ...g }));
    });

    // Audit clears that emptied a field still blank — already in gaps; track count for UI
    const clears = (clearHits.get(u.id) || []).filter((c) => {
      const v = vinMap.get(c.vin);
      if (!v) return true;
      return !String((v.ops && v.ops[c.field]) || '').trim();
    });

    const slots = filled + missing;
    const score = slots ? Math.round((filled / slots) * 100) : 100;

    return {
      id: u.id,
      name: u.name,
      score,
      filled,
      missing,
      vins: vinList.length,
      rows: vinList.filter((r) => r.missing > 0).slice(0, 60),
      gaps: gaps.slice(0, 80),
      clears: clears.slice(0, 40),
      color: score >= 90 ? '#22c55e' : score >= 70 ? '#eab308' : '#ef4444',
    };
  });

  const withWork = users.filter((u) => u.vins > 0);
  const avg = withWork.length
    ? Math.round(withWork.reduce((s, u) => s + u.score, 0) / withWork.length)
    : 100;

  return {
    month: month || '',
    avg,
    totalMissing: users.reduce((s, u) => s + u.missing, 0),
    users,
  };
}

function buildVsndAnalytics({ vehicles, ym, today, todayDay, days, psfuTarget, rows }) {
  const vsnd = [];
  const deliveredByDay = new Map();
  const vsndByDay = new Map();
  const seenDel = new Set();
  const seenVsnd = new Set();

  (vehicles || []).forEach((v) => {
    const vinKey = String((v && v.vin) || '').trim().toUpperCase();
    const p = dayKey(v.raw && v.raw.proformaDate);
    const inv = dayKey(v.raw && v.raw.invoiceDate);
    const status = String((v.ops && v.ops.opsStatus) || '').trim();
    const city = String((v.ops && (v.ops.transferCity || v.ops.coordinatorPrintCity)) || '').trim() || 'Other';
    const employee = String((v.ops && v.ops.assignedEmployeeName) || '').trim() || 'Unassigned';

    // Last-7 delivered bars: Col V day in month
    if (inv && inv.slice(0, 7) === ym) {
      const d = Number(inv.slice(8, 10));
      if (d && (!vinKey || !seenDel.has(`${vinKey}:${d}`))) {
        if (vinKey) seenDel.add(`${vinKey}:${d}`);
        deliveredByDay.set(d, (deliveredByDay.get(d) || 0) + 1);
      }
    }

    // VSND pool + last-7 VSND bars: Col P in month · Col V empty
    if (!(p && p.slice(0, 7) === ym && !inv)) return;
    const day = Number(p.slice(8, 10));
    if (vinKey) {
      if (seenVsnd.has(vinKey)) return;
      seenVsnd.add(vinKey);
    }
    const age = day && todayDay ? (todayDay - day + 1) : null;
    vsndByDay.set(day, (vsndByDay.get(day) || 0) + 1);
    vsnd.push({
      vin: v.vin,
      status,
      day,
      age,
      city,
      employee,
      delivered: false,
      proforma: p,
    });
  });

  const statusColors = {
    Claimed: '#0d6b3c',
    PSFU: '#1769a8',
    'تم التسليم': '#16a34a',
    'جاهز للتسليم': '#ca8a04',
    'تسليم متقدم': '#ea580c',
    'صادرة': '#7c3aed',
    'مرور': '#0284c7',
    'بطاقة': '#e11d48',
    'فسح': '#0f766e',
    'معلقة': '#64748b',
    'الغاء': '#eb0a1e',
  };

  const byStatusAll = (rows || [])
    .map((r) => ({
      status: r.status,
      label: r.label,
      count: r.total,
      color: statusColors[r.status] || '#64748b',
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  const vsndStatusMap = new Map();
  vsnd.forEach((v) => {
    const key = v.status || '(blank)';
    vsndStatusMap.set(key, (vsndStatusMap.get(key) || 0) + 1);
  });
  const vsndTotal = vsnd.length;
  const byStatusVsnd = [...vsndStatusMap.entries()]
    .map(([status, count]) => {
      const meta = VSND_ROWS.find((r) => r.status === status);
      return {
        status,
        label: meta ? meta.label : status,
        count,
        pct: pct(count, vsndTotal),
        color: statusColors[status] || '#64748b',
      };
    })
    .sort((a, b) => b.count - a.count);

  let onTrack = 0;
  let dueToday = 0;
  let late = 0;
  const agingBuckets = [
    { id: 'd12', label: '1-2 Days', min: 1, max: 2, count: 0, color: '#22c55e' },
    { id: 'd34', label: '3-4 Days', min: 3, max: 4, count: 0, color: '#84cc16' },
    { id: 'd5', label: '5 Days', min: 5, max: 5, count: 0, color: '#eab308' },
    { id: 'd67', label: '6-7 Days', min: 6, max: 7, count: 0, color: '#f97316' },
    { id: 'd8', label: '8+ Days', min: 8, max: 999, count: 0, color: '#ef4444' },
  ];
  vsnd.forEach((v) => {
    const age = v.age == null ? 999 : v.age;
    if (age < psfuTarget) onTrack += 1;
    else if (age === psfuTarget) dueToday += 1;
    else late += 1;
    const bucket = agingBuckets.find((b) => age >= b.min && age <= b.max);
    if (bucket) bucket.count += 1;
    else agingBuckets[agingBuckets.length - 1].count += 1;
  });

  const last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = todayDay - i;
    if (d < 1 || d > days) continue;
    const [y, m] = ym.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    last7.push({
      day: d,
      label: dt.toLocaleString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      delivered: deliveredByDay.get(d) || 0,
      vsnd: vsndByDay.get(d) || 0,
    });
  }

  const byEmployeeMap = new Map();
  vsnd.forEach((v) => {
    byEmployeeMap.set(v.employee, (byEmployeeMap.get(v.employee) || 0) + 1);
  });
  const byEmployee = [...byEmployeeMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const byRegionMap = new Map();
  vsnd.forEach((v) => {
    byRegionMap.set(v.city, (byRegionMap.get(v.city) || 0) + 1);
  });
  const regionColors = ['#1769a8', '#0d6b3c', '#7c3aed', '#ea580c', '#0f766e', '#64748b', '#e11d48'];
  const byRegion = [...byRegionMap.entries()]
    .map(([name, count], i) => ({
      name,
      count,
      pct: pct(count, vsndTotal),
      color: regionColors[i % regionColors.length],
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    vsndTotal,
    byStatusVsnd,
    topStatus: byStatusAll.slice(0, 5),
    last7,
    aging: {
      onTrack: { count: onTrack, pct: pct(onTrack, vsndTotal), label: `On Track (1-${psfuTarget - 1} days)` },
      dueToday: { count: dueToday, pct: pct(dueToday, vsndTotal), label: `Due Today (Day ${psfuTarget})` },
      late: { count: late, pct: pct(late, vsndTotal), label: `Late (${psfuTarget + 1}+ days)` },
    },
    agingDist: agingBuckets.map((b) => ({ ...b, pct: pct(b.count, vsndTotal) })),
    byEmployee,
    byRegion,
  };
}

module.exports = {
  DEFAULT_SLA,
  VSND_ROWS,
  ENTRY_ACCURACY_IDS,
  ENTRY_CHECK_FIELDS,
  dayKey,
  addDays,
  diffDays,
  actualDays,
  normalizeSla,
  recordStatusEnter,
  recordStatusTransition,
  backfillFromAudit,
  computeVinSla,
  computeEntryAccuracy,
  computeDashboard,
  computeVsndCalendar,
  slaEngine,
};
