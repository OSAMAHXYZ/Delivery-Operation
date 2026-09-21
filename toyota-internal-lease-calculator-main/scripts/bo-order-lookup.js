/**
 * BO Order Lookup — queue algorithm used by bo-order-lookup.html
 *
 * Order-number queue (buildQueueAnalysis):
 * 1. Find by Back Order Number column; else Order Not Found.
 * 2. Reference pairs: Ext1↔Int1, Ext2↔Int2, Ext3↔Int3 (skip blank tiers).
 * 3. Filter all orders by same Product + ALJ Suffix; match if any pair matches (* = any color).
 *    A ref pair like DMG/* is expanded into each concrete queue (DMG/20, DMG/30, …).
 * 4. Dedupe by back order number (oldest date; merge unique pairs).
 * 5. Sort by reservation date asc, then back order number; return position.
 *
 * New-customer / admin combo counts: * on a BO row matches any concrete color on that side.
 */
class BoOrderLookup {
  constructor(rows = [], headers = []) {
    this.rows = Array.isArray(rows) ? rows : [];
    this.headers = Array.isArray(headers) ? headers : [];
  }

  static fromBoData(data) {
    return new BoOrderLookup(data?.rows, data?.headers);
  }

  normalizeText(value) {
    return String(value ?? '').trim().toLowerCase();
}

  resolveColumn(headers, patterns) {
    for (const pattern of patterns) {
        const match = headers.find((header) => pattern.test(String(header || '')));
        if (match) return match;
    }
    return null;
}

  parseDateValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();

    if (typeof value === 'number') {
        // Excel serial date fallback
        const epoch = new Date(Date.UTC(1899, 11, 30));
        const ms = epoch.getTime() + value * 24 * 60 * 60 * 1000;
        return ms;
    }

    const parsed = Date.parse(String(value));
    return isNaN(parsed) ? null : parsed;
}

  resolveOrderColumns(headers) {
    const priorityPatterns = [
        /order\s*no/i,
        /order\s*number/i,
        /^bo$/i,
        /bo\s*number/i,
        /sales\s*order/i,
        /so\s*number/i,
        /request\s*number/i
    ];

    const prioritized = [];
    headers.forEach((header) => {
        const headerText = String(header || '');
        if (priorityPatterns.some((pattern) => pattern.test(headerText))) {
            prioritized.push(header);
        }
    });

    return prioritized.length > 0 ? prioritized : headers;
}

  findOrderRow(rows, orderNumber, headers) {
    const needle = this.normalizeText(orderNumber);
    if (!needle) return null;

    const backOrderCol = this.resolveColumn(headers, [
        /^back\s*order\s*number$/i,
        /\bback\s*order\s*number\b/i,
        /\bback\s*order\b/i
    ]);

    if (backOrderCol) {
        for (const row of rows) {
            if (this.normalizeText(row[backOrderCol]) === needle) {
                return { row, matchedColumn: backOrderCol };
            }
        }
        return null;
    }

    const candidateColumns = this.resolveOrderColumns(headers);
    for (const row of rows) {
        for (const columnName of candidateColumns) {
            if (this.normalizeText(row[columnName]) === needle) {
                return { row, matchedColumn: columnName };
            }
        }
    }

    return null;
}

  resolvePriorityColumn(headers, kind, priority) {
    const p = String(priority);
    const patterns = kind === 'ext'
        ? [
            new RegExp(`^ext\\.?\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^exterior\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^ext\\.?\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`^exterior\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`ext\\.?\\s*color\\s*priority\\s*${p}`, 'i'),
            new RegExp(`exterior.*priority.*${p}`, 'i'),
            new RegExp(`exterior.*color.*${p}`, 'i')
        ]
        : [
            new RegExp(`^inter\\.?\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^int\\.?\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^interior\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^int\\.?\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`^interior\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`int\\.?\\s*color\\s*priority\\s*${p}`, 'i'),
            new RegExp(`interior.*priority.*${p}`, 'i'),
            new RegExp(`interior.*color.*${p}`, 'i')
        ];
    return this.resolveColumn(headers, patterns);
}

  rowHasColorInAnyPrioritySlot(row, col1, col2, col3, norm) {
    const target = this.normalizeText(norm);
    if (!target || target === '-' || target === '*') return false;
    for (const col of [col1, col2, col3].filter(Boolean)) {
        const n = this.normalizeText(row[col]);
        if (!n || n === '-') continue;
        // * on the BO row means "any" — counts in every concrete color queue
        if (n === '*' || n === target) return true;
    }
    return false;
}

  resolveReservationCreatedDateColumn(headers) {
    return this.resolveColumn(headers, [
        /^created_date$/i,
        /\bcreated\s*date\b/i,
        /^reservation\s*created\s*date$/i,
        /\breservation.*created\b/i,
        /^order\s*created\s*on$/i,
        /order\s*created\s*on/i,
        /order\s*date/i,
        /\bdate\b/i,
        /created/i
    ]);
}

  compareOrderNumberValues(a, b) {
    return String(a ?? '')
        .trim()
        .localeCompare(String(b ?? '').trim(), undefined, { numeric: true, sensitivity: 'base' });
}

  compareReservationPriority(rowA, rowB, dateColumn, orderColumn) {
    const da = dateColumn ? this.parseDateValue(rowA[dateColumn]) : null;
    const db = dateColumn ? this.parseDateValue(rowB[dateColumn]) : null;
    if (da !== null && db !== null && da !== db) return da < db ? -1 : 1;
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;
    const sameTimestamp = da !== null && db !== null && da === db;
    if (sameTimestamp && orderColumn) {
        const oc = this.compareOrderNumberValues(rowA[orderColumn], rowB[orderColumn]);
        if (oc !== 0) return oc;
    }
    return 0;
}

  sortPeersByReservationDate(peers, dateColumn, orderColumn) {
    return [...peers].sort((a, b) => {
        const c = this.compareReservationPriority(a.row, b.row, dateColumn, orderColumn);
        if (c !== 0) return c;
        return a.index - b.index;
    });
}

  resolvePrimaryOrderColumnForDedupe(headers) {
    return (
        this.resolveColumn(headers, [/^order\s*no\.?$/i, /order\s*number/i, /back\s*order\s*number/i]) ||
        this.resolveOrderColumns(headers)[0] ||
        null
    );
}

  dedupeRowsByOrderNumberForQueue(rows, headers) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const groupCol = this.resolvePrimaryOrderColumnForDedupe(headers);
    if (!groupCol) return rows.slice();

    const dateColumn = this.resolveReservationCreatedDateColumn(headers);
    const groups = new Map();
    rows.forEach((row, index) => {
        const k = this.normalizeText(String(row[groupCol] ?? ''));
        const key = k || `__singleton_${index}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ row, index });
    });
    const out = [];
    groups.forEach((items) => {
        const sorted = [...items].sort((a, b) => {
            const c = this.compareReservationPriority(a.row, b.row, dateColumn, groupCol);
            if (c !== 0) return c;
            return a.index - b.index;
        });
        out.push(sorted[0].row);
    });
    return out;
}

  canonicalRowForOrderGroup(rows, headers, matchedRow, matchedColumn) {
    const groupCol = this.resolvePrimaryOrderColumnForDedupe(headers);
    const dateColumn = this.resolveReservationCreatedDateColumn(headers);
    const orderTieCol = groupCol || matchedColumn;
    let pool = rows.map((row, index) => ({ row, index }));

    if (groupCol && this.normalizeText(String(matchedRow[groupCol] ?? ''))) {
        const g = this.normalizeText(String(matchedRow[groupCol] ?? ''));
        pool = pool.filter(({ row }) => this.normalizeText(String(row[groupCol] ?? '')) === g);
    } else if (matchedColumn && this.normalizeText(String(matchedRow[matchedColumn] ?? ''))) {
        const n = this.normalizeText(String(matchedRow[matchedColumn] ?? ''));
        pool = pool.filter(({ row }) => this.normalizeText(String(row[matchedColumn] ?? '')) === n);
    } else {
        const idx = rows.indexOf(matchedRow);
        pool = [{ row: matchedRow, index: idx >= 0 ? idx : 0 }];
    }

    if (!pool.length) return matchedRow;

    pool.sort((a, b) => {
        const c = this.compareReservationPriority(a.row, b.row, dateColumn, orderTieCol);
        if (c !== 0) return c;
        return a.index - b.index;
    });
    return pool[0].row;
}

  findOrderUnitsSorted(rows, headers, matchedRow, matchedColumn) {
    const groupCol = this.resolvePrimaryOrderColumnForDedupe(headers);
    let units;
    if (groupCol && this.normalizeText(String(matchedRow[groupCol] ?? ''))) {
        const g = this.normalizeText(String(matchedRow[groupCol] ?? ''));
        units = rows.filter((row) => this.normalizeText(String(row[groupCol] ?? '')) === g);
    } else if (matchedColumn && this.normalizeText(String(matchedRow[matchedColumn] ?? ''))) {
        const n = this.normalizeText(String(matchedRow[matchedColumn] ?? ''));
        units = rows.filter((row) => this.normalizeText(String(row[matchedColumn] ?? '')) === n);
    } else {
        units = [matchedRow];
    }
    return units
        .map((row) => ({ row, index: rows.indexOf(row) }))
        .sort((a, b) => a.index - b.index)
        .map(({ row }) => row);
}

  resolveBackOrderColumn(headers, orderMatchedColumn) {
    return (
        orderMatchedColumn ||
        this.resolveColumn(headers, [/^back\s*order\s*number$/i, /\bback\s*order\s*number\b/i, /\bback\s*order\b/i]) ||
        this.resolvePrimaryOrderColumnForDedupe(headers)
    );
}

  extractColorPairsFromRow(row, extCols, intCols) {
    const pairs = [];
    for (let i = 0; i < 3; i++) {
        const extCol = extCols[i];
        const intCol = intCols[i];
        if (!extCol || !intCol) continue;
        const extRaw = String(row[extCol] ?? '').trim();
        const intRaw = String(row[intCol] ?? '').trim();
        const extNorm = this.normalizeText(extRaw);
        const intNorm = this.normalizeText(intRaw);
        if (!extNorm || extNorm === '-') continue;
        if (!intNorm || intNorm === '-') continue;
        pairs.push({
            tier: i + 1,
            exterior: extRaw,
            interior: intRaw,
            extNorm,
            intNorm
        });
    }
    return pairs;
}

  colorDimensionMatches(a, b) {
    const an = this.normalizeText(a);
    const bn = this.normalizeText(b);
    if (!an || an === '-' || !bn || bn === '-') return false;
    if (an === '*' || bn === '*') return true;
    return an === bn;
}

  colorPairMatches(refPair, candPair) {
    return (
        this.colorDimensionMatches(refPair.extNorm, candPair.extNorm) &&
        this.colorDimensionMatches(refPair.intNorm, candPair.intNorm)
    );
}

  orderPairsMatch(refPairs, candPairs) {
    if (!Array.isArray(refPairs) || !refPairs.length) return false;
    if (!Array.isArray(candPairs) || !candPairs.length) return false;
    for (const refPair of refPairs) {
        for (const candPair of candPairs) {
            if (this.colorPairMatches(refPair, candPair)) return true;
        }
    }
    return false;
}

  entryMatchesRefPair(entryPairs, refPair) {
    if (!Array.isArray(entryPairs) || !entryPairs.length || !refPair) return false;
    return entryPairs.some((candPair) => this.colorPairMatches(refPair, candPair));
}

  sortQueueEntries(entries) {
    return [...entries].sort((a, b) => {
        const da = a.reservationDate ?? Number.POSITIVE_INFINITY;
        const db = b.reservationDate ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return this.compareOrderNumberValues(a.orderNumber, b.orderNumber);
    });
}

  buildPairQueue(allEntries, refPair, productNorm, suffixNorm, productColumn, suffixColumn, refOrderNorm) {
    const filtered = allEntries.filter((entry) => {
        if (productColumn && this.normalizeText(entry.product) !== productNorm) return false;
        if (suffixColumn && this.normalizeText(entry.suffix) !== suffixNorm) return false;
        return this.entryMatchesRefPair(entry.pairs, refPair);
    });
    const queue = this.sortQueueEntries(filtered);
    const posIdx = queue.findIndex((e) => e.orderNorm === refOrderNorm);
    const position = posIdx >= 0 ? posIdx + 1 : null;
    return {
        tier: refPair.tier,
        exterior: refPair.exterior,
        interior: refPair.interior,
        position,
        ordersAhead: position != null ? position - 1 : null,
        totalQueueSize: queue.length
    };
}

  /**
   * When a ref pair uses * (any), expand into ALL concrete Ext/Int queues
   * for the same Product + Suffix.
   * Example: 202/* with Crown interiors 00 and 20 → 202/00 and 202/20
   * (not only interiors already paired with 202 in the file).
   */
  buildPairQueuesForRefPair(allEntries, refPair, productNorm, suffixNorm, productColumn, suffixColumn, refOrderNorm) {
    const extWild = refPair.extNorm === '*';
    const intWild = refPair.intNorm === '*';
    if (!extWild && !intWild) {
      return [
        this.buildPairQueue(
          allEntries,
          refPair,
          productNorm,
          suffixNorm,
          productColumn,
          suffixColumn,
          refOrderNorm
        )
      ];
    }

    const peers = allEntries.filter((entry) => {
      if (productColumn && this.normalizeText(entry.product) !== productNorm) return false;
      if (suffixColumn && this.normalizeText(entry.suffix) !== suffixNorm) return false;
      return true;
    });

    const wildcardSource = `${refPair.exterior}/${refPair.interior}`;
    const wrap = (pq) => ({
      ...pq,
      expandedFromWildcard: true,
      wildcardSource
    });

    // All concrete colors used anywhere on this Product + Suffix (any exterior/interior pair).
    const exteriors = new Map();
    const interiors = new Map();
    peers.forEach((entry) => {
      (entry.pairs || []).forEach((p) => {
        if (p.extNorm && p.extNorm !== '-' && p.extNorm !== '*') {
          if (!exteriors.has(p.extNorm)) exteriors.set(p.extNorm, p.exterior);
        }
        if (p.intNorm && p.intNorm !== '-' && p.intNorm !== '*') {
          if (!interiors.has(p.intNorm)) interiors.set(p.intNorm, p.interior);
        }
      });
    });

    const extOptions = extWild
      ? Array.from(exteriors.entries())
      : [[refPair.extNorm, refPair.exterior]];
    const intOptions = intWild
      ? Array.from(interiors.entries())
      : [[refPair.intNorm, refPair.interior]];

    if (!extOptions.length || !intOptions.length) {
      return [wrap(this.buildPairQueue(allEntries, refPair, productNorm, suffixNorm, productColumn, suffixColumn, refOrderNorm))];
    }

    const expanded = [];
    extOptions.forEach(([extNorm, exterior]) => {
      intOptions.forEach(([intNorm, interior]) => {
        expanded.push(
          wrap(
            this.buildPairQueue(
              allEntries,
              { tier: refPair.tier, exterior, interior, extNorm, intNorm },
              productNorm,
              suffixNorm,
              productColumn,
              suffixColumn,
              refOrderNorm
            )
          )
        );
      });
    });
    return expanded.sort(
      (a, b) =>
        String(a.exterior).localeCompare(String(b.exterior), undefined, { numeric: true }) ||
        String(a.interior).localeCompare(String(b.interior), undefined, { numeric: true }) ||
        (a.totalQueueSize || 0) - (b.totalQueueSize || 0)
    );
  }

  mergeOrderEntries(rows, orderColumn, dateColumn, productColumn, suffixColumn, extCols, intCols) {
    if (!orderColumn) return [];
    const groups = new Map();
    rows.forEach((row, index) => {
        const orderRaw = String(row[orderColumn] ?? '').trim();
        const orderNorm = this.normalizeText(orderRaw);
        if (!orderNorm) return;
        if (!groups.has(orderNorm)) groups.set(orderNorm, []);
        groups.get(orderNorm).push({ row, index });
    });

    const entries = [];
    groups.forEach((items, orderNorm) => {
        let bestDate = null;
        let bestDateRaw = '';
        let anchorRow = items[0].row;
        const pairMap = new Map();

        items.forEach(({ row }) => {
            if (dateColumn) {
                const d = this.parseDateValue(row[dateColumn]);
                if (d !== null && (bestDate === null || d < bestDate)) {
                    bestDate = d;
                    bestDateRaw = row[dateColumn];
                    anchorRow = row;
                }
            }
            this.extractColorPairsFromRow(row, extCols, intCols).forEach((pair) => {
                pairMap.set(`${pair.extNorm}|${pair.intNorm}`, pair);
            });
        });

        if (bestDate === null && dateColumn) {
            bestDateRaw = anchorRow[dateColumn];
            bestDate = this.parseDateValue(bestDateRaw);
        }

        entries.push({
            orderNumber: String(anchorRow[orderColumn] ?? '').trim() || orderNorm,
            orderNorm,
            product: productColumn ? anchorRow[productColumn] : '',
            suffix: suffixColumn ? anchorRow[suffixColumn] : '',
            reservationDate: bestDate,
            reservationDateRaw: bestDateRaw || (dateColumn ? anchorRow[dateColumn] : ''),
            pairs: Array.from(pairMap.values()),
            row: anchorRow
        });
    });
    return entries;
}

  buildQueueAnalysis(rows, matchedOrder, headers, orderMatchedColumn) {
    const productColumn = this.resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    const suffixColumn = this.resolveColumn(headers, [/^alj\s*suffix$/i, /\balj\s*suffix\b/i, /^au\s*suffix$/i, /\bau\s*suffix\b/i, /suffix/i, /trim/i, /grade/i]);
    const dateColumn = this.resolveReservationCreatedDateColumn(headers);
    const orderColumn = this.resolveBackOrderColumn(headers, orderMatchedColumn);

    const ext1 = this.resolvePriorityColumn(headers, 'ext', 1);
    const int1 = this.resolvePriorityColumn(headers, 'int', 1);
    const ext2 = this.resolvePriorityColumn(headers, 'ext', 2);
    const int2 = this.resolvePriorityColumn(headers, 'int', 2);
    const ext3 = this.resolvePriorityColumn(headers, 'ext', 3);
    const int3 = this.resolvePriorityColumn(headers, 'int', 3);
    const extCols = [ext1, ext2, ext3];
    const intCols = [int1, int2, int3];

    const allEntries = this.mergeOrderEntries(
        rows,
        orderColumn,
        dateColumn,
        productColumn,
        suffixColumn,
        extCols,
        intCols
    );

    const refOrderNorm = this.normalizeText(orderColumn ? matchedOrder[orderColumn] : '');
    let refEntry = allEntries.find((e) => e.orderNorm === refOrderNorm);
    if (!refEntry) {
        const refPairs = this.extractColorPairsFromRow(matchedOrder, extCols, intCols);
        refEntry = {
            orderNumber: orderColumn ? String(matchedOrder[orderColumn] ?? '').trim() : '',
            orderNorm: refOrderNorm,
            product: productColumn ? matchedOrder[productColumn] : '',
            suffix: suffixColumn ? matchedOrder[suffixColumn] : '',
            reservationDate: dateColumn ? this.parseDateValue(matchedOrder[dateColumn]) : null,
            reservationDateRaw: dateColumn ? matchedOrder[dateColumn] : '',
            pairs: refPairs,
            row: matchedOrder
        };
    }

    const productNorm = this.normalizeText(refEntry.product);
    const suffixNorm = this.normalizeText(refEntry.suffix);

    const queue = this.sortQueueEntries(
        allEntries.filter((entry) => {
            if (productColumn && this.normalizeText(entry.product) !== productNorm) return false;
            if (suffixColumn && this.normalizeText(entry.suffix) !== suffixNorm) return false;
            return this.orderPairsMatch(refEntry.pairs, entry.pairs);
        })
    );

    const posIdx = queue.findIndex((e) => e.orderNorm === refOrderNorm);
    const position = posIdx >= 0 ? posIdx + 1 : null;
    const ordersAhead = position != null ? position - 1 : null;

    const pairQueues = refEntry.pairs.flatMap((refPair) =>
        this.buildPairQueuesForRefPair(
            allEntries,
            refPair,
            productNorm,
            suffixNorm,
            productColumn,
            suffixColumn,
            refOrderNorm
        )
    );

    return {
        columns: {
            orderColumn,
            productColumn,
            suffixColumn,
            dateColumn,
            extColorPriority1: ext1,
            interiorColorPriority1: int1,
            extColorPriority2: ext2,
            interiorColorPriority2: int2,
            extColorPriority3: ext3,
            interiorColorPriority3: int3
        },
        values: {
            orderNumber: refEntry.orderNumber,
            product: refEntry.product,
            suffix: refEntry.suffix,
            reservationDate: refEntry.reservationDateRaw,
            extColor1: ext1 ? matchedOrder[ext1] : '',
            intColor1: int1 ? matchedOrder[int1] : '',
            extColor2: ext2 ? matchedOrder[ext2] : '',
            intColor2: int2 ? matchedOrder[int2] : '',
            extColor3: ext3 ? matchedOrder[ext3] : '',
            intColor3: int3 ? matchedOrder[int3] : ''
        },
        referencePairs: refEntry.pairs.map((p) => ({
            exterior: p.exterior,
            interior: p.interior,
            tier: p.tier
        })),
        pairQueues,
        queueResult: {
            position,
            ordersAhead,
            totalQueueSize: queue.length,
            reservationDate: refEntry.reservationDateRaw,
            product: refEntry.product,
            suffix: refEntry.suffix
        },
        queuePreview: queue.slice(0, 100).map((e) => ({
            orderNumber: e.orderNumber,
            reservationDate: e.reservationDateRaw,
            product: e.product,
            suffix: e.suffix,
            pairs: e.pairs.map((p) => ({ exterior: p.exterior, interior: p.interior }))
        })),
        queueRule:
            'Same Product + ALJ Suffix required. Color tiers matched as Ext1↔Int1, Ext2↔Int2, Ext3↔Int3 only (no cross-mixing). One matching pair is enough. * means any color on that side — e.g. DMG/* places the order in every concrete DMG/interior queue (DMG/20, DMG/30, …). Duplicate back order numbers are merged (oldest reservation date; all unique pairs kept). Sorted by reservation date (oldest first), then back order number.'
    };
}


  aggregateBoProductCounts(rows, headers) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const productColumn = this.resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    if (!productColumn) return [];
    const counts = new Map();
    rows.forEach((row) => {
        const p = String(row[productColumn] ?? '').trim();
        const label = p || '(blank)';
        counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([product, count]) => ({ product, count }))
        .sort((a, b) => b.count - a.count || String(a.product).localeCompare(String(b.product)));
}
  buildTaxonomy(meta = {}) {
    const rows = this.rows;
    const headers = this.headers;
    const productColumn = this.resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    const suffixColumn = this.resolveColumn(headers, [/^au\s*suffix$/i, /\bau\s*suffix\b/i, /^alj\s*suffix$/i, /alj\s*suffix/i, /suffix/i, /trim/i, /grade/i]);
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
    const PAIR_COUNT_SEP = '\x1f';
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

  /**
   * All Product × Suffix × Exterior × Interior queue sizes from the BO file.
   * Queue = unique back-order count matching that combo (same rules as new-customer queue).
   */
  buildAllQueueCombinations() {
    const headers = this.headers;
    const rows = this.dedupeRowsByOrderNumberForQueue(this.rows, headers);
    const productColumn = this.resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    const suffixColumn = this.resolveColumn(headers, [/^alj\s*suffix$/i, /\balj\s*suffix\b/i, /^au\s*suffix$/i, /\bau\s*suffix\b/i, /suffix/i, /trim/i, /grade/i]);
    const ext1 = this.resolvePriorityColumn(headers, 'ext', 1);
    const int1 = this.resolvePriorityColumn(headers, 'int', 1);
    const ext2 = this.resolvePriorityColumn(headers, 'ext', 2);
    const int2 = this.resolvePriorityColumn(headers, 'int', 2);
    const ext3 = this.resolvePriorityColumn(headers, 'ext', 3);
    const int3 = this.resolvePriorityColumn(headers, 'int', 3);
    if (!productColumn || !suffixColumn || !ext1 || !int1) {
      throw new Error('Required BO headers not found (Product, Suffix, Ext/Int)');
    }

    const groups = new Map();
    rows.forEach((row) => {
      const pRaw = String(row[productColumn] ?? '').trim();
      const sRaw = String(row[suffixColumn] ?? '').trim();
      const pNorm = this.normalizeText(pRaw);
      const sNorm = this.normalizeText(sRaw);
      if (!pNorm || pNorm === '-' || !sNorm || sNorm === '-') return;
      const key = `${pNorm}\0${sNorm}`;
      if (!groups.has(key)) {
        groups.set(key, {
          product: pRaw,
          productNorm: pNorm,
          suffix: sRaw,
          suffixNorm: sNorm,
          rows: [],
          exteriors: new Map(),
          interiors: new Map()
        });
      }
      const g = groups.get(key);
      g.rows.push(row);
      [ext1, ext2, ext3].filter(Boolean).forEach((col) => {
        const raw = String(row[col] ?? '').trim();
        const n = this.normalizeText(raw);
        if (!n || n === '-' || n === '*') return;
        if (!g.exteriors.has(n)) g.exteriors.set(n, raw);
      });
      [int1, int2, int3].filter(Boolean).forEach((col) => {
        const raw = String(row[col] ?? '').trim();
        const n = this.normalizeText(raw);
        if (!n || n === '-' || n === '*') return;
        if (!g.interiors.has(n)) g.interiors.set(n, raw);
      });
    });

    const productsMap = new Map();
    groups.forEach((g) => {
      const combinations = [];
      g.exteriors.forEach((extLabel, extNorm) => {
        g.interiors.forEach((intLabel, intNorm) => {
          const queue = g.rows.filter(
            (row) =>
              this.rowHasColorInAnyPrioritySlot(row, ext1, ext2, ext3, extNorm) &&
              this.rowHasColorInAnyPrioritySlot(row, int1, int2, int3, intNorm)
          ).length;
          if (queue <= 0) return;
          combinations.push({
            suffix: g.suffix,
            exterior: extLabel,
            interior: intLabel,
            queue
          });
        });
      });
      combinations.sort(
        (a, b) =>
          a.suffix.localeCompare(b.suffix) ||
          a.exterior.localeCompare(b.exterior) ||
          a.interior.localeCompare(b.interior)
      );

      if (!productsMap.has(g.productNorm)) {
        productsMap.set(g.productNorm, {
          product: g.product,
          orderCount: 0,
          combinations: []
        });
      }
      const productEntry = productsMap.get(g.productNorm);
      productEntry.orderCount += g.rows.length;
      productEntry.combinations.push(...combinations);
    });

    const products = Array.from(productsMap.values())
      .map((p) => ({
        ...p,
        combinations: p.combinations.sort(
          (a, b) =>
            a.suffix.localeCompare(b.suffix) ||
            a.exterior.localeCompare(b.exterior) ||
            a.interior.localeCompare(b.interior)
        )
      }))
      .sort((a, b) => a.product.localeCompare(b.product));

    return {
      totalProducts: products.length,
      totalCombinations: products.reduce((sum, p) => sum + p.combinations.length, 0),
      products
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
    const suffixColumn = this.resolveColumn(headers, [/^au\s*suffix$/i, /\bau\s*suffix\b/i, /^alj\s*suffix$/i, /alj\s*suffix/i, /suffix/i, /trim/i, /grade/i]);
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
        rule: 'Wildcard: Product+Suffix fixed; each combination shows how many reservations match (Exterior Color 1–3, Interior Color 1–3). A * on a BO row means any — e.g. DMG/* counts in every DMG/concrete-interior queue.'
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
      rule: 'Same Product+Suffix; exterior may appear in Exterior Color 1–3; interior may appear in Interior Color 1–3. * on a BO row matches any concrete color on that side (DMG/* counts in DMG/20 and DMG/30). Response is matching reservation count (not a rank).'
    };
  }

  lookupOrder(orderNumber) {
    const rows = this.rows;
    const headers = this.headers;
    const result = this.findOrderRow(rows, orderNumber, headers);
    if (!result) return null;
    const orderUnits = this.findOrderUnitsSorted(rows, headers, result.row, result.matchedColumn);
    const queueAnalysis = this.buildQueueAnalysis(rows, result.row, headers, result.matchedColumn);
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

}

module.exports = { BoOrderLookup };
