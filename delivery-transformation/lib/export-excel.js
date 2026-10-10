'use strict';

const XLSX = require('xlsx');

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function sheetName(name) {
  return String(name || 'Sheet').replace(/[\[\]\\/\*\?:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
}

function appendSheet(wb, name, rows) {
  const data = Array.isArray(rows) && rows.length ? rows : [{ Note: 'No rows' }];
  const ws = XLSX.utils.json_to_sheet(data);
  const keys = Object.keys(data[0] || { Note: '' });
  ws['!cols'] = keys.map((k) => {
    let max = String(k).length;
    data.slice(0, 200).forEach((row) => {
      const n = String(row[k] == null ? '' : row[k]).length;
      if (n > max) max = n;
    });
    return { wch: Math.min(42, max + 2) };
  });
  XLSX.utils.book_append_sheet(wb, ws, sheetName(name));
}

function writeBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function liveSheetRows(vehicles) {
  return (vehicles || []).map((v, i) => {
    const raw = v.raw || {};
    const ops = v.ops || {};
    return {
      '#': i + 1,
      Employee: ops.assignedEmployeeName || '',
      Status: ops.opsStatus || '',
      VIN: v.vin || '',
      'Proforma Date': raw.proformaDate || '',
      'Sales Order': raw.salesOrder || '',
      Product: raw.product || '',
      'Sales Type': raw.salesType || '',
      Customer: raw.userName || '',
      'Invoice Owner': raw.invoiceOwner || '',
      Phone: raw.phone || '',
      'S/A': raw.salesAdvisor || '',
      'Guest Exp': ops.guestCenter || '',
      Appointment: ops.guestCollectAt || '',
      'Appointment Note': ops.guestCollectNote || '',
      'GT Location': raw.gtLocation || '',
      'Vehicle Location': raw.vehicleLocation || '',
      'تاريخ إرسال الضيف': ops.guestSentDate || '',
      'تاريخ استلام التواقيع من الضيف': ops.signatureReceivedDate || '',
      'تاريخ إرسال الملف للحسابات': ops.accountsSentDate || '',
      'تاريخ موافقة الحسابات': ops.accountsApprovalDate || '',
      'VIN 1502': ops.vin1502 || '',
      'ملف المرور': ops.trafficFile || '',
      'Traffic Fees': ops.trafficFeesOps || '',
      Insurance: ops.insuranceOps || '',
      'تاريخ إصدار الاستمارة': ops.registrationIssueDate || '',
      'مدينة الترحيل': ops.transferCity || '',
      'الناقل': ops.carrier || '',
      'الملاحظات': ops.notes || '',
      'Lead Time': raw.leadTime === 0 || raw.leadTime ? raw.leadTime : '',
    };
  });
}

function countMap(vehicles, pick) {
  const map = {};
  (vehicles || []).forEach((v) => {
    const key = String(pick(v) || '').trim() || '(blank)';
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ Name: name, Count: count }));
}

function coordinatorDetailRows(prints) {
  const rows = [];
  (prints || []).forEach((p) => {
    const vins = Array.isArray(p.vins) && p.vins.length ? p.vins : [{}];
    vins.forEach((x) => {
      const vin = x && typeof x === 'object' ? (x.vin || '') : (x || '');
      rows.push({
        Kind: p.kind === 'warehouse' ? 'Warehouse' : (p.label === 'داخلي' ? 'Internal' : 'Delivery note'),
        Company: p.company || '',
        City: p.city || '',
        VIN: vin,
        Product: (x && x.product) || '',
        Customer: (x && x.customer) || '',
        Plate: (x && (x.plate || x.plateNo)) || '',
        Invoice: p.invoiceNumber || '',
        Label: p.label || '',
        'Printed by': p.printedBy || '',
        At: p.at || '',
        Note: p.note || p.notes || '',
      });
    });
  });
  return rows;
}

function printedVinRows(prints) {
  const rows = [];
  (prints || []).forEach((p) => {
    const cars = p.snapshot && Array.isArray(p.snapshot.cars) ? p.snapshot.cars : [];
    const vins = Array.isArray(p.vins) && p.vins.length ? p.vins : [{}];
    vins.forEach((x) => {
      const vin = x && typeof x === 'object' ? (x.vin || '') : (x || '');
      const car = cars.find((c) => String((c && c.chassis) || '').trim().toUpperCase() === String(vin).trim().toUpperCase()) || {};
      const kind = p.kind === 'warehouse'
        ? 'Warehouse'
        : (p.kind === 'display' ? (p.label === 'داخلي' ? 'Internal' : 'Display') : 'Delivery note');
      rows.push({
        'Print id': p.id || '',
        Kind: kind,
        Label: p.label || '',
        Company: p.company || '',
        City: p.city || '',
        Invoice: p.invoiceNumber || '',
        VIN: vin,
        Product: (x && x.product) || car.model || '',
        Customer: (x && x.customer) || '',
        Plate: (x && (x.plate || x.plateNo)) || car.plate || '',
        Remarks: (x && x.remarks) || car.remarks || '',
        'Printed by': p.printedBy || '',
        At: p.at || '',
        Note: p.note || p.notes || '',
      });
    });
  });
  return rows;
}

function assignmentRows(vehicles, pending) {
  const rows = [];
  (vehicles || []).forEach((v) => {
    const ops = v.ops || {};
    const raw = v.raw || {};
    rows.push({
      Source: 'Live Sheet',
      VIN: v.vin || '',
      Employee: ops.assignedEmployeeName || '',
      'Employee Id': ops.assignedEmployeeId || '',
      Status: ops.opsStatus || '',
      'Sales Type': raw.salesType || '',
      'S/A': raw.salesAdvisor || '',
      'Proforma Date': raw.proformaDate || '',
      'Invoice Date': raw.invoiceDate || '',
      Customer: raw.userName || '',
      Product: raw.product || '',
      'Assigned at': ops.assignedAt || '',
      'Assigned by': ops.assignedBy || '',
    });
  });
  const waiting = pending && typeof pending === 'object' ? Object.values(pending) : [];
  waiting.forEach((p) => {
    const raw = (p && p.raw) || {};
    rows.push({
      Source: 'Pending',
      VIN: (p && p.vin) || raw.vin || '',
      Employee: '',
      'Employee Id': '',
      Status: 'Pending',
      'Sales Type': raw.salesType || '',
      'S/A': raw.salesAdvisor || '',
      'Proforma Date': raw.proformaDate || '',
      'Invoice Date': raw.invoiceDate || '',
      Customer: raw.userName || '',
      Product: raw.product || '',
      'Assigned at': '',
      'Assigned by': (p && p.uploadedBy) || '',
    });
  });
  return rows;
}

function buildLiveSheetWorkbook(vehicles, prints) {
  const wb = XLSX.utils.book_new();
  appendSheet(wb, 'Live Sheet', liveSheetRows(vehicles));
  appendSheet(wb, 'Coordinator', coordinatorDetailRows(prints));
  return wb;
}

function buildDataWorkbook(vehicles, prints, pending) {
  const wb = XLSX.utils.book_new();
  appendSheet(wb, 'Printed VINs', printedVinRows(prints));
  appendSheet(wb, 'Live Sheet', liveSheetRows(vehicles));
  appendSheet(wb, 'Assignments', assignmentRows(vehicles, pending));
  return wb;
}

function buildAdminWorkbook(opts) {
  const {
    month,
    currentMonth,
    vehicles,
    attendance,
    prints,
    employees,
    coordinators,
    targets,
    weightsCfg,
    carriers,
    cities,
    inMonth,
    isDelivered,
    kpiEngine,
  } = opts;
  const monthVehicles = (vehicles || []).filter((v) => inMonth(v, month));
  const printed = (vehicles || []).filter((v) => v.ops && v.ops.coordinatorPrintedAt);
  const memos = printed.filter((v) => String(v.ops.coordinatorPrintKind || '') !== 'warehouse');
  const warehouse = printed.filter((v) => String(v.ops.coordinatorPrintKind || '') === 'warehouse');
  const present = (attendance || []).filter((e) => !(e.leftAt || e.usedAt)).length;
  const left = (attendance || []).filter((e) => e.leftAt || e.usedAt).length;

  const wb = XLSX.utils.book_new();

  appendSheet(wb, 'Summary', [{
    Month: month,
    'This month': month === currentMonth ? 'Yes' : 'No',
    'Present now': present,
    'Drivers left': left,
    'Delivery notes': printed.length,
    Memos: memos.length,
    Warehouse: warehouse.length,
    'Live Sheet VINs': (vehicles || []).length,
    'VINs this month': monthVehicles.length,
    'Exported at': new Date().toISOString(),
  }]);

  appendSheet(wb, 'Attendance', (attendance || []).map((e) => ({
    Driver: e.name || '',
    Company: e.company || '',
    Phone: e.phone || '',
    Arrived: e.at || '',
    Left: e.leftAt || e.usedAt || '',
    Status: (e.leftAt || e.usedAt) ? 'left' : 'present',
    VIN: Array.isArray(e.usedVins) ? e.usedVins.join(', ') : '',
    City: e.usedCity || '',
    'Used by': e.usedBy || '',
  })));

  appendSheet(wb, 'Notes by user', (coordinators || []).map((u) => ({
    User: u.name,
    Role: u.role,
    'Printed notes': (vehicles || []).filter((v) => (
      v.ops && v.ops.coordinatorPrintedAt
      && (v.ops.coordinatorPrintedBy === u.name || v.ops.coordinatorPrintedBy === u.id)
    )).length,
  })));

  const cityRows = [];
  (vehicles || []).forEach((v) => {
    if (!v.ops || !v.ops.coordinatorPrintedAt) return;
    if (String(v.ops.coordinatorPrintKind || '') === 'warehouse') return;
    cityRows.push({
      Company: v.ops.coordinatorPrintCompany || v.ops.carrier || '',
      City: v.ops.coordinatorPrintCity || v.ops.transferCity || '',
      VIN: v.vin,
      Product: (v.raw && v.raw.product) || '',
      Customer: (v.raw && v.raw.userName) || '',
      'Printed at': v.ops.coordinatorPrintedAt || '',
      'Printed by': v.ops.coordinatorPrintedBy || '',
      Invoice: v.ops.coordinatorPrintInvoice || '',
    });
  });
  appendSheet(wb, 'Companies by city', cityRows);

  const empRows = (employees || []).map((u) => {
    const mine = monthVehicles.filter((v) => v.ops && v.ops.assignedEmployeeId === u.id);
    const target = Number((targets || {})[u.id]) || 0;
    const total = mine.length;
    const delivered = mine.filter((v) => isDelivered(v)).length;
    const ach = target > 0 ? Math.round((total / target) * 100) : '';
    return {
      Employee: u.name,
      'VIN total': total,
      Delivered: delivered,
      Target: target || '',
      'Ach %': ach,
    };
  });
  const tVin = empRows.reduce((s, r) => s + r['VIN total'], 0);
  const tDel = empRows.reduce((s, r) => s + r.Delivered, 0);
  const tTgt = empRows.reduce((s, r) => s + (Number(r.Target) || 0), 0);
  empRows.push({
    Employee: 'Team',
    'VIN total': tVin,
    Delivered: tDel,
    Target: tTgt || '',
    'Ach %': tTgt > 0 ? Math.round((tVin / tTgt) * 100) : '',
  });
  appendSheet(wb, 'Employees vs target', empRows);

  if (kpiEngine && weightsCfg) {
    const kpiRows = (employees || []).map((u) => {
      const r = kpiEngine.computeEmployeeKpi({
        employeeId: u.id,
        month,
        currentMonth,
        vehicles,
        employees,
        targets,
        weights: weightsCfg.weights,
        enabled: weightsCfg.enabled,
        scoring: weightsCfg.scoring,
        inMonth,
        isDelivered,
      });
      const k = r.kpis || {};
      return {
        Employee: u.name,
        'Overall KPI %': r.overall && r.overall.available ? r.overall.pct : '',
        'Lead Time days': k.leadTime && k.leadTime.available ? k.leadTime.actual : '',
        'Lead Time KPI %': k.leadTime && k.leadTime.available ? k.leadTime.kpiPct : '',
        'Achievement KPI %': k.achievement && k.achievement.available ? k.achievement.kpiPct : '',
        'Contribution KPI %': k.contribution && k.contribution.available ? k.contribution.kpiPct : '',
        'PSFU KPI %': k.psfu && k.psfu.available ? k.psfu.kpiPct : '',
        Note: r.overall && r.overall.message ? r.overall.message : ((r.overall && r.overall.notes) || []).join(' '),
      };
    });
    appendSheet(wb, 'Employee KPI', kpiRows);
    appendSheet(wb, 'KPI weights', (kpiEngine.KPI_KEYS || []).map((key) => ({
      KPI: (kpiEngine.KPI_META[key] && kpiEngine.KPI_META[key].name) || key,
      'Weight %': weightsCfg.enabled[key] ? weightsCfg.weights[key] : 0,
      Enabled: weightsCfg.enabled[key] ? 'Yes' : 'No',
    })));
  }

  appendSheet(wb, 'Printed copies', (prints || []).map((p) => ({
    Kind: p.kind === 'warehouse' ? 'Warehouse' : 'Delivery note',
    Invoice: p.invoiceNumber || '',
    Company: p.company || '',
    City: p.city || '',
    VIN: (p.vins || []).map((x) => x.vin || x).join(', '),
    'Printed by': p.printedBy || '',
    At: p.at || '',
  })));

  appendSheet(wb, 'Companies', (carriers || []).map((name) => ({ Company: name })));
  appendSheet(wb, 'Cities', (cities || []).map((name) => ({ City: name })));
  appendSheet(wb, 'By status', countMap(vehicles, (v) => v.ops && v.ops.opsStatus));
  appendSheet(wb, 'By employee', countMap(vehicles, (v) => v.ops && v.ops.assignedEmployeeName));
  appendSheet(wb, 'By carrier', countMap(vehicles, (v) => v.ops && v.ops.carrier));

  return wb;
}

module.exports = {
  stamp,
  writeBuffer,
  appendSheet,
  liveSheetRows,
  printedVinRows,
  assignmentRows,
  buildLiveSheetWorkbook,
  buildDataWorkbook,
  buildAdminWorkbook,
};
