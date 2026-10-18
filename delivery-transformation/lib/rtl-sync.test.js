'use strict';

const assert = require('assert');
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function stubXlsx(id) {
  if (id === 'xlsx') return { read() { return { SheetNames: [], Sheets: {} }; }, utils: {} };
  return originalRequire.apply(this, arguments);
};
const { applyRtlPush, classifyRtlRow, locationRuleApplies, markDeliveryNote } = require('./rtl-sync');
const { saveCity, saveCompany } = require('./org');
const { chooseSalesRawDuplicates, normalizeDate } = require('./importer');

function fakeStore() {
  const data = { vehicles: {}, audit: [], meta: {} };
  return {
    data,
    getVehicle(vin) { return data.vehicles[vin] || null; },
    upsertVehicle(vin, vehicle) { data.vehicles[vin] = vehicle; },
    pushAudit(entry) { data.audit.unshift(entry); },
    save() {},
  };
}

const telesales = '7022 Telesales North';
const ecommerce = '7277 eCommerce Sales – Retail';

const first = applyRtlPush(fakeStore(), [
  { vin: ' jtmabbbj1t4239991 ', product: 'LC300', location: telesales, vehicleSearchArea: 'Other', age: '3' },
  { vin: 'JTMABBBJ1T4239991', product: 'dup', location: telesales },
  { vin: '', location: telesales },
  { vin: 'JT111111111111112', product: 'Camry', location: ecommerce, vehicleSearchArea: 'Yard' },
], { id: 'snap-1', at: '2026-10-19T00:00:00.000Z', date: '2026-10-19', fileName: 'rtl.xlsx' });

assert.strictEqual(first.ok, true);
assert.strictEqual(first.unique, 2);
assert.strictEqual(first.duplicate, 1);
assert.strictEqual(first.rejected, 1);

const store = fakeStore();
applyRtlPush(store, [
  { vin: 'JTMABBBJ1T4239991', location: telesales, vehicleSearchArea: 'Yard' },
], { id: 'snap-1', date: '2026-10-19' });
const again = applyRtlPush(store, [
  { vin: 'JTMABBBJ1T4239991', location: telesales, vehicleSearchArea: 'Yard' },
], { id: 'snap-1', date: '2026-10-19' });
assert.strictEqual(again.skipped, true);
assert.strictEqual(Object.keys(store.data.meta.rtlStock).length, 1);
assert.strictEqual(store.data.meta.rtlStock.JTMABBBJ1T4239991.stockClass, 'STOCK IN');

const moved = fakeStore();
applyRtlPush(moved, [
  { vin: 'JT222222222222223', location: 'Other Yard', vehicleSearchArea: 'Central' },
], { id: 'snap-a', date: '2026-10-19' });
applyRtlPush(moved, [
  { vin: 'JT222222222222223', location: 'Retail desk', vehicleSearchArea: 'Retail Electronic Sales' },
], { id: 'snap-b', date: '2026-10-19' });
assert.strictEqual(moved.data.meta.rtlStock.JT222222222222223.stockClass, 'SWAPPED IN');

const out = fakeStore();
applyRtlPush(out, [
  { vin: 'JT333333333333334', location: 'Retail desk', vehicleSearchArea: 'Retail Electronic Sales' },
], { id: 'snap-c', date: '2026-10-19' });
applyRtlPush(out, [
  { vin: 'JT333333333333334', location: '7022 Telesales North', vehicleSearchArea: 'Central' },
], { id: 'snap-d', date: '2026-10-19' });
assert.strictEqual(out.data.meta.rtlStock.JT333333333333334.stockClass, 'SWAPPED OUT');
assert.strictEqual(out.data.meta.rtlStock.JT333333333333334.location, '7022 Telesales North');

const gone = fakeStore();
applyRtlPush(gone, [
  { vin: 'JT444444444444445', location: ecommerce },
], { id: 'snap-e', date: '2026-10-19' });
applyRtlPush(gone, [], { id: 'snap-f', date: '2026-10-19' });
assert.strictEqual(gone.data.meta.rtlStock.JT444444444444445.stockClass, 'MISSING FROM RTL');
assert.strictEqual(gone.data.meta.rtlStock.JT444444444444445.location, ecommerce);

const noted = fakeStore();
noted.data.vehicles.JT555555555555556 = { vin: 'JT555555555555556', ops: { coordinatorPrintedAt: '2026-10-01T00:00:00.000Z' } };
applyRtlPush(noted, [
  { vin: 'JT555555555555556', location: telesales },
], { id: 'snap-g', date: '2026-10-19' });
assert.strictEqual(noted.data.meta.rtlStock.JT555555555555556.stockClass, 'WITH DELIVERY NOTE');
assert.notStrictEqual(noted.data.meta.rtlStock.JT555555555555556.stockClass, 'DELIVERED');

assert.strictEqual(locationRuleApplies('ruba'), false);
assert.strictEqual(locationRuleApplies({ userId: 'ruba' }), false);
assert.strictEqual(locationRuleApplies('alfadel'), true);
const rubaStore = fakeStore();
applyRtlPush(rubaStore, [{ vin: 'JT666666666666667', location: telesales }], { id: 'snap-h', date: '2026-10-19' });
assert.strictEqual(rubaStore.data.meta.rtlStock.JT666666666666667.stockClass, 'STOCK IN');
assert.strictEqual(locationRuleApplies('ruba'), false);

const alloc = classifyRtlRow({}, {
  vin: 'JT777777777777778',
  location: 'Showroom',
  vehicleSearchArea: 'Retail Electronic Sales',
  age: '0',
  allocationDate: '2026-10-19',
}, { fileDate: '2026-10-19' });
assert.strictEqual(alloc.stockClass, 'NEW ALLOCATION');

const mine = classifyRtlRow({}, {
  vin: 'JT888888888888889',
  location: 'Showroom',
  secondaryStatus: 'Vehicle allocation completed',
}, {});
assert.strictEqual(mine.stockClass, 'FREE IN MY STOCK');

const picked = chooseSalesRawDuplicates([
  { vin: 'JT999999999999990', raw: { proformaDate: '2026-09-01' } },
  { vin: 'JT999999999999990', raw: { proformaDate: '2026-10-02' } },
  { vin: 'JT999999999999990', raw: { proformaDate: '2026-08-01' } },
]);
assert.strictEqual(picked.unique[0].raw.proformaDate, '2026-10-02');
assert.strictEqual(picked.duplicates, 2);

const tied = chooseSalesRawDuplicates([
  { vin: 'JTA00000000000001', raw: { proformaDate: '2026-10-02', salesOrder: 'first' } },
  { vin: 'JTA00000000000001', raw: { proformaDate: '2026-10-02', salesOrder: 'last' } },
]);
assert.strictEqual(tied.unique[0].raw.salesOrder, 'last');

assert.strictEqual(normalizeDate('2026-10-19'), '2026-10-19');
assert.strictEqual(normalizeDate('19/10/2026'), '2026-10-19');
assert.strictEqual(normalizeDate(45949).slice(0, 4), '2025');
assert.strictEqual(normalizeDate('not-a-date'), '');

const invalid = chooseSalesRawDuplicates([
  { vin: 'JTB00000000000002', raw: { proformaDate: '' } },
  { vin: 'JTB00000000000002', raw: { proformaDate: '2026-09-15' } },
]);
assert.strictEqual(invalid.unique[0].raw.proformaDate, '2026-09-15');
assert.strictEqual(invalid.invalidDates, 1);

const meta = {};
const city = saveCity(meta, { name: 'Jeddah' });
assert.strictEqual(city.city.country, 'Saudi Arabia');
assert.strictEqual(saveCity(meta, { name: ' jeddah ' }).error.includes('already'), true);
const company = saveCompany(meta, { name: 'Jamal', code: 'JM', cityId: city.city.id });
assert.strictEqual(company.company.cityId, city.city.id);
assert.strictEqual(saveCompany(meta, { name: 'Other', code: 'jm' }).error.includes('code'), true);
company.company.active = false;
assert.strictEqual(meta.orgCities.length, 1);
assert.strictEqual(meta.orgCompanies.length, 1);
const beforeStock = JSON.stringify(meta.rtlStock || {});
saveCity(meta, { name: 'Riyadh' });
assert.strictEqual(JSON.stringify(meta.rtlStock || {}), beforeStock);

markDeliveryNote(noted, 'JT555555555555556');
assert.strictEqual(noted.data.meta.rtlStock.JT555555555555556.stockClass, 'WITH DELIVERY NOTE');

console.log('rtl-sync tests passed');
