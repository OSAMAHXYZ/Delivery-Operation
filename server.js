'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const XLSX = require('xlsx');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const ROOT = __dirname;
/** Persistent volume root (Railway: mount volume + set PERSISTENT_DATA_DIR=/data). Falls back to app root. */
const PERSISTENT_ROOT = String(
  process.env.PERSISTENT_DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || ''
).trim() || ROOT;
const DATA_FILE = path.join(PERSISTENT_ROOT, 'delivery-inventory-data.json');
const REPORT_SHEET_DIR = path.join(PERSISTENT_ROOT, 'report-sheet-data');
const REPORT_SHEET_META = path.join(REPORT_SHEET_DIR, 'meta.json');
const REPORT_SHEET_FILES = path.join(REPORT_SHEET_DIR, 'files');
/** Append-only RTL historical archive — never cleared by live Push/clear. */
const RTL_DAILY_DIR = path.join(REPORT_SHEET_DIR, 'rtl-daily');
const RTL_DAILY_FILES_DIR = path.join(RTL_DAILY_DIR, 'excel');
const RTL_DAILY_INDEX = path.join(RTL_DAILY_DIR, 'index.json');
const LEGACY_RTL_DAILY_DIR = path.join(ROOT, 'report-sheet-data', 'rtl-daily');
const REPORT_SLOT_IDS = Object.freeze([
  'backorder', 'rtl', 'central', 'sales', 'cancelled', 'accessories'
]);
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Timestamped snapshot id: 2026-09-09T14-30-05-123-ab12 (or legacy YYYY-MM-DD). */
const RTL_SNAPSHOT_ID_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}-\d{2}-\d{2}-\d{1,3}(?:-[a-z0-9]+)?)?$/i;
const TEMPLATE_FILE = path.join(ROOT, 'templates', 'delivery_note_template.docx');
const DELIVERY_CHECK_TEMPLATE_FILE = path.join(ROOT, 'delivery_check_note.docx');
const DELIVERY_CHECK_PDF_FILE = path.join(ROOT, 'delivery_check_note.pdf');
const DELIVERY_CHECK_PREVIEW_IMAGE = path.join(ROOT, 'images', 'delivery-check-note-form.png');
const PORT = Number(process.env.PORT) || 3000;
const DELIVERY_TEAM_PASSWORD = process.env.DELIVERY_TEAM_PASSWORD || process.env.DELIVERY_AGENT_PASSWORD || '1234';
const DELIVERY_TEAM_DATA = path.join(PERSISTENT_ROOT, 'delivery-team-data.json');
const {
  mapCarrierToCoordinatorCompany,
  mapCoordinatorCompanyToCarrier,
} = require('./deliveryteam/lib/constants');
/** Late-bound hooks — filled after hub store helpers exist (router is created early). */
const deliveryTeamHooks = {
  onCarrierAssigned: null,
  onRawUploaded: null,
  onEnsureDraftCarriers: null,
  onSalesRawUpload: null,
  getHubRawStatus: null,
};
const { createDeliveryTeamRouter } = require('./deliveryteam/lib/routes');
const deliveryTeam = createDeliveryTeamRouter({
  filePath: DELIVERY_TEAM_DATA,
  password: DELIVERY_TEAM_PASSWORD,
  onCarrierAssigned: (items) => (
    typeof deliveryTeamHooks.onCarrierAssigned === 'function'
      ? deliveryTeamHooks.onCarrierAssigned(items)
      : null
  ),
  onRawUploaded: (payload) => (
    typeof deliveryTeamHooks.onRawUploaded === 'function'
      ? deliveryTeamHooks.onRawUploaded(payload)
      : null
  ),
  onEnsureDraftCarriers: () => (
    typeof deliveryTeamHooks.onEnsureDraftCarriers === 'function'
      ? deliveryTeamHooks.onEnsureDraftCarriers()
      : null
  ),
  onSalesRawUpload: (payload) => (
    typeof deliveryTeamHooks.onSalesRawUpload === 'function'
      ? deliveryTeamHooks.onSalesRawUpload(payload)
      : null
  ),
  getHubRawStatus: () => (
    typeof deliveryTeamHooks.getHubRawStatus === 'function'
      ? deliveryTeamHooks.getHubRawStatus()
      : null
  ),
});
const deliveryTeamRouter = deliveryTeam.router;
const deliveryTeamUpload = deliveryTeam.uploadHandler;
const deliveryTeamSalesRawUpload = deliveryTeam.salesRawUploadHandler;
const deliveryTeamStore = deliveryTeam.store;

const AGENTS = new Set(['ياسين', 'الفاضل', 'البراء', 'مستودع', 'warehouse', 'showroom admin', 'سيارات العرض']);
const AGENT_PASSWORD = process.env.DELIVERY_AGENT_PASSWORD || '1234';
const USER_ROLES = Object.freeze({
  ياسين: 'showroom',
  الفاضل: 'agent',
  البراء: 'agent',
  مستودع: 'warehouse',
  warehouse: 'warehouse',
  'showroom admin': 'showroom_admin',
  'سيارات العرض': 'showroom_admin'
});
const SHOWROOM_ADMIN_AGENT = 'showroom admin';
const SHOWROOM_PARKING_SLOTS = Object.freeze(['SR-1', 'SR-2', 'SR-3', 'SR-4', 'SR-5', 'SR-6', 'SR-7']);
const SHOWROOM_PARKING_LABEL = 'Showroom Cars';
/** Yassin Automall / guest parking — 10 slots. */
const YASSIN_PARKING_SLOTS = Object.freeze([
  'YS-1', 'YS-2', 'YS-3', 'YS-4', 'YS-5',
  'YS-6', 'YS-7', 'YS-8', 'YS-9', 'YS-10'
]);
const YASSIN_PARKING_LABEL = 'موقف ياسين · اوتومول';
const WAREHOUSE_ZONE_CONFIG = Object.freeze({
  A: { total: 40, labelAr: 'استلام' },
  B: { total: 40, labelAr: 'جاهز للتسليم' },
  C: { total: 24, labelAr: 'غسيل وتجهيز' },
  D: { total: 24, labelAr: 'انتظار الفحص' },
  E: { total: 18, labelAr: 'حجز العملاء' },
  F: { total: 12, labelAr: 'التحميل والخروج' }
});
const WAREHOUSE_ZONES = Object.freeze(Object.keys(WAREHOUSE_ZONE_CONFIG));
const MAX_DRAFTS = 2000;

const {
  MUTHAKARA_BRANCH_OPTIONS: DEFAULT_CITIES
} = require('./scripts/muthakara-branch-options.js');
const {
  MUTHAKARA_CUSTOMER_OPTIONS: DEFAULT_COMPANIES
} = require('./scripts/muthakara-customer-options.js');

function normalizeOptionName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function uniqueSorted(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const name = normalizeOptionName(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, 'ar'));
}

function defaultOptions() {
  return {
    companies: uniqueSorted(DEFAULT_COMPANIES),
    cities: uniqueSorted(DEFAULT_CITIES),
    companyPhones: {}
  };
}

const emptyStore = () => ({
  raw: null,
  vehicles: [],
  queue: [],
  drafts: [],
  manualVehicles: [],
  warehouseStock: [],
  showroomParking: [],
  yassinParking: [],
  options: defaultOptions(),
  meta: {
    filename: '',
    sheetName: '',
    uploadedAt: null,
    nextDeliveryNoteSeq: 1
  }
});

/** Fixed delivery branch per agent (no manual selection). */
const AGENT_AUTO_BRANCH = Object.freeze({
  الفاضل: 'جدة',
  البراء: 'الرياض'
});

let store = emptyStore();
const wsClients = new Set();

function ensureOptions() {
  if (!store.options || typeof store.options !== 'object') {
    store.options = defaultOptions();
    return;
  }
  if (!Array.isArray(store.options.companies) || !store.options.companies.length) {
    store.options.companies = uniqueSorted(DEFAULT_COMPANIES);
  } else {
    store.options.companies = uniqueSorted(store.options.companies);
  }
  if (!Array.isArray(store.options.cities) || !store.options.cities.length) {
    store.options.cities = uniqueSorted(DEFAULT_CITIES);
  } else {
    store.options.cities = uniqueSorted(store.options.cities);
  }
  if (!store.options.companyPhones || typeof store.options.companyPhones !== 'object') {
    store.options.companyPhones = {};
  }
  // Ensure Automall city aliases exist for agents + Yassin board
  const citySet = new Set((store.options.cities || []).map((c) => companyNameKey(c)));
  ['اوتومول', 'الاوتومول'].forEach((c) => {
    if (!citySet.has(companyNameKey(c))) {
      store.options.cities = uniqueSorted([...(store.options.cities || []), c]);
      citySet.add(companyNameKey(c));
    }
  });
}

function normalizeCompanyPhone(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '').trim();
  if (!digits) return '';
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (!digits) return '';
  // Saudi local 05xxxxxxxx → 9665xxxxxxxx
  if (digits.length === 10 && digits.startsWith('05')) digits = `966${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith('5')) digits = `966${digits}`;
  return digits;
}

function companyPhoneKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getCompanyPhone(name) {
  ensureOptions();
  const key = companyPhoneKey(name);
  if (!key) return '';
  const map = store.options.companyPhones || {};
  if (map[key]) return String(map[key]);
  // Exact / case-insensitive name lookup
  for (const [k, v] of Object.entries(map)) {
    if (companyPhoneKey(k) === key) return String(v || '');
  }
  return '';
}

function setCompanyPhone(name, phone) {
  ensureOptions();
  const company = normalizeOptionName(name) || String(name || '').trim();
  if (!company) return { ok: false, error: 'اسم الشركة مطلوب' };
  const key = companyPhoneKey(company);
  const normalized = normalizeCompanyPhone(phone);
  if (!store.options.companyPhones || typeof store.options.companyPhones !== 'object') {
    store.options.companyPhones = {};
  }
  // Drop stale keys for same company
  for (const k of Object.keys(store.options.companyPhones)) {
    if (companyPhoneKey(k) === key) delete store.options.companyPhones[k];
  }
  if (normalized) store.options.companyPhones[key] = normalized;
  return { ok: true, company, phone: normalized || '' };
}

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      store = emptyStore();
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    store = {
      raw: parsed.raw ?? null,
      vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      manualVehicles: Array.isArray(parsed.manualVehicles) ? parsed.manualVehicles : [],
      warehouseStock: Array.isArray(parsed.warehouseStock) ? parsed.warehouseStock : [],
      showroomParking: Array.isArray(parsed.showroomParking) ? parsed.showroomParking : [],
      yassinParking: Array.isArray(parsed.yassinParking) ? parsed.yassinParking : [],
      options: parsed.options && typeof parsed.options === 'object'
        ? {
            companies: Array.isArray(parsed.options.companies) ? parsed.options.companies : [],
            cities: Array.isArray(parsed.options.cities) ? parsed.options.cities : [],
            companyPhones:
              parsed.options.companyPhones && typeof parsed.options.companyPhones === 'object'
                ? parsed.options.companyPhones
                : {}
          }
        : defaultOptions(),
      meta: {
        filename: parsed.meta?.filename || parsed.filename || '',
        sheetName: parsed.meta?.sheetName || parsed.sheetName || '',
        uploadedAt: parsed.meta?.uploadedAt || parsed.uploadedAt || null,
        nextDeliveryNoteSeq: Number(parsed.meta?.nextDeliveryNoteSeq) || 1
      }
    };
    ensureOptions();
    if (migrateDeliveryNoteFields()) {
      try {
        saveStore();
      } catch (e) {
        console.error('[delivery] migrate save failed:', e.message);
      }
    }
  } catch (err) {
    console.error('[delivery] failed to load store:', err.message);
    store = emptyStore();
  }
}

function saveStore() {
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function broadcastHubUpdate() {
  const payload = JSON.stringify({ type: 'delivery_hub_updated', at: Date.now() });
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
}

function ensureReportSheetDirs() {
  if (!fs.existsSync(REPORT_SHEET_DIR)) fs.mkdirSync(REPORT_SHEET_DIR, { recursive: true });
  if (!fs.existsSync(REPORT_SHEET_FILES)) fs.mkdirSync(REPORT_SHEET_FILES, { recursive: true });
}

function defaultReportSheetMeta() {
  return {
    at: 0,
    targetsAt: 0,
    slots: [],
    hasSales: false,
    hasCancelled: false,
    targets: [],
    accessoriesSettled: 0,
    workingDays: 22,
    allocationValues: {},
    fileNames: {}
  };
}

function loadReportSheetMeta() {
  ensureReportSheetDirs();
  try {
    if (!fs.existsSync(REPORT_SHEET_META)) return defaultReportSheetMeta();
    const parsed = JSON.parse(fs.readFileSync(REPORT_SHEET_META, 'utf8'));
    return { ...defaultReportSheetMeta(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return defaultReportSheetMeta();
  }
}

function saveReportSheetMeta(meta) {
  ensureReportSheetDirs();
  const tmp = `${REPORT_SHEET_META}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tmp, REPORT_SHEET_META);
}

function reportSheetFilePath(slot) {
  const id = String(slot || '').trim().toLowerCase();
  if (!REPORT_SLOT_IDS.includes(id)) return null;
  return path.join(REPORT_SHEET_FILES, id);
}

function broadcastReportSheetUpdate(at) {
  const payload = JSON.stringify({ type: 'report_sheet_updated', at: at || Date.now() });
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
}

function clearReportSheetFiles() {
  ensureReportSheetDirs();
  // Live slot files only — NEVER touch RTL_DAILY_DIR historical archive.
  for (const id of REPORT_SLOT_IDS) {
    const fp = reportSheetFilePath(id);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

/** RTL daily snapshots — isolated from live dashboard push (never clears with report-sheet). */
function ensureRtlDailyDirs() {
  ensureReportSheetDirs();
  if (!fs.existsSync(RTL_DAILY_DIR)) fs.mkdirSync(RTL_DAILY_DIR, { recursive: true });
  if (!fs.existsSync(RTL_DAILY_FILES_DIR)) fs.mkdirSync(RTL_DAILY_FILES_DIR, { recursive: true });
  const byDay = path.join(RTL_DAILY_DIR, 'by-day');
  if (!fs.existsSync(byDay)) fs.mkdirSync(byDay, { recursive: true });
}

/** Stable active Excel+pointer for a calendar day (survives like Admin live rtl.xlsx). */
function rtlDailyByDayExcelPath(dateKey) {
  const key = normalizeDateKey(dateKey);
  if (!key) return '';
  return path.join(RTL_DAILY_DIR, 'by-day', `${key}.xlsx`);
}

function rtlDailyByDayMetaPath(dateKey) {
  const key = normalizeDateKey(dateKey);
  if (!key) return '';
  return path.join(RTL_DAILY_DIR, 'by-day', `${key}.json`);
}

function mirrorRtlActiveDayFiles(snap, excelPath) {
  if (!snap || !snap.date) return;
  ensureRtlDailyDirs();
  const metaFp = rtlDailyByDayMetaPath(snap.date);
  const xfp = rtlDailyByDayExcelPath(snap.date);
  if (metaFp) {
    const tmp = `${metaFp}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      id: snap.id,
      date: snap.date,
      asOfDate: snap.asOfDate || snap.date,
      at: snap.at,
      count: snap.count,
      age0: snap.age0,
      fileName: snap.fileName || '',
      source: snap.source || '',
      excelSaved: Boolean(snap.excelSaved),
      archiveExcel: snap.excelSaved ? path.basename(rtlDailyExcelPath(snap.id) || '') : ''
    }, null, 2), 'utf8');
    fs.renameSync(tmp, metaFp);
  }
  if (excelPath && xfp && fs.existsSync(excelPath)) {
    const xtmp = `${xfp}.${process.pid}.tmp`;
    fs.copyFileSync(excelPath, xtmp);
    fs.renameSync(xtmp, xfp);
  }
}

/**
 * If index/snapshots were wiped on redeploy but by-day/*.xlsx mirrors remain
 * (same durable folder as Admin live files), rebuild active days from those Excels.
 * Fast path: skip Excel scans when every by-day file already has a live snapshot.
 */
function rehydrateRtlFromByDayMirrors() {
  ensureRtlDailyDirs();
  const byDayDir = path.join(RTL_DAILY_DIR, 'by-day');
  if (!fs.existsSync(byDayDir)) return { restored: 0 };
  let names = [];
  try {
    names = fs.readdirSync(byDayDir);
  } catch {
    return { restored: 0 };
  }
  const index = loadRtlDailyIndex();
  const need = [];

  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.xlsx$/i.exec(String(name || ''));
    if (!m) continue;
    const dateKey = m[1];
    if (!isValidRtlDateKey(dateKey)) continue;
    const activeId = resolveRtlActiveIdForDay(dateKey, index);
    if (activeId) {
      const snapPath = rtlDailySnapshotPath(activeId);
      if (snapPath && fs.existsSync(snapPath)) continue;
    }
    const xfp = rtlDailyByDayExcelPath(dateKey);
    if (!xfp || !fs.existsSync(xfp)) continue;
    need.push(dateKey);
  }

  if (!need.length) return { restored: 0 };

  let restored = 0;
  for (const dateKey of need) {
    const xfp = rtlDailyByDayExcelPath(dateKey);
    if (!xfp || !fs.existsSync(xfp)) continue;
    let meta = null;
    const metaFp = rtlDailyByDayMetaPath(dateKey);
    if (metaFp && fs.existsSync(metaFp)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFp, 'utf8'));
      } catch {
        meta = null;
      }
    }
    try {
      const buf = fs.readFileSync(xfp);
      const vehicles = scanRtlStockBuffer(buf);
      if (!vehicles.length) continue;
      persistRtlDailySnapshot({
        dateKey,
        vehicles,
        fileName: (meta && meta.fileName) || `${dateKey}.xlsx`,
        source: (meta && meta.source) || 'by-day-rehydrate',
        excelBuffer: buf,
        at: Number(meta && meta.at) || Date.now()
      });
      restored += 1;
    } catch (err) {
      console.error('[rtl-daily] by-day rehydrate failed', dateKey, err);
    }
  }
  return { restored };
}

function normalizeDateKey(value) {
  const s = String(value || '').trim();
  if (DATE_KEY_RE.test(s)) return s;
  return '';
}

function normalizeRtlSnapshotId(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (RTL_SNAPSHOT_ID_RE.test(s)) return s;
  return '';
}

function riyadhDateTimeParts(ms) {
  const d = new Date(Number(ms) || Date.now());
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hh: get('hour'),
    mm: get('minute'),
    ss: get('second'),
    ms: String(d.getMilliseconds()).padStart(3, '0')
  };
}

function makeRtlSnapshotId(at) {
  const t = Number(at) || Date.now();
  const p = riyadhDateTimeParts(t);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${p.dateKey}T${p.hh}-${p.mm}-${p.ss}-${p.ms}-${rand}`;
}

function rtlDailySnapshotPath(idOrDate) {
  const id = normalizeRtlSnapshotId(idOrDate) || normalizeDateKey(idOrDate);
  if (!id) return null;
  return path.join(RTL_DAILY_DIR, `${id}.json`);
}

function rtlDailyExcelPath(id) {
  const key = normalizeRtlSnapshotId(id);
  if (!key) return null;
  return path.join(RTL_DAILY_FILES_DIR, `${key}.xlsx`);
}

function migrateLegacyRtlDailyDir() {
  if (!LEGACY_RTL_DAILY_DIR || LEGACY_RTL_DAILY_DIR === RTL_DAILY_DIR) return;
  if (!fs.existsSync(LEGACY_RTL_DAILY_DIR)) return;
  ensureRtlDailyDirs();
  let names = [];
  try {
    names = fs.readdirSync(LEGACY_RTL_DAILY_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name || name.startsWith('.')) continue;
    const src = path.join(LEGACY_RTL_DAILY_DIR, name);
    const dest = path.join(RTL_DAILY_DIR, name);
    try {
      const st = fs.statSync(src);
      if (!st.isFile()) continue;
      if (fs.existsSync(dest)) continue;
      fs.copyFileSync(src, dest);
    } catch {
      /* ignore one file */
    }
  }
}

function readRtlSnapshotFile(fp, fallbackId) {
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const vehicles = Array.isArray(parsed.vehicles)
      ? parsed.vehicles.map(sanitizeRtlVehicle).filter(Boolean)
      : [];
    const id = normalizeRtlSnapshotId(parsed.id)
      || normalizeRtlSnapshotId(fallbackId)
      || normalizeDateKey(parsed.date)
      || normalizeDateKey(fallbackId)
      || '';
    if (!id) return null;
    const date = normalizeDateKey(parsed.date) || (DATE_KEY_RE.test(id.slice(0, 10)) ? id.slice(0, 10) : '');
    // Ages in a day file are relative to the schedule day it is assigned to (not upload time).
    const asOfDate = normalizeDateKey(parsed.asOfDate) || date;
    return {
      id,
      date,
      asOfDate,
      at: Number(parsed.at) || 0,
      fileName: String(parsed.fileName || ''),
      source: String(parsed.source || ''),
      excelSaved: Boolean(parsed.excelSaved),
      count: vehicles.length,
      vehicles
    };
  } catch {
    return null;
  }
}

function listRtlSnapshotIdsOnDisk() {
  ensureRtlDailyDirs();
  let names = [];
  try {
    names = fs.readdirSync(RTL_DAILY_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json') && n !== 'index.json')
    .map((n) => n.replace(/\.json$/i, ''))
    .filter((id) => normalizeRtlSnapshotId(id) || normalizeDateKey(id));
}

/** Newest snapshot id per calendar day (Riyadh date key). */
function deriveRtlActiveByDay(snapshots) {
  const byDay = {};
  const sorted = (Array.isArray(snapshots) ? snapshots : []).slice().sort(
    (a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id))
  );
  for (const s of sorted) {
    const d = normalizeDateKey(s.date) || (DATE_KEY_RE.test(String(s.id || '').slice(0, 10)) ? String(s.id).slice(0, 10) : '');
    if (!d || byDay[d]) continue;
    byDay[d] = s.id;
  }
  return byDay;
}

/**
 * Keep explicit Use-date / last-push pointers when still valid; fill gaps with newest-per-day.
 * Day semantics: one active RTL file per calendar day for schedule usage.
 */
function normalizeRtlActiveByDay(raw, snapshots) {
  const byId = new Map();
  for (const s of snapshots || []) {
    if (s && s.id) byId.set(s.id, s);
  }
  const out = {};
  const rawObj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const [date, id] of Object.entries(rawObj)) {
    const dk = normalizeDateKey(date);
    const sid = normalizeRtlSnapshotId(id) || normalizeDateKey(id);
    if (!dk || !sid) continue;
    const snap = byId.get(sid);
    if (!snap) continue;
    const snapDate = normalizeDateKey(snap.date) || (DATE_KEY_RE.test(String(snap.id).slice(0, 10)) ? String(snap.id).slice(0, 10) : '');
    if (snapDate && snapDate !== dk) continue;
    out[dk] = sid;
  }
  const derived = deriveRtlActiveByDay(snapshots);
  for (const [d, id] of Object.entries(derived)) {
    if (!out[d]) out[d] = id;
  }
  return out;
}

function resolveRtlActiveIdForDay(dateKey, index) {
  const dk = normalizeDateKey(dateKey);
  if (!dk) return '';
  const idx = index || loadRtlDailyIndex();
  const pointed = idx.activeByDay && idx.activeByDay[dk];
  if (pointed && (normalizeRtlSnapshotId(pointed) || normalizeDateKey(pointed))) return pointed;
  return deriveRtlActiveByDay(idx.snapshots)[dk] || '';
}

/** Rebuild index from disk so history survives a lost/corrupt index.json. */
function rebuildRtlDailyIndexFromDisk() {
  const snaps = [];
  for (const id of listRtlSnapshotIdsOnDisk()) {
    const snap = readRtlSnapshotFile(rtlDailySnapshotPath(id), id);
    if (!snap) continue;
    snaps.push({
      id: snap.id,
      date: snap.date,
      asOfDate: snap.asOfDate || snap.date,
      at: snap.at,
      count: snap.count,
      fileName: snap.fileName,
      source: snap.source,
      excelSaved: snap.excelSaved
    });
  }
  snaps.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id)));
  const activeByDay = deriveRtlActiveByDay(snaps);
  saveRtlDailyIndex({ snapshots: snaps, activeByDay });
  return { snapshots: snaps, activeByDay };
}

function loadRtlDailyIndex() {
  migrateLegacyRtlDailyDir();
  ensureRtlDailyDirs();
  try {
    if (!fs.existsSync(RTL_DAILY_INDEX)) {
      return rebuildRtlDailyIndexFromDisk();
    }
    const parsed = JSON.parse(fs.readFileSync(RTL_DAILY_INDEX, 'utf8'));
    let snapshots = Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
    // Normalize legacy entries (date-only) and merge any on-disk files missing from index.
    const byId = new Map();
    for (const s of snapshots) {
      const id = normalizeRtlSnapshotId(s.id) || normalizeDateKey(s.date) || normalizeDateKey(s.id);
      if (!id) continue;
      byId.set(id, {
        id,
        date: normalizeDateKey(s.date) || (DATE_KEY_RE.test(id.slice(0, 10)) ? id.slice(0, 10) : ''),
        asOfDate: normalizeDateKey(s.asOfDate)
          || normalizeDateKey(s.date)
          || (DATE_KEY_RE.test(id.slice(0, 10)) ? id.slice(0, 10) : ''),
        at: Number(s.at) || 0,
        count: Number(s.count) || 0,
        fileName: String(s.fileName || ''),
        source: String(s.source || ''),
        excelSaved: Boolean(s.excelSaved)
      });
    }
    const diskIds = listRtlSnapshotIdsOnDisk();
    let dirty = false;
    for (const id of diskIds) {
      if (byId.has(id)) continue;
      const snap = readRtlSnapshotFile(rtlDailySnapshotPath(id), id);
      if (!snap) continue;
      byId.set(id, {
        id: snap.id,
        date: snap.date,
        asOfDate: snap.asOfDate || snap.date,
        at: snap.at,
        count: snap.count,
        fileName: snap.fileName,
        source: snap.source,
        excelSaved: snap.excelSaved
      });
      dirty = true;
    }
    snapshots = [...byId.values()].sort(
      (a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id))
    );
    const activeByDay = normalizeRtlActiveByDay(parsed?.activeByDay, snapshots);
    const prevActive = parsed?.activeByDay && typeof parsed.activeByDay === 'object'
      ? JSON.stringify(parsed.activeByDay)
      : '';
    if (dirty || prevActive !== JSON.stringify(activeByDay)) {
      saveRtlDailyIndex({ snapshots, activeByDay });
    }
    return { snapshots, activeByDay };
  } catch {
    return rebuildRtlDailyIndexFromDisk();
  }
}

function saveRtlDailyIndex(index) {
  ensureRtlDailyDirs();
  const snapshots = Array.isArray(index?.snapshots) ? index.snapshots : [];
  const payload = {
    snapshots,
    activeByDay: normalizeRtlActiveByDay(index?.activeByDay, snapshots)
  };
  const tmp = `${RTL_DAILY_INDEX}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, RTL_DAILY_INDEX);
}

/** Mark a specific snapshot as the active RTL file for a calendar day (Use date).
 * Optional dateOverride reassigns the snapshot to another schedule day.
 * Ages (Col J) are treated as relative to that schedule day.
 */
function setRtlActiveSnapshot(idOrDate, dateOverride) {
  const direct = normalizeRtlSnapshotId(idOrDate);
  const snap = direct
    ? readRtlSnapshotFile(rtlDailySnapshotPath(direct), direct)
    : loadRtlDailySnapshot(idOrDate);
  if (!snap || !snap.id) return null;
  const override = normalizeDateKey(dateOverride);
  const prevDate = normalizeDateKey(snap.date);
  const date = override || prevDate;
  if (!date || !isValidRtlDateKey(date)) return null;

  // Pinning to a schedule day means this Excel is that day's stock extract → ages as-of that day.
  const asOfDate = date;

  if (prevDate !== date || normalizeDateKey(snap.asOfDate) !== asOfDate) {
    snap.date = date;
    snap.asOfDate = asOfDate;
    const fp = rtlDailySnapshotPath(snap.id);
    const tmp = `${fp}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap), 'utf8');
    fs.renameSync(tmp, fp);
  }

  const index = loadRtlDailyIndex();
  const snapshots = index.snapshots.map((s) => {
    if (s.id !== snap.id) return s;
    return { ...s, date, asOfDate };
  });
  if (!snapshots.some((s) => s.id === snap.id)) {
    snapshots.push({
      id: snap.id,
      date,
      asOfDate,
      at: snap.at,
      count: snap.count,
      fileName: snap.fileName,
      source: snap.source,
      excelSaved: snap.excelSaved
    });
  }
  const activeByDay = { ...(index.activeByDay || {}) };
  for (const [dk, sid] of Object.entries(activeByDay)) {
    if (sid === snap.id && dk !== date) delete activeByDay[dk];
  }
  activeByDay[date] = snap.id;
  const normalized = normalizeRtlActiveByDay(activeByDay, snapshots);
  normalized[date] = snap.id;
  saveRtlDailyIndex({ snapshots, activeByDay: normalized });
  const archivedExcel = rtlDailyExcelPath(snap.id);
  mirrorRtlActiveDayFiles(
    { ...snap, date, asOfDate, age0: snap.age0 },
    archivedExcel && fs.existsSync(archivedExcel) ? archivedExcel : ''
  );
  return {
    id: snap.id,
    date,
    asOfDate,
    at: snap.at,
    count: snap.count,
    fileName: snap.fileName,
    source: snap.source,
    activeByDay: normalized
  };
}

function sanitizeRtlVehicle(raw) {
  const vin = String(raw?.vin || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!vin || vin.length < 11) return null;
  const detailsIn = raw?.details && typeof raw.details === 'object' ? raw.details : null;
  const details = {};
  if (detailsIn) {
    for (const [k, v] of Object.entries(detailsIn)) {
      const key = String(k || '').trim();
      if (!key || key.length > 80) continue;
      const val = String(v ?? '').trim();
      if (!val) continue;
      details[key] = val.slice(0, 240);
      if (Object.keys(details).length >= 40) break;
    }
  }
  return {
    vin,
    product: String(raw?.product || '').trim(),
    suffix: String(raw?.suffix || '').trim(),
    year: String(raw?.year || '').trim(),
    ext: String(raw?.ext || '').trim(),
    int: String(raw?.int || '').trim(),
    age: String(raw?.age ?? raw?.ageing ?? '').trim(),
    usage: String(raw?.usage || '').trim(),
    status: String(raw?.status || '').trim(),
    secondaryStatus: String(raw?.secondaryStatus || '').trim(),
    location: String(raw?.location || '').trim(),
    vehicleSearchArea: String(raw?.vehicleSearchArea || raw?.searchAreaDesc || '').trim(),
    details
  };
}

function rtlNormHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, ' ')
    .replace(/[^\w\u0600-\u06ff ]+/g, '')
    .trim();
}

function rtlCellToString(value) {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function rtlExtractVin(raw) {
  const cleaned = rtlCellToString(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  const m = cleaned.match(/[A-HJ-NPR-Z0-9]{17}/) || cleaned.match(/[A-Z0-9]{17}/);
  return m ? m[0] : (cleaned.length >= 11 ? cleaned : '');
}

function rtlColLetterToIndex(letter) {
  const s = String(letter || '').toUpperCase().replace(/[^A-Z]/g, '');
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = n * 26 + (s.charCodeAt(i) - 64);
  return Math.max(0, n - 1);
}

function rtlResolveCol(headers, tests, fallbackLetter) {
  const idx = headers.findIndex((h) => tests.some((t) => t(rtlNormHeader(h))));
  if (idx >= 0) return idx;
  return rtlColLetterToIndex(fallbackLetter);
}

/** Scan RTL workbook buffer → unique VIN rows with location + vehicle search area. */
function scanRtlStockBuffer(buffer) {
  if (!buffer || !buffer.length) return [];
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    return [];
  }
  const names = wb.SheetNames || [];
  if (!names.length) return [];
  // Prefer an RTL / stock sheet when workbooks include cover tabs.
  const sheetName =
    names.find((n) => /rtl/i.test(String(n || '')))
    || names.find((n) => /stock|مخزون|retail/i.test(String(n || '')))
    || names[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) return [];

  let headerIdx = 0;
  let bestHits = -1;
  for (let r = 0; r < Math.min(matrix.length, 25); r += 1) {
    const row = matrix[r] || [];
    let hits = 0;
    for (const cell of row) {
      const n = rtlNormHeader(cell);
      if (!n) continue;
      if (n === 'vin' || n.includes('vin') || n.includes('chassis')) hits += 2;
      if (n === 'product' || n.includes('product')) hits += 1;
      if (n === 'suffix' || n.includes('suffix') || n.includes('sfx')) hits += 1;
      if (n.includes('search area') || n.includes('vehicle search')) hits += 1;
      if (n.includes('location') || n.includes('allocated')) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      headerIdx = r;
    }
    if (hits >= 4) break;
  }

  const headerRow = matrix[headerIdx] || [];
  const width = Math.max(headerRow.length, rtlColLetterToIndex('Q') + 1, 12);
  const headers = [];
  for (let i = 0; i < width; i += 1) {
    headers.push(rtlCellToString(headerRow[i]) || `Column ${i + 1}`);
  }

  const idxProduct = rtlResolveCol(headers, [
    (n) => n === 'product' || n === 'model' || n === 'vehicle model',
    (n) => n.includes('product')
  ], 'B');
  const idxVin = rtlResolveCol(headers, [
    (n) => n === 'vin' || n === 'chassis' || n === 'chassis no' || n === 'chassis number',
    (n) => n.includes('vin')
  ], 'E');
  const idxSuffix = rtlResolveCol(headers, [
    (n) => n === 'suffix' || n === 'sfx' || n === 'alj suffix' || n === 'grade',
    (n) => n.includes('suffix') || n.includes('sfx')
  ], 'G');
  const idxYear = rtlResolveCol(headers, [
    (n) => n === 'year' || n === 'model year' || n === 'my',
    (n) => n.includes('year')
  ], 'F');
  const idxExt = rtlResolveCol(headers, [
    (n) => n === 'ext' || n === 'exterior' || n === 'exterior color' || n === 'ext color',
    (n) => n.includes('exterior') || n === 'ext'
  ], 'H');
  const idxInt = rtlResolveCol(headers, [
    (n) => n === 'int' || n === 'interior' || n === 'interior color' || n === 'int color',
    (n) => n.includes('interior') || n === 'int'
  ], 'I');
  const idxAge = rtlResolveCol(headers, [
    (n) => n === 'age' || n === 'ageing' || n === 'aging' || n === 'stock age',
    (n) => n.includes('age')
  ], 'J');
  const idxUsage = rtlResolveCol(headers, [
    (n) => n === 'usage' || n === 'usage desc' || n === 'usage description',
    (n) => n.includes('usage')
  ], 'K');
  const idxStatus = rtlResolveCol(headers, [
    (n) => n === 'status' || n === 'primary status' || n === 'vehicle status',
    (n) => n === 'status' || n.includes('primary status')
  ], 'D');
  const idxSecondary = rtlResolveCol(headers, [
    (n) => n === 'secondary status' || n === 'sec status',
    (n) => n.includes('secondary status')
  ], 'L');
  const idxLocation = rtlResolveCol(headers, [
    (n) => n === 'allocated location' || n === 'location' || n === 'loc',
    (n) => n.includes('allocated location') || (n.includes('location') && !n.includes('search'))
  ], 'Q');
  const idxSearch = rtlResolveCol(headers, [
    (n) => n === 'vehicle search area' || n === 'search area desc' || n === 'search area',
    (n) => n.includes('vehicle search') || n.includes('search area')
  ], 'P');

  const seen = new Set();
  const vehicles = [];
  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const line = matrix[r] || [];
    const vin = rtlExtractVin(line[idxVin]);
    if (!vin || seen.has(vin)) continue;
    seen.add(vin);
    const details = {};
    headers.forEach((h, i) => {
      const val = rtlCellToString(line[i]);
      if (!val) return;
      details[h] = val;
    });
    const v = sanitizeRtlVehicle({
      vin,
      product: rtlCellToString(line[idxProduct]),
      suffix: rtlCellToString(line[idxSuffix]),
      year: rtlCellToString(line[idxYear]),
      ext: rtlCellToString(line[idxExt]),
      int: rtlCellToString(line[idxInt]),
      age: rtlCellToString(line[idxAge]),
      usage: rtlCellToString(line[idxUsage]),
      status: rtlCellToString(line[idxStatus]),
      secondaryStatus: rtlCellToString(line[idxSecondary]),
      location: rtlCellToString(line[idxLocation]),
      vehicleSearchArea: rtlCellToString(line[idxSearch]),
      details
    });
    if (v) vehicles.push(v);
  }
  return vehicles;
}

/**
 * Append-only snapshot. Never overwrites an existing id.
 * Optional excelBuffer stores the original RTL workbook beside the JSON.
 */
function persistRtlDailySnapshot({ dateKey, vehicles, fileName, source, excelBuffer, at: atIn } = {}) {
  ensureRtlDailyDirs();
  const at = Number(atIn) || Date.now();
  const date = normalizeDateKey(dateKey) || riyadhDateTimeParts(at).dateKey;
  let id = makeRtlSnapshotId(at);
  // Extremely unlikely collision — bump until free.
  while (fs.existsSync(rtlDailySnapshotPath(id))) {
    id = makeRtlSnapshotId(Date.now());
  }

  const seen = new Set();
  const list = [];
  for (const raw of vehicles || []) {
    const v = sanitizeRtlVehicle(raw);
    if (!v || seen.has(v.vin)) continue;
    seen.add(v.vin);
    list.push(v);
  }

  let excelSaved = false;
  let savedExcelPath = '';
  if (excelBuffer && Buffer.isBuffer(excelBuffer) && excelBuffer.length) {
    const xfp = rtlDailyExcelPath(id);
    const xtmp = `${xfp}.${process.pid}.tmp`;
    fs.writeFileSync(xtmp, excelBuffer);
    fs.renameSync(xtmp, xfp);
    excelSaved = true;
    savedExcelPath = xfp;
  }

  const name = String(fileName || '').trim();
  // Schedule day = day chosen in Data Uploader (or today for Admin Push).
  // Col J ages in that Excel are relative to that same schedule day → age 0 = arrivals that day.
  const uploadedOn = riyadhDateTimeParts(at).dateKey;
  const asOfDate = date;
  const age0 = list.filter((v) => {
    const a = String(v?.age ?? '').trim();
    if (!a) return true;
    const n = Number(String(a).replace(/[, ]/g, ''));
    return Number.isFinite(n) ? n === 0 : a === '0';
  }).length;
  const snap = {
    id,
    date,
    asOfDate,
    uploadedOn,
    at,
    fileName: name,
    source: String(source || '').trim(),
    excelSaved,
    count: list.length,
    age0,
    vehicles: list
  };
  const fp = rtlDailySnapshotPath(id);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap), 'utf8');
  fs.renameSync(tmp, fp);

  const index = loadRtlDailyIndex();
  const entry = {
    id,
    date,
    asOfDate,
    at,
    count: list.length,
    age0,
    fileName: name,
    source: snap.source,
    excelSaved
  };
  // Append — never replace prior snapshots (same calendar day keeps all pushes).
  const rest = index.snapshots.filter((s) => s.id !== id);
  rest.push(entry);
  rest.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id)));
  // Active file for that calendar day = this push/save (last file wins).
  const activeByDay = { ...(index.activeByDay || {}) };
  activeByDay[date] = id;
  saveRtlDailyIndex({ snapshots: rest, activeByDay });
  // Stable by-day Excel mirror (same durability idea as Admin live files/rtl.xlsx).
  mirrorRtlActiveDayFiles(snap, savedExcelPath);
  return snap;
}

function loadRtlDailySnapshot(idOrDate) {
  const direct = normalizeRtlSnapshotId(idOrDate);
  if (direct) {
    const snap = readRtlSnapshotFile(rtlDailySnapshotPath(direct), direct);
    if (snap) return snap;
  }
  const dateKey = normalizeDateKey(idOrDate);
  if (!dateKey) return null;
  // Prefer explicit active pointer for the day (Use date / last push).
  const index = loadRtlDailyIndex();
  const activeId = resolveRtlActiveIdForDay(dateKey, index);
  if (activeId) {
    const activeSnap = readRtlSnapshotFile(rtlDailySnapshotPath(activeId), activeId);
    if (activeSnap) return activeSnap;
  }
  // Legacy single-file-per-day
  const legacy = readRtlSnapshotFile(rtlDailySnapshotPath(dateKey), dateKey);
  if (legacy) return legacy;
  // Newest snapshot for that calendar day
  const matches = index.snapshots.filter((s) => s.date === dateKey);
  if (!matches.length) return null;
  matches.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id)));
  const newest = matches[0];
  return readRtlSnapshotFile(rtlDailySnapshotPath(newest.id), newest.id);
}

/** True when YYYY-MM-DD is a real calendar day (local parts, no UTC shift). */
function isValidRtlDateKey(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, mo - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d;
}

/**
 * Active RTL snapshot per calendar day for a YYYY-MM month (vehicles included).
 * Schedule day N uses only the active file for that calendar day
 * (last push/save that day, or the file pinned with Use date).
 */
function loadRtlActiveMonth(monthKey) {
  const mk = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mk)) return null;
  const index = loadRtlDailyIndex();
  const days = {};
  const activeByDay = {};
  for (let day = 1; day <= 31; day += 1) {
    const dateKey = `${mk}-${String(day).padStart(2, '0')}`;
    if (!isValidRtlDateKey(dateKey)) continue;
    const id = resolveRtlActiveIdForDay(dateKey, index);
    if (!id) continue;
    const snap = readRtlSnapshotFile(rtlDailySnapshotPath(id), id);
    if (!snap) continue;
    activeByDay[dateKey] = snap.id;
    days[dateKey] = {
      id: snap.id,
      date: snap.date || dateKey,
      asOfDate: snap.asOfDate || snap.date || dateKey,
      at: snap.at,
      count: snap.count,
      age0: Number.isFinite(Number(snap.age0))
        ? Number(snap.age0)
        : (snap.vehicles || []).filter((v) => {
          const a = String(v?.age ?? '').trim();
          if (!a) return true;
          const n = Number(String(a).replace(/[, ]/g, ''));
          return Number.isFinite(n) ? n === 0 : a === '0';
        }).length,
      fileName: snap.fileName,
      source: snap.source,
      excelSaved: snap.excelSaved,
      vehicles: snap.vehicles || []
    };
  }
  return { month: mk, days, activeByDay };
}

function listRtlSnapshotsNewestFirst() {
  return loadRtlDailyIndex().snapshots.slice().sort(
    (a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id))
  );
}

/** Newest-first last-seen map for every VIN across all historical RTL snapshots. */
function buildRtlDailyLastSeenIndex() {
  const entries = listRtlSnapshotsNewestFirst();
  const lastSeen = {};
  const dates = [];
  const seenDates = new Set();
  for (const entry of entries) {
    const snap = loadRtlDailySnapshot(entry.id || entry.date);
    if (!snap) continue;
    if (snap.date && !seenDates.has(snap.date)) {
      seenDates.add(snap.date);
      dates.push(snap.date);
    }
    for (const v of snap.vehicles || []) {
      if (!v.vin || lastSeen[v.vin]) continue;
      lastSeen[v.vin] = {
        snapshotId: snap.id,
        date: snap.date,
        at: snap.at,
        product: v.product || '',
        suffix: v.suffix || '',
        year: v.year || '',
        location: v.location || '',
        vehicleSearchArea: v.vehicleSearchArea || '',
        status: v.status || '',
        secondaryStatus: v.secondaryStatus || '',
        usage: v.usage || '',
        age: v.age || ''
      };
    }
  }
  return { snapshotCount: entries.length, dates, lastSeen };
}

function compareRtlSnapshots(fromSnap, toSnap) {
  const fromMap = new Map((fromSnap?.vehicles || []).map((v) => [v.vin, v]));
  const toMap = new Map((toSnap?.vehicles || []).map((v) => [v.vin, v]));
  const added = [];
  const removed = [];
  const changed = [];
  const same = [];

  for (const [vin, to] of toMap) {
    const from = fromMap.get(vin);
    if (!from) {
      added.push(to);
      continue;
    }
    if (
      from.product !== to.product
      || from.suffix !== to.suffix
      || from.location !== to.location
      || from.vehicleSearchArea !== to.vehicleSearchArea
    ) {
      changed.push({
        vin,
        fromProduct: from.product,
        fromSuffix: from.suffix,
        fromLocation: from.location,
        fromVehicleSearchArea: from.vehicleSearchArea,
        toProduct: to.product,
        toSuffix: to.suffix,
        toLocation: to.location,
        toVehicleSearchArea: to.vehicleSearchArea
      });
    } else {
      same.push(to);
    }
  }
  for (const [vin, from] of fromMap) {
    if (!toMap.has(vin)) removed.push(from);
  }

  return {
    fromId: fromSnap?.id || '',
    toId: toSnap?.id || '',
    fromDate: fromSnap?.date || '',
    toDate: toSnap?.date || '',
    fromCount: fromSnap?.count || 0,
    toCount: toSnap?.count || 0,
    added,
    removed,
    changed,
    same,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      same: same.length
    }
  };
}

function persistAndBroadcast() {
  saveStore();
  broadcastHubUpdate();
}

/** Resolve Delivery Team الناقل → existing coordinator company board name. */
function resolveCoordinatorCompanyFromCarrier(carrier) {
  const mapped = mapCarrierToCoordinatorCompany(carrier);
  if (!mapped) return '';
  ensureOptions();
  const key = companyNameKey(mapped);
  const companies = store.options.companies || [];
  const exact = companies.find((c) => companyNameKey(c) === key);
  if (exact) return exact;
  const compact = key.replace(/^شركه?\s+/, '').replace(/^ال/, '');
  const fuzzy = companies.find((c) => {
    const ck = companyNameKey(c).replace(/^شركه?\s+/, '').replace(/^ال/, '');
    return ck === compact || (compact.length >= 3 && (ck.includes(compact) || compact.includes(ck)));
  });
  return fuzzy || mapped;
}

/** الناقل / carrier text from a Delivery Team vehicle (ops first, then raw). */
function teamVehicleCarrier(teamVehicle) {
  const ops = (teamVehicle && teamVehicle.ops) || {};
  const raw = (teamVehicle && teamVehicle.raw) || {};
  return String(
    teamVehicle.carrier
    || ops.carrier
    || raw.carrier
    || raw.transporter
    || ''
  ).trim();
}

function teamVehicleTransferCity(teamVehicle) {
  const ops = (teamVehicle && teamVehicle.ops) || {};
  const raw = (teamVehicle && teamVehicle.raw) || {};
  return String(
    teamVehicle.transferCity
    || ops.transferCity
    || raw.transferCity
    || ''
  ).trim();
}

function upsertHubVehicleFromTeamVehicle(teamVehicle) {
  const vin = normVin(teamVehicle && (teamVehicle.vin || (teamVehicle.raw && teamVehicle.raw.vin)));
  if (!vin) return null;
  const raw = (teamVehicle && teamVehicle.raw) || {};
  const next = {
    vin,
    product: String(raw.product || '').trim(),
    model: String(raw.product || '').trim(),
    gt: String(raw.gtLocation || '').trim(),
    location: String(raw.vehicleLocation || '').trim(),
    plate: '',
    customerName: String(raw.userName || '').trim(),
    phone: String(raw.phone || '').trim(),
    imageUrl: '',
    suffix: '',
    proformaDate: String(raw.proformaDate || '').trim(),
    invoiceDate: '',
    deliveryNoteDate: String(raw.deliveryDate || '').trim(),
  };
  if (!Array.isArray(store.vehicles)) store.vehicles = [];
  const idx = store.vehicles.findIndex((v) => normVin(v.vin) === vin);
  if (idx >= 0) {
    const prev = store.vehicles[idx];
    store.vehicles[idx] = {
      ...prev,
      ...next,
      product: next.product || prev.product || '',
      model: next.model || prev.model || prev.product || '',
      gt: next.gt || prev.gt || '',
      location: next.location || prev.location || '',
      customerName: next.customerName || prev.customerName || '',
      phone: next.phone || prev.phone || '',
      proformaDate: next.proformaDate || prev.proformaDate || '',
      deliveryNoteDate: next.deliveryNoteDate || prev.deliveryNoteDate || '',
    };
    return store.vehicles[idx];
  }
  store.vehicles.push(next);
  return next;
}

/** Resolve Delivery Team مدينة الترحيل → coordinator branch/city option. */
function resolveCoordinatorCityFromTeam(city) {
  const name = String(city || '').trim();
  if (!name) return '';
  ensureOptions();
  const key = companyNameKey(name);
  const cities = store.options.cities || [];
  const exact = cities.find((c) => companyNameKey(c) === key);
  if (exact) return exact;
  const compact = key.replace(/^ال/, '');
  const fuzzy = cities.find((c) => {
    const ck = companyNameKey(c).replace(/^ال/, '');
    return ck === compact || (compact.length >= 2 && (ck.includes(compact) || compact.includes(ck)));
  });
  if (fuzzy) return fuzzy;
  store.options.cities = uniqueSorted([...cities, name]);
  return name;
}

function applyTeamCityToQueueItem(item, transferCity) {
  if (!item) return false;
  const city = resolveCoordinatorCityFromTeam(transferCity);
  if (!city) return false;
  if (String(item.plannedBranch || '').trim() === city) return false;
  item.plannedBranch = city;
  return true;
}

/**
 * When Hanouf / Rasha (or any team user) sets الناقل and/or مدينة الترحيل,
 * push VIN onto that company board and stamp plannedBranch for لوحة الترحيل.
 * Also re-assigns queue rows that are still «بدون شركة» when الناقل is already on the sheet.
 */
function syncTeamCarriersToCoordinator(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { added: 0, reassigned: 0, skipped: 0, same: 0, cityUpdated: 0 };
  ensureOptions();
  store.queue = dedupeQueue(store.queue || []);
  const now = new Date().toISOString();
  let added = 0;
  let reassigned = 0;
  let skipped = 0;
  let same = 0;
  let cityUpdated = 0;

  for (const item of list) {
    const vin = normVin(item.vin || (item.raw && item.raw.vin) || (item.vehicle && item.vehicle.vin));
    const carrier = teamVehicleCarrier(item.vehicle ? { ...item, ...item.vehicle, ops: item.ops || item.vehicle.ops, raw: item.raw || item.vehicle.raw } : item);
    const transferCity = teamVehicleTransferCity(item.vehicle ? { ...item, ...item.vehicle, ops: item.ops || item.vehicle.ops, raw: item.raw || item.vehicle.raw } : item);
    if (!vin) {
      skipped += 1;
      continue;
    }

    // City-only update when VIN already on a board
    if (!carrier) {
      const existingOnly = findQueueItem(vin);
      if (existingOnly && transferCity && applyTeamCityToQueueItem(existingOnly, transferCity)) {
        cityUpdated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const deliveryCompany = resolveCoordinatorCompanyFromCarrier(carrier);
    if (!deliveryCompany) {
      skipped += 1;
      continue;
    }
    const existsOpt = (store.options.companies || []).some(
      (x) => companyNameKey(x) === companyNameKey(deliveryCompany)
    );
    if (!existsOpt) {
      store.options.companies = uniqueSorted([...(store.options.companies || []), deliveryCompany]);
    }

    const hubVeh = upsertHubVehicleFromTeamVehicle(item.vehicle || item);
    const existingItem = findQueueItem(vin);
    if (existingItem) {
      const prevCompany = String(existingItem.deliveryCompany || existingItem.company || '').trim();
      const wasUnassigned = isUnassignedDeliveryCompany(existingItem);
      const sameCompany = !wasUnassigned
        && prevCompany
        && companyNameKey(prevCompany) === companyNameKey(deliveryCompany);

      if (sameCompany) {
        if (transferCity && applyTeamCityToQueueItem(existingItem, transferCity)) cityUpdated += 1;
        same += 1;
        continue;
      }

      // بدون شركة / empty / different company → apply الناقل from Delivery Team sheet
      existingItem.deliveryCompany = deliveryCompany;
      existingItem.company = deliveryCompany;
      existingItem.plannedDeliveryMode = 'memo';
      if (transferCity && applyTeamCityToQueueItem(existingItem, transferCity)) cityUpdated += 1;
      if (hubVeh) Object.assign(existingItem, enrichFromVehicle(existingItem, hubVeh));
      // keep deliveryCompany after enrich (enrich does not clear it, but be explicit)
      existingItem.deliveryCompany = deliveryCompany;
      existingItem.company = deliveryCompany;
      reassigned += 1;
      continue;
    }

    const base = {
      vin,
      status: 'available',
      agentStatus: '',
      assignedTo: '',
      addedAt: now,
      assignedAt: '',
      deliveryCompany,
      plannedDeliveryMode: 'memo',
      company: deliveryCompany,
      plannedBranch: transferCity ? resolveCoordinatorCityFromTeam(transferCity) : '',
      source: 'delivery-team',
      sourceBy: item.by || '',
    };
    store.queue.push(enrichFromVehicle(base, hubVeh));
    added += 1;
  }

  if (added || reassigned || cityUpdated) persistAndBroadcast();
  return { added, reassigned, skipped, same, cityUpdated };
}

/** Merge all Delivery Team vehicles into hub inventory + sync carriers to boards. */
function syncTeamRawToHubInventory(teamStore) {
  const src = teamStore || deliveryTeamStore;
  if (!src || typeof src.allVehicles !== 'function') {
    return { upserted: 0, carriers: null };
  }
  const all = src.allVehicles() || [];
  let upserted = 0;
  for (const v of all) {
    if (upsertHubVehicleFromTeamVehicle(v)) upserted += 1;
  }
  const carrierItems = all
    .filter((v) => v && (teamVehicleCarrier(v) || teamVehicleTransferCity(v)))
    .map((v) => ({
      vin: v.vin,
      carrier: teamVehicleCarrier(v),
      transferCity: teamVehicleTransferCity(v),
      raw: v.raw,
      ops: v.ops,
      by: 'delivery-team-sync',
    }));
  const carriers = syncTeamCarriersToCoordinator(carrierItems);
  if (upserted && !(carriers.added || carriers.reassigned || carriers.cityUpdated)) persistAndBroadcast();
  return { upserted, carriers };
}

/** Push hub Sales Raw vehicles into Delivery Team store (preserve ops). */
function syncHubVehiclesToDeliveryTeam(vehicles) {
  if (!deliveryTeamStore || typeof deliveryTeamStore.upsertVehicle !== 'function') {
    return { upserted: 0 };
  }
  const list = Array.isArray(vehicles) ? vehicles : [];
  let upserted = 0;
  for (const veh of list) {
    const vin = normVin(veh && veh.vin);
    if (!vin) continue;
    const rawPatch = {
      vin,
      product: String(veh.product || veh.model || '').trim(),
      userName: String(veh.customerName || '').trim(),
      phone: String(veh.phone || '').trim(),
      gtLocation: String(veh.gt || '').trim(),
      vehicleLocation: String(veh.location || '').trim(),
      proformaDate: String(veh.proformaDate || '').trim(),
      deliveryDate: String(veh.deliveryNoteDate || '').trim(),
      salesOrder: '',
      salesType: '',
      invoiceOwner: '',
      salesAdvisor: '',
      pic: '',
      status: '',
      traffic: '',
      trafficFees: '',
      insurance: '',
      registrationDate: '',
      date: '',
      year: '',
    };
    const existing = deliveryTeamStore.getVehicle(vin);
    if (!existing) {
      const emptyOps = {
        guestSentDate: '', signatureReceivedDate: '', accountsSentDate: '', accountsApprovalDate: '',
        vin1502: '', opsStatus: '', trafficFile: '', trafficFeesOps: '', insuranceOps: '',
        registrationIssueDate: '', transferCity: '', carrier: '', notes: '',
        assignedEmployeeId: '', assignedEmployeeName: '', assignedBy: '', assignedAt: '',
        guestCenter: '', guestCollectAt: '', guestCollected: '', guestCollectNote: '',
        updatedBy: '', updatedAt: '',
      };
      deliveryTeamStore.upsertVehicle(vin, {
        vin,
        raw: rawPatch,
        ops: emptyOps,
        createdAt: new Date().toISOString(),
        rawUpdatedAt: new Date().toISOString(),
        lastUploadId: 'hub-sync',
      });
    } else {
      const merged = { ...existing.raw };
      Object.keys(rawPatch).forEach((k) => {
        if (rawPatch[k]) merged[k] = rawPatch[k];
      });
      existing.raw = merged;
      existing.rawUpdatedAt = new Date().toISOString();
      deliveryTeamStore.upsertVehicle(vin, existing);
    }
    upserted += 1;
  }
  if (upserted) deliveryTeamStore.save();
  return { upserted };
}

/**
 * VIN → company name from Print Drafts (Company Name / company_rep).
 * Unassigned / empty companies are omitted (caller leaves الناقل empty).
 */
function buildCompanyByVinFromDrafts(drafts) {
  const map = new Map();
  for (const d of Array.isArray(drafts) ? drafts : []) {
    const payload = d.payload || {};
    let company = String(payload.company_rep || d.customerName || '').trim();
    if (isShowroomDraftPayload(payload) || d.showroomDisplay) {
      company = company || SHOWROOM_SPECIAL_NAME || '';
    } else if (payload.deliveryMode === 'warehouse' || payload.warehouse_group) {
      company = 'مستودع الهاتفية';
    }
    if (!company || isUnassignedDeliveryCompany({ company, deliveryCompany: company })) {
      // Explicitly mark as empty so Live Sheet clears الناقل
      const vins = collectDraftVins(payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]);
      vins.forEach((vin) => {
        if (vin && !map.has(vin)) map.set(vin, '');
      });
      continue;
    }
    const vins = collectDraftVins(payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]);
    vins.forEach((vin) => {
      if (!vin) return;
      map.set(vin, company);
    });
  }
  return map;
}

/**
 * Stamp Delivery Team Live Sheet الناقل from Print Drafts for every dashboard VIN.
 * Matched company → الناقل (short carrier name when known). Unmatched / unassigned → empty.
 */
function syncPrintDraftCompaniesToDeliveryTeam(drafts) {
  if (!deliveryTeamStore || typeof deliveryTeamStore.allVehicles !== 'function') {
    return { updated: 0, cleared: 0, matched: 0, scanned: 0, draftVins: 0 };
  }
  const byVin = buildCompanyByVinFromDrafts(
    drafts != null ? drafts : (store.drafts || [])
  );
  const all = deliveryTeamStore.allVehicles() || [];
  const now = new Date().toISOString();
  let updated = 0;
  let cleared = 0;
  let matched = 0;
  let scanned = 0;

  for (const v of all) {
    const vin = normVin(v && v.vin);
    if (!vin) continue;
    scanned += 1;
    const hasDraft = byVin.has(vin);
    const company = hasDraft ? byVin.get(vin) : '';
    // Only rewrite when drafts are present for this run; for full dashboard pass
    // every VIN is looked up — no draft ⇒ empty الناقل
    const carrier = company ? mapCoordinatorCompanyToCarrier(company) : '';
    if (!v.ops) v.ops = {};
    const prev = String(v.ops.carrier || '').trim();
    const next = String(carrier || '').trim();
    if (prev === next) {
      if (next) matched += 1;
      continue;
    }
    v.ops.carrier = next;
    v.ops.updatedAt = now;
    v.ops.updatedBy = 'print-drafts';
    deliveryTeamStore.upsertVehicle(vin, v);
    if (next) {
      updated += 1;
      matched += 1;
    } else {
      cleared += 1;
    }
  }

  if (updated || cleared) deliveryTeamStore.save();
  return {
    updated,
    cleared,
    matched,
    scanned,
    draftVins: byVin.size,
  };
}

deliveryTeamHooks.onCarrierAssigned = (items) => syncTeamCarriersToCoordinator(items);
deliveryTeamHooks.onRawUploaded = (payload) => {
  const hub = syncTeamRawToHubInventory(payload && payload.store);
  // After Delivery sheet upload, stamp الناقل from Print Drafts when archive drafts exist
  const draftCarriers = (store.drafts && store.drafts.length)
    ? syncPrintDraftCompaniesToDeliveryTeam(store.drafts)
    : null;
  return { ...hub, draftCarriers };
};
let lastDraftCarrierSyncAt = 0;
deliveryTeamHooks.onEnsureDraftCarriers = () => {
  if (!store.drafts || !store.drafts.length) return null;
  const now = Date.now();
  // Throttle — Live Sheet polls often; still heals within ~45s after deploy / archive restore
  if (now - lastDraftCarrierSyncAt < 45_000) return null;
  lastDraftCarrierSyncAt = now;
  return syncPrintDraftCompaniesToDeliveryTeam(store.drafts);
};

function getHubRawStatus() {
  const uploadedAt = store.meta?.uploadedAt || null;
  return {
    uploaded: Boolean((store.vehicles && store.vehicles.length) || uploadedAt),
    uploadedAt,
    uploadedBy: store.meta?.uploadedBy || '',
    uploadedByName: store.meta?.uploadedByName || '',
    filename: store.meta?.filename || '',
    sheetName: store.meta?.sheetName || '',
    vehicleCount: Array.isArray(store.vehicles) ? store.vehicles.length : 0,
  };
}

deliveryTeamHooks.getHubRawStatus = () => getHubRawStatus();

/** Hanouf / Ruba / Admin — upload Sales Raw once; hub + Delivery Team all see the same timestamp. */
deliveryTeamHooks.onSalesRawUpload = ({ buffer, filename, byUser } = {}) => {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    const err = new Error('Invalid file — empty upload');
    err.status = 400;
    throw err;
  }
  const name = String(filename || 'Sales Raw Data.xlsx').trim() || 'Sales Raw Data.xlsx';
  const parsed = parseSalesWorkbook(buffer, name);
  if (!parsed.vehicles.length) {
    const err = new Error('لم يتم العثور على أرقام شاسيه في الملف');
    err.status = 400;
    throw err;
  }
  const byId = String((byUser && (byUser.userId || byUser.id)) || '').trim();
  const byName = String((byUser && byUser.name) || '').trim();
  const hasDrafts = Array.isArray(parsed.drafts) && parsed.drafts.length > 0;
  const hasQueue = Array.isArray(parsed.queue) && parsed.queue.length > 0;
  const refresh = applyParsedInventory(parsed, {
    replaceDrafts: Boolean(parsed.isExport && hasDrafts),
    replaceQueue: Boolean(parsed.isExport && hasQueue),
    uploadedBy: byId,
    uploadedByName: byName,
  });
  const teamSync = syncHubVehiclesToDeliveryTeam(parsed.vehicles || []);
  persistAndBroadcast();
  return {
    ok: true,
    imported: parsed.vehicles.length,
    sheetName: parsed.sheetName,
    filename: parsed.filename || name,
    queueRefreshed: refresh.total,
    matchedUpdated: refresh.matched,
    notInNewFile: refresh.missing,
    companiesFromDrafts: refresh.draftsApplied?.assigned || 0,
    teamCarriersFromDrafts: refresh.teamDraftCarriers || null,
    deliveryTeamSync: teamSync,
    rawStatus: getHubRawStatus(),
  };
};

function todayIsoRiyadh() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * When the Riyadh calendar day rolls over:
 * - Prior days keep their last active snapshot (Admin Push / Uploader).
 * - If yesterday has no day file yet but live RTL is on disk, snapshot it as yesterday
 *   so the ended day is locked with that extract (age 0 = that day's arrivals).
 */
function ensureRtlDayRollover() {
  try {
    ensureRtlDailyDirs();
    const today = todayIsoRiyadh();
    const statePath = path.join(RTL_DAILY_DIR, 'rollover.json');
    let prev = '';
    try {
      if (fs.existsSync(statePath)) {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        prev = normalizeDateKey(parsed && parsed.dateKey) || '';
      }
    } catch {
      prev = '';
    }
    if (prev === today) return { ok: true, today, rolled: false };

    if (prev && prev < today) {
      const ended = prev;
      const hasEnded = Boolean(resolveRtlActiveIdForDay(ended));
      if (!hasEnded) {
        const liveRtl = reportSheetFilePath('rtl');
        if (liveRtl && fs.existsSync(liveRtl)) {
          try {
            const buf = fs.readFileSync(liveRtl);
            const vehicles = scanRtlStockBuffer(buf);
            if (vehicles.length) {
              persistRtlDailySnapshot({
                dateKey: ended,
                vehicles,
                fileName: 'day-end-rollover.xlsx',
                source: 'day-end-rollover',
                excelBuffer: buf
              });
            }
          } catch (err) {
            console.error('[rtl-daily] day-end rollover snapshot failed', err);
          }
        }
      }
    }

    const tmp = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ dateKey: today, at: Date.now() }, null, 2), 'utf8');
    fs.renameSync(tmp, statePath);
    return { ok: true, today, rolled: Boolean(prev && prev < today), ended: prev && prev < today ? prev : '' };
  } catch (err) {
    console.error('[rtl-daily] ensureRtlDayRollover', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function companyNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameCompanyName(a, b) {
  const ka = companyNameKey(a);
  const kb = companyNameKey(b);
  return Boolean(ka && kb && ka === kb);
}

/** Automall destination city (اوتومول / الاوتومول / …). */
function isAutomallCity(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return false;
  s = s.replace(/\s+/g, '').replace(/[ـ_]/g, '');
  // strip leading ال
  if (s.startsWith('ال')) s = s.slice(2);
  if (s === 'اوتومول' || s === 'أوتومول' || s === 'اوتمول' || s === 'automall' || s === 'auto mall') {
    return true;
  }
  return s.includes('اوتومول') || s.includes('أوتومول') || s.includes('automall');
}

const AUTOMALL_CITY_LABEL = 'اوتومول';

/**
 * When an agent prints with a different company than the coordinator assigned,
 * move the VIN to the new company and record from → to for admin/coordinator labels.
 */
function applyAgentCompanyChange(vins, typedCompany, { warehouseDelivery = false, showroomDisplay = false } = {}) {
  const to = String(typedCompany || '').trim();
  if (!to || warehouseDelivery || showroomDisplay) return [];
  const changes = [];
  const nowIso = new Date().toISOString();
  for (const vin of vins) {
    const item = findQueueItem(vin);
    if (!item) continue;
    const from = String(item.deliveryCompany || item.company || '').trim();
    const fromUnassigned = isUnassignedDeliveryCompany(item);
    if (from && !fromUnassigned && !sameCompanyName(from, to)) {
      item.companyChangedFrom = from;
      item.companyChangedTo = to;
      item.companyChangedAt = nowIso;
      changes.push({ vin: item.vin || vin, from, to });
    }
    item.deliveryCompany = to;
    item.company = to;
  }
  return changes;
}

function agentAutoBranch(username) {
  return AGENT_AUTO_BRANCH[String(username || '').trim()] || '';
}

function formatDeliveryNoteNumber(seq) {
  return `DN-${String(Math.max(1, Number(seq) || 1)).padStart(6, '0')}`;
}

function normalizeVehicleStatus(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'display' || v === 'عرض' || v === 'showroom') return 'display';
  if (v === 'delivery' || v === 'تسليم' || v === 'memo' || v === 'delivered') return 'delivery';
  return '';
}

function normalizeIsoDateOnly(raw, fallback) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (fallback) {
    const f = String(fallback).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(f)) return f.slice(0, 10);
    const dt = new Date(f);
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(dt);
    }
  }
  return todayIsoRiyadh();
}

/** Scan drafts and bump next seq so new DN numbers never collide. */
function syncNextDeliveryNoteSeq() {
  if (!store.meta || typeof store.meta !== 'object') store.meta = {};
  let next = Number(store.meta.nextDeliveryNoteSeq) || 1;
  if (next < 1) next = 1;
  for (const d of store.drafts || []) {
    const n = String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '').trim();
    const m = n.match(/^DN-(\d+)$/i);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  store.meta.nextDeliveryNoteSeq = next;
  return next;
}

function allocateDeliveryNoteNumber() {
  syncNextDeliveryNoteSeq();
  const used = new Set();
  for (const d of store.drafts || []) {
    const n = String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '').trim();
    if (n) used.add(n);
  }
  let seq = Number(store.meta.nextDeliveryNoteSeq) || 1;
  let num;
  do {
    num = formatDeliveryNoteNumber(seq);
    seq += 1;
  } while (used.has(num));
  store.meta.nextDeliveryNoteSeq = seq;
  return num;
}

/**
 * Attach unique deliveryNoteNumber + normalized deliveryNoteDate (and optional
 * manual-entry fields) onto a draft. Does not use VIN as the note identity.
 */
function attachDeliveryNoteMeta(draft, extras = {}) {
  if (!draft || typeof draft !== 'object') return draft;
  if (!draft.payload || typeof draft.payload !== 'object') draft.payload = {};

  const existingNum = String(
    draft.deliveryNoteNumber || draft.payload.deliveryNoteNumber || extras.deliveryNoteNumber || ''
  ).trim();
  const deliveryNoteNumber = existingNum || allocateDeliveryNoteNumber();
  const deliveryNoteDate = normalizeIsoDateOnly(
    extras.deliveryNoteDate
      || draft.printedAt
      || extras.printedAt
      || draft.deliveryNoteDate
      || draft.payload.deliveryNoteDate
      || draft.payload.doc_date
      || draft.payload.transfer_date,
    draft.printedAt || extras.printedAt
  );

  draft.deliveryNoteNumber = deliveryNoteNumber;
  draft.deliveryNoteDate = deliveryNoteDate;
  draft.payload.deliveryNoteNumber = deliveryNoteNumber;
  draft.payload.deliveryNoteDate = deliveryNoteDate;

  const branchEntry = extras.branchEntryDate != null
    ? extras.branchEntryDate
    : (draft.branchEntryDate != null ? draft.branchEntryDate : draft.payload.branchEntryDate);
  if (branchEntry != null && String(branchEntry).trim()) {
    draft.branchEntryDate = normalizeIsoDateOnly(branchEntry, deliveryNoteDate);
    draft.payload.branchEntryDate = draft.branchEntryDate;
  }

  const status = normalizeVehicleStatus(
    extras.vehicleStatus != null
      ? extras.vehicleStatus
      : (draft.vehicleStatus != null ? draft.vehicleStatus : draft.payload.vehicleStatus)
  );
  if (status) {
    draft.vehicleStatus = status;
    draft.payload.vehicleStatus = status;
  }

  const entryAgent = extras.entryAgent != null
    ? extras.entryAgent
    : (draft.entryAgent != null ? draft.entryAgent : draft.assignedTo);
  if (entryAgent != null && String(entryAgent).trim()) {
    draft.entryAgent = String(entryAgent).trim();
    draft.payload.entryAgent = draft.entryAgent;
  }

  const manual = extras.manualEntry != null
    ? Boolean(extras.manualEntry)
    : (draft.manualEntry === true || draft.payload.manualEntry === true);
  if (manual) {
    draft.manualEntry = true;
    draft.payload.manualEntry = true;
  }

  return draft;
}

/** Backfill DN numbers/dates for existing drafts (one-time on load). */
function migrateDeliveryNoteFields() {
  if (!Array.isArray(store.drafts)) store.drafts = [];
  if (!Array.isArray(store.manualVehicles)) store.manualVehicles = [];
  if (!store.meta || typeof store.meta !== 'object') store.meta = {};

  // Ensure auto-branch cities exist in options
  const cities = store.options?.cities || [];
  const needCities = ['جدة', 'الرياض', 'جده'];
  let optionsDirty = false;
  for (const c of needCities) {
    if (!cities.some((x) => normalizeOptionName(x) === c)) {
      cities.push(c);
      optionsDirty = true;
    }
  }
  if (optionsDirty) {
    store.options.cities = uniqueSorted(cities);
  }

  syncNextDeliveryNoteSeq();
  let dirty = optionsDirty;

  // Prefer printedAt for deliveryNoteDate so monthly filters don't mis-bucket old notes
  for (const d of store.drafts || []) {
    if (!d.printedAt) continue;
    const fromPrint = normalizeIsoDateOnly(d.printedAt, d.printedAt);
    if (!fromPrint) continue;
    const current = String(d.deliveryNoteDate || (d.payload && d.payload.deliveryNoteDate) || '').trim().slice(0, 10);
    if (current !== fromPrint) {
      d.deliveryNoteDate = fromPrint;
      if (!d.payload || typeof d.payload !== 'object') d.payload = {};
      d.payload.deliveryNoteDate = fromPrint;
      dirty = true;
    }
  }

  const missing = store.drafts.filter(
    (d) => !String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '').trim()
      || !String(d.deliveryNoteDate || (d.payload && d.payload.deliveryNoteDate) || '').trim()
  );
  if (!missing.length && !dirty) return false;

  missing
    .slice()
    .sort((a, b) => {
      const ta = a.printedAt ? new Date(a.printedAt).getTime() : 0;
      const tb = b.printedAt ? new Date(b.printedAt).getTime() : 0;
      return ta - tb;
    })
    .forEach((d) => attachDeliveryNoteMeta(d));

  return true;
}

function draftMonthKey(draft) {
  const iso = String(
    draft?.deliveryNoteDate
      || (draft?.payload && draft.payload.deliveryNoteDate)
      || ''
  ).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 7);
  if (draft?.printedAt) {
    const dt = new Date(draft.printedAt);
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit'
      }).format(dt);
    }
  }
  return '';
}

function computeDeliveryNoteStats(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  const vinSet = new Set();
  const stats = {
    deliveryNotes: list.length,
    uniqueVins: 0,
    display: 0,
    delivery: 0,
    warehouse: 0,
    memo: 0,
    showroom: 0,
    byMonth: {}
  };
  for (const d of list) {
    collectDraftVins(d.payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]).forEach((v) => vinSet.add(v));
    const status = normalizeVehicleStatus(d.vehicleStatus || (d.payload && d.payload.vehicleStatus));
    const isSh = Boolean(d.showroomDisplay) || isShowroomDraftPayload(d.payload) || status === 'display';
    const isWh = !isSh && isWarehouseDraftPayload(d.payload);

    if (status === 'display' || (isSh && status !== 'delivery')) stats.display += 1;
    else stats.delivery += 1;

    if (isSh) stats.showroom += 1;
    else if (isWh) stats.warehouse += 1;
    else stats.memo += 1;

    const mk = draftMonthKey(d);
    if (mk) stats.byMonth[mk] = (stats.byMonth[mk] || 0) + 1;
  }
  stats.uniqueVins = vinSet.size;

  const now = todayIsoRiyadh();
  const thisMonth = now.slice(0, 7);
  const [y, m] = thisMonth.split('-').map(Number);
  const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  stats.thisMonth = stats.byMonth[thisMonth] || 0;
  stats.lastMonth = stats.byMonth[last] || 0;
  return stats;
}

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

function vehicleIndex() {
  const map = new Map();
  for (const v of store.vehicles) {
    const vin = normVin(v.vin);
    if (vin) map.set(vin, v);
  }
  return map;
}

function statusLabelFor(item) {
  const vStatus = normalizeVehicleStatus(item.vehicleStatus);
  if (item.agentStatus === 'display' || vStatus === 'display') {
    if (item.agentStatus !== 'delivered') return 'عرض';
  }
  if (item.agentStatus === 'delivered') {
    if (vStatus === 'display' || item.showroomDisplay || item.deliveryMode === 'showroom') {
      return 'عرض الصالة';
    }
    return item.deliveryMode === 'warehouse'
      ? 'تم التسليم في المستودع'
      : 'تم الترحيل';
  }
  const wh = findWarehouseInStock(item.vin);
  if (wh) {
    return `في المستودع · ${wh.slot}`;
  }
  // Added by coordinator — waiting until agent creates the delivery note
  if (item.status === 'available' || !item.agentStatus) {
    return 'Waiting for delivery';
  }
  if (item.agentStatus === 'out_of_delivery') return 'Out for delivery';
  if (item.agentStatus === 'ready_for_delivery') return 'Ready';
  if (item.agentStatus === 'in_stock') {
    return item.assignedTo
      ? `Waiting for delivery · مع ${item.assignedTo}`
      : 'Waiting for delivery';
  }
  return item.assignedTo
    ? `Waiting for delivery · مع ${item.assignedTo}`
    : 'Waiting for delivery';
}

function ensureWarehouseStock() {
  if (!Array.isArray(store.warehouseStock)) store.warehouseStock = [];
}

function ensureShowroomParking() {
  if (!Array.isArray(store.showroomParking)) store.showroomParking = [];
}

function findShowroomParkingInStock(vin) {
  ensureShowroomParking();
  const key = normVin(vin);
  if (!key) return null;
  return store.showroomParking.find((e) => normVin(e.vin) === key && e.status === 'in') || null;
}

function normalizeShowroomParkingSlot(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (SHOWROOM_PARKING_SLOTS.includes(s)) return s;
  const m = s.match(/^(?:SR-?)?([1-7])$/);
  if (m) return `SR-${m[1]}`;
  return '';
}

function enrichShowroomParkingEntry(entry) {
  const vin = normVin(entry.vin);
  const veh = vehicleIndex().get(vin);
  const queueItem = findQueueItem(vin);
  return {
    ...entry,
    vin,
    product: entry.product || veh?.product || veh?.model || queueItem?.product || '',
    plate: entry.plate || veh?.plate || queueItem?.plate || '',
    model: entry.model || veh?.model || entry.product || '',
    label: SHOWROOM_PARKING_LABEL,
    section: 'showroom'
  };
}

function showroomParkingOccupancy() {
  ensureShowroomParking();
  const used = new Map(
    store.showroomParking
      .filter((e) => e.status === 'in')
      .map((e) => [String(e.slot || '').toUpperCase(), enrichShowroomParkingEntry(e)])
  );
  const slots = SHOWROOM_PARKING_SLOTS.map((slot) => ({
    slot,
    free: !used.has(slot),
    entry: used.get(slot) || null
  }));
  return {
    total: SHOWROOM_PARKING_SLOTS.length,
    used: slots.filter((s) => !s.free).length,
    free: slots.filter((s) => s.free).length,
    slots,
    label: SHOWROOM_PARKING_LABEL
  };
}

function ensureYassinParking() {
  if (!Array.isArray(store.yassinParking)) store.yassinParking = [];
}

function findYassinParkingInStock(vin) {
  ensureYassinParking();
  const key = normVin(vin);
  if (!key) return null;
  return store.yassinParking.find((e) => normVin(e.vin) === key && e.status === 'in') || null;
}

function normalizeYassinParkingSlot(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (YASSIN_PARKING_SLOTS.includes(s)) return s;
  const m = s.match(/^(?:YS-?)?([1-9]|10)$/);
  if (m) return `YS-${m[1]}`;
  return '';
}

function guestInfoFromRaw(vin) {
  const key = normVin(vin);
  const veh = vehicleIndex().get(key) || {};
  const guestName = String(veh.guestName || veh.customerName || '').trim();
  const guestPhone = String(veh.guestPhone || veh.phone || '').trim();
  return {
    vin: key,
    guestName: guestName === '#' ? '' : guestName,
    guestPhone: guestPhone === '#' ? '' : guestPhone,
    product: veh.product || veh.model || '',
    model: veh.model || veh.product || '',
    plate: veh.plate || '',
    inRaw: Boolean(key && vehicleIndex().has(key))
  };
}

function enrichYassinParkingEntry(entry) {
  const vin = normVin(entry.vin);
  const guest = guestInfoFromRaw(vin);
  const queueItem = findQueueItem(vin);
  return {
    ...entry,
    vin,
    product: entry.product || guest.product || queueItem?.product || '',
    model: entry.model || guest.model || '',
    plate: entry.plate || guest.plate || queueItem?.plate || '',
    guestName: entry.guestName || guest.guestName || '',
    guestPhone: entry.guestPhone || guest.guestPhone || '',
    carType: normalizeVehicleStatus(entry.carType) || entry.carType || '',
    guestArrivalTime: entry.guestArrivalTime || '',
    label: YASSIN_PARKING_LABEL,
    section: 'yassin'
  };
}

function yassinParkingOccupancy() {
  ensureYassinParking();
  const used = new Map(
    store.yassinParking
      .filter((e) => e.status === 'in')
      .map((e) => [String(e.slot || '').toUpperCase(), enrichYassinParkingEntry(e)])
  );
  const slots = YASSIN_PARKING_SLOTS.map((slot) => ({
    slot,
    free: !used.has(slot),
    entry: used.get(slot) || null
  }));
  return {
    total: YASSIN_PARKING_SLOTS.length,
    used: slots.filter((s) => !s.free).length,
    free: slots.filter((s) => s.free).length,
    slots,
    label: YASSIN_PARKING_LABEL
  };
}

/** Cars Yassin owns / manages for parking board. */
function buildYassinCarsList() {
  const seen = new Set();
  const cars = [];
  const pushCar = (base) => {
    const vin = normVin(base.vin);
    if (!vin || seen.has(vin)) return;
    seen.add(vin);
    const guest = guestInfoFromRaw(vin);
    const parked = findYassinParkingInStock(vin)
      || (store.yassinParking || []).find((e) => normVin(e.vin) === vin && e.status === 'display')
      || null;
    cars.push({
      vin,
      product: base.product || guest.product || '',
      company: String(base.deliveryCompany || base.company || '').trim(),
      assignedTo: base.assignedTo || '',
      agentStatus: base.agentStatus || '',
      status: base.status || '',
      guestName: guest.guestName,
      guestPhone: guest.guestPhone,
      inRaw: guest.inRaw,
      parked: Boolean(parked && parked.status === 'in'),
      isDisplayOnly: Boolean(parked && parked.status === 'display'),
      parkingSlot: parked?.slot || '',
      carType: parked?.carType || base.vehicleStatus || '',
      guestArrivalTime: parked?.guestArrivalTime || ''
    });
  };

  for (const q of store.queue || []) {
    if (String(q.assignedTo || '').trim() === SHOWROOM_AGENT) {
      pushCar(enrichQueueItem(q));
    }
  }
  for (const e of store.yassinParking || []) {
    if (e.status === 'in' || e.status === 'display') {
      pushCar({
        vin: e.vin,
        product: e.product,
        assignedTo: e.stockedInBy || SHOWROOM_AGENT,
        agentStatus: e.carType || '',
        deliveryCompany: '',
        vehicleStatus: e.carType
      });
    }
  }
  cars.sort((a, b) => {
    if (a.parked !== b.parked) return a.parked ? -1 : 1;
    return String(a.vin).localeCompare(String(b.vin));
  });
  return cars;
}

function findWarehouseInStock(vin) {
  ensureWarehouseStock();
  const key = normVin(vin);
  if (!key) return null;
  return store.warehouseStock.find((e) => normVin(e.vin) === key && e.status === 'in') || null;
}

function warehouseOccupancy() {
  ensureWarehouseStock();
  const used = new Set(
    store.warehouseStock.filter((e) => e.status === 'in').map((e) => String(e.slot || '').toUpperCase())
  );
  const zones = {};
  for (const zone of WAREHOUSE_ZONES) {
    const cfg = WAREHOUSE_ZONE_CONFIG[zone] || { total: 40, labelAr: zone };
    const slots = [];
    for (let i = 1; i <= cfg.total; i += 1) {
      const slot = `${zone}-${i}`;
      slots.push({ slot, free: !used.has(slot) });
    }
    zones[zone] = {
      total: cfg.total,
      labelAr: cfg.labelAr,
      used: slots.filter((s) => !s.free).length,
      free: slots.filter((s) => s.free).length,
      nextSlot: (slots.find((s) => s.free) || {}).slot || null,
      slots
    };
  }
  return zones;
}

function nextFreeSlot(zone) {
  const z = String(zone || '').trim().toUpperCase();
  if (!WAREHOUSE_ZONES.includes(z)) return null;
  const occ = warehouseOccupancy();
  return occ[z]?.nextSlot || null;
}

function enrichWarehouseEntry(entry) {
  const vin = normVin(entry.vin);
  const veh = vehicleIndex().get(vin);
  const queueItem = findQueueItem(vin);
  return {
    ...entry,
    vin,
    product: entry.product || veh?.product || veh?.model || queueItem?.product || '',
    plate: entry.plate || veh?.plate || queueItem?.plate || '',
    inCoordinatorQueue: Boolean(queueItem),
    coordinatorAssignee: queueItem?.assignedTo || '',
    plannedDeliveryMode: queueItem
      ? normalizePlannedDeliveryMode(queueItem.plannedDeliveryMode || queueItem.deliveryType || '')
      : ''
  };
}

function vehicleStatusPaperLabel(status) {
  const s = normalizeVehicleStatus(status);
  if (s === 'display') return 'عرض';
  if (s === 'delivery') return 'تسليم';
  return '';
}

/** Month key YYYY-MM from ISO timestamp (Asia/Riyadh). */
function isoToMonthKey(iso) {
  if (!iso) return '';
  const s = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit'
  }).format(dt);
}

/**
 * Coordinator hides تم الترحيل from previous months once the calendar
 * rolls (from the 1st of the new month onward). Current-month deliveries stay.
 * Display / showroom cars are never month-archived this way.
 */
function queueItemDeliveredMonth(item) {
  if (!item) return '';
  const direct = isoToMonthKey(item.deliveredAt || item.assignedAt || item.addedAt);
  if (direct) return direct;
  // Fall back to newest delivery-note draft for this VIN
  const vin = normVin(item.vin);
  if (!vin) return '';
  let best = '';
  for (const d of store.drafts || []) {
    const vins = collectDraftVins(d.payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]);
    if (!vins.includes(vin)) continue;
    if (normalizeVehicleStatus(d.vehicleStatus || d.payload?.vehicleStatus) === 'display') continue;
    if (d.showroomDisplay || isShowroomDraftPayload(d.payload)) continue;
    const mk = draftMonthKey(d) || isoToMonthKey(d.printedAt || d.deliveryNoteDate);
    if (mk && mk > best) best = mk;
  }
  return best;
}

function isPriorMonthDelivered(item) {
  if (!item || item.agentStatus !== 'delivered') return false;
  if (normalizeVehicleStatus(item.vehicleStatus) === 'display') return false;
  if (item.showroomDisplay || item.deliveryMode === 'showroom') return false;
  const current = todayIsoRiyadh().slice(0, 7);
  const deliveredMonth = queueItemDeliveredMonth(item);
  // Undated delivered cars: treat as prior once we are past day 1 of a month
  // only if they have no current-month signal — keep visible in current month if unknown
  if (!deliveredMonth) return false;
  return deliveredMonth < current;
}

const NOTES_ARCHIVE_DIR = path.join(ROOT, 'delivery-notes-archive');

function ensureNotesArchiveDir() {
  if (!fs.existsSync(NOTES_ARCHIVE_DIR)) {
    fs.mkdirSync(NOTES_ARCHIVE_DIR, { recursive: true });
  }
}

/** Persist delivery note as DOCX archive (printable document kept forever). */
function archiveDeliveryNoteFile(draft) {
  if (!draft || typeof draft !== 'object') return null;
  try {
    ensureNotesArchiveDir();
    const num = String(draft.deliveryNoteNumber || draft.id || `draft_${Date.now()}`).replace(/[^\w.-]+/g, '_');
    const payload = { ...(draft.payload || {}) };
    if (draft.deliveryNoteNumber) payload.deliveryNoteNumber = draft.deliveryNoteNumber;
    if (draft.vehicleStatus) {
      payload.vehicleStatus = draft.vehicleStatus;
      payload.attachments = [
        String(payload.attachments || '').trim(),
        `الحالة / Status: ${vehicleStatusPaperLabel(draft.vehicleStatus)}`
      ].filter(Boolean).join('\n');
    }
    const buf = generateDocx(payload);
    const filename = `${num}.docx`;
    const abs = path.join(NOTES_ARCHIVE_DIR, filename);
    fs.writeFileSync(abs, buf);
    draft.archiveFile = filename;
    draft.archivePath = `delivery-notes-archive/${filename}`;
    draft.archiveSavedAt = new Date().toISOString();
    draft.pdfSaved = true; // archived printable document (DOCX) for admin
    return draft.archivePath;
  } catch (err) {
    console.error('[archive-note]', err.message);
    return null;
  }
}

const SHOWROOM_SPECIAL_NAME = 'سيارات عرض الصالة';
const SHOWROOM_AGENT = 'ياسين';

function isShowroomDraftPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.showroom_display === true || payload.showroom_group === true) return true;
  if (payload.deliveryMode === 'showroom') return true;
  if (normalizeVehicleStatus(payload.vehicleStatus) === 'display') return true;
  return false;
}

function isWarehouseDraftPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (isShowroomDraftPayload(payload)) return false;
  if (payload.deliveryMode === 'warehouse' || payload.warehouse_group === true) return true;
  const branch = String(payload.branch_to || '').trim();
  if (branch === 'المستودع' || branch === 'في المستودع') return true;
  const company = String(payload.company_rep || '').trim();
  if (company.includes('مستودع') && company !== SHOWROOM_SPECIAL_NAME) return true;
  // Do not treat leftover owner/print fields alone as warehouse — memo forms share those inputs.
  return false;
}

function isWarehouseExportRow(row) {
  const deliveryType = String(pickCol(row, [
    'delivery type', 'delivery mode', 'نوع التسليم', 'section', 'القسم'
  ]) || '').trim().toLowerCase();
  if (deliveryType === 'showroom' || deliveryType.includes('عرض')) return false;
  if (deliveryType === 'warehouse' || deliveryType.includes('مستودع') || deliveryType.includes('warehouse')) {
    return true;
  }
  const companyName = String(pickCol(row, ['company name', 'company', 'اسم الشركة', 'الشركة']) || '').trim();
  if (companyName === 'سيارات عرض الصالة') return false;
  if (companyName === 'مستودع الهاتفية' || (companyName.includes('مستودع') && !companyName.includes('عرض'))) return true;
  const branchTo = String(pickCol(row, ['branch to', 'branch', 'الفرع', 'إلى فرع']) || '').trim();
  if (branchTo === 'المستودع' || branchTo === 'في المستودع') return true;
  const classification = String(pickCol(row, ['classification', 'status label']) || '');
  if (classification.includes('المستودع')) return true;
  return false;
}

/** Collect unique VINs from draft payload cars / vins arrays (+ optional extras). */
function collectDraftVins(draftPayload, extra = []) {
  const fromCars = Array.isArray(draftPayload?.cars)
    ? draftPayload.cars.map((c) => c?.chassis || c?.vin || '')
    : [];
  const fromPayloadVins = Array.isArray(draftPayload?.vins) ? draftPayload.vins : [];
  const fromExtra = Array.isArray(extra) ? extra : [extra];
  return [...new Set(
    [...fromExtra, ...fromPayloadVins, ...fromCars]
      .map((v) => normVin(v))
      .filter(Boolean)
  )];
}

/**
 * Mark VINs as delivered on the coordinator queue (creates queue rows if missing).
 * Shared by agent complete-print and admin draft edit.
 * display status → stays pickable by agents for a later delivery note.
 */
function markVinsDelivered(vins, {
  assignedTo = 'admin',
  warehouseDelivery = false,
  showroomDisplay = false,
  vehicleStatus = '',
  forceAssign = true,
  carMetaByVin = null
} = {}) {
  const byVehicle = vehicleIndex();
  const deliveredItems = [];
  const blocked = [];
  const status = normalizeVehicleStatus(vehicleStatus)
    || (showroomDisplay ? 'display' : 'delivery');
  const isDisplay = status === 'display' || showroomDisplay;
  const nowIso = new Date().toISOString();

  for (const vin of vins) {
    const meta = (carMetaByVin && carMetaByVin.get(vin)) || {};
    let item = findQueueItem(vin);
    if (!item) {
      const veh = byVehicle.get(vin);
      item = enrichFromVehicle({
        vin,
        // Display cars stay available so agents can pick them for a new delivery note
        status: isDisplay ? 'available' : 'claimed',
        agentStatus: isDisplay ? 'display' : 'delivered',
        deliveryMode: isDisplay ? 'showroom' : (warehouseDelivery ? 'warehouse' : ''),
        showroomDisplay: Boolean(isDisplay),
        vehicleStatus: status,
        assignedTo: isDisplay ? '' : (assignedTo || 'admin'),
        assignedAt: nowIso,
        deliveredAt: isDisplay ? '' : nowIso,
        addedAt: nowIso,
        product: meta.product || '',
        model: meta.model || meta.product || '',
        plate: meta.plate || '',
        entryAgent: assignedTo || ''
      }, veh || {});
      store.queue.push(item);
    } else {
      if (
        !forceAssign
        && item.assignedTo
        && assignedTo
        && item.assignedTo !== assignedTo
        && item.agentStatus !== 'delivered'
        && item.agentStatus !== 'display'
      ) {
        blocked.push({ vin, assignedTo: item.assignedTo });
        continue;
      }
      if (isDisplay) {
        item.status = 'available';
        item.agentStatus = 'display';
        item.deliveryMode = 'showroom';
        item.showroomDisplay = true;
        item.vehicleStatus = 'display';
        item.assignedTo = '';
        item.deliveredAt = '';
      } else {
        item.status = 'claimed';
        item.agentStatus = 'delivered';
        item.deliveryMode = warehouseDelivery ? 'warehouse' : '';
        item.showroomDisplay = false;
        item.vehicleStatus = 'delivery';
        if (assignedTo) item.assignedTo = assignedTo;
        item.deliveredAt = nowIso;
      }
      item.assignedAt = nowIso;
      if (meta.product && !item.product) item.product = meta.product;
      if (meta.model && !item.model) item.model = meta.model;
      if (meta.plate && !item.plate) item.plate = meta.plate;
      if (assignedTo) item.entryAgent = assignedTo;
    }
    deliveredItems.push(enrichQueueItem(item));
  }

  return { deliveredItems, blocked };
}

function normalizePlannedDeliveryMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'warehouse' || v === 'مستودع' || v === 'wh') return 'warehouse';
  if (v === 'memo' || v === 'delivery' || v === 'ترحيل' || v === 'transfer') return 'memo';
  return '';
}

/** True when queue item has no real delivery company (needs coordinator assign). */
function isUnassignedDeliveryCompany(item) {
  const c = String(item?.deliveryCompany || item?.company || '').trim();
  if (!c) return true;
  const key = c.toLowerCase().replace(/\s+/g, ' ');
  return key === 'بدون شركة'
    || key === 'بدون الشركه'
    || key === 'unassigned'
    || key === 'no company'
    || key === 'none'
    || key === '-';
}

function enrichQueueItem(item) {
  const vin = normVin(item.vin);
  const veh = vehicleIndex().get(vin);
  const deliveredMonth = queueItemDeliveredMonth(item);
  const archivedFromCoordinator = isPriorMonthDelivered(item);
  const wh = findWarehouseInStock(vin);
  const enriched = {
    ...item,
    vin,
    product: item.product || veh?.product || veh?.model || '',
    model: item.model || veh?.model || veh?.product || '',
    gt: item.gt || veh?.gt || '',
    location: item.location || veh?.location || '',
    plate: item.plate || veh?.plate || '',
    imageUrl: item.imageUrl || veh?.imageUrl || '',
    customerName: item.customerName || veh?.customerName || '',
    phone: item.phone || veh?.phone || '',
    guestName: item.guestName || veh?.guestName || veh?.customerName || '',
    guestPhone: item.guestPhone || veh?.guestPhone || veh?.phone || '',
    deliveryCompany: item.deliveryCompany || item.company || '',
    company: item.deliveryCompany || item.company || '',
    companyChangedFrom: item.companyChangedFrom || '',
    companyChangedTo: item.companyChangedTo || '',
    companyChangedAt: item.companyChangedAt || '',
    plannedBranch: item.plannedBranch || '',
    deliveryCity: item.deliveryCity || '',
    plannedDeliveryMode: normalizePlannedDeliveryMode(item.plannedDeliveryMode || item.deliveryType || '')
      || (item.deliveryMode === 'warehouse' && item.agentStatus !== 'delivered' ? 'warehouse' : '')
      || '',
    vehicleStatus: normalizeVehicleStatus(item.vehicleStatus) || item.vehicleStatus || '',
    deliveredMonth,
    archivedFromCoordinator,
    warehouseInStock: Boolean(wh),
    warehouseSlot: wh?.slot || '',
    warehouseZone: wh?.zone || '',
    warehouseStockedInAt: wh?.stockedInAt || '',
    statusLabel: statusLabelFor(item)
  };
  return enriched;
}

function computeStats() {
  const stats = {
    total: store.queue.length,
    available: 0,
    in_stock: 0,
    ready_for_delivery: 0,
    out_of_delivery: 0,
    delivered: 0,
    drafts: store.drafts.length
  };
  for (const item of store.queue) {
    if (item.status === 'available') {
      stats.available += 1;
      continue;
    }
    const st = item.agentStatus || '';
    if (st === 'in_stock') stats.in_stock += 1;
    else if (st === 'ready_for_delivery') stats.ready_for_delivery += 1;
    else if (st === 'out_of_delivery') stats.out_of_delivery += 1;
    else if (st === 'delivered') stats.delivered += 1;
  }
  return stats;
}

function buildDashboard() {
  const productCounts = new Map();
  for (const v of store.vehicles) {
    const p = String(v.product || v.model || '').trim() || '—';
    productCounts.set(p, (productCounts.get(p) || 0) + 1);
  }
  const topProducts = [...productCounts.entries()]
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return {
    totalVehicles: store.vehicles.length,
    uniqueProducts: productCounts.size,
    uploadedAt: store.meta.uploadedAt,
    uploadedBy: store.meta.uploadedBy || '',
    uploadedByName: store.meta.uploadedByName || '',
    filename: store.meta.filename,
    sheetName: store.meta.sheetName,
    topProducts
  };
}

function authenticateAgent(username, password) {
  let user = String(username || '').trim();
  const lower = user.toLowerCase();
  if (lower === 'warehouse' || lower === 'wh') user = 'warehouse';
  if (user === 'مستودع' || lower === 'mustawda') user = 'مستودع';
  if (lower === 'showroom admin' || lower === 'showroomadmin' || lower === 'showroom cars' || user === 'سيارات العرض') {
    user = SHOWROOM_ADMIN_AGENT;
  }
  if (!AGENTS.has(user)) return { ok: false, error: 'اسم المستخدم غير معروف' };
  const pass = String(password || '').trim();
  if (pass !== String(AGENT_PASSWORD).trim()) {
    return { ok: false, error: 'كلمة المرور غير صحيحة' };
  }
  const role = USER_ROLES[user] || 'agent';
  return { ok: true, username: user, role };
}

function findQueueItem(vin) {
  const key = normVin(vin);
  return store.queue.find((q) => normVin(q.vin) === key) || null;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickCol(row, aliases) {
  const keys = Object.keys(row || {});
  const entries = keys.map((k) => ({ orig: k, norm: normalizeHeader(k) }));

  // 1) Exact normalized header match
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    const hit = entries.find((e) => e.norm === a);
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }

  // 2) Starts-with / contains (token-aware) — supports "VIN No.", "GT Location", etc.
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    const hit = entries.find((e) => {
      if (!e.norm || e.norm === a) return false;
      if (e.norm.startsWith(`${a} `) || e.norm.endsWith(` ${a}`) || e.norm.includes(` ${a} `)) return true;
      // short keys like vin / gt: match headers that begin with them ("vin no", "gt location")
      if (a.length <= 3) return e.norm.startsWith(`${a} `) || e.norm.startsWith(a);
      return e.norm.includes(a);
    });
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  return '';
}

function enrichFromVehicle(item, veh) {
  if (!veh) {
    return {
      ...item,
      product: '',
      model: '',
      gt: '',
      location: '',
      plate: item.plate || '',
      imageUrl: item.imageUrl || '',
      customerName: item.customerName || '',
      phone: item.phone || ''
    };
  }
  return {
    ...item,
    product: veh.product || '',
    model: veh.model || veh.product || '',
    gt: veh.gt || '',
    location: veh.location || '',
    plate: veh.plate || item.plate || '',
    imageUrl: veh.imageUrl || item.imageUrl || '',
    customerName: veh.customerName || item.customerName || '',
    phone: veh.phone || item.phone || ''
  };
}

function queuePriority(item) {
  if (item.agentStatus === 'delivered') return 5;
  if (item.agentStatus === 'out_of_delivery') return 4;
  if (item.agentStatus === 'ready_for_delivery') return 3;
  if (item.agentStatus === 'in_stock') return 2;
  if (item.status === 'claimed') return 1;
  return 0;
}

/** Keep one row per VIN (prefer active assignment over available). */
function dedupeQueue(queue) {
  const best = new Map();
  for (const raw of queue || []) {
    const vin = normVin(raw.vin);
    if (!vin) continue;
    const item = { ...raw, vin };
    const prev = best.get(vin);
    if (!prev || queuePriority(item) > queuePriority(prev)) {
      best.set(vin, item);
    }
  }
  return Array.from(best.values());
}

function refreshQueueFromVehicles() {
  const byVin = vehicleIndex();
  let matched = 0;
  let missing = 0;
  store.queue = dedupeQueue(store.queue).map((item) => {
    const veh = byVin.get(normVin(item.vin));
    if (veh) matched += 1;
    else missing += 1;
    return enrichFromVehicle(item, veh);
  });
  return { matched, missing, total: store.queue.length };
}

function parseDataUrl(fileData) {
  const raw = String(fileData || '');
  const m = raw.match(/^data:[^;]+;base64,(.+)$/i);
  const b64 = m ? m[1] : raw;
  return Buffer.from(b64, 'base64');
}

function sheetRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function findSheetName(wb, aliases) {
  const names = wb.SheetNames || [];
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    const hit = names.find((n) => normalizeHeader(n) === a || normalizeHeader(n).includes(a));
    if (hit) return hit;
  }
  return '';
}

function normalizeExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value || '').trim();
  if (!s || s === '#' || /^n\/?a$/i.test(s)) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (mdy) {
    let y = Number(mdy[3]);
    if (y < 100) y += 2000;
    const month = String(Number(mdy[1])).padStart(2, '0');
    const day = String(Number(mdy[2])).padStart(2, '0');
    if (Number(month) > 12 && Number(day) <= 12) {
      // D/M/YYYY fallback
      return `${y}-${String(Number(mdy[2])).padStart(2, '0')}-${String(Number(mdy[1])).padStart(2, '0')}`;
    }
    return `${y}-${month}-${day}`;
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return '';
}

function pickExactishCol(row, aliases) {
  // Prefer exact / starts-with matches; avoid grabbing "* Date" columns for short keys like plate
  const keys = Object.keys(row || {});
  const entries = keys.map((k) => ({ orig: k, norm: normalizeHeader(k) }));
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    const hit = entries.find((e) => e.norm === a);
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a || a.length < 4) continue;
    const hit = entries.find((e) => {
      if (!e.norm || e.norm === a) return false;
      if (/\bdate\b|تاريخ/.test(e.norm) && !/\bdate\b|تاريخ/.test(a)) return false;
      return e.norm.startsWith(`${a} `) || e.norm.endsWith(` ${a}`) || e.norm.includes(` ${a} `);
    });
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  return '';
}

const VIN_ALIASES = [
    'vin no', 'vin no.', 'vin number', 'vin#', 'vin',
    'chassis', 'chassis / vin', 'chassis/vin', 'chassis no', 'chassis no.',
    'chassis number', 'شاسيه', 'رقم الشاسيه', 'frame', 'frame no'
  ];

function rowToVehicle(row) {
  const vin = normVin(pickCol(row, VIN_ALIASES));
  if (!vin || vin.length < 5) return null;
  if (!/[A-HJ-NPR-Z0-9]/i.test(vin)) return null;

  const product = pickCol(row, ['product', 'product name', 'وصف', 'المنتج', 'الطراز']);
  // Exact "Model" only — never "Model Year"
  const modelExact = (() => {
    const keys = Object.keys(row || {});
    for (const k of keys) {
      if (normalizeHeader(k) === 'model' && row[k] != null && String(row[k]).trim() !== '') {
        return String(row[k]).trim();
      }
    }
    return '';
  })();
  const model = modelExact || product;
      const gt = pickCol(row, ['gt location', 'gt status', 'gt code', 'gtcode', 'gt_code', 'gt']);
      const location = pickCol(row, [
        'gt location', 'stock location', 'storage location', 'location',
        'warehouse', 'yard', 'الموقع', 'المستودع'
      ]);
  const plate = pickExactishCol(row, ['plate', 'plate no', 'plate number', 'veh plate', 'لوحة', 'رقم اللوحة']);
      const customerName = pickCol(row, ['customer name', 'customer', 'اسم العميل', 'العميل']);
  const phone = pickCol(row, [
    'contact no', 'contact no.', 'contact number', 'contact',
    'phone', 'phone no', 'phone number', 'mobile', 'mobile no', 'mobile number',
    'tel', 'telephone', 'هاتف', 'جوال', 'رقم الجوال', 'رقم الهاتف'
  ]);
      const imageUrl = pickCol(row, ['image', 'image url', 'imageurl', 'photo', 'صورة']);
      const suffix = pickCol(row, ['suffix', 'ext', 'color', 'model year']);
  const proformaDate = normalizeExcelDate(pickCol(row, [
    'proforma date', 'proforma', 'pro forma date', 'تاريخ البروفورما', 'تاريخ العرض'
  ]));
  const invoiceDate = normalizeExcelDate(pickCol(row, [
    'invoice date', 'inv date', 'billing date', 'تاريخ الفاتورة', 'تاريخ الفاتوره'
  ]));
  const deliveryNoteDate = normalizeExcelDate(pickCol(row, [
    'delivery note date', 'delivery date', 'dn date', 'muthakara date',
    'transfer date', 'تاريخ المذكرة', 'تاريخ مذكرة الترحيل', 'تاريخ الترحيل'
  ]));

  return {
    vin,
    product: product || model,
    model: model || product,
        gt,
        location,
    plate: plate === '#' ? '' : plate,
        customerName,
    phone: phone === '#' ? '' : phone,
        imageUrl,
    suffix,
    proformaDate,
    invoiceDate,
    deliveryNoteDate
  };
}

/** Admin export workbook (Vehicle Inventory / Print Drafts / Coordinator Queue). */
function isDeliveryExportWorkbook(wb, filename) {
  const names = (wb.SheetNames || []).map((n) => normalizeHeader(n));
  const fileHint = normalizeHeader(filename || '');
  if (/delivery[\s_-]*export|admin[\s_-]*export|تصدير|archive|أرشيف/i.test(fileHint)) return true;
  return names.some((n) =>
    n.includes('vehicle inventory')
    || n.includes('print draft')
    || n.includes('coordinator queue')
    || (n.includes('سجل') && n.includes('مركبات'))
    || n.includes('مسودات')
    || (n.includes('قائمة') && (n.includes('شاس') || n.includes('coordinator')))
  );
}

function finishRestoreExport(buffer, filename, res) {
  const parsed = parseSalesWorkbook(buffer, filename || 'delivery_export.xlsx');
  const fileLooksExport = /delivery[\s_-]*export|admin[\s_-]*export|تصدير|archive|أرشيف/i.test(String(filename || ''));
  const hasDrafts = Array.isArray(parsed.drafts) && parsed.drafts.length > 0;
  const hasQueue = Array.isArray(parsed.queue) && parsed.queue.length > 0;
  const fullArchive = Boolean(parsed.isExport || fileLooksExport || hasDrafts || hasQueue);

  if (!parsed.vehicles.length && !hasDrafts) {
    return res.status(400).json({
      error: 'الملف لا يحتوي على مركبات أو مسودات. استخدم delivery_export_….xlsx من تصدير اللوحة، أو ارفع Sales Raw من زر «رفع Sales Raw».'
    });
  }

  if (!fullArchive && !fileLooksExport) {
    const refresh = applyParsedInventory(parsed, { replaceDrafts: false, replaceQueue: false });
    persistAndBroadcast();
    return res.json({
      ok: true,
      mode: 'inventory_only',
      imported: parsed.vehicles.length,
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      sheetName: parsed.sheetName,
      filename: parsed.filename,
      queueRefreshed: refresh.total,
      note: 'تم استيراد المركبات فقط — لاستيراد المسودات والقائمة استخدم ملف delivery_export'
    });
  }

  const refresh = applyParsedInventory(parsed, { replaceDrafts: true, replaceQueue: true });
  persistAndBroadcast();
  return res.json({
    ok: true,
    mode: 'full',
    imported: parsed.vehicles.length,
    draftsImported: (parsed.drafts || []).length,
    queueImported: (parsed.queue || []).length,
    companiesFromDrafts: refresh.draftsApplied?.assigned || 0,
    draftsByCompany: refresh.draftsApplied?.byCompany || computeDraftsByCompany(),
    teamCarriersFromDrafts: refresh.teamDraftCarriers || null,
    sheetName: parsed.sheetName,
    filename: parsed.filename,
    queueRefreshed: refresh.total
  });
}

function parseVehiclesFromRows(rows) {
  const found = [];
  const seen = new Set();
  for (const row of rows || []) {
    const veh = rowToVehicle(row);
    if (!veh) continue;
    if (seen.has(veh.vin)) continue;
    seen.add(veh.vin);
    found.push(veh);
  }
  return found;
}

/** Sales Raw column P (0-based index 15) = Proforma Date when header name is missing. */
function extractVinFromArrayLine(headerRow, line) {
  const headers = Array.isArray(headerRow) ? headerRow : [];
  const cells = Array.isArray(line) ? line : [];
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(String(headers[i] || ''));
    if (!h) continue;
    const isVinCol = VIN_ALIASES.some((a) => {
      const alias = normalizeHeader(a);
      return alias && (h === alias || h.includes(alias) || alias.includes(h));
    });
    if (isVinCol) {
      const v = normVin(String(cells[i] || ''));
      if (v) return v;
    }
  }
  for (const cell of cells) {
    const v = normVin(String(cell || ''));
    if (v && v.length >= 11) return v;
  }
  return '';
}

function backfillProformaColumnP(wb, sheetName, vehicles) {
  const sheet = wb && wb.Sheets ? wb.Sheets[sheetName] : null;
  if (!sheet || !Array.isArray(vehicles) || !vehicles.length) return;
  const rowsArr = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!rowsArr.length) return;
  const headerRow = rowsArr[0] || [];
  const byVin = new Map(vehicles.map((v) => [normVin(v.vin), v]));
  const COL_P = 15;
  for (let i = 1; i < rowsArr.length; i++) {
    const line = rowsArr[i];
    const vin = extractVinFromArrayLine(headerRow, line);
    if (!vin) continue;
    const veh = byVin.get(vin);
    if (!veh || veh.proformaDate) continue;
    const raw = line[COL_P];
    if (raw != null && String(raw).trim() !== '') {
      veh.proformaDate = normalizeExcelDate(raw);
    }
  }
}

/**
 * Sales Raw: column O (index 14) = guest / customer name,
 * column Y (index 24) = phone — used by Yassin parking board.
 */
function backfillGuestColumnsOY(wb, sheetName, vehicles) {
  const sheet = wb && wb.Sheets ? wb.Sheets[sheetName] : null;
  if (!sheet || !Array.isArray(vehicles) || !vehicles.length) return;
  const rowsArr = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!rowsArr.length) return;
  const headerRow = rowsArr[0] || [];
  const byVin = new Map(vehicles.map((v) => [normVin(v.vin), v]));
  const COL_O = 14; // guest name
  const COL_Y = 24; // phone
  for (let i = 1; i < rowsArr.length; i++) {
    const line = rowsArr[i];
    const vin = extractVinFromArrayLine(headerRow, line);
    if (!vin) continue;
    const veh = byVin.get(vin);
    if (!veh) continue;
    const guestRaw = line[COL_O];
    const phoneRaw = line[COL_Y];
    const guest = guestRaw != null ? String(guestRaw).trim() : '';
    const phone = phoneRaw != null ? String(phoneRaw).trim() : '';
    if (guest && guest !== '#') {
      veh.guestName = guest;
      if (!veh.customerName) veh.customerName = guest;
    }
    if (phone && phone !== '#') {
      veh.guestPhone = phone;
      if (!veh.phone) veh.phone = phone;
    }
  }
}

function isShowroomExportRow(row) {
  const deliveryType = String(pickCol(row, [
    'delivery type', 'delivery mode', 'نوع التسليم', 'section', 'القسم', 'flag'
  ]) || '').trim().toLowerCase();
  if (deliveryType === 'showroom' || deliveryType.includes('عرض')) return true;
  const companyName = String(pickCol(row, ['company name', 'company', 'اسم الشركة', 'الشركة']) || '').trim();
  if (companyName === 'سيارات عرض الصالة') return true;
  return false;
}

function buildDraftPayloadFromExportRow(row, veh) {
  const today = new Date().toISOString().slice(0, 10);
  // Export maps: Company Name ← payload.company_rep, Company Rep ← payload.customer_name
  // Warehouse exports use Company Name = مستودع الهاتفية, Branch To = في المستودع
  // Showroom exports use Company Name = سيارات عرض الصالة
  const companyName = pickCol(row, ['company name', 'company', 'اسم الشركة', 'الشركة']);
  const companyRep = pickCol(row, ['company rep', 'rep', 'مندوب الشركة', 'المندوب']);
  const branchTo = pickCol(row, ['branch to', 'branch', 'الفرع', 'إلى فرع']);
  const plate = pickCol(row, ['plate', 'plate no', 'لوحة']) || (veh && veh.plate) || '';
  const product = pickCol(row, ['product', 'model']) || (veh && (veh.product || veh.model)) || '';
  const vin = normVin(pickCol(row, VIN_ALIASES) || (veh && veh.vin));
  const printedAt = pickCol(row, ['printed at', 'printed', 'تاريخ الطباعة']);
  const docDate = printedAt && /^\d{4}-\d{2}-\d{2}/.test(printedAt)
    ? printedAt.slice(0, 10)
    : today;
  const isSh = isShowroomExportRow(row);
  const isWh = !isSh && isWarehouseExportRow(row);

  const cars = Array.from({ length: 10 }, () => emptyCarSlot());
  cars[0] = {
    model: product,
    chassis: vin,
    plate: plate === '#' ? '' : plate,
    remarks: pickCol(row, ['remarks', 'notes', 'ملاحظات']) || ''
  };

  const payload = {
    doc_date: docDate,
    invoice_number: '',
    dep_hour: '',
    dep_minute: '',
    customer_name: companyRep || '',
    company_rep: isSh ? (companyRep || companyName) : (isWh ? 'مستودع الهاتفية' : companyName),
    transfer_date: docDate,
    corresponding_date: docDate,
    day_name: arabicWeekdayName(docDate),
    trailer_number: '',
    car_count: vin ? '1' : '',
    branch_to: isWh ? 'المستودع' : branchTo,
    attachments: '',
    cars
  };

  if (isSh) {
    payload.deliveryMode = 'showroom';
    payload.showroom_display = true;
    payload.showroom_group = true;
    payload.showroom_label = SHOWROOM_SPECIAL_NAME;
    payload.typed_company = companyRep || companyName || '';
  } else if (isWh) {
    payload.deliveryMode = 'warehouse';
    payload.warehouse_group = true;
    payload.warehouse = {
      owner_name: companyRep || companyName || '',
      user_phone: pickCol(row, ['phone', 'هاتف']) || ''
    };
  }

  return payload;
}

function parsePrintDraftsFromRows(rows) {
  const drafts = [];
  for (const row of rows || []) {
    const product = pickCol(row, ['product', 'model']);
    const assignedTo = pickCol(row, ['assigned to', 'agent', 'المسؤول']) || 'admin';
    const companyName = pickCol(row, ['company name', 'company', 'اسم الشركة', 'الشركة']);
    const idRaw = pickCol(row, ['draft id', 'id', 'draft']);
    const id = idRaw || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const printedAt = pickCol(row, ['printed at', 'printed']) || new Date().toISOString();
    const allVinsRaw = pickCol(row, ['all vins', 'all vin', 'vins', 'chassis list', 'كل الشاسيه']);
    const primary = normVin(pickCol(row, VIN_ALIASES));
    const fromAll = String(allVinsRaw || '')
      .split(/[,;\s]+/)
      .map((v) => normVin(v))
      .filter(Boolean);
    const uniqueVins = [...new Set([primary, ...fromAll].filter(Boolean))];
    if (!uniqueVins.length) continue;
    const vin = uniqueVins[0];
    const payload = buildDraftPayloadFromExportRow(row, {
      vin,
      product,
      plate: pickCol(row, ['plate']),
    });
    // Ensure every VIN from «All VINs» is on the payload cars list
    if (Array.isArray(payload.cars)) {
      uniqueVins.forEach((v, idx) => {
        if (!payload.cars[idx]) payload.cars[idx] = emptyCarSlot();
        if (!payload.cars[idx].chassis) {
          payload.cars[idx] = {
            model: product || '',
            chassis: v,
            plate: pickCol(row, ['plate']) || '',
            remarks: '',
          };
        }
      });
      payload.car_count = String(uniqueVins.length);
    }
    if (!payload.company_rep && companyName) payload.company_rep = companyName;
    drafts.push({
      id,
      printedAt,
      vin,
      vins: uniqueVins,
      product,
      model: product,
      assignedTo: isShowroomDraftPayload(payload) ? (assignedTo || SHOWROOM_AGENT) : assignedTo,
      customerName: companyName || pickCol(row, ['company rep', 'customer']) || '',
      plate: pickCol(row, ['plate']) || '',
      gt: pickCol(row, ['gt']) || '',
      location: pickCol(row, ['location']) || '',
      showroomDisplay: isShowroomDraftPayload(payload),
      deliveryNoteNumber: pickCol(row, ['delivery note number', 'dn', 'رقم المذكرة']) || '',
      deliveryNoteDate: pickCol(row, ['delivery note date', 'تاريخ المذكرة']) || '',
      payload,
    });
  }
  return drafts;
}

function parseQueueFromRows(rows) {
  const queue = [];
  const seen = new Set();
  for (const row of rows || []) {
    const vin = normVin(pickCol(row, VIN_ALIASES));
    if (!vin || seen.has(vin)) continue;
    seen.add(vin);
    const status = pickCol(row, ['status']) || 'available';
    const agentStatus = pickCol(row, ['agent status']) || '';
    const assignedTo = pickCol(row, ['assigned to']) || '';
    const deliveryModeRaw = String(pickCol(row, ['delivery mode', 'delivery type']) || '').trim().toLowerCase();
    const isWh = deliveryModeRaw === 'warehouse'
      || isWarehouseExportRow(row);
    const companyName = String(pickCol(row, [
      'company name', 'company', 'delivery company', 'اسم الشركة', 'الشركة', 'الناقل'
    ]) || '').trim();
    queue.push({
      vin,
      status: status === 'claimed' || assignedTo ? 'claimed' : 'available',
      agentStatus,
      deliveryMode: isWh ? 'warehouse' : (deliveryModeRaw === 'memo' ? '' : ''),
      assignedTo,
      addedAt: pickCol(row, ['added at']) || new Date().toISOString(),
      assignedAt: pickCol(row, ['assigned at']) || '',
      product: pickCol(row, ['product', 'model']) || '',
      model: pickCol(row, ['model', 'product']) || '',
      gt: pickCol(row, ['gt']) || '',
      location: pickCol(row, ['location']) || '',
      plate: pickCol(row, ['plate']) || '',
      customerName: pickCol(row, ['customer', 'customer name']) || '',
      deliveryCompany: companyName,
      company: companyName,
      plannedDeliveryMode: isWh ? 'warehouse' : (companyName ? 'memo' : ''),
      imageUrl: '',
    });
  }
  return queue;
}

function parseSalesFromWorkbook(wb, filename) {
  // Prefer admin export "Vehicle Inventory", then Sales Raw, then any sheet with VINs
  const inventorySheet = findSheetName(wb, ['vehicle inventory', 'inventory', 'vehicles']);
  const sheetOrder = [
    ...(inventorySheet ? [inventorySheet] : []),
    ...wb.SheetNames.filter((n) => /sales\s*raw/i.test(n)),
    ...wb.SheetNames.filter((n) => /raw/i.test(n) && !/sales\s*raw/i.test(n)),
    ...wb.SheetNames.filter((n) => {
      const norm = normalizeHeader(n);
      return !/raw/i.test(n)
        && norm !== normalizeHeader(inventorySheet)
        && !norm.includes('print draft')
        && !norm.includes('coordinator queue')
        && norm !== 'products'
        && norm !== 'summary';
    })
  ];
  const sheets = [...new Set(sheetOrder.length ? sheetOrder : wb.SheetNames)];
  if (!sheets.length) throw new Error('لا توجد أوراق في الملف');

  let preferred = sheets[0];
  let rows = [];
  let vehicles = [];
  let headers = [];

  for (const name of sheets) {
    const sheetRowsData = sheetRows(wb, name);
    if (!sheetRowsData.length) continue;
    const found = parseVehiclesFromRows(sheetRowsData);
    if (found.length) {
      preferred = name;
      rows = sheetRowsData;
      vehicles = found;
      backfillProformaColumnP(wb, name, vehicles);
      backfillGuestColumnsOY(wb, name, vehicles);
      headers = Object.keys(sheetRowsData[0] || {});
      break;
    }
    if (!headers.length && sheetRowsData[0]) headers = Object.keys(sheetRowsData[0]);
  }

  if (!vehicles.length) {
    if (isDeliveryExportWorkbook(wb, filename)) {
      for (const name of wb.SheetNames || []) {
        const sheetRowsData = sheetRows(wb, name);
        if (!sheetRowsData.length) continue;
        const found = parseVehiclesFromRows(sheetRowsData);
        if (found.length) {
          preferred = name;
          rows = sheetRowsData;
          vehicles = found;
          backfillProformaColumnP(wb, name, vehicles);
          backfillGuestColumnsOY(wb, name, vehicles);
          headers = Object.keys(sheetRowsData[0] || {});
          break;
        }
      }
    }
  }

  if (!vehicles.length) {
    const headerHint = headers.length ? ` · الأعمدة: ${headers.slice(0, 12).join(' | ')}` : '';
    throw new Error(`لم يتم العثور على أرقام شاسيه في الملف${headerHint}`);
  }

  const result = {
    vehicles,
    sheetName: preferred,
    filename: filename || '',
    rawRows: rows.slice(0, 5000),
    drafts: [],
    queue: [],
    isExport: isDeliveryExportWorkbook(wb, filename)
  };

  if (result.isExport) {
    const draftsSheet = findSheetName(wb, [
      'print drafts', 'print draft', 'drafts', 'مسودات الطباعة', 'مسودات', 'print'
    ]);
    const queueSheet = findSheetName(wb, [
      'coordinator queue', 'queue', 'قائمة الشاسيه', 'القائمة', 'coordinator'
    ]);
    if (draftsSheet) result.drafts = parsePrintDraftsFromRows(sheetRows(wb, draftsSheet));
    if (queueSheet) result.queue = parseQueueFromRows(sheetRows(wb, queueSheet));
  } else {
    // Always try «Print Drafts» sheet when present (archive / delivery_export / mixed workbooks)
    const draftsSheet = findSheetName(wb, [
      'print drafts', 'print draft', 'drafts', 'مسودات الطباعة', 'مسودات'
    ]);
    if (draftsSheet) {
      result.drafts = parsePrintDraftsFromRows(sheetRows(wb, draftsSheet));
      if (result.drafts.length) result.isExport = true;
    }
    // Pasted Print Drafts grid (single sheet with Draft ID / Company Name columns)
    const headerKeys = Object.keys(rows[0] || {}).map((h) => normalizeHeader(h));
    const looksLikeDrafts = headerKeys.some((h) => h.includes('draft id') || h === 'company name' || h.includes('branch to'));
    if (looksLikeDrafts && headerKeys.some((h) => h.includes('chassis') || h.includes('vin'))) {
      result.drafts = parsePrintDraftsFromRows(rows);
      result.isExport = true;
    }
  }

  return result;
}

function parseSalesWorkbook(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return parseSalesFromWorkbook(wb, filename);
}

/** Paste from Excel clipboard (TSV) or CSV text → same vehicle structure as file upload. */
function parseSalesText(text, filename) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('الصق بيانات Excel أولاً');

  const firstLine = raw.split(/\r?\n/)[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const FS = tabCount >= 1 && tabCount >= commaCount ? '\t' : ',';
  const wb = XLSX.read(raw, { type: 'string', FS, cellDates: true });
  return parseSalesFromWorkbook(wb, filename || 'pasted-excel.tsv');
}

/**
 * Assign coordinator queue companies from Print Drafts (مسودات الطباعة).
 * Each draft's Company Name / company_rep stamps every VIN on that memo.
 * @param {object[]} drafts
 * @param {{ onlyUnassigned?: boolean }} [opts] — when true, only fill بدون شركة (no overwrite / no create)
 */
function applyCompaniesFromPrintDrafts(drafts, { onlyUnassigned = false } = {}) {
  ensureOptions();
  const list = Array.isArray(drafts) ? drafts : [];
  let assigned = 0;
  let created = 0;
  const byCompany = new Map();
  const now = new Date().toISOString();
  const byVehicle = vehicleIndex();

  for (const d of list) {
    const payload = d.payload || {};
    let company = String(payload.company_rep || d.customerName || '').trim();
    if (isShowroomDraftPayload(payload) || d.showroomDisplay) {
      company = company || SHOWROOM_SPECIAL_NAME || 'سيارات عرض الصالة';
    } else if (payload.deliveryMode === 'warehouse' || payload.warehouse_group) {
      company = 'مستودع الهاتفية';
    }
    if (!company || isUnassignedDeliveryCompany({ company, deliveryCompany: company })) {
      continue;
    }

    const existsOpt = (store.options.companies || []).some(
      (x) => companyNameKey(x) === companyNameKey(company)
    );
    if (!existsOpt && company !== 'مستودع الهاتفية' && company !== (SHOWROOM_SPECIAL_NAME || '')) {
      store.options.companies = uniqueSorted([...(store.options.companies || []), company]);
    }

    const vins = collectDraftVins(payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]);
    byCompany.set(company, (byCompany.get(company) || 0) + vins.length);

    for (const vin of vins) {
      if (!vin) continue;
      let item = findQueueItem(vin);
      const veh = byVehicle.get(vin);
      const isWh = company === 'مستودع الهاتفية' || payload.deliveryMode === 'warehouse';
      if (!item) {
        if (onlyUnassigned) continue;
        item = enrichFromVehicle({
          vin,
          status: 'claimed',
          agentStatus: 'delivered',
          assignedTo: d.assignedTo || d.entryAgent || 'admin',
          addedAt: d.printedAt || now,
          assignedAt: d.printedAt || now,
          deliveredAt: d.printedAt || now,
          deliveryCompany: company,
          company,
          plannedDeliveryMode: isWh ? 'warehouse' : 'memo',
          plannedBranch: String(payload.branch_to || '').trim(),
          source: 'print-drafts',
          product: d.product || '',
          model: d.model || d.product || '',
        }, veh || {});
        store.queue.push(item);
        created += 1;
        assigned += 1;
        continue;
      }

      const wasUnassigned = isUnassignedDeliveryCompany(item);
      const prev = String(item.deliveryCompany || item.company || '').trim();
      if (onlyUnassigned && !wasUnassigned && prev) continue;
      if (wasUnassigned || !prev || (!onlyUnassigned && companyNameKey(prev) !== companyNameKey(company))) {
        item.deliveryCompany = company;
        item.company = company;
        item.plannedDeliveryMode = isWh
          ? 'warehouse'
          : (item.plannedDeliveryMode || 'memo');
        if (payload.branch_to && !item.plannedBranch) {
          item.plannedBranch = String(payload.branch_to).trim();
        }
        // Printed draft ⇒ تم الترحيل
        if (!item.agentStatus || item.agentStatus === 'available') {
          item.status = 'claimed';
          item.agentStatus = 'delivered';
          item.deliveredAt = item.deliveredAt || d.printedAt || now;
        }
        assigned += 1;
      }
    }
  }

  store.queue = dedupeQueue(store.queue || []);
  return {
    assigned,
    created,
    companies: [...byCompany.keys()],
    byCompany: Object.fromEntries(byCompany),
    draftCount: list.length,
  };
}

/** VIN counts per company from Print Drafts (for Coordinator boards). */
function computeDraftsByCompany() {
  const map = Object.create(null);
  for (const d of store.drafts || []) {
    const payload = d.payload || {};
    let company = String(payload.company_rep || d.customerName || '').trim();
    if (isShowroomDraftPayload(payload) || d.showroomDisplay) {
      company = company || SHOWROOM_SPECIAL_NAME || 'سيارات عرض الصالة';
    } else if (payload.deliveryMode === 'warehouse' || payload.warehouse_group) {
      company = 'مستودع الهاتفية';
    }
    if (!company) company = 'بدون شركة';
    const vins = collectDraftVins(payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]);
    const n = Math.max(1, vins.length);
    map[company] = (map[company] || 0) + n;
  }
  return map;
}

function applyParsedInventory(parsed, {
  replaceDrafts = false,
  replaceQueue = false,
  uploadedBy = '',
  uploadedByName = '',
} = {}) {
  store.vehicles = parsed.vehicles;
  store.raw = {
    filename: parsed.filename,
    sheetName: parsed.sheetName,
    rowCount: parsed.rawRows.length,
    sample: parsed.rawRows.slice(0, 20)
  };
  store.meta = {
    filename: parsed.filename,
    sheetName: parsed.sheetName,
    uploadedAt: new Date().toISOString(),
    uploadedBy: String(uploadedBy || '').trim() || store.meta?.uploadedBy || '',
    uploadedByName: String(uploadedByName || '').trim() || store.meta?.uploadedByName || '',
    nextDeliveryNoteSeq: Number(store.meta?.nextDeliveryNoteSeq) || 1
  };

  let draftsApplied = null;
  if (replaceDrafts || (Array.isArray(parsed.drafts) && parsed.drafts.length)) {
    store.drafts = Array.isArray(parsed.drafts) ? parsed.drafts.slice(0, MAX_DRAFTS) : [];
    migrateDeliveryNoteFields();
    draftsApplied = applyCompaniesFromPrintDrafts(store.drafts);
  }
  if (replaceQueue || (Array.isArray(parsed.queue) && parsed.queue.length)) {
    store.queue = Array.isArray(parsed.queue) ? dedupeQueue(parsed.queue) : [];
    // Queue sheet may lack company — backfill from drafts when present
    if (store.drafts && store.drafts.length) {
      const again = applyCompaniesFromPrintDrafts(store.drafts);
      draftsApplied = draftsApplied
        ? {
            assigned: (draftsApplied.assigned || 0) + (again.assigned || 0),
            created: (draftsApplied.created || 0) + (again.created || 0),
            companies: [...new Set([...(draftsApplied.companies || []), ...(again.companies || [])])],
            byCompany: { ...(draftsApplied.byCompany || {}), ...(again.byCompany || {}) },
            draftCount: draftsApplied.draftCount || again.draftCount,
          }
        : again;
    }
  } else if (draftsApplied && draftsApplied.assigned) {
    // drafts alone already updated queue
  }

  const refresh = refreshQueueFromVehicles();
  let teamDraftCarriers = null;
  if (Array.isArray(store.drafts) && store.drafts.length) {
    teamDraftCarriers = syncPrintDraftCompaniesToDeliveryTeam(store.drafts);
    lastDraftCarrierSyncAt = Date.now();
  }
  return { ...refresh, draftsApplied, teamDraftCarriers };
}

function arabicWeekdayName(isoDate) {
  const names = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dt = new Date(`${String(isoDate).trim()}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  return names[dt.getDay()] || '';
}

function emptyCarSlot() {
  return { model: '', chassis: '', plate: '', remarks: '' };
}

/** Build print drafts from inventory vehicles (group by customer, max 10 cars / memo). */
function createPdfDraftsFromVehicles(vehicles, { assignedTo = 'admin' } = {}) {
  const list = (vehicles || []).filter((v) => normVin(v.vin));
  if (!list.length) throw new Error('لا توجد مركبات لتوليد PDF');

  const groups = new Map();
  for (const v of list) {
    const company = String(v.customerName || '').trim();
    const key = company || `__solo_${normVin(v.vin)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }

  const today = new Date().toISOString().slice(0, 10);
  const dayName = arabicWeekdayName(today);
  const created = [];

  for (const [, cars] of groups) {
    for (let offset = 0; offset < cars.length; offset += 10) {
      const chunk = cars.slice(offset, offset + 10);
      const company = String(chunk[0].customerName || '').trim();
      const carRows = chunk.map((c) => ({
        model: c.product || c.model || '',
        chassis: normVin(c.vin),
        plate: c.plate || '',
        remarks: ''
      }));
      while (carRows.length < 10) carRows.push(emptyCarSlot());

      const payload = {
        doc_date: today,
        invoice_number: '',
        dep_hour: '',
        dep_minute: '',
        customer_name: '',
        company_rep: company,
        transfer_date: today,
        corresponding_date: today,
        day_name: dayName,
        trailer_number: '',
        car_count: String(chunk.length),
        branch_to: '',
        attachments: '',
        cars: carRows
      };

      const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const draft = {
        id,
        printedAt: new Date().toISOString(),
        vin: normVin(chunk[0].vin),
        vins: chunk.map((c) => normVin(c.vin)).filter(Boolean),
        product: chunk[0].product || '',
        model: chunk[0].model || chunk[0].product || '',
        assignedTo,
        customerName: company,
        plate: chunk[0].plate || '',
        gt: chunk[0].gt || '',
        location: chunk[0].location || '',
        payload
      };
      attachDeliveryNoteMeta(draft, {
        entryAgent: assignedTo,
        vehicleStatus: 'delivery'
      });
      archiveDeliveryNoteFile(draft);
      store.drafts.unshift(draft);
      created.push({
        id: draft.id,
        vin: draft.vin,
        deliveryNoteNumber: draft.deliveryNoteNumber,
        carCount: chunk.length,
        company: company || '—'
      });
    }
  }

  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;
  return created;
}

function splitIsoDate(iso) {
  const s = String(iso || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { d: '', m: '', y: '' };
  return { d: m[3], m: m[2], y: m[1] };
}

function toHijriParts(isoDate) {
  try {
    if (!isoDate) return { d: '', m: '', y: '' };
    const dt = new Date(`${String(isoDate).trim()}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return { d: '', m: '', y: '' };
    const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      numberingSystem: 'latn'
    });
    const parts = fmt.formatToParts(dt) || [];
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return {
      d: String(get('day')).padStart(2, '0'),
      m: String(get('month')).padStart(2, '0'),
      y: String(get('year'))
    };
  } catch {
    return { d: '', m: '', y: '' };
  }
}

function flattenDeliveryNote(payload) {
  const p = payload || {};
  const doc = splitIsoDate(p.doc_date);
  const transfer = splitIsoDate(p.transfer_date || p.doc_date);
  const corresponding = toHijriParts(p.corresponding_date || p.transfer_date || p.doc_date);
  const cars = Array.isArray(p.cars) ? p.cars : [];
  const data = {
    date_d: doc.d,
    date_m: doc.m,
    date_y: doc.y,
    memo_number: p.invoice_number || '',
    dep_hour: p.dep_hour || '',
    dep_minute: p.dep_minute || '',
    customer_name: p.customer_name || '',
    company_rep: p.company_rep || '',
    transfer_d: transfer.d,
    transfer_m: transfer.m,
    transfer_y: transfer.y,
    corresponding_d: corresponding.d,
    corresponding_m: corresponding.m,
    corresponding_y: corresponding.y,
    day_name: p.day_name || '',
    trailer_number: p.trailer_number || '',
    car_count: p.car_count || '',
    branch_to: p.branch_to || '',
    attachments: p.attachments || '',
    transport_rep_sign: '',
    warehouse_supervisor_sign: '',
    recipient_name: '',
    recipient_signature: '',
    recipient_date: '',
    rec_hour: '',
    rec_minute: ''
  };
  for (let i = 1; i <= 10; i += 1) {
    const row = cars[i - 1] || {};
    data[`car${i}_model`] = row.model || '';
    data[`car${i}_chassis`] = row.chassis || '';
    data[`car${i}_plate`] = row.plate || '';
    data[`car${i}_remarks`] = row.remarks || '';
  }
  return data;
}

function generateDocxWithTemplate(templateFile, payload) {
  if (!fs.existsSync(templateFile)) {
    throw new Error(`قالب Word غير موجود (${path.basename(templateFile)})`);
  }
  const content = fs.readFileSync(templateFile);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });
  doc.render(flattenDeliveryNote(payload));
  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });
}

function generateDocx(payload) {
  return generateDocxWithTemplate(TEMPLATE_FILE, payload);
}

function generateDeliveryCheckDocx(payload) {
  return generateDocxWithTemplate(DELIVERY_CHECK_TEMPLATE_FILE, payload);
}

function getDeliveryCheckPdfBuffer() {
  if (!fs.existsSync(DELIVERY_CHECK_PDF_FILE)) {
    throw new Error('ملف delivery_check_note.pdf غير موجود');
  }
  return fs.readFileSync(DELIVERY_CHECK_PDF_FILE);
}

// ——— HTTP app ———
const app = express();

/** Binary upload — avoids base64 JSON bloat (Railway/proxy size limits). Must be before express.json. */
app.post('/api/delivery-inventory/restore-export-bin', express.raw({ limit: '80mb', type: '*/*' }), (req, res) => {
  try {
    const filename = decodeURIComponent(String(req.headers['x-filename'] || 'delivery_export.xlsx'));
    if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'ملف التصدير مطلوب' });
    }
    return finishRestoreExport(req.body, filename, res);
  } catch (err) {
    console.error('[restore-export-bin]', err);
    return res.status(500).json({ error: err.message || 'فشل استيراد الأرشيف' });
  }
});

/**
 * Data Uploader / day-box binary save — same disk path family as Admin Push RTL archive.
 * Stores timestamped snapshot + Excel under report-sheet-data/rtl-daily (PERSISTENT_ROOT).
 * Query: date=YYYY-MM-DD&fileName=...&source=uploader-day-box
 */
app.post('/api/rtl-daily/save-file', express.raw({ limit: '80mb', type: '*/*' }), (req, res) => {
  try {
    const buf = req.body && Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) {
      return res.status(400).json({ error: 'RTL Excel file required' });
    }
    const dateKey = normalizeDateKey(req.query.date) || todayIsoRiyadh();
    const fileName = decodeURIComponent(String(
      req.query.fileName || req.headers['x-filename'] || req.headers['x-file-name'] || 'rtl.xlsx'
    ).trim()) || 'rtl.xlsx';
    const source = String(req.query.source || 'uploader-day-box').trim() || 'uploader-day-box';
    let vehicles = [];
    try {
      vehicles = scanRtlStockBuffer(buf);
    } catch (scanErr) {
      console.error('[rtl-daily/save-file] scan failed', scanErr);
      return res.status(400).json({ error: scanErr.message || 'Failed to scan RTL Excel' });
    }
    if (!vehicles.length) {
      return res.status(400).json({ error: 'No VINs found in RTL Excel' });
    }
    const snap = persistRtlDailySnapshot({
      dateKey,
      vehicles,
      fileName,
      source,
      excelBuffer: buf
    });
    return res.json({
      ok: true,
      id: snap.id,
      date: snap.date,
      asOfDate: snap.asOfDate,
      count: snap.count,
      age0: snap.age0,
      at: snap.at,
      excelSaved: snap.excelSaved,
      persistentRoot: PERSISTENT_ROOT,
      byDayExcel: rtlDailyByDayExcelPath(snap.date)
    });
  } catch (err) {
    console.error('[rtl-daily/save-file]', err);
    return res.status(500).json({ error: err.message || 'Save failed' });
  }
});

app.post('/api/delivery-team/upload', express.raw({ limit: '80mb', type: '*/*' }), deliveryTeamUpload);
app.post('/api/delivery-team/sales-raw', express.raw({ limit: '80mb', type: '*/*' }), deliveryTeamSalesRawUpload);

app.use(express.json({ limit: '80mb' }));

// Delivery Team module (Hanouf / employees) — isolated store + auth
app.use('/api/delivery-team', deliveryTeamRouter);
app.get('/deliveryteam', (_req, res) => {
  res.redirect('/deliveryteam/');
});
app.get('/deliveryteam/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'deliveryteam', 'index.html'));
});

/** Shared Sales Report push — same snapshot for every laptop on this server. */
app.get('/api/report-sheet/meta', (_req, res) => {
  const meta = loadReportSheetMeta();
  res.json({
    at: meta.at || 0,
    targetsAt: meta.targetsAt || meta.at || 0,
    slots: Array.isArray(meta.slots) ? meta.slots : [],
    hasSales: !!meta.hasSales,
    hasCancelled: !!meta.hasCancelled,
    targets: Array.isArray(meta.targets) ? meta.targets : [],
    accessoriesSettled: Number(meta.accessoriesSettled) || 0,
    workingDays: Math.max(1, Number(meta.workingDays) || 22),
    allocationValues: meta.allocationValues && typeof meta.allocationValues === 'object'
      ? meta.allocationValues
      : {},
    fileNames: meta.fileNames && typeof meta.fileNames === 'object' ? meta.fileNames : {}
  });
});

app.get('/api/report-sheet/file/:slot', (req, res) => {
  const fp = reportSheetFilePath(req.params.slot);
  if (!fp || !fs.existsSync(fp)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const meta = loadReportSheetMeta();
  const slot = String(req.params.slot || '').trim().toLowerCase();
  const name = (meta.fileNames && meta.fileNames[slot]) || `${slot}.xlsx`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Report-Sheet-Name', encodeURIComponent(name));
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(fp);
});

app.post('/api/report-sheet/push', (req, res) => {
  try {
    ensureReportSheetDirs();
    ensureRtlDayRollover();
    const body = req.body || {};
    const at = Date.now();
    const filesIn = body.files && typeof body.files === 'object' ? body.files : {};
    const fileNames = {};
    const slots = [];

    clearReportSheetFiles();

    let rtlSnapshot = null;

    for (const id of REPORT_SLOT_IDS) {
      const entry = filesIn[id];
      if (!entry || !entry.base64) continue;
      const buf = Buffer.from(String(entry.base64), 'base64');
      if (!buf.length) continue;
      const fp = reportSheetFilePath(id);
      fs.writeFileSync(fp, buf);
      const name = String(entry.name || `${id}.xlsx`).trim() || `${id}.xlsx`;
      fileNames[id] = name;
      slots.push(id);

      if (id === 'rtl') {
        try {
          const vehicles = scanRtlStockBuffer(buf);
          // Live Push always archives as TODAY (Riyadh) only — past schedule days stay on Data Uploader day files.
          rtlSnapshot = persistRtlDailySnapshot({
            dateKey: todayIsoRiyadh(),
            vehicles,
            fileName: name,
            source: 'admin-push',
            excelBuffer: buf,
            at
          });
        } catch (snapErr) {
          console.error('[report-sheet/push] RTL snapshot', snapErr);
        }
      }
    }

    const meta = {
      at,
      targetsAt: at,
      slots,
      hasSales: slots.includes('sales'),
      hasCancelled: slots.includes('cancelled'),
      targets: Array.isArray(body.targets) ? body.targets : [],
      accessoriesSettled: Math.max(0, Number(body.accessoriesSettled) || 0),
      workingDays: Math.max(1, Number(body.workingDays) || 22),
      allocationValues: body.allocationValues && typeof body.allocationValues === 'object'
        ? body.allocationValues
        : {},
      fileNames
    };
    saveReportSheetMeta(meta);
    broadcastReportSheetUpdate(at);
    return res.json({
      ok: true,
      at,
      slots,
      hasSales: meta.hasSales,
      hasCancelled: meta.hasCancelled,
      rtlDaily: rtlSnapshot
        ? {
          id: rtlSnapshot.id,
          date: rtlSnapshot.date,
          count: rtlSnapshot.count,
          at: rtlSnapshot.at,
          excelSaved: rtlSnapshot.excelSaved
        }
        : null
    });
  } catch (err) {
    console.error('[report-sheet/push]', err);
    return res.status(500).json({ error: err.message || 'Push failed' });
  }
});

app.post('/api/report-sheet/clear', (_req, res) => {
  try {
    clearReportSheetFiles();
    const meta = defaultReportSheetMeta();
    meta.at = Date.now();
    saveReportSheetMeta(meta);
    broadcastReportSheetUpdate(meta.at);
    return res.json({ ok: true, at: meta.at });
  } catch (err) {
    console.error('[report-sheet/clear]', err);
    return res.status(500).json({ error: err.message || 'Clear failed' });
  }
});

/** RTL daily VIN/product/suffix archive — does not touch live dashboard slots. */
app.get('/api/rtl-daily/meta', (_req, res) => {
  try {
    ensureRtlDayRollover();
    const hydrated = rehydrateRtlFromByDayMirrors();
    const index = loadRtlDailyIndex();
    const activeByDay = index.activeByDay || {};
    const snapshots = listRtlSnapshotsNewestFirst().map((s) => ({
      ...s,
      active: Boolean(s.date && activeByDay[s.date] === s.id)
    }));
    return res.json({
      snapshots,
      activeByDay,
      today: todayIsoRiyadh(),
      persistentRoot: PERSISTENT_ROOT,
      archiveDir: RTL_DAILY_DIR,
      byDayDir: path.join(RTL_DAILY_DIR, 'by-day'),
      rehydratedDays: Number(hydrated && hydrated.restored) || 0
    });
  } catch (err) {
    console.error('[rtl-daily/meta]', err);
    return res.status(500).json({ error: err.message || 'Failed to load RTL daily index' });
  }
});

/** Download the stable by-day Excel mirror (Admin-style durable file). */
app.get('/api/rtl-daily/by-day/:date/excel', (req, res) => {
  try {
    const dateKey = normalizeDateKey(req.params.date);
    if (!dateKey || !isValidRtlDateKey(dateKey)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    const xfp = rtlDailyByDayExcelPath(dateKey);
    if (!xfp || !fs.existsSync(xfp)) {
      return res.status(404).json({ error: `No by-day Excel for ${dateKey}` });
    }
    let fileName = `${dateKey}.xlsx`;
    const metaFp = rtlDailyByDayMetaPath(dateKey);
    if (metaFp && fs.existsSync(metaFp)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFp, 'utf8'));
        if (meta && meta.fileName) fileName = String(meta.fileName);
      } catch { /* ignore */ }
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(xfp);
  } catch (err) {
    console.error('[rtl-daily/by-day/excel]', err);
    return res.status(500).json({ error: err.message || 'Download failed' });
  }
});

/** One active RTL file per calendar day for a month (schedule day columns). */
app.get('/api/rtl-daily/active-month', (req, res) => {
  try {
    ensureRtlDayRollover();
    rehydrateRtlFromByDayMirrors();
    const month = String(req.query.month || '').trim();
    const pack = loadRtlActiveMonth(month);
    if (!pack) {
      return res.status(400).json({ error: 'month query required as YYYY-MM' });
    }
    return res.json(pack);
  } catch (err) {
    console.error('[rtl-daily/active-month]', err);
    return res.status(500).json({ error: err.message || 'Failed to load active month' });
  }
});

/**
 * Use date: pin a specific snapshot as the active RTL file for its calendar day.
 * Schedule day N for that date then uses only this file (not every push that day).
 */
app.post('/api/rtl-daily/use', (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || '').trim();
    const dateField = String(body.date || '').trim();
    const ref = id || dateField;
    if (!ref) {
      return res.status(400).json({ error: 'id (snapshot id) is required' });
    }
    let dateOverride = String(body.scheduleDate || body.targetDate || body.dateKey || '').trim();
    // When id is present and date is YYYY-MM-DD, treat date as the schedule day to pin.
    if (!dateOverride && id && /^\d{4}-\d{2}-\d{2}$/.test(dateField)) {
      dateOverride = dateField;
    }
    const result = setRtlActiveSnapshot(ref, dateOverride);
    if (!result) return res.status(404).json({ error: 'Snapshot not found or invalid schedule date' });
    return res.json({
      ok: true,
      id: result.id,
      date: result.date,
      asOfDate: result.asOfDate,
      count: result.count,
      at: result.at,
      fileName: result.fileName,
      source: result.source,
      activeByDay: result.activeByDay
    });
  } catch (err) {
    console.error('[rtl-daily/use]', err);
    return res.status(500).json({ error: err.message || 'Use date failed' });
  }
});

app.get('/api/rtl-daily/compare', (req, res) => {
  try {
    const fromRef = String(req.query.from || '').trim();
    const toRef = String(req.query.to || '').trim();
    if (!fromRef || !toRef) {
      return res.status(400).json({ error: 'from and to (snapshot id or YYYY-MM-DD) are required' });
    }
    const fromSnap = loadRtlDailySnapshot(fromRef);
    const toSnap = loadRtlDailySnapshot(toRef);
    if (!fromSnap) return res.status(404).json({ error: `No snapshot for ${fromRef}` });
    if (!toSnap) return res.status(404).json({ error: `No snapshot for ${toRef}` });
    return res.json(compareRtlSnapshots(fromSnap, toSnap));
  } catch (err) {
    console.error('[rtl-daily/compare]', err);
    return res.status(500).json({ error: err.message || 'Compare failed' });
  }
});

app.get('/api/rtl-daily/last-seen', (_req, res) => {
  try {
    const pack = buildRtlDailyLastSeenIndex();
    return res.json(pack);
  } catch (err) {
    console.error('[rtl-daily/last-seen]', err);
    return res.status(500).json({ error: err.message || 'Failed to build last-seen index' });
  }
});

app.get('/api/rtl-daily/vin/:vin', (req, res) => {
  try {
    const vin = String(req.params.vin || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!vin || vin.length < 11) {
      return res.status(400).json({ error: 'Invalid VIN' });
    }
    const history = [];
    for (const entry of listRtlSnapshotsNewestFirst()) {
      const snap = loadRtlDailySnapshot(entry.id || entry.date);
      if (!snap) continue;
      const hit = (snap.vehicles || []).find((v) => v.vin === vin);
      if (!hit) continue;
      history.push({
        snapshotId: snap.id,
        date: snap.date,
        at: snap.at,
        product: hit.product || '',
        suffix: hit.suffix || '',
        location: hit.location || '',
        vehicleSearchArea: hit.vehicleSearchArea || ''
      });
    }
    return res.json({
      vin,
      count: history.length,
      last: history[0] || null,
      history
    });
  } catch (err) {
    console.error('[rtl-daily/vin]', err);
    return res.status(500).json({ error: err.message || 'VIN lookup failed' });
  }
});

app.get('/api/rtl-daily/:id', (req, res) => {
  try {
    const ref = String(req.params.id || '').trim();
    if (!normalizeRtlSnapshotId(ref) && !normalizeDateKey(ref)) {
      return res.status(400).json({ error: 'Invalid snapshot id' });
    }
    const snap = loadRtlDailySnapshot(ref);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    return res.json(snap);
  } catch (err) {
    console.error('[rtl-daily/get]', err);
    return res.status(500).json({ error: err.message || 'Failed to load snapshot' });
  }
});

app.post('/api/rtl-daily/save', (req, res) => {
  try {
    const body = req.body || {};
    const dateKey = normalizeDateKey(body.date) || todayIsoRiyadh();
    const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
    const source = String(body.source || 'uploader').trim() || 'uploader';
    let excelBuffer = null;
    if (body.excelBase64) {
      try {
        excelBuffer = Buffer.from(String(body.excelBase64), 'base64');
      } catch {
        excelBuffer = null;
      }
    }
    // Uploader must store the Excel on disk like Admin Push (survives across deploys on the volume).
    if (/^uploader/i.test(source) && (!excelBuffer || !excelBuffer.length)) {
      return res.status(400).json({
        error: 'Excel file required. Drop/select the RTL file again so it is stored on the server (same archive as Admin Push).'
      });
    }
    // Prefer server-side Col J scan from the Excel so age 0 / RES match Admin Push.
    let vehicles = vehiclesIn;
    if (excelBuffer && excelBuffer.length) {
      try {
        const scanned = scanRtlStockBuffer(excelBuffer);
        if (scanned.length) vehicles = scanned;
      } catch (scanErr) {
        console.error('[rtl-daily/save] excel rescan failed, using client vehicles', scanErr);
      }
    }
    const snap = persistRtlDailySnapshot({
      dateKey,
      vehicles,
      fileName: body.fileName,
      source,
      excelBuffer
    });
    const age0 = (snap.vehicles || []).filter((v) => {
      const a = String(v?.age ?? '').trim();
      if (!a) return true;
      const n = Number(String(a).replace(/[, ]/g, ''));
      return Number.isFinite(n) ? n === 0 : a === '0';
    }).length;
    return res.json({
      ok: true,
      id: snap.id,
      date: snap.date,
      asOfDate: snap.asOfDate,
      count: snap.count,
      age0: snap.age0 != null ? snap.age0 : age0,
      at: snap.at,
      excelSaved: snap.excelSaved,
      byDayExcel: rtlDailyByDayExcelPath(snap.date)
    });
  } catch (err) {
    console.error('[rtl-daily/save]', err);
    return res.status(500).json({ error: err.message || 'Save failed' });
  }
});

app.delete('/api/rtl-daily/:id', (req, res) => {
  try {
    const id = normalizeRtlSnapshotId(req.params.id);
    if (!id || (DATE_KEY_RE.test(id) && !String(id).includes('T'))) {
      return res.status(400).json({
        error: 'Delete requires a full timestamped snapshot id. Calendar-date mass delete is disabled to protect history.'
      });
    }
    const fp = rtlDailySnapshotPath(id);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    const xfp = rtlDailyExcelPath(id);
    if (xfp && fs.existsSync(xfp)) fs.unlinkSync(xfp);
    const index = loadRtlDailyIndex();
    const removed = index.snapshots.find((s) => s.id === id);
    const snapshots = index.snapshots.filter((s) => s.id !== id);
    const activeByDay = { ...(index.activeByDay || {}) };
    if (removed && removed.date && activeByDay[removed.date] === id) {
      delete activeByDay[removed.date];
    }
    // Re-derive missing days from remaining newest (last file per day).
    const normalized = normalizeRtlActiveByDay(activeByDay, snapshots);
    saveRtlDailyIndex({ snapshots, activeByDay: normalized });
    return res.json({ ok: true, id, activeByDay: normalized });
  } catch (err) {
    console.error('[rtl-daily/delete]', err);
    return res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

app.post('/api/delivery-coordinator/auth', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  return res.json({ ok: true, username: auth.username, role: auth.role });
});

app.get('/api/warehouse/stock', (_req, res) => {
  ensureWarehouseStock();
  const inStock = store.warehouseStock
    .filter((e) => e.status === 'in')
    .map(enrichWarehouseEntry)
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot), 'en'));
  res.json({
    stock: inStock,
    history: store.warehouseStock.slice(-200).map(enrichWarehouseEntry),
    zones: warehouseOccupancy(),
    zoneNames: WAREHOUSE_ZONES
  });
});

app.post('/api/warehouse/stock-in', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'warehouse') {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لإدخال المستودع' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin || vin.length < 8) {
    return res.status(400).json({ error: 'رقم الشاسيه غير صالح — راجع القراءة وصحّحها' });
  }

  let zone = String(req.body?.zone || '').trim().toUpperCase();
  if (!WAREHOUSE_ZONES.includes(zone)) {
    return res.status(400).json({ error: 'اختر منطقة صالحة (A–F)' });
  }

  let slot = String(req.body?.slot || '').trim().toUpperCase();
  if (slot) {
    const m = slot.match(/^([A-F])-?(\d{1,3})$/i);
    if (!m) return res.status(400).json({ error: 'مكان الوقوف غير صالح — مثال: A-1' });
    zone = m[1].toUpperCase();
    slot = `${zone}-${Number(m[2])}`;
    const zoneMax = WAREHOUSE_ZONE_CONFIG[zone]?.total || 40;
    if (Number(m[2]) < 1 || Number(m[2]) > zoneMax) {
      return res.status(400).json({ error: `رقم الموقف يجب أن يكون بين 1 و ${zoneMax} للمنطقة ${zone}` });
    }
  } else {
    slot = nextFreeSlot(zone);
    if (!slot) return res.status(409).json({ error: `المنطقة ${zone} ممتلئة` });
  }

  ensureWarehouseStock();
  const existing = findWarehouseInStock(vin);
  if (existing) {
    return res.status(409).json({
      error: `هذا الشاسيه موجود مسبقاً في ${existing.slot}`,
      entry: enrichWarehouseEntry(existing)
    });
  }

  const slotTaken = store.warehouseStock.find(
    (e) => e.status === 'in' && String(e.slot).toUpperCase() === slot
  );
  if (slotTaken) {
    return res.status(409).json({
      error: `الموقف ${slot} مشغول بالشاسيه ${slotTaken.vin}`
    });
  }

  const veh = vehicleIndex().get(vin);
  const queueItem = findQueueItem(vin);
  const now = new Date().toISOString();
  const entry = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vin,
    zone,
    slot,
    status: 'in',
    stockedInAt: now,
    stockedOutAt: '',
    stockedInBy: auth.username,
    stockedOutBy: '',
    product: veh?.product || veh?.model || queueItem?.product || String(req.body?.product || '').trim(),
    plate: veh?.plate || queueItem?.plate || String(req.body?.plate || '').trim()
  };
  store.warehouseStock.push(entry);
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichWarehouseEntry(entry),
    inCoordinatorQueue: Boolean(queueItem),
    zones: warehouseOccupancy()
  });
});

app.post('/api/warehouse/stock-out', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'warehouse') {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لإدخال المستودع' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin) return res.status(400).json({ error: 'رقم الشاسيه مطلوب' });

  const entry = findWarehouseInStock(vin);
  if (!entry) {
    return res.status(404).json({ error: 'هذا الشاسيه غير موجود في ساحة المستودع' });
  }

  entry.status = 'out';
  entry.stockedOutAt = new Date().toISOString();
  entry.stockedOutBy = auth.username;
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichWarehouseEntry(entry),
    zones: warehouseOccupancy()
  });
});

app.get('/api/showroom-parking/stock', (_req, res) => {
  ensureShowroomParking();
  res.json({
    stock: store.showroomParking
      .filter((e) => e.status === 'in')
      .map(enrichShowroomParkingEntry)
      .sort((a, b) => String(a.slot).localeCompare(String(b.slot), 'en')),
    history: store.showroomParking.slice(-100).map(enrichShowroomParkingEntry),
    occupancy: showroomParkingOccupancy(),
    slots: [...SHOWROOM_PARKING_SLOTS],
    label: SHOWROOM_PARKING_LABEL
  });
});

app.post('/api/showroom-parking/stock-in', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'showroom_admin') {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لموقف سيارات العرض' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin || vin.length < 8) {
    return res.status(400).json({ error: 'رقم الشاسيه غير صالح' });
  }

  let slot = normalizeShowroomParkingSlot(req.body?.slot);
  if (!slot) {
    const occ = showroomParkingOccupancy();
    const free = occ.slots.find((s) => s.free);
    if (!free) return res.status(409).json({ error: 'موقف العرض ممتلئ (7 أماكن)' });
    slot = free.slot;
  }

  ensureShowroomParking();
  const existing = findShowroomParkingInStock(vin);
  if (existing) {
    return res.status(409).json({
      error: `هذا الشاسيه موجود مسبقاً في ${existing.slot}`,
      code: 'already_parked',
      entry: enrichShowroomParkingEntry(existing),
      conflictSlot: existing.slot
    });
  }

  const slotTaken = store.showroomParking.find(
    (e) => e.status === 'in' && String(e.slot).toUpperCase() === slot
  );
  if (slotTaken) {
    return res.status(409).json({
      error: `الموقف ${slot} مشغول بالشاسيه ${slotTaken.vin}`,
      code: 'slot_taken',
      takenBy: slotTaken.vin
    });
  }

  const queueItem = findQueueItem(vin);
  const forcePark = Boolean(req.body?.forcePark || req.body?.forceReassign);
  if (queueItem && !isUnassignedDeliveryCompany(queueItem) && !forcePark) {
    const company = String(queueItem.deliveryCompany || queueItem.company || '').trim();
    return res.status(409).json({
      error: `هذا الشاسيه معيّن لشركة ${company || 'أخرى'} — أكّد لإدخاله في موقف العرض`,
      code: 'queue_company_conflict',
      conflict: {
        vin,
        company: company || 'بدون شركة',
        status: queueItem.status || '',
        assignedTo: queueItem.assignedTo || ''
      }
    });
  }

  const veh = vehicleIndex().get(vin);
  const now = new Date().toISOString();
  const entry = {
    id: `sr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vin,
    slot,
    zone: 'SR',
    status: 'in',
    stockedInAt: now,
    stockedOutAt: '',
    stockedInBy: auth.username,
    stockedOutBy: '',
    product: veh?.product || veh?.model || queueItem?.product || String(req.body?.product || '').trim(),
    model: veh?.model || String(req.body?.model || '').trim(),
    plate: veh?.plate || queueItem?.plate || String(req.body?.plate || '').trim(),
    section: 'showroom',
    label: SHOWROOM_PARKING_LABEL
  };
  store.showroomParking.push(entry);
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichShowroomParkingEntry(entry),
    occupancy: showroomParkingOccupancy()
  });
});

app.post('/api/showroom-parking/stock-out', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'showroom_admin' && auth.username !== SHOWROOM_AGENT) {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لموقف سيارات العرض' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin) return res.status(400).json({ error: 'رقم الشاسيه مطلوب' });

  const entry = findShowroomParkingInStock(vin);
  if (!entry) {
    return res.status(404).json({ error: 'هذا الشاسيه غير موجود في موقف العرض' });
  }

  entry.status = 'out';
  entry.stockedOutAt = new Date().toISOString();
  entry.stockedOutBy = auth.username;
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichShowroomParkingEntry(entry),
    occupancy: showroomParkingOccupancy()
  });
});

function requireYassinAgent(req, res) {
  const auth = authenticateAgent(req.body?.username || req.query?.username, req.body?.password || req.query?.password);
  if (!auth.ok) {
    res.status(401).json({ error: auth.error });
    return null;
  }
  if (auth.username !== SHOWROOM_AGENT) {
    res.status(403).json({ error: 'موقف الـ 10 أماكن متاح لياسين فقط' });
    return null;
  }
  return auth;
}

app.get('/api/yassin-parking/board', (req, res) => {
  const auth = requireYassinAgent(req, res);
  if (!auth) return;
  ensureYassinParking();
  res.json({
    occupancy: yassinParkingOccupancy(),
    slots: [...YASSIN_PARKING_SLOTS],
    label: YASSIN_PARKING_LABEL,
    cars: buildYassinCarsList(),
    parked: store.yassinParking
      .filter((e) => e.status === 'in')
      .map(enrichYassinParkingEntry)
      .sort((a, b) => String(a.slot).localeCompare(String(b.slot), 'en'))
  });
});

app.get('/api/yassin-parking/lookup-vin', (req, res) => {
  const auth = requireYassinAgent(req, res);
  if (!auth) return;
  const vin = normVin(req.query?.vin || req.body?.vin);
  if (!vin) return res.status(400).json({ error: 'رقم الشاسيه مطلوب' });
  const guest = guestInfoFromRaw(vin);
  if (!guest.inRaw) {
    return res.status(404).json({
      error: 'الشاسيه غير موجود في البيانات الخام',
      ...guest
    });
  }
  res.json({ ok: true, ...guest, parked: enrichYassinParkingEntry(findYassinParkingInStock(vin) || { vin }) });
});

app.post('/api/yassin-parking/assign', (req, res) => {
  const auth = requireYassinAgent(req, res);
  if (!auth) return;

  const vin = normVin(req.body?.vin);
  if (!vin || vin.length < 8) {
    return res.status(400).json({ error: 'رقم الشاسيه غير صالح' });
  }

  const carType = normalizeVehicleStatus(req.body?.carType || req.body?.vehicleStatus || req.body?.type);
  if (!carType) {
    return res.status(400).json({ error: 'اختر نوع السيارة: عرض أو تسليم' });
  }

  const guest = guestInfoFromRaw(vin);
  if (!guest.inRaw) {
    return res.status(404).json({ error: 'تحقق من الشاسيه في البيانات الخام أولاً — VIN غير موجود' });
  }

  let slot = '';
  let guestArrivalTime = String(req.body?.guestArrivalTime || req.body?.arrivalTime || req.body?.time || '').trim();

  if (carType === 'delivery') {
    slot = normalizeYassinParkingSlot(req.body?.slot);
    if (!slot) {
      return res.status(400).json({ error: 'لسيارة التسليم اختر موقفًا من الـ 10 أماكن' });
    }
    if (!guestArrivalTime) {
      return res.status(400).json({ error: 'لسيارة التسليم اختر وقت حضور الضيف' });
    }
  } else {
    // Display: parking optional
    slot = normalizeYassinParkingSlot(req.body?.slot);
    guestArrivalTime = guestArrivalTime || '';
  }

  ensureYassinParking();

  // Free previous parking for this VIN if re-assigning
  const existing = findYassinParkingInStock(vin);
  if (existing) {
    if (carType === 'display' && !slot) {
      // Mark display without slot — release parking
      existing.status = 'out';
      existing.stockedOutAt = new Date().toISOString();
      existing.stockedOutBy = auth.username;
      existing.carType = 'display';
      // Keep a lightweight "display" record without occupying a slot
      const displayEntry = {
        id: `ys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        vin,
        slot: '',
        zone: 'YS',
        status: 'display',
        stockedInAt: new Date().toISOString(),
        stockedOutAt: '',
        stockedInBy: auth.username,
        stockedOutBy: '',
        product: guest.product,
        model: guest.model,
        plate: guest.plate,
        guestName: guest.guestName,
        guestPhone: guest.guestPhone,
        carType: 'display',
        guestArrivalTime: '',
        section: 'yassin',
        label: YASSIN_PARKING_LABEL
      };
      // Remove old display stubs for same VIN
      store.yassinParking = store.yassinParking.filter(
        (e) => !(normVin(e.vin) === vin && e.status === 'display')
      );
      store.yassinParking.push(displayEntry);
      // Sync queue vehicleStatus
      let q = findQueueItem(vin);
      if (q) {
        q.vehicleStatus = 'display';
        q.agentStatus = 'display';
        q.status = 'available';
        q.assignedTo = auth.username;
      }
      persistAndBroadcast();
      return res.json({
        ok: true,
        entry: enrichYassinParkingEntry(displayEntry),
        occupancy: yassinParkingOccupancy(),
        cars: buildYassinCarsList(),
        guest
      });
    }
    // Moving to new slot or updating
    if (slot && String(existing.slot).toUpperCase() === slot) {
      existing.carType = carType;
      existing.guestArrivalTime = guestArrivalTime;
      existing.guestName = guest.guestName;
      existing.guestPhone = guest.guestPhone;
      existing.product = guest.product || existing.product;
      let q = findQueueItem(vin);
      if (q) {
        q.vehicleStatus = carType;
        if (carType === 'display') {
          q.agentStatus = 'display';
          q.status = 'available';
        } else {
          q.assignedTo = auth.username;
          if (!q.agentStatus || q.agentStatus === 'display') q.agentStatus = 'in_stock';
          q.status = 'claimed';
        }
      }
      persistAndBroadcast();
      return res.json({
        ok: true,
        entry: enrichYassinParkingEntry(existing),
        occupancy: yassinParkingOccupancy(),
        cars: buildYassinCarsList(),
        guest
      });
    }
    existing.status = 'out';
    existing.stockedOutAt = new Date().toISOString();
    existing.stockedOutBy = auth.username;
  }

  // Clear previous display stubs
  store.yassinParking = store.yassinParking.filter(
    (e) => !(normVin(e.vin) === vin && e.status === 'display')
  );

  if (carType === 'display' && !slot) {
    const displayEntry = {
      id: `ys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      vin,
      slot: '',
      zone: 'YS',
      status: 'display',
      stockedInAt: new Date().toISOString(),
      stockedOutAt: '',
      stockedInBy: auth.username,
      stockedOutBy: '',
      product: guest.product,
      model: guest.model,
      plate: guest.plate,
      guestName: guest.guestName,
      guestPhone: guest.guestPhone,
      carType: 'display',
      guestArrivalTime: '',
      section: 'yassin',
      label: YASSIN_PARKING_LABEL
    };
    store.yassinParking.push(displayEntry);
    let q = findQueueItem(vin);
    if (!q) {
      q = enrichFromVehicle({
        vin,
        status: 'available',
        agentStatus: 'display',
        vehicleStatus: 'display',
        assignedTo: auth.username,
        assignedAt: new Date().toISOString(),
        addedAt: new Date().toISOString(),
        product: guest.product,
        plate: guest.plate
      }, vehicleIndex().get(vin) || {});
      store.queue.push(q);
    } else {
      q.vehicleStatus = 'display';
      q.agentStatus = 'display';
      q.status = 'available';
      q.assignedTo = auth.username;
    }
    persistAndBroadcast();
    return res.json({
      ok: true,
      entry: enrichYassinParkingEntry(displayEntry),
      occupancy: yassinParkingOccupancy(),
      cars: buildYassinCarsList(),
      guest
    });
  }

  if (!slot) {
    return res.status(400).json({ error: 'اختر موقفًا' });
  }

  const slotTaken = store.yassinParking.find(
    (e) => e.status === 'in' && String(e.slot).toUpperCase() === slot
  );
  if (slotTaken && normVin(slotTaken.vin) !== vin) {
    return res.status(409).json({
      error: `الموقف ${slot} مشغول بالشاسيه ${slotTaken.vin}`,
      code: 'slot_taken',
      takenBy: slotTaken.vin
    });
  }

  const now = new Date().toISOString();
  const entry = {
    id: `ys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vin,
    slot,
    zone: 'YS',
    status: 'in',
    stockedInAt: now,
    stockedOutAt: '',
    stockedInBy: auth.username,
    stockedOutBy: '',
    product: guest.product,
    model: guest.model,
    plate: guest.plate,
    guestName: guest.guestName,
    guestPhone: guest.guestPhone,
    carType,
    guestArrivalTime: carType === 'delivery' ? guestArrivalTime : (guestArrivalTime || ''),
    section: 'yassin',
    label: YASSIN_PARKING_LABEL
  };
  store.yassinParking.push(entry);

  let qItem = findQueueItem(vin);
  if (!qItem) {
    qItem = enrichFromVehicle({
      vin,
      status: carType === 'display' ? 'available' : 'claimed',
      agentStatus: carType === 'display' ? 'display' : 'in_stock',
      vehicleStatus: carType,
      assignedTo: auth.username,
      assignedAt: now,
      addedAt: now,
      product: guest.product,
      plate: guest.plate
    }, vehicleIndex().get(vin) || {});
    store.queue.push(qItem);
  } else {
    qItem.vehicleStatus = carType;
    qItem.assignedTo = auth.username;
    if (carType === 'display') {
      qItem.agentStatus = 'display';
      qItem.status = 'available';
    } else {
      qItem.status = 'claimed';
      if (!qItem.agentStatus || qItem.agentStatus === 'display') qItem.agentStatus = 'in_stock';
    }
  }

  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichYassinParkingEntry(entry),
    occupancy: yassinParkingOccupancy(),
    cars: buildYassinCarsList(),
    guest
  });
});

app.post('/api/yassin-parking/release', (req, res) => {
  const auth = requireYassinAgent(req, res);
  if (!auth) return;
  const vin = normVin(req.body?.vin);
  if (!vin) return res.status(400).json({ error: 'رقم الشاسيه مطلوب' });
  ensureYassinParking();
  let changed = false;
  for (const e of store.yassinParking) {
    if (normVin(e.vin) === vin && (e.status === 'in' || e.status === 'display')) {
      e.status = 'out';
      e.stockedOutAt = new Date().toISOString();
      e.stockedOutBy = auth.username;
      changed = true;
    }
  }
  if (!changed) return res.status(404).json({ error: 'السيارة غير موجودة في موقف ياسين' });
  persistAndBroadcast();
  res.json({
    ok: true,
    occupancy: yassinParkingOccupancy(),
    cars: buildYassinCarsList()
  });
});

app.get('/api/delivery-options', (_req, res) => {
  ensureOptions();
  res.json({
    companies: store.options.companies,
    cities: store.options.cities,
    companyPhones: store.options.companyPhones || {}
  });
});

app.put('/api/delivery-options/company-phone', (req, res) => {
  const company = String(req.body?.company || req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const fromAdmin = Boolean(req.body?.fromAdmin || req.body?.source === 'admin');
  const existing = getCompanyPhone(company);
  // Coordinator may set a number once; only admin can change/clear afterward.
  if (existing && !fromAdmin) {
    return res.status(403).json({
      error: 'الرقم محفوظ مسبقاً — التعديل من لوحة الإدارة فقط',
      company,
      phone: existing,
      companyPhones: store.options.companyPhones || {}
    });
  }
  const result = setCompanyPhone(company, phone);
  if (!result.ok) return res.status(400).json({ error: result.error });
  // Ensure company exists in list when saving a phone
  if (result.company) {
    const exists = (store.options.companies || []).some(
      (x) => String(x).toLowerCase() === result.company.toLowerCase()
    );
    if (!exists) {
      store.options.companies = uniqueSorted([...(store.options.companies || []), result.company]);
    }
  }
  persistAndBroadcast();
  res.json({
    ok: true,
    company: result.company,
    phone: result.phone,
    companyPhones: store.options.companyPhones,
    companies: store.options.companies
  });
});

app.post('/api/delivery-options/:kind', (req, res) => {
  const kind = String(req.params.kind || '');
  if (kind !== 'companies' && kind !== 'cities') {
    return res.status(400).json({ error: 'نوع القائمة غير معروف' });
  }
  ensureOptions();
  const name = normalizeOptionName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const list = store.options[kind];
  const exists = list.some((x) => x.toLowerCase() === name.toLowerCase());
  if (exists) return res.status(409).json({ error: 'هذا الاسم موجود مسبقاً', [kind]: list });
  list.push(name);
  store.options[kind] = uniqueSorted(list);
  persistAndBroadcast();
  res.json({ ok: true, name, [kind]: store.options[kind] });
});

app.delete('/api/delivery-options/:kind', (req, res) => {
  const kind = String(req.params.kind || '');
  if (kind !== 'companies' && kind !== 'cities') {
    return res.status(400).json({ error: 'نوع القائمة غير معروف' });
  }
  ensureOptions();
  const name = normalizeOptionName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const before = store.options[kind].length;
  store.options[kind] = store.options[kind].filter((x) => x.toLowerCase() !== name.toLowerCase());
  if (store.options[kind].length === before) {
    return res.status(404).json({ error: 'الاسم غير موجود', [kind]: store.options[kind] });
  }
  persistAndBroadcast();
  res.json({ ok: true, name, [kind]: store.options[kind] });
});

app.get('/api/delivery-inventory', (_req, res) => {
  res.json({
    vehicles: store.vehicles,
    dashboard: buildDashboard()
  });
});

app.delete('/api/delivery-inventory', (_req, res) => {
  const options = store.options || defaultOptions();
  store = emptyStore();
  store.options = options;
  ensureOptions();
  persistAndBroadcast();
  res.json({ dashboard: buildDashboard() });
});

app.post('/api/delivery-inventory/upload', (req, res) => {
  try {
    const { fileData, filename } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'الملف مطلوب' });
    const buffer = parseDataUrl(fileData);
    const parsed = parseSalesWorkbook(buffer, filename);
    if (!parsed.vehicles.length) {
      return res.status(400).json({ error: 'لم يتم العثور على أرقام شاسيه في الملف' });
    }
    const hasDrafts = Array.isArray(parsed.drafts) && parsed.drafts.length > 0;
    const hasQueue = Array.isArray(parsed.queue) && parsed.queue.length > 0;
    const refresh = applyParsedInventory(parsed, {
      replaceDrafts: Boolean(parsed.isExport && hasDrafts),
      replaceQueue: Boolean(parsed.isExport && hasQueue),
      uploadedBy: 'coordinator',
      uploadedByName: 'Coordinator',
    });
    const teamSync = syncHubVehiclesToDeliveryTeam(parsed.vehicles || []);
    persistAndBroadcast();
    res.json({
      imported: parsed.vehicles.length,
      vehicles: parsed.vehicles.slice(0, 200),
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      companiesFromDrafts: refresh.draftsApplied?.assigned || 0,
      draftsByCompany: refresh.draftsApplied?.byCompany || (hasDrafts ? computeDraftsByCompany() : {}),
      teamCarriersFromDrafts: refresh.teamDraftCarriers || null,
      isExport: Boolean(parsed.isExport),
      sheetName: parsed.sheetName,
      queueRefreshed: refresh.total,
      matchedUpdated: refresh.matched,
      notInNewFile: refresh.missing,
      deliveryTeamSync: teamSync,
      rawStatus: getHubRawStatus(),
    });
  } catch (err) {
    console.error('[upload]', err);
    res.status(500).json({ error: err.message || 'فشل رفع الملف' });
  }
});

/**
 * Admin restore from delivery_export_*.xlsx
 * (Vehicle Inventory + Print Drafts + Coordinator Queue).
 */
app.post('/api/delivery-inventory/restore-export', (req, res) => {
  try {
    const { fileData, filename } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'ملف التصدير مطلوب' });
    const buffer = parseDataUrl(fileData);
    return finishRestoreExport(buffer, filename || 'delivery_export.xlsx', res);
  } catch (err) {
    console.error('[restore-export]', err);
    res.status(500).json({ error: err.message || 'فشل استيراد الأرشيف' });
  }
});

/**
 * Merge Proforma / Invoice (+ delivery note) dates from Sales Raw onto existing
 * inventory by VIN — keeps drafts/queue intact.
 */
app.post('/api/delivery-inventory/merge-dates', (req, res) => {
  try {
    const { fileData, filename } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'ملف Sales Raw مطلوب' });
    const buffer = parseDataUrl(fileData);
    const parsed = parseSalesWorkbook(buffer, filename || 'Sales Raw Data.xlsx');
    if (parsed.isExport) {
      return res.status(400).json({
        error: 'ارفع ملف Sales Raw (ليس delivery_export) لتحديث تواريخ البروفورما/الفاتورة'
      });
    }
    if (!parsed.vehicles.length) {
      return res.status(400).json({ error: 'لم يتم العثور على مركبات في الملف' });
    }

    const incoming = new Map(parsed.vehicles.map((v) => [normVin(v.vin), v]));
    let updated = 0;
    let added = 0;
    const seen = new Set();

    store.vehicles = store.vehicles.map((v) => {
      const vin = normVin(v.vin);
      seen.add(vin);
      const src = incoming.get(vin);
      if (!src) return v;
      updated += 1;
      return {
        ...v,
        proformaDate: src.proformaDate || v.proformaDate || '',
        invoiceDate: src.invoiceDate || v.invoiceDate || '',
        deliveryNoteDate: src.deliveryNoteDate || v.deliveryNoteDate || '',
        customerName: v.customerName || src.customerName || '',
        phone: src.phone || v.phone || '',
        product: v.product || src.product || '',
        model: v.model || src.model || '',
        gt: v.gt || src.gt || '',
        location: v.location || src.location || '',
        plate: v.plate || src.plate || ''
      };
    });

    for (const [vin, src] of incoming) {
      if (seen.has(vin)) continue;
      store.vehicles.push(src);
      added += 1;
    }

    store.meta = {
      ...store.meta,
      datesMergedFrom: parsed.filename || filename || 'Sales Raw',
      datesMergedAt: new Date().toISOString()
    };
    const refresh = refreshQueueFromVehicles();
    persistAndBroadcast();
    res.json({
      ok: true,
      updated,
      added,
      withProforma: store.vehicles.filter((v) => v.proformaDate).length,
      withInvoice: store.vehicles.filter((v) => v.invoiceDate).length,
      totalVehicles: store.vehicles.length,
      queueRefreshed: refresh.total
    });
  } catch (err) {
    console.error('[merge-dates]', err);
    res.status(500).json({ error: err.message || 'فشل دمج التواريخ' });
  }
});

/** Paste Excel cells (TSV/CSV) → same inventory parse as file upload. */
app.post('/api/delivery-inventory/paste', (req, res) => {
  try {
    const text = req.body?.text;
    const filename = req.body?.filename || 'pasted-excel.tsv';
    const parsed = parseSalesText(text, filename);
    if (!parsed.vehicles.length && !(parsed.drafts || []).length) {
      return res.status(400).json({ error: 'لم يتم العثور على أرقام شاسيه في النص الملصق' });
    }
    if (!parsed.vehicles.length && (parsed.drafts || []).length) {
      // Drafts-only paste: keep existing vehicles, replace drafts
      store.drafts = parsed.drafts.slice(0, MAX_DRAFTS);
      persistAndBroadcast();
      return res.json({
        imported: 0,
        vehicles: [],
        draftsImported: parsed.drafts.length,
        queueImported: 0,
        isExport: true,
        sheetName: parsed.sheetName
      });
    }
    const refresh = applyParsedInventory(parsed);
    persistAndBroadcast();
    res.json({
      imported: parsed.vehicles.length,
      vehicles: parsed.vehicles,
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      isExport: Boolean(parsed.isExport),
      sheetName: parsed.sheetName,
      queueRefreshed: refresh.total,
      matchedUpdated: refresh.matched,
      notInNewFile: refresh.missing
    });
  } catch (err) {
    console.error('[paste]', err);
    res.status(500).json({ error: err.message || 'فشل قراءة البيانات الملصقة' });
  }
});

/**
 * Create print drafts (مذكرة ترحيل) from inventory / selected VINs.
 * Groups by customer name, max 10 cars per PDF draft.
 */
app.post('/api/delivery-inventory/create-pdf-drafts', (req, res) => {
  try {
    const vins = Array.isArray(req.body?.vins)
      ? req.body.vins.map(normVin).filter(Boolean)
      : null;
    let vehicles = store.vehicles.slice();
    if (vins && vins.length) {
      const want = new Set(vins);
      vehicles = vehicles.filter((v) => want.has(normVin(v.vin)));
    }
    if (!vehicles.length) {
      return res.status(400).json({
        error: vins?.length
          ? 'لم يتم العثور على الشاسيه المحدد في المخزون'
          : 'لا توجد بيانات مركبات — الصق أو ارفع Excel أولاً'
      });
    }
    const created = createPdfDraftsFromVehicles(vehicles, { assignedTo: 'admin' });
    persistAndBroadcast();
    res.json({
      created: created.length,
      drafts: created,
      draftsTotal: store.drafts.length
    });
  } catch (err) {
    console.error('[create-pdf-drafts]', err);
    res.status(500).json({ error: err.message || 'فشل توليد مسودات PDF' });
  }
});

app.get('/api/delivery-inventory/vehicles', (req, res) => {
  const search = String(req.query.search || '').trim().toUpperCase();
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  const exclude = new Set(
    String(req.query.exclude || '')
      .split(',')
      .map(normVin)
      .filter(Boolean)
  );
  let list = store.vehicles.filter((v) => {
    const vin = normVin(v.vin);
    if (!vin || exclude.has(vin)) return false;
    if (!search) return true;
    const hay = `${vin} ${v.product || ''} ${v.plate || ''} ${v.gt || ''} ${v.location || ''} ${v.phone || ''} ${v.customerName || ''}`.toUpperCase();
    return hay.includes(search);
  });
  list = list.slice(0, limit);
  res.json({ vehicles: list });
});

app.get('/api/delivery-coordinator/queue', (req, res) => {
  const admin = String(req.query.admin || '') === '1';
  const username = String(req.query.username || '').trim();

  // Always serve a unique VIN list enriched from the latest raw inventory
  const deduped = dedupeQueue(store.queue);
  if (deduped.length !== store.queue.length) {
    store.queue = deduped;
    saveStore();
  }

  // Backfill warehouse delivery label from warehouse drafts
  const warehouseVins = new Set();
  for (const d of store.drafts || []) {
    if (!isWarehouseDraftPayload(d.payload || {})) continue;
    const list = [
      ...(Array.isArray(d.vins) ? d.vins : []),
      d.vin,
      ...((d.payload && d.payload.vins) || [])
    ];
    list.forEach((v) => {
      const n = normVin(v);
      if (n) warehouseVins.add(n);
    });
  }
  for (const item of store.queue) {
    if (item.agentStatus === 'delivered' && !item.deliveryMode && warehouseVins.has(normVin(item.vin))) {
      item.deliveryMode = 'warehouse';
    }
  }

  // Heal بدون شركة from Print Drafts already in store (archive restore / prior import)
  const forCoordinator = String(req.query.coordinator || '') === '1';
  if ((admin || forCoordinator) && Array.isArray(store.drafts) && store.drafts.length) {
    const heal = applyCompaniesFromPrintDrafts(store.drafts, { onlyUnassigned: true });
    const teamDraftCarriers = syncPrintDraftCompaniesToDeliveryTeam(store.drafts);
    if (heal.assigned || (teamDraftCarriers && (teamDraftCarriers.updated || teamDraftCarriers.cleared))) {
      persistAndBroadcast();
    }
  }

  let queue = store.queue.map(enrichQueueItem);

  // Agents also see display-status cars (from ياسين) to convert into a delivery note
  if (!admin && username) {
    queue = queue.filter(
      (q) => q.status === 'available'
        || q.assignedTo === username
        || q.agentStatus === 'display'
        || normalizeVehicleStatus(q.vehicleStatus) === 'display'
    );
  }

  // Coordinator page: hide تم الترحيل from prior months (from the 1st of each new month).
  // Admin dashboard keeps full history (do not pass coordinator=1).
  if (forCoordinator) {
    queue = queue.filter((q) => !isPriorMonthDelivered(q));
  }

  if (admin) {
    ensureWarehouseStock();
    ensureShowroomParking();
    return res.json({
      queue,
      stats: computeStats(),
      draftsByCompany: computeDraftsByCompany(),
      drafts: store.drafts,
      deliveryNoteStats: computeDeliveryNoteStats(store.drafts || []),
      manualVehicles: store.manualVehicles || [],
      warehouseStock: store.warehouseStock.filter((e) => e.status === 'in').map(enrichWarehouseEntry),
      warehouseZones: warehouseOccupancy(),
      showroomParking: store.showroomParking.filter((e) => e.status === 'in').map(enrichShowroomParkingEntry),
      showroomParkingOccupancy: showroomParkingOccupancy(),
      rawUploaded: Boolean(store.vehicles.length || store.meta.uploadedAt),
      rawStatus: getHubRawStatus(),
    });
  }

  if (forCoordinator) {
    ensureWarehouseStock();
    ensureShowroomParking();
    return res.json({
      queue,
      stats: computeStats(),
      draftsByCompany: computeDraftsByCompany(),
      warehouseStock: store.warehouseStock.filter((e) => e.status === 'in').map(enrichWarehouseEntry),
      warehouseZones: warehouseOccupancy(),
      showroomParking: store.showroomParking.filter((e) => e.status === 'in').map(enrichShowroomParkingEntry),
      showroomParkingOccupancy: showroomParkingOccupancy(),
      rawUploaded: Boolean(store.vehicles.length || store.meta.uploadedAt),
      rawStatus: getHubRawStatus(),
    });
  }

  res.json({ queue });
});

function draftBranchTo(draft) {
  return String((draft?.payload || {}).branch_to || draft?.location || '').trim();
}

function queueLooksAutomall(item) {
  if (!item) return false;
  if (isAutomallCity(item.plannedBranch)) return true;
  if (isAutomallCity(item.deliveryCity)) return true;
  if (isAutomallCity(item.location)) return true;
  // Vehicle raw location / GT sometimes holds destination
  const vin = normVin(item.vin);
  const veh = vehicleIndex().get(vin);
  if (veh && (isAutomallCity(veh.location) || isAutomallCity(veh.gt))) return true;
  return false;
}

/** Yassin Automall board: printed memos to اوتومول + pending (unprinted) Automall cars. */
function buildAutomallBoard() {
  const printed = [];
  const printedVinSet = new Set();

  for (const draft of store.drafts || []) {
    if (!isAutomallCity(draftBranchTo(draft))) continue;
    const isDisplay = Boolean(draft.showroomDisplay) || isShowroomDraftPayload(draft.payload)
      || normalizeVehicleStatus(draft.vehicleStatus || draft.payload?.vehicleStatus) === 'display';
    if (isDisplay) continue;
    const vins = collectDraftVins(draft.payload, [draft.vin, ...(Array.isArray(draft.vins) ? draft.vins : [])]);
    vins.forEach((vin) => {
      if (!vin) return;
      printedVinSet.add(vin);
      const q = findQueueItem(vin);
      printed.push({
        vin,
        printed: true,
        status: 'printed',
        product: draft.product || draft.model || q?.product || '',
        company: String(draft.payload?.company_rep || draft.customerName || q?.deliveryCompany || '').trim(),
        city: AUTOMALL_CITY_LABEL,
        assignedTo: draft.assignedTo || draft.entryAgent || '',
        deliveryNoteNumber: draft.deliveryNoteNumber || draft.payload?.deliveryNoteNumber || '',
        draftId: draft.id || '',
        printedAt: draft.printedAt || '',
        agentStatus: q?.agentStatus || 'delivered'
      });
    });
  }

  const pending = [];
  const pendingSeen = new Set();

  for (const raw of store.queue || []) {
    const item = enrichQueueItem(raw);
    const vin = normVin(item.vin);
    if (!vin || pendingSeen.has(vin)) continue;
    if (item.agentStatus === 'delivered') continue;
    if (printedVinSet.has(vin)) continue;
    if (!queueLooksAutomall(item)) continue;
    pendingSeen.add(vin);
    pending.push({
      vin,
      printed: false,
      status: 'pending',
      product: item.product || item.model || '',
      company: String(item.deliveryCompany || item.company || '').trim(),
      city: AUTOMALL_CITY_LABEL,
      assignedTo: item.assignedTo || '',
      agentStatus: item.agentStatus || item.status || '',
      plannedBranch: item.plannedBranch || item.deliveryCity || item.location || AUTOMALL_CITY_LABEL,
      draftId: '',
      deliveryNoteNumber: ''
    });
  }

  // Display Automall drafts still needing a delivery note
  for (const draft of store.drafts || []) {
    if (!isAutomallCity(draftBranchTo(draft))) continue;
    const isDisplay = Boolean(draft.showroomDisplay) || isShowroomDraftPayload(draft.payload)
      || normalizeVehicleStatus(draft.vehicleStatus || draft.payload?.vehicleStatus) === 'display';
    if (!isDisplay) continue;
    const vins = collectDraftVins(draft.payload, [draft.vin, ...(Array.isArray(draft.vins) ? draft.vins : [])]);
    vins.forEach((vin) => {
      if (!vin || pendingSeen.has(vin) || printedVinSet.has(vin)) return;
      const q = findQueueItem(vin);
      if (q && q.agentStatus === 'delivered') return;
      pendingSeen.add(vin);
      pending.push({
        vin,
        printed: false,
        status: 'pending',
        product: draft.product || draft.model || q?.product || '',
        company: String(draft.payload?.company_rep || draft.customerName || q?.deliveryCompany || '').trim(),
        city: AUTOMALL_CITY_LABEL,
        assignedTo: draft.assignedTo || q?.assignedTo || '',
        agentStatus: q?.agentStatus || 'display',
        plannedBranch: AUTOMALL_CITY_LABEL,
        draftId: draft.id || '',
        deliveryNoteNumber: draft.deliveryNoteNumber || ''
      });
    });
  }

  printed.sort((a, b) => String(b.printedAt || '').localeCompare(String(a.printedAt || '')));
  pending.sort((a, b) => String(a.vin).localeCompare(String(b.vin)));
  return {
    city: AUTOMALL_CITY_LABEL,
    printed,
    pending,
    stats: {
      printed: printed.length,
      pending: pending.length,
      total: printed.length + pending.length
    }
  };
}

app.get('/api/delivery-coordinator/automall-board', (req, res) => {
  const username = String(req.query.username || '').trim();
  const password = String(req.query.password || '');
  if (username) {
    const auth = authenticateAgent(username, password);
    if (!auth.ok) return res.status(401).json({ error: auth.error });
  }
  res.json(buildAutomallBoard());
});

app.post('/api/delivery-coordinator/planned-branch', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  const vin = normVin(req.body?.vin);
  const branch = String(req.body?.branch || req.body?.branch_to || req.body?.city || '').trim();
  if (!vin) return res.status(400).json({ error: 'الشاسيه مطلوب' });
  let item = findQueueItem(vin);
  if (!item) {
    const veh = vehicleIndex().get(vin);
    item = enrichFromVehicle({
      vin,
      status: 'available',
      agentStatus: '',
      assignedTo: '',
      addedAt: new Date().toISOString(),
      plannedBranch: branch
    }, veh || {});
    store.queue.push(item);
  } else {
    item.plannedBranch = branch;
  }
  persistAndBroadcast();
  res.json({ ok: true, item: enrichQueueItem(item), automall: isAutomallCity(branch) });
});

app.post('/api/delivery-coordinator/submit-vins', (req, res) => {
  if (!store.vehicles.length) {
    return res.status(400).json({ error: 'ارفع البيانات الخام (Excel) أولاً قبل إضافة الشاسيه' });
  }

  const vins = Array.isArray(req.body?.vins) ? req.body.vins : [];
  const plannedDeliveryMode = normalizePlannedDeliveryMode(
    req.body?.plannedDeliveryMode || req.body?.deliveryMode || req.body?.deliveryType
  );
  if (!plannedDeliveryMode) {
    return res.status(400).json({ error: 'اختر نوع التسليم: ترحيل أو مستودع' });
  }

  ensureOptions();
  let deliveryCompany = String(req.body?.company || req.body?.deliveryCompany || req.body?.company_rep || '').trim();
  if (plannedDeliveryMode === 'warehouse') {
    deliveryCompany = deliveryCompany || 'مستودع الهاتفية';
  } else if (!deliveryCompany) {
    return res.status(400).json({ error: 'اختر شركة التوصيل للشاسيه' });
  }

  // Keep company in options list if new
  if (deliveryCompany && plannedDeliveryMode === 'memo') {
    const exists = (store.options.companies || []).some(
      (x) => String(x).toLowerCase() === deliveryCompany.toLowerCase()
    );
    if (!exists) {
      store.options.companies = uniqueSorted([...(store.options.companies || []), deliveryCompany]);
    }
  }

  store.queue = dedupeQueue(store.queue);
  const byVin = vehicleIndex();
  let added = 0;
  let reassigned = 0;
  let skipped = 0;
  const missingVins = [];
  const alreadyInWarehouse = [];
  const conflicts = [];
  const alreadySameCompany = [];
  const forceReassign = Boolean(req.body?.forceReassign || req.body?.allowReassign);
  const seenBatch = new Set();
  const now = new Date().toISOString();

  for (const raw of vins) {
    const vin = normVin(raw);
    if (!vin) {
      skipped += 1;
      continue;
    }
    if (seenBatch.has(vin)) {
      skipped += 1;
      continue;
    }
    seenBatch.add(vin);

    const existingItem = findQueueItem(vin);
    if (existingItem) {
      const prevCompany = String(existingItem.deliveryCompany || existingItem.company || '').trim();
      const sameCompany = prevCompany
        && deliveryCompany
        && prevCompany.toLowerCase() === deliveryCompany.toLowerCase();

      // No company yet → always open for assign
      if (isUnassignedDeliveryCompany(existingItem) && deliveryCompany) {
        existingItem.deliveryCompany = deliveryCompany;
        existingItem.company = deliveryCompany;
        existingItem.plannedDeliveryMode = plannedDeliveryMode;
        reassigned += 1;
        const wh = findWarehouseInStock(vin);
        if (wh) {
          alreadyInWarehouse.push({ vin, slot: wh.slot, zone: wh.zone });
        }
        continue;
      }

      // Already on this company
      if (sameCompany) {
        alreadySameCompany.push({ vin, company: prevCompany });
        skipped += 1;
        continue;
      }

      // Duplicate in another company — reassign only if coordinator confirmed
      if (forceReassign && deliveryCompany) {
        existingItem.deliveryCompany = deliveryCompany;
        existingItem.company = deliveryCompany;
        existingItem.plannedDeliveryMode = plannedDeliveryMode;
        reassigned += 1;
        const wh = findWarehouseInStock(vin);
        if (wh) {
          alreadyInWarehouse.push({ vin, slot: wh.slot, zone: wh.zone });
        }
        continue;
      }

      conflicts.push({
        vin,
        company: prevCompany || 'بدون شركة',
        status: existingItem.status || '',
        assignedTo: existingItem.assignedTo || ''
      });
      skipped += 1;
      continue;
    }

    const veh = byVin.get(vin);
    if (!veh) {
      missingVins.push(vin);
      skipped += 1;
      continue;
    }

    const wh = findWarehouseInStock(vin);
    if (wh) {
      alreadyInWarehouse.push({ vin, slot: wh.slot, zone: wh.zone });
    }

    const base = {
      vin,
      status: 'available',
      agentStatus: '',
      assignedTo: '',
      addedAt: now,
      assignedAt: '',
      deliveryCompany,
      plannedDeliveryMode,
      company: deliveryCompany
    };
    store.queue.push(enrichFromVehicle(base, veh));
    added += 1;
  }

  persistAndBroadcast();
  res.json({
    added,
    reassigned,
    skipped,
    notInInventory: missingVins.length,
    missingVins,
    alreadyInWarehouse,
    conflicts,
    alreadySameCompany,
    forceReassign,
    deliveryCompany,
    plannedDeliveryMode
  });
});

/** Update company / planned delivery mode for available (or any) queue VINs. */
app.post('/api/delivery-coordinator/assign-meta', (req, res) => {
  const vins = Array.isArray(req.body?.vins) ? req.body.vins : [req.body?.vin];
  const plannedDeliveryMode = normalizePlannedDeliveryMode(
    req.body?.plannedDeliveryMode || req.body?.deliveryMode || req.body?.deliveryType
  );
  if (!plannedDeliveryMode) {
    return res.status(400).json({ error: 'اختر نوع التسليم: ترحيل أو مستودع' });
  }

  ensureOptions();
  let deliveryCompany = String(req.body?.company || req.body?.deliveryCompany || req.body?.company_rep || '').trim();
  if (plannedDeliveryMode === 'warehouse') {
    deliveryCompany = deliveryCompany || 'مستودع الهاتفية';
  } else if (!deliveryCompany) {
    return res.status(400).json({ error: 'اختر شركة التوصيل' });
  }

  if (deliveryCompany && plannedDeliveryMode === 'memo') {
    const exists = (store.options.companies || []).some(
      (x) => String(x).toLowerCase() === deliveryCompany.toLowerCase()
    );
    if (!exists) {
      store.options.companies = uniqueSorted([...(store.options.companies || []), deliveryCompany]);
    }
  }

  const updated = [];
  const missing = [];
  for (const raw of vins) {
    const vin = normVin(raw);
    if (!vin) continue;
    const item = findQueueItem(vin);
    if (!item) {
      missing.push(vin);
      continue;
    }
    item.plannedDeliveryMode = plannedDeliveryMode;
    item.deliveryCompany = deliveryCompany;
    item.company = deliveryCompany;
    updated.push(enrichQueueItem(item));
  }
  if (!updated.length) return res.status(404).json({ error: 'لم يتم تحديث أي شاسيه', missing });
  persistAndBroadcast();
  res.json({ ok: true, updated, missing, deliveryCompany, plannedDeliveryMode });
});

app.post('/api/delivery-coordinator/claim', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const vin = normVin(req.body?.vin);
  const agentStatus = String(req.body?.agentStatus || 'in_stock').trim() || 'in_stock';
  const item = findQueueItem(vin);
  if (!item) return res.status(404).json({ error: 'الشاسيه غير موجود في القائمة' });
  if (item.status !== 'available' && item.assignedTo && item.assignedTo !== auth.username) {
    return res.status(409).json({ error: 'الشاسيه محجوز لموظف آخر' });
  }

  item.status = 'claimed';
  item.agentStatus = agentStatus;
  item.assignedTo = auth.username;
  item.assignedAt = new Date().toISOString();
  persistAndBroadcast();
  res.json({ item: enrichQueueItem(item) });
});

app.post('/api/delivery-coordinator/set-status', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const vin = normVin(req.body?.vin);
  const agentStatus = String(req.body?.agentStatus || '').trim();
  if (!agentStatus) return res.status(400).json({ error: 'الحالة مطلوبة' });

  const item = findQueueItem(vin);
  if (!item) return res.status(404).json({ error: 'الشاسيه غير موجود' });
  if (item.assignedTo && item.assignedTo !== auth.username) {
    return res.status(403).json({ error: 'غير مسموح — الشاسيه مع موظف آخر' });
  }

  item.status = 'claimed';
  item.agentStatus = agentStatus;
  item.assignedTo = auth.username;
  persistAndBroadcast();
  res.json({ item: enrichQueueItem(item) });
});

app.post('/api/delivery-coordinator/release', (req, res) => {
  const vin = normVin(req.body?.vin);
  const item = findQueueItem(vin);
  if (!item) return res.status(404).json({ error: 'الشاسيه غير موجود' });

  item.status = 'available';
  item.agentStatus = '';
  item.assignedTo = '';
  item.assignedAt = '';
  persistAndBroadcast();
  res.json({ ok: true, item: enrichQueueItem(item) });
});

app.post('/api/delivery-coordinator/complete-print', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const draftPayload = req.body?.draft || {};
  const primaryVin = normVin(req.body?.vin);
  const fromBody = Array.isArray(req.body?.vins) ? req.body.vins : [];
  const vins = collectDraftVins(draftPayload, [primaryVin, ...fromBody]);
  if (!vins.length) return res.status(400).json({ error: 'الشاسيه مطلوب' });

  let showroomDisplay = Boolean(
    req.body?.showroomDisplay
    || isShowroomDraftPayload(draftPayload)
  );
  // ياسين default remains showroom unless payload sets delivery status
  if (auth.username === SHOWROOM_AGENT) {
    const vs = normalizeVehicleStatus(draftPayload.vehicleStatus || req.body?.vehicleStatus);
    if (vs === 'delivery') showroomDisplay = false;
    else if (vs === 'display' || !vs) showroomDisplay = true;
  }
  const warehouseDelivery = !showroomDisplay && isWarehouseDraftPayload(draftPayload);
  const vehicleStatus = normalizeVehicleStatus(draftPayload.vehicleStatus || req.body?.vehicleStatus)
    || (showroomDisplay ? 'display' : 'delivery');

  const statusPaper = vehicleStatusPaperLabel(vehicleStatus);
  if (statusPaper) {
    const tag = `الحالة / Status: ${statusPaper}`;
    const prev = String(draftPayload.attachments || '').trim();
    if (!prev.includes(tag)) {
      draftPayload.attachments = [prev, tag].filter(Boolean).join('\n');
    }
    draftPayload.vehicleStatus = vehicleStatus;
    draftPayload.vehicle_status_label = statusPaper;
  }

  const carMetaByVin = new Map();
  (Array.isArray(draftPayload.cars) ? draftPayload.cars : []).forEach((c) => {
    const vin = normVin(c?.chassis || c?.vin);
    if (!vin) return;
    carMetaByVin.set(vin, {
      product: String(c.model || '').trim(),
      model: String(c.model || '').trim(),
      plate: String(c.plate || '').trim()
    });
  });

  const convertingDisplay = vins.some((vin) => {
    const item = findQueueItem(vin);
    return item && (item.agentStatus === 'display' || normalizeVehicleStatus(item.vehicleStatus) === 'display');
  });

  const { deliveredItems, blocked } = markVinsDelivered(vins, {
    assignedTo: auth.username,
    warehouseDelivery,
    showroomDisplay,
    vehicleStatus,
    // Allow agents to convert display cars into a new delivery note
    forceAssign: showroomDisplay || convertingDisplay || auth.username === SHOWROOM_AGENT,
    carMetaByVin
  });
  if (blocked.length) {
    const b = blocked[0];
    return res.status(403).json({
      error: `غير مسموح — الشاسيه ${b.vin} مع موظف آخر (${b.assignedTo})`
    });
  }
  if (!deliveredItems.length) {
    return res.status(400).json({ error: 'لم يتم ترحيل أي شاسيه' });
  }

  const primary = deliveredItems[0];
  const typedCompany = String(draftPayload.company_rep || '').trim();
  const assignedCompanyHint = String(draftPayload.assigned_company || '').trim();
  const companyChanges = applyAgentCompanyChange(vins, typedCompany, {
    warehouseDelivery,
    showroomDisplay
  });
  // Prefer queue-recorded change; fall back to form hint if queue had no prior company
  let changeFrom = companyChanges[0]?.from || '';
  let changeTo = companyChanges[0]?.to || '';
  if (!changeFrom && assignedCompanyHint && typedCompany && !sameCompanyName(assignedCompanyHint, typedCompany)
      && !warehouseDelivery && !showroomDisplay) {
    changeFrom = assignedCompanyHint;
    changeTo = typedCompany;
  }
  if (changeFrom && changeTo) {
    draftPayload.company_changed = true;
    draftPayload.company_changed_from = changeFrom;
    draftPayload.company_changed_to = changeTo;
    draftPayload.company_changes = companyChanges.length
      ? companyChanges
      : vins.map((vin) => ({ vin, from: changeFrom, to: changeTo }));
  }
  const printedBranch = warehouseDelivery
    ? (String(draftPayload.branch_to || '').trim() || 'المستودع')
    : String(draftPayload.branch_to || '').trim();
  // Stamp destination city on queue rows (Automall board + tracking)
  for (const vin of vins) {
    const item = findQueueItem(vin);
    if (!item) continue;
    if (printedBranch) {
      item.deliveryCity = printedBranch;
      item.plannedBranch = printedBranch;
    }
  }
  // Do not force auto city — agent must choose branch_to on the form
  const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    printedAt: new Date().toISOString(),
    vin: primary.vin,
    vins,
    product: primary.product || carMetaByVin.get(primary.vin)?.product || '',
    model: primary.model || primary.product || '',
    assignedTo: auth.username,
    customerName: showroomDisplay
      ? (typedCompany || SHOWROOM_SPECIAL_NAME)
      : (typedCompany || draftPayload?.warehouse?.owner_name || primary.customerName || ''),
    plate: primary.plate || '',
    gt: primary.gt || '',
    location: primary.location || '',
    showroomDisplay: Boolean(showroomDisplay),
    vehicleStatus,
    companyChangedFrom: changeFrom || '',
    companyChangedTo: changeTo || '',
    payload: {
      ...draftPayload,
      branch_to: warehouseDelivery
        ? (draftPayload.branch_to || 'المستودع')
        : (draftPayload.branch_to || ''),
      warehouse_group: warehouseDelivery,
      deliveryMode: showroomDisplay ? 'showroom' : (warehouseDelivery ? 'warehouse' : ''),
      showroom_display: Boolean(showroomDisplay),
      showroom_group: Boolean(showroomDisplay),
      showroom_label: showroomDisplay ? SHOWROOM_SPECIAL_NAME : undefined,
      typed_company: showroomDisplay ? typedCompany : undefined,
      vehicleStatus,
      vins
    }
  };
  attachDeliveryNoteMeta(draft, {
    entryAgent: auth.username,
    vehicleStatus,
    branchEntryDate: draftPayload.branchEntryDate || '',
    manualEntry: Boolean(draftPayload.manualEntry)
  });
  archiveDeliveryNoteFile(draft);
  store.drafts.unshift(draft);
  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;

  persistAndBroadcast();
  res.json({
    ok: true,
    draftId: id,
    deliveryNoteNumber: draft.deliveryNoteNumber,
    deliveryNoteDate: draft.deliveryNoteDate,
    archivePath: draft.archivePath || null,
    pdfSaved: Boolean(draft.pdfSaved),
    vins,
    deliveredCount: deliveredItems.length,
    showroomDisplay: Boolean(showroomDisplay),
    vehicleStatus,
    statusLabel: showroomDisplay
      ? 'عرض'
      : (warehouseDelivery ? 'تم التسليم في المستودع' : 'تم الترحيل'),
    item: primary,
    items: deliveredItems
  });
});

app.get('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const draft = store.drafts.find((d) => d.id === id);
  if (!draft) return res.status(404).json({ error: 'المسودة غير موجودة' });
  res.json({ draft });
});

/** Admin edit: update delivery-note draft payload / meta; sync all cars as delivered. */
app.patch('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const idx = store.drafts.findIndex((d) => d.id === id);
  if (idx < 0) return res.status(404).json({ error: 'المسودة غير موجودة' });

  const body = req.body || {};
  const draft = { ...store.drafts[idx] };
  const markDelivered = body.markDelivered !== false;

  if (body.payload && typeof body.payload === 'object') {
    draft.payload = { ...(draft.payload || {}), ...body.payload };
    if (Array.isArray(body.payload.cars)) {
      draft.payload.cars = body.payload.cars;
    }
  }

  const vins = collectDraftVins(draft.payload, [draft.vin, ...(Array.isArray(draft.vins) ? draft.vins : [])]);
  draft.vins = vins;
  if (!draft.payload || typeof draft.payload !== 'object') draft.payload = {};
  draft.payload.vins = vins;

  const firstCar = (draft.payload.cars || []).find((c) => c && (c.chassis || c.vin));
  if (firstCar?.chassis || firstCar?.vin) {
    draft.vin = normVin(firstCar.chassis || firstCar.vin) || draft.vin;
  }
  if (firstCar?.model) {
    draft.product = firstCar.model;
    draft.model = firstCar.model;
  }
  if (firstCar?.plate != null) draft.plate = firstCar.plate;
  if (draft.payload.company_rep) draft.customerName = draft.payload.company_rep;

  if (body.assignedTo != null) draft.assignedTo = String(body.assignedTo);
  if (body.customerName != null) draft.customerName = String(body.customerName);
  if (body.product != null) {
    draft.product = String(body.product);
    draft.model = String(body.product);
  }
  draft.updatedAt = new Date().toISOString();

  // Prefer explicit mode from admin editor (memo vs warehouse UI).
  let warehouseDelivery = false;
  if (body.deliveryMode === 'warehouse' || body.warehouseDelivery === true) {
    warehouseDelivery = true;
  } else if (body.deliveryMode === 'memo' || body.deliveryMode === '' || body.warehouseDelivery === false) {
    warehouseDelivery = false;
  } else {
    warehouseDelivery = isWarehouseDraftPayload(draft.payload);
  }

  if (!draft.payload || typeof draft.payload !== 'object') draft.payload = {};
  if (warehouseDelivery) {
    draft.payload.warehouse_group = true;
    draft.payload.deliveryMode = 'warehouse';
  } else {
    draft.payload.warehouse_group = false;
    draft.payload.deliveryMode = '';
  }

  let deliveredCount = 0;
  let deliveredItems = [];
  if (markDelivered && vins.length) {
    const result = markVinsDelivered(vins, {
      assignedTo: draft.assignedTo || 'admin',
      warehouseDelivery,
      forceAssign: true
    });
    deliveredItems = result.deliveredItems;
    deliveredCount = deliveredItems.length;
  }

  store.drafts[idx] = draft;
  persistAndBroadcast();
  res.json({
    ok: true,
    draft,
    vins,
    deliveredCount,
    deliveryMode: warehouseDelivery ? 'warehouse' : 'memo',
    statusLabel: warehouseDelivery ? 'تم التسليم في المستودع' : 'تم الترحيل',
    items: deliveredItems
  });
});

app.delete('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const before = store.drafts.length;
  store.drafts = store.drafts.filter((d) => d.id !== id);
  if (store.drafts.length === before) {
    return res.status(404).json({ error: 'المسودة غير موجودة' });
  }
  persistAndBroadcast();
  res.json({ ok: true, draftsTotal: store.drafts.length });
});

/** Manual vehicle entry (ياسين / showroom admin) — creates a new delivery note. */
app.post('/api/delivery-manual/vehicles', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const isYassin = auth.username === SHOWROOM_AGENT;
  const isShowroomAdmin = auth.role === 'showroom_admin' || auth.username === SHOWROOM_ADMIN_AGENT;
  if (!isYassin && !isShowroomAdmin) {
    return res.status(403).json({ error: 'الإدخال اليدوي متاح لياسين أو Showroom Admin فقط' });
  }

  const vehicle = String(req.body?.vehicle || req.body?.product || '').trim();
  const vin = normVin(req.body?.vin);
  const model = String(req.body?.model || vehicle || '').trim();
  const plate = String(req.body?.plate || '').trim();
  const branch = String(req.body?.branch || req.body?.branch_to || '').trim();
  const branchEntryDate = normalizeIsoDateOnly(req.body?.branchEntryDate, todayIsoRiyadh());
  const vehicleStatus = normalizeVehicleStatus(req.body?.vehicleStatus);

  if (!vehicle) return res.status(400).json({ error: 'Vehicle / Product مطلوب' });
  if (!vin) return res.status(400).json({ error: 'VIN / Chassis مطلوب' });
  if (!branch) return res.status(400).json({ error: 'Branch مطلوب' });
  if (!branchEntryDate) return res.status(400).json({ error: 'Entry Date مطلوب' });
  if (!vehicleStatus) {
    return res.status(400).json({ error: 'Status مطلوب (display|delivery)' });
  }

  // Showroom admin: only cars currently in the 7 parking places
  let parkingEntry = null;
  if (isShowroomAdmin) {
    parkingEntry = findShowroomParkingInStock(vin);
    if (!parkingEntry) {
      return res.status(403).json({
        error: 'يمكن إصدار مذكرة فقط لسيارات موقف العرض (7 أماكن) الخاصة بهذا الحساب'
      });
    }
  }

  // Ensure branch is available in city options (do not block on list mismatch)
  ensureOptions();
  if (!store.options.cities.some((c) => normalizeOptionName(c) === branch)) {
    store.options.cities = uniqueSorted([...store.options.cities, branch]);
  }

  const isDisplay = vehicleStatus === 'display';
  const today = todayIsoRiyadh();
  const dayName = arabicWeekdayName(today);
  const statusPaper = vehicleStatusPaperLabel(vehicleStatus);
  const carRows = [{ model: model || vehicle, chassis: vin, plate, remarks: statusPaper ? `الحالة: ${statusPaper}` : '' }];
  while (carRows.length < 10) carRows.push(emptyCarSlot());

  const companyLabel = isDisplay
    ? (isShowroomAdmin ? SHOWROOM_PARKING_LABEL : SHOWROOM_SPECIAL_NAME)
    : (String(req.body?.company || '').trim() || '');

  const draftPayload = {
    doc_date: today,
    deliveryNoteDate: today,
    branchEntryDate,
    vehicleStatus,
    vehicle_status_label: statusPaper,
    manualEntry: true,
    entryAgent: auth.username,
    invoice_number: '',
    dep_hour: '',
    dep_minute: '',
    customer_name: auth.username,
    company_rep: companyLabel,
    transfer_date: today,
    corresponding_date: today,
    day_name: dayName,
    trailer_number: '',
    car_count: '1',
    branch_to: branch,
    attachments: statusPaper ? `الحالة / Status: ${statusPaper}` : '',
    cars: carRows,
    vins: [vin],
    showroom_display: isDisplay,
    showroom_group: isDisplay || isShowroomAdmin,
    deliveryMode: isDisplay || isShowroomAdmin ? 'showroom' : 'memo',
    showroom_label: isDisplay || isShowroomAdmin ? (isShowroomAdmin ? SHOWROOM_PARKING_LABEL : SHOWROOM_SPECIAL_NAME) : undefined,
    showroom_parking: Boolean(isShowroomAdmin),
    showroom_parking_slot: parkingEntry?.slot || ''
  };

  const carMetaByVin = new Map([[vin, {
    product: vehicle || parkingEntry?.product,
    model: model || vehicle || parkingEntry?.model,
    plate: plate || parkingEntry?.plate || ''
  }]]);
  const { deliveredItems, blocked } = markVinsDelivered([vin], {
    assignedTo: auth.username,
    warehouseDelivery: false,
    showroomDisplay: isDisplay || isShowroomAdmin,
    vehicleStatus,
    forceAssign: true,
    carMetaByVin
  });
  if (blocked.length) {
    return res.status(403).json({
      error: `غير مسموح — الشاسيه مع موظف آخر (${blocked[0].assignedTo})`
    });
  }

  // Historical vehicle entry (append — never overwrite prior VIN records)
  if (!Array.isArray(store.manualVehicles)) store.manualVehicles = [];
  const vehicleRecord = {
    id: `man_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vin,
    product: vehicle,
    model: model || vehicle,
    plate,
    branch,
    branchEntryDate,
    vehicleStatus,
    manualEntry: true,
    entryAgent: auth.username,
    showroomParking: Boolean(isShowroomAdmin),
    showroomParkingSlot: parkingEntry?.slot || '',
    createdAt: new Date().toISOString()
  };
  store.manualVehicles.unshift(vehicleRecord);

  const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    printedAt: new Date().toISOString(),
    vin,
    vins: [vin],
    product: vehicle,
    model: model || vehicle,
    plate,
    assignedTo: auth.username,
    customerName: companyLabel || (isDisplay ? SHOWROOM_SPECIAL_NAME : ''),
    showroomDisplay: isDisplay || isShowroomAdmin,
    manualEntry: true,
    branchEntryDate,
    vehicleStatus,
    entryAgent: auth.username,
    showroomParking: Boolean(isShowroomAdmin),
    showroomParkingSlot: parkingEntry?.slot || '',
    payload: draftPayload
  };
  attachDeliveryNoteMeta(draft, {
    entryAgent: auth.username,
    vehicleStatus,
    branchEntryDate,
    manualEntry: true,
    deliveryNoteDate: today
  });
  archiveDeliveryNoteFile(draft);
  vehicleRecord.deliveryNoteNumber = draft.deliveryNoteNumber;
  vehicleRecord.draftId = draft.id;
  vehicleRecord.archivePath = draft.archivePath || '';

  store.drafts.unshift(draft);
  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;

  // Showroom admin delivery: free the parking slot when status is delivery
  if (isShowroomAdmin && parkingEntry && vehicleStatus === 'delivery') {
    parkingEntry.status = 'out';
    parkingEntry.stockedOutAt = new Date().toISOString();
    parkingEntry.stockedOutBy = auth.username;
  }

  persistAndBroadcast();
  res.json({
    ok: true,
    vehicle: vehicleRecord,
    draftId: draft.id,
    deliveryNoteNumber: draft.deliveryNoteNumber,
    deliveryNoteDate: draft.deliveryNoteDate,
    archivePath: draft.archivePath || null,
    pdfSaved: Boolean(draft.pdfSaved),
    vehicleStatus,
    statusLabel: isDisplay ? 'عرض' : 'تم الترحيل',
    branch,
    branchEntryDate,
    parkingSlot: parkingEntry?.slot || '',
    occupancy: isShowroomAdmin ? showroomParkingOccupancy() : undefined,
    item: deliveredItems[0] || null,
    draft
  });
});

app.get('/api/delivery-manual/vehicles', (req, res) => {
  const list = Array.isArray(store.manualVehicles) ? store.manualVehicles : [];
  const vin = normVin(req.query.vin);
  const filtered = vin ? list.filter((v) => normVin(v.vin) === vin) : list;
  res.json({ vehicles: filtered, total: filtered.length });
});

app.get('/api/delivery-notes', (req, res) => {
  const month = String(req.query.month || '').trim(); // YYYY-MM or "all"
  const vin = normVin(req.query.vin);
  let drafts = (store.drafts || []).slice();
  if (vin) {
    drafts = drafts.filter((d) => collectDraftVins(d.payload, [d.vin, ...(d.vins || [])]).includes(vin));
  }
  if (month && month !== 'all') {
    drafts = drafts.filter((d) => draftMonthKey(d) === month);
  }
  const stats = computeDeliveryNoteStats(drafts);
  const allStats = computeDeliveryNoteStats(store.drafts || []);
  res.json({
    drafts,
    stats,
    allStats,
    months: Object.keys(allStats.byMonth || {}).sort().reverse()
  });
});

/** Ensure all drafts have archived files (admin backfill). */
app.post('/api/delivery-notes/archive-missing', (_req, res) => {
  let saved = 0;
  let failed = 0;
  for (const d of store.drafts || []) {
    const hasFile = d.archiveFile
      && fs.existsSync(path.join(NOTES_ARCHIVE_DIR, path.basename(d.archiveFile)));
    if (hasFile) continue;
    if (archiveDeliveryNoteFile(d)) saved += 1;
    else failed += 1;
  }
  persistAndBroadcast();
  res.json({ ok: true, saved, failed, total: (store.drafts || []).length });
});

app.get('/api/delivery-notes/vin/:vin', (req, res) => {
  const vin = normVin(req.params.vin);
  if (!vin) return res.status(400).json({ error: 'VIN مطلوب' });
  const drafts = (store.drafts || []).filter((d) =>
    collectDraftVins(d.payload, [d.vin, ...(d.vins || [])]).includes(vin)
  );
  drafts.sort((a, b) => {
    const ta = a.printedAt ? new Date(a.printedAt).getTime() : 0;
    const tb = b.printedAt ? new Date(b.printedAt).getTime() : 0;
    return ta - tb;
  });
  res.json({
    vin,
    count: drafts.length,
    drafts,
    product: drafts[0]?.product || drafts[0]?.model || ''
  });
});

app.get('/api/delivery-notes/:deliveryNoteNumber', (req, res) => {
  const num = String(req.params.deliveryNoteNumber || '').trim();
  if (!num) return res.status(400).json({ error: 'deliveryNoteNumber مطلوب' });
  const draft = (store.drafts || []).find((d) =>
    String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '') === num
    || String(d.id || '') === num
  );
  if (!draft) return res.status(404).json({ error: 'مذكرة التسليم غير موجودة' });
  res.json({ draft });
});

/** Download archived delivery-note document (DOCX printable archive). */
app.get('/api/delivery-notes/:deliveryNoteNumber/file', (req, res) => {
  const num = String(req.params.deliveryNoteNumber || '').trim();
  const draft = (store.drafts || []).find((d) =>
    String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '') === num
    || String(d.id || '') === num
  );
  if (!draft) return res.status(404).json({ error: 'مذكرة التسليم غير موجودة' });

  let abs = '';
  if (draft.archiveFile) {
    abs = path.join(NOTES_ARCHIVE_DIR, path.basename(draft.archiveFile));
  }
  if (!abs || !fs.existsSync(abs)) {
    archiveDeliveryNoteFile(draft);
    saveStore();
    abs = draft.archiveFile
      ? path.join(NOTES_ARCHIVE_DIR, path.basename(draft.archiveFile))
      : '';
  }
  if (!abs || !fs.existsSync(abs)) {
    return res.status(404).json({ error: 'ملف المذكرة غير محفوظ بعد' });
  }
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${path.basename(abs)}"`
  );
  res.sendFile(abs);
});

app.post('/api/delivery-note/generate', (req, res) => {
  try {
    const buf = generateDocx(req.body || {});
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="muthakara_tarhil_${Date.now()}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error('[generate]', err);
    res.status(500).json({ error: err.message || 'فشل إنشاء الملف' });
  }
});

app.post('/api/delivery-note/generate-check-note', (req, res) => {
  try {
    // Prefer the PDF form (اسامة12) when available; fall back to Word template.
    if (fs.existsSync(DELIVERY_CHECK_PDF_FILE)) {
      const buf = getDeliveryCheckPdfBuffer();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="delivery_check_note_${Date.now()}.pdf"`);
      return res.send(buf);
    }
    const buf = generateDeliveryCheckDocx(req.body || {});
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="delivery_check_note_${Date.now()}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error('[generate-check-note]', err);
    res.status(500).json({ error: err.message || 'فشل إنشاء ملف delivery_check_note' });
  }
});

app.get('/api/delivery-note/check-note-preview', (_req, res) => {
  if (!fs.existsSync(DELIVERY_CHECK_PREVIEW_IMAGE)) {
    return res.status(404).json({ error: 'Warehouse preview image not found' });
  }
  res.sendFile(DELIVERY_CHECK_PREVIEW_IMAGE);
});

// Serve React admin dashboard (built assets)
const adminDist = path.join(ROOT, 'admin-app', 'dist');
if (fs.existsSync(adminDist)) {
  app.use('/admin-app', express.static(adminDist, {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
  app.get('/admin-app/*', (_req, res) => {
    res.sendFile(path.join(adminDist, 'index.html'));
  });
}

// Static files (hub UI + assets)
app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    // HTML must never stick in the browser — admin filter UI changes were invisible under cache.
    if (/\.html?$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    if (/\.(js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

loadStore();

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  wsClients.add(socket);
  socket.send(JSON.stringify({ type: 'delivery_hub_updated', at: Date.now() }));
  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
});

server.listen(PORT, () => {
  migrateLegacyRtlDailyDir();
  try {
    loadRtlDailyIndex();
    const hydrated = rehydrateRtlFromByDayMirrors();
    if (hydrated && hydrated.restored) {
      console.log(`[rtl-daily] rehydrated ${hydrated.restored} day(s) from by-day Excel mirrors`);
    }
  } catch (err) {
    console.error('[rtl-daily] index rebuild failed', err);
  }
  console.log(`[delivery] listening on http://localhost:${PORT}`);
  console.log(`[delivery] agents password: ${AGENT_PASSWORD}`);
  console.log(`[delivery-team] password: ${DELIVERY_TEAM_PASSWORD}`);
  console.log(`[delivery-team] data: ${DELIVERY_TEAM_DATA}`);
  console.log(`[delivery-team] UI: http://localhost:${PORT}/deliveryteam/`);
  console.log(`[delivery] persistent root: ${PERSISTENT_ROOT}`);
  console.log(`[delivery] data file: ${DATA_FILE}`);
  console.log(`[delivery] RTL archive (append-only): ${RTL_DAILY_DIR}`);
  console.log(`[delivery] RTL by-day mirrors: ${path.join(RTL_DAILY_DIR, 'by-day')}`);
});
