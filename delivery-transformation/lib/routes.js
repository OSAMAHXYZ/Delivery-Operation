'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  STATUSES,
  LAST_MONTH_UPLOAD_STATUSES,
  YES_NO,
  CARRIERS,
  TRANSFER_CITIES,
  USERS,
  PIC_ALIASES,
  OPS_FIELDS,
  emptyOps,
  emptyRaw,
} = require('./constants');
const { createStore } = require('./store');
const { parseDeliverySheet, parseSalesRaw } = require('./importer');
const kpiEngine = require('./kpi');
const exportExcel = require('./export-excel');
const fullExcel = require('./full-excel');
const scheduleEngine = require('./schedule');
const monthClose = require('./month-close');
const companyPerformance = require('./company-performance');

const RAW_UPLOAD_LIMIT = '80mb';

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isManager(role) {
  return role === 'admin' || role === 'hanouf';
}

/** Employees + Hanouf can receive VINs. */
function isAssignable(u) {
  return !!(u && (u.role === 'employee' || u.role === 'hanouf'));
}

function findAssignable(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const id = PIC_ALIASES[key] || key;
  return USERS.find((u) => isAssignable(u) && (u.id === id || u.name.toLowerCase() === key)) || null;
}

function canUploadSalesRaw(sessionUser) {
  if (!sessionUser) return false;
  if (isManager(sessionUser.role)) return true;
  const u = USERS.find((x) => x.id === sessionUser.userId);
  return !!(u && u.canUploadSalesRaw);
}

function canEditAnyVin(sessionUser) {
  if (!sessionUser) return false;
  if (isManager(sessionUser.role)) return true;
  const u = USERS.find((x) => x.id === sessionUser.userId || x.id === sessionUser.id);
  return !!(u && u.canEditAnyVin);
}

function canManageAppointments(sessionUser) {
  if (!sessionUser) return false;
  if (isManager(sessionUser.role)) return true;
  return sessionUser.userId === 'ruba' || sessionUser.id === 'ruba';
}

function userRecord(sessionUser) {
  if (!sessionUser) return null;
  return USERS.find((x) => x.id === sessionUser.userId || x.id === sessionUser.id) || null;
}

/** Coordinator page + print / attendance. Ruba stays an employee on employee.html. */
function canCoordinate(sessionUser) {
  if (!sessionUser) return false;
  if (sessionUser.role === 'coordinator' || sessionUser.role === 'admin') return true;
  const rec = userRecord(sessionUser);
  return !!(rec && rec.canCoordinate);
}

function canInventory(sessionUser) {
  const rec = userRecord(sessionUser);
  return !!(rec && rec.canInventory);
}

/** Only Hanouf and Rasha assign الناقل (carrier company) on the Live Sheet. */
const CARRIER_ASSIGNERS = new Set(['hanouf', 'rasha']);

function canAssignCarrier(sessionUser) {
  if (!sessionUser) return false;
  return CARRIER_ASSIGNERS.has(String(sessionUser.userId || sessionUser.id || '').trim().toLowerCase());
}

function publicUserFlags(sessionUser) {
  return {
    canUploadSalesRaw: canUploadSalesRaw(sessionUser),
    canEditAnyVin: canEditAnyVin(sessionUser),
    canManageAppointments: canManageAppointments(sessionUser),
    canCoordinate: canCoordinate(sessionUser),
    canInventory: canInventory(sessionUser),
    canAssignCarrier: canAssignCarrier(sessionUser),
  };
}

function isGuestYes(v) {
  const raw = String((v && v.ops && v.ops.guestCenter) || '').trim().toLowerCase();
  return raw === 'yes' || raw === 'y';
}

function parseAppointmentDateTime(date, time) {
  const d = String(date || '').trim();
  const t = String(time || '').trim();
  const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) throw new Error('Set appointment date and time');
  const hh = String(Math.min(23, Number(tm[1]))).padStart(2, '0');
  const mm = String(Math.min(59, Number(tm[2]))).padStart(2, '0');
  return `${d}T${hh}:${mm}:00`;
}

/** Current month in Riyadh (UTC+3), e.g. "2026-09". */
function currentMonthKey() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** Today in Riyadh (UTC+3), e.g. "2026-09-23". */
function todayKey() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inMonth(v, month) {
  return [
    v.raw && v.raw.proformaDate,
    v.raw && v.raw.date,
    v.ops && v.ops.assignedAt,
  ].some((d) => String(d || '').slice(0, 7) === month);
}

function isDelivered(v) {
  const s = v && v.ops && v.ops.opsStatus;
  return s === 'Claimed' || s === 'تم التسليم';
}

/** Live Sheet / My VINs row order, top to bottom. */
const SHEET_STATUS_ORDER = [
  'Claimed',
  'PSFU',
  'تم التسليم',
  'جاهز للتسليم',
  'تسليم متقدم',
  'صادرة',
  'مرور',
  'رجوع مرور',
  'بطاقة',
  'فسح',
  'معلقة',
  'الغاء',
];

function sheetStatusRank(v) {
  let s = String((v && v.ops && v.ops.opsStatus) || '').trim();
  const lower = s.toLowerCase();
  if (lower === 'claimed') s = 'Claimed';
  else if (lower === 'psfu') s = 'PSFU';
  else if (s === 'صادر') s = 'صادرة';
  else if (s === 'معلقه') s = 'معلقة';
  const i = SHEET_STATUS_ORDER.indexOf(s);
  return i === -1 ? SHEET_STATUS_ORDER.length : i;
}

function findEmployeeByPic(pic) {
  return findAssignable(pic);
}

function canEditVehicle(v, viewer) {
  const role = viewer && viewer.role;
  if (isManager(role) || canEditAnyVin(viewer)) return true;
  if (role === 'employee') return !!(v && v.ops && v.ops.assignedEmployeeId === viewer.userId);
  return false;
}

function isCoordinatorPrinted(v) {
  return !!(v && v.ops && String(v.ops.coordinatorPrintedAt || '').trim());
}

/** Read-only Live Sheet columns the coordinator may view (no inventory / history internals). */
const COORDINATOR_SHEET_OPS = [
  ...OPS_FIELDS,
  'assignedEmployeeName',
  'carrierChangedFrom',
  'coordinatorPrintedAt',
  'coordinatorPrintLabel',
  'updatedAt',
  'updatedBy',
];

function publicVehicle(v, viewer, opts = {}) {
  if (!v) return null;
  const role = viewer && viewer.role;
  const raw = { ...(v.raw || {}) };
  const src = v.ops || {};
  let ops;
  if (role === 'coordinator' && opts.sheet) {
    ops = {};
    COORDINATOR_SHEET_OPS.forEach((k) => { ops[k] = src[k] == null ? '' : src[k]; });
  } else if (role === 'coordinator') {
    // Coordinator workspace: VIN details + transfer city (print branch) + assigned الناقل (memo company).
    ops = {
      transferCity: String(src.transferCity || '').trim(),
      carrier: String(src.carrier || '').trim(),
      carrierChangedFrom: String(src.carrierChangedFrom || '').trim(),
    };
  } else {
    ops = { ...src };
  }
  return {
    vin: v.vin,
    raw,
    ops,
    canEdit: canEditVehicle(v, viewer),
    viewerRole: role || '',
  };
}

function createDeliveryTransformationRouter(opts = {}) {
  const router = express.Router();
  const password = String(opts.password || '1234').trim();
  const dataFile = opts.dataFile
    || path.join(opts.root || process.cwd(), 'delivery-transformation-data.json');
  const store = createStore(dataFile);
  monthClose.startMonthCloseScanner(store);

  function peekMemoInvoice() {
    const n = Number(store.data.meta && store.data.meta.memoInvoiceNext);
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 1000;
  }

  /**
   * Coordinator chose a company other than the الناقل Hanouf / Rasha set on the VIN.
   * carrierChangedFrom keeps the original assignment so the Live Sheet shows "from → to";
   * switching back to the original clears the mark. VINs with no الناقل yet are left alone.
   */
  function applyCoordinatorCarrier(v, company, userName, now) {
    const next = String(company || '').trim();
    if (!v || !next) return false;
    if (!v.ops) v.ops = emptyOps();
    const current = String(v.ops.carrier || '').trim();
    if (!current || current === next) return false;
    const original = String(v.ops.carrierChangedFrom || '').trim() || current;
    v.ops.carrier = next;
    if (original === next) {
      v.ops.carrierChangedFrom = '';
      v.ops.carrierChangedBy = '';
      v.ops.carrierChangedAt = '';
    } else {
      v.ops.carrierChangedFrom = original;
      v.ops.carrierChangedBy = userName;
      v.ops.carrierChangedAt = now;
    }
    v.ops.updatedAt = now;
    v.ops.updatedBy = userName;
    store.pushAudit({
      vin: v.vin,
      user: userName,
      action: 'coordinator_carrier_change',
      oldValue: current,
      newValue: next,
    });
    return true;
  }

  function consumeMemoInvoice() {
    const n = peekMemoInvoice();
    if (!store.data.meta || typeof store.data.meta !== 'object') {
      store.data.meta = { memoInvoiceNext: n + 1 };
    } else {
      store.data.meta.memoInvoiceNext = n + 1;
    }
    store.save();
    return n;
  }

  function auth(req, res, next) {
    const token = String(
      req.headers['x-delivery-transform-token']
      || req.headers['x-dt-token']
      || (req.body && req.body.token)
      || (req.query && req.query.token)
      || ''
    ).trim();
    const session = store.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.dtToken = token;
    req.dtUser = session;
    return next();
  }

  /** Live push: any save (employee.html edit, import, coordinator print) → "change" event to open pages. */
  const liveClients = new Set();
  let liveTimer = null;
  store.onChange((at) => {
    if (!liveClients.size || liveTimer) return;
    liveTimer = setTimeout(() => {
      liveTimer = null;
      const msg = `event: change\ndata: ${JSON.stringify({ at: at || new Date().toISOString() })}\n\n`;
      liveClients.forEach((res) => {
        try { res.write(msg); } catch (_) { liveClients.delete(res); }
      });
    }, 150);
  });

  router.get('/live-events', auth, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    liveClients.add(res);
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) { /* closed */ }
    }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      liveClients.delete(res);
    });
  });

  function customList(key) {
    const arr = store.data.meta && store.data.meta[key];
    return Array.isArray(arr) ? arr.map((s) => String(s || '').trim()).filter(Boolean) : [];
  }

  function allCarriers() {
    return [...new Set([...CARRIERS, ...customList('customCarriers')])];
  }

  function allCities() {
    return [...new Set([...TRANSFER_CITIES, ...customList('customCities')])];
  }

  function isKnownCompany(name) {
    return allCarriers().includes(String(name || '').trim());
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.dtUser || !roles.includes(req.dtUser.role)) {
        return res.status(403).json({ error: 'Forbidden for this role' });
      }
      return next();
    };
  }

  function normalizePhone(value) {
    const ar = '٠١٢٣٤٥٦٧٨٩';
    return String(value || '')
      .trim()
      .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
      .replace(/[^\d+]/g, '');
  }

  router.post('/attendance', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    const company = String((req.body && req.body.company) || '').trim();
    const phone = normalizePhone(req.body && req.body.phone);
    if (name.length < 2) {
      return res.status(400).json({ error: 'أدخل الاسم' });
    }
    if (!isKnownCompany(company)) {
      return res.status(400).json({ error: 'اختر الشركة من القائمة' });
    }
    if (phone.replace(/\D/g, '').length < 9) {
      return res.status(400).json({ error: 'أدخل رقم جوال صحيح' });
    }
    if (!Array.isArray(store.data.attendance)) store.data.attendance = [];
    const entry = {
      id: `att_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      at: new Date().toISOString(),
      name,
      company,
      phone,
    };
    store.data.attendance.unshift(entry);
    if (store.data.attendance.length > 5000) store.data.attendance.length = 5000;
    store.save();
    return res.json({ ok: true, entry });
  });

  const ATTEND_HOLD_MS = 2 * 60 * 60 * 1000;

  function attendanceRows() {
    if (!Array.isArray(store.data.attendance)) store.data.attendance = [];
    return store.data.attendance;
  }

  function attendanceOpen(entry, viewerId) {
    if (!entry || entry.usedAt) return false;
    if (!entry.heldBy) return true;
    const heldAt = Date.parse(entry.heldAt || '') || 0;
    if (heldAt && Date.now() - heldAt > ATTEND_HOLD_MS) {
      entry.heldBy = '';
      entry.heldAt = '';
      return true;
    }
    return entry.heldBy === viewerId;
  }

  function normalizeCityKey(value) {
    return String(value || '')
      .trim()
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function isOpenCityForAllCompanies(city) {
    const key = normalizeCityKey(city);
    if (!key) return true;
    if (key === 'الرياض' || key === 'جده') return true;
    return key.includes('اوتومول') || key.includes('automall');
  }

  function requestCity(req) {
    return String((req.query && req.query.city) || (req.body && req.body.city) || '').trim();
  }

  function requestAssignedCompany(req) {
    return String((req.query && req.query.company) || (req.body && req.body.company) || '').trim();
  }

  function printedCarsByCompanyForCity(city) {
    const want = normalizeCityKey(city);
    const counts = new Map();
    if (!want) return counts;
    store.allVehicles().forEach((v) => {
      if (!isCoordinatorPrinted(v) || !v.ops) return;
      if (String(v.ops.coordinatorPrintKind || '') === 'warehouse') return;
      const company = String(v.ops.coordinatorPrintCompany || '').trim();
      if (!company) return;
      const printedCity = normalizeCityKey(v.ops.coordinatorPrintCity || v.ops.transferCity);
      if (printedCity !== want) return;
      counts.set(company, (counts.get(company) || 0) + 1);
    });
    return counts;
  }

  /** assignedCompany: الناقل set by Hanouf / Rasha on the VIN — always offered, even outside the city rotation. */
  function attendanceAvailablePayload(viewerId, city, assignedCompany = '') {
    const groups = new Map();
    attendanceRows().forEach((entry) => {
      if (!attendanceOpen(entry, viewerId)) return;
      const company = String(entry.company || '').trim();
      if (!company) return;
      if (!groups.has(company)) groups.set(company, { company, available: 0, people: [] });
      const g = groups.get(company);
      const mine = entry.heldBy === viewerId;
      if (!mine) g.available += 1;
      g.people.push({
        id: entry.id,
        name: entry.name,
        phone: entry.phone,
        held: mine,
      });
    });
    let list = [...groups.values()]
      .filter((g) => g.available > 0 || g.people.some((p) => p.held))
      .sort((a, b) => a.company.localeCompare(b.company, 'ar'));
    if (!isOpenCityForAllCompanies(city)) {
      const counts = printedCarsByCompanyForCity(city);
      const competing = list.filter((g) => g.available > 0);
      if (competing.length) {
        let min = Infinity;
        competing.forEach((g) => {
          const n = counts.get(g.company) || 0;
          if (n < min) min = n;
        });
        list = list.filter((g) => {
          if (g.people.some((p) => p.held)) return true;
          if (assignedCompany && g.company === assignedCompany) return g.available > 0;
          return g.available > 0 && (counts.get(g.company) || 0) === min;
        });
      }
    }
    return list;
  }

  function releaseHoldsFor(viewerId, exceptId) {
    attendanceRows().forEach((entry) => {
      if (entry.heldBy === viewerId && entry.id !== exceptId && !entry.usedAt) {
        entry.heldBy = '';
        entry.heldAt = '';
      }
    });
  }

  router.get('/attendance/available', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ companies: attendanceAvailablePayload(req.dtUser.userId, requestCity(req), requestAssignedCompany(req)) });
  });

  router.post('/attendance/hold', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = String((req.body && req.body.id) || '').trim();
    const entry = attendanceRows().find((e) => e.id === id);
    if (!entry || entry.usedAt) {
      return res.status(404).json({ error: 'لا يوجد حضور متاح لهذا الاسم' });
    }
    if (entry.heldBy && entry.heldBy !== req.dtUser.userId) {
      const heldAt = Date.parse(entry.heldAt || '') || 0;
      if (!heldAt || Date.now() - heldAt <= ATTEND_HOLD_MS) {
        return res.status(409).json({ error: 'هذا الاسم محجوز الآن' });
      }
    }
    releaseHoldsFor(req.dtUser.userId, id);
    entry.heldBy = req.dtUser.userId;
    entry.heldAt = new Date().toISOString();
    store.save();
    return res.json({
      ok: true,
      entry: { id: entry.id, name: entry.name, company: entry.company, phone: entry.phone },
      companies: attendanceAvailablePayload(req.dtUser.userId, requestCity(req), requestAssignedCompany(req)),
    });
  });

  router.post('/attendance/release', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    releaseHoldsFor(req.dtUser.userId, '');
    store.save();
    return res.json({ ok: true, companies: attendanceAvailablePayload(req.dtUser.userId, requestCity(req), requestAssignedCompany(req)) });
  });

  /**
   * Coordinator memo company list — every الناقل company (not limited to attendance check-ins)
   * with how many cars each took (memo + display prints). Attendance names only feed suggestions.
   */
  router.get('/coordinator/companies', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const today = todayKey();
    const map = new Map();
    const row = (company) => {
      const key = String(company || '').trim();
      if (!key) return null;
      if (!map.has(key)) map.set(key, { company: key, total: 0, today: 0, people: [] });
      return map.get(key);
    };
    allCarriers().forEach(row);
    (store.data.prints || []).forEach((p) => {
      if (!p || p.kind === 'warehouse') return;
      const r = row(p.company);
      if (!r) return;
      const n = Array.isArray(p.vins) ? p.vins.length : 0;
      r.total += n;
      const riyadhDay = new Date((Date.parse(p.at) || 0) + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (riyadhDay === today) r.today += n;
    });
    attendanceRows().forEach((entry) => {
      if (!attendanceOpen(entry, req.dtUser.userId)) return;
      const r = row(entry.company);
      if (r) r.people.push({ id: entry.id, name: entry.name, phone: entry.phone || '' });
    });
    const companies = [...map.values()].sort((a, b) => (b.total - a.total) || a.company.localeCompare(b.company, 'ar'));
    return res.json({ at: new Date().toISOString(), companies });
  });

  router.get('/meta', (req, res) => {
    // Optional auth for month-close banner when token present
    const token = String(
      req.headers['x-delivery-transform-token']
      || req.headers['x-dt-token']
      || ''
    ).trim();
    const session = token ? store.getSession(token) : null;
    const payload = {
      module: 'delivery-transformation',
      isolated: true,
      statuses: STATUSES,
      carriers: allCarriers(),
      transferCities: allCities(),
      yesNo: YES_NO,
      users: USERS
        .filter((u) => u.role !== 'admin' && u.id !== 'admin')
        .map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          canCoordinate: !!u.canCoordinate,
          canInventory: !!u.canInventory,
        })),
      employees: vacationList(),
      currentMonth: currentMonthKey(),
      previousMonth: monthClose.previousMonthKey(currentMonthKey()),
      lastMonthUploadStatuses: LAST_MONTH_UPLOAD_STATUSES,
      today: todayKey(),
      imports: store.data.meta.imports || {},
      pendingAssignments: Object.keys(store.data.meta.pendingAssignments || {}).length,
      memoInvoiceNext: peekMemoInvoice(),
    };
    if (session && isManager(session.role)) {
      payload.monthClose = monthClose.monthCloseStatus(store);
    }
    res.json(payload);
  });

  router.get('/month-close', auth, requireRole('admin', 'hanouf'), (_req, res) => {
    res.json(monthClose.monthCloseStatus(store));
  });

  router.get('/month-close/download', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const status = monthClose.monthCloseStatus(store);
    if (!status.ready && !status.purged) {
      return res.status(404).json({ error: 'No month archive ready yet (runs automatically on day 1)' });
    }
    const mc = store.data.meta.monthClose;
    if (!mc || !mc.archiveFile || !fs.existsSync(mc.archiveFile)) {
      return res.status(404).json({ error: 'Archive file missing — wait for day-1 prepare' });
    }
    monthClose.markDownloaded(store, req.dtUser.name);
    const name = `DT-Month-Close-${mc.forMonth || 'archive'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.sendFile(path.resolve(mc.archiveFile));
  });

  router.post('/month-close/apply', auth, requireRole('admin', 'hanouf'), (req, res) => {
    try {
      const result = monthClose.applyMonthClosePurge(store, req.dtUser.name);
      return res.json({
        ok: true,
        ...result,
        monthClose: monthClose.monthCloseStatus(store),
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Could not apply month close' });
    }
  });

  router.post('/month-close/prepare', auth, requireRole('admin'), (req, res) => {
    try {
      monthClose.forcePrepare(store, req.dtUser.name);
      return res.json({ ok: true, monthClose: monthClose.monthCloseStatus(store) });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Could not prepare month close' });
    }
  });

  router.post('/auth/collector', (req, res) => {
    const pass = String((req.body && req.body.password) || '').trim();
    if (pass !== password) return res.status(401).json({ error: 'Invalid password' });
    const collector = { id: 'collector', name: 'Collector', role: 'admin' };
    const token = store.createSession(collector);
    return res.json({
      ok: true,
      token,
      user: { id: collector.id, name: collector.name, role: collector.role },
    });
  });

  router.post('/auth/login', (req, res) => {
    const user = store.getUserByLogin(req.body && req.body.username);
    if (!user || user.role === 'admin' || user.id === 'admin') {
      return res.status(401).json({ error: 'Unknown user' });
    }
    const pass = String((req.body && req.body.password) || '').trim();
    if (pass !== password) return res.status(401).json({ error: 'Invalid password' });
    const token = store.createSession(user);
    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        ...publicUserFlags({ userId: user.id, role: user.role }),
      },
    });
  });

  router.post('/auth/logout', auth, (req, res) => {
    store.destroySession(req.dtToken);
    res.json({ ok: true });
  });

  router.get('/auth/me', auth, (req, res) => {
    res.json({
      user: {
        id: req.dtUser.userId,
        name: req.dtUser.name,
        role: req.dtUser.role,
        ...publicUserFlags(req.dtUser),
      },
    });
  });

  router.get('/print-invoice', auth, (_req, res) => {
    res.json({ next: peekMemoInvoice() });
  });

  router.post('/print-invoice', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const invoiceNumber = consumeMemoInvoice();
    store.pushAudit({
      user: req.dtUser.name,
      action: 'print_invoice',
      oldValue: String(invoiceNumber),
      newValue: String(invoiceNumber + 1),
      vin: String((req.body && req.body.vin) || ''),
    });
    return res.json({
      ok: true,
      invoiceNumber,
      next: peekMemoInvoice(),
    });
  });

  router.post('/print-complete', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const raw = Array.isArray(req.body && req.body.vins)
      ? req.body.vins
      : [req.body && req.body.vin];
    const kind = String((req.body && req.body.kind) || 'memo').trim() || 'memo';
    const now = new Date().toISOString();
    const printCompany = String((req.body && req.body.company) || '').trim();
    const printCity = String((req.body && req.body.city) || '').trim();
    const attendanceId = String((req.body && req.body.attendanceId) || '').trim();
    const invoiceNumber = String((req.body && req.body.invoiceNumber) || '').trim();
    const rawLabel = String((req.body && req.body.label) || '').trim();
    const label = kind === 'display' ? (rawLabel === 'داخلي' ? 'داخلي' : rawLabel === 'عرض' ? 'عرض' : '') : '';
    if (kind === 'display' && !label) {
      return res.status(400).json({ error: 'اختر المرفق: داخلي أو صالة عرض' });
    }
    const marked = [];
    raw.forEach((item) => {
      const v = store.getVehicle(item);
      if (!v) return;
      if (!v.ops) v.ops = emptyOps();
      if (kind !== 'warehouse') applyCoordinatorCarrier(v, printCompany, req.dtUser.name, now);
      v.ops.coordinatorPrintedAt = now;
      v.ops.coordinatorPrintedBy = req.dtUser.name;
      v.ops.coordinatorPrintKind = kind;
      v.ops.coordinatorPrintLabel = label;
      if (kind === 'warehouse') {
        v.ops.coordinatorPrintCompany = '';
        v.ops.coordinatorPrintCity = '';
      } else {
        v.ops.coordinatorPrintCompany = printCompany;
        v.ops.coordinatorPrintCity = printCity || String((v.ops.transferCity || '')).trim();
        if (printCompany) v.ops.carrier = printCompany;
        if (invoiceNumber) v.ops.coordinatorPrintInvoice = invoiceNumber;
      }
      v.ops.updatedAt = now;
      v.ops.updatedBy = req.dtUser.name;
      marked.push(v.vin);
      store.pushAudit({
        vin: v.vin,
        user: req.dtUser.name,
        action: 'coordinator_print',
        oldValue: '',
        newValue: kind,
      });
    });
    if (attendanceId) {
      const att = attendanceRows().find((e) => e.id === attendanceId);
      if (att && !att.usedAt) {
        att.usedAt = now;
        att.leftAt = now;
        att.usedBy = req.dtUser.name;
        att.usedVins = marked.slice();
        att.usedCity = printCity;
        att.usedCompany = printCompany || att.company;
        att.heldBy = '';
        att.heldAt = '';
      }
    }
    if (!Array.isArray(store.data.prints)) store.data.prints = [];
    // Display / internal VINs are typed by hand and may not be on the Live Sheet — log them anyway.
    const snapshotCars = (req.body && req.body.snapshot && Array.isArray(req.body.snapshot.cars)) ? req.body.snapshot.cars : [];
    const printVins = kind === 'display'
      ? [...new Set(raw.map((item) => normVin(item)).filter(Boolean))]
      : marked;
    if (printVins.length) {
      store.data.prints.unshift({
        id: `prn_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        at: now,
        kind,
        label,
        company: kind === 'warehouse' ? '' : printCompany,
        city: kind === 'warehouse' ? '' : printCity,
        vins: printVins.map((vin) => {
          const v = store.getVehicle(vin);
          const typed = snapshotCars.find((c) => normVin(c && c.chassis) === vin);
          return {
            vin,
            product: (typed && String(typed.model || '').trim()) || (v && v.raw && v.raw.product) || '',
            customer: (v && v.raw && v.raw.userName) || '',
            plate: (typed && String(typed.plate || '').trim()) || '',
            remarks: (typed && String(typed.remarks || '').trim()) || '',
          };
        }),
        printedBy: req.dtUser.name,
        attendanceId,
        invoiceNumber: kind === 'warehouse' ? '' : invoiceNumber,
        snapshot: (() => {
          const snap = req.body && req.body.snapshot;
          if (!snap || typeof snap !== 'object') return null;
          try { return JSON.parse(JSON.stringify(snap)); } catch { return snap; }
        })(),
      });
    }
    if (printVins.length || attendanceId) store.save();
    return res.json({ ok: true, vins: marked });
  });

  /** Coordinator picked another company for VINs that Hanouf / Rasha already gave a الناقل — update the Live Sheet now. */
  router.post('/coordinator/carrier', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const company = String((req.body && req.body.company) || '').trim();
    if (!company) return res.status(400).json({ error: 'اختر الشركة' });
    const vins = Array.isArray(req.body && req.body.vins) ? req.body.vins : [];
    const now = new Date().toISOString();
    const changed = [];
    vins.forEach((item) => {
      const v = store.getVehicle(item);
      if (!v) return;
      const from = String((v.ops && v.ops.carrier) || '').trim();
      if (applyCoordinatorCarrier(v, company, req.dtUser.name, now)) {
        changed.push({ vin: v.vin, from, to: company, original: v.ops.carrierChangedFrom || '' });
      }
    });
    if (changed.length) store.save();
    return res.json({ ok: true, changed });
  });

  /** Coordinator "If VIN not assigned": Sales Raw VINs (Proforma filled · not invoiced) not on the Live Sheet yet. */
  router.get('/sales-raw-vins', auth, (req, res) => {
    if (!canCoordinate(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const rows = Object.values(pendingMap())
      .filter((p) => p && p.vin && !store.getVehicle(p.vin))
      .map((p) => ({ vin: p.vin, raw: { ...emptyRaw(), ...(p.raw || {}), vin: p.vin }, uploadedAt: p.uploadedAt || '' }))
      .sort((a, b) => String(b.raw.proformaDate || '').localeCompare(String(a.raw.proformaDate || ''))
        || a.vin.localeCompare(b.vin));
    const last = (store.data.meta.imports || {}).lastSalesRaw || null;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      at: new Date().toISOString(),
      total: rows.length,
      lastSalesRaw: last ? { at: last.at, by: last.by, filename: last.filename } : null,
      rows,
    });
  });

  router.get('/inventory', auth, (req, res) => {
    if (!canInventory(req.dtUser) && req.dtUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json(buildInventoryPayload(req.dtUser));
  });

  router.post('/inventory/claim', auth, (req, res) => {
    if (!canInventory(req.dtUser)) return res.status(403).json({ error: 'Forbidden' });
    const vins = selectedInventoryVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const now = new Date().toISOString();
    const label = String((req.body && req.body.label) || '').trim();
    const result = applyInventoryClaim(vins, req.dtUser, now, { label });
    if (result.error) return res.status(400).json({ error: result.error });
    store.save();
    return res.json({ ok: true, ...result, ...buildInventoryPayload(req.dtUser) });
  });

  router.post('/inventory/release', auth, (req, res) => {
    if (!canInventory(req.dtUser)) return res.status(403).json({ error: 'Forbidden' });
    const vins = selectedInventoryVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const now = new Date().toISOString();
    const result = applyInventoryClaim(vins, req.dtUser, now, { release: true });
    store.save();
    return res.json({ ok: true, ...result, ...buildInventoryPayload(req.dtUser) });
  });

  router.post('/inventory/label', auth, (req, res) => {
    if (!canInventory(req.dtUser)) return res.status(403).json({ error: 'Forbidden' });
    const vins = selectedInventoryVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const now = new Date().toISOString();
    const label = String((req.body && req.body.label) || '').trim();
    const result = applyInventoryLabel(vins, req.dtUser, now, label);
    if (result.error) return res.status(400).json({ error: result.error });
    store.save();
    return res.json({ ok: true, ...result, ...buildInventoryPayload(req.dtUser) });
  });

  function finderKey(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** Public Live Sheet lookup — VIN / order only. No customer or phone. */
  router.get('/vin-finder', (req, res) => {
    const rawQ = String((req.query && (req.query.q || req.query.vin || req.query.order)) || '').trim();
    const q = finderKey(rawQ);
    if (q.length < 4) {
      return res.status(400).json({ error: 'Type at least 4 characters of the VIN or order number' });
    }
    const rows = store.allVehicles()
      .map((v) => {
        const vin = finderKey(v.vin);
        const order = finderKey(v.raw && v.raw.salesOrder);
        const vinHit = vin.includes(q);
        const orderHit = order.includes(q);
        if (!vinHit && !orderHit) return null;
        const exact = vin === q || order === q;
        return {
          vin: v.vin,
          order: String((v.raw && v.raw.salesOrder) || '').trim(),
          status: String((v.ops && v.ops.opsStatus) || '').trim(),
          employee: String((v.ops && v.ops.assignedEmployeeName) || '').trim(),
          exact,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || String(a.vin).localeCompare(String(b.vin)))
      .slice(0, 20)
      .map(({ exact, ...row }) => row);
    return res.json({ q: rawQ, total: rows.length, rows });
  });

  /**
   * Batch VIN Finder — exact order-number or VIN matches only (same Live Sheet fields as /vin-finder).
   * body: { keys: string[] } → { results: { [normalisedKey]: { vin, order, status, employee } } }
   */
  router.post('/vin-finder/lookup', (req, res) => {
    const raw = Array.isArray(req.body && req.body.keys) ? req.body.keys : [];
    const wanted = new Set(raw.slice(0, 3000).map(finderKey).filter((k) => k.length >= 4));
    const results = {};
    if (wanted.size) {
      store.allVehicles().forEach((v) => {
        const row = {
          vin: v.vin,
          order: String((v.raw && v.raw.salesOrder) || '').trim(),
          status: String((v.ops && v.ops.opsStatus) || '').trim(),
          employee: String((v.ops && v.ops.assignedEmployeeName) || '').trim(),
        };
        [finderKey(v.vin), finderKey(row.order)].forEach((k) => {
          if (!k || !wanted.has(k)) return;
          const prev = results[k];
          if (!prev || (!prev.status && row.status)) results[k] = row;
        });
      });
    }
    return res.json({ total: Object.keys(results).length, results });
  });

  /** Live Sheet — every role can list; edit only admin/employee via PATCH */
  router.get('/live-sheet', auth, (req, res) => {
    const q = String((req.query && req.query.q) || '').trim().toLowerCase();
    const isCoordinator = req.dtUser.role === 'coordinator';
    // view=sheet: coordinator's read-only copy of the full Live Sheet (printed VINs included)
    const sheetView = isCoordinator && String((req.query && req.query.view) || '') === 'sheet';
    let list = store.allVehicles();
    if (isCoordinator && !sheetView) {
      list = list.filter((v) => !isCoordinatorPrinted(v));
    }
    if (q) {
      list = list.filter((v) => {
        const hay = [
          v.vin,
          v.raw && v.raw.salesOrder,
          v.raw && v.raw.product,
          v.raw && v.raw.salesType,
          v.raw && v.raw.userName,
          v.ops && v.ops.transferCity,
          ...(isCoordinator ? [] : [
            v.ops && v.ops.opsStatus,
            v.ops && v.ops.carrier,
            v.ops && v.ops.assignedEmployeeName,
          ]),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    const month = String((req.query && req.query.month) || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      list = list.filter((v) => inMonth(v, month));
    }
    if (!isCoordinator) {
      const eq = (val, pick) => {
        const want = String(val || '').trim().toLowerCase();
        if (!want) return;
        list = list.filter((v) => String(pick(v) || '').trim().toLowerCase() === want);
      };
      eq(req.query.employee, (v) => v.ops && v.ops.assignedEmployeeName);
      eq(req.query.status, (v) => v.ops && v.ops.opsStatus);
      if (req.query.carrier === '__empty__') {
        list = list.filter((v) => !String((v.ops && v.ops.carrier) || '').trim());
      } else {
        eq(req.query.carrier, (v) => v.ops && v.ops.carrier);
      }
    }
    list.sort((a, b) => sheetStatusRank(a) - sheetStatusRank(b)
      || String((a.raw && (a.raw.proformaDate || a.raw.date)) || '').localeCompare(String((b.raw && (b.raw.proformaDate || b.raw.date)) || ''))
      || String(a.vin).localeCompare(String(b.vin)));
    const byStatus = {};
    const byEmployee = {};
    const byCarrier = {};
    const bySalesType = {};
    list.forEach((v) => {
      const st = (v.ops && v.ops.opsStatus) || '(blank)';
      byStatus[st] = (byStatus[st] || 0) + 1;
      const emp = (v.ops && v.ops.assignedEmployeeName) || '(unassigned)';
      byEmployee[emp] = (byEmployee[emp] || 0) + 1;
      const car = String((v.ops && v.ops.carrier) || '').trim() || '(empty)';
      byCarrier[car] = (byCarrier[car] || 0) + 1;
      const stype = (v.raw && v.raw.salesType) || '(blank)';
      bySalesType[stype] = (bySalesType[stype] || 0) + 1;
    });
    res.json({
      at: new Date().toISOString(),
      total: list.length,
      byStatus: isCoordinator ? {} : byStatus,
      byEmployee: isCoordinator ? {} : byEmployee,
      byCarrier: isCoordinator ? {} : byCarrier,
      bySalesType,
      readOnly: isCoordinator,
      imports: store.data.meta.imports || {},
      rows: list.map((v) => publicVehicle(v, req.dtUser, { sheet: sheetView })),
    });
  });

  function uploadedFile(req) {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    let filename = String(req.headers['x-filename'] || 'upload.xlsx');
    try { filename = decodeURIComponent(filename); } catch (_) { /* keep raw */ }
    return { buf, filename };
  }

  /** New VINs from Sales Raw (Proforma Date = today) waiting for Hanouf to confirm. */
  function pendingMap() {
    if (!store.data.meta.pendingAssignments) store.data.meta.pendingAssignments = {};
    return store.data.meta.pendingAssignments;
  }

  function inventoryOwnerOf(rec) {
    if (!rec) return { id: '', name: '', at: '' };
    const src = rec.ops || rec;
    return {
      id: String(src.inventoryOwnerId || '').trim(),
      name: String(src.inventoryOwnerName || '').trim(),
      at: String(src.inventoryClaimedAt || '').trim(),
    };
  }

  function setInventoryOwner(rec, user, now, { label } = {}) {
    const src = rec.ops || rec;
    src.inventoryOwnerId = user ? (user.userId || user.id) : '';
    src.inventoryOwnerName = user ? user.name : '';
    src.inventoryClaimedAt = user ? now : '';
    if (!user) {
      src.inventoryLabel = '';
    } else if (label === 'display' || label === 'delivery') {
      src.inventoryLabel = label;
    } else if (!src.inventoryLabel) {
      src.inventoryLabel = 'delivery';
    }
    if (rec.ops) {
      rec.ops.updatedAt = now;
      rec.ops.updatedBy = user ? user.name : rec.ops.updatedBy;
    }
  }

  function copyPendingInventory(ops, vin) {
    const p = pendingMap()[vin];
    if (!p || !ops || !p.inventoryOwnerId) return;
    ops.inventoryOwnerId = p.inventoryOwnerId;
    ops.inventoryOwnerName = p.inventoryOwnerName || '';
    ops.inventoryClaimedAt = p.inventoryClaimedAt || '';
    ops.inventoryLabel = p.inventoryLabel || '';
    if (p.inventoryOwnerId === 'ruba' && ops.inventoryLabel === 'delivery' && !ops.guestCenter) {
      ops.guestCenter = 'Yes';
      ops.guestCenterAuto = 'ruba';
    }
  }

  function isRubaUser(user) {
    return !!user && (user.userId === 'ruba' || user.id === 'ruba');
  }

  /**
   * Ruba labels a Live Sheet VIN as Delivery → Guest Exp = Yes on the Live Sheet.
   * Switching to Display undoes it only when Guest Exp was set this way (never a manual value).
   */
  function syncGuestExpFromInventory(v, user, now, label) {
    if (!v || !v.ops || !isRubaUser(user)) return false;
    const ops = v.ops;
    const current = String(ops.guestCenter || '').trim();
    let next = current;
    if (label === 'delivery' && current !== 'Yes') {
      next = 'Yes';
      ops.guestCenterAuto = 'ruba';
    } else if (label === 'display' && ops.guestCenterAuto === 'ruba' && current === 'Yes') {
      next = '';
      ops.guestCenterAuto = '';
      ops.guestCollectAt = '';
      ops.guestCollectNote = '';
      ops.guestCollected = '';
    }
    if (next === current) return label === 'delivery' && current === 'Yes';
    ops.guestCenter = next;
    ops.updatedAt = now;
    ops.updatedBy = user.name;
    store.pushAudit({
      vin: v.vin,
      user: user.name,
      action: 'guest_exp_from_inventory',
      oldValue: current,
      newValue: next,
    });
    return next === 'Yes';
  }

  function inventoryLabelOf(rec) {
    const src = rec.ops || rec;
    const label = String(src.inventoryLabel || '').trim().toLowerCase();
    return label === 'display' || label === 'delivery' ? label : '';
  }

  function inventoryRow(vin, raw, owner, source, employee, label) {
    return {
      vin,
      product: String((raw && raw.product) || '').trim(),
      salesType: String((raw && raw.salesType) || '').trim(),
      customer: String((raw && (raw.userName || raw.customer)) || '').trim(),
      color: String((raw && raw.color) || '').trim(),
      proformaDate: String((raw && raw.proformaDate) || '').trim(),
      salesOrder: String((raw && raw.salesOrder) || '').trim(),
      employee: employee || '',
      source,
      stockOwnerId: owner.id,
      stockOwner: owner.name,
      claimedAt: owner.at,
      label: label || '',
    };
  }

  function buildInventoryPayload(viewer) {
    const byVin = new Map();
    Object.values(pendingMap()).forEach((p) => {
      if (!p || !p.vin) return;
      byVin.set(p.vin, inventoryRow(p.vin, p.raw, inventoryOwnerOf(p), 'raw', '', inventoryLabelOf(p)));
    });
    store.allVehicles().forEach((v) => {
      if (isCoordinatorPrinted(v)) return;
      byVin.set(v.vin, inventoryRow(
        v.vin,
        v.raw,
        inventoryOwnerOf(v),
        'live',
        (v.ops && v.ops.assignedEmployeeName) || '',
        inventoryLabelOf(v),
      ));
    });
    const pool = [...byVin.values()].sort((a, b) => String(a.vin).localeCompare(String(b.vin)));
    const me = viewer && viewer.userId;

    const releasedByUser = {};
    const claimedByUser = {};
    (store.data.audit || []).forEach((a) => {
      if (!a) return;
      const who = String(a.user || '').trim();
      if (!who) return;
      if (a.action === 'inventory_release') {
        releasedByUser[who] = (releasedByUser[who] || 0) + 1;
      }
      if (a.action === 'inventory_claim') {
        claimedByUser[who] = (claimedByUser[who] || 0) + 1;
      }
    });

    const users = USERS.filter((u) => u.canInventory).map((u) => {
      const stock = pool.filter((r) => r.stockOwnerId === u.id);
      return {
        id: u.id,
        name: u.name,
        stockIn: stock.length,
        stockOut: releasedByUser[u.name] || 0,
        claims: claimedByUser[u.name] || 0,
        display: stock.filter((r) => r.label === 'display').length,
        delivery: stock.filter((r) => r.label === 'delivery').length,
        stock,
      };
    });
    const stockIn = users.reduce((s, u) => s + u.stockIn, 0);
    const stockOut = users.reduce((s, u) => s + u.stockOut, 0);
    const displayRows = pool.filter((r) => r.label === 'display');
    const deliveryRows = pool.filter((r) => r.label === 'delivery');

    return {
      at: new Date().toISOString(),
      total: pool.length,
      unclaimed: pool.filter((r) => !r.stockOwnerId).length,
      mine: pool.filter((r) => r.stockOwnerId === me).length,
      stockIn,
      stockOut,
      display: displayRows.length,
      delivery: deliveryRows.length,
      displayRows,
      deliveryRows,
      pool,
      stock: pool.filter((r) => r.stockOwnerId === me),
      users,
    };
  }

  function selectedInventoryVins(req) {
    const raw = Array.isArray(req.body && req.body.vins)
      ? req.body.vins
      : [req.body && req.body.vin];
    return [...new Set(raw.map(normVin).filter(Boolean))];
  }

  function normalizeInventoryLabel(value, user) {
    const label = String(value || '').trim().toLowerCase();
    if (label === 'display' || label === 'delivery') return label;
    // Ruba must choose; others default to delivery
    if (user && (user.userId === 'ruba' || user.id === 'ruba')) return '';
    return 'delivery';
  }

  function applyInventoryClaim(vins, user, now, { release = false, label = '' } = {}) {
    const claimed = [];
    const missing = [];
    const blocked = [];
    const guestExp = [];
    const tag = release ? '' : normalizeInventoryLabel(label, user);
    if (!release && (user.userId === 'ruba' || user.id === 'ruba') && !tag) {
      return { claimed, missing, blocked, guestExp, error: 'Choose Display or Delivery' };
    }
    vins.forEach((vin) => {
      const v = store.getVehicle(vin);
      if (v) {
        if (isCoordinatorPrinted(v)) {
          blocked.push(vin);
          return;
        }
        if (!v.ops) v.ops = emptyOps();
        if (release && v.ops.inventoryOwnerId && v.ops.inventoryOwnerId !== user.userId) {
          blocked.push(vin);
          return;
        }
        const prevLabel = inventoryLabelOf(v);
        setInventoryOwner(v, release ? null : user, now, { label: tag });
        if (!release && syncGuestExpFromInventory(v, user, now, inventoryLabelOf(v))) guestExp.push(vin);
        store.upsertVehicle(vin, v);
        claimed.push(vin);
        store.pushAudit({
          vin,
          user: user.name,
          action: release ? 'inventory_release' : 'inventory_claim',
          oldValue: release ? `${user.name}${prevLabel ? ` · ${prevLabel}` : ''}` : '',
          newValue: release ? '' : `${user.name}${tag ? ` · ${tag}` : ''}`,
        });
        return;
      }
      const p = pendingMap()[vin];
      if (!p) {
        missing.push(vin);
        return;
      }
      if (release && p.inventoryOwnerId && p.inventoryOwnerId !== user.userId) {
        blocked.push(vin);
        return;
      }
      const prevLabel = inventoryLabelOf(p);
      setInventoryOwner(p, release ? null : user, now, { label: tag });
      claimed.push(vin);
      store.pushAudit({
        vin,
        user: user.name,
        action: release ? 'inventory_release' : 'inventory_claim',
        oldValue: release ? `${user.name}${prevLabel ? ` · ${prevLabel}` : ''}` : 'raw',
        newValue: release ? '' : `${user.name}${tag ? ` · ${tag}` : ''}`,
      });
    });
    return { claimed, missing, blocked, guestExp };
  }

  function applyInventoryLabel(vins, user, now, label) {
    const tag = String(label || '').trim().toLowerCase();
    if (tag !== 'display' && tag !== 'delivery') {
      return { updated: [], missing: [], blocked: [], error: 'Label must be display or delivery' };
    }
    if (user.userId !== 'ruba' && user.id !== 'ruba') {
      return { updated: [], missing: [], blocked: [], error: 'Only Ruba can set Display / Delivery' };
    }
    const updated = [];
    const missing = [];
    const blocked = [];
    const guestExp = [];
    vins.forEach((vin) => {
      const v = store.getVehicle(vin);
      if (v) {
        if (isCoordinatorPrinted(v)) {
          blocked.push(vin);
          return;
        }
        if (!v.ops) v.ops = emptyOps();
        if (v.ops.inventoryOwnerId !== user.userId) {
          blocked.push(vin);
          return;
        }
        const old = inventoryLabelOf(v) || '(none)';
        v.ops.inventoryLabel = tag;
        v.ops.updatedAt = now;
        v.ops.updatedBy = user.name;
        if (syncGuestExpFromInventory(v, user, now, tag)) guestExp.push(vin);
        store.upsertVehicle(vin, v);
        updated.push(vin);
        store.pushAudit({
          vin,
          user: user.name,
          action: 'inventory_label',
          oldValue: old,
          newValue: tag,
        });
        return;
      }
      const p = pendingMap()[vin];
      if (!p) {
        missing.push(vin);
        return;
      }
      if (p.inventoryOwnerId !== user.userId) {
        blocked.push(vin);
        return;
      }
      const old = inventoryLabelOf(p) || '(none)';
      p.inventoryLabel = tag;
      updated.push(vin);
      store.pushAudit({
        vin,
        user: user.name,
        action: 'inventory_label',
        oldValue: old,
        newValue: tag,
      });
    });
    return { updated, missing, blocked, guestExp };
  }

  /** meta.vacations: { employeeId: { until: 'YYYY-MM-DD' | '', by, at } } — empty until = until turned off. */
  function onVacation(empId) {
    const v = (store.data.meta.vacations || {})[empId];
    if (!v) return false;
    return !v.until || v.until >= todayKey();
  }

  function vacationList() {
    const all = store.data.meta.vacations || {};
    return USERS.filter(isAssignable).map((u) => ({
      id: u.id,
      name: u.name,
      onVacation: onVacation(u.id),
      until: onVacation(u.id) ? (all[u.id].until || '') : '',
    }));
  }

  function recordImport(kind, summary) {
    if (!store.data.meta.imports) store.data.meta.imports = {};
    store.data.meta.imports[kind] = summary;
  }

  /**
   * Hanouf uploads the delivery sheet.
   * Current month: every VIN. Last month: only فسح / الغاء / بطاقة / صادرة / مرور / رجوع مرور.
   * Older rows are skipped. Existing employee entries are never overwritten.
   */
  router.post(
    '/upload',
    express.raw({ limit: RAW_UPLOAD_LIMIT, type: '*/*' }),
    auth,
    requireRole('admin', 'hanouf'),
    (req, res) => {
      const { buf, filename } = uploadedFile(req);
      if (!buf || !buf.length) return res.status(400).json({ error: 'Upload an Excel file' });
      let parsed;
      try {
        parsed = parseDeliverySheet(buf);
      } catch (err) {
        return res.status(400).json({ error: `Could not read the file: ${err.message}` });
      }
      if (!parsed.items.length) {
        return res.status(400).json({ error: 'No VIN column / VIN rows found in this file' });
      }

      const month = currentMonthKey();
      const prevMonth = monthClose.previousMonthKey(month);
      const now = new Date().toISOString();
      const seen = new Set();
      const summary = {
        at: now,
        by: req.dtUser.name,
        filename,
        sheet: parsed.sheet,
        month,
        previousMonth: prevMonth,
        rows: parsed.items.length,
        created: 0,
        updated: 0,
        assigned: 0,
        skippedVacation: 0,
        skippedOtherMonth: 0,
        skippedLastMonthStatus: 0,
        keptLastMonth: 0,
        skippedNoDate: 0,
        updatedOtherMonth: 0,
        duplicates: 0,
      };

      parsed.items.forEach((item) => {
        if (seen.has(item.vin)) {
          summary.duplicates += 1;
          return;
        }
        seen.add(item.vin);
        const proforma = item.raw.proformaDate || item.raw.date || '';
        const rowMonth = proforma.slice(0, 7);
        const status = String((item.ops && item.ops.opsStatus) || '').trim();
        const isCurrent = !!proforma && rowMonth === month;
        const isLastMonth = !!proforma && rowMonth === prevMonth;
        const takeLastMonth = isLastMonth && LAST_MONTH_UPLOAD_STATUSES.includes(status);
        let v = store.getVehicle(item.vin);
        if (!isCurrent && !takeLastMonth) {
          if (v && !isLastMonth) {
            // Already on the Live Sheet from an older month: refresh non-blank details, never clear or reassign.
            if (!v.raw) v.raw = emptyRaw();
            let changed = false;
            Object.entries(item.raw).forEach(([k, val]) => {
              if (!val || String(v.raw[k] ?? '') === String(val)) return;
              v.raw[k] = val;
              changed = true;
            });
            if (changed) {
              v.rawUpdatedAt = now;
              store.upsertVehicle(item.vin, v);
              summary.updated += 1;
              summary.updatedOtherMonth += 1;
            }
            return;
          }
          if (!proforma) {
            summary.skippedNoDate += 1;
            return;
          }
          if (isLastMonth) {
            summary.skippedLastMonthStatus += 1;
            return;
          }
          summary.skippedOtherMonth += 1;
          return;
        }

        const isNew = !v;
        if (isNew) {
          const p = pendingMap()[item.vin];
          v = { vin: item.vin, raw: { ...emptyRaw(), ...((p && p.raw) || {}), vin: item.vin }, ops: { ...emptyOps() } };
          copyPendingInventory(v.ops, item.vin);
        }
        const fromLiveExtract = /live\s*sheet/i.test(String(parsed.sheet || ''));
        Object.entries(item.raw).forEach(([k, val]) => {
          if (!val) return;
          if (fromLiveExtract && String(v.raw[k] || '').trim()) return;
          v.raw[k] = val;
        });
        if (!v.raw.proformaDate) v.raw.proformaDate = proforma;
        Object.entries(item.ops).forEach(([k, val]) => {
          if (k === 'carrier') {
            const next = String(val || '').trim();
            if (fromLiveExtract && next && String(v.ops.carrier || '').trim() !== next) {
              v.ops.carrier = next;
              v.ops.carrierChangedFrom = '';
              v.ops.carrierChangedBy = '';
              v.ops.carrierChangedAt = '';
            }
            return;
          }
          if (val && !String(v.ops[k] || '').trim()) v.ops[k] = val;
        });
        if (v.ops.opsStatus) scheduleEngine.recordStatusEnter(v.ops, v.ops.opsStatus, now);
        const emp = findEmployeeByPic(item.raw.pic);
        if (emp && !v.ops.assignedEmployeeId && onVacation(emp.id)) summary.skippedVacation += 1;
        else if (emp && !v.ops.assignedEmployeeId) {
          v.ops.assignedEmployeeId = emp.id;
          v.ops.assignedEmployeeName = emp.name;
          v.ops.assignedBy = req.dtUser.name;
          v.ops.assignedAt = now;
          summary.assigned += 1;
        }
        v.ops.updatedAt = now;
        v.ops.updatedBy = req.dtUser.name;
        store.upsertVehicle(item.vin, v);
        if (isNew) summary.created += 1;
        else summary.updated += 1;
        if (takeLastMonth) summary.keptLastMonth += 1;
      });

      recordImport('lastUpload', summary);
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'upload_vins',
        oldValue: filename,
        newValue: `${month}: ${summary.created} new · ${summary.updated} updated · last month kept ${summary.keptLastMonth} · last month other status ${summary.skippedLastMonthStatus} · older skipped ${summary.skippedOtherMonth}`,
      });
      store.save();
      return res.json({ ok: true, summary });
    }
  );

  /**
   * Hanouf uploads Sales Raw — refreshes vehicle details on every matching VIN
   * (all months), so every user sees the same data.
   */
  router.post(
    '/sales-raw',
    express.raw({ limit: RAW_UPLOAD_LIMIT, type: '*/*' }),
    auth,
    (req, res, next) => (canUploadSalesRaw(req.dtUser)
      ? next()
      : res.status(403).json({ error: 'Forbidden for this role' })),
    (req, res) => {
      const { buf, filename } = uploadedFile(req);
      if (!buf || !buf.length) return res.status(400).json({ error: 'Upload an Excel file' });
      let parsed;
      try {
        parsed = parseSalesRaw(buf);
      } catch (err) {
        return res.status(400).json({ error: `Could not read the file: ${err.message}` });
      }
      if (!parsed.items.length) {
        return res.status(400).json({ error: 'No VIN rows found in this Sales Raw file' });
      }

      const now = new Date().toISOString();
      const summary = {
        at: now,
        by: req.dtUser.name,
        filename,
        sheet: parsed.sheet,
        layout: parsed.layout,
        rows: parsed.items.length,
        matched: 0,
        updated: 0,
        notOnSheet: 0,
        today: todayKey(),
        todayNew: 0,
        todayOnSystem: 0,
        assignable: 0,
        skippedNoProforma: 0,
        skippedInvoiced: 0,
        skippedOnSystem: 0,
        duplicates: parsed.duplicates || 0,
        removedCancel: 0,
      };
      const pending = pendingMap();
      const rawVins = new Set(parsed.items.map((item) => item.vin));
      parsed.items.forEach((item) => {
        const v = store.getVehicle(item.vin);
        const hasProforma = !!String((item.raw && item.raw.proformaDate) || '').trim();
        const hasInvoice = !!String((item.raw && item.raw.invoiceDate) || '').trim();
        const canAssign = hasProforma && !hasInvoice;
        const isToday = item.raw.proformaDate === summary.today;
        if (!v) {
          summary.notOnSheet += 1;
          if (!hasProforma) summary.skippedNoProforma += 1;
          else if (hasInvoice) summary.skippedInvoiced += 1;
          else {
            summary.assignable += 1;
            if (isToday) summary.todayNew += 1;
            const prev = pending[item.vin] || {};
            const raw = { ...emptyRaw(), ...(prev.raw || {}) };
            Object.entries(item.raw).forEach(([k, val]) => {
              if (val !== '' && val != null) raw[k] = val;
            });
            raw.vin = item.vin;
            pending[item.vin] = {
              ...prev,
              vin: item.vin,
              raw,
              uploadedBy: req.dtUser.name,
              uploadedAt: now,
              firstUploadedAt: prev.firstUploadedAt || prev.uploadedAt || now,
              filename,
              inventoryOwnerId: prev.inventoryOwnerId || '',
              inventoryOwnerName: prev.inventoryOwnerName || '',
              inventoryClaimedAt: prev.inventoryClaimedAt || '',
            };
          }
          return;
        }
        if (canAssign) summary.skippedOnSystem += 1;
        if (isToday) summary.todayOnSystem += 1;
        summary.matched += 1;
        let changed = false;
        Object.entries(item.raw).forEach(([k, val]) => {
          if (val === '' || val == null) return;
          if (String(v.raw[k] ?? '') !== String(val)) {
            v.raw[k] = val;
            changed = true;
          }
        });
        if (changed) {
          v.rawUpdatedAt = now;
          store.upsertVehicle(item.vin, v);
          summary.updated += 1;
        }
      });

      store.allVehicles().forEach((v) => {
        const status = String((v.ops && v.ops.opsStatus) || '').trim();
        if (status !== 'الغاء' || rawVins.has(v.vin)) return;
        store.deleteVehicle(v.vin);
        summary.removedCancel += 1;
      });

      recordImport('lastSalesRaw', summary);
      if (companyPerformance.isHanoufUser(req.dtUser)) {
        companyPerformance.recordHanoufSalesRaw(store, parsed.items, {
          at: now,
          filename,
        });
        summary.hanoufSalesIndexed = true;
      } else {
        summary.hanoufSalesIndexed = false;
      }
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'upload_sales_raw',
        oldValue: filename,
        newValue: `${summary.matched} matched · ${summary.updated} updated · ${summary.assignable} to Assignment (P filled · V empty) · الغاء removed ${summary.removedCancel}`,
      });
      store.save();
      summary.pendingTotal = Object.keys(pending).length;
      return res.json({ ok: true, summary });
    }
  );

  router.get('/appointments', auth, (req, res) => {
    if (!canManageAppointments(req.dtUser)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const now = Date.now();
    const rows = store.allVehicles()
      .filter((v) => isGuestYes(v))
      .map((v) => publicVehicle(v, req.dtUser))
      .sort((a, b) => {
        const rawA = String((a.ops && a.ops.guestCollectAt) || '').trim();
        const rawB = String((b.ops && b.ops.guestCollectAt) || '').trim();
        if (!rawA && rawB) return -1;
        if (rawA && !rawB) return 1;
        return (Date.parse(rawA) || 0) - (Date.parse(rawB) || 0);
      });
    const open = rows.filter((r) => !String((r.ops && r.ops.guestCollectAt) || '').trim()).length;
    const due = rows.filter((r) => {
      const at = Date.parse((r.ops && r.ops.guestCollectAt) || '');
      return at && at <= now && String((r.ops && r.ops.guestCollected) || '') !== 'Yes';
    }).length;
    return res.json({ rows, open, due, total: rows.length });
  });

  router.post('/vehicles/:vin/appointment', auth, (req, res) => {
    if (!canManageAppointments(req.dtUser)) {
      return res.status(403).json({ error: 'Only Ruba can set appointments' });
    }
    const v = store.getVehicle(req.params.vin);
    if (!v) return res.status(404).json({ error: 'VIN not found' });
    if (!v.ops) v.ops = emptyOps();
    if (!isGuestYes(v)) {
      return res.status(400).json({ error: 'Guest Exp must be Yes before setting an appointment' });
    }
    try {
      const at = parseAppointmentDateTime(req.body && req.body.date, req.body && req.body.time);
      const old = v.ops.guestCollectAt || '';
      v.ops.guestCollectAt = at;
      v.ops.guestCollected = '';
      v.ops.guestCollectNote = String((req.body && req.body.note) || '').trim();
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(v.vin, v);
      store.pushAudit({
        vin: v.vin,
        user: req.dtUser.name,
        action: old ? 'appointment_reschedule' : 'appointment_set',
        oldValue: old || '(empty)',
        newValue: at,
      });
      store.save();
      return res.json({ ok: true, vehicle: publicVehicle(v, req.dtUser) });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Could not save appointment' });
    }
  });

  router.get('/vehicles/:vin', auth, (req, res) => {
    const v = store.getVehicle(req.params.vin);
    if (!v) return res.status(404).json({ error: 'VIN not found' });
    if (req.dtUser.role === 'coordinator' && isCoordinatorPrinted(v)) {
      return res.status(404).json({ error: 'VIN already printed' });
    }
    return res.json({ vehicle: publicVehicle(v, req.dtUser) });
  });

  /** Admin overview — all details */
  router.get('/admin/overview', auth, requireRole('admin'), (req, res) => {
    const list = store.allVehicles();
    res.json({
      at: new Date().toISOString(),
      total: list.length,
      audit: (store.data.audit || []).slice(0, 100),
      meta: store.data.meta,
      vehicles: list.map((v) => publicVehicle(v, req.dtUser)),
    });
  });

  router.get('/backup', auth, requireRole('admin'), (_req, res) => {
    return res.json(store.backupStatus());
  });

  router.post('/backup', auth, requireRole('admin'), (req, res) => {
    const status = store.writeBackup('manual');
    store.pushAudit({
      user: req.dtUser.name,
      action: 'save_backup',
      oldValue: '',
      newValue: status.lastAt || 'now',
    });
    store.save();
    return res.json({ ok: true, ...status });
  });

  router.post('/backup/restore', auth, requireRole('admin'), (req, res) => {
    try {
      const status = store.restoreLastBackup(req.dtUser.name);
      return res.json({ ok: true, ...status });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Could not restore' });
    }
  });

  router.get('/admin/dashboard', auth, requireRole('admin'), (_req, res) => {
    const attendance = attendanceRows();
    const vehicles = store.allVehicles();
    const printed = vehicles.filter((v) => (
      isCoordinatorPrinted(v) && v.ops && String(v.ops.coordinatorPrintKind || '') !== 'warehouse'
    ));
    const warehouse = vehicles.filter((v) => (
      isCoordinatorPrinted(v) && v.ops && String(v.ops.coordinatorPrintKind || '') === 'warehouse'
    ));

    const names = new Set(allCarriers());
    attendance.forEach((e) => { if (e.company) names.add(e.company); });
    printed.forEach((v) => {
      const company = String((v.ops && v.ops.coordinatorPrintCompany) || '').trim();
      if (company) names.add(company);
    });

    const companies = [...names].map((company) => {
      const people = attendance.filter((e) => e.company === company).map((e) => ({
        id: e.id,
        name: e.name,
        phone: e.phone,
        arrivedAt: e.at || '',
        leftAt: e.leftAt || e.usedAt || '',
        status: (e.leftAt || e.usedAt) ? 'left' : 'present',
        vins: Array.isArray(e.usedVins) ? e.usedVins : [],
        city: e.usedCity || '',
        usedBy: e.usedBy || '',
      }));
      const vins = printed
        .filter((v) => String((v.ops && v.ops.coordinatorPrintCompany) || '') === company)
        .map((v) => ({
          vin: v.vin,
          product: (v.raw && v.raw.product) || '',
          customer: (v.raw && v.raw.userName) || '',
          city: (v.ops && (v.ops.coordinatorPrintCity || v.ops.transferCity)) || '',
          printedAt: (v.ops && v.ops.coordinatorPrintedAt) || '',
          printedBy: (v.ops && v.ops.coordinatorPrintedBy) || '',
          invoice: (v.ops && v.ops.coordinatorPrintInvoice) || '',
          status: (v.ops && v.ops.opsStatus) || '',
          proformaDate: (v.raw && v.raw.proformaDate) || '',
          invoiceDate: (v.raw && v.raw.invoiceDate) || '',
        }));
      return {
        company,
        present: people.filter((p) => p.status === 'present').length,
        arrived: people.length,
        left: people.filter((p) => p.status === 'left').length,
        notes: vins.length,
        lastAt: people.reduce((max, p) => Math.max(max, Date.parse(p.arrivedAt) || 0), 0),
        people,
        vins,
      };
    }).sort((a, b) => (b.present - a.present) || (b.notes - a.notes) || a.company.localeCompare(b.company, 'ar'));

    const coordinators = USERS
      .filter((u) => u.role === 'coordinator')
      .map((u) => {
        const notes = vehicles.filter((v) => isCoordinatorPrinted(v) && v.ops
          && (v.ops.coordinatorPrintedBy === u.name || v.ops.coordinatorPrintedBy === u.id)).length;
        return { id: u.id, name: u.name, role: u.role, notes };
      })
      .filter((u) => u.role === 'coordinator' || u.notes > 0);

    // Each printed delivery note is frozen. Later Live Sheet / Sales Raw updates do not rewrite it.
    const noteRows = [];
    const loggedVins = new Set();
    (store.data.prints || []).forEach((p) => {
      if (!p || p.kind === 'warehouse') return;
      const company = String(p.company || (p.snapshot && p.snapshot.company_rep) || '').trim() || '(blank)';
      const city = String(p.city || (p.snapshot && p.snapshot.branch_to) || '').trim() || '—';
      const cars = (p.snapshot && Array.isArray(p.snapshot.cars)) ? p.snapshot.cars : [];
      (Array.isArray(p.vins) ? p.vins : []).forEach((row) => {
        const vin = String((row && row.vin) || '').trim();
        if (!vin) return;
        loggedVins.add(normVin(vin));
        const snap = cars.find((c) => normVin(c && c.chassis) === normVin(vin));
        const vehicle = store.getVehicle(vin);
        noteRows.push({
          company,
          city,
          vin,
          product: (snap && String(snap.model || '').trim()) || (row && row.product) || '',
          customer: (row && row.customer) || (p.snapshot && p.snapshot.customer_name) || '',
          remarks: (snap && String(snap.remarks || '').trim()) || (row && row.remarks) || '',
          printedAt: p.at || '',
          printedBy: p.printedBy || '',
          invoice: p.invoiceNumber || '',
          status: (vehicle && vehicle.ops && vehicle.ops.opsStatus) || '',
          proformaDate: (vehicle && vehicle.raw && vehicle.raw.proformaDate) || '',
          invoiceDate: (vehicle && vehicle.raw && vehicle.raw.invoiceDate) || '',
        });
      });
    });
    printed.forEach((v) => {
      if (loggedVins.has(normVin(v.vin))) return;
      noteRows.push({
        company: String((v.ops && v.ops.coordinatorPrintCompany) || '').trim() || '(blank)',
        city: String((v.ops && (v.ops.coordinatorPrintCity || v.ops.transferCity)) || '').trim() || '—',
        vin: v.vin,
        product: (v.raw && v.raw.product) || '',
        customer: (v.raw && v.raw.userName) || '',
        remarks: (v.ops && v.ops.notes) || '',
        printedAt: (v.ops && v.ops.coordinatorPrintedAt) || '',
        printedBy: (v.ops && v.ops.coordinatorPrintedBy) || '',
        invoice: (v.ops && v.ops.coordinatorPrintInvoice) || '',
        status: (v.ops && v.ops.opsStatus) || '',
        proformaDate: (v.raw && v.raw.proformaDate) || '',
        invoiceDate: (v.raw && v.raw.invoiceDate) || '',
      });
    });

    const cityGroups = new Map();
    noteRows.forEach((row) => {
      if (!cityGroups.has(row.company)) cityGroups.set(row.company, new Map());
      const byCity = cityGroups.get(row.company);
      if (!byCity.has(row.city)) byCity.set(row.city, { city: row.city, count: 0, vins: [] });
      const g = byCity.get(row.city);
      g.count += 1;
      g.vins.push(row);
    });
    const companyCities = [...cityGroups.entries()].map(([company, byCity]) => {
      const cities = [...byCity.values()].sort((a, b) => b.count - a.count);
      return {
        company,
        total: cities.reduce((n, c) => n + c.count, 0),
        cities,
      };
    }).filter((c) => c.total > 0)
      .sort((a, b) => (b.total - a.total) || a.company.localeCompare(b.company, 'ar'));

    // الناقل × مدينة schedule from the saved delivery notes, not the live VIN
    const pivotMap = new Map(); // company -> city -> vins[]
    const citySet = new Set();
    noteRows.forEach((row) => {
      const company = row.company || '(blank)';
      const city = row.city || '—';
      citySet.add(city);
      if (!pivotMap.has(company)) pivotMap.set(company, new Map());
      const cities = pivotMap.get(company);
      if (!cities.has(city)) cities.set(city, []);
      cities.get(city).push(row);
    });
    const pivotCities = [...citySet].sort((a, b) => a.localeCompare(b, 'ar'));
    const carrierPivot = {
      total: printed.length,
      cities: pivotCities,
      rows: [...pivotMap.entries()]
        .map(([company, cities]) => {
          const cells = {};
          let total = 0;
          pivotCities.forEach((city) => {
            const vins = cities.get(city) || [];
            if (vins.length) {
              cells[city] = { count: vins.length, vins };
              total += vins.length;
            }
          });
          return { company, total, cells };
        })
        .sort((a, b) => (b.total - a.total) || a.company.localeCompare(b.company, 'ar')),
    };
    const cityTotals = {};
    pivotCities.forEach((city) => {
      cityTotals[city] = carrierPivot.rows.reduce((s, r) => s + ((r.cells[city] && r.cells[city].count) || 0), 0);
    });
    carrierPivot.cityTotals = cityTotals;

    // Everything captured per الناقل: waiting on the Live Sheet, printed memos, coordinator changes, display / internal memos.
    const NO_COMPANY = '(بدون شركة)';
    const statMap = new Map();
    const stat = (company) => {
      const key = String(company || '').trim() || NO_COMPANY;
      if (!statMap.has(key)) {
        statMap.set(key, {
          company: key, total: 0, waiting: 0, printed: 0, changedIn: 0, changedOut: 0, display: 0, internal: 0, vins: [],
        });
      }
      return statMap.get(key);
    };
    allCarriers().forEach((c) => stat(c));
    const vinRow = (v, status) => {
      const ops = v.ops || {};
      return {
        vin: v.vin,
        status,
        product: (v.raw && v.raw.product) || '',
        customer: (v.raw && v.raw.userName) || '',
        city: String(ops.coordinatorPrintCity || ops.transferCity || '').trim(),
        carrier: String(ops.carrier || '').trim(),
        changedFrom: String(ops.carrierChangedFrom || '').trim(),
        changedBy: ops.carrierChangedBy || '',
        changedAt: ops.carrierChangedAt || '',
        printedAt: ops.coordinatorPrintedAt || '',
        printedBy: ops.coordinatorPrintedBy || '',
        invoice: ops.coordinatorPrintInvoice || '',
        label: ops.coordinatorPrintLabel || '',
      };
    };
    vehicles.forEach((v) => {
      const ops = v.ops || {};
      const kind = String(ops.coordinatorPrintKind || '');
      const isPrinted = isCoordinatorPrinted(v);
      if (isPrinted && (kind === 'warehouse' || kind === 'display')) return;
      const carrier = String(ops.carrier || '').trim();
      const from = String(ops.carrierChangedFrom || '').trim();
      if (isPrinted) {
        const s = stat(ops.coordinatorPrintCompany || carrier);
        s.printed += 1;
        if (from) s.changedIn += 1;
        s.vins.push(vinRow(v, 'printed'));
      } else if (carrier) {
        const s = stat(carrier);
        s.waiting += 1;
        if (from) s.changedIn += 1;
        s.vins.push(vinRow(v, 'waiting'));
      }
      if (from) {
        const out = stat(from);
        out.changedOut += 1;
        out.vins.push(vinRow(v, 'changed_out'));
      }
    });
    (store.data.prints || []).forEach((p) => {
      if (!p || p.kind !== 'display') return;
      const s = stat(p.company);
      const internal = p.label === 'داخلي';
      (p.vins || []).forEach((x) => {
        if (internal) s.internal += 1;
        else s.display += 1;
        s.vins.push({
          vin: x.vin,
          status: internal ? 'internal' : 'display',
          product: x.product || '',
          customer: x.customer || '',
          city: p.city || '',
          carrier: p.company || '',
          changedFrom: '',
          printedAt: p.at || '',
          printedBy: p.printedBy || '',
          invoice: p.invoiceNumber || '',
          label: p.label || '',
        });
      });
    });
    const carrierStats = [...statMap.values()]
      .map((s) => ({ ...s, total: s.waiting + s.printed + s.display + s.internal }))
      .filter((s) => s.total > 0 || s.changedOut > 0)
      .sort((a, b) => (b.total - a.total) || a.company.localeCompare(b.company, 'ar'));

    return res.json({
      at: new Date().toISOString(),
      present: companies.reduce((n, c) => n + c.present, 0),
      free: companies.reduce((n, c) => n + c.present, 0),
      left: companies.reduce((n, c) => n + c.left, 0),
      notes: printed.length + warehouse.length,
      memos: printed.length,
      warehouse: warehouse.length,
      companies: companies.map((c) => ({ ...c, free: c.present })),
      coordinators,
      companyCities,
      carrierPivot,
      carrierStats,
      prints: store.data.prints || [],
      carriers: allCarriers(),
      cities: allCities(),
    });
  });

  router.post('/admin/lists', auth, requireRole('admin'), (req, res) => {
    const type = String((req.body && req.body.type) || '').trim();
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Enter a name' });
    if (type !== 'company' && type !== 'city') {
      return res.status(400).json({ error: 'type must be company or city' });
    }
    if (!store.data.meta || typeof store.data.meta !== 'object') store.data.meta = {};
    if (type === 'company') {
      if (allCarriers().includes(name)) {
        return res.status(409).json({ error: 'Company already in the list' });
      }
      if (!Array.isArray(store.data.meta.customCarriers)) store.data.meta.customCarriers = [];
      store.data.meta.customCarriers.push(name);
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'add_company',
        oldValue: '',
        newValue: name,
      });
    } else {
      if (allCities().includes(name)) {
        return res.status(409).json({ error: 'City already in the list' });
      }
      if (!Array.isArray(store.data.meta.customCities)) store.data.meta.customCities = [];
      store.data.meta.customCities.push(name);
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'add_city',
        oldValue: '',
        newValue: name,
      });
    }
    store.save();
    return res.json({ ok: true, carriers: allCarriers(), cities: allCities() });
  });

  router.post('/vehicles', auth, requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const vin = normVin(body.vin);
    if (!vin || vin.length < 8) {
      return res.status(400).json({ error: 'Valid VIN required' });
    }
    if (store.getVehicle(vin)) {
      return res.status(409).json({ error: 'VIN already exists' });
    }
    const empId = String(body.assignedEmployeeId || '').trim().toLowerCase();
    const emp = findAssignable(empId);
    const now = new Date().toISOString();
    const vehicle = {
      vin,
      raw: {
        ...emptyRaw(),
        vin,
        product: String(body.product || '').trim(),
        salesType: String(body.salesType || '').trim(),
        salesOrder: String(body.salesOrder || '').trim(),
        salesAdvisor: String(body.salesAdvisor || '').trim(),
        userName: String(body.userName || body.customer || '').trim(),
        phone: String(body.phone || '').trim(),
        gtLocation: String(body.gtLocation || '').trim(),
        vehicleLocation: String(body.vehicleLocation || '').trim(),
        invoiceOwner: String(body.invoiceOwner || '').trim(),
        proformaDate: String(body.proformaDate || '').trim() || now.slice(0, 10),
        date: now.slice(0, 10),
        pic: emp ? emp.name : '',
      },
      ops: {
        ...emptyOps(),
        opsStatus: String(body.opsStatus || '').trim(),
        carrier: '',
        transferCity: String(body.transferCity || '').trim(),
        notes: String(body.notes || '').trim(),
        assignedEmployeeId: emp ? emp.id : '',
        assignedEmployeeName: emp ? emp.name : '',
        assignedBy: req.dtUser.name,
        assignedAt: emp ? now : '',
        updatedAt: now,
        updatedBy: req.dtUser.name,
        statusHistory: [],
      },
    };
    copyPendingInventory(vehicle.ops, vin);
    if (vehicle.ops.opsStatus) {
      scheduleEngine.recordStatusEnter(vehicle.ops, vehicle.ops.opsStatus, now);
    }
    store.upsertVehicle(vin, vehicle);
    store.pushAudit({
      vin,
      user: req.dtUser.name,
      action: 'create_vin',
      oldValue: '',
      newValue: vin,
    });
    store.save();
    return res.json({ ok: true, vehicle: publicVehicle(vehicle, req.dtUser) });
  });

  router.patch('/vehicles/:vin', auth, (req, res) => {
    if (req.dtUser.role === 'coordinator') {
      return res.status(403).json({
        error: 'Coordinator can view Live Sheet VINs only — no employee entry edits',
      });
    }
    if (!isManager(req.dtUser.role) && req.dtUser.role !== 'employee') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const key = normVin(req.params.vin);
    const v = store.getVehicle(key);
    if (!v) return res.status(404).json({ error: 'VIN not found' });
    if (!canEditVehicle(v, req.dtUser)) {
      return res.status(403).json({ error: 'You can only edit VINs assigned to you' });
    }
    if (!v.ops) v.ops = emptyOps();
    if (!v.raw) v.raw = emptyRaw();

    const body = req.body || {};
    const changes = [];
    let nextCarrier = null;
    if (Object.prototype.hasOwnProperty.call(body, 'carrier')) {
      if (!canAssignCarrier(req.dtUser)) {
        return res.status(403).json({ error: 'Only Hanouf and Rasha can assign الناقل' });
      }
      nextCarrier = String(body.carrier || '').trim();
      if (nextCarrier && !allCarriers().includes(nextCarrier)) {
        return res.status(400).json({ error: `Unknown الناقل: ${nextCarrier}` });
      }
    }

    const setOps = (field, next) => {
      const oldVal = v.ops[field] == null ? '' : String(v.ops[field]);
      let newVal = next == null ? '' : String(next);
      // A blank submit must not wipe a value that was already saved. Changing this
      // field to a new value does not touch any other field.
      if (!newVal.trim() && oldVal.trim()) newVal = oldVal;
      if (oldVal === newVal) return;
      v.ops[field] = newVal;
      changes.push({ field, oldVal, newVal });
    };

    if (Object.prototype.hasOwnProperty.call(body, 'opsStatus')) {
      let s = String(body.opsStatus || '').trim();
      const prevStatus = String(v.ops.opsStatus || '').trim();
      if (!s && prevStatus) s = prevStatus;
      if (s && !STATUSES.includes(s)) {
        return res.status(400).json({ error: `Invalid status: ${s}` });
      }
      const nowIso = new Date().toISOString();
      setOps('opsStatus', s);
      if (s && s !== prevStatus) {
        scheduleEngine.recordStatusTransition(v.ops, prevStatus, s, nowIso, req.dtUser.name);
      }
    }
    for (const f of [
      'guestSentDate', 'signatureReceivedDate', 'accountsSentDate',
      'accountsApprovalDate', 'registrationIssueDate', 'transferCity',
      'notes',
    ]) {
      if (Object.prototype.hasOwnProperty.call(body, f)) setOps(f, body[f]);
    }
    if (nextCarrier !== null) {
      const existingCarrier = String(v.ops.carrier || '').trim();
      // A blank submit must not wipe الناقل — Hanouf assigns once, then reassigns on purpose.
      if (!nextCarrier && existingCarrier) nextCarrier = existingCarrier;
      const before = changes.length;
      setOps('carrier', nextCarrier);
      if (changes.length > before) {
        v.ops.carrierChangedFrom = '';
        v.ops.carrierChangedBy = '';
        v.ops.carrierChangedAt = '';
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'guestCenter')) {
      const s = String(body.guestCenter || '').trim();
      if (s && !YES_NO.includes(s)) {
        return res.status(400).json({ error: 'Guest Exp must be Yes/No' });
      }
      setOps('guestCenter', s);
      v.ops.guestCenterAuto = '';
    }
    for (const f of ['vin1502', 'trafficFile', 'trafficFeesOps', 'insuranceOps']) {
      if (Object.prototype.hasOwnProperty.call(body, f)) {
        const s = String(body[f] || '').trim();
        if (s && !YES_NO.includes(s)) {
          return res.status(400).json({ error: `${f} must be Yes/No` });
        }
        setOps(f, s);
      }
    }

    if (req.dtUser.role === 'admin') {
      if (Object.prototype.hasOwnProperty.call(body, 'assignedEmployeeId')) {
        const empId = String(body.assignedEmployeeId || '').trim().toLowerCase();
        const emp = empId ? findAssignable(empId) : null;
        const old = v.ops.assignedEmployeeName || '';
        v.ops.assignedEmployeeId = emp ? emp.id : '';
        v.ops.assignedEmployeeName = emp ? emp.name : '';
        v.ops.assignedBy = emp ? req.dtUser.name : '';
        v.ops.assignedAt = emp ? (v.ops.assignedAt || new Date().toISOString()) : '';
        if (old !== (v.ops.assignedEmployeeName || '')) {
          changes.push({
            field: 'assignedEmployee',
            oldVal: old || '(unassigned)',
            newVal: v.ops.assignedEmployeeName || '(unassigned)',
          });
        }
      }
      for (const f of [
        'product', 'salesType', 'salesOrder', 'salesAdvisor', 'userName',
        'phone', 'gtLocation', 'vehicleLocation', 'invoiceOwner', 'proformaDate',
      ]) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          const oldVal = v.raw[f] == null ? '' : String(v.raw[f]);
          const newVal = String(body[f] == null ? '' : body[f]).trim();
          if (oldVal !== newVal) {
            v.raw[f] = newVal;
            changes.push({ field: `raw.${f}`, oldVal, newVal });
          }
        }
      }
    }

    if (!changes.length) {
      return res.json({
        ok: true,
        saved: false,
        vehicle: publicVehicle(v, req.dtUser),
      });
    }

    v.ops.updatedBy = req.dtUser.name;
    v.ops.updatedAt = new Date().toISOString();
    store.upsertVehicle(key, v);
    changes.forEach((c) => {
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: 'update',
        oldValue: `${c.field}: ${c.oldVal || '(empty)'}`,
        newValue: `${c.field}: ${c.newVal || '(empty)'}`,
      });
    });
    store.save();
    return res.json({
      ok: true,
      saved: true,
      vehicle: publicVehicle(v, req.dtUser),
      lastUpdated: v.ops.updatedAt,
    });
  });

  router.post('/reassign', auth, requireRole('admin', 'hanouf', 'employee'), (req, res) => {
    const body = req.body || {};
    const vins = Array.isArray(body.vins) ? body.vins.map(normVin).filter(Boolean) : [];
    const target = String(body.employee || '').trim().toLowerCase();
    const emp = findAssignable(target);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    if (!emp) return res.status(400).json({ error: 'Unknown employee' });
    if (onVacation(emp.id)) return res.status(400).json({ error: `${emp.name} is on vacation` });
    const now = new Date().toISOString();
    const results = vins.map((vin) => {
      const v = store.getVehicle(vin);
      if (!v) return { vin, ok: false, error: 'VIN not found' };
      if (v.ops.assignedEmployeeId === emp.id) return { vin, ok: false, error: 'Already assigned' };
      const old = v.ops.assignedEmployeeName || '';
      v.ops.assignedEmployeeId = emp.id;
      v.ops.assignedEmployeeName = emp.name;
      v.ops.assignedBy = req.dtUser.name;
      v.ops.assignedAt = now;
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = now;
      store.upsertVehicle(vin, v);
      store.pushAudit({
        vin,
        user: req.dtUser.name,
        action: 'reassign',
        oldValue: old || '(unassigned)',
        newValue: emp.name,
      });
      return { vin, ok: true };
    });
    store.save();
    return res.json({ ok: true, results });
  });

  function selectedVins(req) {
    const body = req.body || {};
    return Array.isArray(body.vins) ? [...new Set(body.vins.map(normVin).filter(Boolean))] : [];
  }

  /** Unassign selected VINs (they stay on the Live Sheet with no employee). */
  router.post('/unassign', auth, requireRole('admin', 'hanouf', 'employee'), (req, res) => {
    const vins = selectedVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const now = new Date().toISOString();
    const results = vins.map((vin) => {
      const v = store.getVehicle(vin);
      if (!v) return { vin, ok: false, error: 'VIN not found' };
      const old = v.ops.assignedEmployeeName || '';
      if (!v.ops.assignedEmployeeId) return { vin, ok: false, error: 'Not assigned' };
      v.ops.assignedEmployeeId = '';
      v.ops.assignedEmployeeName = '';
      v.ops.assignedBy = req.dtUser.name;
      v.ops.assignedAt = now;
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = now;
      store.upsertVehicle(vin, v);
      store.pushAudit({
        vin, user: req.dtUser.name, action: 'unassign', oldValue: old, newValue: '(unassigned)',
      });
      return { vin, ok: true };
    });
    store.save();
    return res.json({ ok: true, results });
  });

  /** Remove selected VINs from the Live Sheet; a full snapshot is kept in the audit log. */
  router.post('/remove', auth, requireRole('admin', 'hanouf', 'employee'), (req, res) => {
    const vins = selectedVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const results = vins.map((vin) => {
      const v = store.getVehicle(vin);
      if (!v) return { vin, ok: false, error: 'VIN not found' };
      store.deleteVehicle(vin);
      store.pushAudit({
        vin, user: req.dtUser.name, action: 'remove_vin', oldValue: JSON.stringify(v), newValue: '',
      });
      return { vin, ok: true };
    });
    store.save();
    return res.json({ ok: true, results });
  });

  router.delete('/vehicles/:vin', auth, requireRole('admin'), (req, res) => {
    const key = normVin(req.params.vin);
    if (!store.getVehicle(key)) return res.status(404).json({ error: 'VIN not found' });
    store.deleteVehicle(key);
    store.pushAudit({
      vin: key,
      user: req.dtUser.name,
      action: 'delete_vin',
      oldValue: key,
      newValue: '',
    });
    store.save();
    return res.json({ ok: true });
  });

  // ——— Assignment: auto-suggest by sales type, Hanouf confirms ———
  function advisorKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** Starting rules. Admin can change them; a saved Auto assign replaces these. */
  const DEFAULT_RUBA_ADVISORS = [
    'mansuor Ali Al Qahtani',
    'ahmed saleh ahmed binmahfood',
    'ahmed mahmoud yousef Al fitni',
    'lujen sami saeed bazhair',
    'Ali Muharraq A Alharbi',
    'muteb abdullah Nasser Al Shehri',
  ];

  function cleanAdvisors(rows) {
    const advisors = [];
    const seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const advisor = String((row && row.advisor) || '').trim();
      const emp = findAssignable(row && row.employeeId);
      const key = advisorKey(advisor);
      if (!advisor || !emp || seen.has(key)) return;
      seen.add(key);
      advisors.push({ advisor, employeeId: emp.id });
    });
    return advisors;
  }

  function cleanExcludes(rows) {
    const excludes = [];
    const seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const salesType = String((row && row.salesType) || '').trim();
      const emp = findAssignable(row && row.employeeId);
      const key = `${salesType.toLowerCase()}|${emp ? emp.id : ''}`;
      if (!salesType || !emp || seen.has(key)) return;
      seen.add(key);
      excludes.push({ salesType, employeeId: emp.id });
    });
    return excludes;
  }

  function defaultAdvisors() {
    return cleanAdvisors(DEFAULT_RUBA_ADVISORS.map((advisor) => ({ advisor, employeeId: 'ruba' })));
  }

  function defaultExcludes() {
    return cleanExcludes([{ salesType: 'bank', employeeId: 'hanouf' }]);
  }

  function salesTypeHits(vinType, ruleType) {
    const a = String(vinType || '').trim().toLowerCase();
    const b = String(ruleType || '').trim().toLowerCase();
    if (!b || a === '(blank)') return false;
    return a === b || a.includes(b);
  }

  function excludedIds(rules, salesType) {
    const ids = new Set();
    (rules.excludes || []).forEach((row) => {
      if (salesTypeHits(salesType, row.salesType)) ids.add(row.employeeId);
    });
    return ids;
  }

  function readAutoAssign() {
    const saved = store.data.meta && store.data.meta.autoAssign;
    const allIds = USERS.filter(isAssignable).map((u) => u.id);
    const legacy = !saved || typeof saved !== 'object' || saved.fallbackEmployeeId === undefined;
    if (!saved || typeof saved !== 'object') {
      return {
        configured: false,
        employees: allIds,
        salesTypes: [],
        advisors: defaultAdvisors(),
        excludes: defaultExcludes(),
        fallbackEmployeeId: 'hanouf',
        advisorOnlyIds: ['ruba'],
      };
    }
    const employees = [...new Set((Array.isArray(saved.employees) ? saved.employees : [])
      .map((id) => findAssignable(id))
      .filter(Boolean)
      .map((u) => u.id))];
    const salesTypes = [...new Set((Array.isArray(saved.salesTypes) ? saved.salesTypes : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean))];
    let advisors = cleanAdvisors(saved.advisors);
    if (legacy) {
      const have = new Set(advisors.map((r) => advisorKey(r.advisor)));
      defaultAdvisors().forEach((r) => {
        if (!have.has(advisorKey(r.advisor))) advisors.push(r);
      });
    }
    const excludes = legacy && !Array.isArray(saved.excludes) ? defaultExcludes() : cleanExcludes(saved.excludes);
    const fallbackEmp = legacy
      ? findAssignable('hanouf')
      : findAssignable(saved.fallbackEmployeeId);
    const advisorOnlyIds = saved.advisorOnlyIds === undefined
      ? ['ruba']
      : [...new Set((Array.isArray(saved.advisorOnlyIds) ? saved.advisorOnlyIds : [])
        .map((id) => findAssignable(id))
        .filter(Boolean)
        .map((u) => u.id))];
    return {
      configured: true,
      employees,
      salesTypes,
      advisors,
      excludes,
      fallbackEmployeeId: fallbackEmp ? fallbackEmp.id : '',
      advisorOnlyIds,
    };
  }

  function knownAssignLists() {
    const types = new Set();
    const advisors = new Set();
    const take = (raw) => {
      const t = String((raw && raw.salesType) || '').trim();
      const a = String((raw && raw.salesAdvisor) || '').trim();
      if (t) types.add(t);
      if (a) advisors.add(a);
    };
    store.allVehicles().forEach((v) => take(v.raw));
    Object.values(pendingMap()).forEach((p) => take(p && p.raw));
    return {
      salesTypes: [...types].sort((a, b) => a.localeCompare(b)),
      advisors: [...advisors].sort((a, b) => a.localeCompare(b)),
    };
  }

  function canViewAssignment(u) {
    return isManager(u && u.role) || canUploadSalesRaw(u);
  }

  /**
   * Keep unique pending VINs that have Proforma Date (column P) and no Invoice Date (column V),
   * and that are not already on the system. Auto-split evenly by sales type.
   */
  function buildAssignmentView() {
    const today = todayKey();
    const pending = pendingMap();
    let dropped = false;
    Object.keys(pending).forEach((vin) => {
      const raw = pending[vin].raw || {};
      const hasProforma = !!String(raw.proformaDate || '').trim();
      const hasInvoice = !!String(raw.invoiceDate || '').trim();
      if (store.getVehicle(vin) || !hasProforma || hasInvoice) {
        delete pending[vin];
        dropped = true;
      }
    });
    if (dropped) store.save();

    const employees = USERS.filter(isAssignable);
    const rules = readAutoAssign();
    const poolIds = new Set(rules.configured ? rules.employees : employees.map((u) => u.id));
    const typeAllowed = (t) => {
      if (!rules.configured) return true;
      return rules.salesTypes.some((s) => s.toLowerCase() === String(t || '').trim().toLowerCase());
    };
    const advisorMap = new Map(rules.advisors.map((r) => [advisorKey(r.advisor), r.employeeId]));
    const advisorOnly = new Set(rules.advisorOnlyIds || []);
    const available = employees.filter((u) => !onVacation(u.id) && poolIds.has(u.id) && !advisorOnly.has(u.id));
    const month = currentMonthKey();
    const typeLabel = (t) => String(t || '').trim() || '(blank)';
    const byType = {};
    const total = {};
    employees.forEach((u) => { byType[u.id] = {}; total[u.id] = 0; });
    store.allVehicles().forEach((v) => {
      const id = v.ops && v.ops.assignedEmployeeId;
      if (!(id in total) || !inMonth(v, month)) return;
      const t = typeLabel(v.raw && v.raw.salesType);
      byType[id][t] = (byType[id][t] || 0) + 1;
      total[id] += 1;
    });
    const before = JSON.parse(JSON.stringify(byType));

    const rows = Object.values(pending)
      .sort((a, b) => typeLabel(a.raw.salesType).localeCompare(typeLabel(b.raw.salesType)) || a.vin.localeCompare(b.vin))
      .map((p) => {
        const t = typeLabel(p.raw.salesType);
        const advisor = String((p.raw && p.raw.salesAdvisor) || '').trim();
        const mappedId = advisorMap.get(advisorKey(advisor));
        const blocked = excludedIds(rules, t);
        let pick = null;
        let suggestReason = '';
        if (mappedId) {
          const mapped = employees.find((u) => u.id === mappedId);
          if (mapped && !onVacation(mapped.id)) {
            pick = mapped;
            suggestReason = 'advisor';
          }
        } else if (typeAllowed(t)) {
          const pool = available.filter((u) => !blocked.has(u.id));
          pick = pool.reduce((best, u) => {
            if (!best) return u;
            const a = byType[u.id][t] || 0;
            const b = byType[best.id][t] || 0;
            return a < b || (a === b && total[u.id] < total[best.id]) ? u : best;
          }, null);
          if (pick) suggestReason = 'sales-type';
        }
        if (!pick && !mappedId && rules.fallbackEmployeeId && !blocked.has(rules.fallbackEmployeeId)) {
          const fallback = employees.find((u) => u.id === rules.fallbackEmployeeId);
          if (fallback && !onVacation(fallback.id)) {
            pick = fallback;
            suggestReason = 'fallback';
          }
        }
        if (pick) {
          byType[pick.id][t] = (byType[pick.id][t] || 0) + 1;
          total[pick.id] += 1;
        }
        return {
          vin: p.vin,
          salesType: t,
          salesAdvisor: advisor,
          proformaDate: p.raw.proformaDate,
          suggestedEmployeeId: pick ? pick.id : '',
          suggestedEmployeeName: pick ? pick.name : '',
          suggestReason,
        };
      });

    const types = new Set();
    employees.forEach((u) => Object.keys(byType[u.id]).forEach((t) => types.add(t)));
    const vac = vacationList();
    return {
      today,
      month,
      rows,
      salesTypes: [...types].sort((a, b) => a.localeCompare(b)),
      employees: employees.map((u) => {
        const x = vac.find((e) => e.id === u.id);
        return {
          id: u.id,
          name: u.name,
          bySalesType: before[u.id],
          afterBySalesType: byType[u.id],
          onVacation: x.onVacation,
          vacationUntil: x.until,
        };
      }),
    };
  }

  /** Hanouf marks an employee on / off vacation: { employeeId, onVacation, until } */
  router.put('/vacation', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const body = req.body || {};
    const emp = findAssignable(body.employeeId);
    if (!emp) return res.status(400).json({ error: 'Unknown employee' });
    const until = /^\d{4}-\d{2}-\d{2}$/.test(String(body.until || '')) ? body.until : '';
    if (!store.data.meta.vacations) store.data.meta.vacations = {};
    const was = onVacation(emp.id);
    if (body.onVacation) {
      store.data.meta.vacations[emp.id] = { until, by: req.dtUser.name, at: new Date().toISOString() };
    } else {
      delete store.data.meta.vacations[emp.id];
    }
    store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'set_vacation',
      field: emp.name,
      oldValue: was ? 'vacation' : 'working',
      newValue: body.onVacation ? `vacation${until ? ` until ${until}` : ''}` : 'working',
    });
    store.save();
    return res.json({ ok: true, ...buildAssignmentView(), canConfirm: true });
  });

  router.get('/assignment', auth, (req, res) => {
    if (!canViewAssignment(req.dtUser)) return res.status(403).json({ error: 'Forbidden for this role' });
    return res.json({ ...buildAssignmentView(), canConfirm: isManager(req.dtUser.role) });
  });

  /** Hanouf confirms the automatic split. { all: true } or { vins: [...] } uses the even-by-sales-type pick. */
  router.post('/assignment/confirm', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const view = buildAssignmentView();
    const want = req.body && req.body.all
      ? view.rows.map((r) => r.vin)
      : Array.isArray(req.body && req.body.vins) ? req.body.vins.map(normVin).filter(Boolean)
        : Array.isArray(req.body && req.body.items) ? req.body.items.map((it) => normVin(it && it.vin)).filter(Boolean)
          : [];
    const pick = new Map(view.rows.map((r) => [r.vin, r.suggestedEmployeeId]));
    const items = want.map((vin) => ({ vin, employeeId: pick.get(vin) || '' }));
    if (!items.length) return res.status(400).json({ error: 'Nothing to confirm' });
    const pending = pendingMap();
    const now = new Date().toISOString();
    const results = items.map((it) => {
      const vin = normVin(it && it.vin);
      const p = pending[vin];
      if (!p) return { vin, ok: false, error: 'Not pending' };
      if (store.getVehicle(vin)) { delete pending[vin]; return { vin, ok: false, error: 'Already on the system' }; }
      const emp = findAssignable(it && it.employeeId);
      if (!emp) return { vin, ok: false, error: 'Choose an employee' };
      if (onVacation(emp.id)) return { vin, ok: false, error: `${emp.name} is on vacation` };
      store.upsertVehicle(vin, {
        vin,
        raw: { ...emptyRaw(), ...p.raw, vin },
        ops: {
          ...emptyOps(),
          assignedEmployeeId: emp.id,
          assignedEmployeeName: emp.name,
          assignedBy: req.dtUser.name,
          assignedAt: now,
          updatedAt: now,
          updatedBy: req.dtUser.name,
          inventoryOwnerId: p.inventoryOwnerId || '',
          inventoryOwnerName: p.inventoryOwnerName || '',
          inventoryClaimedAt: p.inventoryClaimedAt || '',
        },
        createdAt: now,
        createdBy: req.dtUser.name,
        rawUpdatedAt: now,
      });
      delete pending[vin];
      store.pushAudit({
        vin, user: req.dtUser.name, action: 'confirm_assignment', oldValue: '(new · sales raw)', newValue: emp.name,
      });
      return { vin, ok: true, employee: emp.name };
    });
    store.save();
    return res.json({ ok: true, results, ...buildAssignmentView(), canConfirm: true });
  });

  router.post('/assignment/dismiss', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vins = selectedVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const pending = pendingMap();
    let removed = 0;
    vins.forEach((vin) => {
      if (!pending[vin]) return;
      delete pending[vin];
      removed += 1;
      store.pushAudit({ vin, user: req.dtUser.name, action: 'dismiss_assignment', oldValue: 'pending', newValue: '' });
    });
    store.save();
    return res.json({ ok: true, removed, ...buildAssignmentView(), canConfirm: true });
  });

  router.get('/auto-assign', auth, requireRole('admin'), (_req, res) => {
    const rules = readAutoAssign();
    const known = knownAssignLists();
    const employees = USERS.filter(isAssignable).map((u) => ({ id: u.id, name: u.name }));
    res.json({
      configured: rules.configured,
      employees,
      selectedEmployees: rules.employees,
      salesTypes: known.salesTypes,
      selectedSalesTypes: rules.configured ? rules.salesTypes : known.salesTypes,
      advisors: rules.advisors.map((r) => ({
        advisor: r.advisor,
        employeeId: r.employeeId,
        employeeName: (employees.find((u) => u.id === r.employeeId) || {}).name || r.employeeId,
      })),
      excludes: rules.excludes.map((r) => ({
        salesType: r.salesType,
        employeeId: r.employeeId,
        employeeName: (employees.find((u) => u.id === r.employeeId) || {}).name || r.employeeId,
      })),
      fallbackEmployeeId: rules.fallbackEmployeeId || '',
      advisorOnlyIds: rules.advisorOnlyIds || [],
      knownAdvisors: known.advisors,
    });
  });

  router.put('/auto-assign', auth, requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const employees = [...new Set((Array.isArray(body.employees) ? body.employees : [])
      .map((id) => findAssignable(id))
      .filter(Boolean)
      .map((u) => u.id))];
    const salesTypes = [...new Set((Array.isArray(body.salesTypes) ? body.salesTypes : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean))];
    const advisors = cleanAdvisors(body.advisors);
    const excludes = cleanExcludes(body.excludes);
    const fallback = findAssignable(body.fallbackEmployeeId);
    const advisorOnlyIds = [...new Set((Array.isArray(body.advisorOnlyIds) ? body.advisorOnlyIds : [])
      .map((id) => findAssignable(id))
      .filter(Boolean)
      .map((u) => u.id))];
    if (!store.data.meta || typeof store.data.meta !== 'object') store.data.meta = {};
    store.data.meta.autoAssign = {
      employees,
      salesTypes,
      advisors,
      excludes,
      fallbackEmployeeId: fallback ? fallback.id : '',
      advisorOnlyIds,
    };
    store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'auto_assign_rules',
      oldValue: '',
      newValue: `${employees.length} employees · ${salesTypes.length} sales types · ${advisors.length} advisors · ${excludes.length} blocked · leftover ${fallback ? fallback.name : 'none'}`,
    });
    store.save();
    const rules = readAutoAssign();
    return res.json({ ok: true, ...rules });
  });

  function monthParam(val) {
    const m = String(val || '').trim().slice(0, 7);
    return /^\d{4}-\d{2}$/.test(m) ? m : currentMonthKey();
  }

  function monthTargets(month) {
    const all = store.data.meta.targets || {};
    return all[month] || {};
  }

  /** Per-employee MTD count by sales type + total vs. monthly target (Hanouf / Admin). */
  router.get('/team-performance', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const month = monthParam(req.query.month);
    const targets = monthTargets(month);
    const employees = USERS.filter(isAssignable);
    const rows = new Map(employees.map((u) => [u.id, {
      id: u.id, name: u.name, bySalesType: {}, total: 0, delivered: 0,
    }]));
    const salesTypes = new Set();
    const seenVin = new Set();
    let unassigned = 0;
    store.allVehicles().forEach((v) => {
      if (!inMonth(v, month)) return;
      const vinKey = normVin(v.vin);
      if (!vinKey || seenVin.has(vinKey)) return;
      seenVin.add(vinKey);
      const row = rows.get(v.ops && v.ops.assignedEmployeeId);
      if (!row) { unassigned += 1; return; }
      const stype = String((v.raw && v.raw.salesType) || '').trim() || '(blank)';
      salesTypes.add(stype);
      row.bySalesType[stype] = (row.bySalesType[stype] || 0) + 1;
      row.total += 1;
      if (isDelivered(v)) row.delivered += 1;
    });
    const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : null);
    const list = [...rows.values()].map((r) => {
      const target = Number(targets[r.id]) || 0;
      return {
        ...r,
        target,
        achPct: pct(r.total, target),
        deliveredPct: pct(r.delivered, target),
      };
    });
    const sum = (k) => list.reduce((s, r) => s + (r[k] || 0), 0);
    const totals = {
      bySalesType: {},
      total: sum('total'),
      delivered: sum('delivered'),
      target: sum('target'),
    };
    list.forEach((r) => Object.entries(r.bySalesType).forEach(([k, n]) => {
      totals.bySalesType[k] = (totals.bySalesType[k] || 0) + n;
    }));
    totals.achPct = pct(totals.total, totals.target);
    totals.deliveredPct = pct(totals.delivered, totals.target);
    res.json({
      month,
      currentMonth: currentMonthKey(),
      today: todayKey(),
      salesTypes: [...salesTypes].sort((a, b) => (totals.bySalesType[b] || 0) - (totals.bySalesType[a] || 0)),
      rows: list,
      totals,
      unassigned,
    });
  });

  function sendXlsx(res, wb, filename) {
    const buf = exportExcel.writeBuffer(wb);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buf.length);
    return res.send(buf);
  }

  router.get('/export/live-sheet', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const month = String((req.query && req.query.month) || '').trim().slice(0, 7);
    let list = store.allVehicles();
    if (/^\d{4}-\d{2}$/.test(month)) list = list.filter((v) => inMonth(v, month));
    list.sort((a, b) => sheetStatusRank(a) - sheetStatusRank(b)
      || String((a.raw && (a.raw.proformaDate || a.raw.date)) || '').localeCompare(String((b.raw && (b.raw.proformaDate || b.raw.date)) || ''))
      || String(a.vin).localeCompare(String(b.vin)));
    const wb = exportExcel.buildLiveSheetWorkbook(list, store.data.prints || []);
    return sendXlsx(res, wb, `DT-Live-Sheet-${exportExcel.stamp()}.xlsx`);
  });

  router.get('/export/full', auth, requireRole('admin'), (req, res) => {
    let wb;
    try {
      wb = fullExcel.buildFullWorkbook(store.data);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Could not extract all data' });
    }
    return sendXlsx(res, wb, `DT-All-Data-${exportExcel.stamp()}.xlsx`);
  });

  router.post(
    '/import/full',
    express.raw({ limit: RAW_UPLOAD_LIMIT, type: '*/*' }),
    auth,
    requireRole('admin'),
    (req, res) => {
      const { buf, filename } = uploadedFile(req);
      let parsed;
      try {
        parsed = fullExcel.parseFullWorkbook(buf);
      } catch (err) {
        return res.status(400).json({ error: err.message || 'Could not read the Excel file' });
      }
      const live = store.data;
      live.vehicles = parsed.vehicles;
      live.attendance = parsed.attendance;
      live.prints = parsed.prints;
      live.audit = parsed.audit;
      live.meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
      if (!Array.isArray(live.meta.customCarriers)) live.meta.customCarriers = [];
      if (!Array.isArray(live.meta.customCities)) live.meta.customCities = [];
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'import_full_excel',
        oldValue: filename,
        newValue: `vehicles ${parsed.counts.Vehicles} · attendance ${parsed.counts.Attendance} · prints ${parsed.counts.Prints} · audit ${parsed.counts.Audit} · meta ${parsed.counts.Meta}`,
      });
      store.save();
      return res.json({
        ok: true,
        filename,
        counts: parsed.counts,
        vehicles: Object.keys(live.vehicles).length,
        pending: Object.keys((live.meta && live.meta.pendingAssignments) || {}).length,
      });
    }
  );

  router.get('/export/admin', auth, requireRole('admin'), (req, res) => {
    const month = monthParam(req.query.month);
    const wb = exportExcel.buildAdminWorkbook({
      month,
      currentMonth: currentMonthKey(),
      vehicles: store.allVehicles(),
      attendance: attendanceRows(),
      prints: store.data.prints || [],
      employees: USERS.filter(isAssignable),
      coordinators: USERS.filter((u) => u.role === 'coordinator'),
      targets: monthTargets(month),
      weightsCfg: kpiEngine.readConfig(store.data.meta),
      carriers: allCarriers(),
      cities: allCities(),
      inMonth,
      isDelivered,
      kpiEngine,
    });
    return sendXlsx(res, wb, `DT-Admin-${exportExcel.stamp()}.xlsx`);
  });

  router.get('/schedule/config', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const items = scheduleEngine.normalizeSla(store.data.meta && store.data.meta.sla);
    const control = scheduleEngine.slaEngine.readControl(store.data.meta);
    const canEdit = !!(req.dtUser && req.dtUser.role === 'admin');
    res.json({
      items,
      control,
      history: scheduleEngine.slaEngine.readHistory(store.data.meta).slice(0, 80),
      statuses: STATUSES,
      canEdit,
    });
  });

  function summarizeControl(c) {
    if (!c) return '';
    const rules = (c.rules || [])
      .filter((r) => r.active)
      .map((r) => `${r.status}:W${r.warningValue}/B${r.breachValue}`)
      .join(' · ');
    const d = c.delivery || {};
    return `${rules} | delivery ${d.targetDays}d from ${d.startFrom}`;
  }

  function buildControlDiff(prev, next) {
    const diffs = [];
    const prevMap = new Map((prev.rules || []).map((r) => [r.id, r]));
    (next.rules || []).forEach((r) => {
      const o = prevMap.get(r.id);
      if (!o) {
        diffs.push({ status: r.status, field: 'added', old: '', neu: `${r.warningValue}/${r.breachValue}` });
        return;
      }
      ['warningValue', 'breachValue', 'noMoveWarnValue', 'noMoveBreachValue', 'active'].forEach((f) => {
        if (String(o[f]) !== String(r[f])) {
          diffs.push({ status: r.status, field: f, old: o[f], neu: r[f] });
        }
      });
    });
    const pd = prev.delivery || {};
    const nd = next.delivery || {};
    ['targetDays', 'warningDays', 'breachDays', 'startFrom', 'dayType', 'active'].forEach((f) => {
      if (String(pd[f]) !== String(nd[f])) {
        diffs.push({ status: 'DELIVERY', field: f, old: pd[f], neu: nd[f] });
      }
    });
    return diffs;
  }

  router.put('/schedule/config', auth, requireRole('admin'), (req, res) => {
    const body = req.body || {};
    if (!store.data.meta || typeof store.data.meta !== 'object') store.data.meta = {};
    const prev = scheduleEngine.slaEngine.readControl(store.data.meta);
    const reason = String(body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required for every SLA change' });
    }

    if (body.control && typeof body.control === 'object') {
      const next = {
        rules: Array.isArray(body.control.rules) ? body.control.rules : prev.rules,
        delivery: body.control.delivery || prev.delivery,
        priority: body.control.priority || prev.priority,
      };
      scheduleEngine.slaEngine.writeControl(store.data.meta, next, req.dtUser.name);
      const saved = scheduleEngine.slaEngine.readControl(store.data.meta);
      scheduleEngine.slaEngine.pushHistory(store.data.meta, {
        admin: req.dtUser.name,
        reason,
        kind: 'control',
        oldValue: summarizeControl(prev),
        newValue: summarizeControl(saved),
        detail: buildControlDiff(prev, saved),
      });
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'set_sla_control',
        field: 'slaControl',
        oldValue: reason,
        newValue: summarizeControl(saved),
      });
      store.save();
      return res.json({
        ok: true,
        control: saved,
        history: scheduleEngine.slaEngine.readHistory(store.data.meta).slice(0, 80),
        canEdit: true,
      });
    }

    const items = scheduleEngine.normalizeSla(body.items);
    const bad = items.find((x) => !Number.isFinite(x.targetDay) || x.targetDay < 1);
    if (bad) return res.status(400).json({ error: `Target day for ${bad.label} must be 1 or more` });
    const oldLegacy = scheduleEngine.normalizeSla(store.data.meta.sla);
    store.data.meta.sla = items;
    scheduleEngine.slaEngine.pushHistory(store.data.meta, {
      admin: req.dtUser.name,
      reason,
      kind: 'legacy_target_day',
      oldValue: oldLegacy.map((x) => `${x.id}:${x.enabled ? x.targetDay : 'off'}`).join(' · '),
      newValue: items.map((x) => `${x.id}:${x.enabled ? x.targetDay : 'off'}`).join(' · '),
    });
    store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'set_sla',
      field: 'schedule',
      oldValue: reason,
      newValue: items.map((x) => `${x.id}:${x.enabled ? x.targetDay : 'off'}`).join(' · '),
    });
    store.save();
    return res.json({
      ok: true,
      items,
      control: scheduleEngine.slaEngine.readControl(store.data.meta),
      history: scheduleEngine.slaEngine.readHistory(store.data.meta).slice(0, 80),
      canEdit: true,
    });
  });

  router.get('/schedule/dashboard', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const month = monthParam(req.query.month);
    const items = scheduleEngine.normalizeSla(store.data.meta && store.data.meta.sla);
    const dash = scheduleEngine.computeDashboard({
      vehicles: store.allVehicles(),
      slaItems: items,
      slaControl: store.data.meta && store.data.meta.slaControl,
      today: todayKey(),
      month,
      audit: store.data.audit || [],
      now: new Date().toISOString(),
    });
    const [y, m] = String(month || currentMonthKey()).split('-').map(Number);
    const from = Number.isFinite(y) && Number.isFinite(m)
      ? `${y}-${String(m).padStart(2, '0')}-01`
      : '';
    const lastDay = Number.isFinite(y) && Number.isFinite(m)
      ? new Date(Date.UTC(y, m, 0)).getUTCDate()
      : 28;
    const to = from
      ? `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      : '';
    // Always include VIN-level debug for Days to Sales More Details
    const coPerf = companyPerformance.buildCompanyPerformance(store, { from, to });
    return res.json({
      ...dash,
      items,
      canEditSla: !!(req.dtUser && req.dtUser.role === 'admin'),
      currentMonth: currentMonthKey(),
      companyPerformance: coPerf,
    });
  });

  /**
   * Company performance: coordinator assignment → Hanouf Sales Raw sales date.
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (filters by assignment date)
   *        ?month=YYYY-MM (assignment month shortcut)
   *        ?debug=1 to include VIN-level rows
   */
  router.get('/company-performance', auth, (req, res) => {
    const role = req.dtUser && req.dtUser.role;
    const allowed = role === 'admin' || role === 'hanouf' || role === 'coordinator'
      || (req.dtUser && req.dtUser.canCoordinate);
    if (!allowed) return res.status(403).json({ error: 'Forbidden for this role' });

    let from = String(req.query.from || '').trim();
    let to = String(req.query.to || '').trim();
    const month = monthParam(req.query.month);
    if ((!from || !to) && month) {
      const [y, m] = month.split('-').map(Number);
      from = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }
    const result = companyPerformance.buildCompanyPerformance(store, { from, to });
    if (String(req.query.debug || '') !== '1') {
      const { debug, ...rest } = result;
      return res.json(rest);
    }
    return res.json(result);
  });

  router.get('/kpi/weights', auth, requireRole('admin', 'hanouf'), (_req, res) => {
    const cfg = kpiEngine.readConfig(store.data.meta);
    const total = kpiEngine.KPI_KEYS.reduce((s, k) => s + (cfg.enabled[k] ? cfg.weights[k] : 0), 0);
    res.json({
      keys: kpiEngine.KPI_KEYS,
      meta: kpiEngine.KPI_META,
      weights: cfg.weights,
      enabled: cfg.enabled,
      scoring: cfg.scoring,
      total,
    });
  });

  router.put('/kpi/weights', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const body = req.body || {};
    const check = kpiEngine.validateWeightage(body.weights, body.enabled);
    if (!check.ok) return res.status(400).json({ error: check.error, total: check.total, weights: check.weights, enabled: check.enabled });
    store.data.meta.kpiWeights = check.weights;
    store.data.meta.kpiEnabled = check.enabled;
    if (body.scoring && typeof body.scoring === 'object') {
      store.data.meta.kpiScoring = kpiEngine.normalizeScoring(body.scoring);
    }
    store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'set_kpi_weights',
      field: 'kpi weightage',
      oldValue: '',
      newValue: kpiEngine.KPI_KEYS.map((k) => `${k}:${check.enabled[k] ? check.weights[k] : 0}`).join(' · '),
    });
    store.save();
    const cfg = kpiEngine.readConfig(store.data.meta);
    return res.json({ ok: true, weights: cfg.weights, enabled: cfg.enabled, scoring: cfg.scoring, total: 100 });
  });

  router.get('/kpi/employee', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const month = monthParam(req.query.month);
    const cfg = kpiEngine.readConfig(store.data.meta);
    const result = kpiEngine.computeEmployeeKpi({
      employeeId: String(req.query.employeeId || '').trim(),
      month,
      currentMonth: currentMonthKey(),
      vehicles: store.allVehicles(),
      employees: USERS.filter(isAssignable),
      targets: monthTargets(month),
      weights: cfg.weights,
      enabled: cfg.enabled,
      scoring: cfg.scoring,
      inMonth,
      isDelivered,
    });
    if (result.error) return res.status(404).json({ error: result.error, roster: result.roster, month: result.month });
    return res.json(result);
  });

  /** Save monthly targets: { month, targets: { employeeId: number } } */
  router.put('/targets', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const body = req.body || {};
    const month = monthParam(body.month);
    const input = body.targets && typeof body.targets === 'object' ? body.targets : {};
    if (!store.data.meta.targets) store.data.meta.targets = {};
    const current = { ...(store.data.meta.targets[month] || {}) };
    const changes = [];
    Object.entries(input).forEach(([id, val]) => {
      const emp = findAssignable(id);
      if (!emp) return;
      const n = Math.max(0, Math.round(Number(val) || 0));
      if ((Number(current[id]) || 0) === n) return;
      changes.push({ emp, old: Number(current[id]) || 0, n });
      if (n) current[id] = n;
      else delete current[id];
    });
    store.data.meta.targets[month] = current;
    changes.forEach(({ emp, old, n }) => store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'set_target',
      field: `${month} · ${emp.name}`,
      oldValue: String(old),
      newValue: String(n),
    }));
    if (changes.length) store.save();
    return res.json({ ok: true, month, targets: current, changed: changes.length });
  });

  router.get('/audit', auth, requireRole('admin'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json({ rows: (store.data.audit || []).slice(0, limit) });
  });

  return { router, store };
}

module.exports = { createDeliveryTransformationRouter };
