'use strict';

const XLSX = require('xlsx');
const exportExcel = require('./export-excel');

const FORMAT = 'dt-full-v1';
const SHEETS = ['Vehicles', 'Attendance', 'Prints', 'Audit', 'Meta'];
const CELL_MAX = 32000;

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function encode(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function decode(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    const iso = v.toISOString();
    if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) return iso.slice(0, 10);
    return iso;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
}

function flattenRecord(rec, nested) {
  const row = {};
  const put = (key, value) => {
    const encoded = encode(value);
    if (encoded === '') return;
    if (typeof encoded === 'string' && encoded.length > CELL_MAX) {
      throw new Error(`"${key}" is too long for one Excel cell`);
    }
    row[key] = encoded;
  };
  Object.keys(rec || {}).sort().forEach((key) => {
    const value = rec[key];
    if (nested.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      Object.keys(value).sort().forEach((sub) => put(`${key}.${sub}`, value[sub]));
      return;
    }
    put(key, value);
  });
  return row;
}

function unflattenRecord(row, nested) {
  const rec = {};
  Object.keys(row || {}).forEach((key) => {
    if (!key || key === 'Note') return;
    const value = decode(row[key]);
    if (value === '') return;
    const dot = key.indexOf('.');
    const head = dot > 0 ? key.slice(0, dot) : '';
    if (head && nested.has(head)) {
      if (!rec[head] || typeof rec[head] !== 'object' || Array.isArray(rec[head])) rec[head] = {};
      rec[head][key.slice(dot + 1)] = value;
      return;
    }
    rec[key] = value;
  });
  return rec;
}

function writeSheet(wb, name, rows, firstKeys) {
  const preferred = firstKeys || [];
  const seen = new Set();
  const headers = [];
  preferred.forEach((key) => {
    if (rows.some((row) => Object.prototype.hasOwnProperty.call(row, key))) {
      seen.add(key);
      headers.push(key);
    }
  });
  rows.forEach((row) => {
    Object.keys(row).sort().forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      headers.push(key);
    });
  });
  if (!headers.length) headers.push('Note');
  const aoa = [headers];
  rows.forEach((row) => {
    aoa.push(headers.map((key) => (row[key] == null ? '' : row[key])));
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((key) => ({ wch: Math.min(42, Math.max(12, String(key).length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
}

function buildFullWorkbook(data) {
  const src = data || {};
  const vehicles = src.vehicles && typeof src.vehicles === 'object' ? src.vehicles : {};
  const attendance = Array.isArray(src.attendance) ? src.attendance : [];
  const prints = Array.isArray(src.prints) ? src.prints : [];
  const audit = Array.isArray(src.audit) ? src.audit : [];
  const meta = src.meta && typeof src.meta === 'object' ? src.meta : {};

  const vehicleRows = Object.keys(vehicles).sort().map((key) => {
    const rec = vehicles[key] || {};
    const row = flattenRecord(rec, new Set(['raw', 'ops']));
    if (!row.vin) row.vin = rec.vin || key;
    return row;
  });
  const attendanceRows = attendance.map((rec) => flattenRecord(rec, new Set()));
  const printRows = prints.map((rec) => flattenRecord(rec, new Set()));
  const auditRows = audit.map((rec) => flattenRecord(rec, new Set()));
  const metaRows = Object.keys(meta).sort().map((key) => ({
    Key: key,
    Value: JSON.stringify(meta[key] == null ? null : meta[key]),
  }));
  metaRows.forEach((row) => {
    if (String(row.Value).length > CELL_MAX) throw new Error(`Meta "${row.Key}" is too long for one Excel cell`);
  });

  const wb = XLSX.utils.book_new();
  writeSheet(wb, 'Manifest', [
    { Sheet: 'Format', Rows: FORMAT },
    { Sheet: 'Vehicles', Rows: String(vehicleRows.length) },
    { Sheet: 'Attendance', Rows: String(attendanceRows.length) },
    { Sheet: 'Prints', Rows: String(printRows.length) },
    { Sheet: 'Audit', Rows: String(auditRows.length) },
    { Sheet: 'Meta', Rows: String(metaRows.length) },
  ], ['Sheet', 'Rows']);
  writeSheet(wb, 'Vehicles', vehicleRows, ['vin', 'createdAt', 'createdBy', 'rawUpdatedAt']);
  writeSheet(wb, 'Attendance', attendanceRows, ['id', 'at', 'name', 'company', 'phone']);
  writeSheet(wb, 'Prints', printRows, ['id', 'at', 'kind', 'company', 'city']);
  writeSheet(wb, 'Audit', auditRows, ['id', 'at', 'user', 'action', 'vin']);
  writeSheet(wb, 'Meta', metaRows, ['Key', 'Value']);
  const vehicleList = Object.keys(vehicles).sort().map((key) => vehicles[key]);
  exportExcel.appendSheet(wb, 'Printed VINs', exportExcel.printedVinRows(prints));
  exportExcel.appendSheet(wb, 'Live Sheet', exportExcel.liveSheetRows(vehicleList));
  exportExcel.appendSheet(wb, 'Assignments', exportExcel.assignmentRows(vehicleList, meta.pendingAssignments));
  return wb;
}

function sheetCount(rows, name) {
  if (!rows) throw new Error(`This Excel is missing the "${name}" sheet. Extract all data again.`);
  return rows.filter((row) => Object.values(row).some((v) => String(v == null ? '' : v).trim() !== '')).length;
}

function parseFullWorkbook(buffer) {
  if (!buffer || !buffer.length) throw new Error('Upload an Excel file');
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    throw new Error(`Could not read the Excel file: ${err.message}`);
  }
  const manifestRows = readSheet(wb, 'Manifest');
  if (!manifestRows) throw new Error('This file is not a full data extract. Use Extract all data first.');
  const manifest = {};
  manifestRows.forEach((row) => {
    const sheet = String(row.Sheet || '').trim();
    if (sheet) manifest[sheet] = String(row.Rows == null ? '' : row.Rows).trim();
  });
  if (manifest.Format !== FORMAT) {
    throw new Error('This file is not a full data extract. Use Extract all data, then upload that file.');
  }

  const vehicleSheet = readSheet(wb, 'Vehicles');
  const attendanceSheet = readSheet(wb, 'Attendance');
  const printSheet = readSheet(wb, 'Prints');
  const auditSheet = readSheet(wb, 'Audit');
  const metaSheet = readSheet(wb, 'Meta');
  const counts = {
    Vehicles: sheetCount(vehicleSheet, 'Vehicles'),
    Attendance: sheetCount(attendanceSheet, 'Attendance'),
    Prints: sheetCount(printSheet, 'Prints'),
    Audit: sheetCount(auditSheet, 'Audit'),
    Meta: sheetCount(metaSheet, 'Meta'),
  };
  SHEETS.forEach((name) => {
    if (manifest[name] == null) throw new Error(`Manifest is missing "${name}". Extract all data again.`);
    if (String(counts[name]) !== String(manifest[name])) {
      throw new Error(`${name} has ${counts[name]} rows but the file says ${manifest[name]}. Extract again so the upload matches every row.`);
    }
  });

  const vehicles = {};
  (vehicleSheet || []).forEach((row) => {
    const rec = unflattenRecord(row, new Set(['raw', 'ops']));
    const vin = normVin(rec.vin);
    if (!vin) return;
    rec.vin = vin;
    if (!rec.raw || typeof rec.raw !== 'object') rec.raw = {};
    if (!rec.ops || typeof rec.ops !== 'object') rec.ops = {};
    rec.raw.vin = rec.raw.vin || vin;
    vehicles[vin] = rec;
  });
  if (Object.keys(vehicles).length !== counts.Vehicles) {
    throw new Error('Every Vehicles row needs a VIN. Extract all data again.');
  }

  const asList = (rows) => (rows || [])
    .map((row) => unflattenRecord(row, new Set()))
    .filter((rec) => Object.keys(rec).length);

  const meta = {};
  (metaSheet || []).forEach((row) => {
    const key = String(row.Key || '').trim();
    if (!key) return;
    const raw = row.Value;
    if (raw == null || raw === '') {
      meta[key] = null;
      return;
    }
    try {
      meta[key] = JSON.parse(String(raw));
    } catch {
      throw new Error(`Meta "${key}" is not valid JSON. Do not edit that cell, or extract again.`);
    }
  });
  return {
    vehicles,
    attendance: asList(attendanceSheet),
    prints: asList(printSheet),
    audit: asList(auditSheet),
    meta,
    counts,
  };
}

module.exports = {
  FORMAT,
  buildFullWorkbook,
  parseFullWorkbook,
};
