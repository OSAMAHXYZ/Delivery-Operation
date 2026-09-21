/**
 * =============================================================================
 * Toyota Delivery Hub — Full Program Documentation (Empty Classes)
 * =============================================================================
 * File: docs/DeliveryHub.empty-classes.js
 *
 * PURPOSE
 * -------
 * Reference skeleton of the whole Delivery Hub so you can edit / re-implement
 * every method. Bodies are empty (or throw). Comments describe real behavior
 * in the live codebase:
 *
 *   server.js
 *   delivery-hub/Delivery_pdf.html        (agent / مذكرة)
 *   delivery-hub/Delivery_coordinator.html (منسق)
 *   delivery-hub/admin-Delivery-pdf.html   (إدارة)
 *   delivery-hub/delivery-hub-live.js      (WebSocket live sync)
 *   index.html                            (hub home)
 *
 * HOW TO USE
 * ----------
 * - Treat each class method as a checklist item for edits.
 * - Field enums and Arabic labels are documented on models.
 * - This file is NOT imported by the running app.
 *
 * ROLES
 * -----
 * Coordinator  — Excel + submit VINs + company/mode (no login)
 * Agent        — ياسين | الفاضل | البراء  password: 1234 (env DELIVERY_AGENT_PASSWORD)
 * Admin        — client password 1234 only; most APIs are open
 * =============================================================================
 */

'use strict';

/* =============================================================================
 * CONSTANTS & ENUMS
 * ============================================================================= */

class DeliveryHubConstants {
  /** @returns {string} Repo root (__dirname of server.js) */
  static ROOT() { throw new Error('not implemented'); }

  /** @returns {string} delivery-inventory-data.json */
  static DATA_FILE() { throw new Error('not implemented'); }

  /** @returns {string} templates/delivery_note_template.docx */
  static TEMPLATE_FILE() { throw new Error('not implemented'); }

  /** @returns {string} delivery_check_note.docx */
  static DELIVERY_CHECK_TEMPLATE_FILE() { throw new Error('not implemented'); }

  /** @returns {string} delivery_check_note.pdf */
  static DELIVERY_CHECK_PDF_FILE() { throw new Error('not implemented'); }

  /** @returns {string} images/delivery-check-note-form.png */
  static DELIVERY_CHECK_PREVIEW_IMAGE() { throw new Error('not implemented'); }

  /** @returns {number} process.env.PORT || 3000 */
  static PORT() { throw new Error('not implemented'); }

  /** @returns {Set<string>} {'ياسين','الفاضل','البراء'} */
  static AGENTS() { throw new Error('not implemented'); }

  /** @returns {string} process.env.DELIVERY_AGENT_PASSWORD || '1234' */
  static AGENT_PASSWORD() { throw new Error('not implemented'); }

  /** @returns {number} 2000 */
  static MAX_DRAFTS() { throw new Error('not implemented'); }

  /** @returns {string} 'مستودع الهاتفية' */
  static WAREHOUSE_SPECIAL_NAME() { throw new Error('not implemented'); }

  /** @returns {string} 'المستودع' */
  static WAREHOUSE_BRANCH() { throw new Error('not implemented'); }

  /** @returns {string} 'تم الاستلام من قبل صاحب المركبة' */
  static WAREHOUSE_ATTACHMENT() { throw new Error('not implemented'); }

  /** @returns {string} 'سيارات عرض الصالة' */
  static SHOWROOM_SPECIAL_NAME() { throw new Error('not implemented'); }

  /** @returns {string} 'ياسين' */
  static SHOWROOM_AGENT() { throw new Error('not implemented'); }

  /** @returns {string} Admin UI client password '1234' */
  static ADMIN_PASSWORD() { throw new Error('not implemented'); }
}

/**
 * Queue / delivery enums (string unions used across server + UI).
 *
 * QueueItem.status:
 *   'available' | 'claimed'
 *
 * QueueItem.agentStatus:
 *   '' | 'in_stock' | 'ready_for_delivery' | 'out_of_delivery' | 'delivered'
 *
 * QueueItem.plannedDeliveryMode (set by coordinator BEFORE note):
 *   'memo' | 'warehouse' | ''
 *   Arabic UI: ترحيل = memo, مستودع = warehouse
 *   normalize aliases: warehouse|مستودع|wh → warehouse
 *                      memo|delivery|ترحيل|transfer → memo
 *
 * QueueItem.deliveryMode (set AFTER note / complete-print):
 *   '' | 'warehouse' | 'showroom'
 *
 * statusLabelFor outputs:
 *   available / waiting claimed → 'Waiting for delivery'
 *                                 or 'Waiting for delivery · مع {agent}'
 *   delivered memo              → 'تم الترحيل'
 *   delivered warehouse         → 'تم التسليم في المستودع'
 *   delivered showroom          → 'عرض الصالة'
 *   out_of_delivery             → 'Out for delivery'
 *   ready_for_delivery          → 'Ready'
 */
class DeliveryEnums {}

/* =============================================================================
 * DATA MODELS
 * ============================================================================= */

/**
 * Vehicle — from Sales Raw Excel / inventory.
 * Source: server rowToVehicle / store.vehicles
 */
class Vehicle {
  constructor() {
    /** @type {string} Normalized uppercase VIN */
    this.vin = '';
    /** @type {string} */
    this.product = '';
    /** @type {string} */
    this.model = '';
    /** @type {string} */
    this.gt = '';
    /** @type {string} */
    this.location = '';
    /** @type {string} Plate; '#' becomes '' */
    this.plate = '';
    /** @type {string} */
    this.customerName = '';
    /** @type {string} */
    this.phone = '';
    /** @type {string} */
    this.imageUrl = '';
    /** @type {string} */
    this.suffix = '';
    /** @type {string} YYYY-MM-DD */
    this.proformaDate = '';
    /** @type {string} YYYY-MM-DD */
    this.invoiceDate = '';
    /** @type {string} YYYY-MM-DD */
    this.deliveryNoteDate = '';
  }
}

/**
 * QueueItem — coordinator list / agent fleet row.
 * Source: store.queue + enrichQueueItem()
 */
class QueueItem {
  constructor() {
    /** @type {string} */
    this.vin = '';
    /** @type {'available'|'claimed'} */
    this.status = 'available';
    /** @type {''|'in_stock'|'ready_for_delivery'|'out_of_delivery'|'delivered'} */
    this.agentStatus = '';
    /** @type {string} Agent username or '' */
    this.assignedTo = '';
    /** @type {string} ISO */
    this.addedAt = '';
    /** @type {string} ISO */
    this.assignedAt = '';
    /**
     * Company chosen by coordinator (or مستودع الهاتفية for warehouse).
     * @type {string}
     */
    this.deliveryCompany = '';
    /** @type {string} Alias of deliveryCompany */
    this.company = '';
    /**
     * Coordinator plan before note.
     * @type {'memo'|'warehouse'|''}
     */
    this.plannedDeliveryMode = '';
    /**
     * After complete-print.
     * @type {''|'warehouse'|'showroom'}
     */
    this.deliveryMode = '';
    /** @type {boolean} */
    this.showroomDisplay = false;
    /** @type {string} */
    this.product = '';
    /** @type {string} */
    this.model = '';
    /** @type {string} */
    this.gt = '';
    /** @type {string} */
    this.location = '';
    /** @type {string} */
    this.plate = '';
    /** @type {string} */
    this.imageUrl = '';
    /** @type {string} */
    this.customerName = '';
    /** @type {string} */
    this.phone = '';
    /** @type {string} Enriched only — statusLabelFor(item) */
    this.statusLabel = '';
  }
}

/**
 * One car row on the memo (up to 10).
 */
class CarSlot {
  constructor() {
    /** @type {string} */
    this.model = '';
    /** @type {string} Chassis / VIN */
    this.chassis = '';
    /** @type {string} */
    this.plate = '';
    /** @type {string} */
    this.remarks = '';
  }
}

/**
 * Warehouse check-note fields inside payload.warehouse
 */
class WarehouseFields {
  constructor() {
    this.branch_name = '';
    this.city_address = '';
    this.statement_no = '';
    this.center_code = '';
    this.owner_name = '';
    this.user_name = '';
    this.user_phone = '';
    this.user_email = '';
    this.user_id = '';
    this.technicians_name = '';
    this.branch_cr = '';
    this.branch_phone = '';
    this.print_date = '';
    this.print_time = '';
  }
}

/**
 * Draft payload — printed / saved delivery note body.
 * Source: collectPayload() on agent form + server complete-print / PATCH
 */
class DraftPayload {
  constructor() {
    /* ---- Memo header ---- */
    this.doc_date = '';
    this.invoice_number = '';
    this.dep_hour = '';
    this.dep_minute = '';
    this.customer_name = '';
    /** Transport company / مندوب الشركة */
    this.company_rep = '';
    this.transfer_date = '';
    this.corresponding_date = '';
    /** Arabic weekday from transfer_date */
    this.day_name = '';
    this.trailer_number = '';
    this.car_count = '';
    /** Destination branch / city */
    this.branch_to = '';
    this.attachments = '';
    this.phone = '';

    /** @type {CarSlot[]} length 10 */
    this.cars = [];
    /** @type {string[]} all VINs on this memo */
    this.vins = [];

    /* ---- Mode flags ---- */
    /**
     * @type {''|'warehouse'|'showroom'}
     */
    this.deliveryMode = '';
    /** @type {boolean} */
    this.warehouse_group = false;
    /** @type {boolean} */
    this.showroom_display = false;
    /** @type {boolean} */
    this.showroom_group = false;
    /** @type {string} usually 'سيارات عرض الصالة' */
    this.showroom_label = '';
    /** Showroom free-text company typed by ياسين */
    this.typed_company = '';

    /** @type {WarehouseFields|undefined} */
    this.warehouse = undefined;
  }
}

/**
 * Saved print draft (PDF/memo record).
 * Source: store.drafts
 */
class Draft {
  constructor() {
    /** @type {string} draft_{timestamp}_{rand} */
    this.id = '';
    /** @type {string} ISO */
    this.printedAt = '';
    /** @type {string|undefined} ISO — after admin edit */
    this.updatedAt = undefined;
    /** @type {string} primary VIN */
    this.vin = '';
    /** @type {string[]} */
    this.vins = [];
    this.product = '';
    this.model = '';
    this.plate = '';
    this.gt = '';
    this.location = '';
    /** Agent who printed / ياسين / admin */
    this.assignedTo = '';
    this.customerName = '';
    /** @type {boolean} */
    this.showroomDisplay = false;
    /** @type {DraftPayload} */
    this.payload = new DraftPayload();
  }
}

/**
 * Persisted JSON store — delivery-inventory-data.json
 */
class DeliveryStore {
  constructor() {
    /**
     * @type {null|{ filename:string, sheetName:string, rowCount:number, sample:any }}
     */
    this.raw = null;
    /** @type {Vehicle[]} */
    this.vehicles = [];
    /** @type {QueueItem[]} */
    this.queue = [];
    /** @type {Draft[]} */
    this.drafts = [];
    /**
     * @type {{ companies:string[], cities:string[] }}
     */
    this.options = { companies: [], cities: [] };
    /**
     * @type {{
     *   filename:string,
     *   sheetName:string,
     *   uploadedAt:string|null,
     *   datesMergedFrom?:string,
     *   datesMergedAt?:string
     * }}
     */
    this.meta = { filename: '', sheetName: '', uploadedAt: null };
  }
}

/**
 * Queue stats from computeStats()
 */
class QueueStats {
  constructor() {
    this.total = 0;
    this.available = 0;
    this.in_stock = 0;
    this.ready_for_delivery = 0;
    this.out_of_delivery = 0;
    this.delivered = 0;
    this.drafts = 0;
  }
}

/* =============================================================================
 * SERVER — Persistence & helpers (server.js)
 * ============================================================================= */

class StoreService {
  /** Load JSON from DATA_FILE into memory store. */
  loadStore() { throw new Error('not implemented'); }

  /** Atomic write store → DATA_FILE. */
  saveStore() { throw new Error('not implemented'); }

  /** Ensure options.companies / options.cities are non-empty (defaults). */
  ensureOptions() { throw new Error('not implemented'); }

  /** @returns {DeliveryStore} */
  emptyStore() { throw new Error('not implemented'); }

  /** saveStore + WebSocket broadcast { type:'delivery_hub_updated', at } */
  persistAndBroadcast() { throw new Error('not implemented'); }

  broadcastHubUpdate() { throw new Error('not implemented'); }
}

class VinHelpers {
  /**
   * Trim, uppercase, strip spaces.
   * @param {string} v
   * @returns {string}
   */
  normVin(v) { throw new Error('not implemented'); }

  /**
   * @returns {Map<string, Vehicle>}
   */
  vehicleIndex() { throw new Error('not implemented'); }

  /**
   * @param {string} vin
   * @returns {QueueItem|null}
   */
  findQueueItem(vin) { throw new Error('not implemented'); }

  /**
   * Keep one queue row per VIN (prefer higher priority status).
   * @param {QueueItem[]} queue
   * @returns {QueueItem[]}
   */
  dedupeQueue(queue) { throw new Error('not implemented'); }

  /**
   * Priority: delivered=5 … available=0
   * @param {QueueItem} item
   * @returns {number}
   */
  queuePriority(item) { throw new Error('not implemented'); }
}

class StatusService {
  /**
   * Human label for admin / queue UI.
   * @param {QueueItem} item
   * @returns {string}
   */
  statusLabelFor(item) { throw new Error('not implemented'); }

  /**
   * Merge vehicle fields + statusLabel + plannedDeliveryMode.
   * @param {QueueItem} item
   * @returns {QueueItem}
   */
  enrichQueueItem(item) { throw new Error('not implemented'); }

  /**
   * Copy product/model/gt/location/plate/phone/customerName/imageUrl from vehicle.
   * @param {object} item
   * @param {Vehicle} veh
   * @returns {object}
   */
  enrichFromVehicle(item, veh) { throw new Error('not implemented'); }

  /** @returns {QueueStats} */
  computeStats() { throw new Error('not implemented'); }

  /** Inventory dashboard: totals + topProducts. */
  buildDashboard() { throw new Error('not implemented'); }
}

class ModeDetection {
  /**
   * @param {string} raw
   * @returns {'warehouse'|'memo'|''}
   */
  normalizePlannedDeliveryMode(raw) { throw new Error('not implemented'); }

  /**
   * True if payload is ياسين showroom note.
   * Checks: showroom_display, showroom_group, deliveryMode==='showroom'
   * @param {DraftPayload} payload
   * @returns {boolean}
   */
  isShowroomDraftPayload(payload) { throw new Error('not implemented'); }

  /**
   * True if warehouse delivery note.
   * Checks: deliveryMode warehouse, warehouse_group,
   * branch_to in {المستودع, في المستودع},
   * company_rep includes مستودع (not showroom label).
   * @param {DraftPayload} payload
   * @returns {boolean}
   */
  isWarehouseDraftPayload(payload) { throw new Error('not implemented'); }

  /** Excel export row → warehouse */
  isWarehouseExportRow(row) { throw new Error('not implemented'); }

  /** Excel export row → showroom (سيارات عرض الصالة / type showroom) */
  isShowroomExportRow(row) { throw new Error('not implemented'); }
}

class DeliveryLifecycle {
  /**
   * Collect unique VINs from draft.cars / draft.vins / extras.
   * @param {DraftPayload} draftPayload
   * @param {string[]|string} extra
   * @returns {string[]}
   */
  collectDraftVins(draftPayload, extra) { throw new Error('not implemented'); }

  /**
   * Mark VINs delivered on queue (create rows if missing).
   * @param {string[]} vins
   * @param {{
   *   assignedTo?: string,
   *   warehouseDelivery?: boolean,
   *   showroomDisplay?: boolean,
   *   forceAssign?: boolean,
   *   carMetaByVin?: Map<string,{product?:string,model?:string,plate?:string}>
   * }} opts
   * @returns {{ deliveredItems: QueueItem[], blocked: {vin:string,assignedTo:string}[] }}
   */
  markVinsDelivered(vins, opts) { throw new Error('not implemented'); }

  /**
   * Agent auth: must be in AGENTS and password match.
   * @param {string} username
   * @param {string} password
   * @returns {{ ok:true, username:string }|{ ok:false, error:string }}
   */
  authenticateAgent(username, password) { throw new Error('not implemented'); }

  /** Re-enrich queue products from latest vehicles. */
  refreshQueueFromVehicles() { throw new Error('not implemented'); }
}

class ExcelImportExport {
  parseDataUrl(fileData) { throw new Error('not implemented'); }
  normalizeHeader(h) { throw new Error('not implemented'); }
  pickCol(row, aliases) { throw new Error('not implemented'); }
  normalizeExcelDate(value) { throw new Error('not implemented'); }
  /** @returns {Vehicle|null} */
  rowToVehicle(row) { throw new Error('not implemented'); }
  isDeliveryExportWorkbook(wb, filename) { throw new Error('not implemented'); }
  parseVehiclesFromRows(rows) { throw new Error('not implemented'); }
  buildDraftPayloadFromExportRow(row, veh) { throw new Error('not implemented'); }
  parsePrintDraftsFromRows(rows) { throw new Error('not implemented'); }
  parseQueueFromRows(rows) { throw new Error('not implemented'); }
  parseSalesFromWorkbook(wb, filename) { throw new Error('not implemented'); }
  parseSalesWorkbook(buffer, filename) { throw new Error('not implemented'); }
  parseSalesText(text, filename) { throw new Error('not implemented'); }
  /**
   * Replace vehicles; optionally replace drafts/queue.
   * @param {object} parsed
   * @param {{ replaceDrafts?: boolean, replaceQueue?: boolean }} opts
   */
  applyParsedInventory(parsed, opts) { throw new Error('not implemented'); }
  createPdfDraftsFromVehicles(vehicles, opts) { throw new Error('not implemented'); }
}

class DocxService {
  arabicWeekdayName(isoDate) { throw new Error('not implemented'); }
  emptyCarSlot() { throw new Error('not implemented'); }
  splitIsoDate(iso) { throw new Error('not implemented'); }
  toHijriParts(iso) { throw new Error('not implemented'); }
  /** Flatten payload → template tags car1_model, date_d, … */
  flattenDeliveryNote(payload) { throw new Error('not implemented'); }
  generateDocxWithTemplate(payload) { throw new Error('not implemented'); }
  generateDocx(payload) { throw new Error('not implemented'); }
  generateDeliveryCheckDocx(payload) { throw new Error('not implemented'); }
  getDeliveryCheckPdfBuffer() { throw new Error('not implemented'); }
}

/* =============================================================================
 * SERVER — HTTP API (every route = one method)
 * ============================================================================= */

class DeliveryHubApi {
  /* ---------- Auth & options ---------- */

  /**
   * POST /api/delivery-coordinator/auth
   * Body: { username, password }
   * → 200 { ok, username } | 401 { error }
   */
  authAgent(req, res) { throw new Error('not implemented'); }

  /**
   * GET /api/delivery-options
   * → { companies:string[], cities:string[] }
   */
  getDeliveryOptions(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-options/:kind  kind=companies|cities
   * Body: { name }
   * → 200 { ok, name, list } | 409 exists
   */
  addDeliveryOption(req, res) { throw new Error('not implemented'); }

  /**
   * DELETE /api/delivery-options/:kind
   * Body: { name }
   */
  deleteDeliveryOption(req, res) { throw new Error('not implemented'); }

  /* ---------- Inventory ---------- */

  /** GET /api/delivery-inventory → { vehicles, dashboard } */
  getInventory(req, res) { throw new Error('not implemented'); }

  /** DELETE /api/delivery-inventory — wipe vehicles/queue/drafts; keep options */
  clearInventory(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-inventory/upload
   * Body: { fileData (base64/data-URL), filename }
   * Sales Raw OR admin export auto-detect.
   */
  uploadInventory(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-inventory/restore-export
   * Full archive restore (Vehicle Inventory + Print Drafts + Coordinator Queue).
   */
  restoreExport(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-inventory/merge-dates
   * Update Proforma/Invoice/phone from Sales Raw; keep drafts/queue.
   * Rejects delivery_export workbooks.
   */
  mergeDates(req, res) { throw new Error('not implemented'); }

  /** POST /api/delivery-inventory/paste  Body: { text, filename? } */
  pasteInventory(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-inventory/create-pdf-drafts
   * Body: { vins?: string[] } — group by customer, max 10 cars/draft
   */
  createPdfDrafts(req, res) { throw new Error('not implemented'); }

  /**
   * GET /api/delivery-inventory/vehicles?search&limit&exclude
   */
  searchVehicles(req, res) { throw new Error('not implemented'); }

  /* ---------- Queue lifecycle ---------- */

  /**
   * GET /api/delivery-coordinator/queue
   * ?admin=1 → { queue, stats, drafts, rawUploaded }
   * ?username=X → available + assigned to X
   */
  getQueue(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-coordinator/submit-vins
   * Body: {
   *   vins: string[],
   *   company?: string,              // aliases: deliveryCompany, company_rep
   *   plannedDeliveryMode: string    // aliases: deliveryMode, deliveryType
   *                                  // required: 'memo'|'warehouse' (+aliases)
   * }
   * Rules:
   *   - Vehicles must already exist in store.vehicles
   *   - memo → company required
   *   - warehouse → company defaults to مستودع الهاتفية
   * Creates QueueItem status=available, Waiting for delivery
   * → { added, skipped, missingVins, deliveryCompany, plannedDeliveryMode }
   */
  submitVins(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-coordinator/assign-meta
   * Assign company+mode to EXISTING queue VINs (unassigned / edit).
   * Body: { vins: string[]|vin, company, plannedDeliveryMode }
   * Same validation as submit-vins.
   * → { ok, updated[], missing, deliveryCompany, plannedDeliveryMode }
   */
  assignMeta(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-coordinator/claim  (Agent auth)
   * Body: { username, password, vin, agentStatus? } default agentStatus=in_stock
   * → { item } | 409 if owned by another agent
   */
  claimVin(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-coordinator/set-status  (Agent auth)
   * Body: { username, password, vin, agentStatus }
   */
  setStatus(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-coordinator/release
   * Body: { vin }
   * Resets status=available, clears agentStatus/assignedTo
   * (keeps deliveryCompany + plannedDeliveryMode)
   */
  releaseVin(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-coordinator/complete-print  (Agent auth)
   * Body: {
   *   username, password,
   *   vin?, vins?,
   *   draft: DraftPayload,
   *   showroomDisplay?: boolean
   * }
   * - Collects all VINs from draft
   * - Showroom if flag / payload / agent===ياسين
   * - Warehouse if isWarehouseDraftPayload
   * - markVinsDelivered (forceAssign for showroom)
   * - Creates Draft; trims MAX_DRAFTS
   * → { ok, draftId, vins, deliveredCount, showroomDisplay, statusLabel, item, items }
   */
  completePrint(req, res) { throw new Error('not implemented'); }

  /** GET /api/delivery-coordinator/drafts/:draftId → { draft } */
  getDraft(req, res) { throw new Error('not implemented'); }

  /**
   * PATCH /api/delivery-coordinator/drafts/:draftId
   * Body: {
   *   payload?, markDelivered?=true, assignedTo?, customerName?, product?,
   *   deliveryMode?: 'warehouse'|'memo'|'',
   *   warehouseDelivery?: boolean
   * }
   * Syncs all cars as delivered when markDelivered.
   */
  patchDraft(req, res) { throw new Error('not implemented'); }

  /** DELETE /api/delivery-coordinator/drafts/:draftId */
  deleteDraft(req, res) { throw new Error('not implemented'); }

  /* ---------- Document generation ---------- */

  /**
   * POST /api/delivery-note/generate
   * Body: DraftPayload → DOCX muthakara_tarhil_*.docx
   */
  generateMemoDocx(req, res) { throw new Error('not implemented'); }

  /**
   * POST /api/delivery-note/generate-check-note
   * Body: DraftPayload → PDF if available else DOCX check-note
   */
  generateCheckNote(req, res) { throw new Error('not implemented'); }

  /** GET /api/delivery-note/check-note-preview → PNG */
  checkNotePreview(req, res) { throw new Error('not implemented'); }
}

/* =============================================================================
 * AGENT UI — Delivery_pdf.html
 * ============================================================================= */

class AgentSession {
  /** @returns {{ username:string, password:string }} */
  getAgent() { throw new Error('not implemented'); }
  setAgent(username, password) { throw new Error('not implemented'); }
  clearAgent() { throw new Error('not implemented'); }
  /** username === 'ياسين' */
  isShowroomAgent(agent) { throw new Error('not implemented'); }
}

class AgentGate {
  /**
   * Clear session; if ?adminExport=1&draft= or ?adminEdit=1&draft= open admin modes;
   * else show login.
   */
  initGate() { throw new Error('not implemented'); }

  /**
   * POST auth (or offline password fallback 1234).
   * ياسين → openShowroomForm(); else openWorkspace(); optional ?vin=
   */
  onLoginClick() { throw new Error('not implemented'); }

  onLogoutClick() { throw new Error('not implemented'); }
}

class AgentWorkspace {
  /** GET /api/delivery-coordinator/queue?username= */
  loadWorkspace() { throw new Error('not implemented'); }

  /**
   * Render stats + available fleet grouped by company + stock dock.
   * Warehouse planned → group title «المستودع»
   * Memo planned → group by deliveryCompany
   * Missing company → «بدون شركة»
   */
  renderWorkspace(queue) { throw new Error('not implemented'); }

  /**
   * @param {QueueItem[]} available
   * @returns {{ company:string, isWh:boolean, items:QueueItem[] }[]}
   */
  groupAvailableByCompany(available) { throw new Error('not implemented'); }

  fleetCardHtml(item, kind) { throw new Error('not implemented'); }
  filterAvailableFleetByVin() { throw new Error('not implemented'); }

  /**
   * POST claim { vin, agentStatus }
   * @param {string} vin
   * @param {string} agentStatus default in_stock
   * @param {{ quiet?: boolean }} opts
   */
  claimWithStatus(vin, agentStatus, opts) { throw new Error('not implemented'); }

  /** POST release */
  returnToQueue(vin, opts) { throw new Error('not implemented'); }

  /**
   * Open stock-action modal.
   * If plannedDeliveryMode set → hide irrelevant button; label primary action.
   * @param {string} vin
   * @param {'available'|'stock'} mode
   */
  openCarAction(vin, mode) { throw new Error('not implemented'); }

  closeStockAction() { throw new Error('not implemented'); }

  /** متاحة لدي → claim in_stock, stay on workspace */
  onStockKeepClick() { throw new Error('not implemented'); }

  /** Warehouse button → claim + startDeliveryNote({ forceMode:'warehouse' }) */
  onStockWarehouseClick() { throw new Error('not implemented'); }

  /** Transfer button → claim + startDeliveryNote({ forceMode:'memo' }) */
  onStockTransferClick() { throw new Error('not implemented'); }
}

class AgentDeliveryForm {
  /**
   * Open memo form for VIN; apply coordinator plan:
   *   warehouse → applyWarehouseDelivery()
   *   memo → setWarehousePrintMode(false) + prefill company_rep
   * @param {string} vin
   * @param {{ forceMode?: 'warehouse'|'memo'|'' }} opts
   */
  startDeliveryNote(vin, opts) { throw new Error('not implemented'); }

  openMainWithVin(item) { throw new Error('not implemented'); }
  prefillClaimedVin(item) { throw new Error('not implemented'); }
  clearDeliveryForm() { throw new Error('not implemented'); }
  clearClaimedVin() { throw new Error('not implemented'); }
  setClaimedVin(vin) { throw new Error('not implemented'); }
  getClaimedVin() { throw new Error('not implemented'); }
  getFormChassisList() { throw new Error('not implemented'); }

  /** Build DraftPayload from #deliveryForm (memo + warehouse + cars[10]) */
  collectPayload() { throw new Error('not implemented'); }

  buildCarRows() { throw new Error('not implemented'); }
  syncCarCount() { throw new Error('not implemented'); }
  openVinPicker(rowIndex) { throw new Error('not implemented'); }
  closeVinPicker() { throw new Error('not implemented'); }
  selectVinVehicle(btn) { throw new Error('not implemented'); }
  loadVinOptions(search) { throw new Error('not implemented'); }

  buildOverlay() { throw new Error('not implemented'); }
  updatePreview() { throw new Error('not implemented'); }
  buildFlatData() { throw new Error('not implemented'); }
  buildCheckNoteOverlayData() { throw new Error('not implemented'); }

  /**
   * Print flow:
   *   showroom → doShowroomSave()
   *   else validate company/branch list (memo), clone print sheets (3 memo / 1 WH),
   *   window.print → afterprint → complete-print + clear + openWorkspace
   */
  doPrintA4() { throw new Error('not implemented'); }

  /** Word download POST /api/delivery-note/generate (or check-note in WH mode) */
  onFormSubmitDownload() { throw new Error('not implemented'); }
}

class AgentWarehouseMode {
  /**
   * Toggle warehouse-form-mode body class, preview image, top fields, button labels.
   * @param {boolean} enabled
   */
  setWarehousePrintMode(enabled) { throw new Error('not implemented'); }

  /**
   * Force company=مستودع الهاتفية, branch=المستودع, attachments default,
   * fill warehouse top fields, setWarehousePrintMode(true)
   */
  applyWarehouseDelivery() { throw new Error('not implemented'); }

  ensureWarehouseCompanyOption() { throw new Error('not implemented'); }
  downloadWarehouseCheckNoteFile() { throw new Error('not implemented'); }
  generateWarehouseCheckNoteAndComplete() { throw new Error('not implemented'); }
  setWarehousePhoneFromRaw(phone) { throw new Error('not implemented'); }
  lookupVehiclePhone(vin) { throw new Error('not implemented'); }
}

class AgentShowroomMode {
  /**
   * ياسين-only UI: free company/branch typing, manual VIN/model,
   * buttons = حفظ, skip fleet workspace.
   * @param {boolean} enabled
   */
  applyShowroomUi(enabled) { throw new Error('not implemented'); }

  openShowroomForm() { throw new Error('not implemented'); }

  /**
   * Validate company+branch+≥1 VIN → complete-print with
   * showroom_display, showroom_group, deliveryMode:'showroom', showroomDisplay:true
   * Admin groups under سيارات عرض الصالة
   */
  doShowroomSave() { throw new Error('not implemented'); }
}

class AgentSearchableSelects {
  /** GET /api/delivery-options → fill company_rep + branch_to lists */
  loadDeliveryOptions() { throw new Error('not implemented'); }

  initSearchableSelect(fieldId) { throw new Error('not implemented'); }
  isExactSearchableOption(fieldId, value) { throw new Error('not implemented'); }
  ensureSearchableOption(fieldId, value) { throw new Error('not implemented'); }
  /** Add coordinator company even if not in options yet */
  ensureSearchableOptionAllow(company) { throw new Error('not implemented'); }
  enforceListOnlyValue(fieldId, opts) { throw new Error('not implemented'); }
  /**
   * Memo only: company_rep + branch_to must be exact list values.
   * Skipped for warehousePrintMode / showroomMode.
   */
  validateListOnlyFields() { throw new Error('not implemented'); }
}

class AgentAdminModes {
  isAdminExportMode() { throw new Error('not implemented'); }
  isAdminEditMode() { throw new Error('not implemented'); }
  openAdminDraftExport() { throw new Error('not implemented'); }
  openAdminDraftEdit() { throw new Error('not implemented'); }
  /**
   * PATCH draft with payload + deliveryMode memo|warehouse + markDelivered
   */
  saveAdminDraftEdit() { throw new Error('not implemented'); }
  applyDraftPayload(payload) { throw new Error('not implemented'); }
  isWarehouseDraftPayload(payload) { throw new Error('not implemented'); }
}

/* =============================================================================
 * COORDINATOR UI — Delivery_coordinator.html
 * ============================================================================= */

class CoordinatorPage {
  setStatus(elId, msg, type) { throw new Error('not implemented'); }
  renderStats(stats, hasRaw) { throw new Error('not implemented'); }

  /**
   * Enable/disable paste + company + mode radios based on rawUploaded.
   * @param {boolean} enabled
   */
  setVinSectionEnabled(enabled) { throw new Error('not implemented'); }

  /** @returns {'memo'|'warehouse'} from radio coordDeliveryMode */
  getSelectedDeliveryMode() { throw new Error('not implemented'); }

  /**
   * warehouse → disable company select, force مستودع الهاتفية
   * memo → enable company select
   */
  syncCompanySelectForMode() { throw new Error('not implemented'); }

  /** GET /api/delivery-options → fill #coordCompany */
  loadCompanyOptions() { throw new Error('not implemented'); }

  parseVinList(input) { throw new Error('not implemented'); }

  /**
   * POST submit-vins { vins, company, plannedDeliveryMode }
   * Requires company for memo; warehouse auto company.
   * Shows missing VINs (not in Excel).
   */
  onSubmitVinsClick() { throw new Error('not implemented'); }

  /**
   * True if not delivered AND (no company OR no plannedDeliveryMode),
   * except warehouse mode already planned.
   * @param {QueueItem} item
   */
  needsCompanyAssignment(item) { throw new Error('not implemented'); }

  /** Section «شاسيه بدون شركة» checkbox list */
  renderUnassigned(queue) { throw new Error('not implemented'); }

  /**
   * Queue table columns: checkbox | VIN | Product | Company | Type | Agent | Badge | Status
   * Highlights row-need-company; badges مستودع / ترحيل / بدون شركة
   */
  renderQueue(queue) { throw new Error('not implemented'); }

  getSelectedUnassignedVins() { throw new Error('not implemented'); }
  syncAssignButton() { throw new Error('not implemented'); }

  /**
   * POST assign-meta for selected unassigned VINs using current company+mode.
   */
  assignCompanyToSelected() { throw new Error('not implemented'); }

  /** GET queue?admin=1 */
  loadQueue() { throw new Error('not implemented'); }

  /** POST /api/delivery-inventory/upload then promptAddNewVins */
  onExcelUpload(file) { throw new Error('not implemented'); }

  /** POST /api/delivery-inventory/merge-dates */
  mergeDatesFromSalesRaw(file) { throw new Error('not implemented'); }

  promptAddNewVins(info) { throw new Error('not implemented'); }
  hideVinPrompt() { throw new Error('not implemented'); }
  queueBadgeClass(item) { throw new Error('not implemented'); }
}

/* =============================================================================
 * ADMIN UI — admin-Delivery-pdf.html
 * ============================================================================= */

class AdminAuth {
  /** Client-only gate ADMIN_PASSWORD === '1234' */
  tryAdminLogin() { throw new Error('not implemented'); }
  unlockAdmin() { throw new Error('not implemented'); }
}

class AdminDataLoad {
  /**
   * Load inventory + queue?admin=1 + drafts; set allVehicles, allQueue, allDrafts
   */
  loadDashboard() { throw new Error('not implemented'); }

  /** Live: DeliveryHubLive.start(() => loadDashboard) */
  startLiveSync() { throw new Error('not implemented'); }
}

class AdminFilters {
  /**
   * Track filter: date from/to + type delivery_note|invoice|proforma
   */
  getTrackFilter() { throw new Error('not implemented'); }
  hasActiveTrackFilter() { throw new Error('not implemented'); }
  applyTrackFilter() { throw new Error('not implemented'); }

  /**
   * uiFilters: { search, branch, status, coordinator }
   * selectedCompany scopes all views
   */
  collectSelectOptions() { throw new Error('not implemented'); }
  pruneStaleUiFilters() { throw new Error('not implemented'); }
  updateCompanyFilterChip() { throw new Error('not implemented'); }
  clearCompanyScope() { throw new Error('not implemented'); }
  showCompanyRecords(company) { throw new Error('not implemented'); }

  dateScopedDrafts() { throw new Error('not implemented'); }
  scopedVinSet() { throw new Error('not implemented'); }
  companyVinSet() { throw new Error('not implemented'); }
  filteredDrafts() { throw new Error('not implemented'); }
  filteredQueue() { throw new Error('not implemented'); }
  filteredVehicleList() { throw new Error('not implemented'); }
}

class AdminCompanyCity {
  draftCompanyName(d) { throw new Error('not implemented'); }
  draftCarWeight(d) { throw new Error('not implemented'); }

  /** draft.showroomDisplay / payload.showroom_* / deliveryMode showroom */
  isShowroomAdminDraft(d) { throw new Error('not implemented'); }

  /**
   * Warehouse draft (excludes showroom).
   * deliveryMode warehouse, warehouse_group, branch المستودع/في المستودع, company مستودع
   */
  isWarehouseAdminDraft(d) { throw new Error('not implemented'); }

  isWarehouseAccountKey(key) { throw new Error('not implemented'); }
  isShowroomAccountKey(key) { throw new Error('not implemented'); }

  /**
   * Filter match: مستودع الهاتفية → warehouse drafts;
   * سيارات عرض الصالة → showroom drafts;
   * else exact company_rep and not special modes
   */
  draftMatchesCompanyKey(d, key) { throw new Error('not implemented'); }

  /**
   * Aggregate:
   *  - showroom cars → special bucket سيارات عرض الصالة
   *  - warehouse cars → special bucket مستودع الهاتفية
   *  - else company × branch_to (VIN-weighted)
   * @returns {{ rows, warehouse, showroom }}
   */
  aggregateCompanyCities(drafts) { throw new Error('not implemented'); }

  /**
   * Render sections: سيارات عرض الصالة | في المستودع | شركات النقل
   */
  renderCompanyCityBreakdown(drafts, emptyText) { throw new Error('not implemented'); }

  tallyField(drafts, getter, opts) { throw new Error('not implemented'); }
  renderTransferDashboard(drafts) { throw new Error('not implemented'); }
  renderPremiumKpis() { throw new Error('not implemented'); }
  deliveredOfTotalStats() { throw new Error('not implemented'); }
  warehouseDeliveredStats() { throw new Error('not implemented'); }
  deliveryStatusRows() { throw new Error('not implemented'); }
}

class AdminQueueTable {
  /**
   * Labels use statusLabel from API:
   * Waiting for delivery / Waiting for delivery · مع X / تم الترحيل / …
   */
  renderQueueTable(queue) { throw new Error('not implemented'); }
  renderQueueStats(stats) { throw new Error('not implemented'); }
  queueBadgeClass(item) { throw new Error('not implemented'); }
  /** Release button → POST release */
  onReleaseClick(vin) { throw new Error('not implemented'); }
}

class AdminPdfBrowser {
  /**
   * pdfBrowserState: { page, pageSize, sort, type, q, source }
   * type filter: all | memo | warehouse | showroom
   */
  filterSortPdfs(list) { throw new Error('not implemented'); }
  renderAllPdfsBrowser(drafts) { throw new Error('not implemented'); }
  draftVinList(d) { throw new Error('not implemented'); }
  draftCompanyLabel(d) { throw new Error('not implemented'); }
  draftBranchLabel(d) { throw new Error('not implemented'); }
  /** Edit → Delivery_pdf.html?adminEdit=1&draft= */
  /** PDF  → Delivery_pdf.html?adminExport=1&draft= */
  bindDraftActionButtons(tbody) { throw new Error('not implemented'); }
}

class AdminExcelExport {
  /**
   * Sheets:
   *  Vehicle Inventory
   *  Coordinator Queue  (Classification uses Waiting for delivery / delivered labels)
   *  Print Drafts       (Section/Company for warehouse+showroom specials)
   *  Company by City
   *  Products
   *  Summary
   */
  exportAllToExcel() { throw new Error('not implemented'); }
  excelStamp() { throw new Error('not implemented'); }
}

class AdminOptionsCrud {
  /** Manage companies/cities via /api/delivery-options */
  renderManagedCompanies() { throw new Error('not implemented'); }
  renderManagedCities() { throw new Error('not implemented'); }
  addCompany(name) { throw new Error('not implemented'); }
  deleteCompany(name) { throw new Error('not implemented'); }
  addCity(name) { throw new Error('not implemented'); }
  deleteCity(name) { throw new Error('not implemented'); }
}

class AdminLeadTime {
  populateLeadTimeCompanySelect() { throw new Error('not implemented'); }
  companyLeadTimeRows(company) { throw new Error('not implemented'); }
  leadTimeStats(rows) { throw new Error('not implemented'); }
  renderInvoiceDeliveryChart() { throw new Error('not implemented'); }
}

/* =============================================================================
 * LIVE SYNC — delivery-hub-live.js
 * ============================================================================= */

class DeliveryHubLive {
  /**
   * Connect WebSocket; on delivery_hub_updated call callback (debounce).
   * @param {Function} onUpdate
   */
  static start(onUpdate) { throw new Error('not implemented'); }
}

/* =============================================================================
 * END-TO-END FLOWS (documentation only)
 * ============================================================================= */

/**
 * Flow A — Coordinator memo assignment
 * 1. Upload Sales Raw Excel
 * 2. Paste VINs + select company + ترحيل
 * 3. submit-vins → queue available, plannedDeliveryMode=memo, Waiting for delivery
 * 4. Agent sees VIN under company group → claim → memo form company prefilled → print
 * 5. complete-print → delivered, status تم الترحيل, draft saved
 *
 * Flow B — Coordinator warehouse
 * 1. Paste VINs + مستودع
 * 2. company = مستودع الهاتفية, plannedDeliveryMode=warehouse
 * 3. Agent sees under «المستودع» → opens warehouse check-note form
 * 4. complete-print → تم التسليم في المستودع; admin tallies under في المستودع
 *
 * Flow C — Unassigned VINs
 * 1. Old queue rows without company show in «شاسيه بدون شركة»
 * 2. Select + assign-meta with company/mode
 *
 * Flow D — ياسين showroom
 * 1. Login ياسين → empty manual form (no fleet)
 * 2. Save → showroom draft; admin flag عرض الصالة / سيارات عرض الصالة
 *
 * Flow E — Admin
 * 1. Filter by dates / company / showroom|warehouse|memo
 * 2. Edit draft / export PDF / Excel archive / restore archive
 */
class DeliveryHubFlows {
  flowCoordinatorMemo() { throw new Error('documentation only'); }
  flowCoordinatorWarehouse() { throw new Error('documentation only'); }
  flowAssignUnassigned() { throw new Error('documentation only'); }
  flowShowroomYassin() { throw new Error('documentation only'); }
  flowAdminManage() { throw new Error('documentation only'); }
}

/* =============================================================================
 * EXPORT MAP (for editors / IDEs)
 * ============================================================================= */

module.exports = {
  DeliveryHubConstants,
  DeliveryEnums,
  Vehicle,
  QueueItem,
  CarSlot,
  WarehouseFields,
  DraftPayload,
  Draft,
  DeliveryStore,
  QueueStats,
  StoreService,
  VinHelpers,
  StatusService,
  ModeDetection,
  DeliveryLifecycle,
  ExcelImportExport,
  DocxService,
  DeliveryHubApi,
  AgentSession,
  AgentGate,
  AgentWorkspace,
  AgentDeliveryForm,
  AgentWarehouseMode,
  AgentShowroomMode,
  AgentSearchableSelects,
  AgentAdminModes,
  CoordinatorPage,
  AdminAuth,
  AdminDataLoad,
  AdminFilters,
  AdminCompanyCity,
  AdminQueueTable,
  AdminPdfBrowser,
  AdminExcelExport,
  AdminOptionsCrud,
  AdminLeadTime,
  DeliveryHubLive,
  DeliveryHubFlows
};
