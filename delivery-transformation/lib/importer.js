'use strict';

const XLSX = require('xlsx');
const {
  STATUSES,
  HEADER_MAP,
  OPS_HEADER_MAP,
  RAW_COL,
} = require('./constants');

/** Date columns match headers exactly — "date" must not grab "Delivery Date" / "Proforma-Reg". */
const EXACT_ONLY = new Set(['date', 'proformaDate']);

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellString(v) {
  if (v == null) return '';
  return String(v).trim();
}

function excelSerialToIso(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 1) return '';
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(num * 86400000));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return excelSerialToIso(value);
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function normalizeYesNo(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'yes' || s === 'y' || s === 'نعم' || s === '1' || s === 'true') return 'Yes';
  if (s === 'no' || s === 'n' || s === 'لا' || s === '0' || s === 'false') return 'No';
  return '';
}

/** "a.CLAIMED" / "d. جاهز للتسليم" → app status */
function normalizeStatus(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  s = s.replace(/^[a-zA-Z]\.\s*/u, '').replace(/\.[a-zA-Z]\s*$/u, '').trim();
  const lower = s.toLowerCase();
  if (lower === 'claimed') return 'Claimed';
  if (lower === 'psfu') return 'PSFU';
  const exact = STATUSES.find((st) => st.toLowerCase() === lower);
  if (exact) return exact;
  return [...STATUSES]
    .sort((a, b) => b.length - a.length)
    .find((st) => lower.includes(st.toLowerCase())) || '';
}

function normalizePhone(v) {
  const digits = String(v == null ? '' : v).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9 && digits.startsWith('5')) return `0${digits}`;
  if (digits.length === 12 && digits.startsWith('9665')) return `0${digits.slice(3)}`;
  return digits;
}

/** Map each alias group to a column index in the header row. */
function buildColumnIndex(headers, map) {
  const norms = headers.map(normalizeHeader);
  const index = {};
  const used = new Set();
  Object.entries(map).forEach(([field, aliases]) => {
    const wanted = aliases.map(normalizeHeader).filter(Boolean);
    let hit = norms.findIndex((n, i) => !used.has(i) && wanted.includes(n));
    if (hit === -1 && !EXACT_ONLY.has(field)) {
      hit = norms.findIndex((n, i) => !used.has(i) && n && wanted.some((a) => (
        a.length > 3 && (n.startsWith(`${a} `) || n.endsWith(` ${a}`) || n.includes(a))
      )));
    }
    if (hit !== -1) {
      index[field] = hit;
      used.add(hit);
    }
  });
  return index;
}

function readSheets(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }),
  }));
}

/** First row (of the first 15) that contains a VIN header. */
function findHeaderRow(rows) {
  const vinAliases = HEADER_MAP.vin.map(normalizeHeader);
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const norms = (rows[i] || []).map(normalizeHeader);
    if (norms.some((n) => vinAliases.includes(n) || n.includes('شاس') || (n.includes('chassis')))) return i;
  }
  return -1;
}

/** Column W / "Lead Time" — days as a number. Ignore Excel date serials. */
function parseLeadTime(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val < 0 || val > 400) return '';
    return Math.round(val * 100) / 100;
  }
  const s = String(val).trim().replace(/,/g, '.');
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return '';
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 400) return '';
  return Math.round(n * 100) / 100;
}

function looksLikeVin(v) {
  const s = normVin(v);
  return s.length >= 10 && /[A-Z]/.test(s) && /\d/.test(s);
}

/** Sales Raw letter layout: column A is S/A, column C holds the VIN. */
function isSalesRawLetterLayout(rows) {
  const head = (rows[0] || []).map(normalizeHeader);
  const h0 = head[0] || '';
  if (h0 === 'vin' || h0.includes('chassis') || h0.includes('شاس')) return false;
  const sample = rows.slice(1, 12).filter((r) => Array.isArray(r) && r.length > RAW_COL.vin);
  if (!sample.length) return false;
  const vinHits = sample.filter((r) => looksLikeVin(r[RAW_COL.vin])).length;
  return vinHits >= Math.ceil(sample.length / 2);
}

function rawFromRow(row, idx, source) {
  const get = (field) => (idx[field] == null ? '' : row[idx[field]]);
  const raw = {};
  Object.keys(source).forEach((field) => {
    if (field === 'vin') return;
    const val = get(field);
    if (field === 'proformaDate' || field === 'invoiceDate' || field === 'date') raw[field] = normalizeDate(val);
    else if (field === 'phone') raw[field] = normalizePhone(val);
    else if (field === 'leadTime') raw[field] = parseLeadTime(val);
    else raw[field] = cellString(val);
  });
  return raw;
}

function opsFromRow(row, idx) {
  const get = (field) => (idx[field] == null ? '' : row[idx[field]]);
  const ops = {};
  ['guestSentDate', 'signatureReceivedDate', 'accountsSentDate', 'accountsApprovalDate', 'registrationIssueDate']
    .forEach((f) => { ops[f] = normalizeDate(get(f)); });
  ['vin1502', 'trafficFile', 'trafficFeesOps', 'insuranceOps']
    .forEach((f) => { ops[f] = normalizeYesNo(get(f)); });
  ops.opsStatus = normalizeStatus(get('opsStatus'));
  ops.notes = cellString(get('notes'));
  ops.transferCity = cellString(get('transferCity'));
  ops.carrier = cellString(get('carrier'));
  return ops;
}

/**
 * Delivery sheet → [{ vin, raw, ops, sheet }].
 * Picks the worksheet with the most VIN rows.
 */
function parseDeliverySheet(buffer) {
  let best = { sheet: '', items: [] };
  readSheets(buffer).forEach(({ name, rows }) => {
    const h = findHeaderRow(rows);
    if (h === -1) return;
    const headers = rows[h].map(cellString);
    const rawIdx = buildColumnIndex(headers, HEADER_MAP);
    const opsIdx = buildColumnIndex(headers, OPS_HEADER_MAP);
    if (rawIdx.vin == null) return;
    const items = [];
    rows.slice(h + 1).forEach((row) => {
      if (!Array.isArray(row)) return;
      const vin = normVin(row[rawIdx.vin]);
      if (!looksLikeVin(vin)) return;
      items.push({ vin, raw: rawFromRow(row, rawIdx, HEADER_MAP), ops: opsFromRow(row, opsIdx) });
    });
    if (items.length > best.items.length) best = { sheet: name, items };
  });
  return best;
}

/** Sales Raw → [{ vin, raw }] (header aliases, or the fixed A/B/C/K/N letter layout). */
function parseSalesRaw(buffer) {
  let best = { sheet: '', layout: '', items: [], duplicates: 0 };
  readSheets(buffer).forEach(({ name, rows }) => {
    let items = [];
    let layout = '';
    if (isSalesRawLetterLayout(rows)) {
      layout = 'letters';
      rows.slice(1).forEach((row) => {
        if (!Array.isArray(row)) return;
        const vin = normVin(row[RAW_COL.vin]);
        if (!looksLikeVin(vin)) return;
        const raw = {};
        Object.entries(RAW_COL).forEach(([field, col]) => {
          if (field === 'vin') return;
          if (field === 'phone') raw[field] = normalizePhone(row[col]);
          else if (field === 'proformaDate' || field === 'invoiceDate') raw[field] = normalizeDate(row[col]);
          else if (field === 'leadTime') raw[field] = parseLeadTime(row[col]);
          else raw[field] = cellString(row[col]);
        });
        items.push({ vin, raw });
      });
    } else {
      const h = findHeaderRow(rows);
      if (h === -1) return;
      const idx = buildColumnIndex(rows[h].map(cellString), HEADER_MAP);
      if (idx.vin == null) return;
      layout = 'headers';
      rows.slice(h + 1).forEach((row) => {
        if (!Array.isArray(row)) return;
        const vin = normVin(row[idx.vin]);
        if (!looksLikeVin(vin)) return;
        const raw = rawFromRow(row, idx, HEADER_MAP);
        delete raw.pic;
        if (idx.proformaDate == null) raw.proformaDate = normalizeDate(row[RAW_COL.proformaDate]);
        if (idx.invoiceDate == null) raw.invoiceDate = normalizeDate(row[RAW_COL.invoiceDate]);
        if (idx.leadTime == null) raw.leadTime = parseLeadTime(row[RAW_COL.leadTime]);
        items.push({ vin, raw });
      });
    }
    const unique = [];
    const seen = new Set();
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (seen.has(items[i].vin)) continue;
      seen.add(items[i].vin);
      unique.push(items[i]);
    }
    unique.reverse();
    const dupes = items.length - unique.length;
    if (unique.length > best.items.length) best = { sheet: name, layout, items: unique, duplicates: dupes };
  });
  return best;
}

module.exports = {
  normVin,
  normalizeDate,
  parseLeadTime,
  parseDeliverySheet,
  parseSalesRaw,
};
