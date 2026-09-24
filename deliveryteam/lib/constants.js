'use strict';

/** Delivery Team — shared constants (statuses, cities, carriers, users). */

const STATUSES = Object.freeze([
  'Claimed',
  'PSFU',
  'تم التسليم',
  'جاهز للتسليم',
  'تسليم متقدم',
  'صادرة',
  'مرور',
  'رجوع مرور',
  'بطاقة',
  'فسح',
  'معلقة',
  'الغاء',
]);

/** Live Sheet / My VINs display order (top → bottom). Blank statuses go last. */
const STATUS_SORT_ORDER = Object.freeze([
  'Claimed',
  'PSFU',
  'تم التسليم',
  'جاهز للتسليم',
  'تسليم متقدم',
  'صادرة',
  'مرور',
  'رجوع مرور',
  'بطاقة',
  'فسح',
  'معلقة',
  'الغاء',
]);

const COMPLETED_STATUS = 'Claimed';

const YES_NO = Object.freeze(['Yes', 'No']);

const CARRIERS = Object.freeze([
  'طريق الراسي',
  'درب الرياض',
  'ذكاء جميل',
  'الحسناء',
  'البستان الجميل',
  'سعيد البسامي',
  'اريكو',
  'وسم الثريا',
  'احد الفرسان',
]);

/**
 * Map Delivery Team الناقل → Delivery Coordinator company board name
 * (مذكرة ترحيل / لوحات الشركات).
 */
const CARRIER_TO_COORDINATOR_COMPANY = Object.freeze({
  'طريق الراسي': 'الطريق الراسي',
  'درب الرياض': 'شركه درب الرياض',
  'ذكاء جميل': 'ذكاء جميل',
  'الحسناء': 'شركه الحسناء',
  'البستان الجميل': 'البستان الجميل',
  'سعيد البسامي': 'شركه سعيد محي البسامي',
  'اريكو': 'شركه اريكو ( شركه طارق محمد العريفي )',
  'وسم الثريا': 'وسم الثريا',
  'احد الفرسان': 'احد الفرسان',
});

function mapCarrierToCoordinatorCompany(carrier) {
  const key = String(carrier || '').trim();
  if (!key) return '';
  if (CARRIER_TO_COORDINATOR_COMPANY[key]) return CARRIER_TO_COORDINATOR_COMPANY[key];
  // Already a full company name
  return key;
}

function carrierCompanyKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Reverse of mapCarrierToCoordinatorCompany — Print Drafts / board name → Live Sheet الناقل.
 * Unassigned / warehouse / showroom → empty (leave الناقل blank).
 */
function mapCoordinatorCompanyToCarrier(company) {
  const key = String(company || '').trim();
  if (!key) return '';
  const kk = carrierCompanyKey(key);
  if (
    kk === 'بدون شركة'
    || kk === 'بدون الشركه'
    || kk === 'unassigned'
    || kk === 'no company'
    || kk === 'none'
    || kk === '-'
  ) {
    return '';
  }
  if (kk.includes('مستودع') || kk.includes('عرض الصالة') || kk.includes('showroom')) {
    return '';
  }

  for (const [carrier, full] of Object.entries(CARRIER_TO_COORDINATOR_COMPANY)) {
    if (carrierCompanyKey(full) === kk || carrierCompanyKey(carrier) === kk) return carrier;
  }

  const stripped = kk.replace(/^شركة\s+|^شركه\s+/, '');
  for (const carrier of CARRIERS) {
    const ck = carrierCompanyKey(carrier);
    if (kk === ck || stripped === ck) return carrier;
    if (kk.includes(ck) || stripped.includes(ck) || ck.includes(stripped)) return carrier;
  }

  // Keep full company text so Live Sheet can still show / filter it
  return key;
}

const TRANSFER_CITIES = Object.freeze([
  'بقيق', 'الدمام', 'الظهران', 'راس تنورة', 'الهفوف', 'الخبر', 'القطيف', 'الجبيل', 'الاحساء',
  'الباحة', 'المخواة', 'بلجرشي', 'المندق', 'الجوف', 'سكاكا', 'القريات', 'عرعر', 'رفحاء', 'طريف',
  'العويقلية', 'الخرج', 'الرياض', 'حفر الباطن', 'المزاحمية', 'المجمعة', 'بريدة', 'عنيزة', 'دخنه',
  'الرس', 'المدينه المنوره', 'ينبع الصناعية', 'ينبع البحر', 'بدر', 'تبوك', 'املج', 'الوجه',
  'جيزان', 'ابو عريش', 'احد المسارحة', 'يشيد', 'حائل', 'ابها', 'خميس مشيط', 'بيشة', 'محايل عسير',
  'مكه المكرمه', 'الطائف', 'جده', 'المستودع', 'رابغ', 'مستورة', 'ثول', 'الليث', 'نجران', 'شرورة',
  'اوتومول', 'الدرب', 'شقراء', 'الجموم', 'القصيم', 'العلا', 'العرضيات', 'عفيف', 'صامطه',
  'حوطة سدير', 'احد رفيده', 'ضباء', 'رجال ألمع', 'الدوادمي', 'وادي الدواسر', 'الزلفي', 'بيش',
  'القنفذه', 'بحره', 'صبيا', 'الغاط', 'مهد الذهب', 'طبرجل', 'الخرمه', 'القويعيه', 'حريملاء',
  'سراة عبيد', 'بارق', 'الأفلاج', 'بللسمر', 'البدع', 'البكيريه', 'نيوم', 'المحارده', 'ظلم',
  'العقيق', 'عسير', 'تثليث', 'حقل', 'رنيه', 'النماص', 'حوطة بني تميم', 'القصب', 'المجارده',
  'النعيريه', 'البدائع', 'سليل', 'الخفجي', 'القوز', 'KAEC', 'المظيلف', 'خليص', 'تنومة', 'المهد',
  'سبت العلايا', 'سيهات', 'تمير', 'الشنان', 'اضم', 'ضرمه', 'شرما', 'خيبر', 'النشيفه', 'اشيقير',
  'تربه الطائف', 'تربه محايل عسير', 'الحيسونيه', 'القحمه', 'الرماح', 'حداء', 'تاروت', 'البشائر',
  'بني عمرو', 'تيماء', 'ظهران الجنوب', 'المويه', 'الحجره', 'الحناكيه', 'خريص', 'السليل',
]);

const EMPLOYEE_NAMES = Object.freeze(['Rasha', 'Ruba', 'Ibrahim', 'Abdullah']);

/** People Hanouf/Admin can assign VINs to (employees + Hanouf herself) */
const ASSIGNABLE_NAMES = Object.freeze(['Hanouf', 'Rasha', 'Ruba', 'Ibrahim', 'Abdullah']);

/** Sheet PIC spellings → canonical assignable name */
const PIC_NAME_ALIASES = Object.freeze({
  ebrahim: 'Ibrahim',
  ibrahim: 'Ibrahim',
  ibraheem: 'Ibrahim',
  rasha: 'Rasha',
  ruba: 'Ruba',
  abdullah: 'Abdullah',
  abdulah: 'Abdullah',
  abdalla: 'Abdullah',
  hanouf: 'Hanouf',
  hanoufah: 'Hanouf',
});

const USERS = Object.freeze([
  { id: 'admin', name: 'Admin', role: 'admin' },
  { id: 'hanouf', name: 'Hanouf', role: 'hanouf' },
  { id: 'rasha', name: 'Rasha', role: 'employee' },
  { id: 'ruba', name: 'Ruba', role: 'employee' },
  { id: 'ibrahim', name: 'Ibrahim', role: 'employee' },
  { id: 'abdullah', name: 'Abdullah', role: 'employee' },
]);

/** Excel header aliases → canonical raw field keys */
const HEADER_MAP = Object.freeze({
  date: ['date', 'تاريخ', 'تاريخ '],
  salesOrder: [
    'sales order no', 'sales order', 'sales order number', 'order number', 'order no', 'so',
    'رقم الطلب', 'sales order no رقم الطلب',
  ],
  vin: [
    'chassis / vin', 'chassis', 'vin', 'vin number', 'chassis number',
    'رقم الشاصي', 'الشاصي', 'رقم الشاسية', 'رقم الشاسيه', 'الشاسية',
  ],
  product: ['product', 'product name', 'model', 'المنتج'],
  damage: ['damage', 'ضرر'],
  pic: ['pic', 'p.i.c', 'assigned', 'assigned to', 'assignee', 'employee', 'المسؤول', 'مسؤول'],
  salesType: ['sales type', 'نوع البيع', 'طريقة البيع'],
  invoiceOwner: ['invoice owner', 'مالك الفاتورة'],
  userName: [
    'customer name', 'customer', 'اسم العميل', 'اسم الزبون',
    'user name', 'username', 'اسم المستخدم',
  ],
  salesAdvisor: [
    's/a', 's a', 'sa', 'sales advisor', 'salesman name', 'salesman',
    'sales employee', 'advisor', 'consultant', 'مستشار المبيعات',
  ],
  proformaDate: ['proforma date', 'proforma invoice date', 'pro forma date', 'تاريخ البروفورما'],
  deliveryDate: ['delivery date', 'تاريخ التسليم'],
  gtLocation: ['gt location', 'gt', 'موقع gt'],
  vehicleLocation: ['vehicle location', 'موقع المركبة', 'location'],
  phone: ['phone number', 'phone', 'mobile', 'رقم الجوال', 'الجوال', 'contact'],
  status: ['status', 'الحالة', 'الحالة status'],
  traffic: ['traffic', 'المرور', 'ملف المرور'],
  trafficFees: ['traffic fees', 'رسوم المرور', 'السداد traffic fees', 'السداد'],
  insurance: ['insurance', 'التأمين', 'التأمين insurance'],
  registrationDate: [
    'registration date', 'تاريخ الاستمارة',
    'تاريخ اصدار الاستماره registration date', 'تاريخ اصدار الاستماره',
  ],
  financeOfficer: ['اسم مسؤول التمويل', 'finance officer'],
  salePlace: ['مكان البيع', 'sale place', 'place of sale'],
});

/** Ops columns in Delivery sheet / E sales */
const OPS_HEADER_MAP = Object.freeze({
  guestSentDate: ['تاريخ إرسال الضيف', 'guest sent date'],
  signatureReceivedDate: ['تاريخ استلام التواقيع من الضيف', 'signature received'],
  accountsSentDate: [
    'تاريخ ارسال الملف للحسابات submission date',
    'تاريخ إرسال الملف للحسابات',
    'accounts sent', 'submission date',
  ],
  accountsApprovalDate: [
    'تاريخ استلام موافقة الحسابات',
    'تاريخ موافقة الحسابات',
    'accounts approval',
  ],
  vin1502: ['current vin 1502 tele sales', 'current vin 1502', 'vin 1502'],
  opsStatus: ['الحالة status', 'الحالة', 'status', 'ops status'],
  trafficFile: ['ملف المرور', 'traffic file'],
  trafficFeesOps: ['السداد traffic fees', 'السداد', 'traffic fees'],
  insuranceOps: ['التأمين insurance', 'التأمين', 'insurance'],
  registrationIssueDate: [
    'تاريخ اصدار الاستماره registration date',
    'تاريخ إصدار الاستمارة',
    'registration issue date',
  ],
  notes: ['الملاحظات remarks', 'الملاحظات', 'remarks', 'notes'],
  transferCity: ['مدينة الترحيل', 'transfer city', 'city'],
  carrier: ['الناقل', 'carrier', 'transporter'],
});

/**
 * Exact export headers for Delivery sheet «E sales» layout
 * (must stay in this order for re-upload compatibility).
 */
const E_SALES_EXPORT_HEADERS = Object.freeze([
  'تاريخ ',
  'Sales Order No.رقم الطلب',
  'رقم الشاسية ',
  'Product',
  'damage',
  'PIC',
  'Sales Type',
  'Invoice owner',
  'User Name',
  'S/A',
  'تاريخ إرسال الضيف',
  'تاريخ استلام التواقيع من الضيف',
  'تاريخ ارسال الملف للحسابات submission date',
  'تاريخ استلام موافقة الحسابات',
  'Current vin 1502 Tele sales',
  'GT',
  'Vehicle Location',
  'الحالة Status',
  'ملف المرور',
  'السداد Traffic fees',
  'التأمين insurance',
  'تاريخ اصدار الاستماره registration date',
  'الملاحظات Remarks ',
  'مدينة الترحيل',
  'الناقل',
  'اسم مسؤول التمويل',
  'طريقة البيع ',
  'مكان البيع',
  '', // phone / contact (unnamed in source sheet)
  'Center Arrival-Submission LT',
  'Submission - Registeration',
  'Sales Type2',
  'Delivery Date',
  'Registration - Delivery',
  'LT',
  'Proforma-Reg.2',
  'Center Arrival to Delivery',
  'Age from PI  to Date',
  'Age',
  'Center Arrival Date',
  'PI-Delivery',
  'PIAging',
]);

/** Fixed Sales Raw Excel letters (0-based indexes):
 *   A → S/A          B → Product      C → VIN
 *   K → Sales Type   N → Owner       P → Proforma Date
 * Also used when present: D Order · F GT · G Veh Loc · O Customer · Y Phone
 */
const RAW_COL = Object.freeze({
  salesAdvisor: 0, // A
  product: 1, // B
  vin: 2, // C
  salesOrder: 3, // D
  gtLocation: 5, // F
  vehicleLocation: 6, // G
  salesType: 10, // K
  invoiceOwner: 13, // N
  customerName: 14, // O
  proformaDate: 15, // P
  phone: 24, // Y
});

/** E sales / Delivery sheet fixed column indexes (0-based) */
const E_SALES_COL = Object.freeze({
  pic: 5,
  carrier: 24, // الناقل
  transferCity: 23, // مدينة الترحيل
  status: 17, // الحالة Status
});

/** Operational fields employees own — never wiped blank by Raw Data upload */
const OPS_FIELDS = Object.freeze([
  'guestSentDate',
  'signatureReceivedDate',
  'accountsSentDate',
  'accountsApprovalDate',
  'vin1502',
  'opsStatus',
  'trafficFile',
  'trafficFeesOps',
  'insuranceOps',
  'registrationIssueDate',
  'transferCity',
  'carrier',
  'carrierChangeCount',
  'notes',
  'assignedEmployeeId',
  'assignedEmployeeName',
  'assignedBy',
  'assignedAt',
  'guestCenter',
  'guestCollectAt',
  'guestCollected',
  'guestCollectNote',
]);

/** Detect Guest Experience / Automall vehicles from location fields */
function isGuestCenterRaw(raw, ops) {
  if (ops && String(ops.guestCenter || '').toLowerCase() === 'yes') return true;
  if (ops && ops.guestCollectAt) return true;
  const blob = [
    raw && raw.gtLocation,
    raw && raw.vehicleLocation,
    raw && raw.pic,
    raw && raw.salesType,
    ops && ops.transferCity,
    ops && ops.notes,
  ].map((x) => String(x || '')).join(' ').toLowerCase();
  return /guest|experience|automall|auto\s*mall|اوتومول|أوتومول|ضيف|تجربة|معرض/.test(blob);
}

module.exports = {
  STATUSES,
  STATUS_SORT_ORDER,
  COMPLETED_STATUS,
  YES_NO,
  CARRIERS,
  CARRIER_TO_COORDINATOR_COMPANY,
  mapCarrierToCoordinatorCompany,
  mapCoordinatorCompanyToCarrier,
  TRANSFER_CITIES,
  EMPLOYEE_NAMES,
  ASSIGNABLE_NAMES,
  PIC_NAME_ALIASES,
  USERS,
  HEADER_MAP,
  OPS_HEADER_MAP,
  E_SALES_EXPORT_HEADERS,
  RAW_COL,
  E_SALES_COL,
  OPS_FIELDS,
  isGuestCenterRaw,
};
