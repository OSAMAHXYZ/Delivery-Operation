/**
 * Plan Tracker calculation tests (Node).
 * Run: node report-sheet/plan-tracker.test.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");

const RES = "Retail Electronic Sales";
const FLEET = "Fleet";

function d(y, m, day) {
  return new Date(y, m - 1, day);
}

function veh(vin, searchArea, age, agDate, extra) {
  return Object.assign({
    vin,
    searchArea,
    allocationAge: age,
    allocationDate: agDate,
    product: "CAMRY",
    suffix: "G",
  }, extra || {});
}

function pack(month, dayMap) {
  const days = {};
  Object.keys(dayMap).forEach((dk) => {
    days[dk] = { id: dk, vehicles: dayMap[dk] };
  });
  return { month, days };
}

function build(dayMap, month) {
  return PT.buildModel(pack(month || "2025-09", dayMap), { silent: true });
}

function loadPlanTracker() {
  const code = fs.readFileSync(path.join(__dirname, "plan-tracker.js"), "utf8");
  const sandbox = {
    console,
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ click() {}, set href(_) {}, get href() { return ""; } }),
    },
    URL: { createObjectURL: () => "", revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout,
    globalThis: null,
    window: null,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: "plan-tracker.js" });
  return sandbox.PlanTracker;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "assertEq"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const PT = loadPlanTracker();
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

console.log("Plan Tracker tests\n");

test("normalizeVin trims and uppercases", () => {
  assertEq(PT.normalizeVin("  abc123  "), "ABC123");
  assertEq(PT.normalizeVin(""), "");
  assertEq(PT.normalizeVin(null), "");
});

test("isRES matches contains Retail Electronic Sales", () => {
  assert(PT.isRES({ searchArea: RES }));
  assert(PT.isRES({ searchArea: "  retail electronic sales  " }));
  assert(!PT.isRES({ searchArea: FLEET }));
  assert(!PT.isRES({ searchArea: "" }));
});

test("Test 1 — Duplicate VIN same day", () => {
  const model = build({
    "2025-09-13": [
      veh("VIN001", RES, 0, d(2025, 9, 13)),
      veh("VIN001", RES, 0, d(2025, 9, 13)),
    ],
  });
  const day = model.daily[0];
  assertEq(day.dailyUniqueRESAge0, 1, "daily RES age 0");
  assertEq(day.newPlanAllocations, 1, "plan allocation");
  assertEq(model.kpis.allocated, 1, "cumulative allocated");
  assertEq(model.quality.duplicateVin, 1, "duplicate flagged");
});

test("Test 2 — Same VIN next day does not double-count plan", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
    "2025-09-14": [veh("VIN001", RES, 0, d(2025, 9, 13))],
  });
  assertEq(model.daily[0].newPlanAllocations, 1, "13 Sep allocation");
  assertEq(model.daily[1].newPlanAllocations, 0, "14 Sep allocation");
  assertEq(model.daily[1].cumulativePlanAllocations, 1, "cumulative");
  assertEq(model.kpis.allocated, 1);
  // Daily RES age 0 still 1 on day 14 (independent of 315)
  assertEq(model.daily[1].dailyUniqueRESAge0, 1, "daily RES age 0 still visible");
});

test("Test 3 — Transfer into RES is not a plan receipt", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", FLEET, 0, d(2025, 9, 13))],
    "2025-09-14": [veh("VIN001", RES, 0, d(2025, 9, 14))],
  });
  assertEq(model.daily[1].transferIn.length, 1, "transfer in");
  assertEq(model.daily[1].newPlanAllocations, 0, "plan allocation");
  assertEq(model.kpis.allocated, 0);
  assertEq(model.firstAreaByVin.get("VIN001"), FLEET);
  assert(model.movements.some((m) => m.movementType === "TRANSFERRED INTO RES"));
});

test("Test 4 — Genuine new allocation", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
  });
  assertEq(model.daily[0].newPlanAllocations, 1);
  assertEq(model.daily[0].cumulativePlanAllocations, 1);
  assertEq(model.kpis.allocated, 1);
  assertEq(model.kpis.remaining, 314);
  assert(model.movements.some((m) => m.movementType === "NEW ALLOCATION"));
});

test("Test 5 — Prior-month stock is free stock", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 8, 20))],
  });
  assertEq(model.daily[0].freeStockCount, 1, "free stock");
  assertEq(model.daily[0].newPlanAllocations, 0, "plan allocation");
  assertEq(model.kpis.freeStock, 1);
  assertEq(model.kpis.allocated, 0);
  assertEq(model.kpis.totalReceived, 1);
  assertEq(model.kpis.progress, 0);
});

test("Test 6 — RES disappears; historical allocation kept", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
    "2025-09-14": [],
  });
  assertEq(model.daily[0].newPlanAllocations, 1);
  assertEq(model.daily[1].disappearedTarget, 1, "disappeared RES");
  assertEq(model.daily[1].cumulativePlanAllocations, 1, "historical plan kept");
  assertEq(model.kpis.allocated, 1);
  assert(model.movements.some((m) => m.movementType === "DISAPPEARED"));
});

test("Daily RES Age 0 example (duplicates + non-RES excluded)", () => {
  const model = build({
    "2025-09-13": [
      veh("VIN001", RES, 0, d(2025, 9, 13)),
      veh("VIN002", RES, 0, d(2025, 9, 13)),
      veh("VIN002", RES, 0, d(2025, 9, 13)),
      veh("VIN003", RES, 1, d(2025, 9, 12)),
      veh("VIN004", FLEET, 0, d(2025, 9, 13)),
    ],
  });
  assertEq(model.daily[0].dailyUniqueRESAge0, 2, "VIN001 + VIN002");
  assertEq(model.daily[0].newPlanAllocations, 2, "both genuine plan receipts");
});

test("Progress never uses daily RES count", () => {
  const model = build({
    "2025-09-13": [
      veh("VIN001", RES, 0, d(2025, 9, 13)),
      veh("VIN002", RES, 1, d(2025, 9, 12)),
      veh("VIN003", RES, 0, d(2025, 8, 1)),
    ],
  });
  // 1 plan + 1 free + 1 aged RES visible
  assertEq(model.daily[0].dailyUniqueRESAge0, 2); // VIN001 age0 + VIN003 age0 free
  assertEq(model.kpis.allocated, 1);
  assertEq(model.kpis.freeStock, 1);
  assertEq(model.kpis.progress, 1 / 315);
  assertEq(model.daily[0].progress, 1 / 315);
});

test("planTrackerDebug shape", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
  });
  const dbg = model.planTrackerDebug[0];
  assert(dbg.date === "2025-09-13");
  assert(typeof dbg.dailyUniqueRESAge0 === "number");
  assert(Array.isArray(dbg.planReceipts));
  assert(dbg.reconciliation && typeof dbg.reconciliation.difference === "number");
});

test("Reconciliation OK for stay / transfer / disappear", () => {
  const model = build({
    "2025-09-13": [
      veh("A", RES, 0, d(2025, 9, 13)),
      veh("B", FLEET, 0, d(2025, 9, 13)),
    ],
    "2025-09-14": [
      veh("A", RES, 1, d(2025, 9, 13)),
      veh("B", RES, 0, d(2025, 9, 14)),
    ],
    "2025-09-15": [
      veh("B", RES, 1, d(2025, 9, 14)),
    ],
  });
  model.daily.forEach((day) => {
    assert(day.reconOk, `${day.dateKey} recon failed: expected ${day.expectedRES} actual ${day.actualRES}`);
  });
  assertEq(model.kpis.allocated, 1); // only A
  assertEq(model.daily[1].transferIn.length, 1); // B
  assertEq(model.daily[2].disappearedTarget, 1); // A gone
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error("Some tests failed");
} else {
  console.log("All good.");
}
