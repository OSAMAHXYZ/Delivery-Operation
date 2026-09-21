/**
 * Builder: extracts BO lookup functions from server.js into BoOrderLookup class.
 * Run: node scripts/build-bo-order-lookup-class.js
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const outPath = path.join(__dirname, 'bo-order-lookup.js');
const lines = fs.readFileSync(serverPath, 'utf8').split(/\r?\n/);

const fnNames = [
  'normalizeText', 'resolveColumn', 'parseDateValue', 'resolveOrderColumns', 'findOrderRow',
  'resolvePriorityColumn', 'rowHasColorInAnyPrioritySlot', 'resolveReservationCreatedDateColumn',
  'compareOrderNumberValues', 'compareReservationPriority', 'sortPeersByReservationDate',
  'resolvePrimaryOrderColumnForDedupe', 'dedupeRowsByOrderNumberForQueue', 'canonicalRowForOrderGroup',
  'findOrderUnitsSorted', 'buildQueueAnalysis', 'aggregateBoProductCounts'
];

function lineStartsFunction(line, name) {
  return /^\s*function\s+/.test(line) && line.includes(`function ${name}(`);
}

const starts = fnNames.map((name) => {
  const idx = lines.findIndex((line) => lineStartsFunction(line, name));
  if (idx < 0) throw new Error(`Function not found: ${name}`);
  return { name, start: idx };
});

const knownEnds = {
  buildQueueAnalysis: 1563,
  aggregateBoProductCounts: 1608
};

function findFunctionEnd(startIdx, name) {
  if (knownEnds[name] != null) return knownEnds[name];
  let i = lines[startIdx].indexOf('{');
  if (i < 0) {
    for (let r = startIdx; r < startIdx + 5; r++) {
      i = lines[r].indexOf('{');
      if (i >= 0) { startIdx = r; break; }
    }
  }
  let depth = 0;
  let inStr = null;
  let escape = false;
  for (let r = startIdx; r < lines.length; r++) {
    const line = lines[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (inStr) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return r;
      }
    }
  }
  throw new Error(`Unclosed function at line ${startIdx + 1}`);
}

const internalCalls = fnNames;

let methods = starts.map(({ name, start }) => {
  const end = findFunctionEnd(start, name);
  let body = lines.slice(start, end + 1).join('\n');
  body = body.replace(new RegExp(`^\\s*function\\s+${name}`), `  ${name}`);
  for (const call of internalCalls) {
    const re = new RegExp(`(?<!this\\.)\\b${call}\\(`, 'g');
    body = body.replace(re, `this.${call}(`);
  }
  body = body.replace(/this\.this\./g, 'this.');
  body = body.replace(new RegExp(`^\\s*this\\.${name}\\(`, 'm'), `  ${name}(`);
  return body;
}).join('\n\n');

const taxonomyAndPublicApi = `
  buildTaxonomy(meta = {}) {
    const rows = this.rows;
    const headers = this.headers;
    const productColumn = this.resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    const suffixColumn = this.resolveColumn(headers, [/^au\\s*suffix$/i, /\\bau\\s*suffix\\b/i, /^alj\\s*suffix$/i, /alj\\s*suffix/i, /suffix/i, /trim/i, /grade/i]);
    const ext1 = this.resolvePriorityColumn(headers, 'ext', 1);
    const int1 = this.resolvePriorityColumn(headers, 'int', 1);
    const ext2 = this.resolvePriorityColumn(headers, 'ext', 2);
    const int2 = this.resolvePriorityColumn(headers, 'int', 2);
    const ext3 = this.resolvePriorityColumn(headers, 'ext', 3);
    const int3 = this.resolvePriorityColumn(headers, 'int', 3);
    if (!productColumn || !suffixColumn) {
      throw new Error('Required BO headers not found (Product, Suffix)');
    }
    const extCols = [ext1, ext2, ext3].filter(Boolean);
    const intCols = [int1, int2, int3].filter(Boolean);
    const PAIR_COUNT_SEP = '\\x1f';
    const pushDistinct = (map, raw) => {
      const norm = this.normalizeText(raw);
      if (!norm || norm === '-' || norm === '*') return;
      if (!map.has(norm)) map.set(norm, String(raw).trim());
    };
    const products = new Map();
    rows.forEach((row) => {
      const pRaw = String(row[productColumn] ?? '').trim();
      const sRaw = String(row[suffixColumn] ?? '').trim();
      const pNorm = this.normalizeText(pRaw);
      const sNorm = this.normalizeText(sRaw);
      if (!pNorm || pNorm === '-') return;
      if (!sNorm || sNorm === '-') return;
      if (!products.has(pNorm)) {
        products.set(pNorm, { product: pRaw, rowCount: 0, suffixes: new Map() });
      }
      const productEntry = products.get(pNorm);
      productEntry.rowCount += 1;
      if (!productEntry.suffixes.has(sNorm)) {
        productEntry.suffixes.set(sNorm, {
          suffix: sRaw, rowCount: 0, exteriors: new Map(), interiors: new Map()
        });
      }
      const suffixEntry = productEntry.suffixes.get(sNorm);
      suffixEntry.rowCount += 1;
      extCols.forEach((c) => pushDistinct(suffixEntry.exteriors, row[c]));
      intCols.forEach((c) => pushDistinct(suffixEntry.interiors, row[c]));
    });
    products.forEach((productEntry) => {
      const pNorm = this.normalizeText(productEntry.product);
      productEntry.suffixes.forEach((suffixEntry) => {
        const sNorm = this.normalizeText(suffixEntry.suffix);
        const psRows = rows.filter(
          (r) =>
            this.normalizeText(r[productColumn]) === pNorm &&
            this.normalizeText(r[suffixColumn]) === sNorm
        );
        const extRaws = Array.from(suffixEntry.exteriors.values());
        const intRaws = Array.from(suffixEntry.interiors.values());
        const exteriorCountsAnySlot = {};
        extRaws.forEach((extRaw) => {
          const en = this.normalizeText(extRaw);
          if (!en) return;
          exteriorCountsAnySlot[extRaw] = psRows.filter((row) =>
            this.rowHasColorInAnyPrioritySlot(row, ext1, ext2, ext3, en)
          ).length;
        });
        const interiorCountsAnySlot = {};
        intRaws.forEach((intRaw) => {
          const inN = this.normalizeText(intRaw);
          if (!inN) return;
          interiorCountsAnySlot[intRaw] = psRows.filter((row) =>
            this.rowHasColorInAnyPrioritySlot(row, int1, int2, int3, inN)
          ).length;
        });
        const pairCountsAnySlot = {};
        extRaws.forEach((extRaw) => {
          const en = this.normalizeText(extRaw);
          if (!en) return;
          intRaws.forEach((intRaw) => {
            const inN = this.normalizeText(intRaw);
            if (!inN) return;
            const k = extRaw + PAIR_COUNT_SEP + intRaw;
            pairCountsAnySlot[k] = psRows.filter(
              (row) =>
                this.rowHasColorInAnyPrioritySlot(row, ext1, ext2, ext3, en) &&
                this.rowHasColorInAnyPrioritySlot(row, int1, int2, int3, inN)
            ).length;
          });
        });
        suffixEntry.exteriorCountsAnySlot = exteriorCountsAnySlot;
        suffixEntry.interiorCountsAnySlot = interiorCountsAnySlot;
        suffixEntry.pairCountsAnySlot = pairCountsAnySlot;
      });
    });
    const productList = Array.from(products.values())
      .map((p) => ({
        product: p.product,
        rowCount: p.rowCount,
        suffixes: Array.from(p.suffixes.values())
          .map((s) => ({
            suffix: s.suffix,
            rowCount: s.rowCount,
            exteriors: Array.from(s.exteriors.values()).sort(),
            interiors: Array.from(s.interiors.values()).sort(),
            exteriorCountsAnySlot: s.exteriorCountsAnySlot || {},
            interiorCountsAnySlot: s.interiorCountsAnySlot || {},
            pairCountsAnySlot: s.pairCountsAnySlot || {}
          }))
          .sort((a, b) => a.suffix.localeCompare(b.suffix))
      }))
      .sort((a, b) => a.product.localeCompare(b.product));
    return {
      uploadedAt: meta.uploadedAt || '',
      filename: meta.filename || '',
      sheetName: meta.sheetName || '',
      totalRows: rows.length,
      products: productList
    };
  }

  computeNewCustomerQueue({ product, suffix, exteriorColor, interiorColor, orderDate }) {
    const productInput = String(product || '').trim();
    const suffixInput = String(suffix || '').trim();
    const extInput = String(exteriorColor || '').trim();
    const intInput = String(interiorColor || '').trim();
    const orderDateInput = String(orderDate || '').trim();
    if (!productInput || !suffixInput || !extInput || !intInput) {
      throw new Error('product, suffix, exteriorColor, and interiorColor are required');
    }
    const allRows = this.rows;
    const headers = this.headers;
    const rows = this.dedupeRowsByOrderNumberForQueue(allRows, headers);
    const productColumn = this.resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    const suffixColumn = this.resolveColumn(headers, [/^au\\s*suffix$/i, /\\bau\\s*suffix\\b/i, /^alj\\s*suffix$/i, /alj\\s*suffix/i, /suffix/i, /trim/i, /grade/i]);
    const dateColumn = this.resolveReservationCreatedDateColumn(headers);
    const ext1 = this.resolvePriorityColumn(headers, 'ext', 1);
    const int1 = this.resolvePriorityColumn(headers, 'int', 1);
    const ext2 = this.resolvePriorityColumn(headers, 'ext', 2);
    const int2 = this.resolvePriorityColumn(headers, 'int', 2);
    const ext3 = this.resolvePriorityColumn(headers, 'ext', 3);
    const int3 = this.resolvePriorityColumn(headers, 'int', 3);
    if (!productColumn || !suffixColumn || !dateColumn || !ext1 || !int1) {
      throw new Error('Required BO headers not found (Product, Suffix, reservation created date, Ext/Int columns)');
    }
    const targetProduct = this.normalizeText(productInput);
    const targetSuffix = this.normalizeText(suffixInput);
    const targetExt = this.normalizeText(extInput);
    const targetInt = this.normalizeText(intInput);
    const extWild = targetExt === '*';
    const intWild = targetInt === '*';
    const tierPairs = [
      { ext: ext1, int: int1 }, { ext: ext2, int: int2 }, { ext: ext3, int: int3 }
    ].filter((t) => t.ext && t.int);
    const rowProductSuffixMatch = (row) =>
      this.normalizeText(row[productColumn]) === targetProduct &&
      this.normalizeText(row[suffixColumn]) === targetSuffix;
    const makeRowPairMatcher = (extNorm, intNorm) => (row) => {
      if (!this.rowHasColorInAnyPrioritySlot(row, ext1, ext2, ext3, extNorm)) return false;
      if (!int1) return false;
      return this.rowHasColorInAnyPrioritySlot(row, int1, int2, int3, intNorm);
    };
    const candidateMs = orderDateInput ? this.parseDateValue(orderDateInput) : Date.now();
    const effectiveCandidateMs = candidateMs === null ? Date.now() : candidateMs;
    const computeForPair = (extNorm, intNorm, extLabel, intLabel) => {
      const matcher = makeRowPairMatcher(extNorm, intNorm);
      const peers = rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => rowProductSuffixMatch(row) && matcher(row));
      return {
        exteriorColor: extLabel,
        interiorColor: intLabel,
        matchingTotal: peers.length
      };
    };
    if (extWild || intWild) {
      const productSuffixRows = rows.filter((row) => rowProductSuffixMatch(row));
      const collectDistinctValues = (getCols) => {
        const seen = new Map();
        productSuffixRows.forEach((row) => {
          getCols.forEach((col) => {
            if (!col) return;
            const raw = String(row[col] ?? '').trim();
            const norm = this.normalizeText(raw);
            if (!norm || norm === '-' || norm === '*') return;
            if (!seen.has(norm)) seen.set(norm, raw);
          });
        });
        return seen;
      };
      const extCols = tierPairs.map((t) => t.ext);
      const intCols = tierPairs.map((t) => t.int);
      const extMap = collectDistinctValues(extCols);
      const intMap = collectDistinctValues(intCols);
      const combos = [];
      extMap.forEach((extLabel, extNorm) => {
        intMap.forEach((intLabel, intNorm) => {
          combos.push({ extNorm, intNorm, extLabel, intLabel });
        });
      });
      const possibilities = combos
        .map(({ extNorm, intNorm, extLabel, intLabel }) =>
          computeForPair(extNorm, intNorm, extLabel, intLabel)
        )
        .sort((a, b) => a.matchingTotal - b.matchingTotal);
      const totalQueues = possibilities.length;
      const totalCustomersInQueues = possibilities.reduce(
        (sum, p) => sum + (p.matchingTotal || 0), 0
      );
      const lightest = possibilities[0] || null;
      return {
        product: productInput,
        suffix: suffixInput,
        exteriorColor: extInput,
        interiorColor: intInput,
        orderDateUsed: new Date(effectiveCandidateMs).toISOString(),
        wildcard: true,
        possibilities,
        summary: {
          totalQueues,
          totalCustomersInQueues,
          distinctExteriors: extMap.size,
          distinctInteriors: intMap.size,
          lightestSuggestion: lightest
            ? {
                exteriorColor: lightest.exteriorColor,
                interiorColor: lightest.interiorColor,
                matchingTotal: lightest.matchingTotal
              }
            : null
        },
        rule: 'Wildcard: Product+Suffix fixed; each combination shows how many reservations match (Exterior Color 1–3, Interior Color 1–3 on each row).'
      };
    }
    const exact = computeForPair(targetExt, targetInt, extInput, intInput);
    return {
      product: productInput,
      suffix: suffixInput,
      exteriorColor: extInput,
      interiorColor: intInput,
      orderDateUsed: new Date(effectiveCandidateMs).toISOString(),
      wildcard: false,
      matchingTotal: exact.matchingTotal,
      queueSizeBeforeAdding: exact.matchingTotal,
      matchedRequirements: productInput + ' + ' + suffixInput + ' + ' + extInput + '/' + intInput,
      rule: 'Same Product+Suffix; exterior may appear in Exterior Color 1–3; interior may appear in Interior Color 1–3. Response is the count of matching reservations (not a rank).'
    };
  }

  lookupOrder(orderNumber) {
    const rows = this.rows;
    const headers = this.headers;
    const result = this.findOrderRow(rows, orderNumber, headers);
    if (!result) return null;
    const orderUnits = this.findOrderUnitsSorted(rows, headers, result.row, result.matchedColumn);
    const canonicalRow = this.canonicalRowForOrderGroup(rows, headers, result.row, result.matchedColumn);
    const queueRows = this.dedupeRowsByOrderNumberForQueue(rows, headers);
    const queueAnalysis = this.buildQueueAnalysis(queueRows, canonicalRow, headers, result.matchedColumn);
    return {
      found: true,
      orderNumber: String(orderNumber || '').trim(),
      matchedColumn: result.matchedColumn,
      details: result.row,
      orderUnits,
      orderUnitCount: orderUnits.length,
      queue: queueAnalysis
    };
  }
`;

const header = `/**
 * BO Order Lookup — queue algorithm used by bo-order-lookup.html
 *
 * Algorithm summary:
 * 1. Find order row by order number across candidate columns.
 * 2. Merge duplicate order lines → one queue slot (earliest reservation date wins).
 * 3. Build peer group: same Product + Suffix.
 * 4. Match exterior in Ext Color 1–3; interior uses Int Color 1 (or Int 1–3 for new-customer counts).
 * 5. Sort peers by reservation date asc, then order number.
 * 6. Position = 1-based index of matched order in sorted peer list.
 * 7. Wildcard (*) expands to all distinct ext/int combinations under same product+suffix.
 */
class BoOrderLookup {
  constructor(rows = [], headers = []) {
    this.rows = Array.isArray(rows) ? rows : [];
    this.headers = Array.isArray(headers) ? headers : [];
  }

  static fromBoData(data) {
    return new BoOrderLookup(data?.rows, data?.headers);
  }

`;

const footer = `
}

module.exports = { BoOrderLookup };
`;

fs.writeFileSync(outPath, header + methods + taxonomyAndPublicApi + footer);
console.log('Wrote', outPath);
