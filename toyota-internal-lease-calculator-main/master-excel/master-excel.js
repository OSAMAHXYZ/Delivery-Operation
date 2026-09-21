/**
 * Master Excel — color dictionary classes
 * Source: master_sheet.xlsx
 *   - ExteriorColorDictionary
 *   - InteriorColorDictionary
 *
 * Standalone module used by master-excel.html (sibling of master-page.html).
 */
(function (global) {
  'use strict';

  function normalizeKey(value) {
    return String(value == null ? '' : value)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /**
   * One exterior color row from ExteriorColorDictionary.
   */
  class ExteriorColor {
    /**
     * @param {string} code ColorCode
     * @param {string} name ColorName
     */
    constructor(code, name) {
      this.code = String(code || '').trim();
      this.name = String(name || '').trim();
    }

    get normalizedName() {
      return normalizeKey(this.name);
    }

    matches(value) {
      const v = String(value || '').trim();
      if (!v) return false;
      if (v.toUpperCase() === this.code.toUpperCase()) return true;
      if (normalizeKey(v) === this.normalizedName) return true;
      return false;
    }

    toJSON() {
      return { code: this.code, name: this.name };
    }
  }

  /**
   * One interior color row from InteriorColorDictionary.
   */
  class InteriorColor {
    /**
     * @param {string} code ColorCode
     * @param {string} name ColorName
     */
    constructor(code, name) {
      this.code = String(code || '').trim();
      this.name = String(name || '').trim();
    }

    get normalizedName() {
      return normalizeKey(this.name);
    }

    matches(value) {
      const v = String(value || '').trim();
      if (!v) return false;
      if (v === this.code || v.replace(/^0+/, '') === String(this.code).replace(/^0+/, '')) return true;
      if (v.toUpperCase() === this.code.toUpperCase()) return true;
      if (normalizeKey(v) === this.normalizedName) return true;
      const trailing = v.match(/(\d{1,3})\s*$/);
      if (trailing && trailing[1] === this.code) return true;
      return false;
    }

    toJSON() {
      return { code: this.code, name: this.name };
    }
  }

  /**
   * ExteriorColorDictionary sheet as a lookup class.
   */
  class ExteriorColorDictionary {
    /** @param {Array<{code:string,name:string}>} [entries] */
    constructor(entries) {
      this.entries = (entries || ExteriorColorDictionary.DEFAULT_ENTRIES).map(
        (e) => new ExteriorColor(e.code, e.name)
      );
      this._byCode = new Map();
      this._byName = new Map();
      this.entries.forEach((e) => {
        if (e.code) this._byCode.set(e.code.toUpperCase(), e);
        if (e.normalizedName) this._byName.set(e.normalizedName, e);
      });
    }

    get size() {
      return this.entries.length;
    }

    /** @returns {ExteriorColor[]} */
    all() {
      return this.entries.slice();
    }

    /** @param {string} code @returns {ExteriorColor|null} */
    getByCode(code) {
      if (code == null || code === '') return null;
      return this._byCode.get(String(code).trim().toUpperCase()) || null;
    }

    /** @param {string} name @returns {ExteriorColor|null} */
    getByName(name) {
      if (!name) return null;
      return this._byName.get(normalizeKey(name)) || null;
    }

    /**
     * Resolve a stock/export exterior value to a ColorCode.
     * @param {string} value
     * @returns {string}
     */
    resolveCode(value) {
      const s = String(value || '').trim();
      if (!s) return '';
      if (/^[A-Z0-9]{2,4}$/i.test(s)) {
        const hit = this.getByCode(s);
        return (hit ? hit.code : s).toUpperCase();
      }
      const byName = this.getByName(s);
      if (byName) return byName.code.toUpperCase();

      const parts = s.split(/\s+/);
      const last = parts[parts.length - 1];
      if (/^[A-Z0-9]{2,4}$/i.test(last)) {
        const hit = this.getByCode(last);
        return (hit ? hit.code : last).toUpperCase();
      }

      const compact = normalizeKey(s);
      for (const e of this.entries) {
        if (e.normalizedName && (compact.includes(e.normalizedName) || e.normalizedName.includes(compact))) {
          return e.code.toUpperCase();
        }
      }

      if (/black/i.test(s) && !/\d/.test(last)) {
        const neutral = this.getByName('NEUTRALBLACK') || this.getByCode('ACK');
        if (neutral) return neutral.code.toUpperCase();
        return 'BLACK';
      }
      return last ? last.toUpperCase() : '';
    }

    /** @param {string} value @returns {string} */
    resolveName(value) {
      const code = this.resolveCode(value);
      const hit = this.getByCode(code);
      return hit ? hit.name : String(value || '').trim();
    }
  }

  /**
   * InteriorColorDictionary sheet as a lookup class.
   */
  class InteriorColorDictionary {
    /** @param {Array<{code:string,name:string}>} [entries] */
    constructor(entries) {
      this.entries = (entries || InteriorColorDictionary.DEFAULT_ENTRIES).map(
        (e) => new InteriorColor(e.code, e.name)
      );
      this._byCode = new Map();
      this._byName = new Map();
      this.entries.forEach((e) => {
        if (e.code !== '') this._byCode.set(String(e.code), e);
        if (e.normalizedName) this._byName.set(e.normalizedName, e);
      });
    }

    get size() {
      return this.entries.length;
    }

    /** @returns {InteriorColor[]} */
    all() {
      return this.entries.slice();
    }

    /** @param {string} code @returns {InteriorColor|null} */
    getByCode(code) {
      if (code == null || code === '') return null;
      const raw = String(code).trim();
      return this._byCode.get(raw) || this._byCode.get(raw.replace(/^0+/, '') || '0') || null;
    }

    /** @param {string} name @returns {InteriorColor|null} */
    getByName(name) {
      if (!name) return null;
      return this._byName.get(normalizeKey(name)) || null;
    }

    /**
     * Resolve a stock/export interior value to a ColorCode.
     * @param {string} value
     * @returns {string}
     */
    resolveCode(value) {
      const s = String(value || '').trim();
      if (!s) return '';
      if (/^\d{1,3}$/.test(s)) {
        const hit = this.getByCode(s);
        return hit ? hit.code : s;
      }
      const byName = this.getByName(s);
      if (byName) return byName.code;
      const trailing = s.match(/(\d{1,3})\s*$/);
      if (trailing) {
        const hit = this.getByCode(trailing[1]);
        return hit ? hit.code : trailing[1];
      }
      return s.toUpperCase();
    }

    /** @param {string} value @returns {string} */
    resolveName(value) {
      const code = this.resolveCode(value);
      const hit = this.getByCode(code);
      return hit ? hit.name : String(value || '').trim();
    }
  }

  /** Combined helper for master excel color resolution. */
  class MasterExcelColors {
    constructor(exteriorEntries, interiorEntries) {
      this.exterior = new ExteriorColorDictionary(exteriorEntries);
      this.interior = new InteriorColorDictionary(interiorEntries);
    }

    resolveExteriorCode(value) {
      return this.exterior.resolveCode(value);
    }

    resolveInteriorCode(value) {
      return this.interior.resolveCode(value);
    }

    resolveExteriorName(value) {
      return this.exterior.resolveName(value);
    }

    resolveInteriorName(value) {
      return this.interior.resolveName(value);
    }
  }

  ExteriorColorDictionary.DEFAULT_ENTRIES = [
    { code: "8Z2", name: "AETHERME.8Z2" },
    { code: "6W4", name: "ALUMINAJADEME.6W4" },
    { code: "OOF", name: "AMETHYST/BLACKROOF" },
    { code: "218", name: "ATTITUDEBLACKMC218" },
    { code: "4X2", name: "AMBERCS4X2" },
    { code: "4V8", name: "AVANTGARDEBRONZE4V8" },
    { code: "4W1", name: "BEIGE4W1" },
    { code: "4T1", name: "BEIGEME.4T1" },
    { code: "4T8", name: "BEIGEME.4T8" },
    { code: "8X8", name: "BLACK(202)/BLUE(8X8)" },
    { code: "4V8", name: "BLACK(202)/BRONZE(4V8)" },
    { code: "1L6", name: "BLACK(202)/GRAY(1L6)" },
    { code: "1G3", name: "BLACK(209)/GRAY(1G3)" },
    { code: "1F7", name: "BLACK(209)/SILVER(1F7)" },
    { code: "040", name: "BLACK(209)/WHITE(040)" },
    { code: "1L6", name: "BLACK(227)/GRAY(1L6)" },
    { code: "2ZA", name: "BLACK(227)/METAL(1L5)2ZA" },
    { code: "2ZR", name: "BLACK(227)/RED3(3U9)-2ZR" },
    { code: "2ZB", name: "BLACK(227)/SILVER(1J6)2ZB" },
    { code: "2XW", name: "BLACK(227/WHITEPEARL(090)2XW" },
    { code: "R40", name: "BLACK(X13)/RED(R40)" },
    { code: "3R0", name: "BLACKISHREDMC.3R0" },
    { code: "X12", name: "BLACKM.X12" },
    { code: "OOF", name: "BLACKMC/SILVERROOF" },
    { code: "D04", name: "BLACKMETALLICD04" },
    { code: "X07", name: "BLACKX07" },
    { code: "X09", name: "BLACKX09" },
    { code: "X13", name: "BLACKX13" },
    { code: "4Y1", name: "BLAZINGCARNELIANCL4Y1" },
    { code: "2YZ", name: "BLCK(227)/RED(3U5)2YZ" },
    { code: "W25", name: "BLCK(X13)/WHITEP.SE(W25)" },
    { code: "4T0", name: "BLONDM.M.4T0" },
    { code: "8V5", name: "BLUE8V5" },
    { code: "8X7", name: "BLUE8X7" },
    { code: "E8H", name: "BLUEE8H" },
    { code: "8N0", name: "BLUEME.8N0" },
    { code: "8L5", name: "BLUEME8L5" },
    { code: "8U1", name: "BLUEME8U1" },
    { code: "DAR", name: "BRIGHTBLUEDAR" },
    { code: "4T3", name: "BRONZEMM.4T3" },
    { code: "4W0", name: "BROWN4W0" },
    { code: "4W9", name: "BROWN4W9" },
    { code: "4P7", name: "BEIGEMETALLIC4P7" },
    { code: "4R0", name: "BEIGEMETALLIC4R0" },
    { code: "4S7", name: "BEIGEMICAM.4S7" },
    { code: "4Q2", name: "BEIGEMICAMETALLIC4Q2" },
    { code: "4Q8", name: "BEIGEMICAMETALLIC4Q8" },
    { code: "4R2", name: "BEIGEPEARLCS.4R2" },
    { code: "TAL", name: "BLACK/P.METAL" },
    { code: "202", name: "BLACK202" },
    { code: "212", name: "BLACK212" },
    { code: "214", name: "BLACK214" },
    { code: "209", name: "BLACKMICA209" },
    { code: "3P6", name: "BLACKISHREDMICA3P6" },
    { code: "2JV", name: "BLUE/WHITE2JV" },
    { code: "8H6", name: "BLUE8H6" },
    { code: "8U4", name: "BLUE8U4" },
    { code: "8T0", name: "BLUEM.M.8T0" },
    { code: "8R5", name: "BLUEME8R5" },
    { code: "8T7", name: "BLUEME8T7" },
    { code: "8T4", name: "BLUEME.8T4" },
    { code: "8V2", name: "BLUEME.8V2" },
    { code: "8P1", name: "BLUEMETALLIC8P1" },
    { code: "1K3", name: "CELESTITEGRAYME.1K3" },
    { code: "2TH", name: "CELESTITEGRAYME/BLACKR2TH" },
    { code: "3T6", name: "CRIMSONSPARKREDME.3T6" },
    { code: "8W9", name: "CYANMETALLIC8W9" },
    { code: "4N5", name: "CASHMERE4N5" },
    { code: "9AL", name: "CATTLEYAM.M.9AL" },
    { code: "1H5", name: "CEMENTGRAYMETALLIC1H5" },
    { code: "T23", name: "CHAMPAGNEMETALLICT23" },
    { code: "587", name: "CHAMPAGNEMICAMETALLIC587" },
    { code: "4S6", name: "COPPERBROWNMC.4S6" },
    { code: "3S8", name: "CRIMSONCS.GF.3S8" },
    { code: "B60", name: "DARKBLUEMICAMETALLICB60" },
    { code: "B79", name: "DARKBLUESEB79" },
    { code: "3R5", name: "DARKREDMC.CC.3R5" },
    { code: "R54", name: "DARKREDMICAR54" },
    { code: "778", name: "DARKTURQUOISEM.M.778" },
    { code: "D13", name: "DAWNBLUEMETALLICD13" },
    { code: "D07", name: "DEEPBLUEMETALLICD07" },
    { code: "8X8", name: "DK.BLUEMC.8X8" },
    { code: "8S6", name: "DK.BLUEMC.8S6" },
    { code: "RAY", name: "DK.GRAY" },
    { code: "8W7", name: "DARKBLUE8W7" },
    { code: "4U3", name: "DARKBROWN4U3" },
    { code: "9AH", name: "DARKBLACK9AH" },
    { code: "8U0", name: "DARKBLUEMC.8U0" },
    { code: "8R7", name: "DARKBLUEMICAMETALLIC8R7" },
    { code: "8L4", name: "DARKBLUEMICA8L4" },
    { code: "8P8", name: "DARKBLUEMICA8P8" },
    { code: "8P4", name: "DARKBLUEMICAMETALLIC8P4" },
    { code: "8R4", name: "DARKBLUEMICAMETALLIC8R4" },
    { code: "4U5", name: "DARKBROWNME.4U5" },
    { code: "4S2", name: "DARKGOLDEN4S2" },
    { code: "1K4", name: "DARKGRAY1K4" },
    { code: "61K", name: "DARKGRAY61K" },
    { code: "PBA", name: "DARKGRAYPBA" },
    { code: "6Q7", name: "DARKGREENMICA6Q7" },
    { code: "6R4", name: "DARKGREENMICA6R4" },
    { code: "6S7", name: "DARKGREENMICA6S7" },
    { code: "6T3", name: "DARKGREENMICA6T3" },
    { code: "6S3", name: "DARKGREENMICAMETALLIC6S3" },
    { code: "1E0", name: "DARKGREYMICA1E0" },
    { code: "1E9", name: "DARKGREYMICAMETALLIC1E9" },
    { code: "061", name: "DIAMONDWHITE061" },
    { code: "9AB", name: "DRAKPURPLEMICAM.9AB" },
    { code: "F2T", name: "EMOTIONALRED2/BLACKROOF2T" },
    { code: "3U5", name: "EMOTIONALRED23U5" },
    { code: "3U9", name: "EMOTIONALRED33U9" },
    { code: "6X7", name: "EVERREST6X7" },
    { code: "4V3", name: "FIREAGATEM.M.4V3" },
    { code: "8Y7", name: "FORCEBLUEMULTIPLE8Y7" },
    { code: "1G5", name: "FROSTYPEARLMC.1G5" },
    { code: "4X7", name: "GRAPHITEME.4X7" },
    { code: "8W2", name: "GRAYISHBLUE8W2" },
    { code: "8R3", name: "GRAYISHBLUEME.8R3" },
    { code: "4P9", name: "GRAYISHBROWNME4P9" },
    { code: "2NB", name: "GRAYME./BLACKROOF2NB" },
    { code: "LIC", name: "GRAYMETALLIC" },
    { code: "1M1", name: "GRAYMETALLICMATTE1M1" },
    { code: "6T7", name: "GREEN6T7" },
    { code: "NMM", name: "GREENM.M." },
    { code: "3S0", name: "GARNETRED3S0" },
    { code: "1J1", name: "GINBUCKMETALLIC1J1" },
    { code: "5B2", name: "GOLD5B2" },
    { code: "1G3", name: "GRAYME1G3" },
    { code: "1F5", name: "GRAYMICAMETALIC1F5" },
    { code: "S33", name: "GRAYS33" },
    { code: "S37", name: "GRAYS37" },
    { code: "8T1", name: "GRAYISHBLUEM.M.8T1" },
    { code: "6U7", name: "GREENM.M.6U7" },
    { code: "6V2", name: "GREENM.M.6V2" },
    { code: "6T5", name: "GREENMICAMETALIC6T5" },
    { code: "6S5", name: "GREENMICAMETALLIC6S5" },
    { code: "6M3", name: "GREYGREENMETALLIC6M3" },
    { code: "1F9", name: "GREYME.1F9" },
    { code: "1D2", name: "GREYMETALLIC1D2" },
    { code: "1E3", name: "GREYMICAMETALLIC1E3" },
    { code: "8P6", name: "GREYISHBLUEMETALLIC8P6" },
    { code: "4S1", name: "GREYISHBROWNMICAMETALIC4S1" },
    { code: "094", name: "HAKUJI094" },
    { code: "8Z1", name: "HEATBLUESATIN8Z1" },
    { code: "D09", name: "HORIZONBLUED09" },
    { code: "8Y0", name: "HEATBLUECONTRASTLAYER8Y0" },
    { code: "1L3", name: "I.SILVER1L3" },
    { code: "4X8", name: "ICEECRUMM4X8" },
    { code: "8V3", name: "LAPISLAZULIMC8V3" },
    { code: "4W7", name: "LAVAORANGEMC4W7" },
    { code: "772", name: "LIGHTAQUAMICAMETALLIC772" },
    { code: "8R0", name: "LIGHTBLUE8R0" },
    { code: "8S0", name: "LIGHTBLUE8S0" },
    { code: "8W8", name: "LIGHTBLUE8W8" },
    { code: "B72", name: "LIGHTBLUEB72" },
    { code: "8S9", name: "LIGHTBLUEM.M8S9" },
    { code: "8Q6", name: "LIGHTBLUEME8Q6" },
    { code: "8R6", name: "LIGHTBLUEMETALIC8R6" },
    { code: "8R8", name: "LIGHTBLUEMICAMETALLIC8R8" },
    { code: "4U1", name: "LIGHTGOLDEN4U1" },
    { code: "6U0", name: "LIGHTGREENME6U0" },
    { code: "6S8", name: "LIGHTGREENMM6S8" },
    { code: "6T2", name: "LIGHTGREENMICAMETALLIC6T2" },
    { code: "6T1", name: "LIGHTOLIVEMICAMETALLIC6T1" },
    { code: "8S4", name: "LT.BLUEME.8S4" },
    { code: "8M7", name: "LT.BLUEME8M7" },
    { code: "8S1", name: "LT.BLUEMICAMETALLIC8S1" },
    { code: "P8Y", name: "MAGNETITEGRAYMETALLICP8Y" },
    { code: "RAY", name: "MASSIVEGRAY" },
    { code: "4Z1", name: "MOONDESERT4Z1" },
    { code: "3T2", name: "MADDERRED3T2" },
    { code: "1K2", name: "MAGANESELUSTER1K2" },
    { code: "173", name: "MAGNETICSILVER173" },
    { code: "R56", name: "MAROONMICAR56" },
    { code: "9K4", name: "MATTBLACK9K4" },
    { code: "1F8", name: "MEDIUMSILVERME.1F8" },
    { code: "1H9", name: "MERCURYGRAYMC1H9" },
    { code: "RAY", name: "METALLICGRAY" },
    { code: "VER", name: "METALLICSILVER" },
    { code: "OOF", name: "METALLICSILVER/BLACKROOF" },
    { code: "8W3", name: "METEORBLUEM.M.8W3" },
    { code: "DMG", name: "MOSSGREENDMG" },
    { code: "8X2", name: "NEBULABLUEME.8X2" },
    { code: "2NH", name: "NEBULABLUEME/BLACKROOF2NH" },
    { code: "ACK", name: "NEUTRALBLACK" },
    { code: "1N0", name: "NEUTRINOGRAY1N0" },
    { code: "000", name: "NISSANCOLOR000" },
    { code: "5C1", name: "NAPLESYELLOW5C1" },
    { code: "9H3", name: "NISSAN9H3" },
    { code: "LUE", name: "OASISBLUE" },
    { code: "OOF", name: "P.RED/BLACKROOF" },
    { code: "OOF", name: "P.WHITE/BLACKROOF" },
    { code: "OOF", name: "P.WHITE/BLACKROOF" },
    { code: "072", name: "PEARLWHITE072" },
    { code: "D19", name: "PLASMAORANGED19" },
    { code: "219", name: "PRECIOUSBLACK219" },
    { code: "ACK", name: "PRECIOUSBRONZE&BLACK" },
    { code: "4Y6", name: "PRECIOUSBRONZE4Y6" },
    { code: "1L5", name: "PRECIOUSMETAL1L5" },
    { code: "1J6", name: "PRECIOUSSILVER1J6" },
    { code: "090", name: "PRECIOUSWHITEPEARL090" },
    { code: "D05", name: "PROMINENCEREDD05" },
    { code: "M7Y", name: "PUREREDM7Y" },
    { code: "ACK", name: "PEARLBLACK" },
    { code: "RED", name: "PEARLRED" },
    { code: "ITE", name: "PEARLWHITE" },
    { code: "5B0", name: "PEARLYELLOW5B0" },
    { code: "1J4", name: "PLATINUMSILVERME1J4" },
    { code: "089", name: "PLATINUMWHITEPEARLMC089" },
    { code: "4T2", name: "PREMIUMBROWN4T2" },
    { code: "8T9", name: "PREMIUMLT.BLUE8T9" },
    { code: "3M8", name: "REDMICA3M8" },
    { code: "3Q3", name: "REDMICAMETALLIC3Q3" },
    { code: "8X1", name: "RADIANTBLUECL8X1" },
    { code: "3T5", name: "RADIANTREDCL.3T5" },
    { code: "3L5", name: "RED3L5" },
    { code: "3S1", name: "RED3S1" },
    { code: "3T0", name: "RED3T0" },
    { code: "3T7", name: "RED3T7" },
    { code: "3TO", name: "RED3TO" },
    { code: "C7P", name: "REDC7P" },
    { code: "3R3", name: "REDM.M.3R3" },
    { code: "3N8", name: "REDM.M3N8" },
    { code: "3R1", name: "REDMICACS.3R1" },
    { code: "3P1", name: "REDMICAMETALLIC3P1" },
    { code: "2JX", name: "REDSOLID/WHITE2JX" },
    { code: "AND", name: "SAND" },
    { code: "1M4", name: "SAND(5C8)/LT.GRAY(1M4)" },
    { code: "WCH", name: "SAPPHIREBLUEPEARLWCH" },
    { code: "ETT", name: "SCARLETT" },
    { code: "3R4", name: "SHELLM.M.3R4" },
    { code: "R40", name: "SHINNINGREDR40" },
    { code: "S28", name: "SILVERS28" },
    { code: "LUE", name: "SMOKYBLUE" },
    { code: "1M4", name: "SMOKYBLUE(8X0)/LT.GRAY(1M4" },
    { code: "WCL", name: "SOLARORANGEPEARLWCL" },
    { code: "1L1", name: "SONICCHROME1L1" },
    { code: "4Y5", name: "SONICCOPPER4Y5" },
    { code: "1L2", name: "SONICIRIDIUM1L2" },
    { code: "220", name: "SPARKLINGBLACK220" },
    { code: "4X1", name: "STEELBLONDEME.4X1" },
    { code: "6X0", name: "SUNLIGHTGREENMM6X0" },
    { code: "LOW", name: "SUNRISEYELLOW" },
    { code: "4T5", name: "SABLEMICAMETALLEC4T5" },
    { code: "8V4", name: "SHADOWSAPPHIRE8V4" },
    { code: "3Q4", name: "SHELLMETALLIC3Q4" },
    { code: "5A4", name: "SILKYGOLDMICA5A4" },
    { code: "5A7", name: "SILKYGOLDM.M5A7" },
    { code: "1F2", name: "SILVER1F2" },
    { code: "1F7", name: "SILVER1F7" },
    { code: "1D6", name: "SILVERME.1D6" },
    { code: "199", name: "SILVERMETALLIC199" },
    { code: "1C0", name: "SILVERMETALLIC1C0" },
    { code: "085", name: "SONICQUARTZ085" },
    { code: "1J2", name: "SONICSILVER1J2" },
    { code: "1J7", name: "SONICTITANIUM1J7" },
    { code: "1H3", name: "SPARKLESOLIDGRAY1H3" },
    { code: "8X9", name: "SPARKLINGMETEORME8X9" },
    { code: "LUE", name: "SPEEDYBLUE" },
    { code: "ESY", name: "SPEEDYBLUE/BLACKROOFESY" },
    { code: "217", name: "STARLIGHTBLACKGF217" },
    { code: "9J3", name: "STEELBLUE9J3" },
    { code: "9H9", name: "STEELGRAY9H9" },
    { code: "3E5", name: "SUPERRED3E5" },
    { code: "3P0", name: "SUPERREDV3P0" },
    { code: "040", name: "SUPERWHITEII040" },
    { code: "051", name: "SUPERWHITEPEARLMICA051" },
    { code: "OOF", name: "TEAL/BLACKROOF" },
    { code: "6X4", name: "TERRANEKHAKIM.M.6X4" },
    { code: "1L8", name: "TITANIUMCARBIDEGRAY1L8" },
    { code: "EMM", name: "TURQUOISEM.M." },
    { code: "779", name: "TURQUOISEM.M.779" },
    { code: "OOF", name: "TURQUOISEM.M/BLACKROOF" },
    { code: "2LS", name: "TWOTONESMOKYBLUE2LS" },
    { code: "2PS", name: "WHITE/BLACK2PS" },
    { code: "2KC", name: "WHITE/BLACKME.2KC" },
    { code: "2KD", name: "WHITE/DK.GREEN2KD" },
    { code: "2KB", name: "WHITE/GREYME.2KB" },
    { code: "2JU", name: "WHITE/YELLOW2JU" },
    { code: "056", name: "WHITE056" },
    { code: "058", name: "WHITE058" },
    { code: "D01", name: "WHITEMETALLICD01" },
    { code: "2NA", name: "WHITEPEARLCS/BLACKROOF2NA" },
    { code: "E25", name: "WHITEPEARLSE.25" },
    { code: "W09", name: "WHITEW09" },
    { code: "1B1", name: "WARMSILVERMETALLIC1B1" },
    { code: "2DT", name: "WHITE/LAVENDER2DT" },
    { code: "2HL", name: "WHITE/TURQUOISE2HL" },
    { code: "068", name: "WHITE068" },
    { code: "083", name: "WHITENOVAGF083" },
    { code: "073", name: "WHITEPEARL073" },
    { code: "062", name: "WHITEPEARLCS.062" },
    { code: "065", name: "WHITEPEARLCS.065" },
    { code: "070", name: "WHITEPEARLCS.070" },
    { code: "071", name: "WHITEPEARLCS.071" },
    { code: "37J", name: "WHITE37J" },
    { code: "K1X", name: "WHITEK1X" }
  ];

  InteriorColorDictionary.DEFAULT_ENTRIES = [
    { code: "90", name: "AMETHYST90" },
    { code: "23", name: "BLACK23" },
    { code: "05", name: "BEIGE05" },
    { code: "20", name: "BLACK20" },
    { code: "21", name: "BLACK21" },
    { code: "22", name: "BLACK22" },
    { code: "24", name: "BLACK24" },
    { code: "25", name: "BLACK25" },
    { code: "27", name: "BLACK27" },
    { code: "28", name: "BLACK28" },
    { code: "68", name: "BLACK68" },
    { code: "16", name: "BLUISHGREY16" },
    { code: "12", name: "CHARCOAL12" },
    { code: "17", name: "CHARCOAL17" },
    { code: "18", name: "DK.GRAY18" },
    { code: "11", name: "DKGREY11" },
    { code: "14", name: "DARKGREY14" },
    { code: "15", name: "DARKGREY15" },
    { code: "33", name: "DARKROSE33" },
    { code: "34", name: "DARKROSE34" },
    { code: "35", name: "DARKROSE35" },
    { code: "42", name: "FAWN42" },
    { code: "43", name: "FAWN43" },
    { code: "38", name: "FLARERED&BLACK38" },
    { code: "37", name: "FLARERED37" },
    { code: "39", name: "FLARERED39" },
    { code: "72", name: "FLARERED72" },
    { code: "49", name: "GRAYROOF/BRWON49" },
    { code: "46", name: "GREGE46" },
    { code: "32", name: "GARNET32" },
    { code: "13", name: "GRAY13" },
    { code: "10", name: "GREY10" },
    { code: "00", name: "IVORY00" },
    { code: "01", name: "IVORY01" },
    { code: "02", name: "IVORY02" },
    { code: "04", name: "IVORY04" },
    { code: "71", name: "MAUVE71" },
    { code: "73", name: "MAUVE73" },
    { code: "06", name: "MELLOWWHITE06" },
    { code: "07", name: "MELLOWWHITE07" },
    { code: "57", name: "MUSTARD57" },
    { code: "47", name: "NEUTRALBEIGE47" },
    { code: "60", name: "RICHCREAM60" },
    { code: "61", name: "RICHCREAM61" },
    { code: "62", name: "RICHCREAM62" },
    { code: "63", name: "RICHCREAM63" },
    { code: "64", name: "RICHCREAM64" },
    { code: "70", name: "RICHCREAM70" },
    { code: "44", name: "SANDALWOOD44" },
    { code: "50", name: "TOPAZBROWN50" },
    { code: "51", name: "TOPAZBROWN51" },
    { code: "52", name: "TOPAZBROWN52" },
    { code: "53", name: "TOPAZBROWN53" },
    { code: "54", name: "TOPAZBROWN54" },
    { code: "59", name: "TOPAZBROWN59" },
    { code: "09", name: "WATERWHITE09" },
    { code: "08", name: "WHITEOCHER08" }
  ];

  const api = {
    ExteriorColor,
    InteriorColor,
    ExteriorColorDictionary,
    InteriorColorDictionary,
    MasterExcelColors,
    normalizeKey,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.MasterExcel = api;
})(typeof window !== 'undefined' ? window : globalThis);
