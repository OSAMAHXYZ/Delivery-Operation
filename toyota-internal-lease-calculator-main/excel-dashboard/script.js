/**
 * Excel Dashboard — Backorder + RTL Stock + Central Stock matching
 * Implements Power Query logic:
 *   1) All stock matched   (BO ↔ Central, color dictionary FIFO)
 *   2) Daily stock matched (BO ↔ RTL, year + padded colors FIFO)
 *   3) Full control        (Central unique VIN + BO + RTL VIN check)
 */
(function () {
  "use strict";

  const ACCEPT =
    ".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
  const MAX_TABLE_RENDER = 5000;

  const SLOT_DEFS = [
    {
      id: "backorder",
      n: 1,
      title: "Backorder",
      blurb: "BO + Fleet sheets combined",
      kicker: "BO+ fleetBO",
    },
    {
      id: "rtl",
      n: 2,
      title: "RTL Stock",
      blurb: "Available retail stock — first sheet",
      kicker: "All Retail",
    },
    {
      id: "central",
      n: 3,
      title: "Central Stock",
      blurb: "All / central stock — first sheet",
      kicker: "all stock",
    },
  ];

  const HEADER_ALIASES = {
    product: ["product", "model"],
    suffix: ["alj suffix", "suffix", "tmc suffix"],
    year: ["model year", "year", "my"],
    extBo: ["exterior color  1", "exterior color 1", "exterior color", "ext color"],
    intBo: ["interior color 1", "interior color", "inter color 1"],
    extStock: ["exterior color", "exterior color  1", "exterior color 1", "ext color"],
    intStock: ["interior color", "interior color 1", "inter color 1"],
    vin: ["vin", "vehicle identification number"],
    boNumber: ["back order number", "backorder number", "bo number"],
    salesman: ["salesman name", "salesman"],
    orderDate: ["order date"],
    confirm: ["confirm flag", "confirm"],
    custGroup: ["cust group", "sales type", "customer group"],
    dpr: ["dpr"],
    paid: ["المبلغ المدفوع", "paid", "amount"],
    grade: ["grade (vc)", "grade"],
    item: ["item"],
    currentLocation: ["current location", "gt location", "location"],
    secondaryStatus: ["secondary status"],
    storageLocation: ["storage location"],
    sharing: ["sharing level", "sharing levels", "sharing level.1"],
    transmission: ["transmission"],
    brand: ["brand"],
    modelYearStock: ["model year", "year", "my"],
    allocationAgeing: ["allocation ageing", "age"],
    secondaryStatusDesc: [
      "secondary status descripiton",
      "secondary status description",
      "secondary status desc",
    ],
    usageDescription: ["usage description", "vehicle usage descr.", "usage"],
    allocatedLocation: ["allocated location"],
    pioAcc: ["pio acc comp date"],
    damageCategory: ["damage category"],
    supplierModelCodeDesc: ["supplier model code description"],
    distributionChannel: ["distribution channel"],
    mileage: ["mileage"],
    division: ["division"],
    shipNumber: ["ship number"],
    tmcSuffix: ["tmc suffix"],
    allocationDate: ["allocation date"],
    ndcGrDate: ["ndc gr date"],
    ndcGrAge: ["ndc gr age"],
    pipelineIndicator: ["pipeline indicator"],
    gtLocation: ["gt location"],
    transferDate: ["transfer date"],
    notification: ["notification"],
    licensePlate: ["license plate number"],
    vehicleSearchArea: ["vehicle search area"],
    searchAreaDesc: ["search area desc"],
    supplierModelCode: ["supplier model code", "model code"],
    primaryStatus: ["primary status"],
    primaryStatusDesc: ["primary status description", "primary status desc"],
    internalVehicleNumber: ["internal vehicle number"],
  };

  /** @type {Record<string, { file: File|null, rows: object[], name: string }>} */
  const slots = {
    backorder: emptySlot(),
    rtl: emptySlot(),
    central: emptySlot(),
  };

  const results = {
    allStock: [],
    daily: [],
    fullControl: [],
    boOrders: [],
  };

  const ui = {
    1: { search: "", sortCol: null, sortDir: 1 },
    2: { search: "", filter: "", sortCol: null, sortDir: 1 },
    3: { search: "", boFilter: "", rtlFilter: "", sortCol: null, sortDir: 1 },
    bo: { search: "", carsFilter: "", sortCol: "Cars", sortDir: -1, expanded: new Set() },
  };

  let colors = null;
  let exteriorMaster = [];
  let interiorMaster = [];

  function emptySlot() {
    return { file: null, rows: [], name: "" };
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setStatus(text, kind) {
    const el = $("#global-status");
    el.textContent = text;
    el.className = "status-pill" + (kind ? ` ${kind}` : "");
  }

  function showError(msg) {
    const el = $("#error-banner");
    const text = (msg || "").trim();
    el.hidden = !text;
    el.textContent = text;
    if (text) setStatus("Error", "error");
  }

  function setLoading(on, text) {
    const banner = $("#load-banner");
    banner.hidden = !on;
    if (text) $("#load-text").textContent = text;
    if (on) setStatus("Matching…", "busy");
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cellToString(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, "0");
      const d = String(v.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function upperTrim(v) {
    return String(v == null ? "" : v).trim().toUpperCase();
  }

  function removeDashSpace(v) {
    return upperTrim(v).replace(/[-\s]/g, "");
  }

  function padExterior3(v) {
    return upperTrim(v).padStart(3, "0");
  }

  function lastToken(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s) return "";
    const parts = s.split(/\s+/);
    return parts[parts.length - 1] || "";
  }

  function normHeader(h) {
    return String(h || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function detectFileType(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (name.endsWith(".csv") || type.includes("csv") || type === "text/plain") return "csv";
    if (name.endsWith(".xls") && !name.endsWith(".xlsx")) return "xls";
    if (name.endsWith(".xlsx") || type.includes("spreadsheet") || type.includes("excel")) return "xlsx";
    return "unknown";
  }

  function validateFile(file) {
    if (detectFileType(file) === "unknown") {
      return `Unsupported file “${file.name}”. Use .xlsx, .xls, or .csv.`;
    }
    return null;
  }

  function buildFieldGetter(sampleRow) {
    const normKeys = Object.keys(sampleRow || {}).map((k) => ({ raw: k, n: normHeader(k) }));
    const cache = {};
    return function get(row, aliasKey) {
      if (!(aliasKey in cache)) {
        const aliases = HEADER_ALIASES[aliasKey] || [aliasKey];
        let found = null;
        for (const alias of aliases) {
          found = normKeys.find((k) => k.n === alias) || normKeys.find((k) => k.n.includes(alias));
          if (found) break;
        }
        cache[aliasKey] = found ? found.raw : null;
      }
      const key = cache[aliasKey];
      return key ? row[key] : "";
    };
  }

  function parseOrderDate(v) {
    if (v == null || v === "") return Number.MAX_SAFE_INTEGER;
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v > 20000 && v < 100000) return Date.UTC(1899, 11, 30) + v * 86400000;
      return v;
    }
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  }

  /**
   * Power Query: List.First(List.Select(Master, c => Text.Contains(text, c)))
   * Master is sorted Order.Descending.
   */
  function firstContainedCode(text, masterSortedDesc) {
    const hay = upperTrim(text);
    if (!hay) return null;
    for (const code of masterSortedDesc) {
      if (code && hay.includes(code)) return code;
    }
    return null;
  }

  function buildMastersFromColors() {
    const ext = (colors && colors.exterior && colors.exterior.all
      ? colors.exterior.all()
      : []
    )
      .map((e) => upperTrim(e.code))
      .filter(Boolean)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    const intc = (colors && colors.interior && colors.interior.all
      ? colors.interior.all()
      : []
    )
      .map((e) => upperTrim(e.code))
      .filter(Boolean)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    exteriorMaster = ext;
    interiorMaster = intc;
  }

  async function readFileToWorkbook(file) {
    const kind = detectFileType(file);
    const buffer = await file.arrayBuffer();
    if (kind === "csv") {
      const text = new TextDecoder("utf-8").decode(buffer);
      return XLSX.read(text, { type: "string", FS: ",", cellDates: true });
    }
    return XLSX.read(buffer, { type: "array", cellDates: true });
  }

  const HEADER_MARKERS = [
    "product",
    "vin",
    "vehicle identification number",
    "alj suffix",
    "exterior color",
    "interior color",
    "model year",
    "back order number",
    "salesman name",
  ];

  /**
   * Parse one sheet with real header-row detection.
   * ALJ exports often put a blank/title row above headers.
   */
  function sheetRows(workbook, sheetName) {
    if (!sheetName || !workbook.Sheets[sheetName]) return [];
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: false,
      raw: true,
      cellDates: true,
    });
    if (!matrix.length) return [];

    let headerIdx = 0;
    let bestHits = -1;
    const scanLimit = Math.min(matrix.length, 40);
    for (let i = 0; i < scanLimit; i += 1) {
      const cells = (matrix[i] || []).map((c) => normHeader(c));
      if (!cells.some(Boolean)) continue;
      const hits = HEADER_MARKERS.filter((m) =>
        cells.some((c) => c === m || c.includes(m))
      ).length;
      if (hits > bestHits) {
        bestHits = hits;
        headerIdx = i;
      }
      if (hits >= 3) break;
    }

    const headerRow = matrix[headerIdx] || [];
    const headers = headerRow.map((h, i) => {
      const label = cellToString(h).trim();
      return label || `Column ${i + 1}`;
    });
    const seen = {};
    const uniqueHeaders = headers.map((h) => {
      if (!seen[h]) {
        seen[h] = 1;
        return h;
      }
      seen[h] += 1;
      return `${h} (${seen[h]})`;
    });

    const rows = [];
    for (let r = headerIdx + 1; r < matrix.length; r += 1) {
      const line = matrix[r] || [];
      if (line.every((c) => cellToString(c).trim() === "")) continue;
      const asText = line.map((c) => normHeader(c));
      const looksLikeHeader =
        HEADER_MARKERS.filter((m) => asText.some((c) => c === m || c.includes(m)))
          .length >= 3;
      if (looksLikeHeader) continue;

      const obj = {};
      uniqueHeaders.forEach((h, i) => {
        obj[h] = line[i] != null ? line[i] : "";
      });
      rows.push(obj);
    }
    return rows;
  }

  /** Always first sheet (RTL / Central). */
  function firstSheetRows(workbook) {
    const name = workbook.SheetNames[0];
    if (!name) return [];
    return sheetRows(workbook, name);
  }

  /**
   * Backorder = first sheet + any Fleet sheet(s), like Power Query BO+ fleetBO.
   * Ensures Cust Group is filled from Sales Type when Cust Group is missing.
   */
  function backorderRows(workbook) {
    const names = workbook.SheetNames || [];
    if (!names.length) return [];

    const first = names[0];
    const fleetNames = names.filter(
      (n, i) => i > 0 && /fleet/i.test(n) && !/summary/i.test(n)
    );

    const sheetsToRead = [first, ...fleetNames.filter((n) => n !== first)];
    const combined = [];
    sheetsToRead.forEach((sn) => {
      sheetRows(workbook, sn).forEach((row) => combined.push(row));
    });

    // Normalize: retail BO has Sales Type; fleet has Cust Group.
    combined.forEach((row) => {
      const keys = Object.keys(row);
      const custKey = keys.find((k) => normHeader(k) === "cust group");
      const salesKey = keys.find((k) => normHeader(k) === "sales type");
      if (custKey && cellToString(row[custKey]).trim()) return;
      if (salesKey && cellToString(row[salesKey]).trim()) {
        if (custKey) row[custKey] = row[salesKey];
        else row["Cust Group"] = row[salesKey];
      }
    });

    return combined;
  }

  function rowsForSlot(slotId, workbook) {
    if (slotId === "backorder") return backorderRows(workbook);
    return firstSheetRows(workbook);
  }

  /** Exterior for daily match: code → pad3; name → dictionary code → pad3. */
  function dailyExteriorCode(value) {
    const raw = cellToString(value).trim();
    if (!raw) return "";
    if (/^[A-Z0-9]{2,4}$/i.test(raw)) return padExterior3(raw);
    if (colors) {
      const code = colors.resolveExteriorCode(raw);
      if (code) return padExterior3(code);
    }
    const contained = firstContainedCode(raw, exteriorMaster);
    if (contained) return padExterior3(contained);
    return padExterior3(raw);
  }

  /** Interior for daily match: numeric code or dictionary name. */
  function dailyInteriorCode(value) {
    const raw = cellToString(value).trim();
    if (!raw) return "";
    if (/^\d{1,3}$/.test(raw)) return upperTrim(raw);
    if (colors) {
      const code = colors.resolveInteriorCode(raw);
      if (code) return upperTrim(code);
    }
    const contained = firstContainedCode(raw, interiorMaster);
    return contained || upperTrim(raw);
  }

  // ─────────────────────────────────────────────────────────────
  // Matching engines (Power Query ports)
  // ─────────────────────────────────────────────────────────────

  function runAllStockMatched(boRows, centralRows) {
    const getBo = buildFieldGetter(boRows[0] || {});
    const getCen = buildFieldGetter(centralRows[0] || {});

    const bos = boRows.map((r, idx) => {
      const product = upperTrim(getBo(r, "product"));
      const suffix = removeDashSpace(getBo(r, "suffix"));
      const extText = upperTrim(getBo(r, "extBo"));
      const intText = upperTrim(getBo(r, "intBo"));
      const exteriorCode = firstContainedCode(extText, exteriorMaster);
      const interiorCode = firstContainedCode(intText, interiorMaster);
      return {
        idx,
        product,
        suffix,
        exteriorCode,
        interiorCode,
        extText,
        intText,
        salesman: getBo(r, "salesman"),
        boNumber: getBo(r, "boNumber"),
        orderDate: getBo(r, "orderDate"),
        orderTs: parseOrderDate(getBo(r, "orderDate")),
        confirm: getBo(r, "confirm"),
        custGroup: getBo(r, "custGroup"),
        dpr: getBo(r, "dpr"),
        paid: getBo(r, "paid"),
        modelYear: getBo(r, "year"),
        item: getBo(r, "item"),
        key: [product, suffix, exteriorCode, interiorCode].join("|"),
      };
    });

    const stocks = centralRows.map((r, idx) => {
      const product = upperTrim(getCen(r, "product"));
      const suffix = removeDashSpace(getCen(r, "suffix"));
      const extText = upperTrim(getCen(r, "extStock"));
      const intText = upperTrim(getCen(r, "intStock"));
      const exteriorCode = firstContainedCode(extText, exteriorMaster);
      const interiorCode = firstContainedCode(intText, interiorMaster);
      const vin = cellToString(getCen(r, "vin")).trim();
      return {
        idx,
        product,
        suffix,
        exteriorCode,
        interiorCode,
        extText,
        intText,
        vin,
        modelYear: getCen(r, "modelYearStock"),
        transmission: getCen(r, "transmission"),
        grade: getCen(r, "grade"),
        allocationAgeing: getCen(r, "allocationAgeing"),
        secondaryStatusDesc: getCen(r, "secondaryStatusDesc"),
        usageDescription: getCen(r, "usageDescription"),
        allocatedLocation: getCen(r, "allocatedLocation"),
        currentLocation: getCen(r, "currentLocation"),
        secondaryStatus: getCen(r, "secondaryStatus"),
        storageLocation: getCen(r, "storageLocation"),
        pioAcc: getCen(r, "pioAcc"),
        damageCategory: getCen(r, "damageCategory"),
        sharing: getCen(r, "sharing"),
        supplierModelCodeDesc: getCen(r, "supplierModelCodeDesc"),
        distributionChannel: getCen(r, "distributionChannel"),
        mileage: getCen(r, "mileage"),
        division: getCen(r, "division"),
        shipNumber: getCen(r, "shipNumber"),
        tmcSuffix: getCen(r, "tmcSuffix"),
        brand: getCen(r, "brand"),
        allocationDate: getCen(r, "allocationDate"),
        ndcGrDate: getCen(r, "ndcGrDate"),
        ndcGrAge: getCen(r, "ndcGrAge"),
        pipelineIndicator: getCen(r, "pipelineIndicator"),
        gtLocation: getCen(r, "gtLocation"),
        transferDate: getCen(r, "transferDate"),
        notification: getCen(r, "notification"),
        licensePlate: getCen(r, "licensePlate"),
        vehicleSearchArea: getCen(r, "vehicleSearchArea"),
        searchAreaDesc: getCen(r, "searchAreaDesc"),
        supplierModelCode: getCen(r, "supplierModelCode"),
        primaryStatus: getCen(r, "primaryStatus"),
        primaryStatusDesc: getCen(r, "primaryStatusDesc"),
        internalVehicleNumber: getCen(r, "internalVehicleNumber"),
        key: [product, suffix, exteriorCode, interiorCode].join("|"),
      };
    });

    const sortedBo = bos.slice().sort((a, b) => a.orderTs - b.orderTs || a.idx - b.idx);
    const sortedStock = stocks
      .slice()
      .sort((a, b) => String(a.vin).localeCompare(String(b.vin), undefined, { numeric: true }));

    const stockPools = new Map();
    sortedStock.forEach((s) => {
      if (!stockPools.has(s.key)) stockPools.set(s.key, []);
      stockPools.get(s.key).push({ ...s, used: false });
    });

    const boGroups = new Map();
    sortedBo.forEach((b) => {
      if (!boGroups.has(b.key)) boGroups.set(b.key, []);
      boGroups.get(b.key).push(b);
    });
    const boIndex = new Map();
    boGroups.forEach((arr) => arr.forEach((b, i) => boIndex.set(b.idx, i + 1)));

    const out = [];
    sortedBo.forEach((bo) => {
      const pool = stockPools.get(bo.key) || [];
      const stock = pool.find((s) => !s.used && s.vin);
      if (!stock) return;
      stock.used = true;
      const stockIndex = pool.indexOf(stock) + 1;
      out.push({
        Product: bo.product,
        "Alj Suffix": bo.suffix,
        "Salesman Name": cellToString(bo.salesman),
        "Back Order Number": cellToString(bo.boNumber),
        "Order Date": cellToString(bo.orderDate),
        "Confirm Flag": cellToString(bo.confirm),
        "Cust Group": cellToString(bo.custGroup),
        DPR: cellToString(bo.dpr),
        "المبلغ المدفوع": cellToString(bo.paid),
        "Model Year": cellToString(bo.modelYear),
        "Exterior Color  1": bo.extText,
        "Interior Color 1": bo.intText,
        Item: cellToString(bo.item),
        BO_Index: boIndex.get(bo.idx),
        "Stock.VIN": stock.vin,
        "Stock.Model Year": cellToString(stock.modelYear),
        "Stock.Transmission": cellToString(stock.transmission),
        "Stock.Grade": cellToString(stock.grade),
        "Stock.Exterior Color": stock.extText,
        "Stock.Interior Color": stock.intText,
        "Stock.Allocation Ageing": cellToString(stock.allocationAgeing),
        "Stock.Secondary Status Descripiton": cellToString(stock.secondaryStatusDesc),
        "Stock.Usage Description": cellToString(stock.usageDescription),
        "Stock.Allocated Location": cellToString(stock.allocatedLocation),
        "Stock.Current Location": cellToString(stock.currentLocation),
        "Stock.Secondary Status": cellToString(stock.secondaryStatus),
        "Stock.Storage Location": cellToString(stock.storageLocation),
        "Stock.PIO ACC Comp Date": cellToString(stock.pioAcc),
        "Stock.Damage Category": cellToString(stock.damageCategory),
        "Stock.Sharing Level": cellToString(stock.sharing),
        "Stock.Supplier Model Code Description": cellToString(stock.supplierModelCodeDesc),
        "Stock.Distribution Channel": cellToString(stock.distributionChannel),
        "Stock.Mileage": cellToString(stock.mileage),
        "Stock.Division": cellToString(stock.division),
        "Stock.Ship Number": cellToString(stock.shipNumber),
        "Stock.TMC Suffix": cellToString(stock.tmcSuffix),
        "Stock.Brand": cellToString(stock.brand),
        "Stock.Allocation date": cellToString(stock.allocationDate),
        "Stock.NDC GR Date": cellToString(stock.ndcGrDate),
        "Stock.NDC GR Age": cellToString(stock.ndcGrAge),
        "Stock.Pipeline Indicator": cellToString(stock.pipelineIndicator),
        "Stock.Gt Location": cellToString(stock.gtLocation),
        "Stock.Transfer Date": cellToString(stock.transferDate),
        "Stock.Notification": cellToString(stock.notification),
        "Stock.License Plate Number": cellToString(stock.licensePlate),
        "Stock.Vehicle Search Area": cellToString(stock.vehicleSearchArea),
        "Stock.Search Area Desc": cellToString(stock.searchAreaDesc),
        "Stock.Supplier Model Code": cellToString(stock.supplierModelCode),
        "Stock.Primary Status": cellToString(stock.primaryStatus),
        "Stock.Primary Status Description": cellToString(stock.primaryStatusDesc),
        "Stock.Internal Vehicle Number": cellToString(stock.internalVehicleNumber),
        "Stock.Stock_Index": stockIndex,
      });
    });

    return out;
  }

  function quantityStatus(boCount, stockCount) {
    if (boCount == null) return "NO BO";
    if (stockCount == null || stockCount === 0) return "NO STOCK";
    if (boCount > stockCount) return "BO > STOCK";
    if (boCount < stockCount) return "STOCK > BO";
    return "BALANCED";
  }

  function runDailyStockMatched(boRows, rtlRows) {
    const getBo = buildFieldGetter(boRows[0] || {});
    const getRtl = buildFieldGetter(rtlRows[0] || {});

    const bos = boRows.map((r, idx) => {
      const product = upperTrim(getBo(r, "product"));
      const suffix = upperTrim(getBo(r, "suffix"));
      const year = String(getBo(r, "year") ?? "");
      const ext = dailyExteriorCode(getBo(r, "extBo"));
      const intc = dailyInteriorCode(getBo(r, "intBo"));
      return {
        idx,
        product,
        suffix,
        year,
        ext,
        int: intc,
        key: [product, suffix, year, ext, intc].join("|"),
        salesman: getBo(r, "salesman"),
        boNumber: getBo(r, "boNumber"),
        orderDate: getBo(r, "orderDate"),
        orderTs: parseOrderDate(getBo(r, "orderDate")),
        confirm: getBo(r, "confirm"),
        custGroup: getBo(r, "custGroup"),
        dpr: getBo(r, "dpr"),
        paid: getBo(r, "paid"),
        grade: getBo(r, "grade"),
        item: getBo(r, "item"),
        raw: r,
      };
    });

    const stocks = rtlRows.map((r, idx) => {
      const product = upperTrim(getRtl(r, "product"));
      const suffix = upperTrim(getRtl(r, "suffix"));
      const year = String(getRtl(r, "year") ?? "");
      const ext = dailyExteriorCode(getRtl(r, "extStock"));
      const intc = dailyInteriorCode(getRtl(r, "intStock"));
      const vin = cellToString(getRtl(r, "vin")).trim();
      return {
        idx,
        product,
        suffix,
        year,
        ext,
        int: intc,
        vin,
        key: [product, suffix, year, ext, intc].join("|"),
        raw: r,
      };
    });

    const sortedBo = bos.slice().sort((a, b) => a.orderTs - b.orderTs || a.idx - b.idx);
    const sortedStock = stocks
      .slice()
      .sort((a, b) => String(a.vin).localeCompare(String(b.vin), undefined, { numeric: true }));

    const stockPools = new Map();
    sortedStock.forEach((s) => {
      if (!stockPools.has(s.key)) stockPools.set(s.key, []);
      stockPools.get(s.key).push({ ...s, used: false });
    });

    const boCountMap = new Map();
    const stockCountMap = new Map();
    bos.forEach((b) => boCountMap.set(b.key, (boCountMap.get(b.key) || 0) + 1));
    stocks.forEach((s) => stockCountMap.set(s.key, (stockCountMap.get(s.key) || 0) + 1));

    const out = [];
    sortedBo.forEach((bo) => {
      const pool = stockPools.get(bo.key) || [];
      const hit = pool.find((s) => !s.used && s.vin);
      if (hit) hit.used = true;

      const stockCount = stockCountMap.has(bo.key) ? stockCountMap.get(bo.key) : null;
      const boCount = boCountMap.has(bo.key) ? boCountMap.get(bo.key) : null;

      const stockCols = {};
      if (hit && hit.raw) {
        Object.keys(hit.raw).forEach((k) => {
          const nk = normHeader(k);
          if (
            nk === "product" ||
            nk === "alj suffix" ||
            nk === "model year" ||
            nk === "exterior color" ||
            nk === "interior color" ||
            nk === "stock_index"
          ) {
            return;
          }
          stockCols[`Stock.${k}`] = cellToString(hit.raw[k]);
        });
      }

      out.push({
        Product: bo.product,
        "Alj Suffix": bo.suffix,
        "Salesman Name": cellToString(bo.salesman),
        "Back Order Number": cellToString(bo.boNumber),
        "Order Date": cellToString(bo.orderDate),
        "Confirm Flag": cellToString(bo.confirm),
        "Cust Group": cellToString(bo.custGroup),
        DPR: cellToString(bo.dpr),
        "المبلغ المدفوع": cellToString(bo.paid),
        "Model Year": bo.year,
        "Exterior Color  1": bo.ext,
        "Interior Color 1": bo.int,
        Item: cellToString(bo.item),
        "Grade (VC)": cellToString(bo.grade),
        ...stockCols,
        "Quantity Status": quantityStatus(boCount, stockCount),
      });
    });

    return out;
  }

  function runFullControl(boRows, rtlRows, centralRows) {
    const getBo = buildFieldGetter(boRows[0] || {});
    const getCen = buildFieldGetter(centralRows[0] || {});
    const getRtl = buildFieldGetter(rtlRows[0] || {});

    const bos = boRows.map((r, idx) => {
      const product = upperTrim(getBo(r, "product"));
      const suffix = upperTrim(getBo(r, "suffix"));
      const year = String(getBo(r, "year") ?? "");
      const extCode = upperTrim(getBo(r, "extBo"));
      const intCode = upperTrim(getBo(r, "intBo"));
      return {
        idx,
        product,
        suffix,
        year,
        extCode,
        intCode,
        key: [product, year, suffix, extCode, intCode].join("|"),
        salesman: getBo(r, "salesman"),
        boNumber: getBo(r, "boNumber"),
        orderDate: getBo(r, "orderDate"),
        confirm: getBo(r, "confirm"),
        custGroup: getBo(r, "custGroup"),
        dpr: getBo(r, "dpr"),
        paid: getBo(r, "paid"),
        grade: getBo(r, "grade"),
      };
    });

    const boByKey = new Map();
    bos.forEach((b) => {
      if (!boByKey.has(b.key)) boByKey.set(b.key, []);
      boByKey.get(b.key).push(b);
    });

    const retailVins = new Set(
      rtlRows.map((r) => cellToString(getRtl(r, "vin")).trim()).filter(Boolean)
    );

    const seenVin = new Set();
    const out = [];

    centralRows.forEach((r) => {
      const vin = cellToString(getCen(r, "vin")).trim();
      if (!vin || seenVin.has(vin)) return;
      seenVin.add(vin);

      const product = upperTrim(getCen(r, "product"));
      const suffix = upperTrim(getCen(r, "suffix"));
      const year = String(getCen(r, "modelYearStock") ?? "");
      const extName = cellToString(getCen(r, "extStock"));
      const intName = cellToString(getCen(r, "intStock"));
      const extCode = upperTrim(lastToken(extName));
      const intCode = upperTrim(lastToken(intName));
      const key = [product, year, suffix, extCode, intCode].join("|");
      const boHit = (boByKey.get(key) || [])[0] || null;
      const matched = !!boHit;

      out.push({
        VIN: vin,
        Product: product,
        "Alj Suffix": suffix,
        "Model Year": year,
        "Exterior Color": upperTrim(extName),
        "Interior Color": upperTrim(intName),
        "Exterior Color Code": extCode,
        "Interior Color Code": intCode,
        "Current Location": cellToString(getCen(r, "currentLocation")),
        "Secondary Status": cellToString(getCen(r, "secondaryStatus")),
        "Sharing Level": cellToString(getCen(r, "sharing")),
        "Salesman Name": matched ? cellToString(boHit.salesman) : "",
        "Back Order Number": matched ? cellToString(boHit.boNumber) : "",
        "Order Date": matched ? cellToString(boHit.orderDate) : "",
        "Confirm Flag": matched ? cellToString(boHit.confirm) : "",
        "Cust Group": matched ? cellToString(boHit.custGroup) : "",
        "المبلغ المدفوع": matched ? cellToString(boHit.paid) : "",
        "BO Match": matched ? "Matched" : "No BO",
        "RTL Stock matched": retailVins.has(vin) ? "In Stock" : "Not in RTL Stock",
      });
    });

    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────────

  function renderUploadSlots() {
    const grid = $("#upload-grid");
    grid.innerHTML = SLOT_DEFS.map(({ id, n, title, blurb, kicker }) => {
      const slot = slots[id];
      const has = !!slot.file;
      return `
        <article class="upload-card${has ? " has-file" : ""}" data-slot="${id}" tabindex="0">
          <span class="slot-label">File ${n} · ${escapeHtml(kicker)}</span>
          <h3>${escapeHtml(title)}</h3>
          <p class="hint">${escapeHtml(blurb)}. Drop a file here or choose one.</p>
          ${
            has
              ? `<p class="file-name">${escapeHtml(slot.name)} · ${formatBytes(slot.file.size)} · ${detectFileType(slot.file).toUpperCase()}</p>`
              : `<p class="file-name">No file selected</p>`
          }
          <div class="upload-actions">
            <button type="button" class="btn btn-primary" data-choose="${id}">Choose file</button>
            <button type="button" class="btn" data-clear-slot="${id}" ${has ? "" : "disabled"}>Remove</button>
          </div>
          <input type="file" id="file-input-${id}" accept="${ACCEPT}" aria-label="Upload ${escapeHtml(title)}" />
        </article>`;
    }).join("");
  }

  function updateActionButtons() {
    const ready = SLOT_DEFS.every((d) => slots[d.id].file);
    $("#analyze-btn").disabled = !ready;
    $("#clear-btn").disabled = !SLOT_DEFS.some((d) => slots[d.id].file);
    if (ready) setStatus("Ready to match", "ready");
    else if (SLOT_DEFS.some((d) => slots[d.id].file)) setStatus("Waiting for all 3 files");
    else setStatus("Waiting for files");
  }

  function assignFile(id, file) {
    const err = validateFile(file);
    if (err) {
      showError(err);
      return;
    }
    showError("");
    slots[id] = { file, rows: [], name: file.name };
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
  }

  function clearSlot(id) {
    slots[id] = emptySlot();
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
  }

  function bindUploadCardEvents() {
    $$(".upload-card").forEach((card) => {
      const id = card.dataset.slot;
      const input = $(`#file-input-${id}`);

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("is-drag");
      });
      card.addEventListener("dragleave", () => card.classList.remove("is-drag"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("is-drag");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) assignFile(id, file);
      });

      card.querySelector(`[data-choose="${id}"]`).addEventListener("click", () => input.click());
      card.querySelector(`[data-clear-slot="${id}"]`).addEventListener("click", () => clearSlot(id));
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (file) assignFile(id, file);
        input.value = "";
      });
    });
  }

  function statusPill(status) {
    const s = String(status || "");
    let cls = "status-chip";
    if (s === "NO STOCK" || s === "No BO") cls += " is-muted";
    else if (s === "BO > STOCK") cls += " is-warn";
    else if (s === "STOCK > BO") cls += " is-info";
    else if (s === "BALANCED" || s === "Matched" || s === "In Stock") cls += " is-ok";
    else if (s === "Not in RTL Stock") cls += " is-warn";
    return `<span class="${cls}">${escapeHtml(s)}</span>`;
  }

  /**
   * Group BO+Fleet rows by Back Order Number — one order, many cars.
   */
  function groupBackOrders(boRows) {
    const getBo = buildFieldGetter(boRows[0] || {});
    const map = new Map();

    boRows.forEach((r, idx) => {
      const boNumber = cellToString(getBo(r, "boNumber")).trim() || `(no number · ${idx + 1})`;
      if (!map.has(boNumber)) {
        map.set(boNumber, {
          "Back Order Number": boNumber,
          "Salesman Name": cellToString(getBo(r, "salesman")),
          "Order Date": cellToString(getBo(r, "orderDate")),
          "Confirm Flag": cellToString(getBo(r, "confirm")),
          "Cust Group": cellToString(getBo(r, "custGroup")),
          Cars: 0,
          cars: [],
          orderTs: parseOrderDate(getBo(r, "orderDate")),
        });
      }
      const group = map.get(boNumber);
      group.Cars += 1;
      if (!group["Salesman Name"]) group["Salesman Name"] = cellToString(getBo(r, "salesman"));
      if (!group["Order Date"]) {
        group["Order Date"] = cellToString(getBo(r, "orderDate"));
        group.orderTs = parseOrderDate(getBo(r, "orderDate"));
      }
      if (!group["Confirm Flag"]) group["Confirm Flag"] = cellToString(getBo(r, "confirm"));
      if (!group["Cust Group"]) group["Cust Group"] = cellToString(getBo(r, "custGroup"));

      group.cars.push({
        Product: upperTrim(getBo(r, "product")),
        "Alj Suffix": upperTrim(getBo(r, "suffix")),
        "Model Year": cellToString(getBo(r, "year")),
        "Exterior Color": cellToString(getBo(r, "extBo")),
        "Interior Color": cellToString(getBo(r, "intBo")),
        Item: cellToString(getBo(r, "item")),
        "المبلغ المدفوع": cellToString(getBo(r, "paid")),
      });
    });

    return Array.from(map.values()).sort((a, b) => b.Cars - a.Cars || a.orderTs - b.orderTs);
  }

  function getFilteredBoOrders() {
    const state = ui.bo;
    let rows = results.boOrders.slice();
    const q = (state.search || "").trim().toLowerCase();
    if (state.carsFilter === "multi") rows = rows.filter((r) => r.Cars > 1);
    if (state.carsFilter === "single") rows = rows.filter((r) => r.Cars === 1);
    if (q) {
      rows = rows.filter((row) => {
        const top = [
          row["Back Order Number"],
          row["Salesman Name"],
          row["Cust Group"],
          row["Confirm Flag"],
          row["Order Date"],
        ]
          .join(" ")
          .toLowerCase();
        if (top.includes(q)) return true;
        return row.cars.some((c) =>
          Object.values(c).some((v) => cellToString(v).toLowerCase().includes(q))
        );
      });
    }
    if (state.sortCol) {
      const col = state.sortCol;
      const dir = state.sortDir;
      rows.sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (col === "Cars") return (Number(av) - Number(bv)) * dir;
        return (
          cellToString(av).localeCompare(cellToString(bv), undefined, {
            sensitivity: "base",
            numeric: true,
          }) * dir
        );
      });
    }
    return rows;
  }

  function renderBoOrders() {
    const wrap = $("#bo-orders-wrap");
    const foot = $("#bo-orders-foot");
    if (!wrap || !foot) return;

    const filtered = getFilteredBoOrders();
    const shown = filtered.slice(0, MAX_TABLE_RENDER);
    const state = ui.bo;
    const headers = [
      "Back Order Number",
      "Cars",
      "Salesman Name",
      "Order Date",
      "Confirm Flag",
      "Cust Group",
    ];

    if (!results.boOrders.length) {
      wrap.innerHTML = `<div class="empty-state">No back orders loaded.</div>`;
      foot.textContent = "";
      return;
    }

    const head = headers
      .map((h) => {
        const ind = state.sortCol === h ? (state.sortDir === 1 ? "▲" : "▼") : "";
        return `<th scope="col" tabindex="0" data-bo-sort="${escapeHtml(h)}">${escapeHtml(h)}<span class="sort-ind">${ind}</span></th>`;
      })
      .join("");

    const body = shown
      .map((row) => {
        const id = cellToString(row["Back Order Number"]);
        const open = state.expanded.has(id);
        const carsCls = row.Cars > 1 ? "cars-multi" : "cars-one";
        const main = `
          <tr class="bo-order-row${open ? " is-open" : ""}" data-bo-id="${escapeHtml(id)}" tabindex="0" role="button" aria-expanded="${open ? "true" : "false"}">
            <td>
              <span class="bo-expand" aria-hidden="true">${open ? "▼" : "▶"}</span>
              <strong>${escapeHtml(id)}</strong>
            </td>
            <td><span class="cars-badge ${carsCls}">${formatNumber(row.Cars)}</span></td>
            <td title="${escapeHtml(row["Salesman Name"])}">${escapeHtml(row["Salesman Name"]) || "—"}</td>
            <td>${escapeHtml(row["Order Date"]) || "—"}</td>
            <td>${escapeHtml(row["Confirm Flag"]) || "—"}</td>
            <td>${escapeHtml(row["Cust Group"]) || "—"}</td>
          </tr>`;

        if (!open) return main;

        const carHeaders = [
          "Product",
          "Alj Suffix",
          "Model Year",
          "Exterior Color",
          "Interior Color",
          "Item",
          "المبلغ المدفوع",
        ];
        const carRows = row.cars
          .map(
            (c, i) => `
            <tr class="bo-car-row">
              <td class="bo-car-idx">${i + 1}</td>
              ${carHeaders
                .map((h) => {
                  const t = cellToString(c[h]);
                  return `<td class="${t ? "" : "empty-cell"}" title="${escapeHtml(t)}">${t ? escapeHtml(t) : "—"}</td>`;
                })
                .join("")}
            </tr>`
          )
          .join("");

        const detail = `
          <tr class="bo-detail-row">
            <td colspan="${headers.length}">
              <div class="bo-detail">
                <p class="bo-detail-title">${formatNumber(row.Cars)} car${row.Cars === 1 ? "" : "s"} under order <code>${escapeHtml(id)}</code></p>
                <table class="data-table bo-cars-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      ${carHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}
                    </tr>
                  </thead>
                  <tbody>${carRows}</tbody>
                </table>
              </div>
            </td>
          </tr>`;
        return main + detail;
      })
      .join("");

    wrap.innerHTML = `
      <table class="data-table bo-orders-table" aria-label="Back orders grouped by number">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${headers.length}">No orders match the current filters.</td></tr>`}</tbody>
      </table>`;

    const multi = results.boOrders.filter((r) => r.Cars > 1).length;
    foot.textContent =
      `Showing ${formatNumber(shown.length)} of ${formatNumber(filtered.length)} orders` +
      ` · ${formatNumber(results.boOrders.length)} unique orders` +
      ` · ${formatNumber(slots.backorder.rows.length)} cars total` +
      ` · ${formatNumber(multi)} orders with multiple cars`;

    $$("th[data-bo-sort]", wrap).forEach((th) => {
      const activate = () => {
        const col = th.getAttribute("data-bo-sort");
        if (state.sortCol === col) state.sortDir *= -1;
        else {
          state.sortCol = col;
          state.sortDir = col === "Cars" ? -1 : 1;
        }
        renderBoOrders();
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });

    $$(".bo-order-row", wrap).forEach((tr) => {
      const toggle = () => {
        const id = tr.getAttribute("data-bo-id");
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        renderBoOrders();
      };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  function getSectionRows(sectionNum) {
    if (sectionNum === 1) return results.allStock;
    if (sectionNum === 2) return results.daily;
    return results.fullControl;
  }

  function getFilteredRows(sectionNum) {
    const state = ui[sectionNum];
    let rows = getSectionRows(sectionNum).slice();
    const q = (state.search || "").trim().toLowerCase();

    if (sectionNum === 2 && state.filter) {
      rows = rows.filter((r) => r["Quantity Status"] === state.filter);
    }
    if (sectionNum === 3) {
      if (state.boFilter) rows = rows.filter((r) => r["BO Match"] === state.boFilter);
      if (state.rtlFilter) rows = rows.filter((r) => r["RTL Stock matched"] === state.rtlFilter);
    }
    if (q) {
      rows = rows.filter((row) =>
        Object.values(row).some((v) => cellToString(v).toLowerCase().includes(q))
      );
    }
    if (state.sortCol) {
      const col = state.sortCol;
      const dir = state.sortDir;
      rows.sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        const an = Number(av);
        const bn = Number(bv);
        if (
          !Number.isNaN(an) &&
          !Number.isNaN(bn) &&
          String(av).trim() !== "" &&
          String(bv).trim() !== ""
        ) {
          return (an - bn) * dir;
        }
        return (
          cellToString(av).localeCompare(cellToString(bv), undefined, {
            sensitivity: "base",
            numeric: true,
          }) * dir
        );
      });
    }
    return rows;
  }

  function renderTable(sectionNum) {
    const wrap = $(`#s${sectionNum}-table-wrap`);
    const foot = $(`#s${sectionNum}-table-foot`);
    const filtered = getFilteredRows(sectionNum);
    const shown = filtered.slice(0, MAX_TABLE_RENDER);
    const state = ui[sectionNum];
    const all = getSectionRows(sectionNum);
    const special =
      sectionNum === 2
        ? ["Quantity Status"]
        : sectionNum === 3
          ? ["BO Match", "RTL Stock matched"]
          : [];

    if (!all.length) {
      wrap.innerHTML = `<div class="empty-state">No rows for this section.</div>`;
      foot.textContent = "";
      return;
    }

    const headers = Object.keys(all[0]);
    const head = headers
      .map((h) => {
        const ind = state.sortCol === h ? (state.sortDir === 1 ? "▲" : "▼") : "";
        return `<th scope="col" tabindex="0" data-sort="${escapeHtml(h)}">${escapeHtml(h)}<span class="sort-ind">${ind}</span></th>`;
      })
      .join("");

    const body = shown
      .map((row) => {
        const cells = headers
          .map((h) => {
            const text = cellToString(row[h]);
            if (special.includes(h)) return `<td>${statusPill(text)}</td>`;
            return `<td class="${text ? "" : "empty-cell"}" title="${escapeHtml(text)}">${text ? escapeHtml(text) : "—"}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    wrap.innerHTML = `
      <table class="data-table" aria-label="Section ${sectionNum} data">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${headers.length}">No rows match the current filters.</td></tr>`}</tbody>
      </table>`;

    foot.textContent =
      filtered.length > MAX_TABLE_RENDER
        ? `Showing ${formatNumber(MAX_TABLE_RENDER)} of ${formatNumber(filtered.length)} filtered rows (${formatNumber(all.length)} total).`
        : `Showing ${formatNumber(filtered.length)} of ${formatNumber(all.length)} rows.`;

    $$("th[data-sort]", wrap).forEach((th) => {
      const activate = () => {
        const col = th.getAttribute("data-sort");
        if (state.sortCol === col) state.sortDir *= -1;
        else {
          state.sortCol = col;
          state.sortDir = 1;
        }
        renderTable(sectionNum);
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  function renderKpis(containerId, items) {
    $(containerId).innerHTML = items
      .map(
        (k) => `
      <article class="kpi">
        <p class="label">${escapeHtml(k.label)}</p>
        <p class="value">${escapeHtml(k.value)}</p>
        <p class="sub">${escapeHtml(k.sub || "")}</p>
      </article>`
      )
      .join("");
  }

  function renderSummary() {
    /* Summary panel removed — Full Control KPIs only. */
  }

  function renderSection(sectionNum) {
    if (sectionNum !== 3) return;
    const section = $("#section-3");
    if (!section) return;
    const rows = getSectionRows(3);
    section.hidden = false;

    const matched = rows.filter((r) => r["BO Match"] === "Matched").length;
    const rtl = rows.filter((r) => r["RTL Stock matched"] === "In Stock").length;
    const multi = results.boOrders.filter((r) => r.Cars > 1).length;
    renderKpis("#s3-kpis", [
      { label: "Unique VINs", value: formatNumber(rows.length), sub: "central stock" },
      { label: "BO Matched", value: formatNumber(matched), sub: "spec join hit" },
      { label: "No BO", value: formatNumber(rows.length - matched), sub: "unmatched" },
      { label: "In RTL Stock", value: formatNumber(rtl), sub: "VIN present in retail" },
      {
        label: "BO orders",
        value: formatNumber(results.boOrders.length),
        sub: `${formatNumber(slots.backorder.rows.length)} cars · ${formatNumber(multi)} multi`,
      },
      { label: "RTL rows", value: formatNumber(slots.rtl.rows.length), sub: "source rows" },
    ]);

    renderBoOrders();
    renderTable(3);
  }

  function downloadCsv(rows, filename) {
    if (!rows.length || typeof XLSX === "undefined") return;
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function analyzeAll() {
    if (typeof XLSX === "undefined") {
      showError("SheetJS failed to load. Check your network connection and reload.");
      return;
    }
    if (typeof MasterExcel === "undefined") {
      showError("master-excel.js failed to load. Open via HTTP (not file://) from the project root.");
      return;
    }

    showError("");
    setLoading(true, "Loading color dictionaries…");
    $("#analyze-btn").disabled = true;

    try {
      colors = new MasterExcel.MasterExcelColors();
      buildMastersFromColors();

      for (const d of SLOT_DEFS) {
        setLoading(true, `Reading ${d.title}: ${slots[d.id].name}…`);
        await new Promise((r) => setTimeout(r, 15));
        const wb = await readFileToWorkbook(slots[d.id].file);
        const rows = rowsForSlot(d.id, wb);
        if (!rows.length) {
          throw new Error(
            d.id === "backorder"
              ? `${d.title} (“${slots[d.id].name}”) has no data in the first or Fleet sheet.`
              : `${d.title} (“${slots[d.id].name}”) first sheet has no data rows.`
          );
        }
        slots[d.id].rows = rows;
      }

      setLoading(true, "Running Full control…");
      await new Promise((r) => setTimeout(r, 10));
      results.allStock = [];
      results.daily = [];
      results.fullControl = runFullControl(slots.backorder.rows, slots.rtl.rows, slots.central.rows);
      results.boOrders = groupBackOrders(slots.backorder.rows);

      ui[3].search = "";
      ui[3].sortCol = null;
      ui[3].sortDir = 1;
      ui[3].boFilter = "";
      ui[3].rtlFilter = "";
      ui.bo.search = "";
      ui.bo.carsFilter = "";
      ui.bo.sortCol = "Cars";
      ui.bo.sortDir = -1;
      ui.bo.expanded = new Set();
      const search = $("#s3-search");
      const boFilter = $("#s3-bo-filter");
      const rtlFilter = $("#s3-rtl-filter");
      const boSearch = $("#bo-search");
      const boCars = $("#bo-cars-filter");
      if (search) search.value = "";
      if (boFilter) boFilter.value = "";
      if (rtlFilter) rtlFilter.value = "";
      if (boSearch) boSearch.value = "";
      if (boCars) boCars.value = "";

      renderSection(3);

      setStatus("Matching complete", "ready");
      $("#page-sub").textContent = `${slots.backorder.name} · ${slots.rtl.name} · ${slots.central.name}`;
      const resultsEl = document.getElementById("section-3");
      if (resultsEl) resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error(err);
      showError(err.message || String(err));
      setStatus("Error", "error");
    } finally {
      setLoading(false);
      updateActionButtons();
    }
  }

  function clearAll() {
    SLOT_DEFS.forEach((d) => {
      slots[d.id] = emptySlot();
    });
    results.allStock = [];
    results.daily = [];
    results.fullControl = [];
    results.boOrders = [];
    ui.bo.expanded = new Set();
    const section3 = $("#section-3");
    if (section3) section3.hidden = true;
    $("#page-sub").textContent = "Upload Backorder, RTL Stock, and Central Stock";
    showError("");
    setLoading(false);
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
    setStatus("Waiting for files");
  }

  function bindGlobal() {
    $("#analyze-btn").addEventListener("click", analyzeAll);
    $("#clear-btn").addEventListener("click", clearAll);

    const debounce = (fn, ms) => {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
    };

    const s3Search = $("#s3-search");
    if (s3Search) {
      s3Search.addEventListener(
        "input",
        debounce((e) => {
          ui[3].search = e.target.value;
          renderTable(3);
        }, 150)
      );
    }
    const s3Bo = $("#s3-bo-filter");
    if (s3Bo) {
      s3Bo.addEventListener("change", (e) => {
        ui[3].boFilter = e.target.value;
        renderTable(3);
      });
    }
    const s3Rtl = $("#s3-rtl-filter");
    if (s3Rtl) {
      s3Rtl.addEventListener("change", (e) => {
        ui[3].rtlFilter = e.target.value;
        renderTable(3);
      });
    }
    const s3Dl = $("#s3-download");
    if (s3Dl) {
      s3Dl.addEventListener("click", () => downloadCsv(getFilteredRows(3), "full_control.csv"));
    }

    const boSearch = $("#bo-search");
    if (boSearch) {
      boSearch.addEventListener(
        "input",
        debounce((e) => {
          ui.bo.search = e.target.value;
          renderBoOrders();
        }, 150)
      );
    }
    const boCars = $("#bo-cars-filter");
    if (boCars) {
      boCars.addEventListener("change", (e) => {
        ui.bo.carsFilter = e.target.value;
        renderBoOrders();
      });
    }
  }

  function init() {
    if (typeof XLSX === "undefined") {
      showError("SheetJS library did not load. Open this page over HTTPS/HTTP (not file://) or check CDN access.");
    }
    showError("");
    setLoading(false);
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
    bindGlobal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
