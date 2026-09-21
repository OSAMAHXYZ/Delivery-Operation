'use strict';

const express = require('express');
const XLSX = require('xlsx');
const {
  STATUSES,
  COMPLETED_STATUS,
  YES_NO,
  CARRIERS,
  TRANSFER_CITIES,
  EMPLOYEE_NAMES,
  ASSIGNABLE_NAMES,
  PIC_NAME_ALIASES,
  USERS,
  HEADER_MAP,
  OPS_HEADER_MAP,
  E_SALES_EXPORT_HEADERS,
  OPS_FIELDS,
  RAW_COL,
  E_SALES_COL,
  isGuestCenterRaw,
} = require('./constants');
const { createStore } = require('./store');
const { phoneDisplay, redactRawPii, canSeeCustomerPii } = require('./privacy');

function na(v) {
  const s = String(v == null ? '' : v).trim();
  return s || 'N/A';
}

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

function pickCol(row, aliases) {
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
    if (!a) continue;
    const hit = entries.find((e) => {
      if (!e.norm || e.norm === a) return false;
      if (e.norm.startsWith(`${a} `) || e.norm.endsWith(` ${a}`) || e.norm.includes(` ${a} `)) return true;
      if (a.length <= 3) return e.norm.startsWith(`${a} `) || e.norm.startsWith(a);
      return e.norm.includes(a);
    });
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  return '';
}

function excelSerialToIso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  // Excel serial date (UTC-ish)
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(num * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToIso(value);
  }
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const day = String(m[1]).padStart(2, '0');
    const mon = String(m[2]).padStart(2, '0');
    return `${y}-${mon}-${day}`;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function todayIso(tzOffsetMinutes) {
  // Default Asia/Riyadh (+3) when no offset provided
  const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 180;
  const now = new Date(Date.now() + offset * 60000);
  return now.toISOString().slice(0, 10);
}

function shiftIsoDays(isoDate, days) {
  const s = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function assignableProformaDates(tzOffsetMinutes) {
  const today = todayIso(tzOffsetMinutes);
  return { today, yesterday: shiftIsoDays(today, -1) };
}

function vehicleProformaDay(v) {
  return String((v && v.raw && (v.raw.proformaDate || v.raw.date)) || '').slice(0, 10);
}

function isAssignableProformaDay(v, tzOffsetMinutes) {
  const { today, yesterday } = assignableProformaDates(tzOffsetMinutes);
  const d = vehicleProformaDay(v);
  return d === today || d === yesterday;
}

function monthKeyFromIso(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return '';
}

function currentMonthKey(tzOffsetMinutes) {
  return todayIso(tzOffsetMinutes).slice(0, 7);
}

function findAssignableUser(employeeName) {
  const want = String(employeeName || '').trim().toLowerCase();
  if (!want) return null;
  return USERS.find((u) => (
    (u.role === 'employee' || u.role === 'hanouf')
    && (u.name.toLowerCase() === want || u.id === want)
  )) || null;
}

function isYesNo(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'yes' || s === 'y' || s === 'نعم' || s === '1' || s === 'true') return 'Yes';
  if (s === 'no' || s === 'n' || s === 'لا' || s === '0' || s === 'false') return 'No';
  return '';
}

/** Normalize Delivery sheet status like "a.CLAIMED" / "d. جاهز للتسليم" → app status. */
function normalizeSheetStatus(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  // strip leading letter index: a. / b. / d. /
  s = s.replace(/^[a-zA-Z]\.\s*/u, '').trim();
  // trailing letter index: الغاء.k / معلقة.L
  s = s.replace(/\.[a-zA-Z]\s*$/u, '').trim();
  const lower = s.toLowerCase();
  const map = {
    claimed: 'Claimed',
    psfu: 'PSFU',
  };
  if (map[lower]) return map[lower];
  const hit = STATUSES.find((st) => st === s || st.toLowerCase() === lower);
  if (hit) return hit;
  // fuzzy contains
  const soft = STATUSES.find((st) => lower.includes(st.toLowerCase()) || st.toLowerCase().includes(lower));
  return soft || s;
}

function normalizeYnLoose(v) {
  const yn = isYesNo(v);
  if (yn) return yn;
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('y') || s.includes('نعم')) return 'Yes';
  if (s.startsWith('n') || s.includes('لا')) return 'No';
  return '';
}

function findPhoneInLine(line) {
  if (!Array.isArray(line)) return '';
  for (const cell of line) {
    const digits = String(cell == null ? '' : cell).replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('05')) return digits;
    if (digits.length === 12 && digits.startsWith('9665')) return `0${digits.slice(3)}`;
    if (digits.length === 9 && digits.startsWith('5')) return `0${digits}`;
  }
  return '';
}

function isDeliverySheetHeaders(headers) {
  const norms = (headers || []).map((h) => normalizeHeader(h));
  const hasVinAr = norms.some((n) => n.includes('الشاس') || n.includes('شاسية') || n.includes('شاسيه'));
  const hasStatus = norms.some((n) => n.includes('الحالة') || n === 'status');
  const hasCarrier = norms.some((n) => n.includes('الناقل') || n === 'carrier');
  const hasUser = norms.some((n) => n === 'user name' || n.includes('user name'));
  return (hasVinAr && (hasStatus || hasCarrier || hasUser))
    || (hasStatus && hasCarrier);
}

function isLegacyRawColHeaders(headers) {
  const norms = (headers || []).map((h) => normalizeHeader(h));
  // Classic admin raw dump often has "Chassis / VIN" + "Proforma" style English headers
  const hasChassis = norms.some((n) => n.includes('chassis') && n.includes('vin'));
  const hasProforma = norms.some((n) => n.includes('proforma'));
  return hasChassis && hasProforma && !isDeliverySheetHeaders(headers);
}

function emptyOps() {
  return {
    guestSentDate: '',
    signatureReceivedDate: '',
    accountsSentDate: '',
    accountsApprovalDate: '',
    vin1502: '',
    opsStatus: '',
    trafficFile: '',
    trafficFeesOps: '',
    insuranceOps: '',
    registrationIssueDate: '',
    transferCity: '',
    carrier: '',
    notes: '',
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    assignedBy: '',
    assignedAt: '',
    updatedBy: '',
    updatedAt: '',
    guestCenter: '',
    guestCollectAt: '',
    guestCollected: '',
    guestCollectNote: '',
  };
}

function cellText(line, idx) {
  if (!Array.isArray(line) || idx == null || idx < 0) return '';
  const v = line[idx];
  return String(v == null ? '' : v).trim();
}

function mapRawRow(row, line, { useLegacyCols = false, useESalesCols = false } = {}) {
  const raw = {};
  for (const [key, aliases] of Object.entries(HEADER_MAP)) {
    raw[key] = pickCol(row, aliases);
  }
  // Legacy fixed columns only for classic Raw Data dumps (not Delivery sheet / E sales)
  if (useLegacyCols && Array.isArray(line) && line.length) {
    const so = cellText(line, RAW_COL.salesOrder);
    const inv = cellText(line, RAW_COL.invoiceOwner);
    const cust = cellText(line, RAW_COL.customerName);
    const ph = cellText(line, RAW_COL.phone);
    if (so) raw.salesOrder = so;
    if (inv) raw.invoiceOwner = inv;
    if (cust) raw.userName = cust;
    if (ph) raw.phone = ph;
  }
  if (!raw.phone) raw.phone = findPhoneInLine(line);
  if ((useESalesCols || (!useLegacyCols && Array.isArray(line) && line.length >= 25)) && Array.isArray(line) && line.length) {
    // Delivery / E sales fixed columns when header alias missed
    if (!raw.pic) raw.pic = cellText(line, E_SALES_COL.pic);
    if (!raw.salesOrder) raw.salesOrder = cellText(line, E_SALES_COL.salesOrder);
    if (!raw.product) raw.product = cellText(line, E_SALES_COL.product);
    if (!raw.salesType) raw.salesType = cellText(line, E_SALES_COL.salesType);
    if (!raw.invoiceOwner) raw.invoiceOwner = cellText(line, E_SALES_COL.invoiceOwner);
    if (!raw.userName) raw.userName = cellText(line, E_SALES_COL.userName);
    if (!raw.salesAdvisor) raw.salesAdvisor = cellText(line, E_SALES_COL.salesAdvisor);
  }
  // Delivery sheet uses تاريخ as the main date (treat as proforma when missing)
  raw.proformaDate = normalizeDate(raw.proformaDate) || normalizeDate(raw.date);
  raw.deliveryDate = normalizeDate(raw.deliveryDate);
  raw.registrationDate = normalizeDate(raw.registrationDate);
  raw.date = normalizeDate(raw.date) || raw.date;
  return raw;
}

function mapOpsFromRow(row, line, { useESalesCols = false } = {}) {
  const ops = {};
  for (const [key, aliases] of Object.entries(OPS_HEADER_MAP || {})) {
    const val = pickCol(row, aliases);
    if (key === 'opsStatus') ops.opsStatus = normalizeSheetStatus(val);
    else if (key === 'vin1502' || key === 'trafficFile' || key === 'trafficFeesOps' || key === 'insuranceOps') {
      ops[key] = normalizeYnLoose(val) || String(val || '').trim();
    } else if (key.endsWith('Date') || key.includes('Date')) {
      ops[key] = normalizeDate(val);
    } else if (key === 'carrier') {
      ops.carrier = String(val || '').trim();
    } else if (key === 'transferCity') {
      ops.transferCity = String(val || '').trim();
    } else {
      ops[key] = String(val == null ? '' : val).trim();
    }
  }
  // E sales fixed columns — ensure الناقل / مدينة الترحيل are never missed
  if (useESalesCols && Array.isArray(line) && line.length) {
    if (!ops.carrier) ops.carrier = cellText(line, E_SALES_COL.carrier);
    if (!ops.transferCity) ops.transferCity = cellText(line, E_SALES_COL.transferCity);
    if (!ops.opsStatus) ops.opsStatus = normalizeSheetStatus(cellText(line, E_SALES_COL.status));
  }
  return ops;
}

function mergeOpsFromSheet(existingOps, sheetOps) {
  const out = { ...emptyOps(), ...(existingOps || {}) };
  Object.keys(sheetOps || {}).forEach((k) => {
    const val = sheetOps[k];
    if (val == null || String(val).trim() === '') return;
    out[k] = val;
  });
  return out;
}

function resolveAssignableName(picName) {
  const raw = String(picName || '').trim();
  if (!raw) return '';
  const compact = raw.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/gi, '');
  if (PIC_NAME_ALIASES[compact]) return PIC_NAME_ALIASES[compact];
  const exact = ASSIGNABLE_NAMES.find((n) => n.toLowerCase() === raw.toLowerCase())
    || EMPLOYEE_NAMES.find((n) => n.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  const fuzzy = ASSIGNABLE_NAMES.find((n) => {
    const nl = n.toLowerCase();
    return lower.startsWith(nl) || nl.startsWith(lower) || lower.includes(nl) || compact.includes(nl);
  });
  return fuzzy || '';
}

/**
 * Assign from Delivery sheet PIC column.
 * force=true on archive upload so imported PIC always drives assignment.
 */
function assignFromPic(ops, picName, uploadedBy, { force = false } = {}) {
  const emp = resolveAssignableName(picName);
  if (!emp) return { ops: ops || emptyOps(), changed: false, name: '' };
  const id = String(emp).toLowerCase();
  const cur = ops || emptyOps();
  if (!force && cur.assignedEmployeeId) {
    return { ops: cur, changed: false, name: emp };
  }
  if (cur.assignedEmployeeId === id && cur.assignedEmployeeName === emp) {
    return { ops: cur, changed: false, name: emp };
  }
  return {
    ops: {
      ...cur,
      assignedEmployeeId: id,
      assignedEmployeeName: emp,
      assignedBy: uploadedBy || 'sheet-import',
      assignedAt: cur.assignedAt || new Date().toISOString(),
    },
    changed: true,
    name: emp,
  };
}

function publicVehicle(v, viewer) {
  if (!v) return null;
  const ops = { ...emptyOps(), ...v.ops };
  const guestCenter = isGuestCenterRaw(v.raw, ops) || String(ops.guestCenter || '').toLowerCase() === 'yes';
  let guestTimerMs = null;
  let guestDue = false;
  if (ops.guestCollectAt) {
    const at = new Date(ops.guestCollectAt).getTime();
    if (Number.isFinite(at)) {
      guestTimerMs = at - Date.now();
      guestDue = guestTimerMs <= 0 && String(ops.guestCollected || '') !== 'Yes';
    }
  }
  const role = viewer && (viewer.role || viewer);
  const allowPii = canSeeCustomerPii(role);
  const safeRaw = redactRawPii(v.raw || {}, role);
  return {
    vin: v.vin,
    raw: {
      date: na(safeRaw.date),
      salesOrder: na(safeRaw.salesOrder),
      product: na(safeRaw.product),
      pic: na(safeRaw.pic),
      salesType: na(safeRaw.salesType),
      invoiceOwner: allowPii ? na(safeRaw.invoiceOwner) : '—',
      userName: allowPii ? na(safeRaw.userName) : '—',
      salesAdvisor: na(safeRaw.salesAdvisor),
      proformaDate: na(safeRaw.proformaDate),
      deliveryDate: na(safeRaw.deliveryDate),
      gtLocation: na(safeRaw.gtLocation),
      vehicleLocation: na(safeRaw.vehicleLocation),
      phone: allowPii ? phoneDisplay(safeRaw.phone) : '—',
      status: na(safeRaw.status),
      traffic: na(safeRaw.traffic),
      trafficFees: na(safeRaw.trafficFees),
      insurance: na(safeRaw.insurance),
      registrationDate: na(safeRaw.registrationDate),
    },
    ops,
    guestCenter: !!guestCenter,
    guestTimerMs,
    guestDue,
    createdAt: v.createdAt,
    rawUpdatedAt: v.rawUpdatedAt,
    lastUploadId: v.lastUploadId || '',
  };
}

function canSeeAll(role) {
  return role === 'admin' || role === 'hanouf';
}

function createDeliveryTeamRouter(opts) {
  const filePath = opts.filePath;
  const password = String(opts.password || '1234').trim();
  const store = createStore(filePath);
  const router = express.Router();

  function notifyCarrierAssigned(items) {
    const fn = opts && opts.onCarrierAssigned;
    if (typeof fn !== 'function' || !items || !items.length) return null;
    try {
      return fn(items.map((it) => {
        const ops = it.ops || (it.vehicle && it.vehicle.ops) || {};
        return {
          vin: it.vin,
          carrier: it.carrier != null ? it.carrier : (ops.carrier || ''),
          transferCity: it.transferCity != null ? it.transferCity : (ops.transferCity || ''),
          raw: it.raw || (it.vehicle && it.vehicle.raw) || {},
          ops,
          by: it.by || '',
        };
      }));
    } catch (err) {
      console.error('[delivery-team] onCarrierAssigned failed:', err.message || err);
      return null;
    }
  }

  function notifyRawUploaded(summary) {
    const fn = opts && opts.onRawUploaded;
    if (typeof fn !== 'function') return null;
    try {
      return fn({ store, summary: summary || {} });
    } catch (err) {
      console.error('[delivery-team] onRawUploaded failed:', err.message || err);
      return null;
    }
  }

  function auth(req, res, next) {
    const header = req.headers['x-delivery-team-token']
      || req.headers.authorization
      || '';
    let token = String(header).trim();
    if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
    if (!token && req.body && req.body.token) token = String(req.body.token).trim();
    if (!token && req.query && req.query.token) token = String(req.query.token).trim();
    const session = store.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized — please sign in' });
    req.dtUser = session;
    req.dtToken = token;
    return next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.dtUser || !roles.includes(req.dtUser.role)) {
        return res.status(403).json({ error: 'Forbidden for this role' });
      }
      return next();
    };
  }

  function scopedVehicles(user) {
    const all = store.allVehicles();
    if (canSeeAll(user.role)) return all;
    return all.filter((v) => v.ops && v.ops.assignedEmployeeId === user.userId);
  }

  function assertVinAccess(req, res, vin, { write = false } = {}) {
    const key = normVin(vin);
    const v = store.getVehicle(key);
    if (!v) {
      res.status(404).json({ error: 'VIN not found' });
      return null;
    }
    if (canSeeAll(req.dtUser.role)) return v;
    const isMine = v.ops.assignedEmployeeId === req.dtUser.userId;
    if (write) {
      if (!isMine) {
        res.status(403).json({ error: 'You do not have access to edit this VIN' });
        return null;
      }
      return v;
    }
    // Read: own VINs or any assigned teammate VIN (team schedule)
    if (isMine || v.ops.assignedEmployeeId) return v;
    res.status(403).json({ error: 'You do not have access to this VIN' });
    return null;
  }

  router.get('/meta', (_req, res) => {
    const hubRaw = typeof opts.getHubRawStatus === 'function' ? opts.getHubRawStatus() : null;
    res.json({
      statuses: STATUSES,
      carriers: CARRIERS,
      transferCities: TRANSFER_CITIES,
      yesNo: YES_NO,
      employees: EMPLOYEE_NAMES,
      assignable: ASSIGNABLE_NAMES,
      users: USERS.map((u) => ({ id: u.id, name: u.name, role: u.role })),
      completedStatus: COMPLETED_STATUS,
      hubRaw: hubRaw || null,
    });
  });

  router.get('/raw-status', auth, (req, res) => {
    const hubRaw = typeof opts.getHubRawStatus === 'function' ? opts.getHubRawStatus() : null;
    res.json({ rawStatus: hubRaw || { uploaded: false, uploadedAt: null } });
  });

  router.post('/auth/login', (req, res) => {
    const user = store.getUserByLogin(req.body && req.body.username);
    if (!user) return res.status(401).json({ error: 'Unknown user' });
    const pass = String((req.body && req.body.password) || '').trim();
    if (pass !== password) return res.status(401).json({ error: 'Invalid password' });
    const token = store.createSession(user);
    return res.json({
      ok: true,
      token,
      user: { id: user.id, name: user.name, role: user.role },
    });
  });

  router.post('/auth/logout', auth, (req, res) => {
    store.destroySession(req.dtToken);
    res.json({ ok: true });
  });

  router.get('/auth/me', auth, (req, res) => {
    res.json({ user: { id: req.dtUser.userId, name: req.dtUser.name, role: req.dtUser.role } });
  });

  function applyFilters(list, q, viewer) {
    let out = list.slice();
    const search = String(q.q || q.search || '').trim().toLowerCase();
    if (search) {
      const allowPii = canSeeCustomerPii(viewer && viewer.role);
      out = out.filter((v) => {
        const hay = [
          v.vin,
          v.raw.salesOrder,
          v.raw.product,
          v.ops.assignedEmployeeName,
          v.ops.opsStatus,
          v.raw.salesAdvisor,
          v.ops.transferCity,
          v.ops.carrier,
          v.raw.gtLocation,
          v.raw.vehicleLocation,
        ];
        if (allowPii) {
          hay.push(v.raw.invoiceOwner, v.raw.userName, v.raw.phone);
        }
        return hay.join(' ').toLowerCase().includes(search);
      });
    }
    const eq = (field, val) => {
      if (!val) return;
      const want = String(val).trim().toLowerCase();
      out = out.filter((v) => String(field(v) || '').trim().toLowerCase() === want);
    };
    eq((v) => v.ops.assignedEmployeeName || v.ops.assignedEmployeeId, q.employee);
    eq((v) => v.raw.product, q.product);
    eq((v) => v.raw.salesType, q.salesType);
    eq((v) => v.ops.opsStatus, q.status);
    eq((v) => v.raw.vehicleLocation, q.vehicleLocation);
    eq((v) => v.raw.gtLocation, q.gtLocation);
    eq((v) => v.ops.transferCity, q.transferCity);
    if (q.carrier === '__empty__' || q.carrier === '(empty)') {
      out = out.filter((v) => !String(v.ops.carrier || '').trim());
    } else {
      eq((v) => v.ops.carrier, q.carrier);
    }
    eq((v) => v.ops.trafficFile, q.trafficFile);
    eq((v) => v.ops.trafficFeesOps, q.trafficFees);
    eq((v) => v.ops.insuranceOps, q.insurance);
    eq((v) => v.ops.vin1502, q.vin1502);
    if (q.assigned === 'yes') out = out.filter((v) => !!v.ops.assignedEmployeeId);
    if (q.assigned === 'no') out = out.filter((v) => !v.ops.assignedEmployeeId);
    if (q.proforma === 'today') {
      const today = todayIso(Number(q.tzOffset));
      out = out.filter((v) => vehicleProformaDay(v) === today);
    }
    if (q.proforma === 'today_yesterday' || q.proforma === 'assignable') {
      out = out.filter((v) => isAssignableProformaDay(v, Number(q.tzOffset)));
    }
    if (q.date) {
      const d = normalizeDate(q.date) || String(q.date).slice(0, 10);
      out = out.filter((v) => v.raw.proformaDate === d || v.raw.date === d);
    }
    if (q.month) {
      const m = String(q.month).trim().slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m)) {
        out = out.filter((v) => {
          const keys = [
            monthKeyFromIso(v.raw.proformaDate),
            monthKeyFromIso(v.raw.date),
            monthKeyFromIso(v.raw.deliveryDate),
            monthKeyFromIso(v.ops.assignedAt),
          ];
          return keys.includes(m);
        });
      }
    }
    return out;
  }

  function sortVehicles(list, sort, dir) {
    const key = String(sort || 'proformaDate');
    const desc = String(dir || 'desc').toLowerCase() === 'desc';
    const getter = {
      vin: (v) => v.vin,
      product: (v) => v.raw.product,
      salesOrder: (v) => v.raw.salesOrder,
      proformaDate: (v) => v.raw.proformaDate,
      status: (v) => v.ops.opsStatus,
      employee: (v) => v.ops.assignedEmployeeName,
      updatedAt: (v) => v.ops.updatedAt || v.rawUpdatedAt || '',
    }[key] || ((v) => v.raw.proformaDate);
    return list.slice().sort((a, b) => {
      const av = String(getter(a) || '');
      const bv = String(getter(b) || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return desc ? -cmp : cmp;
    });
  }

  router.get('/vehicles', auth, (req, res) => {
    let list = scopedVehicles(req.dtUser);
    list = applyFilters(list, req.query || {}, req.dtUser);
    list = sortVehicles(list, req.query.sort, req.query.dir);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const total = list.length;
    const start = (page - 1) * limit;
    const slice = list.slice(start, start + limit).map((v) => publicVehicle(v, req.dtUser));
    res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      rows: slice,
    });
  });

  /** Live Excel-style board — all assigned VINs (Admin, Hanouf, and every employee) */
  router.get('/live-sheet', auth, (req, res) => {
    if (typeof opts.onEnsureDraftCarriers === 'function') {
      try { opts.onEnsureDraftCarriers(); } catch (err) {
        console.error('[delivery-team] onEnsureDraftCarriers failed:', err.message || err);
      }
    }
    const q = { ...(req.query || {}), assigned: 'yes' };
    let list = store.allVehicles();
    list = applyFilters(list, q, req.dtUser);
    list = sortVehicles(list, req.query.sort || 'updatedAt', req.query.dir || 'desc');
    const byStatus = {};
    const byEmployee = {};
    const bySalesType = {};
    const byCarrier = {};
    list.forEach((v) => {
      const st = v.ops.opsStatus || '(blank)';
      byStatus[st] = (byStatus[st] || 0) + 1;
      const emp = v.ops.assignedEmployeeName || '(unassigned)';
      byEmployee[emp] = (byEmployee[emp] || 0) + 1;
      const stype = (v.raw && v.raw.salesType) || '(blank)';
      bySalesType[stype] = (bySalesType[stype] || 0) + 1;
      const car = String((v.ops && v.ops.carrier) || '').trim() || '(empty)';
      byCarrier[car] = (byCarrier[car] || 0) + 1;
    });
    res.json({
      at: new Date().toISOString(),
      total: list.length,
      month: q.month || '',
      byStatus,
      byEmployee,
      bySalesType,
      byCarrier,
      hubRaw: typeof opts.getHubRawStatus === 'function' ? opts.getHubRawStatus() : null,
      rows: list.map((v) => publicVehicle(v, req.dtUser)),
    });
  });

  router.get('/vehicles/:vin', auth, (req, res) => {
    const v = assertVinAccess(req, res, req.params.vin);
    if (!v) return undefined;
    return res.json({ vehicle: publicVehicle(v, req.dtUser) });
  });

  router.get('/dashboard', auth, (req, res) => {
    const month = String((req.query && req.query.month) || '').trim().slice(0, 7);
    const tz = Number(req.query.tzOffset);
    const filterQ = month && /^\d{4}-\d{2}$/.test(month) ? { month, tzOffset: tz } : { tzOffset: tz };
    // Full team fleet — everyone can see other users' schedules & sales-type mix
    const teamFleet = applyFilters(store.allVehicles(), filterQ, req.dtUser);
    // Personal scope for employee KPIs
    let mineScoped = scopedVehicles(req.dtUser);
    mineScoped = applyFilters(mineScoped, filterQ, req.dtUser);
    const today = todayIso(tz);
    const todays = teamFleet.filter((v) => v.raw.proformaDate === today);
    const assigned = teamFleet.filter((v) => v.ops.assignedEmployeeId);
    const unassigned = teamFleet.filter((v) => !v.ops.assignedEmployeeId);
    const byStatus = {};
    STATUSES.forEach((s) => { byStatus[s] = 0; });
    let blankStatus = 0;
    teamFleet.forEach((v) => {
      const s = v.ops.opsStatus;
      if (s && byStatus[s] != null) byStatus[s] += 1;
      else if (!s) blankStatus += 1;
    });
    const claimed = byStatus[COMPLETED_STATUS] || 0;
    const bySalesType = {};
    assigned.forEach((v) => {
      const st = (v.raw && v.raw.salesType) || '(blank)';
      bySalesType[st] = (bySalesType[st] || 0) + 1;
    });

    const employees = ASSIGNABLE_NAMES.map((name) => {
      const id = name.toLowerCase();
      const mine = assigned.filter((v) => v.ops.assignedEmployeeId === id);
      const done = mine.filter((v) => v.ops.opsStatus === COMPLETED_STATUS);
      const rem = mine.length - done.length;
      const pct = mine.length ? Math.round((done.length / mine.length) * 100) : 0;
      const salesTypes = {};
      mine.forEach((v) => {
        const st = (v.raw && v.raw.salesType) || '(blank)';
        salesTypes[st] = (salesTypes[st] || 0) + 1;
      });
      return {
        id,
        name,
        assigned: mine.length,
        claimed: done.length,
        remaining: rem,
        progress: pct,
        bySalesType: salesTypes,
      };
    });

    const mine = canSeeAll(req.dtUser.role)
      ? null
      : (() => {
        const rows = mineScoped.filter((v) => v.ops.assignedEmployeeId);
        const done = rows.filter((v) => v.ops.opsStatus === COMPLETED_STATUS);
        const salesTypes = {};
        rows.forEach((v) => {
          const st = (v.raw && v.raw.salesType) || '(blank)';
          salesTypes[st] = (salesTypes[st] || 0) + 1;
        });
        return {
          assigned: rows.length,
          completed: done.length,
          remaining: rows.length - done.length,
          progress: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
          bySalesType: salesTypes,
        };
      })();

    let recentEdits = [];
    if (canSeeAll(req.dtUser.role)) {
      recentEdits = (store.data.audit || [])
        .filter((a) => a && (
          String(a.action || '').startsWith('update_')
          || a.action === 'assign'
          || a.action === 'reassign'
        ))
        .slice(0, 60)
        .map((a) => ({
          id: a.id,
          at: a.at,
          vin: a.vin || '',
          user: a.user || '',
          action: a.action || '',
          oldValue: a.oldValue || '',
          newValue: a.newValue || '',
          field: String(a.action || '').replace(/^update_/, ''),
        }));
    }

    // Available months from data (for filter UI)
    const monthSet = new Set();
    store.allVehicles().forEach((v) => {
      [v.raw.proformaDate, v.raw.date, v.raw.deliveryDate, v.ops.assignedAt].forEach((d) => {
        const mk = monthKeyFromIso(d);
        if (mk) monthSet.add(mk);
      });
    });
    const months = [...monthSet].sort().reverse();
    if (!months.includes(currentMonthKey(tz))) months.unshift(currentMonthKey(tz));

    res.json({
      today,
      month: month || '',
      months,
      totals: {
        total: teamFleet.length,
        todaysProformas: todays.length,
        assigned: assigned.length,
        unassigned: unassigned.length,
        claimed,
        psfu: byStatus.PSFU || 0,
        ready: byStatus['جاهز للتسليم'] || 0,
        delivered: byStatus['تم التسليم'] || 0,
        blankStatus,
      },
      byStatus,
      bySalesType,
      pipeline: {
        todaysProformas: todays.length,
        assigned: assigned.length,
        psfu: byStatus.PSFU || 0,
        ready: byStatus['جاهز للتسليم'] || 0,
        delivered: (byStatus['تم التسليم'] || 0) + claimed,
      },
      employees,
      myWorkload: mine,
      recentEdits,
      hubRaw: typeof opts.getHubRawStatus === 'function' ? opts.getHubRawStatus() : null,
    });
  });

  router.get('/todays-proformas', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const today = todayIso(Number(req.query.tzOffset));
    const rows = store.allVehicles()
      .filter((v) => vehicleProformaDay(v) === today)
      .map((v) => publicVehicle(v, req.dtUser));
    res.json({ today, total: rows.length, rows });
  });

  router.get('/unassigned', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const tz = Number(req.query.tzOffset);
    const { today, yesterday } = assignableProformaDates(tz);
    // Default: today + yesterday proforma (assignable window). ?all=1 loads every unassigned.
    const allDays = String(req.query.all || '') === '1';
    const todayOnly = String(req.query.today || '') === '1';
    let list = store.allVehicles().filter((v) => !v.ops.assignedEmployeeId);
    if (!allDays) {
      if (todayOnly) list = list.filter((v) => vehicleProformaDay(v) === today);
      else list = list.filter((v) => isAssignableProformaDay(v, tz));
    }
    list = sortVehicles(list, 'proformaDate', 'desc');
    res.json({
      total: list.length,
      today,
      yesterday,
      window: allDays ? 'all' : (todayOnly ? 'today' : 'today_yesterday'),
      rows: list.map((v) => publicVehicle(v, req.dtUser)),
    });
  });

  /** Resolve a submitted VIN list for Hanouf display-before-assign. */
  router.post('/resolve-vins', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const tz = Number(req.body.tzOffset != null ? req.body.tzOffset : req.query.tzOffset);
    const { today, yesterday } = assignableProformaDates(tz);
    const rawList = Array.isArray(req.body.vins) ? req.body.vins : String(req.body.vins || '').split(/[\s,;]+/);
    const keys = [];
    const seen = new Set();
    rawList.forEach((v) => {
      const key = normVin(v);
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
    if (!keys.length) return res.status(400).json({ error: 'Submit at least one VIN' });

    const found = [];
    const missing = [];
    const outOfWindow = [];
    const alreadyAssigned = [];
    keys.forEach((key) => {
      const v = store.getVehicle(key);
      if (!v) {
        missing.push(key);
        return;
      }
      if (v.ops && v.ops.assignedEmployeeId) {
        alreadyAssigned.push({
          vin: key,
          employee: v.ops.assignedEmployeeName || v.ops.assignedEmployeeId,
        });
        return;
      }
      if (!isAssignableProformaDay(v, tz)) {
        outOfWindow.push({ vin: key, proformaDate: vehicleProformaDay(v) || 'N/A' });
        return;
      }
      found.push(publicVehicle(v, req.dtUser));
    });
    return res.json({
      total: found.length,
      missing,
      outOfWindow,
      alreadyAssigned,
      today,
      yesterday,
      rows: found,
    });
  });

  // Upload handler is mounted on the main app BEFORE express.json (binary Excel).
  function uploadHandler(req, res) {
    const header = req.headers['x-delivery-team-token'] || req.headers.authorization || '';
    let token = String(header).trim();
    if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
    const session = store.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized — please sign in' });
    if (!['admin', 'hanouf'].includes(session.role)) {
      return res.status(403).json({ error: 'Only Hanouf / Admin can upload Raw Data' });
    }
    req.dtUser = session;

    try {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) {
        return res.status(400).json({ error: 'Invalid file — empty upload' });
      }
      const filename = decodeURIComponent(String(req.headers['x-filename'] || 'raw-data.xlsx'));
      let workbook;
      try {
        workbook = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
      } catch (e) {
        return res.status(400).json({ error: `Invalid file — ${e.message || 'cannot parse Excel'}` });
      }
      const sheetNames = workbook.SheetNames || [];
      if (!sheetNames.length) {
        return res.status(400).json({ error: 'No worksheet found in workbook' });
      }

      const vinAliases = HEADER_MAP.vin.map(normalizeHeader);
      const pfAliases = HEADER_MAP.proformaDate.map(normalizeHeader);

      function scoreSheet(name) {
        const sh = workbook.Sheets[name];
        if (!sh) return { name, score: -1, headerIdx: 0, matrix: [] };
        const matrix = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', raw: true, cellDates: true });
        let headerIdx = 0;
        let bestHits = -1;
        for (let i = 0; i < Math.min(matrix.length, 40); i += 1) {
          const cells = (matrix[i] || []).map((c) => normalizeHeader(c));
          if (!cells.some(Boolean)) continue;
          const hits = cells.filter((c) => vinAliases.some((a) => c === a || c.includes(a))
            || pfAliases.some((a) => c === a || c.includes(a))
            || c.includes('product')
            || c.includes('sales order')
            || c.includes('الشاس')
            || c.includes('الناقل')
            || c.includes('الحالة')).length;
          if (hits > bestHits) {
            bestHits = hits;
            headerIdx = i;
          }
        }
        let score = bestHits;
        const n = String(name || '').toLowerCase();
        if (/e\s*sales|esales|delivery\s*sheet|تسليم/i.test(n)) score += 20;
        if (isDeliverySheetHeaders((matrix[headerIdx] || []).map((h) => String(h == null ? '' : h).trim()))) {
          score += 10;
        }
        return { name, score, headerIdx, matrix, bestHits };
      }

      // Prefer «E sales» / Delivery sheet; fall back to best-scoring sheet with VIN column
      let picked = null;
      const preferred = sheetNames.find((n) => /^e\s*sales$/i.test(String(n).trim()))
        || sheetNames.find((n) => /e\s*sales|esales/i.test(String(n)));
      if (preferred) {
        const cand = scoreSheet(preferred);
        if (cand.bestHits >= 1) picked = cand;
      }
      if (!picked) {
        const ranked = sheetNames.map(scoreSheet).sort((a, b) => b.score - a.score);
        picked = ranked[0];
      }
      if (!picked || picked.bestHits < 1 || !picked.matrix.length) {
        return res.status(400).json({
          error: 'No Delivery sheet found — expected a worksheet with رقم الشاسية / VIN (e.g. «E sales»)',
        });
      }

      const sheetName = picked.name;
      const matrix = picked.matrix;
      const headerIdx = picked.headerIdx;
      const headerRow = matrix[headerIdx] || [];
      const headers = headerRow.map((h, i) => {
        const t = String(h == null ? '' : h).trim();
        return t || `Column ${i + 1}`;
      });
      const deliveryFmt = isDeliverySheetHeaders(headers);
      const useLegacyCols = !deliveryFmt && isLegacyRawColHeaders(headers);
      const hasVin = headers.some((h) => {
        const n = normalizeHeader(h);
        return vinAliases.some((a) => n === a || n.includes(a)) || n.includes('الشاس');
      });
      if (!hasVin) {
        return res.status(400).json({ error: 'Missing VIN column — expected رقم الشاسية / Chassis / VIN' });
      }

      const today = todayIso(Number(req.headers['x-tz-offset']) || 180);
      let rowsProcessed = 0;
      let newVins = 0;
      let updatedVins = 0;
      let todaysProformas = 0;
      let duplicateInFile = 0;
      let opsImported = 0;
      let assignedFromPic = 0;
      let picUnresolved = 0;
      const errors = [];
      const seenInFile = new Set();
      const uploadId = `up_${Date.now()}`;

      for (let r = headerIdx + 1; r < matrix.length; r += 1) {
        const line = matrix[r] || [];
        if (line.every((c) => String(c == null ? '' : c).trim() === '')) continue;
        const obj = {};
        headers.forEach((h, i) => { obj[h] = line[i] != null ? line[i] : ''; });
        // Keep original blank header cells addressable for phone column
        headerRow.forEach((h, i) => {
          const key = String(h == null ? '' : h).trim() || `Column ${i + 1}`;
          if (obj[key] === undefined) obj[key] = line[i] != null ? line[i] : '';
        });
        const raw = mapRawRow(obj, line, { useLegacyCols, useESalesCols: !!deliveryFmt });
        const vinKey = normVin(raw.vin);
        if (!vinKey) {
          errors.push({ row: r + 1, error: 'Missing VIN' });
          continue;
        }
        if (seenInFile.has(vinKey)) duplicateInFile += 1;
        seenInFile.add(vinKey);
        rowsProcessed += 1;

        const sheetOps = mapOpsFromRow(obj, line, { useESalesCols: !!deliveryFmt || headers.some((h) => /ناقل|carrier/i.test(String(h))) });
        const hasSheetOps = Object.values(sheetOps).some((v) => String(v || '').trim() !== '');

        const existing = store.getVehicle(vinKey);
        // Archive / Delivery sheet upload: PIC always drives assignment when present
        const forceAssign = !!deliveryFmt || !!String(raw.pic || '').trim();
        let carriersTouched = false;
        if (!existing) {
          let ops = emptyOps();
          if (hasSheetOps) {
            ops = mergeOpsFromSheet(ops, sheetOps);
            opsImported += 1;
          }
          const asg = assignFromPic(ops, raw.pic || cellText(line, E_SALES_COL.pic), req.dtUser.name, { force: forceAssign });
          ops = asg.ops;
          if (asg.changed) assignedFromPic += 1;
          else if (String(raw.pic || cellText(line, E_SALES_COL.pic) || '').trim() && !asg.name) picUnresolved += 1;
          if (ops.carrier) carriersTouched = true;
          store.upsertVehicle(vinKey, {
            vin: vinKey,
            raw: { ...raw, vin: vinKey },
            ops,
            createdAt: new Date().toISOString(),
            rawUpdatedAt: new Date().toISOString(),
            lastUploadId: uploadId,
          });
          newVins += 1;
        } else {
          existing.raw = { ...existing.raw, ...raw, vin: vinKey };
          existing.rawUpdatedAt = new Date().toISOString();
          existing.lastUploadId = uploadId;
          let ops = { ...emptyOps(), ...existing.ops };
          if (hasSheetOps) {
            ops = mergeOpsFromSheet(ops, sheetOps);
            opsImported += 1;
          }
          const asg = assignFromPic(ops, raw.pic || cellText(line, E_SALES_COL.pic), req.dtUser.name, { force: forceAssign });
          ops = asg.ops;
          if (asg.changed) assignedFromPic += 1;
          else if (String(raw.pic || cellText(line, E_SALES_COL.pic) || '').trim() && !asg.name) picUnresolved += 1;
          if (ops.carrier) carriersTouched = true;
          existing.ops = ops;
          store.upsertVehicle(vinKey, existing);
          updatedVins += 1;
        }
        if (carriersTouched) { /* counted after loop via sync */ }
        if (raw.proformaDate === today || raw.date === today) todaysProformas += 1;
      }

      store.pushUpload({
        id: uploadId,
        filename,
        sheetName,
        rowsProcessed,
        newVins,
        updatedVins,
        todaysProformas,
        duplicateVins: duplicateInFile,
        opsImported,
        assignedFromPic,
        picUnresolved,
        format: deliveryFmt ? 'delivery-sheet' : (useLegacyCols ? 'legacy-raw' : 'generic'),
        errors: errors.slice(0, 50),
        uploadedBy: req.dtUser.name,
      });
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'upload_raw_data',
        oldValue: '',
        newValue: `${filename} · sheet «${sheetName}» · ${rowsProcessed} rows · assigned from PIC ${assignedFromPic}`,
      });
      store.save();

      // Push الناقل → coordinator company boards (clears «بدون شركة» when carrier is on the sheet)
      const carrierSyncItems = store.allVehicles()
        .filter((v) => v && String((v.ops && v.ops.carrier) || '').trim())
        .map((v) => ({
          vin: v.vin,
          carrier: v.ops.carrier,
          transferCity: (v.ops && v.ops.transferCity) || '',
          raw: v.raw,
          ops: v.ops,
          by: req.dtUser.name,
        }));
      const carrierHubSync = notifyCarrierAssigned(carrierSyncItems);

      const syncHint = notifyRawUploaded({
        rowsProcessed,
        newVins,
        updatedVins,
        todaysProformas,
        assignedFromPic,
        filename,
      });

      const carriersSynced = carrierHubSync && typeof carrierHubSync === 'object'
        ? (Number(carrierHubSync.added || 0) + Number(carrierHubSync.reassigned || 0))
        : (syncHint && syncHint.carriers
          ? (Number(syncHint.carriers.added || 0) + Number(syncHint.carriers.reassigned || 0))
          : 0);

      return res.json({
        ok: true,
        sheetName,
        filename,
        format: deliveryFmt ? 'delivery-sheet' : (useLegacyCols ? 'legacy-raw' : 'generic'),
        summary: {
          rowsProcessed,
          newVins,
          updatedVins,
          todaysProformas,
          duplicateVins: duplicateInFile,
          opsImported,
          assignedFromPic,
          picUnresolved,
          carriersOnSheet: carrierSyncItems.length,
          carriersSynced,
          carrierHubSync: carrierHubSync || undefined,
          errors: errors.slice(0, 50),
          errorCount: errors.length,
        },
        hubSync: syncHint || undefined,
      });
    } catch (err) {
      console.error('[delivery-team/upload]', err);
      return res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }

  // ——— Assignment ———
  router.post('/assign', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vins = Array.isArray(req.body.vins) ? req.body.vins : [req.body.vin];
    const employeeName = String(req.body.employee || '').trim();
    const tz = Number(req.body.tzOffset != null ? req.body.tzOffset : req.query.tzOffset);
    const { today, yesterday } = assignableProformaDates(tz);
    const emp = findAssignableUser(employeeName);
    if (!emp) {
      return res.status(400).json({
        error: `Select a valid person (${ASSIGNABLE_NAMES.join(' / ')})`,
      });
    }

    const results = [];
    vins.forEach((rawVin) => {
      const key = normVin(rawVin);
      const v = store.getVehicle(key);
      if (!v) {
        results.push({ vin: key, ok: false, error: 'Not found' });
        return;
      }
      if (v.ops && v.ops.assignedEmployeeId) {
        results.push({
          vin: key,
          ok: false,
          error: `Already assigned to ${v.ops.assignedEmployeeName || v.ops.assignedEmployeeId}`,
          employee: v.ops.assignedEmployeeName || '',
        });
        return;
      }
      if (!isAssignableProformaDay(v, tz)) {
        results.push({
          vin: key,
          ok: false,
          error: `Proforma must be today (${today}) or yesterday (${yesterday})`,
          proformaDate: vehicleProformaDay(v) || '',
        });
        return;
      }
      const old = v.ops.assignedEmployeeName || '';
      v.ops.assignedEmployeeId = emp.id;
      v.ops.assignedEmployeeName = emp.name;
      v.ops.assignedBy = req.dtUser.name;
      v.ops.assignedAt = new Date().toISOString();
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(key, v);
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: 'assign',
        oldValue: old || '(unassigned)',
        newValue: emp.name,
      });
      results.push({ vin: key, ok: true, employee: emp.name });
    });
    store.save();
    res.json({ ok: true, today, yesterday, results });
  });

  /** Reassign VINs to another employee (or Hanouf). Employees may only move their own VINs. */
  router.post('/reassign', auth, (req, res) => {
    const vins = Array.isArray(req.body.vins) ? req.body.vins : [req.body.vin];
    const employeeName = String(req.body.employee || '').trim();
    const emp = findAssignableUser(employeeName);
    if (!emp) {
      return res.status(400).json({
        error: `Select a valid person (${ASSIGNABLE_NAMES.join(' / ')})`,
      });
    }

    const isManager = canSeeAll(req.dtUser.role);
    const results = [];
    vins.forEach((rawVin) => {
      const key = normVin(rawVin);
      const v = store.getVehicle(key);
      if (!v) {
        results.push({ vin: key, ok: false, error: 'Not found' });
        return;
      }
      if (!isManager && v.ops.assignedEmployeeId !== req.dtUser.userId) {
        results.push({ vin: key, ok: false, error: 'Not your VIN' });
        return;
      }
      if (v.ops.assignedEmployeeId === emp.id) {
        results.push({ vin: key, ok: false, error: 'Already assigned to this employee' });
        return;
      }
      const old = v.ops.assignedEmployeeName || '';
      v.ops.assignedEmployeeId = emp.id;
      v.ops.assignedEmployeeName = emp.name;
      v.ops.assignedBy = req.dtUser.name;
      v.ops.assignedAt = new Date().toISOString();
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(key, v);
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: 'reassign',
        oldValue: old || '(unassigned)',
        newValue: emp.name,
      });
      results.push({ vin: key, ok: true, employee: emp.name });
    });
    store.save();
    res.json({ ok: true, results });
  });

  /** Hanouf / Admin: set الناقل on any VIN list */
  router.post('/assign-carrier', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vins = Array.isArray(req.body.vins) ? req.body.vins : [req.body.vin];
    const carrier = String(req.body.carrier || '').trim();
    if (!carrier) return res.status(400).json({ error: 'اختر الناقل' });

    const results = [];
    vins.forEach((rawVin) => {
      const key = normVin(rawVin);
      const v = store.getVehicle(key);
      if (!v) {
        results.push({ vin: key, ok: false, error: 'Not found' });
        return;
      }
      const oldCarrier = v.ops.carrier || '';
      if (oldCarrier === carrier) {
        results.push({ vin: key, ok: true, carrier, unchanged: true });
        return;
      }
      v.ops.carrier = carrier;
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(key, v);
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: 'update_carrier',
        oldValue: oldCarrier || '(empty)',
        newValue: carrier,
      });
      results.push({ vin: key, ok: true, carrier });
    });
    store.save();
    const carrierItems = results
      .filter((r) => r.ok && r.carrier && !r.unchanged)
      .map((r) => {
        const v = store.getVehicle(r.vin);
        return v ? { vin: r.vin, carrier: r.carrier, vehicle: v, by: req.dtUser.name } : null;
      })
      .filter(Boolean);
    // Also sync unchanged carriers that may not be on coordinator yet
    const allCarrierItems = results
      .filter((r) => r.ok && r.carrier)
      .map((r) => {
        const v = store.getVehicle(r.vin);
        return v ? { vin: r.vin, carrier: r.carrier, vehicle: v, by: req.dtUser.name } : null;
      })
      .filter(Boolean);
    const hubSync = notifyCarrierAssigned(allCarrierItems.length ? allCarrierItems : carrierItems);
    res.json({ ok: true, results, hubSync: hubSync || undefined });
  });

  router.post('/unassign', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vins = Array.isArray(req.body.vins) ? req.body.vins : [req.body.vin];
    vins.forEach((rawVin) => {
      const key = normVin(rawVin);
      const v = store.getVehicle(key);
      if (!v) return;
      const old = v.ops.assignedEmployeeName || '';
      v.ops.assignedEmployeeId = '';
      v.ops.assignedEmployeeName = '';
      v.ops.assignedBy = '';
      v.ops.assignedAt = '';
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: 'unassign',
        oldValue: old,
        newValue: '(unassigned)',
      });
    });
    store.save();
    res.json({ ok: true });
  });

  // ——— Ops update (employee / admin / hanouf) ———
  router.patch('/vehicles/:vin', auth, (req, res) => {
    const v = assertVinAccess(req, res, req.params.vin, { write: true });
    if (!v) return undefined;
    const body = req.body || {};
    const allowed = {
      guestSentDate: (x) => normalizeDate(x),
      signatureReceivedDate: (x) => normalizeDate(x),
      accountsSentDate: (x) => normalizeDate(x),
      accountsApprovalDate: (x) => normalizeDate(x),
      registrationIssueDate: (x) => normalizeDate(x),
      vin1502: (x) => isYesNo(x) || (['Yes', 'No', ''].includes(String(x)) ? String(x) : ''),
      opsStatus: (x) => {
        const s = normalizeSheetStatus(x);
        if (!s) return '';
        if (!STATUSES.includes(s)) throw new Error(`Invalid status: ${s}`);
        return s;
      },
      trafficFile: (x) => isYesNo(x) || (YES_NO.includes(String(x)) ? String(x) : ''),
      trafficFeesOps: (x) => isYesNo(x) || (YES_NO.includes(String(x)) ? String(x) : ''),
      insuranceOps: (x) => isYesNo(x) || (YES_NO.includes(String(x)) ? String(x) : ''),
      transferCity: (x) => {
        const s = String(x || '').trim();
        if (!s) return '';
        // Allow cities from Delivery sheet even if not in the static list
        return s;
      },
      carrier: (x) => {
        const s = String(x || '').trim();
        if (!s) return '';
        // Prefer known carriers; still accept sheet values (e.g. custom الناقل)
        return s;
      },
      notes: (x) => String(x == null ? '' : x),
      guestCenter: (x) => {
        const s = String(x || '').trim();
        if (!s) return '';
        if (/^(yes|y|نعم|1|true)$/i.test(s)) return 'Yes';
        if (/^(no|n|لا|0|false)$/i.test(s)) return 'No';
        return s === 'Yes' || s === 'No' ? s : '';
      },
      guestCollectAt: (x) => {
        const s = String(x || '').trim();
        if (!s) return '';
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 19);
        return s;
      },
      guestCollected: (x) => isYesNo(x) || (['Yes', 'No', ''].includes(String(x)) ? String(x) : ''),
      guestCollectNote: (x) => String(x == null ? '' : x),
    };

    try {
      Object.keys(allowed).forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(body, field)) return;
        const oldVal = v.ops[field] == null ? '' : String(v.ops[field]);
        const newVal = allowed[field](body[field]);
        if (String(newVal) === oldVal) return;
        v.ops[field] = newVal;
        store.pushAudit({
          vin: v.vin,
          user: req.dtUser.name,
          action: `update_${field}`,
          oldValue: oldVal || '(empty)',
          newValue: String(newVal) || '(empty)',
        });
      });
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(v.vin, v);
      store.save();
      let hubSync;
      const carrierChanged = Object.prototype.hasOwnProperty.call(body, 'carrier');
      const cityChanged = Object.prototype.hasOwnProperty.call(body, 'transferCity');
      if (carrierChanged || cityChanged) {
        const carrier = String(v.ops.carrier || '').trim();
        const transferCity = String(v.ops.transferCity || '').trim();
        if (carrier || transferCity) {
          hubSync = notifyCarrierAssigned([{
            vin: v.vin,
            carrier,
            transferCity,
            vehicle: v,
            by: req.dtUser.name,
          }]);
        }
      }
      return res.json({
        ok: true,
        saved: true,
        vehicle: publicVehicle(v, req.dtUser),
        lastUpdated: v.ops.updatedAt,
        hubSync: hubSync || undefined,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Update failed' });
    }
  });

  // ——— Guest Experience (Ruba) ———
  function canManageGuest(req, v) {
    if (!v) return false;
    if (canSeeAll(req.dtUser.role)) return true;
    if (req.dtUser.userId === 'ruba' && v.ops.assignedEmployeeId === 'ruba') return true;
    return false;
  }

  function parseGuestDateTime(dateStr, timeStr) {
    const d = normalizeDate(dateStr) || String(dateStr || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Invalid collection date');
    let t = String(timeStr || '').trim();
    if (!t) t = '12:00';
    const tm = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!tm) throw new Error('Invalid collection time (use HH:MM)');
    const hh = String(Math.min(23, Number(tm[1]))).padStart(2, '0');
    const mm = String(Math.min(59, Number(tm[2]))).padStart(2, '0');
    // Store as local-wall ISO without Z so UI shows the chosen clock time
    return `${d}T${hh}:${mm}:00`;
  }

  /** Schedule / reschedule Guest Exp customer collection (Ruba) */
  router.post('/vehicles/:vin/guest-schedule', auth, (req, res) => {
    const v = assertVinAccess(req, res, req.params.vin, { write: true });
    if (!v) return undefined;
    if (!canManageGuest(req, v)) {
      return res.status(403).json({ error: 'Only Ruba (on her VINs) or Admin/Hanouf can schedule Guest Exp' });
    }
    try {
      const at = parseGuestDateTime(req.body && req.body.date, req.body && req.body.time);
      const old = v.ops.guestCollectAt || '';
      v.ops.guestCenter = 'Yes';
      v.ops.guestCollectAt = at;
      v.ops.guestCollected = '';
      v.ops.guestCollectNote = String((req.body && req.body.note) || v.ops.guestCollectNote || '').trim();
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(v.vin, v);
      store.pushAudit({
        vin: v.vin,
        user: req.dtUser.name,
        action: old ? 'guest_reschedule' : 'guest_schedule',
        oldValue: old || '(empty)',
        newValue: at,
      });
      store.save();
      return res.json({ ok: true, vehicle: publicVehicle(v, req.dtUser) });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Schedule failed' });
    }
  });

  /** After timer: mark collected (then optional status) or reschedule */
  router.post('/vehicles/:vin/guest-collect', auth, (req, res) => {
    const v = assertVinAccess(req, res, req.params.vin, { write: true });
    if (!v) return undefined;
    if (!canManageGuest(req, v)) {
      return res.status(403).json({ error: 'Only Ruba (on her VINs) or Admin/Hanouf can confirm Guest Exp collection' });
    }
    const collected = req.body && (req.body.collected === true || req.body.collected === 'yes' || req.body.collected === 'Yes');
    try {
      if (collected) {
        const status = String((req.body && req.body.status) || '').trim();
        if (status && !STATUSES.includes(status)) {
          return res.status(400).json({ error: `Invalid status: ${status}` });
        }
        const oldCollected = v.ops.guestCollected || '';
        v.ops.guestCollected = 'Yes';
        v.ops.guestCenter = 'Yes';
        if (status) {
          const oldStatus = v.ops.opsStatus || '';
          v.ops.opsStatus = status;
          if (oldStatus !== status) {
            store.pushAudit({
              vin: v.vin,
              user: req.dtUser.name,
              action: 'update_opsStatus',
              oldValue: oldStatus || '(empty)',
              newValue: status,
            });
          }
        }
        v.ops.updatedBy = req.dtUser.name;
        v.ops.updatedAt = new Date().toISOString();
        store.upsertVehicle(v.vin, v);
        store.pushAudit({
          vin: v.vin,
          user: req.dtUser.name,
          action: 'guest_collected',
          oldValue: oldCollected || '(empty)',
          newValue: status ? `Yes · ${status}` : 'Yes',
        });
        store.save();
        return res.json({ ok: true, vehicle: publicVehicle(v, req.dtUser) });
      }

      // Not collected → require new date/time
      const at = parseGuestDateTime(req.body && req.body.date, req.body && req.body.time);
      const old = v.ops.guestCollectAt || '';
      v.ops.guestCollected = 'No';
      v.ops.guestCenter = 'Yes';
      v.ops.guestCollectAt = at;
      v.ops.guestCollectNote = String((req.body && req.body.note) || '').trim() || v.ops.guestCollectNote || '';
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(v.vin, v);
      store.pushAudit({
        vin: v.vin,
        user: req.dtUser.name,
        action: 'guest_not_collected_reschedule',
        oldValue: old || '(empty)',
        newValue: at,
      });
      store.save();
      return res.json({ ok: true, vehicle: publicVehicle(v, req.dtUser) });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Update failed' });
    }
  });

  router.get('/audit', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vin = normVin(req.query.vin || '');
    let list = store.data.audit || [];
    if (vin) list = list.filter((a) => a.vin === vin);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(20, Number(req.query.limit) || 50));
    const total = list.length;
    const rows = list.slice((page - 1) * limit, (page - 1) * limit + limit);
    res.json({ total, page, limit, rows });
  });

  router.get('/export', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const assignedOnly = String(req.query.assigned || '') === '1' || String(req.query.assigned || '') === 'yes';
    const list = sortVehicles(
      store.allVehicles().filter((v) => (assignedOnly ? (v.ops && v.ops.assignedEmployeeId) : true)),
      'proformaDate',
      'desc'
    );

    const ynOut = (v) => {
      const s = String(v || '').trim();
      if (!s) return '';
      if (/^yes$/i.test(s)) return 'yes ';
      if (/^no$/i.test(s)) return 'no ';
      return s;
    };

    const matrix = [E_SALES_EXPORT_HEADERS.slice()];
    const allowPii = canSeeCustomerPii(req.dtUser && req.dtUser.role);
    list.forEach((v) => {
      const raw = v.raw || {};
      const ops = v.ops || {};
      const pic = ops.assignedEmployeeName || raw.pic || '';
      matrix.push([
        raw.date || raw.proformaDate || '',
        raw.salesOrder || '',
        v.vin || '',
        raw.product || '',
        raw.damage || '',
        pic,
        raw.salesType || '',
        allowPii ? (raw.invoiceOwner || '') : '',
        allowPii ? (raw.userName || '') : '',
        raw.salesAdvisor || '',
        ops.guestSentDate || '',
        ops.signatureReceivedDate || '',
        ops.accountsSentDate || '',
        ops.accountsApprovalDate || '',
        ynOut(ops.vin1502),
        raw.gtLocation || '',
        raw.vehicleLocation || '',
        ops.opsStatus || raw.status || '',
        ynOut(ops.trafficFile),
        ynOut(ops.trafficFeesOps),
        ynOut(ops.insuranceOps),
        ops.registrationIssueDate || raw.registrationDate || '',
        ops.notes || '',
        ops.transferCity || '',
        ops.carrier || '',
        raw.financeOfficer || '',
        raw.salesType || '',
        raw.salePlace || '',
        allowPii ? (raw.phone || '') : '',
        '', '', '',
        raw.deliveryDate || '',
        '', '', '', '', '', '', '', '',
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(matrix.length > 1 ? matrix : [E_SALES_EXPORT_HEADERS.slice(), []]);
    ws['!autofilter'] = { ref: ws['!ref'] || 'A1' };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'E sales');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'export_excel',
      oldValue: '',
      newValue: `${list.length} VINs · E sales format`,
    });
    store.save();
    const fname = `Delivery sheet ${todayIso()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`);
    return res.send(buf);
  });

  function canUploadSalesRawUser(session) {
    if (!session) return false;
    if (session.role === 'admin' || session.role === 'hanouf') return true;
    const id = String(session.userId || session.id || '').toLowerCase();
    const name = String(session.name || '').toLowerCase();
    return id === 'ruba' || name === 'ruba';
  }

  /**
   * Sales Raw upload (hub inventory) — Hanouf, Ruba, Admin.
   * Updates shared raw data once; everyone sees uploadedAt.
   */
  function salesRawUploadHandler(req, res) {
    const header = req.headers['x-delivery-team-token'] || req.headers.authorization || '';
    let token = String(header).trim();
    if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
    const session = store.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized — please sign in' });
    if (!canUploadSalesRawUser(session)) {
      return res.status(403).json({ error: 'Only Hanouf, Ruba, or Admin can upload Sales Raw' });
    }
    req.dtUser = session;

    try {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) {
        return res.status(400).json({ error: 'Invalid file — empty upload' });
      }
      const filename = decodeURIComponent(String(req.headers['x-filename'] || 'Sales Raw Data.xlsx'));
      const fn = opts && opts.onSalesRawUpload;
      if (typeof fn !== 'function') {
        return res.status(503).json({ error: 'Sales Raw upload is not available on this server' });
      }
      const result = fn({
        buffer: buf,
        filename,
        byUser: { userId: session.userId, id: session.userId, name: session.name, role: session.role },
      });
      store.pushAudit({
        vin: '',
        user: session.name,
        action: 'upload_sales_raw',
        oldValue: '',
        newValue: `${result.imported || 0} vehicles · ${filename}`,
      });
      store.save();
      return res.json(result);
    } catch (err) {
      console.error('[delivery-team] sales-raw upload failed:', err.message || err);
      const status = Number(err.status) || 500;
      return res.status(status).json({ error: err.message || 'Sales Raw upload failed' });
    }
  }

  return { router, store, uploadHandler, salesRawUploadHandler };
}

module.exports = { createDeliveryTeamRouter };
