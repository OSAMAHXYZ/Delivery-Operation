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
const DATA_FILE = path.join(ROOT, 'delivery-inventory-data.json');
const TEMPLATE_FILE = path.join(ROOT, 'templates', 'delivery_note_template.docx');
const DELIVERY_CHECK_TEMPLATE_FILE = path.join(ROOT, 'delivery_check_note.docx');
const DELIVERY_CHECK_PDF_FILE = path.join(ROOT, 'delivery_check_note.pdf');
const DELIVERY_CHECK_PREVIEW_IMAGE = path.join(ROOT, 'images', 'delivery-check-note-form.png');
const PORT = Number(process.env.PORT) || 3000;

const AGENTS = new Set(['ياسين', 'الفاضل', 'البراء']);
const AGENT_PASSWORD = process.env.DELIVERY_AGENT_PASSWORD || '1234';
const MAX_DRAFTS = 500;

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
    cities: uniqueSorted(DEFAULT_CITIES)
  };
}

const emptyStore = () => ({
  raw: null,
  vehicles: [],
  queue: [],
  drafts: [],
  options: defaultOptions(),
  meta: {
    filename: '',
    sheetName: '',
    uploadedAt: null
  }
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
      options: parsed.options && typeof parsed.options === 'object'
        ? {
            companies: Array.isArray(parsed.options.companies) ? parsed.options.companies : [],
            cities: Array.isArray(parsed.options.cities) ? parsed.options.cities : []
          }
        : defaultOptions(),
      meta: {
        filename: parsed.meta?.filename || parsed.filename || '',
        sheetName: parsed.meta?.sheetName || parsed.sheetName || '',
        uploadedAt: parsed.meta?.uploadedAt || parsed.uploadedAt || null
      }
    };
    ensureOptions();
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

function persistAndBroadcast() {
  saveStore();
  broadcastHubUpdate();
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
  if (item.status === 'available') return 'متاح';
  if (item.agentStatus === 'delivered') {
    return item.deliveryMode === 'warehouse'
      ? 'تم التسليم في المستودع'
      : 'تم الترحيل';
  }
  if (item.agentStatus === 'out_of_delivery') return 'Out for delivery';
  if (item.agentStatus === 'ready_for_delivery') return 'Ready';
  if (item.agentStatus === 'in_stock') return item.assignedTo ? `مع ${item.assignedTo}` : 'In Stock';
  return 'محجوز';
}

function isWarehouseDraftPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.warehouse_group) return true;
  if (String(payload.branch_to || '').trim() === 'المستودع') return true;
  if (String(payload.company_rep || '').includes('مستودع')) return true;
  const wh = payload.warehouse || {};
  return Boolean(
    wh.owner_name || wh.user_name || wh.user_id || wh.user_phone
    || wh.print_date || wh.print_time
  );
}

function enrichQueueItem(item) {
  const vin = normVin(item.vin);
  const veh = vehicleIndex().get(vin);
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
    filename: store.meta.filename,
    sheetName: store.meta.sheetName,
    topProducts
  };
}

function authenticateAgent(username, password) {
  const user = String(username || '').trim();
  if (!AGENTS.has(user)) return { ok: false, error: 'اسم المستخدم غير معروف' };
  if (String(password || '') !== AGENT_PASSWORD) return { ok: false, error: 'كلمة المرور غير صحيحة' };
  return { ok: true, username: user };
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
  if (fileHint.includes('delivery export') || fileHint.includes('admin export')) return true;
  return names.some((n) =>
    n.includes('vehicle inventory')
    || n.includes('print draft')
    || n.includes('coordinator queue')
  );
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

function buildDraftPayloadFromExportRow(row, veh) {
  const today = new Date().toISOString().slice(0, 10);
  // Export maps: Company Name ← payload.company_rep, Company Rep ← payload.customer_name
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

  const cars = Array.from({ length: 10 }, () => emptyCarSlot());
  cars[0] = {
    model: product,
    chassis: vin,
    plate: plate === '#' ? '' : plate,
    remarks: pickCol(row, ['remarks', 'notes', 'ملاحظات']) || ''
  };

  return {
    doc_date: docDate,
    invoice_number: '',
    dep_hour: '',
    dep_minute: '',
    customer_name: companyRep,
    company_rep: companyName,
    transfer_date: docDate,
    corresponding_date: docDate,
    day_name: arabicWeekdayName(docDate),
    trailer_number: '',
    car_count: vin ? '1' : '',
    branch_to: branchTo,
    attachments: '',
    cars
  };
}

function parsePrintDraftsFromRows(rows) {
  const drafts = [];
  for (const row of rows || []) {
    const vin = normVin(pickCol(row, VIN_ALIASES));
    if (!vin) continue;
    const product = pickCol(row, ['product', 'model']);
    const assignedTo = pickCol(row, ['assigned to', 'agent', 'المسؤول']) || 'admin';
    const companyName = pickCol(row, ['company name', 'company', 'اسم الشركة']);
    const idRaw = pickCol(row, ['draft id', 'id', 'draft']);
    const id = idRaw || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const printedAt = pickCol(row, ['printed at', 'printed']) || new Date().toISOString();
    const payload = buildDraftPayloadFromExportRow(row, { vin, product, plate: pickCol(row, ['plate']) });
    drafts.push({
      id,
      printedAt,
      vin,
      product,
      model: product,
      assignedTo,
      customerName: companyName || pickCol(row, ['company rep', 'customer']) || '',
      plate: pickCol(row, ['plate']) || '',
      gt: pickCol(row, ['gt']) || '',
      location: pickCol(row, ['location']) || '',
      payload
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
    queue.push({
      vin,
      status: status === 'claimed' || assignedTo ? 'claimed' : 'available',
      agentStatus,
      assignedTo,
      addedAt: pickCol(row, ['added at']) || new Date().toISOString(),
      assignedAt: pickCol(row, ['assigned at']) || '',
      product: pickCol(row, ['product', 'model']) || '',
      model: pickCol(row, ['model', 'product']) || '',
      gt: pickCol(row, ['gt']) || '',
      location: pickCol(row, ['location']) || '',
      plate: pickCol(row, ['plate']) || '',
      customerName: pickCol(row, ['customer', 'customer name']) || '',
      imageUrl: ''
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
      headers = Object.keys(sheetRowsData[0] || {});
      break;
    }
    if (!headers.length && sheetRowsData[0]) headers = Object.keys(sheetRowsData[0]);
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
    const draftsSheet = findSheetName(wb, ['print drafts', 'print draft', 'drafts', 'مسودات الطباعة', 'مسودات']);
    const queueSheet = findSheetName(wb, ['coordinator queue', 'queue', 'قائمة الشاسيه', 'القائمة']);
    if (draftsSheet) result.drafts = parsePrintDraftsFromRows(sheetRows(wb, draftsSheet));
    if (queueSheet) result.queue = parseQueueFromRows(sheetRows(wb, queueSheet));
  } else {
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

function applyParsedInventory(parsed, { replaceDrafts = false, replaceQueue = false } = {}) {
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
    uploadedAt: new Date().toISOString()
  };

  if (replaceDrafts || (Array.isArray(parsed.drafts) && parsed.drafts.length)) {
    store.drafts = Array.isArray(parsed.drafts) ? parsed.drafts.slice(0, MAX_DRAFTS) : [];
  }
  if (replaceQueue || (Array.isArray(parsed.queue) && parsed.queue.length)) {
    store.queue = Array.isArray(parsed.queue) ? dedupeQueue(parsed.queue) : [];
  }

  return refreshQueueFromVehicles();
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
        product: chunk[0].product || '',
        model: chunk[0].model || chunk[0].product || '',
        assignedTo,
        customerName: company,
        plate: chunk[0].plate || '',
        gt: chunk[0].gt || '',
        location: chunk[0].location || '',
        payload
      };
      store.drafts.unshift(draft);
      created.push({
        id: draft.id,
        vin: draft.vin,
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
app.use(express.json({ limit: '80mb' }));

app.post('/api/delivery-coordinator/auth', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  return res.json({ ok: true, username: auth.username });
});

app.get('/api/delivery-options', (_req, res) => {
  ensureOptions();
  res.json({
    companies: store.options.companies,
    cities: store.options.cities
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
    const refresh = applyParsedInventory(parsed);
    persistAndBroadcast();
    res.json({
      imported: parsed.vehicles.length,
      vehicles: parsed.vehicles.slice(0, 200),
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      isExport: Boolean(parsed.isExport),
      sheetName: parsed.sheetName,
      queueRefreshed: refresh.total,
      matchedUpdated: refresh.matched,
      notInNewFile: refresh.missing
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
    const parsed = parseSalesWorkbook(buffer, filename || 'delivery_export.xlsx');
    const fileLooksExport = /delivery[_\s-]?export/i.test(String(filename || ''));
    const fullArchive = Boolean(parsed.isExport || fileLooksExport);

    if (!fullArchive) {
      return res.status(400).json({
        error: 'هذا ليس ملف تصدير اللوحة. استخدم delivery_export_….xlsx (أوراق Vehicle Inventory / Print Drafts / Coordinator Queue). لرفع Sales Raw استخدم صفحة المنسق.'
      });
    }
    if (!parsed.vehicles.length && !(parsed.drafts || []).length) {
      return res.status(400).json({ error: 'الملف لا يحتوي على مركبات أو مسودات' });
    }
    const refresh = applyParsedInventory(parsed, { replaceDrafts: true, replaceQueue: true });
    persistAndBroadcast();
    res.json({
      ok: true,
      imported: parsed.vehicles.length,
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      sheetName: parsed.sheetName,
      filename: parsed.filename,
      queueRefreshed: refresh.total
    });
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

  let queue = store.queue.map(enrichQueueItem);

  if (!admin && username) {
    queue = queue.filter(
      (q) => q.status === 'available' || q.assignedTo === username
    );
  }

  if (admin) {
    return res.json({
      queue,
      stats: computeStats(),
      drafts: store.drafts,
      rawUploaded: Boolean(store.vehicles.length || store.meta.uploadedAt)
    });
  }

  res.json({ queue });
});

app.post('/api/delivery-coordinator/submit-vins', (req, res) => {
  if (!store.vehicles.length) {
    return res.status(400).json({ error: 'ارفع البيانات الخام (Excel) أولاً قبل إضافة الشاسيه' });
  }

  const vins = Array.isArray(req.body?.vins) ? req.body.vins : [];
  store.queue = dedupeQueue(store.queue);
  const existing = new Set(store.queue.map((q) => normVin(q.vin)));
  const byVin = vehicleIndex();
  let added = 0;
  let skipped = 0;
  const missingVins = [];
  const seenBatch = new Set();
  const now = new Date().toISOString();

  for (const raw of vins) {
    const vin = normVin(raw);
    if (!vin) {
      skipped += 1;
      continue;
    }
    if (seenBatch.has(vin) || existing.has(vin)) {
      skipped += 1;
      continue;
    }
    seenBatch.add(vin);

    const veh = byVin.get(vin);
    if (!veh) {
      missingVins.push(vin);
      skipped += 1;
      continue;
    }

    const base = {
      vin,
      status: 'available',
      agentStatus: '',
      assignedTo: '',
      addedAt: now,
      assignedAt: ''
    };
    store.queue.push(enrichFromVehicle(base, veh));
    existing.add(vin);
    added += 1;
  }

  persistAndBroadcast();
  res.json({
    added,
    skipped,
    notInInventory: missingVins.length,
    missingVins
  });
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
  const fromCars = Array.isArray(draftPayload?.cars)
    ? draftPayload.cars.map((c) => c?.chassis || c?.vin || '')
    : [];
  const vins = [...new Set(
    [primaryVin, ...fromBody, ...fromCars]
      .map((v) => normVin(v))
      .filter(Boolean)
  )];
  if (!vins.length) return res.status(400).json({ error: 'الشاسيه مطلوب' });

  const warehouseDelivery = isWarehouseDraftPayload(draftPayload);
  const byVehicle = vehicleIndex();
  const deliveredItems = [];
  for (const vin of vins) {
    let item = findQueueItem(vin);
    if (!item) {
      const veh = byVehicle.get(vin);
      item = enrichFromVehicle({
        vin,
        status: 'claimed',
        agentStatus: 'delivered',
        deliveryMode: warehouseDelivery ? 'warehouse' : '',
        assignedTo: auth.username,
        assignedAt: new Date().toISOString(),
        addedAt: new Date().toISOString()
      }, veh || {});
      store.queue.push(item);
    } else {
      if (item.assignedTo && item.assignedTo !== auth.username && item.agentStatus !== 'delivered') {
        return res.status(403).json({
          error: `غير مسموح — الشاسيه ${vin} مع موظف آخر (${item.assignedTo})`
        });
      }
      item.status = 'claimed';
      item.agentStatus = 'delivered';
      item.deliveryMode = warehouseDelivery ? 'warehouse' : (item.deliveryMode || '');
      item.assignedTo = auth.username;
    }
    deliveredItems.push(enrichQueueItem(item));
  }

  const primary = deliveredItems[0];
  const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    printedAt: new Date().toISOString(),
    vin: primary.vin,
    vins,
    product: primary.product || '',
    model: primary.model || primary.product || '',
    assignedTo: auth.username,
    customerName: draftPayload.company_rep || draftPayload?.warehouse?.owner_name || primary.customerName || '',
    plate: primary.plate || '',
    gt: primary.gt || '',
    location: primary.location || '',
    payload: {
      ...draftPayload,
      warehouse_group: warehouseDelivery,
      deliveryMode: warehouseDelivery ? 'warehouse' : '',
      vins
    }
  };
  store.drafts.unshift(draft);
  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;

  persistAndBroadcast();
  res.json({
    ok: true,
    draftId: id,
    vins,
    deliveredCount: deliveredItems.length,
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

/** Admin edit: update delivery-note draft payload / meta. */
app.patch('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const idx = store.drafts.findIndex((d) => d.id === id);
  if (idx < 0) return res.status(404).json({ error: 'المسودة غير موجودة' });

  const body = req.body || {};
  const draft = { ...store.drafts[idx] };

  if (body.payload && typeof body.payload === 'object') {
    draft.payload = { ...(draft.payload || {}), ...body.payload };
    if (Array.isArray(body.payload.cars)) {
      draft.payload.cars = body.payload.cars;
    }
    const firstCar = (draft.payload.cars || []).find((c) => c && c.chassis);
    if (firstCar?.chassis) draft.vin = normVin(firstCar.chassis) || draft.vin;
    if (firstCar?.model) {
      draft.product = firstCar.model;
      draft.model = firstCar.model;
    }
    if (firstCar?.plate != null) draft.plate = firstCar.plate;
    if (draft.payload.company_rep) draft.customerName = draft.payload.company_rep;
  }

  if (body.assignedTo != null) draft.assignedTo = String(body.assignedTo);
  if (body.customerName != null) draft.customerName = String(body.customerName);
  if (body.product != null) {
    draft.product = String(body.product);
    draft.model = String(body.product);
  }
  draft.updatedAt = new Date().toISOString();

  store.drafts[idx] = draft;
  persistAndBroadcast();
  res.json({ ok: true, draft });
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
  console.log(`[delivery] listening on http://localhost:${PORT}`);
  console.log(`[delivery] agents password: ${AGENT_PASSWORD}`);
  console.log(`[delivery] data file: ${DATA_FILE}`);
});
