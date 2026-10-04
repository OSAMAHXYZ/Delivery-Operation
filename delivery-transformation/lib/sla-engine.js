'use strict';

/**
 * Central SLA / condition engine for Delivery Transformation.
 * Rules come from store meta (slaControl) — never hard-code breach hours in callers.
 */

const { STATUSES } = require('./constants');

const SEVERITY = Object.freeze({
  SLA_BREACHED: 1,
  NO_MOVEMENT: 2,
  DELIVERY_LATE: 3,
  DUE_TODAY: 4,
  AT_RISK: 5,
  ON_TRACK: 6,
  COMPLETED_ON_TIME: 7,
  COMPLETED_LATE: 8,
  CANCELLED: 9,
  MISSING_DATA: 10,
});

const DEFAULT_PRIORITY = Object.freeze(Object.keys(SEVERITY));

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** Default per-status SLA (hours). Admin can change / add / disable. */
const DEFAULT_STATUS_RULES = Object.freeze([
  { id: 'claimed', status: 'Claimed', warningValue: 12, breachValue: 24, noMoveWarnValue: 12, noMoveBreachValue: 24 },
  { id: 'psfu', status: 'PSFU', warningValue: 18, breachValue: 24, noMoveWarnValue: 18, noMoveBreachValue: 24 },
  { id: 'ready', status: 'جاهز للتسليم', warningValue: 24, breachValue: 48, noMoveWarnValue: 24, noMoveBreachValue: 48 },
  { id: 'advance', status: 'تسليم متقدم', warningValue: 24, breachValue: 48, noMoveWarnValue: 24, noMoveBreachValue: 48 },
  { id: 'issued', status: 'صادرة', warningValue: 24, breachValue: 48, noMoveWarnValue: 24, noMoveBreachValue: 48 },
  { id: 'traffic', status: 'مرور', warningValue: 24, breachValue: 48, noMoveWarnValue: 24, noMoveBreachValue: 48 },
  { id: 'card', status: 'بطاقة', warningValue: 24, breachValue: 48, noMoveWarnValue: 24, noMoveBreachValue: 48 },
  { id: 'clearance', status: 'فسح', warningValue: 24, breachValue: 48, noMoveWarnValue: 24, noMoveBreachValue: 48 },
  { id: 'hold', status: 'معلقة', warningValue: 24, breachValue: 48, noMoveWarnValue: 24, noMoveBreachValue: 48 },
  { id: 'delivered', status: 'تم التسليم', warningValue: 0, breachValue: 0, noMoveWarnValue: 0, noMoveBreachValue: 0, active: false },
  { id: 'cancel', status: 'الغاء', warningValue: 0, breachValue: 0, noMoveWarnValue: 0, noMoveBreachValue: 0, active: false },
]);

const DEFAULT_DELIVERY = Object.freeze({
  targetDays: 5,
  warningDays: 4,
  breachDays: 5,
  dayType: 'calendar', // calendar | working
  startFrom: 'proforma', // proforma | claimed | psfu
  deliveredStatus: 'تم التسليم',
  active: true,
});

function dayKey(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function parseTs(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function addCalendarDays(key, n) {
  const k = dayKey(key);
  if (!k) return '';
  const [y, mo, d] = k.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + Number(n || 0)));
  return dt.toISOString().slice(0, 10);
}

function diffCalendarDays(from, to) {
  const a = dayKey(from);
  const b = dayKey(to);
  if (!a || !b) return null;
  const [ay, amo, ad] = a.split('-').map(Number);
  const [by, bmo, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bmo - 1, bd) - Date.UTC(ay, amo - 1, ad)) / DAY_MS);
}

function hoursBetween(fromMs, toMs) {
  if (fromMs == null || toMs == null) return null;
  return (toMs - fromMs) / HOUR_MS;
}

function slugId(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u0600-\u06FF-]/g, '')
    .slice(0, 48) || `rule_${Date.now()}`;
}

function normalizeRule(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const fb = fallback || {};
  const status = String(src.status || fb.status || '').trim();
  const id = String(src.id || fb.id || slugId(status)).trim() || slugId(status);
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    id,
    status,
    warningValue: num(src.warningValue != null ? src.warningValue : src.warning_value, fb.warningValue ?? 24),
    warningUnit: String(src.warningUnit || src.warning_unit || 'hours'),
    breachValue: num(src.breachValue != null ? src.breachValue : src.breach_value, fb.breachValue ?? 48),
    breachUnit: String(src.breachUnit || src.breach_unit || 'hours'),
    noMoveWarnValue: num(
      src.noMoveWarnValue != null ? src.noMoveWarnValue : src.no_movement_warning_value,
      fb.noMoveWarnValue ?? 24,
    ),
    noMoveWarnUnit: String(src.noMoveWarnUnit || src.no_movement_warning_unit || 'hours'),
    noMoveBreachValue: num(
      src.noMoveBreachValue != null ? src.noMoveBreachValue : src.no_movement_breach_value,
      fb.noMoveBreachValue ?? 48,
    ),
    noMoveBreachUnit: String(src.noMoveBreachUnit || src.no_movement_breach_unit || 'hours'),
    active: src.active === false ? false : true,
    calculationType: String(src.calculationType || src.calculation_type || 'status_age'),
    updatedBy: String(src.updatedBy || src.updated_by || ''),
    updatedAt: String(src.updatedAt || src.updated_at || ''),
  };
}

function normalizeDelivery(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(120, n) : d;
  };
  const startFrom = String(src.startFrom || DEFAULT_DELIVERY.startFrom).toLowerCase();
  return {
    targetDays: num(src.targetDays, DEFAULT_DELIVERY.targetDays),
    warningDays: num(src.warningDays, DEFAULT_DELIVERY.warningDays),
    breachDays: num(src.breachDays, DEFAULT_DELIVERY.breachDays),
    dayType: src.dayType === 'working' ? 'working' : 'calendar',
    startFrom: ['proforma', 'claimed', 'psfu'].includes(startFrom) ? startFrom : 'proforma',
    deliveredStatus: String(src.deliveredStatus || DEFAULT_DELIVERY.deliveredStatus).trim() || DEFAULT_DELIVERY.deliveredStatus,
    active: src.active === false ? false : true,
  };
}

function defaultControl() {
  return {
    rules: DEFAULT_STATUS_RULES.map((r) => normalizeRule(r, r)),
    delivery: { ...DEFAULT_DELIVERY },
    priority: [...DEFAULT_PRIORITY],
  };
}

/**
 * Read/normalize SLA control config from store.meta.slaControl.
 * Migrates legacy meta.sla targetDay rows into hour rules when needed.
 */
function readControl(meta) {
  const base = defaultControl();
  const src = meta && meta.slaControl && typeof meta.slaControl === 'object' ? meta.slaControl : null;
  if (src) {
    const byStatus = new Map();
    (Array.isArray(src.rules) ? src.rules : []).forEach((r) => {
      const rule = normalizeRule(r);
      if (rule.status) byStatus.set(rule.status.toLowerCase(), rule);
    });
    // Keep defaults for missing statuses; overlay saved rules
    const rules = base.rules.map((d) => {
      const hit = byStatus.get(d.status.toLowerCase());
      if (hit) {
        byStatus.delete(d.status.toLowerCase());
        return normalizeRule(hit, d);
      }
      return d;
    });
    byStatus.forEach((r) => rules.push(r));
    return {
      rules,
      delivery: normalizeDelivery(src.delivery),
      priority: Array.isArray(src.priority) && src.priority.length ? src.priority.map(String) : [...DEFAULT_PRIORITY],
    };
  }

  // Legacy meta.sla (targetDay from Proforma) → approximate breach hours = targetDay * 24
  if (Array.isArray(meta && meta.sla) && meta.sla.length) {
    const legacy = new Map(meta.sla.map((x) => [String(x.id || '').toLowerCase(), x]));
    return {
      rules: base.rules.map((d) => {
        const leg = [...legacy.values()].find((x) =>
          (x.statuses || []).some((s) => String(s).toLowerCase() === d.status.toLowerCase())
          || String(x.id || '').toLowerCase() === d.id,
        );
        if (!leg) return d;
        const day = Math.round(Number(leg.targetDay)) || 0;
        if (day >= 1) {
          return normalizeRule({
            ...d,
            warningValue: Math.max(1, (day - 1) * 24),
            breachValue: day * 24,
            noMoveWarnValue: Math.max(1, (day - 1) * 24),
            noMoveBreachValue: day * 24,
            active: leg.enabled !== false,
          }, d);
        }
        return normalizeRule({ ...d, active: leg.enabled !== false }, d);
      }),
      delivery: { ...DEFAULT_DELIVERY },
      priority: [...DEFAULT_PRIORITY],
    };
  }

  return base;
}

function writeControl(meta, control, userName) {
  if (!meta || typeof meta !== 'object') return null;
  const now = new Date().toISOString();
  const rules = (control.rules || []).map((r) => normalizeRule({
    ...r,
    updatedBy: userName || r.updatedBy || '',
    updatedAt: now,
  })).filter((r) => r.status);
  meta.slaControl = {
    rules,
    delivery: normalizeDelivery(control.delivery),
    priority: Array.isArray(control.priority) && control.priority.length
      ? control.priority.map(String)
      : [...DEFAULT_PRIORITY],
    updatedAt: now,
    updatedBy: userName || '',
  };
  return meta.slaControl;
}

function readHistory(meta) {
  return Array.isArray(meta && meta.slaChangeHistory) ? meta.slaChangeHistory : [];
}

function pushHistory(meta, entry) {
  if (!meta || typeof meta !== 'object') return;
  if (!Array.isArray(meta.slaChangeHistory)) meta.slaChangeHistory = [];
  meta.slaChangeHistory.unshift({
    id: `sla_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    ...entry,
  });
  if (meta.slaChangeHistory.length > 500) meta.slaChangeHistory.length = 500;
}

/** Append-only status transition. Never overwrite prior entries. */
function recordStatusTransition(ops, previousStatus, newStatus, at, by) {
  if (!ops) return false;
  const next = String(newStatus || '').trim();
  if (!next) return false;
  const prev = String(previousStatus || '').trim();
  if (prev === next) return false;
  if (!Array.isArray(ops.statusHistory)) ops.statusHistory = [];
  ops.statusHistory.push({
    previous: prev,
    status: next,
    at: at || new Date().toISOString(),
    by: by || '',
  });
  return true;
}

/** Legacy helper — first-enter only (kept for backfill compatibility). */
function recordStatusEnter(ops, status, at, by) {
  const s = String(status || '').trim();
  if (!s || !ops) return false;
  if (!Array.isArray(ops.statusHistory)) ops.statusHistory = [];
  if (ops.statusHistory.some((h) => h && String(h.status || '').trim() === s)) return false;
  return recordStatusTransition(ops, '', s, at, by);
}

/**
 * Latest timestamp when VIN entered `status` (last segment).
 * Does NOT guess — returns '' if missing.
 */
function statusEnteredAt(ops, status) {
  const want = String(status || '').trim().toLowerCase();
  if (!want || !ops) return '';
  const hist = Array.isArray(ops.statusHistory) ? ops.statusHistory : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const h = hist[i];
    if (h && String(h.status || '').trim().toLowerCase() === want && h.at) {
      return String(h.at);
    }
  }
  // Current status with no history → MISSING_DATA (do not use updatedAt as guess)
  return '';
}

function firstStatusAt(ops, status) {
  const want = String(status || '').trim().toLowerCase();
  if (!want || !ops) return '';
  const hist = Array.isArray(ops.statusHistory) ? ops.statusHistory : [];
  for (let i = 0; i < hist.length; i += 1) {
    const h = hist[i];
    if (h && String(h.status || '').trim().toLowerCase() === want && h.at) {
      return String(h.at);
    }
  }
  return '';
}

function ruleForStatus(control, status) {
  const want = String(status || '').trim().toLowerCase();
  return (control.rules || []).find((r) => String(r.status || '').toLowerCase() === want) || null;
}

function toHours(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const u = String(unit || 'hours').toLowerCase();
  if (u.startsWith('day')) return n * 24;
  if (u.startsWith('min')) return n / 60;
  return n;
}

function pickCondition(candidates, priority) {
  const order = priority && priority.length ? priority : DEFAULT_PRIORITY;
  let best = null;
  let bestRank = Infinity;
  candidates.forEach((c) => {
    if (!c || !c.condition) return;
    const rank = order.indexOf(c.condition);
    const r = rank >= 0 ? rank : 999;
    if (r < bestRank) {
      bestRank = r;
      best = c;
    }
  });
  return best;
}

function zoneForCondition(condition) {
  switch (condition) {
    case 'SLA_BREACHED':
    case 'NO_MOVEMENT':
    case 'DELIVERY_LATE':
    case 'COMPLETED_LATE':
      return 'red';
    case 'AT_RISK':
    case 'DUE_TODAY':
      return 'yellow';
    case 'ON_TRACK':
    case 'COMPLETED_ON_TIME':
      return 'green';
    case 'CANCELLED':
      return 'grey';
    case 'MISSING_DATA':
      return 'empty';
    default:
      return 'empty';
  }
}

function labelForCondition(condition) {
  const map = {
    ON_TRACK: 'ON TRACK',
    AT_RISK: 'AT RISK',
    DUE_TODAY: 'DUE TODAY',
    SLA_BREACHED: 'SLA BREACHED',
    NO_MOVEMENT: 'NO MOVEMENT',
    DELIVERY_LATE: 'DELIVERY LATE',
    COMPLETED_ON_TIME: 'COMPLETED ON TIME',
    COMPLETED_LATE: 'COMPLETED LATE',
    CANCELLED: 'CANCELLED',
    MISSING_DATA: 'MISSING DATA',
  };
  return map[condition] || condition || '—';
}

function deliveryStartDate(vehicle, delivery) {
  const proforma = dayKey(vehicle.raw && vehicle.raw.proformaDate);
  const startFrom = delivery.startFrom || 'proforma';
  if (startFrom === 'claimed') {
    const at = firstStatusAt(vehicle.ops, 'Claimed');
    return dayKey(at) || proforma;
  }
  if (startFrom === 'psfu') {
    const at = firstStatusAt(vehicle.ops, 'PSFU');
    return dayKey(at) || proforma;
  }
  return proforma;
}

function deliveredAtDay(vehicle, delivery) {
  const want = String(delivery.deliveredStatus || 'تم التسليم').trim().toLowerCase();
  const histAt = firstStatusAt(vehicle.ops, delivery.deliveredStatus || 'تم التسليم');
  if (histAt) return dayKey(histAt);
  const cur = String((vehicle.ops && vehicle.ops.opsStatus) || '').trim().toLowerCase();
  if (cur === want) {
    // Delivered now but no timestamp → MISSING for delivery age accuracy; still mark delivered
    return dayKey(vehicle.ops && vehicle.ops.updatedAt) || '';
  }
  const inv = dayKey(vehicle.raw && vehicle.raw.invoiceDate);
  return inv || '';
}

/**
 * Evaluate one VIN against the admin SLA control config.
 */
function evaluateVin(vehicle, control, nowIso) {
  const now = parseTs(nowIso) || Date.now();
  const cfg = control || defaultControl();
  const status = String((vehicle.ops && vehicle.ops.opsStatus) || '').trim();
  const proforma = dayKey(vehicle.raw && vehicle.raw.proformaDate);
  const statusAt = statusEnteredAt(vehicle.ops, status);
  const statusAtMs = parseTs(statusAt);
  const statusAgeHours = statusAtMs != null ? hoursBetween(statusAtMs, now) : null;

  const delivery = cfg.delivery || DEFAULT_DELIVERY;
  const startDay = deliveryStartDate(vehicle, delivery);
  const deliveryDue = startDay && delivery.active
    ? addCalendarDays(startDay, Number(delivery.targetDays) || 5)
    : '';
  const delivDay = deliveredAtDay(vehicle, delivery);
  const todayKeyStr = dayKey(new Date(now).toISOString());
  const deliveryAgeDays = startDay && (delivDay || todayKeyStr)
    ? diffCalendarDays(startDay, delivDay || todayKeyStr)
    : null;

  const candidates = [];
  const cancelLike = status === 'الغاء' || status.toLowerCase() === 'cancel';
  if (cancelLike) {
    candidates.push({
      condition: 'CANCELLED',
      severity: 'CANCELLED',
      detail: 'Cancelled',
    });
  }

  const rule = ruleForStatus(cfg, status);
  const warnH = rule ? toHours(rule.warningValue, rule.warningUnit) : null;
  const breachH = rule ? toHours(rule.breachValue, rule.breachUnit) : null;
  const nmWarnH = rule ? toHours(rule.noMoveWarnValue, rule.noMoveWarnUnit) : null;
  const nmBreachH = rule ? toHours(rule.noMoveBreachValue, rule.noMoveBreachUnit) : null;

  if (status && rule && rule.active && !cancelLike) {
    if (!statusAt || statusAgeHours == null) {
      // Do not guess timestamps — MISSING_DATA wins for active status rules
      return {
        vin: vehicle.vin,
        product: (vehicle.raw && vehicle.raw.product) || '',
        employee: (vehicle.ops && vehicle.ops.assignedEmployeeName) || '',
        proformaDate: proforma,
        currentStatus: status,
        statusChangedAt: '',
        statusAgeHours: null,
        deliveryDate: delivDay,
        deliveryAgeDays,
        deliveryDueDate: deliveryDue,
        deliverySla: delivery.active ? `${delivery.targetDays}d from ${delivery.startFrom}` : '',
        deliverySlaResult: '',
        slaWarning: warnH,
        slaBreach: breachH,
        noMovementAge: null,
        condition: 'MISSING_DATA',
        conditionLabel: labelForCondition('MISSING_DATA'),
        conditionDetail: 'No status-enter timestamp',
        conditionSeverity: 'MISSING_DATA',
        zone: zoneForCondition('MISSING_DATA'),
        slaResult: 'MISSING_DATA',
      };
    }
    if (breachH != null && statusAgeHours >= breachH) {
      candidates.push({
        condition: 'SLA_BREACHED',
        severity: 'SLA_BREACHED',
        detail: `${status} ${statusAgeHours.toFixed(1)}h ≥ ${breachH}h`,
      });
    } else if (warnH != null && statusAgeHours >= warnH) {
      candidates.push({
        condition: 'AT_RISK',
        severity: 'AT_RISK',
        detail: `${status} ${statusAgeHours.toFixed(1)}h ≥ warning ${warnH}h`,
      });
    } else {
      candidates.push({
        condition: 'ON_TRACK',
        severity: 'ON_TRACK',
        detail: `${status} ${statusAgeHours.toFixed(1)}h`,
      });
    }

    if (nmBreachH != null && statusAgeHours >= nmBreachH) {
      candidates.push({
        condition: 'NO_MOVEMENT',
        severity: 'NO_MOVEMENT',
        detail: `No movement ${statusAgeHours.toFixed(1)}h ≥ ${nmBreachH}h`,
      });
    } else if (nmWarnH != null && statusAgeHours >= nmWarnH) {
      candidates.push({
        condition: 'AT_RISK',
        severity: 'AT_RISK',
        detail: `No-movement warning ${statusAgeHours.toFixed(1)}h`,
      });
    }
  } else if (status && !rule && !cancelLike) {
    candidates.push({
      condition: 'MISSING_DATA',
      severity: 'MISSING_DATA',
      detail: 'No SLA rule for status',
    });
  }

  // Delivery SLA (historical result preserved via delivery fields)
  let deliverySlaResult = '';
  if (delivery.active && startDay && deliveryDue) {
    if (delivDay) {
      const late = diffCalendarDays(deliveryDue, delivDay);
      if (late != null && late > 0) {
        deliverySlaResult = 'COMPLETED_LATE';
        candidates.push({
          condition: 'COMPLETED_LATE',
          severity: 'COMPLETED_LATE',
          detail: `Delivered ${delivDay} · due ${deliveryDue}`,
        });
      } else {
        deliverySlaResult = 'COMPLETED_ON_TIME';
        candidates.push({
          condition: 'COMPLETED_ON_TIME',
          severity: 'COMPLETED_ON_TIME',
          detail: `Delivered ${delivDay} · due ${deliveryDue}`,
        });
      }
    } else if (!cancelLike) {
      const untilDue = diffCalendarDays(todayKeyStr, deliveryDue);
      if (untilDue != null && untilDue < 0) {
        deliverySlaResult = 'DELIVERY_LATE';
        candidates.push({
          condition: 'DELIVERY_LATE',
          severity: 'DELIVERY_LATE',
          detail: `Due ${deliveryDue} · not delivered`,
        });
      } else if (untilDue === 0) {
        deliverySlaResult = 'DUE_TODAY';
        candidates.push({
          condition: 'DUE_TODAY',
          severity: 'DUE_TODAY',
          detail: `Delivery due today (${deliveryDue})`,
        });
      }
    }
  }

  if (!proforma) {
    candidates.push({
      condition: 'MISSING_DATA',
      severity: 'MISSING_DATA',
      detail: 'No Proforma Date',
    });
  }

  const picked = pickCondition(candidates, cfg.priority) || {
    condition: 'MISSING_DATA',
    severity: 'MISSING_DATA',
    detail: 'No condition',
  };

  const zone = zoneForCondition(picked.condition);

  return {
    vin: vehicle.vin,
    product: (vehicle.raw && vehicle.raw.product) || '',
    employee: (vehicle.ops && vehicle.ops.assignedEmployeeName) || '',
    proformaDate: proforma,
    currentStatus: status,
    statusChangedAt: statusAt,
    statusAgeHours: statusAgeHours == null ? null : Math.round(statusAgeHours * 10) / 10,
    deliveryDate: delivDay,
    deliveryAgeDays,
    deliveryDueDate: deliveryDue,
    deliverySla: delivery.active ? `${delivery.targetDays}d from ${delivery.startFrom}` : '',
    deliverySlaResult,
    slaWarning: warnH,
    slaBreach: breachH,
    noMovementAge: statusAgeHours,
    condition: picked.condition,
    conditionLabel: labelForCondition(picked.condition),
    conditionDetail: picked.detail || '',
    conditionSeverity: picked.severity,
    zone,
    slaResult: picked.condition,
  };
}

function summarizeConditions(rows) {
  const counts = {
    total: rows.length,
    ON_TRACK: 0,
    AT_RISK: 0,
    DUE_TODAY: 0,
    SLA_BREACHED: 0,
    NO_MOVEMENT: 0,
    DELIVERY_LATE: 0,
    COMPLETED_ON_TIME: 0,
    COMPLETED_LATE: 0,
    CANCELLED: 0,
    MISSING_DATA: 0,
  };
  rows.forEach((r) => {
    if (counts[r.condition] != null) counts[r.condition] += 1;
  });
  return counts;
}

function evaluatePool(vehicles, control, nowIso, { month } = {}) {
  const rows = [];
  (vehicles || []).forEach((v) => {
    const p = dayKey(v.raw && v.raw.proformaDate);
    if (month && (!p || p.slice(0, 7) !== month)) return;
    rows.push(evaluateVin(v, control, nowIso));
  });
  return {
    at: nowIso || new Date().toISOString(),
    month: month || '',
    kpis: summarizeConditions(rows),
    rows,
  };
}

function worstZone(zones) {
  const rank = { red: 1, yellow: 2, green: 3, grey: 4, empty: 5, future: 6, ok: 3, due: 2, late: 1 };
  let best = 'empty';
  let bestR = 99;
  (zones || []).forEach((z) => {
    const r = rank[z] != null ? rank[z] : 50;
    if (r < bestR) {
      bestR = r;
      best = z;
    }
  });
  return best;
}

module.exports = {
  SEVERITY,
  DEFAULT_PRIORITY,
  DEFAULT_STATUS_RULES,
  DEFAULT_DELIVERY,
  STATUSES,
  dayKey,
  addCalendarDays,
  diffCalendarDays,
  hoursBetween,
  defaultControl,
  readControl,
  writeControl,
  readHistory,
  pushHistory,
  normalizeRule,
  normalizeDelivery,
  recordStatusTransition,
  recordStatusEnter,
  statusEnteredAt,
  firstStatusAt,
  evaluateVin,
  evaluatePool,
  summarizeConditions,
  labelForCondition,
  zoneForCondition,
  worstZone,
  toHours,
};
