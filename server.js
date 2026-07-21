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
  if (item.agentStatus === 'delivered') return 'تم الترحيل';
  if (item.agentStatus === 'out_of_delivery') return 'Out for delivery';
  if (item.agentStatus === 'ready_for_delivery') return 'Ready';
  if (item.agentStatus === 'in_stock') return item.assignedTo ? `مع ${item.assignedTo}` : 'In Stock';
  return 'محجوز';
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
      customerName: item.customerName || ''
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
    customerName: veh.customerName || item.customerName || ''
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

function parseSalesWorkbook(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetOrder = [
    ...wb.SheetNames.filter((n) => /sales\s*raw/i.test(n)),
    ...wb.SheetNames.filter((n) => /raw/i.test(n) && !/sales\s*raw/i.test(n)),
    ...wb.SheetNames.filter((n) => !/raw/i.test(n))
  ];
  // unique preserve order
  const sheets = [...new Set(sheetOrder.length ? sheetOrder : wb.SheetNames)];
  if (!sheets.length) throw new Error('لا توجد أوراق في الملف');

  const vinAliases = [
    'vin no', 'vin no.', 'vin number', 'vin#', 'vin',
    'chassis', 'chassis / vin', 'chassis/vin', 'chassis no', 'chassis no.',
    'chassis number', 'شاسيه', 'رقم الشاسيه', 'frame', 'frame no'
  ];

  let preferred = sheets[0];
  let rows = [];
  let vehicles = [];
  let headers = [];

  for (const name of sheets) {
    const sheet = wb.Sheets[name];
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    if (!sheetRows.length) continue;
    const found = [];
    const seen = new Set();
    for (const row of sheetRows) {
      const vin = normVin(pickCol(row, vinAliases));
      if (!vin || vin.length < 5) continue;
      // ignore placeholder / non-VIN junk
      if (!/[A-HJ-NPR-Z0-9]/i.test(vin)) continue;
      if (seen.has(vin)) continue;
      seen.add(vin);

      const product = pickCol(row, ['product', 'model', 'product name', 'وصف', 'المنتج', 'الطراز']);
      const gt = pickCol(row, ['gt location', 'gt status', 'gt code', 'gtcode', 'gt_code', 'gt']);
      const location = pickCol(row, [
        'gt location', 'stock location', 'storage location', 'location',
        'warehouse', 'yard', 'الموقع', 'المستودع'
      ]);
      const plate = pickCol(row, ['plate', 'plate no', 'plate number', 'veh plate', 'لوحة', 'رقم اللوحة']);
      const customerName = pickCol(row, ['customer name', 'customer', 'اسم العميل', 'العميل']);
      const imageUrl = pickCol(row, ['image', 'image url', 'imageurl', 'photo', 'صورة']);
      const suffix = pickCol(row, ['suffix', 'ext', 'color', 'model year']);

      found.push({
        vin,
        product,
        model: product,
        gt,
        location,
        plate,
        customerName,
        imageUrl,
        suffix
      });
    }
    if (found.length) {
      preferred = name;
      rows = sheetRows;
      vehicles = found;
      headers = Object.keys(sheetRows[0] || {});
      break;
    }
    if (!headers.length && sheetRows[0]) headers = Object.keys(sheetRows[0]);
  }

  if (!vehicles.length) {
    const headerHint = headers.length ? ` · الأعمدة: ${headers.slice(0, 12).join(' | ')}` : '';
    throw new Error(`لم يتم العثور على أرقام شاسيه في الملف${headerHint}`);
  }

  return {
    vehicles,
    sheetName: preferred,
    filename: filename || '',
    rawRows: rows.slice(0, 5000)
  };
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

function generateDocx(payload) {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    throw new Error('قالب Word غير موجود (templates/delivery_note_template.docx)');
  }
  const content = fs.readFileSync(TEMPLATE_FILE);
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

// ——— HTTP app ———
const app = express();
app.use(express.json({ limit: '40mb' }));

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
    // Refresh Product/GT/Location on every queue row from the new raw file + drop duplicate VINs
    const refresh = refreshQueueFromVehicles();
    persistAndBroadcast();
    res.json({
      imported: parsed.vehicles.length,
      queueRefreshed: refresh.total,
      matchedUpdated: refresh.matched,
      notInNewFile: refresh.missing
    });
  } catch (err) {
    console.error('[upload]', err);
    res.status(500).json({ error: err.message || 'فشل رفع الملف' });
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
    const hay = `${vin} ${v.product || ''} ${v.plate || ''} ${v.gt || ''} ${v.location || ''}`.toUpperCase();
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

  const vin = normVin(req.body?.vin);
  const draftPayload = req.body?.draft || {};
  const item = findQueueItem(vin);
  if (!item) return res.status(404).json({ error: 'الشاسيه غير موجود' });
  if (item.assignedTo && item.assignedTo !== auth.username) {
    return res.status(403).json({ error: 'غير مسموح — الشاسيه مع موظف آخر' });
  }

  item.status = 'claimed';
  item.agentStatus = 'delivered';
  item.assignedTo = auth.username;

  const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    printedAt: new Date().toISOString(),
    vin,
    product: item.product || '',
    model: item.model || item.product || '',
    assignedTo: auth.username,
    customerName: draftPayload.company_rep || item.customerName || '',
    plate: item.plate || '',
    gt: item.gt || '',
    location: item.location || '',
    payload: draftPayload
  };
  store.drafts.unshift(draft);
  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;

  persistAndBroadcast();
  res.json({ ok: true, draftId: id, item: enrichQueueItem(item) });
});

app.get('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const draft = store.drafts.find((d) => d.id === id);
  if (!draft) return res.status(404).json({ error: 'المسودة غير موجودة' });
  res.json({ draft });
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

// Static files (hub UI + assets)
app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
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
