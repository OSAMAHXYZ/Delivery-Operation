'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { USERS, emptyOps, emptyRaw } = require('./constants');

function emptyStore() {
  return {
    vehicles: {},
    audit: [],
    attendance: [],
    prints: [],
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: null,
      label: 'delivery-transformation',
      memoInvoiceNext: 1000,
      customCarriers: [],
      customCities: [],
    },
  };
}

const BACKUP_MS = 10 * 60 * 1000;
const BACKUP_SCAN_MS = 60 * 1000;

function createStore(filePath) {
  let data = emptyStore();
  const sessions = new Map();
  const changeListeners = new Set();
  let backupTimer = null;

  function backupPath() {
    return path.join(path.dirname(filePath), 'delivery-transformation-backup-last.json');
  }

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        data = emptyStore();
        seedDemoIfEmpty();
        save();
        return;
      }
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data = {
        vehicles: raw.vehicles && typeof raw.vehicles === 'object' ? raw.vehicles : {},
        audit: Array.isArray(raw.audit) ? raw.audit : [],
        attendance: Array.isArray(raw.attendance) ? raw.attendance : [],
        prints: Array.isArray(raw.prints) ? raw.prints : [],
        meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : emptyStore().meta,
      };
      if (!Array.isArray(data.meta.customCarriers)) data.meta.customCarriers = [];
      if (!Array.isArray(data.meta.customCities)) data.meta.customCities = [];
      if (!Object.keys(data.vehicles).length) {
        seedDemoIfEmpty();
        save();
      }
    } catch (err) {
      console.error('[delivery-transformation] load failed:', err.message);
      data = emptyStore();
      seedDemoIfEmpty();
    }
  }

  function save() {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      data.meta.updatedAt = new Date().toISOString();
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error('[delivery-transformation] save failed:', err.message);
      throw err;
    }
    changeListeners.forEach((fn) => {
      try { fn(data.meta.updatedAt); } catch (_) { /* listener errors never break a save */ }
    });
  }

  /** Called after every successful save (employee edit, import, coordinator print…). Returns an unsubscribe fn. */
  function onChange(fn) {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  }

  function seedDemoIfEmpty() {
    const demo = [
      {
        vin: 'JTDTXFORM00000001',
        product: 'CAMRY',
        salesType: 'Cash',
        salesOrder: 'SO-9001',
        salesAdvisor: 'SA Demo',
        userName: 'عميل تجريبي ١',
        phone: '0500000001',
        gtLocation: 'GT-RUH',
        vehicleLocation: 'Yard A',
        employee: 'rasha',
        status: 'جاهز للتسليم',
        leadTime: 2.44,
        carrier: '',
        city: 'الرياض',
      },
      {
        vin: 'JTDTXFORM00000002',
        product: 'LAND CRUISER',
        salesType: 'Lease',
        salesOrder: 'SO-9002',
        salesAdvisor: 'SA Demo',
        userName: 'عميل تجريبي ٢',
        phone: '0500000002',
        gtLocation: 'GT-JED',
        vehicleLocation: 'Yard B',
        employee: 'ruba',
        status: 'Claimed',
        leadTime: 1.8,
        carrier: 'طريق الراسي',
        city: 'جدة',
      },
      {
        vin: 'JTDTXFORM00000003',
        product: 'RAV4',
        salesType: 'Bank',
        salesOrder: 'SO-9003',
        salesAdvisor: 'SA Demo',
        userName: 'عميل تجريبي ٣',
        phone: '0500000003',
        gtLocation: 'GT-DMM',
        vehicleLocation: 'Showroom',
        employee: 'ibrahim',
        status: 'مرور',
        leadTime: 3.2,
        carrier: 'درب الرياض',
        city: 'الدمام',
      },
    ];
    const now = new Date().toISOString();
    for (const d of demo) {
      const emp = USERS.find((u) => u.id === d.employee);
      const vin = d.vin;
      data.vehicles[vin] = {
        vin,
        raw: {
          ...emptyRaw(),
          vin,
          product: d.product,
          salesType: d.salesType,
          salesOrder: d.salesOrder,
          salesAdvisor: d.salesAdvisor,
          userName: d.userName,
          phone: d.phone,
          gtLocation: d.gtLocation,
          vehicleLocation: d.vehicleLocation,
          proformaDate: now.slice(0, 10),
          date: now.slice(0, 10),
          invoiceOwner: d.userName,
          pic: emp ? emp.name : '',
          leadTime: d.leadTime,
        },
        ops: {
          ...emptyOps(),
          opsStatus: d.status,
          carrier: d.carrier,
          transferCity: d.city,
          assignedEmployeeId: emp ? emp.id : '',
          assignedEmployeeName: emp ? emp.name : '',
          assignedBy: 'seed',
          assignedAt: now,
          updatedAt: now,
          updatedBy: 'seed',
          statusHistory: d.status ? [{ status: d.status, at: now }] : [],
        },
      };
    }
  }

  function getUserByLogin(name) {
    const key = String(name || '').trim().toLowerCase();
    return USERS.find((u) => u.id === key || u.name.toLowerCase() === key) || null;
  }

  function createSession(user) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, {
      userId: user.id,
      name: user.name,
      role: user.role,
      at: Date.now(),
    });
    return token;
  }

  function getSession(token) {
    if (!token) return null;
    const s = sessions.get(String(token).trim());
    if (!s) return null;
    if (Date.now() - s.at > 12 * 60 * 60 * 1000) {
      sessions.delete(token);
      return null;
    }
    s.at = Date.now();
    return s;
  }

  function destroySession(token) {
    sessions.delete(String(token || '').trim());
  }

  function allVehicles() {
    return Object.values(data.vehicles);
  }

  function vehicleKey(vin) {
    const key = String(vin || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!key) return '';
    if (data.vehicles[key]) return key;
    return Object.keys(data.vehicles).find((k) => String(k).toUpperCase().replace(/[^A-Z0-9]/g, '') === key) || '';
  }

  function getVehicle(vin) {
    const key = vehicleKey(vin);
    return key ? data.vehicles[key] : null;
  }

  function upsertVehicle(vinKey, vehicle) {
    data.vehicles[vinKey] = vehicle;
  }

  function deleteVehicle(vinKey) {
    delete data.vehicles[vinKey];
  }

  function pushAudit(entry) {
    data.audit.unshift({
      id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      at: new Date().toISOString(),
      ...entry,
    });
    if (data.audit.length > 2000) data.audit.length = 2000;
  }

  function snapshotCounts(src) {
    const vehicles = src && src.vehicles && typeof src.vehicles === 'object' ? src.vehicles : {};
    const pending = src && src.meta && src.meta.pendingAssignments && typeof src.meta.pendingAssignments === 'object'
      ? src.meta.pendingAssignments
      : {};
    return {
      vehicles: Object.keys(vehicles).length,
      pending: Object.keys(pending).length,
      attendance: Array.isArray(src && src.attendance) ? src.attendance.length : 0,
      prints: Array.isArray(src && src.prints) ? src.prints.length : 0,
    };
  }

  function readLastBackup() {
    const file = backupPath();
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object') return null;
      return raw;
    } catch (err) {
      console.error('[delivery-transformation] backup read failed:', err.message);
      return null;
    }
  }

  function writeBackup(reason) {
    const dir = path.dirname(backupPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const savedAt = new Date().toISOString();
    const payload = {
      savedAt,
      reason: String(reason || 'scheduled'),
      vehicles: data.vehicles,
      audit: data.audit,
      attendance: data.attendance,
      prints: data.prints,
      meta: data.meta,
    };
    const tmp = `${backupPath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, backupPath());
    return backupStatus();
  }

  function restoreLastBackup(by) {
    const snap = readLastBackup();
    if (!snap) throw new Error('No saved snapshot yet');
    const copy = JSON.parse(JSON.stringify(snap));
    data = {
      vehicles: copy.vehicles && typeof copy.vehicles === 'object' ? copy.vehicles : {},
      audit: Array.isArray(copy.audit) ? copy.audit : [],
      attendance: Array.isArray(copy.attendance) ? copy.attendance : [],
      prints: Array.isArray(copy.prints) ? copy.prints : [],
      meta: copy.meta && typeof copy.meta === 'object' ? copy.meta : emptyStore().meta,
    };
    if (!Array.isArray(data.meta.customCarriers)) data.meta.customCarriers = [];
    if (!Array.isArray(data.meta.customCities)) data.meta.customCities = [];
    pushAudit({
      user: by || 'Collector',
      action: 'restore_backup',
      oldValue: 'live employee + coordinator',
      newValue: snap.savedAt || '',
    });
    save();
    return backupStatus();
  }

  function backupStatus() {
    const last = readLastBackup();
    const lastAt = last && last.savedAt ? String(last.savedAt) : '';
    const lastMs = Date.parse(lastAt);
    const nextAt = Number.isFinite(lastMs)
      ? new Date(lastMs + BACKUP_MS).toISOString()
      : new Date().toISOString();
    return {
      intervalMinutes: 10,
      lastAt,
      nextAt,
      due: !Number.isFinite(lastMs) || Date.now() - lastMs >= BACKUP_MS,
      reason: last ? String(last.reason || '') : '',
      snapshot: last ? snapshotCounts(last) : snapshotCounts(null),
      live: snapshotCounts(data),
    };
  }

  function scanBackupOnce() {
    const status = backupStatus();
    if (!status.due) return status;
    return writeBackup(status.lastAt ? 'scheduled' : 'initial');
  }

  function startBackupScanner() {
    if (backupTimer) return;
    try { scanBackupOnce(); } catch (err) {
      console.error('[delivery-transformation] backup scan failed:', err.message);
    }
    backupTimer = setInterval(() => {
      try { scanBackupOnce(); } catch (err) {
        console.error('[delivery-transformation] backup scan failed:', err.message);
      }
    }, BACKUP_SCAN_MS);
    if (backupTimer.unref) backupTimer.unref();
  }

  load();
  startBackupScanner();

  return {
    load,
    save,
    onChange,
    get data() { return data; },
    getUserByLogin,
    createSession,
    getSession,
    destroySession,
    allVehicles,
    vehicleKey,
    getVehicle,
    upsertVehicle,
    deleteVehicle,
    pushAudit,
    readLastBackup,
    writeBackup,
    restoreLastBackup,
    backupStatus,
    filePath,
  };
}

module.exports = { createStore, emptyStore };
