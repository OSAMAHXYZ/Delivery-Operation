/**
 * Inventory Command Center — data layer (real Excel only · no mock counts)
 *
 * ============================================================
 * DATA MAPPING (Admin Push slots ↔ workbooks)
 * ============================================================
 * backorder  → Back Orders *.xlsx
 *              Product, ALJ/TMC Suffix, Model Year, Exterior, Interior,
 *              VIN, Order Date, Aging, BO qty (header or Col AD)
 *              Priority: primary source for Back Orders (1 row ≈ 1 unit / qty)
 *
 * rtl        → rtlstock.xlsx / RTL Stock
 *              Col B Product, E VIN, F Year, G Suffix, H Ext, I Int, J Ageing
 *              Priority: PRIMARY Available Stock (VIN deduped within RTL)
 *
 * central    → Stock E-Sales / central.xlsx (slot title: Stock E-Sales)
 *              Same stock column map as RTL when mapped via mapStockInv
 *              Priority: SECONDARY Available Stock (VIN deduped within source)
 *              NOTE: counted in Available Stock separately from E-Sales plan
 *
 * sales      → Sales Raw Data - TeleSales *.xlsx
 *              Product (+ Model Year when present), delivery/proforma dates, qty
 *              Priority: PRIMARY Sales & Sales Velocity
 *              Join: Product (+ Year when both sides have year)
 *
 * accessories→ accessoriessss.xlsx
 *              Data-quality / row counts only (not inventory metrics)
 *
 * allocation → Admin E-Sales plan values (allocation-plan-data.js leaves)
 *              Metric: E-Sales Stock (Product + Suffix) — NOT added into Available Stock
 *
 * Conflict rules (documented · never silent):
 *   Available Stock = RTL VINs + Central/E-Sales-file VINs (per-source VIN dedupe)
 *   E-Sales Stock   = allocation plan leaf values (separate KPI column)
 *   Sales           = Sales Raw only
 *   Back Orders     = Back Order file only
 *
 * Sales Velocity = unique attributed Sales ÷ periodDays
 *   periodDays = live report range when set, else min→max sale dates in file, else 30
 *
 * Stock Coverage = Available Stock / Back Orders (null when BO = 0 → display "∞ (no BO)")
 */
(function (global) {
  /** Single source of truth for thresholds — do not duplicate elsewhere */
  const CONFIG = {
    coverage: {
      criticalMax: 0.5, // < 0.50 Critical (with high demand)
      atRiskMax: 1.0, // < 1.00 At Risk
      balancedMax: 1.5, // < 1.50 Balanced; >= Healthy when velocity healthy
    },
    quadrants: {
      autoThresholds: true,
      coverageSplit: 1.0, // business: stock covers BO
      velocitySplit: null, // median velocity when auto
    },
    demand: {
      boWeight: 0.55,
      velocityWeight: 0.35,
      scarcityWeight: 0.1,
      highPressure: 70,
      moderatePressure: 40,
    },
    ageing: {
      highDays: 30,
    },
    bubble: {
      minR: 12,
      maxR: 36,
    },
    pageSize: 50,
    vinListMax: 200,
  };

  const QUADRANT_META = {
    CRITICAL: {
      label: "High demand · Low stock",
      action: "PRIORITIZE ALLOCATION",
      zone: "top-left",
    },
    FAST_MOVING: {
      label: "High demand · High stock",
      action: "HEALTHY COVERAGE",
      zone: "top-right",
    },
    WATCH: {
      label: "Low demand · Low stock",
      action: "MONITOR / REVIEW",
      zone: "bottom-left",
    },
    OVERSTOCK: {
      label: "Low demand · High stock",
      action: "SLOW MOVING / REVIEW",
      zone: "bottom-right",
    },
  };

  function upperTrim(v) {
    return String(v ?? "").trim().toUpperCase();
  }

  function compact(v) {
    return upperTrim(v).replace(/[^A-Z0-9]/g, "");
  }

  function colorKey(v) {
    return compact(v);
  }

  function isFortuner(product) {
    return compact(product).includes("FORTUNER");
  }

  function normalizeSuffix(product, suffix) {
    const s = String(suffix ?? "").trim();
    if (!s || s === "—") return s || "";
    if (!isFortuner(product)) return upperTrim(s);
    const c = compact(s);
    return c ? c.slice(0, 2) : upperTrim(s);
  }

  function normalizeYear(y) {
    const s = String(y ?? "").trim();
    if (!s) return "";
    const m = s.match(/(20\d{2}|19\d{2})/);
    return m ? m[1] : s;
  }

  function toNum(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function safeDiv(num, den) {
    if (!den || !Number.isFinite(den) || den === 0) return null;
    if (!Number.isFinite(num)) return null;
    return num / den;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function median(arr) {
    const a = (arr || []).filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function parseLooseDate(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
    if (v == null || v === "") return null;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v > 20000 && v < 80000) {
        const epoch = Date.UTC(1899, 11, 30);
        const d = new Date(epoch + Math.round(v) * 86400000);
        return Number.isNaN(d.getTime()) ? null : d;
      }
    }
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function configParts(row, helpers) {
    const product = upperTrim(row.product || row.Product || "");
    const suffix = normalizeSuffix(product, row.suffix || row.sfx || row["Alj Suffix"] || "");
    const year = normalizeYear(row.year || row["Model Year"] || row.modelYear || "");
    const ext = colorKey(row.ext || row.exterior || row["Exterior Color"] || "");
    const intc = colorKey(row.int || row.interior || row["Interior Color"] || "");
    const vin = helpers && helpers.extractVin
      ? helpers.extractVin(row.vin || row.VIN || "")
      : upperTrim(row.vin || row.VIN || "");
    return { product, suffix, year, ext, int: intc, vin };
  }

  function keyAtLevel(parts, level) {
    const bits = [parts.product || "_"];
    if (level >= 1) bits.push(parts.suffix || "_");
    if (level >= 2) bits.push(parts.year || "_");
    if (level >= 3) bits.push(parts.ext || "_");
    if (level >= 4) bits.push(parts.int || "_");
    return bits.join("|");
  }

  function salesJoinKey(parts) {
    if (parts.year) return `P:${parts.product}|Y:${parts.year}`;
    return `P:${parts.product}`;
  }

  function esalesKey(product, suffix) {
    return `${compact(product) || upperTrim(product)}|${normalizeSuffix(product, suffix)}`;
  }

  /**
   * Inventory status from CONFIG bands + ageing/velocity.
   * Critical requires scarcity AND high demand pressure.
   */
  function classifyInventoryStatus(r, velSplit, cfg) {
    const cov = r.stockCoverage;
    const vel = Number(r.salesVelocity) || 0;
    const age = r.allocationAgeing;
    const highDemand = r.demandPressure >= cfg.demand.highPressure || vel >= velSplit;
    const highAge = age != null && age >= cfg.ageing.highDays;
    const lowVel = vel < velSplit;

    if (highAge && lowVel && (r.availableStock || 0) > 0) return "Slow Moving";
    if (cov == null) {
      if ((r.availableStock || 0) > 0 && lowVel) return "Slow Moving";
      if ((r.backOrders || 0) > 0 && !(r.availableStock > 0)) return "Critical";
      return "Healthy";
    }
    if (cov < cfg.coverage.criticalMax && highDemand) return "Critical";
    if (cov < cfg.coverage.criticalMax) return "At Risk";
    if (cov < cfg.coverage.atRiskMax) return "At Risk";
    if (cov < cfg.coverage.balancedMax) return "Balanced";
    if (lowVel) return "Slow Moving";
    return "Healthy";
  }

  function recommendedAction(status, quadrant) {
    if (status === "Critical" || quadrant === "CRITICAL") {
      return QUADRANT_META.CRITICAL.action;
    }
    if (status === "At Risk") return "PROTECT ALLOCATION / MONITOR REPLENISHMENT";
    if (status === "Slow Moving" || quadrant === "OVERSTOCK") {
      return QUADRANT_META.OVERSTOCK.action;
    }
    if (status === "Balanced") return "MAINTAIN BALANCE / WATCH DEMAND";
    if (status === "Healthy" || quadrant === "FAST_MOVING") {
      return QUADRANT_META.FAST_MOVING.action;
    }
    if (quadrant === "WATCH") return QUADRANT_META.WATCH.action;
    return "MONITOR";
  }

  function quadrantOf(coverage, velocity, covSplit, velSplit) {
    const cov = coverage == null ? Infinity : coverage;
    const highCov = cov >= covSplit;
    const highVel = velocity >= velSplit;
    if (!highCov && highVel) return "CRITICAL";
    if (highCov && highVel) return "FAST_MOVING";
    if (highCov && !highVel) return "OVERSTOCK";
    return "WATCH";
  }

  function aggregateUnits(map, key, add) {
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        key,
        backOrders: 0,
        availableStock: 0,
        rtlStock: 0,
        centralStock: 0,
        eSalesStock: 0,
        sales: 0,
        ageingSum: 0,
        ageingCount: 0,
        vins: new Set(),
        products: new Set(),
        suffixes: new Set(),
        years: new Set(),
        exts: new Set(),
        ints: new Set(),
        sample: null,
      });
    }
    add(map.get(key));
  }

  function pickLabel(set, fallback) {
    const vals = [...set].filter((x) => x && x !== "_");
    if (!vals.length) return fallback || "—";
    if (vals.length === 1) return vals[0];
    return `${vals[0]} (+${vals.length - 1})`;
  }

  function build(input) {
    const cfg = {
      ...CONFIG,
      coverage: { ...CONFIG.coverage, ...(input.configOverrides && input.configOverrides.coverage) },
      quadrants: { ...CONFIG.quadrants, ...(input.configOverrides && input.configOverrides.quadrants) },
      demand: { ...CONFIG.demand, ...(input.configOverrides && input.configOverrides.demand) },
      ageing: { ...CONFIG.ageing, ...(input.configOverrides && input.configOverrides.ageing) },
      bubble: { ...CONFIG.bubble, ...(input.configOverrides && input.configOverrides.bubble) },
    };
    const level = clamp(Number(input.drillLevel) || 0, 0, 4);
    const helpers = input.helpers || {};
    const boQty = helpers.boQty || (() => 1);

    const dq = {
      sourceRows: {
        backorder: (input.boRows || []).length,
        rtl: (input.rtlRows || []).length,
        central: (input.centralRows || []).length,
        sales: (input.salesRows || []).length,
        accessories: (input.accessoryRows || []).length,
        allocationLeaves: (input.allocationLeaves || []).length,
      },
      duplicateVins: 0,
      missingProduct: 0,
      missingSuffix: 0,
      missingYear: 0,
      missingExt: 0,
      missingInt: 0,
      matchedConfigs: 0,
      unmatchedBoKeys: 0,
      unmatchedStockKeys: 0,
      uniqueVins: 0,
      matchedVins: 0,
    };

    let periodDays = Number(input.periodDays) || 0;
    const saleDates = [];
    (input.salesRows || []).forEach((r) => {
      const d = parseLooseDate(r.deliveryDate || r.proformaDate || r.date);
      if (d) saleDates.push(d.getTime());
    });
    if (!periodDays && saleDates.length) {
      const min = Math.min(...saleDates);
      const max = Math.max(...saleDates);
      periodDays = Math.max(1, Math.round((max - min) / 86400000) + 1);
    }
    if (!periodDays) periodDays = 30;

    const eSalesMap = new Map();
    (input.allocationLeaves || []).forEach((leaf) => {
      if (!leaf || leaf.kind === "total") return;
      const product = leaf.product || "";
      const suffix = leaf.sfx || leaf.suffix || "";
      const k = esalesKey(product, suffix);
      eSalesMap.set(k, (eSalesMap.get(k) || 0) + (Number(leaf.allocation) || 0));
    });

    const salesMap = new Map();
    (input.salesRows || []).forEach((r) => {
      const product = upperTrim(r.product || r.Product || r.model || "");
      if (!product) {
        dq.missingProduct += 1;
        return;
      }
      const year = normalizeYear(r.year || r["Model Year"] || r.modelYear || "");
      const parts = { product, year };
      const kExact = salesJoinKey(parts);
      const kProd = `P:${product}`;
      const qty = Math.max(1, toNum(r.qty) || 1);
      salesMap.set(kExact, (salesMap.get(kExact) || 0) + qty);
      if (year) salesMap.set(kProd, (salesMap.get(kProd) || 0) + qty);
    });

    const buckets = new Map();

    function touchMeta(b, parts) {
      if (parts.product) b.products.add(parts.product);
      if (parts.suffix) b.suffixes.add(parts.suffix);
      if (parts.year) b.years.add(parts.year);
      if (parts.ext) b.exts.add(parts.ext);
      if (parts.int) b.ints.add(parts.int);
      if (!b.sample) b.sample = { ...parts };
    }

    (input.boRows || []).forEach((r) => {
      const parts = configParts(r, helpers);
      if (!parts.product) {
        dq.missingProduct += 1;
        return;
      }
      if (!parts.suffix) dq.missingSuffix += 1;
      if (!parts.year) dq.missingYear += 1;
      if (!parts.ext) dq.missingExt += 1;
      if (!parts.int) dq.missingInt += 1;
      const key = keyAtLevel(parts, level);
      const qty = Math.max(1, toNum(r.qty) || boQty(r) || 1);
      aggregateUnits(buckets, key, (b) => {
        b.backOrders += qty;
        touchMeta(b, parts);
      });
    });

    function ingestStock(rows, sourceField) {
      const seenVin = new Set();
      (rows || []).forEach((r) => {
        const parts = configParts(r, helpers);
        if (!parts.product) {
          dq.missingProduct += 1;
          return;
        }
        if (!parts.suffix) dq.missingSuffix += 1;
        if (!parts.year) dq.missingYear += 1;
        if (!parts.ext) dq.missingExt += 1;
        if (!parts.int) dq.missingInt += 1;

        const vin = parts.vin;
        if (vin) {
          const vk = `${sourceField}:${vin}`;
          if (seenVin.has(vk)) {
            dq.duplicateVins += 1;
            return;
          }
          seenVin.add(vk);
        }

        const key = keyAtLevel(parts, level);
        const age = toNum(r.ageing != null ? r.ageing : r.aging);
        aggregateUnits(buckets, key, (b) => {
          b.availableStock += 1;
          if (sourceField === "rtl") b.rtlStock += 1;
          else b.centralStock += 1;
          if (vin) b.vins.add(vin);
          if (Number.isFinite(age) && age >= 0) {
            b.ageingSum += age;
            b.ageingCount += 1;
          }
          touchMeta(b, parts);
        });
      });
    }
    ingestStock(input.rtlRows, "rtl");
    ingestStock(input.centralRows, "central");

    buckets.forEach((b) => {
      const product = pickLabel(b.products, b.sample && b.sample.product);
      const suffix = pickLabel(b.suffixes, b.sample && b.sample.suffix);
      const year = pickLabel(b.years, b.sample && b.sample.year);

      let eSales = 0;
      if (level === 0) {
        eSalesMap.forEach((v, k) => {
          if (k.startsWith((compact(product) || product) + "|")) eSales += v;
        });
      } else {
        eSales = eSalesMap.get(esalesKey(product, suffix)) || 0;
        if (b.suffixes.size > 1) {
          eSales = 0;
          b.suffixes.forEach((sfx) => {
            eSales += eSalesMap.get(esalesKey(product, sfx)) || 0;
          });
        }
      }
      b.eSalesStock = eSales;

      const skYear = year && year !== "—" ? salesJoinKey({ product, year }) : null;
      const skProd = `P:${product}`;
      let sales = 0;
      if (skYear && salesMap.has(skYear)) sales = salesMap.get(skYear);
      else sales = salesMap.get(skProd) || 0;
      if (level === 0) sales = salesMap.get(skProd) || sales;
      b.sales = sales;
    });

    const coverages = [];
    const velocities = [];
    let rows = [...buckets.values()].map((b) => {
      const product = pickLabel(b.products, "—");
      const suffix = level >= 1 ? pickLabel(b.suffixes, "—") : "—";
      const year = level >= 2 ? pickLabel(b.years, "—") : "—";
      const ext = level >= 3 ? pickLabel(b.exts, "—") : "—";
      const intc = level >= 4 ? pickLabel(b.ints, "—") : "—";
      const coverage = safeDiv(b.availableStock, b.backOrders);
      const velocity = b.sales / periodDays;
      const ageing = b.ageingCount ? b.ageingSum / b.ageingCount : null;
      if (coverage != null) coverages.push(coverage);
      velocities.push(velocity);
      const vinList = [...b.vins].slice(0, cfg.vinListMax);
      return {
        id: b.key,
        product,
        suffix,
        year,
        ext,
        int: intc,
        backOrders: b.backOrders,
        availableStock: b.availableStock,
        rtlStock: b.rtlStock,
        centralStock: b.centralStock,
        eSalesStock: b.eSalesStock,
        sales: b.sales,
        salesVelocity: velocity,
        stockCoverage: coverage,
        allocationAgeing: ageing,
        vinCount: b.vins.size,
        vins: level >= 4 ? vinList : [],
        sources: {
          backOrders: "Back Orders file",
          availableStock: "RTL Stock + Stock E-Sales file (VIN deduped per source)",
          eSalesStock: "Admin E-Sales allocation plan",
          sales: "Sales Raw Data",
        },
      };
    });

    rows = rows.filter((r) => r.backOrders > 0 || r.availableStock > 0);

    const maxBo = Math.max(0, ...rows.map((r) => r.backOrders));
    const maxVel = Math.max(0, ...rows.map((r) => r.salesVelocity));
    const covSplit = cfg.quadrants.coverageSplit != null ? cfg.quadrants.coverageSplit : 1.0;
    const velSplit = cfg.quadrants.autoThresholds
      ? (cfg.quadrants.velocitySplit != null ? cfg.quadrants.velocitySplit : (median(velocities) || 0))
      : (cfg.quadrants.velocitySplit != null ? cfg.quadrants.velocitySplit : 0);

    // First pass: pressure + quadrant (status needs pressure)
    rows = rows.map((r) => {
      const covNorm = r.stockCoverage == null ? 1 : clamp(r.stockCoverage / 2, 0, 1);
      const scarcity = 1 - covNorm;
      const pressure =
        100 *
        (cfg.demand.boWeight * (maxBo ? r.backOrders / maxBo : 0) +
          cfg.demand.velocityWeight * (maxVel ? r.salesVelocity / maxVel : 0) +
          cfg.demand.scarcityWeight * scarcity);
      const quadrant = quadrantOf(r.stockCoverage, r.salesVelocity, covSplit, velSplit);
      const demandStatus =
        pressure >= cfg.demand.highPressure
          ? "High"
          : pressure >= cfg.demand.moderatePressure
            ? "Moderate"
            : "Low";
      const withPressure = {
        ...r,
        demandPressure: Math.round(pressure * 10) / 10,
        demandStatus,
        quadrant,
      };
      const inventoryStatus = classifyInventoryStatus(withPressure, velSplit, cfg);
      return {
        ...withPressure,
        inventoryStatus,
        recommendedAction: recommendedAction(inventoryStatus, quadrant),
        quadrantLabel: (QUADRANT_META[quadrant] && QUADRANT_META[quadrant].label) || quadrant,
        stockCoverageDisplay: r.stockCoverage == null ? "∞ (no BO)" : Math.round(r.stockCoverage * 100) / 100,
      };
    });

    dq.matchedConfigs = rows.filter((r) => r.backOrders > 0 && r.availableStock > 0).length;
    dq.unmatchedBoKeys = rows.filter((r) => r.backOrders > 0 && r.availableStock === 0).length;
    dq.unmatchedStockKeys = rows.filter((r) => r.availableStock > 0 && r.backOrders === 0).length;
    const allVins = new Set();
    rows.forEach((r) => {
      (r.vins || []).forEach((v) => allVins.add(v));
      if (!(r.vins || []).length && r.vinCount) {
        /* vin lists only at full drill; still count from vinCount for DQ at product levels via stock totals */
      }
    });
    dq.uniqueVins = rows.reduce((s, r) => s + (Number(r.vinCount) || 0), 0);
    dq.matchedVins = rows.filter((r) => r.backOrders > 0 && r.vinCount > 0).reduce((s, r) => s + r.vinCount, 0);

    const totalBo = rows.reduce((s, r) => s + r.backOrders, 0);
    const totalStock = rows.reduce((s, r) => s + r.availableStock, 0);
    const totalRtl = rows.reduce((s, r) => s + r.rtlStock, 0);
    const totalCentral = rows.reduce((s, r) => s + r.centralStock, 0);
    const totalESales = rows.reduce((s, r) => s + (Number(r.eSalesStock) || 0), 0);
    const salesSeen = new Set();
    let uniqueSales = 0;
    rows.forEach((r) => {
      const sk = level === 0 ? `P:${r.product}` : `P:${r.product}|Y:${r.year}`;
      if (salesSeen.has(sk)) return;
      salesSeen.add(sk);
      uniqueSales += r.sales;
    });

    const criticalCount = rows.filter((r) => r.inventoryStatus === "Critical").length;
    const atRiskCount = rows.filter((r) => r.inventoryStatus === "At Risk").length;
    const balancedCount = rows.filter((r) => r.inventoryStatus === "Balanced").length;
    const healthyCount = rows.filter((r) => r.inventoryStatus === "Healthy").length;
    const slowCount = rows.filter((r) => r.inventoryStatus === "Slow Moving").length;
    const overstockQuad = rows.filter((r) => r.quadrant === "OVERSTOCK").length;

    const kpis = {
      totalBackOrders: totalBo,
      availableStock: totalStock,
      rtlStock: totalRtl,
      centralStock: totalCentral,
      eSalesStock: totalESales,
      stockCoveragePct: totalBo ? (totalStock / totalBo) * 100 : null,
      totalSales: uniqueSales,
      salesVelocity: uniqueSales / periodDays,
      criticalVehicles: criticalCount,
      needFocusVehicles: criticalCount + atRiskCount,
      atRiskVehicles: atRiskCount,
      balancedVehicles: balancedCount,
      healthyVehicles: healthyCount,
      slowMovingVehicles: slowCount,
      overstockVehicles: overstockQuad,
      periodDays,
      coverageSplit: covSplit,
      velocitySplit: velSplit,
    };

    const validation = {
      totalBO: totalBo,
      totalRtlStock: totalRtl,
      totalESalesFileStock: totalCentral,
      totalESalesPlan: totalESales,
      totalAvailableStock: totalStock,
      totalSales: uniqueSales,
      uniqueVinSlots: dq.uniqueVins,
      matchedVinsWithBO: dq.matchedVins,
      duplicateVins: dq.duplicateVins,
      missingProduct: dq.missingProduct,
      missingSuffix: dq.missingSuffix,
      missingYear: dq.missingYear,
      missingExt: dq.missingExt,
      missingInt: dq.missingInt,
      periodDays,
    };

    if (typeof console !== "undefined" && console.info) {
      console.info("[ICC validation]", validation);
    }

    const insights = buildInsights(rows, kpis, cfg);

    return {
      config: cfg,
      drillLevel: level,
      rows,
      kpis,
      insights,
      dataQuality: dq,
      validation,
      quadrantMeta: QUADRANT_META,
      matchingNotes: [
        "Config key: Product | Suffix | Year | Ext | Int (level-dependent)",
        "Stock VINs deduped per source; BO rows counted as units",
        "Sales join: Product (+ Model Year when available) — Sales Raw often lacks suffix/colors",
        "E-Sales plan joins on Product + Suffix — shown separately from Available Stock",
        `Available Stock priority: RTL primary + Central/E-Sales file secondary`,
        `Quadrant splits: coverage ${covSplit.toFixed(2)}, velocity ${Number(velSplit).toFixed(3)}/day`,
      ],
    };
  }

  function buildInsights(rows, kpis, cfg) {
    const label = (r) =>
      [r.product, r.suffix !== "—" ? r.suffix : null, r.year !== "—" ? r.year : null]
        .filter(Boolean)
        .join(" / ");

    const byBo = [...rows].sort((a, b) => b.backOrders - a.backOrders);
    const topDemand = byBo[0];
    const insufficient = rows.filter((r) => r.backOrders > r.availableStock).length;
    const highAgeLowVel = rows.filter(
      (r) =>
        r.allocationAgeing != null &&
        r.allocationAgeing >= cfg.ageing.highDays &&
        r.salesVelocity < kpis.velocitySplit
    ).length;
    const highCov = rows.filter(
      (r) => r.stockCoverage != null && r.stockCoverage > cfg.coverage.balancedMax
    ).length;
    const topStock = [...rows].sort((a, b) => b.availableStock - a.availableStock)[0];
    const stockShare =
      topStock && kpis.availableStock
        ? ((topStock.availableStock / kpis.availableStock) * 100).toFixed(1)
        : null;

    const narrative = [];
    if (topDemand && topDemand.backOrders > 0) {
      narrative.push(
        `${label(topDemand)} has the highest demand pressure (BO ${topDemand.backOrders}, coverage ${topDemand.stockCoverageDisplay}).`
      );
    }
    narrative.push(
      `${insufficient} configuration${insufficient === 1 ? "" : "s"} have insufficient stock to cover current back orders.`
    );
    narrative.push(
      `${highAgeLowVel} configuration${highAgeLowVel === 1 ? "" : "s"} have high ageing (≥${cfg.ageing.highDays}d) and low sales velocity.`
    );
    narrative.push(
      `${highCov} configuration${highCov === 1 ? "" : "s"} sit above coverage ${cfg.coverage.balancedMax} (Healthy / Slow Moving band).`
    );
    if (topStock && stockShare != null) {
      narrative.push(
        `${label(topStock)} represents ${stockShare}% of current available stock (${topStock.availableStock} of ${kpis.availableStock} units).`
      );
    }
    narrative.push(
      `Period snapshot: BO ${kpis.totalBackOrders} · Stock ${kpis.availableStock} · Sales ${kpis.totalSales} over ${kpis.periodDays}d · Velocity ${Number(kpis.salesVelocity).toFixed(2)}/day.`
    );

    const critical = [...rows]
      .filter((r) => r.inventoryStatus === "Critical")
      .sort((a, b) => b.demandPressure - a.demandPressure)
      .slice(0, 5);
    const slow = [...rows]
      .filter((r) => r.inventoryStatus === "Slow Moving")
      .sort((a, b) => (b.allocationAgeing || 0) - (a.allocationAgeing || 0))
      .slice(0, 5);

    return [
      {
        id: "intelligence",
        title: "Inventory Intelligence",
        items: narrative,
      },
      {
        id: "critical",
        title: "Critical · prioritize allocation",
        items: critical.map(
          (r) => `${label(r)} — BO ${r.backOrders}, stock ${r.availableStock}, cov ${r.stockCoverageDisplay}`
        ),
      },
      {
        id: "demand",
        title: "Highest demand (BO)",
        items: byBo.slice(0, 5).map((r) => `${label(r)} — BO ${r.backOrders}, stock ${r.availableStock}`),
      },
      {
        id: "slow",
        title: "Slow moving inventory",
        items: slow.map(
          (r) =>
            `${label(r)} — age ${r.allocationAgeing == null ? "—" : Math.round(r.allocationAgeing) + "d"}, vel ${r.salesVelocity.toFixed(2)}/d`
        ),
      },
    ];
  }

  function filterRows(rows, filters) {
    const f = filters || {};
    const q = String(f.search || "").trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (f.product && r.product !== f.product) return false;
      if (f.suffix && r.suffix !== f.suffix) return false;
      if (f.year && r.year !== f.year) return false;
      if (f.ext && r.ext !== f.ext) return false;
      if (f.int && r.int !== f.int) return false;
      if (f.inventoryStatus && r.inventoryStatus !== f.inventoryStatus) return false;
      if (f.demandStatus && r.demandStatus !== f.demandStatus) return false;
      if (f.quadrant && r.quadrant !== f.quadrant) return false;
      if (f.ageingMin != null && f.ageingMin !== "" && (r.allocationAgeing == null || r.allocationAgeing < Number(f.ageingMin))) return false;
      if (f.ageingMax != null && f.ageingMax !== "" && (r.allocationAgeing == null || r.allocationAgeing > Number(f.ageingMax))) return false;
      if (f.coverageMin != null && f.coverageMin !== "") {
        const c = r.stockCoverage == null ? Infinity : r.stockCoverage;
        if (c < Number(f.coverageMin)) return false;
      }
      if (f.coverageMax != null && f.coverageMax !== "") {
        const c = r.stockCoverage == null ? Infinity : r.stockCoverage;
        if (c > Number(f.coverageMax)) return false;
      }
      if (q) {
        const vinHay = (r.vins || []).join(" ").toLowerCase();
        const hay = `${r.product} ${r.suffix} ${r.year} ${r.ext} ${r.int} ${r.inventoryStatus} ${r.recommendedAction} ${vinHay}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function topNBy(rows, field, n) {
    const limit = n === "all" || n == null ? (rows || []).length : Number(n) || 10;
    return [...(rows || [])]
      .sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0))
      .slice(0, Math.max(0, limit));
  }

  function bubbleRadius(stock, maxStock, cfg) {
    const b = cfg.bubble || CONFIG.bubble;
    if (!maxStock) return b.minR;
    const t = Math.sqrt(stock / maxStock);
    return b.minR + t * (b.maxR - b.minR);
  }

  function stableJitter(seed, amount) {
    const s = String(seed || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const u = ((h >>> 0) % 10000) / 10000;
    return (u - 0.5) * 2 * amount;
  }

  function coverageAxisX(r) {
    if (r.stockCoverage == null) {
      if (!(r.availableStock > 0)) return 0;
      return Math.min(3.5, 1.2 + Math.log10(1 + r.availableStock) * 0.9);
    }
    if (!Number.isFinite(r.stockCoverage)) return 0;
    return Math.min(Math.max(0, r.stockCoverage), 3.5);
  }

  function toChartPoints(rows, mode, cfg) {
    const list = rows || [];
    const maxStock = Math.max(1, ...list.map((r) => r.availableStock));
    const maxVel = Math.max(0.01, ...list.map((r) => r.salesVelocity || 0));
    return list.map((r) => {
      let x = mode === "ageing"
        ? (r.allocationAgeing == null ? 0 : r.allocationAgeing)
        : mode === "boStock"
          ? r.backOrders
          : coverageAxisX(r);
      let y = mode === "boStock" ? r.availableStock : (r.salesVelocity || 0);
      x += stableJitter(r.id + ":x", mode === "ageing" ? Math.max(0.4, x * 0.02) : mode === "boStock" ? Math.max(0.5, x * 0.01) : 0.045);
      y += stableJitter(r.id + ":y", Math.max(0.15, (mode === "boStock" ? Math.max(1, y) : maxVel) * 0.012));
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      return {
        x,
        y,
        r: bubbleRadius(Math.max(1, r.availableStock), maxStock, cfg || CONFIG),
        rowId: r.id,
        meta: r,
      };
    });
  }

  function rowsToExcel(rows) {
    return (rows || []).map((r) => ({
      Product: r.product,
      Suffix: r.suffix,
      "Model Year": r.year,
      Exterior: r.ext,
      Interior: r.int,
      "VIN Count": r.vinCount,
      "Back Orders": r.backOrders,
      "Available Stock": r.availableStock,
      "RTL Stock": r.rtlStock,
      "Central / E-Sales file": r.centralStock,
      "E-Sales Stock (plan)": r.eSalesStock,
      Sales: r.sales,
      "Sales Velocity": Math.round(r.salesVelocity * 1000) / 1000,
      "Stock Coverage": r.stockCoverageDisplay,
      "Allocation Ageing": r.allocationAgeing == null ? "" : Math.round(r.allocationAgeing * 10) / 10,
      "Demand Pressure": r.demandPressure,
      "Inventory Status": r.inventoryStatus,
      Quadrant: r.quadrant,
      "Recommended Action": r.recommendedAction,
    }));
  }

  global.InventoryCommandCenter = {
    CONFIG,
    QUADRANT_META,
    build,
    filterRows,
    toChartPoints,
    rowsToExcel,
    topNBy,
    buildInsights,
    normalizeSuffix,
    keyAtLevel,
    configParts,
  };
})(typeof window !== "undefined" ? window : globalThis);
