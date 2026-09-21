/**
 * BusinessFormulas — single place for all matching / sales / BO formulas.
 *
 * Use this class to ADD or FIX logic. Other pages can call these methods
 * instead of copying formulas into UI code.
 *
 * Load:
 *   <script src="master-excel/formulas.js"></script>
 *   const F = new BusinessFormulas();
 *   // or: MasterExcelFormulas / window.BusinessFormulas
 *
 * Catalog (human-readable list of every formula):
 *   BusinessFormulas.catalog()
 */
(function (global) {
  "use strict";

  const CANCEL_TARGET = 0.3; // Can. Target 30%

  class BusinessFormulas {
    constructor(options) {
      this.options = Object.assign(
        {
          cancelTarget: CANCEL_TARGET,
          agingWarnDays: 30,
          agingCriticalDays: 60,
        },
        options || {}
      );
    }

    // ═══════════════════════════════════════════════════════════
    // 1) NORMALIZATION
    // ═══════════════════════════════════════════════════════════

    /** " ab c-123 " → "ABC123" */
    normalizeVin(v) {
      if (v == null || v === "") return "";
      const s = String(v)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/[\-_.]/g, "");
      return s || "";
    }

    upperTrim(v) {
      return String(v == null ? "" : v)
        .trim()
        .toUpperCase();
    }

    /** Exterior code pad to 3 chars (daily match). */
    padExterior3(v) {
      return this.upperTrim(v).padStart(3, "0");
    }

    removeDashSpace(v) {
      return this.upperTrim(v).replace(/[-\s]/g, "");
    }

    lastToken(v) {
      const s = String(v == null ? "" : v).trim();
      if (!s) return "";
      const parts = s.split(/\s+/);
      return parts[parts.length - 1] || "";
    }

    // ═══════════════════════════════════════════════════════════
    // 2) STOCK MATCHING KEYS
    // ═══════════════════════════════════════════════════════════

    /**
     * Spec / FIFO match key:
     *   Product + Alj Suffix + Model Year + ExteriorCode + InteriorCode
     */
    matchKey(product, suffix, year, extCode, intCode) {
      return [product, suffix, year, extCode, intCode]
        .map((v) => this.upperTrim(v))
        .join("|");
    }

    matchKeyFromParts(parts) {
      const p = parts || {};
      return this.matchKey(p.product, p.suffix, p.year, p.ext, p.int);
    }

    // ═══════════════════════════════════════════════════════════
    // 3) QUANTITY / STATUS LABELS (Full Control + FIFO)
    // ═══════════════════════════════════════════════════════════

    /**
     * BO vs available stock count:
     *   NO STOCK | BO > STOCK | STOCK > BO | BALANCED
     */
    quantityStatus(boCount, stockCount) {
      if (boCount == null) return "NO BO";
      if (stockCount == null || stockCount === 0) return "NO STOCK";
      if (boCount > stockCount) return "BO > STOCK";
      if (boCount < stockCount) return "STOCK > BO";
      return "BALANCED";
    }

    /** Central VIN found in Backorder? */
    boMatchStatus(hasBo) {
      return hasBo ? "Matched" : "No BO";
    }

    /** Central VIN found in RTL Stock? */
    rtlStatus(inRtl) {
      return inRtl ? "In Stock" : "Not in RTL Stock";
    }

    /**
     * Full Control = BO Matched AND RTL In Stock
     * (unique Central VIN with both hits)
     */
    isFullControl(boStatus, rtlStatus) {
      return boStatus === "Matched" && rtlStatus === "In Stock";
    }

    fullControlFromFlags(hasBo, inRtl) {
      return this.isFullControl(this.boMatchStatus(hasBo), this.rtlStatus(inRtl));
    }

    // ═══════════════════════════════════════════════════════════
    // 4) STOCK ALLOCATION (Back Order file Col AD / AE)
    // ═══════════════════════════════════════════════════════════

    /**
     * Fulfillable from available inventory:
     *   AE > 0  AND  AD ≤ AE
     * AD = back order qty · AE = available stock
     */
    isFulfillable(boQty, availableStock) {
      const ad = this.toNumber(boQty);
      const ae = this.toNumber(availableStock);
      return ae > 0 && ad <= ae;
    }

    /**
     * Cancelled BO row counts when Col I has a VIN.
     * Salesman name on the cancelled file is used for per-employee totals.
     */
    isCancelledVin(vin, _newVinSet) {
      return !!this.normalizeVin(vin);
    }

    // ═══════════════════════════════════════════════════════════
    // 5) SALES REPORT (Sales Raw · Col A / P / V)
    // ═══════════════════════════════════════════════════════════

    /**
     * Del+VSND = Proforma (by design in this project)
     */
    delPlusVsnd(proforma) {
      return this.toNumber(proforma);
    }

    /**
     * Ach% (Delivery) = Delivery ÷ Target
     * Returns ratio 0–1 (not percent string).
     */
    deliveryAch(delivery, target) {
      const t = this.toNumber(target);
      if (!t) return null;
      return this.toNumber(delivery) / t;
    }

    /**
     * Ach% (Sales) = Del+VSND ÷ Target = Proforma ÷ Target
     */
    salesAch(proforma, target) {
      const t = this.toNumber(target);
      if (!t) return null;
      return this.delPlusVsnd(proforma) / t;
    }

    /**
     * Diff = Target − Del+VSND
     */
    salesDiff(target, proforma) {
      return this.toNumber(target) - this.delPlusVsnd(proforma);
    }

    /**
     * Cancellation % = Cancelled ÷ (Delivery + Cancelled)
     */
    cancellationPct(cancelled, delivery) {
      const c = this.toNumber(cancelled);
      const base = this.toNumber(delivery) + c;
      if (!base) return null;
      return c / base;
    }

    /**
     * Gap +/- = Can.Target(30%) − Cancellation %
     * Positive gap = better than 30% target.
     */
    cancelGap(cancelPct, cancelTarget) {
      if (cancelPct == null || !Number.isFinite(cancelPct)) return null;
      const target =
        cancelTarget != null ? Number(cancelTarget) : this.options.cancelTarget;
      return target - cancelPct;
    }

    /**
     * Day target prorate (optional helper):
     *   DayTarget = MonthlyTarget × (dayOfMonth / daysInMonth)
     */
    dayTarget(monthlyTarget, dayOfMonth, daysInMonth) {
      const days = this.toNumber(daysInMonth);
      if (!days) return 0;
      return (this.toNumber(monthlyTarget) * this.toNumber(dayOfMonth)) / days;
    }

    /**
     * One employee sales block (Day or Month).
     * Mirrors report-sheet makeBlock().
     */
    salesBlock(proforma, delivery, target, cancelledCount, note) {
      const p = this.toNumber(proforma);
      const d = this.toNumber(delivery);
      const t = this.toNumber(target);
      const cancelled = this.toNumber(cancelledCount);
      const delPlus = this.delPlusVsnd(p);
      const deliveryAch = this.deliveryAch(d, t);
      const salesAch = this.salesAch(p, t);
      const diff = this.salesDiff(t, p);
      const cancelPct = this.cancellationPct(cancelled, d);
      const gap = this.cancelGap(cancelPct);

      return {
        Proforma: p,
        Delivery: d,
        Target: t,
        "Ach%": deliveryAch == null ? "#DIV/0!" : this.pct1(deliveryAch),
        "Del+VSND": delPlus,
        "Ach% (Sales)": salesAch == null ? "#DIV/0!" : this.pct1(salesAch),
        Diff: diff,
        "Cancelled BOs": cancelled,
        "Cancellation %": cancelPct == null ? "#DIV/0!" : this.pct0(cancelPct),
        "Can. Target 30%": this.pct0(this.options.cancelTarget),
        "Gap +/-": gap == null ? "#DIV/0!" : this.pct0(gap),
        Notes: note || "",
        _deliveryAch: deliveryAch,
        _salesAch: salesAch,
        _cancelPct: cancelPct,
        _gap: gap,
        _diff: diff,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // 6) BACK ORDER METRICS
    // ═══════════════════════════════════════════════════════════

    confirmPct(confirmed, total) {
      const n = this.toNumber(total);
      if (!n) return 0;
      return this.toNumber(confirmed) / n;
    }

    avgAging(agingValues) {
      const vals = (agingValues || []).filter((n) => n != null && Number.isFinite(Number(n)));
      if (!vals.length) return 0;
      const sum = vals.reduce((s, n) => s + Number(n), 0);
      return Math.round(sum / vals.length);
    }

    /**
     * Aging band helper for heat maps.
     *   ≤30 ok · ≤60 mid · else bad
     */
    agingBand(days) {
      const d = this.toNumber(days);
      if (d > this.options.agingCriticalDays) return "bad";
      if (d > this.options.agingWarnDays) return "mid";
      return "ok";
    }

    /**
     * Confirm % band: ≥70% ok · ≥40% mid · else bad
     */
    confirmBand(pct) {
      const p = Number(pct) || 0;
      if (p >= 0.7) return "ok";
      if (p >= 0.4) return "mid";
      return "bad";
    }

    /**
     * Aggregate BO list metrics (total / confirmed / avg aging / …).
     * Expects items with { confirmed: boolean, aging: number|null }.
     */
    boMetrics(list) {
      const rows = list || [];
      const total = rows.length;
      const confirmed = rows.filter((b) => b && b.confirmed).length;
      const notConfirmed = total - confirmed;
      const agingVals = rows.map((b) => (b ? b.aging : null));
      const avg = this.avgAging(agingVals);
      const over30 = rows.filter((b) => (b && b.aging) > this.options.agingWarnDays).length;
      const over60 = rows.filter((b) => (b && b.aging) > this.options.agingCriticalDays).length;
      return {
        total,
        confirmed,
        notConfirmed,
        confirmPct: this.confirmPct(confirmed, total),
        avgAging: avg,
        over30,
        over60,
      };
    }

    /** Multiple cars on one Back Order Number? */
    isMultiCarOrder(carCount) {
      return this.toNumber(carCount) > 1;
    }

    // ═══════════════════════════════════════════════════════════
    // 7) KPI COUNTS (Full Control result arrays)
    // ═══════════════════════════════════════════════════════════

    /**
     * Count KPIs from Full Control result rows.
     * Expects fields: "BO Match", "RTL Stock matched"
     */
    fullControlKpis(results) {
      const rows = results || [];
      const boMatched = rows.filter((r) => r["BO Match"] === "Matched").length;
      const noBo = rows.filter((r) => r["BO Match"] === "No BO").length;
      const rtlIn = rows.filter((r) => r["RTL Stock matched"] === "In Stock").length;
      const rtlOut = rows.filter((r) => r["RTL Stock matched"] === "Not in RTL Stock").length;
      const fullControl = rows.filter((r) =>
        this.isFullControl(r["BO Match"], r["RTL Stock matched"])
      ).length;
      return {
        totalUniqueCentralVins: rows.length,
        boMatched,
        noBo,
        rtlInStock: rtlIn,
        notInRtlStock: rtlOut,
        fullControl,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // 8) HELPERS
    // ═══════════════════════════════════════════════════════════

    toNumber(v) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const n = Number(String(v == null ? "" : v).replace(/[, ]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }

    /** 0.856 → "85.6%" */
    pct1(ratio) {
      return (Number(ratio) * 100).toFixed(1) + "%";
    }

    /** 0.3 → "30%" */
    pct0(ratio) {
      return Math.round(Number(ratio) * 100) + "%";
    }

    /**
     * Human-readable catalog — edit here when you add a formula,
     * so docs stay in sync.
     */
    static catalog() {
      return [
        {
          id: "normalizeVin",
          area: "Normalize",
          formula: 'UPPER(TRIM(vin)) → remove spaces and - _ .',
          example: '" ab c-123 " → "ABC123"',
        },
        {
          id: "matchKey",
          area: "Matching",
          formula: "Product | Suffix | Year | ExtCode | IntCode",
          notes: "Used by FIFO / Daily / All-Stock color matching",
        },
        {
          id: "quantityStatus",
          area: "Matching",
          formula: "compare BO count vs stock count → NO STOCK | BO>STOCK | STOCK>BO | BALANCED",
        },
        {
          id: "boMatchStatus",
          area: "Full Control",
          formula: "Central VIN in Backorder? → Matched | No BO",
        },
        {
          id: "rtlStatus",
          area: "Full Control",
          formula: "Central VIN in RTL? → In Stock | Not in RTL Stock",
        },
        {
          id: "isFullControl",
          area: "Full Control",
          formula: "Matched AND In Stock",
        },
        {
          id: "isFulfillable",
          area: "Stock Allocation",
          formula: "AE > 0 AND AD ≤ AE",
          notes: "AD = BO qty · AE = available stock (Back Order file)",
        },
        {
          id: "isCancelledVin",
          area: "Cancelled BO",
          formula: "Cancelled Excel · Col I has VIN → count under salesman name",
          notes: "All rows with Col I VIN · duplicates included · skip empty Col I",
        },
        {
          id: "delPlusVsnd",
          area: "Sales",
          formula: "Del+VSND = Proforma",
        },
        {
          id: "deliveryAch",
          area: "Sales",
          formula: "Ach% (Delivery) = Delivery ÷ Target",
        },
        {
          id: "salesAch",
          area: "Sales",
          formula: "Ach% (Sales) = Del+VSND ÷ Target",
        },
        {
          id: "salesDiff",
          area: "Sales",
          formula: "Diff = Target − Del+VSND",
        },
        {
          id: "cancellationPct",
          area: "Sales",
          formula: "Cancel% = Cancelled ÷ (Delivery + Cancelled)",
        },
        {
          id: "cancelGap",
          area: "Sales",
          formula: "Gap = 30% − Cancel%",
        },
        {
          id: "confirmPct",
          area: "BO Dashboard",
          formula: "Confirmed ÷ Total BO",
        },
        {
          id: "avgAging",
          area: "BO Dashboard",
          formula: "ROUND(AVG(aging days))",
        },
        {
          id: "isMultiCarOrder",
          area: "Back Orders",
          formula: "carCount > 1 → Multiple cars",
        },
      ];
    }
  }

  const api = { BusinessFormulas, CANCEL_TARGET };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.BusinessFormulas = BusinessFormulas;
  global.MasterExcelFormulas = api;
  if (global.MasterExcel) {
    global.MasterExcel.BusinessFormulas = BusinessFormulas;
    global.MasterExcel.Formulas = BusinessFormulas;
  }
})(typeof window !== "undefined" ? window : globalThis);
