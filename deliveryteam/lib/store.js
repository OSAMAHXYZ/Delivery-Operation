'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { USERS } = require('./constants');

function emptyStore() {
  return {
    vehicles: {},
    uploads: [],
    audit: [],
    /** Monthly delivery targets by employee: { "2026-09": { rasha: 40, ruba: 35, ... } } */
    targets: {},
    meta: { createdAt: new Date().toISOString(), updatedAt: null },
  };
}

function createStore(filePath) {
  let data = emptyStore();
  const sessions = new Map(); // token -> { userId, name, role, at }

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        data = emptyStore();
        save();
        return;
      }
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data = {
        vehicles: raw.vehicles && typeof raw.vehicles === 'object' ? raw.vehicles : {},
        uploads: Array.isArray(raw.uploads) ? raw.uploads : [],
        audit: Array.isArray(raw.audit) ? raw.audit : [],
        targets: raw.targets && typeof raw.targets === 'object' ? raw.targets : {},
        meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : emptyStore().meta,
      };
    } catch (err) {
      console.error('[delivery-team] load failed:', err.message);
      data = emptyStore();
    }
  }

  function save() {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      data.meta.updatedAt = new Date().toISOString();
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error('[delivery-team] save failed:', err.message);
      throw err;
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
    // 12h session
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

  function getVehicle(vin) {
    const key = String(vin || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return data.vehicles[key] || null;
  }

  function upsertVehicle(vinKey, vehicle) {
    data.vehicles[vinKey] = vehicle;
  }

  function pushAudit(entry) {
    data.audit.unshift({
      id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      at: new Date().toISOString(),
      ...entry,
    });
    if (data.audit.length > 5000) data.audit.length = 5000;
  }

  function pushUpload(summary) {
    data.uploads.unshift({
      id: `up_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      at: new Date().toISOString(),
      ...summary,
    });
    if (data.uploads.length > 200) data.uploads.length = 200;
  }

  function getMonthTargets(monthKey) {
    const mk = String(monthKey || '').trim().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mk)) return {};
    if (!data.targets || typeof data.targets !== 'object') data.targets = {};
    const row = data.targets[mk];
    return row && typeof row === 'object' ? { ...row } : {};
  }

  function setEmployeeTarget(monthKey, employeeId, target, byUser) {
    const mk = String(monthKey || '').trim().slice(0, 7);
    const id = String(employeeId || '').trim().toLowerCase();
    if (!/^\d{4}-\d{2}$/.test(mk)) throw new Error('Invalid month');
    if (!id) throw new Error('Employee required');
    if (!data.targets || typeof data.targets !== 'object') data.targets = {};
    if (!data.targets[mk] || typeof data.targets[mk] !== 'object') data.targets[mk] = {};
    const n = Number(target);
    if (!Number.isFinite(n) || n < 0) throw new Error('Target must be a number ≥ 0');
    const val = Math.round(n);
    if (val === 0) delete data.targets[mk][id];
    else data.targets[mk][id] = val;
    data.targets[mk]._updatedAt = new Date().toISOString();
    data.targets[mk]._updatedBy = String((byUser && byUser.name) || '').trim();
    return { month: mk, employeeId: id, target: val };
  }

  load();

  return {
    load,
    save,
    get data() { return data; },
    getUserByLogin,
    createSession,
    getSession,
    destroySession,
    allVehicles,
    getVehicle,
    upsertVehicle,
    pushAudit,
    pushUpload,
    getMonthTargets,
    setEmployeeTarget,
    filePath,
  };
}

module.exports = { createStore, emptyStore };
