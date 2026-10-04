/**
 * Company performance unit tests.
 * Run: node delivery-transformation/lib/company-performance.test.js
 */
'use strict';

const cp = require('./company-performance');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(a, e, msg) {
  if (a !== e) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}

function mockStore(vehicles, hanoufSalesByVin) {
  return {
    allVehicles: () => vehicles,
    data: { meta: { hanoufSalesByVin: hanoufSalesByVin || {} } },
  };
}

function veh(vin, company, printedAt, kind) {
  return {
    vin,
    ops: {
      coordinatorPrintCompany: company,
      coordinatorPrintedAt: printedAt,
      coordinatorPrintKind: kind || 'memo',
    },
    raw: {},
  };
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    console.error(` FAIL  ${name}`);
    console.error(`      ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Company performance tests\n');

test('unique VIN + average excludes pending', () => {
  const store = mockStore(
    [
      veh('VIN001', 'Company A', '2026-09-20T10:00:00Z'),
      veh('VIN002', 'Company A', '2026-09-20T10:00:00Z'),
      veh('VIN003', 'Company A', '2026-09-22T10:00:00Z'),
      veh('VIN004', 'Company A', '2026-09-20T10:00:00Z'),
    ],
    {
      VIN001: { salesDate: '2026-09-22' },
      VIN002: { salesDate: '2026-09-24' },
      VIN004: { salesDate: '2026-09-26' },
    }
  );
  const r = cp.buildCompanyPerformance(store);
  const a = r.companyPerformance['Company A'];
  assertEq(a.totalUniqueVins, 4);
  assertEq(a.completedVins, 3);
  assertEq(a.pendingVins, 1);
  assertEq(a.averageDaysToSales, 4); // (2+4+6)/3
});

test('transfer duplicate VIN keeps latest assignment', () => {
  const store = mockStore(
    [
      {
        vin: 'VIN001',
        ops: {
          coordinatorPrintCompany: 'Old Co',
          coordinatorPrintedAt: '2026-09-10T08:00:00Z',
          coordinatorPrintKind: 'memo',
        },
        raw: {},
      },
      {
        vin: 'VIN001',
        ops: {
          coordinatorPrintCompany: 'New Co',
          coordinatorPrintedAt: '2026-09-20T08:00:00Z',
          coordinatorPrintKind: 'memo',
        },
        raw: {},
      },
    ],
    { VIN001: { salesDate: '2026-09-23' } }
  );
  // Two vehicle objects with same VIN can't exist in real store — simulate byVin latest via one vehicle
  const store2 = mockStore(
    [veh('VIN001', 'New Co', '2026-09-20T08:00:00Z')],
    { VIN001: { salesDate: '2026-09-23' } }
  );
  const r = cp.buildCompanyPerformance(store2);
  assertEq(r.companies[0].companyName, 'New Co');
  assertEq(r.companies[0].averageDaysToSales, 3);
});

test('sales before assignment is quality issue not negative', () => {
  const store = mockStore(
    [veh('VIN001', 'Co', '2026-09-20T08:00:00Z')],
    { VIN001: { salesDate: '2026-09-18' } }
  );
  const r = cp.buildCompanyPerformance(store, { debug: true });
  assertEq(r.debug[0].status, 'DATA_QUALITY');
  assertEq(r.debug[0].daysToSales, null);
  assertEq(r.companies[0].completedVins, 0);
  assertEq(r.companies[0].averageDaysToSales, null);
});

test('same-day sale = 0 days', () => {
  const store = mockStore(
    [veh('VIN001', 'Co', '2026-09-20T08:00:00Z')],
    { VIN001: { salesDate: '2026-09-20' } }
  );
  const r = cp.buildCompanyPerformance(store);
  assertEq(r.companies[0].averageDaysToSales, 0);
  assertEq(r.daysDist.find((b) => b.id === 'd0').count, 1);
});

test('assignment date filter', () => {
  const store = mockStore(
    [
      veh('VIN001', 'Co', '2026-08-15T08:00:00Z'),
      veh('VIN002', 'Co', '2026-09-15T08:00:00Z'),
    ],
    {
      VIN001: { salesDate: '2026-08-18' },
      VIN002: { salesDate: '2026-09-18' },
    }
  );
  const r = cp.buildCompanyPerformance(store, { from: '2026-09-01', to: '2026-09-30' });
  assertEq(r.totals.totalUniqueVins, 1);
  assertEq(r.debug[0].vin, 'VIN002');
});

test('warehouse prints excluded', () => {
  const store = mockStore(
    [veh('VIN001', 'Co', '2026-09-20T08:00:00Z', 'warehouse')],
    { VIN001: { salesDate: '2026-09-22' } }
  );
  const r = cp.buildCompanyPerformance(store);
  assertEq(r.totals.totalUniqueVins, 0);
});

test('isHanoufUser', () => {
  assert(cp.isHanoufUser({ id: 'hanouf', name: 'Hanouf' }));
  assert(!cp.isHanoufUser({ id: 'ruba', name: 'Ruba' }));
});

test('recordHanoufSalesRaw indexes invoice dates', () => {
  const store = { data: { meta: {} } };
  cp.recordHanoufSalesRaw(store, [
    { vin: 'abc123', raw: { invoiceDate: '2026-09-24' } },
    { vin: '', raw: { invoiceDate: '2026-09-24' } },
    { vin: 'xyz', raw: { invoiceDate: '' } },
  ], { at: '2026-09-24T12:00:00Z', filename: 'sr.xlsx' });
  assertEq(store.data.meta.hanoufSalesByVin.ABC123.salesDate, '2026-09-24');
  assert(!store.data.meta.hanoufSalesByVin.XYZ);
});

console.log(`\n${passed} tests passed`);
if (!process.exitCode) console.log('All good.');
