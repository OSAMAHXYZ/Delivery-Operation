/**
 * Full Excel extract round-trip.
 * Run: node delivery-transformation/lib/full-excel.test.js
 */
'use strict';

const fullExcel = require('./full-excel');
const exportExcel = require('./export-excel');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach((k) => {
      if (v[k] == null || v[k] === '') return;
      out[k] = canon(v[k]);
    });
    return out;
  }
  return v;
}

function same(a, b, msg) {
  const left = JSON.stringify(canon(a));
  const right = JSON.stringify(canon(b));
  if (left !== right) {
    throw new Error(`${msg || 'mismatch'}\n expected ${right}\n got      ${left}`);
  }
}

const data = {
  vehicles: {
    STLS3CH1T5720894: {
      vin: 'STLS3CH1T5720894',
      createdAt: '2026-10-03T17:58:14.000Z',
      createdBy: 'Hanouf',
      rawUpdatedAt: '2026-10-03T17:58:14.000Z',
      raw: {
        vin: 'STLS3CH1T5720894',
        product: 'LAND CRUISER',
        salesType: 'Cash',
        phone: '0500000001',
        userName: 'عميل',
        proformaDate: '2026-10-01',
        leadTime: 0,
        gtLocation: 'جدة',
      },
      ops: {
        opsStatus: 'جاهز للتسليم',
        transferCity: 'مدينة الترحيل',
        carrier: 'طريق الراسي',
        assignedEmployeeId: 'hanouf',
        assignedEmployeeName: 'Hanouf',
        guestCollected: false,
        statusHistory: [{ status: 'مرور', at: '2026-10-02T08:00:00.000Z' }],
        notes: '',
      },
    },
  },
  attendance: [{
    id: 'att1',
    at: '2026-10-04T06:00:00.000Z',
    name: 'سائق',
    company: 'طريق الراسي',
    phone: '0551234567',
    usedVins: ['STLS3CH1T5720894'],
  }],
  prints: [{
    id: 'prn1',
    at: '2026-10-04T07:00:00.000Z',
    kind: 'memo',
    company: 'طريق الراسي',
    city: 'جدة',
    vins: [{ vin: 'STLS3CH1T5720894', product: 'LAND CRUISER', customer: 'عميل' }],
    snapshot: { cars: [{ chassis: 'STLS3CH1T5720894', model: 'LAND CRUISER' }] },
    invoiceNumber: 1001,
  }],
  audit: [{
    id: 'aud1',
    at: '2026-10-04T07:01:00.000Z',
    user: 'Hanouf',
    action: 'update',
    vin: 'STLS3CH1T5720894',
    oldValue: 'ops.carrier: (empty)',
    newValue: 'ops.carrier: طريق الراسي',
  }],
  meta: {
    memoInvoiceNext: 1002,
    customCarriers: ['طريق الراسي'],
    customCities: ['جدة', 'الرياض'],
    targets: { '2026-10': { hanouf: 40, ruba: 40 } },
    vacations: { ibrahim: { until: '2026-10-20', by: 'Hanouf', at: '2026-10-01T00:00:00.000Z' } },
    pendingAssignments: {
      JTNEW0001: {
        vin: 'JTNEW0001',
        raw: { vin: 'JTNEW0001', proformaDate: '2026-10-04', salesType: 'Bank' },
        uploadedBy: 'Hanouf',
      },
    },
    hanoufSalesByVin: { STLS3CH1T5720894: { salesDate: '2026-10-03', at: '2026-10-03T12:00:00.000Z' } },
    kpiWeights: { leadTime: 25, achievement: 25 },
    sla: [{ id: 'ready', label: 'جاهز للتسليم', targetDay: 5 }],
    imports: { lastSalesRaw: { at: '2026-10-03T08:00:00.000Z', by: 'Hanouf', rows: 10 } },
  },
};

const wb = fullExcel.buildFullWorkbook(data);
const parsed = fullExcel.parseFullWorkbook(exportExcel.writeBuffer(wb));
same(parsed.vehicles, data.vehicles, 'vehicles');
same(parsed.attendance, data.attendance, 'attendance');
same(parsed.prints, data.prints, 'prints');
same(parsed.audit, data.audit, 'audit');
same(parsed.meta, data.meta, 'meta');
assert(parsed.counts.Vehicles === 1, 'vehicle count');
assert(parsed.counts.Attendance === 1, 'attendance count');
assert(parsed.counts.Meta === Object.keys(data.meta).length, 'meta count');

let rejected = false;
try {
  fullExcel.parseFullWorkbook(exportExcel.writeBuffer(exportExcel.buildAdminWorkbook({
    month: '2026-10',
    currentMonth: '2026-10',
    vehicles: [],
    attendance: [],
    prints: [],
    employees: [],
    coordinators: [],
    targets: {},
    carriers: [],
    cities: [],
    inMonth: () => true,
    isDelivered: () => false,
  })));
} catch (err) {
  rejected = /not a full data extract/i.test(err.message);
}
assert(rejected, 'report excel must not import as full data');

const empty = fullExcel.parseFullWorkbook(exportExcel.writeBuffer(fullExcel.buildFullWorkbook({
  vehicles: {}, attendance: [], prints: [], audit: [], meta: {},
})));
assert(empty.counts.Vehicles === 0 && empty.counts.Audit === 0, 'empty extract');
same(empty.vehicles, {}, 'empty vehicles');

console.log('full-excel tests passed');
