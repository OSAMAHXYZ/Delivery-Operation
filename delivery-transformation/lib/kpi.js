'use strict';

/**
 * Delivery Team KPI engine — calculation only, no UI.
 * Sources: Live Sheet assignment + status, Raw Data column W (lead time),
 * monthly Team Targets, admin KPI weightage.
 */

const KPI_KEYS = Object.freeze(['leadTime', 'achievement', 'contribution', 'psfu']);

const KPI_META = Object.freeze({
  leadTime: { name: 'Average Delivery Lead Time', short: 'Lead Time' },
  achievement: { name: 'Delivery Achievement vs Monthly Target', short: 'Achievement' },
  contribution: { name: 'Contribution to Delivery Team', short: 'Contribution' },
  psfu: { name: 'PSFU', short: 'PSFU' },
});

const DEFAULT_WEIGHTS = Object.freeze({
  leadTime: 25,
  achievement: 25,
  contribution: 25,
  psfu: 25,
});

const DEFAULT_ENABLED = Object.freeze({
  leadTime: true,
  achievement: true,
  contribution: true,
  psfu: true,
});

/** Configurable scoring — change via meta.kpiScoring without touching UI. */
const DEFAULT_SCORING = Object.freeze({
  leadTime: {
    maxScore: 5,
    unit: 'days',
    bands: [
      { max: 2, score: 5, label: '0–2 days' },
      { max: 2.5, score: 4, label: '>2–2.5 days' },
      { max: 3, score: 3, label: '>2.5–3 days' },
      { max: 3.5, score: 2, label: '>3–3.5 days' },
      { max: 4, score: 1, label: '>3.5–4 days' },
      { max: 5, score: 0, label: '>4–5 days' },
      { max: Infinity, score: 0, label: '>5 days' },
    ],
  },
  achievement: {
    maxScore: 5,
    unit: '%',
    bands: [
      { min: 100, score: 5, label: '≥100% of monthly target' },
      { min: 90, score: 4, label: '90–99% of monthly target' },
      { min: 80, score: 3, label: '80–89% of monthly target' },
      { min: 70, score: 2, label: '70–79% of monthly target' },
      { min: 60, score: 1, label: '60–69% of monthly target' },
      { min: 0, score: 0, label: '<60% of monthly target' },
    ],
  },
  contribution: {
    maxScore: 5,
    unit: '%',
    mode: 'equalShare',
    bands: [
      { minRatio: 1.25, score: 5, label: '≥125% of equal team share' },
      { minRatio: 1, score: 4, label: '100–124% of equal team share' },
      { minRatio: 0.75, score: 3, label: '75–99% of equal team share' },
      { minRatio: 0.5, score: 2, label: '50–74% of equal team share' },
      { minRatio: 0.25, score: 1, label: '25–49% of equal team share' },
      { minRatio: 0, score: 0, label: '<25% of equal team share' },
    ],
  },
  psfu: {
    maxScore: 3,
    unit: '%',
    bands: [
      { minExclusive: 90, score: 3, label: '>90%' },
      { min: 85, score: 2, label: '85–90%' },
      { min: 0, score: 0, label: '<85%' },
    ],
  },
});

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function round2(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function statusOf(pct) {
  if (pct == null) return 'empty';
  if (pct >= 80) return 'high';
  if (pct >= 60) return 'medium';
  return 'low';
}

function parseLeadTimeValue(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val < 0 || val > 400) return null;
    return round2(val);
  }
  const s = String(val).trim().replace(/,/g, '.');
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 400) return null;
  return round2(n);
}

function uniqueByVin(list) {
  const seen = new Set();
  return (list || []).filter((v) => {
    const k = String((v && v.vin) || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function normalizeWeights(input) {
  const out = { ...DEFAULT_WEIGHTS };
  if (input && typeof input === 'object') {
    KPI_KEYS.forEach((k) => {
      const n = Number(input[k]);
      if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(100, round2(n)));
    });
  }
  return out;
}

function normalizeEnabled(input) {
  const out = { ...DEFAULT_ENABLED };
  if (input && typeof input === 'object') {
    KPI_KEYS.forEach((k) => {
      if (input[k] === false || input[k] === 0 || input[k] === '0') out[k] = false;
      else if (input[k] === true || input[k] === 1 || input[k] === '1') out[k] = true;
    });
  }
  return out;
}

function normalizeScoring(input) {
  const base = clone(DEFAULT_SCORING);
  if (!input || typeof input !== 'object') return base;
  KPI_KEYS.forEach((k) => {
    const src = input[k];
    if (!src || typeof src !== 'object') return;
    if (Number.isFinite(Number(src.maxScore))) base[k].maxScore = Math.max(1, Math.round(Number(src.maxScore)));
    if (src.mode) base[k].mode = String(src.mode);
    if (Array.isArray(src.bands) && src.bands.length) base[k].bands = src.bands;
  });
  return base;
}

function weightTotal(weights, enabled) {
  return KPI_KEYS.reduce((s, k) => s + (enabled[k] ? Number(weights[k]) || 0 : 0), 0);
}

function validateWeightage(weights, enabled) {
  const w = normalizeWeights(weights);
  const e = normalizeEnabled(enabled);
  const total = round2(weightTotal(w, e));
  if (total !== 100) {
    return { ok: false, total, weights: w, enabled: e, error: `Total weight must be exactly 100% (now ${total}%).` };
  }
  return { ok: true, total, weights: w, enabled: e };
}

function scoreLeadTime(days, scoring) {
  const cfg = scoring.leadTime;
  if (days == null) return { score: null, band: null };
  const band = (cfg.bands || []).find((b) => days <= (b.max == null ? Infinity : b.max));
  return { score: band ? band.score : 0, band };
}

function scoreMinBands(value, bands) {
  if (value == null) return { score: null, band: null };
  const ordered = [...(bands || [])].sort((a, b) => {
    const av = a.minExclusive != null ? a.minExclusive : (a.min || 0);
    const bv = b.minExclusive != null ? b.minExclusive : (b.min || 0);
    return bv - av;
  });
  for (const band of ordered) {
    if (band.minExclusive != null && value > band.minExclusive) return { score: band.score, band };
    if (band.minExclusive == null && value >= (band.min || 0)) return { score: band.score, band };
  }
  return { score: 0, band: ordered[ordered.length - 1] || null };
}

function scoreAchievement(pct, scoring) {
  return scoreMinBands(pct, scoring.achievement.bands);
}

function scorePsfu(pct, scoring) {
  return scoreMinBands(pct, scoring.psfu.bands);
}

function scoreContribution(contribPct, equalShare, scoring) {
  const cfg = scoring.contribution;
  if (contribPct == null) return { score: null, band: null, equalShare };
  const ratio = equalShare > 0 ? contribPct / equalShare : 0;
  const ordered = [...(cfg.bands || [])].sort((a, b) => (b.minRatio || 0) - (a.minRatio || 0));
  for (const band of ordered) {
    if (ratio >= (band.minRatio || 0)) return { score: band.score, band, equalShare, ratio: round2(ratio) };
  }
  return { score: 0, band: ordered[ordered.length - 1] || null, equalShare, ratio: round2(ratio) };
}

function kpiPctFromScore(score, maxScore) {
  if (score == null || !maxScore) return null;
  return round2((score / maxScore) * 100);
}

function emptyKpi(key, weight, extra) {
  return {
    key,
    name: KPI_META[key].name,
    short: KPI_META[key].short,
    actual: null,
    actualLabel: '—',
    targetRule: '',
    score: null,
    maxScore: null,
    kpiPct: null,
    weight,
    contribution: null,
    status: 'empty',
    available: false,
    message: '',
    detail: {},
    ...extra,
  };
}

function packKpi(key, weight, fields) {
  const kpiPct = fields.kpiPct;
  const contribution = fields.available && kpiPct != null ? round2(kpiPct * (weight / 100)) : null;
  return {
    key,
    name: KPI_META[key].name,
    short: KPI_META[key].short,
    weight,
    contribution,
    status: fields.available ? statusOf(kpiPct) : 'empty',
    ...fields,
  };
}

function computeEmployeeKpi(opts) {
  const month = opts.month;
  const currentMonth = opts.currentMonth || month;
  const employees = opts.employees || [];
  const emp = employees.find((u) => u.id === opts.employeeId);
  if (!emp) {
    return { error: 'Employee not found', month, currentMonth, roster: employees.map((u) => ({ id: u.id, name: u.name })) };
  }

  const weights = normalizeWeights(opts.weights);
  const enabled = normalizeEnabled(opts.enabled);
  const scoring = normalizeScoring(opts.scoring);
  const inMonth = opts.inMonth;
  const isDelivered = opts.isDelivered;
  const targets = opts.targets || {};

  const monthVehicles = uniqueByVin((opts.vehicles || []).filter((v) => inMonth(v, month)));
  const empVehicles = monthVehicles.filter((v) => v.ops && v.ops.assignedEmployeeId === emp.id);
  const teamDelivered = monthVehicles.filter((v) => isDelivered(v)).length;
  const empDelivered = empVehicles.filter((v) => isDelivered(v)).length;
  const empTotal = empVehicles.length;
  const target = Number(targets[emp.id]) || 0;
  const activeEmployees = employees.filter((u) => (
    monthVehicles.some((v) => v.ops && v.ops.assignedEmployeeId === u.id)
  ));
  const shareN = Math.max(1, activeEmployees.length || employees.length);
  const equalShare = round2(100 / shareN);

  const kpis = {};

  // ——— KPI 1: Average lead time from Raw Data column W, matched by VIN ———
  const leadUsed = [];
  const missingLead = [];
  empVehicles.forEach((v) => {
    const days = parseLeadTimeValue(v.raw && v.raw.leadTime);
    if (days == null) missingLead.push(v.vin);
    else leadUsed.push({ vin: v.vin, days });
  });
  const leadWeight = enabled.leadTime ? weights.leadTime : 0;
  if (!enabled.leadTime) {
    kpis.leadTime = emptyKpi('leadTime', 0, { message: 'KPI disabled in weightage.', maxScore: scoring.leadTime.maxScore });
  } else if (!empTotal) {
    kpis.leadTime = emptyKpi('leadTime', leadWeight, {
      message: 'No VINs assigned to this employee in the selected month.',
      maxScore: scoring.leadTime.maxScore,
      detail: { vinCount: 0, used: 0, missingLeadTime: [] },
    });
  } else if (!leadUsed.length) {
    kpis.leadTime = emptyKpi('leadTime', leadWeight, {
      message: 'No Lead Time data available for this employee.',
      maxScore: scoring.leadTime.maxScore,
      detail: { vinCount: empTotal, used: 0, missingLeadTime: missingLead },
    });
  } else {
    const avg = round2(leadUsed.reduce((s, x) => s + x.days, 0) / leadUsed.length);
    const scored = scoreLeadTime(avg, scoring);
    const maxScore = scoring.leadTime.maxScore;
    kpis.leadTime = packKpi('leadTime', leadWeight, {
      actual: avg,
      actualLabel: `${avg} days`,
      targetRule: scored.band ? `${scored.band.label} = ${scored.band.score} points` : '',
      score: scored.score,
      maxScore,
      kpiPct: kpiPctFromScore(scored.score, maxScore),
      available: true,
      message: missingLead.length
        ? `${missingLead.length} VIN(s) have no Raw Data column W (Lead Time).`
        : '',
      detail: {
        vinCount: empTotal,
        used: leadUsed.length,
        missingLeadTime: missingLead,
        samples: leadUsed.slice(0, 12),
      },
    });
  }

  // ——— KPI 2: Achievement vs monthly Team Target (VIN count / target) ———
  const achWeight = enabled.achievement ? weights.achievement : 0;
  if (!enabled.achievement) {
    kpis.achievement = emptyKpi('achievement', 0, { message: 'KPI disabled in weightage.', maxScore: scoring.achievement.maxScore });
  } else if (!target) {
    kpis.achievement = emptyKpi('achievement', achWeight, {
      actual: empTotal,
      actualLabel: `${empTotal} VIN`,
      message: 'No monthly target set for this employee.',
      maxScore: scoring.achievement.maxScore,
      detail: { vinCount: empTotal, target: 0 },
    });
  } else {
    const achPct = round2((empTotal / target) * 100);
    const scored = scoreAchievement(achPct, scoring);
    const maxScore = scoring.achievement.maxScore;
    kpis.achievement = packKpi('achievement', achWeight, {
      actual: achPct,
      actualLabel: `${empTotal} / ${target} VIN (${achPct}%)`,
      targetRule: scored.band ? `${scored.band.label} = ${scored.band.score} points` : '',
      score: scored.score,
      maxScore,
      kpiPct: kpiPctFromScore(scored.score, maxScore),
      available: true,
      message: '',
      detail: { vinCount: empTotal, target, achievementPct: achPct },
    });
  }

  // ——— KPI 3: Contribution = employee delivered / team delivered ———
  const conWeight = enabled.contribution ? weights.contribution : 0;
  if (!enabled.contribution) {
    kpis.contribution = emptyKpi('contribution', 0, { message: 'KPI disabled in weightage.', maxScore: scoring.contribution.maxScore });
  } else if (!teamDelivered) {
    kpis.contribution = emptyKpi('contribution', conWeight, {
      message: 'No delivered VINs on the Delivery Team this month.',
      maxScore: scoring.contribution.maxScore,
      detail: { employeeDelivered: empDelivered, teamDelivered: 0 },
    });
  } else {
    const contribPct = round2((empDelivered / teamDelivered) * 100);
    const scored = scoreContribution(contribPct, equalShare, scoring);
    const maxScore = scoring.contribution.maxScore;
    kpis.contribution = packKpi('contribution', conWeight, {
      actual: contribPct,
      actualLabel: `${empDelivered} / ${teamDelivered} delivered (${contribPct}%)`,
      targetRule: scored.band
        ? `${scored.band.label} · equal share ${equalShare}% = ${scored.band.score} points`
        : `Equal share ${equalShare}%`,
      score: scored.score,
      maxScore,
      kpiPct: kpiPctFromScore(scored.score, maxScore),
      available: true,
      message: '',
      detail: {
        employeeDelivered: empDelivered,
        teamDelivered,
        contributionPct: contribPct,
        equalShare,
        activeEmployees: shareN,
        ratio: scored.ratio,
      },
    });
  }

  // ——— KPI 4: PSFU status share ———
  const psfuWeight = enabled.psfu ? weights.psfu : 0;
  const psfuCount = empVehicles.filter((v) => String((v.ops && v.ops.opsStatus) || '') === 'PSFU').length;
  if (!enabled.psfu) {
    kpis.psfu = emptyKpi('psfu', 0, { message: 'KPI disabled in weightage.', maxScore: scoring.psfu.maxScore });
  } else if (!empTotal) {
    kpis.psfu = emptyKpi('psfu', psfuWeight, {
      message: 'Employee has no VINs this month.',
      maxScore: scoring.psfu.maxScore,
      detail: { vinCount: 0, psfuCount: 0 },
    });
  } else {
    const psfuPct = round2((psfuCount / empTotal) * 100);
    const scored = scorePsfu(psfuPct, scoring);
    const maxScore = scoring.psfu.maxScore;
    kpis.psfu = packKpi('psfu', psfuWeight, {
      actual: psfuPct,
      actualLabel: `${psfuCount} / ${empTotal} VIN (${psfuPct}%)`,
      targetRule: scored.band ? `${scored.band.label} = ${scored.band.score} points` : '',
      score: scored.score,
      maxScore,
      kpiPct: kpiPctFromScore(scored.score, maxScore),
      available: true,
      message: '',
      detail: { vinCount: empTotal, psfuCount, psfuPct },
    });
  }

  const used = KPI_KEYS.filter((k) => enabled[k] && kpis[k].available && kpis[k].kpiPct != null);
  const skipped = KPI_KEYS.filter((k) => enabled[k] && !kpis[k].available);
  let overallPct = null;
  if (used.length) {
    overallPct = round2(used.reduce((s, k) => s + (kpis[k].kpiPct * (kpis[k].weight / 100)), 0));
  }
  const notes = [];
  if (skipped.length) {
    notes.push(`Excluded (no data): ${skipped.map((k) => KPI_META[k].short).join(', ')}.`);
  }
  if (used.length && skipped.length) {
    notes.push('Overall uses available KPIs only — missing KPIs do not add a silent zero.');
  }

  return {
    month,
    currentMonth,
    employee: { id: emp.id, name: emp.name },
    roster: employees.map((u) => ({ id: u.id, name: u.name })),
    counts: { vinCount: empTotal, delivered: empDelivered, teamDelivered, target },
    weights,
    enabled,
    scoring,
    kpis,
    overall: {
      pct: overallPct,
      status: statusOf(overallPct),
      notes,
      available: overallPct != null,
      message: overallPct == null ? 'No KPI data available for this employee in the selected month.' : '',
    },
  };
}

function readConfig(meta) {
  const m = meta || {};
  return {
    weights: normalizeWeights(m.kpiWeights),
    enabled: normalizeEnabled(m.kpiEnabled),
    scoring: normalizeScoring(m.kpiScoring),
  };
}

module.exports = {
  KPI_KEYS,
  KPI_META,
  DEFAULT_WEIGHTS,
  DEFAULT_ENABLED,
  DEFAULT_SCORING,
  parseLeadTimeValue,
  normalizeWeights,
  normalizeEnabled,
  normalizeScoring,
  validateWeightage,
  readConfig,
  computeEmployeeKpi,
};
