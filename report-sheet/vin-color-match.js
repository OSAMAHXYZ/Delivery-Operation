/**
 * Exterior / interior color dictionaries + paired-slot matching helpers.
 * BO color slots are paired: Ext1↔Int1, Ext2↔Int2, Ext3↔Int3 (no cross-mix).
 * "*" (or empty half of an active pair) means any color on that side.
 */
(function (global) {
  "use strict";

  // CODE|DISPLAYNAME — codes are primary match keys; names normalize to A-Z0-9
  const INTERIOR_LINES = [
    "90|AMETHYST90", "23|BLACK23", "05|BEIGE05", "20|BLACK20", "21|BLACK21", "22|BLACK22",
    "24|BLACK24", "25|BLACK25", "27|BLACK27", "28|BLACK28", "68|BLACK68", "16|BLUISHGREY16",
    "12|CHARCOAL12", "17|CHARCOAL17", "18|DK.GRAY18", "11|DKGREY11", "14|DARKGREY14",
    "15|DARKGREY15", "33|DARKROSE33", "34|DARKROSE34", "35|DARKROSE35", "42|FAWN42",
    "43|FAWN43", "38|FLARERED&BLACK38", "37|FLARERED37", "39|FLARERED39", "72|FLARERED72",
    "49|GRAYROOF/BRWON49", "46|GREGE46", "32|GARNET32", "13|GRAY13", "10|GREY10",
    "00|IVORY00", "01|IVORY01", "02|IVORY02", "04|IVORY04", "71|MAUVE71", "73|MAUVE73",
    "06|MELLOWWHITE06", "07|MELLOWWHITE07", "57|MUSTARD57", "47|NEUTRALBEIGE47",
    "60|RICHCREAM60", "61|RICHCREAM61", "62|RICHCREAM62", "63|RICHCREAM63", "64|RICHCREAM64",
    "70|RICHCREAM70", "44|SANDALWOOD44", "50|TOPAZBROWN50", "51|TOPAZBROWN51",
    "52|TOPAZBROWN52", "53|TOPAZBROWN53", "54|TOPAZBROWN54", "59|TOPAZBROWN59",
    "09|WATERWHITE09", "08|WHITEOCHER08",
  ];

  const EXTERIOR_LINES = [
    "8Z2|AETHERME.8Z2", "6W4|ALUMINAJADEME.6W4", "OOF|AMETHYST/BLACKROOF",
    "218|ATTITUDEBLACKMC218", "4X2|AMBERCS4X2", "4V8|AVANTGARDEBRONZE4V8",
    "4W1|BEIGE4W1", "4T1|BEIGEME.4T1", "4T8|BEIGEME.4T8", "8X8|BLACK(202)/BLUE(8X8)",
    "4V8|BLACK(202)/BRONZE(4V8)", "1L6|BLACK(202)/GRAY(1L6)", "1G3|BLACK(209)/GRAY(1G3)",
    "1F7|BLACK(209)/SILVER(1F7)", "040|BLACK(209)/WHITE(040)", "1L6|BLACK(227)/GRAY(1L6)",
    "2ZA|BLACK(227)/METAL(1L5)2ZA", "2ZR|BLACK(227)/RED3(3U9)-2ZR",
    "2ZB|BLACK(227)/SILVER(1J6)2ZB", "2XW|BLACK(227)/WHITEPEARL(090)2XW",
    "R40|BLACK(X13)/RED(R40)", "3R0|BLACKISHREDMC.3R0", "X12|BLACKM.X12",
    "OOF|BLACKMC/SILVERROOF", "D04|BLACKMETALLICD04", "X07|BLACKX07", "X09|BLACKX09",
    "X13|BLACKX13", "4Y1|BLAZINGCARNELIANCL4Y1", "2YZ|BLCK(227)/RED(3U5)2YZ",
    "W25|BLCK(X13)/WHITEP.SE(W25)", "4T0|BLONDM.M.4T0", "8V5|BLUE8V5", "8X7|BLUE8X7",
    "E8H|BLUEE8H", "8N0|BLUEME.8N0", "8L5|BLUEME8L5", "8U1|BLUEME8U1", "DAR|BRIGHTBLUEDAR",
    "4T3|BRONZEMM.4T3", "4W0|BROWN4W0", "4W9|BROWN4W9", "4P7|BEIGEMETALLIC4P7",
    "4R0|BEIGEMETALLIC4R0", "4S7|BEIGEMICAM.4S7", "4Q2|BEIGEMICAMETALLIC4Q2",
    "4Q8|BEIGEMICAMETALLIC4Q8", "4R2|BEIGEPEARLCS.4R2", "TAL|BLACK/P.METAL",
    "202|BLACK202", "212|BLACK212", "214|BLACK214", "209|BLACKMICA209",
    "3P6|BLACKISHREDMICA3P6", "2JV|BLUE/WHITE2JV", "8H6|BLUE8H6", "8U4|BLUE8U4",
    "8T0|BLUEM.M.8T0", "8R5|BLUEME8R5", "8T7|BLUEME8T7", "8T4|BLUEME.8T4",
    "8V2|BLUEME.8V2", "8P1|BLUEMETALLIC8P1", "1K3|CELESTITEGRAYME.1K3",
    "2TH|CELESTITEGRAYME/BLACKR2TH", "3T6|CRIMSONSPARKREDME.3T6", "8W9|CYANMETALLIC8W9",
    "4N5|CASHMERE4N5", "9AL|CATTLEYAM.M.9AL", "1H5|CEMENTGRAYMETALLIC1H5",
    "T23|CHAMPAGNEMETALLICT23", "587|CHAMPAGNEMICAMETALLIC587", "4S6|COPPERBROWNMC.4S6",
    "3S8|CRIMSONCS.GF.3S8", "B60|DARKBLUEMICAMETALLICB60", "B79|DARKBLUESEB79",
    "3R5|DARKREDMC.CC.3R5", "R54|DARKREDMICAR54", "778|DARKTURQUOISEM.M.778",
    "D13|DAWNBLUEMETALLICD13", "D07|DEEPBLUEMETALLICD07", "8X8|DK.BLUEMC.8X8",
    "8S6|DK.BLUEMC.8S6", "RAY|DK.GRAY", "8W7|DARKBLUE8W7", "4U3|DARKBROWN4U3",
    "9AH|DARKBLACK9AH", "8U0|DARKBLUEMC.8U0", "8R7|DARKBLUEMICAMETALLIC8R7",
    "8L4|DARKBLUEMICA8L4", "8P8|DARKBLUEMICA8P8", "8P4|DARKBLUEMICAMETALLIC8P4",
    "8R4|DARKBLUEMICAMETALLIC8R4", "4U5|DARKBROWNME.4U5", "4S2|DARKGOLDEN4S2",
    "1K4|DARKGRAY1K4", "61K|DARKGRAY61K", "PBA|DARKGRAYPBA", "6Q7|DARKGREENMICA6Q7",
    "6R4|DARKGREENMICA6R4", "6S7|DARKGREENMICA6S7", "6T3|DARKGREENMICA6T3",
    "6S3|DARKGREENMICAMETALLIC6S3", "1E0|DARKGREYMICA1E0", "1E9|DARKGREYMICAMETALLIC1E9",
    "061|DIAMONDWHITE061", "9AB|DRAKPURPLEMICAM.9AB", "F2T|EMOTIONALRED2/BLACKROOF2T",
    "3U5|EMOTIONALRED23U5", "3U9|EMOTIONALRED33U9", "6X7|EVERREST6X7",
    "4V3|FIREAGATEM.M.4V3", "8Y7|FORCEBLUEMULTIPLE8Y7", "1G5|FROSTYPEARLMC.1G5",
    "4X7|GRAPHITEME.4X7", "8W2|GRAYISHBLUE8W2", "8R3|GRAYISHBLUEME.8R3",
    "4P9|GRAYISHBROWNME4P9", "2NB|GRAYME./BLACKROOF2NB", "LIC|GRAYMETALLIC",
    "1M1|GRAYMETALLICMATTE1M1", "6T7|GREEN6T7", "NMM|GREENM.M.", "3S0|GARNETRED3S0",
    "1J1|GINBUCKMETALLIC1J1", "5B2|GOLD5B2", "1G3|GRAYME1G3", "1F5|GRAYMICAMETALIC1F5",
    "S33|GRAYS33", "S37|GRAYS37", "8T1|GRAYISHBLUEM.M.8T1", "6U7|GREENM.M.6U7",
    "6V2|GREENM.M.6V2", "6T5|GREENMICAMETALIC6T5", "6S5|GREENMICAMETALLIC6S5",
    "6M3|GREYGREENMETALLIC6M3", "1F9|GREYME.1F9", "1D2|GREYMETALLIC1D2",
    "1E3|GREYMICAMETALLIC1E3", "8P6|GREYISHBLUEMETALLIC8P6",
    "4S1|GREYISHBROWNMICAMETALIC4S1", "094|HAKUJI094", "8Z1|HEATBLUESATIN8Z1",
    "D09|HORIZONBLUED09", "8Y0|HEATBLUECONTRASTLAYER8Y0", "1L3|I.SILVER1L3",
    "4X8|ICEECRUMM4X8", "8V3|LAPISLAZULIMC8V3", "4W7|LAVAORANGEMC4W7",
    "772|LIGHTAQUAMICAMETALLIC772", "8R0|LIGHTBLUE8R0", "8S0|LIGHTBLUE8S0",
    "8W8|LIGHTBLUE8W8", "B72|LIGHTBLUEB72", "8S9|LIGHTBLUEM.M8S9", "8Q6|LIGHTBLUEME8Q6",
    "8R6|LIGHTBLUEMETALIC8R6", "8R8|LIGHTBLUEMICAMETALLIC8R8", "4U1|LIGHTGOLDEN4U1",
    "6U0|LIGHTGREENME6U0", "6S8|LIGHTGREENMM6S8", "6T2|LIGHTGREENMICAMETALLIC6T2",
    "6T1|LIGHTOLIVEMICAMETALLIC6T1", "8S4|LT.BLUEME.8S4", "8M7|LT.BLUEME8M7",
    "8S1|LT.BLUEMICAMETALLIC8S1", "P8Y|MAGNETITEGRAYMETALLICP8Y", "RAY|MASSIVEGRAY",
    "4Z1|MOONDESERT4Z1", "3T2|MADDERRED3T2", "1K2|MAGANESELUSTER1K2",
    "173|MAGNETICSILVER173", "R56|MAROONMICAR56", "9K4|MATTBLACK9K4",
  ];

  function compactColor(s) {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function buildDict(lines) {
    const byCode = new Map(); // code -> Set(names)
    const byName = new Map(); // name -> Set(codes)
    const codes = [];
    lines.forEach((line) => {
      const [codeRaw, nameRaw] = String(line).split("|");
      const code = String(codeRaw || "").trim().toUpperCase();
      if (!code) return;
      const name = compactColor(nameRaw);
      if (!byCode.has(code)) {
        byCode.set(code, new Set());
        codes.push(code);
      }
      if (name) {
        byCode.get(code).add(name);
        if (!byName.has(name)) byName.set(name, new Set());
        byName.get(name).add(code);
      }
    });
    codes.sort((a, b) => b.length - a.length || a.localeCompare(b));
    return { byCode, byName, codes };
  }

  const INT_DICT = buildDict(INTERIOR_LINES);
  const EXT_DICT = buildDict(EXTERIOR_LINES);

  function isEmptyColor(raw) {
    const s = String(raw ?? "").trim();
    return !s || s === "-" || s === "—";
  }

  function isWildcard(raw) {
    const s = String(raw ?? "").trim();
    return !s || s === "*" || s === "-" || s === "—" || /^any$/i.test(s);
  }

  function parseColor(raw, kind) {
    const dict = kind === "ext" ? EXT_DICT : INT_DICT;
    const original = String(raw ?? "").trim();
    if (isWildcard(original)) {
      return { any: true, codes: [], names: [], original };
    }

    const codes = new Set();
    const names = new Set();
    const compact = compactColor(original);
    if (compact) names.add(compact);

    const dash = original.match(/^([A-Za-z0-9]{1,6})\s*[-–—]\s*(.+)$/);
    if (dash) {
      codes.add(dash[1].toUpperCase());
      const n = compactColor(dash[2]);
      if (n) names.add(n);
    }

    for (const m of original.matchAll(/\(([A-Za-z0-9]{1,6})\)/g)) {
      codes.add(m[1].toUpperCase());
    }

    const lead = original.match(/^([A-Za-z0-9]{2,4})(?![A-Za-z0-9])/);
    if (lead) codes.add(lead[1].toUpperCase());

    if (dict.byName.has(compact)) {
      dict.byName.get(compact).forEach((c) => codes.add(c));
    }

    for (const code of dict.codes) {
      if (compact === code || compact.endsWith(code)) {
        codes.add(code);
        break;
      }
    }

    // Expand known codes → dictionary names
    [...codes].forEach((code) => {
      const set = dict.byCode.get(code);
      if (set) set.forEach((n) => names.add(n));
    });

    return { any: false, codes: [...codes], names: [...names], original };
  }

  function colorsMatch(aRaw, bRaw, kind) {
    const a = typeof aRaw === "object" && aRaw && "any" in aRaw ? aRaw : parseColor(aRaw, kind);
    const b = typeof bRaw === "object" && bRaw && "any" in bRaw ? bRaw : parseColor(bRaw, kind);
    if (a.any || b.any) return true;

    for (const c of a.codes) {
      if (b.codes.includes(c)) return true;
    }
    for (const n of a.names) {
      if (n.length >= 3 && b.names.includes(n)) return true;
    }

    const dict = kind === "ext" ? EXT_DICT : INT_DICT;
    for (const c of a.codes) {
      const names = dict.byCode.get(c);
      if (!names) continue;
      for (const n of names) {
        if (b.names.includes(n)) return true;
      }
    }
    for (const c of b.codes) {
      const names = dict.byCode.get(c);
      if (!names) continue;
      for (const n of names) {
        if (a.names.includes(n)) return true;
      }
    }

    // Fallback: compact equality / containment for free-text cells
    const ac = compactColor(a.original);
    const bc = compactColor(b.original);
    if (ac && bc && (ac === bc || (ac.length >= 4 && bc.includes(ac)) || (bc.length >= 4 && ac.includes(bc)))) {
      return true;
    }
    return false;
  }

  /**
   * BO may list up to 3 color preference pairs. Match only within the same slot index.
   * Returns { pair: 1|2|3, score, extWild, intWild } or null.
   */
  function matchPairedColors(stockExt, stockInt, pairs) {
    const list = pairs || [];
    let best = null;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      if (!p) continue;
      const eRaw = p.ext;
      const iRaw = p.int;
      // Skip completely empty unused slots (but allow explicit * / *)
      if (isEmptyColor(eRaw) && isEmptyColor(iRaw)) continue;
      // If both are wildcards explicitly marked (*), still allow
      const extOk = colorsMatch(stockExt, eRaw, "ext");
      const intOk = colorsMatch(stockInt, iRaw, "int");
      if (!extOk || !intOk) continue;

      const extWild = isWildcard(eRaw);
      const intWild = isWildcard(iRaw);
      let score = 40; // product+suffix assumed by caller
      score += extWild ? 20 : 30;
      score += intWild ? 20 : 30;
      if (score > 100) score = 100;

      const hit = { pair: i + 1, score, extWild, intWild, boExt: eRaw, boInt: iRaw };
      if (!best || hit.score > best.score) best = hit;
    }
    return best;
  }

  /** RTL secondary status (Col L): only these two values are eligible for matching. */
  function rtlStatusAllowed(...rawParts) {
    const s = rawParts
      .map((p) => String(p ?? "").toLowerCase().replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" | ");
    if (!s) return false;
    return s.includes("sales order created") || s.includes("vehicle allocation completed");
  }

  global.VinColorMatch = {
    parseColor,
    colorsMatch,
    matchPairedColors,
    rtlStatusAllowed,
    isWildcard,
    compactColor,
    INT_DICT,
    EXT_DICT,
  };
})(typeof window !== "undefined" ? window : globalThis);
