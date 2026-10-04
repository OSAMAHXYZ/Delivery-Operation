'use strict';

/** Delivery Transformation — isolated module (no shared store with deliveryteam / delivery-hub). */

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

const TRANSFER_CITIES = Object.freeze([
  'الرياض',
  'جدة',
  'اوتومول',
  'أوتومول',
  'الدمام',
  'مكة',
  'المدينة',
  'أبها',
  'تبوك',
  'حائل',
  'الخبر',
  'الجبيل',
]);

/**
 * People who can sign in. There is no Admin user.
 * The admin.html page is a password-only data collector.
 * - hanouf: uploads VINs (current proforma month) + Sales Raw, edits any Live Sheet VIN
 * - coordinator: Live Sheet VIN + details (read-only, no employee entry)
 * - employee: Live Sheet see + edit (ops entry)
 */
const USERS = Object.freeze([
  { id: 'hanouf', name: 'Hanouf', role: 'hanouf' },
  { id: 'alfadel', name: 'الفاضل', role: 'coordinator', canInventory: true },
  { id: 'albara', name: 'البراء', role: 'coordinator', canInventory: true },
  // canUploadSalesRaw: may upload Sales Raw (updates vehicle details on every VIN)
  // canEditAnyVin: may edit every Live Sheet VIN, not only assigned ones
  // canCoordinate: may sign in on coordinator.html (print) without losing employee.html
  // canInventory: delivery-transformation/inventory-managment.html (Ruba / الفاضل / البراء)
  { id: 'rasha', name: 'Rasha', role: 'employee', canUploadSalesRaw: true, canEditAnyVin: true },
  { id: 'ruba', name: 'Ruba', role: 'employee', canUploadSalesRaw: true, canCoordinate: true, canInventory: true },
  { id: 'ibrahim', name: 'Ibrahim', role: 'employee' },
  { id: 'abdullah', name: 'Abdullah', role: 'employee' },
]);

const OPS_FIELDS = Object.freeze([
  'opsStatus',
  'guestSentDate',
  'signatureReceivedDate',
  'accountsSentDate',
  'accountsApprovalDate',
  'vin1502',
  'trafficFile',
  'trafficFeesOps',
  'insuranceOps',
  'registrationIssueDate',
  'transferCity',
  'carrier',
  'notes',
  'guestCenter',
]);

function emptyOps() {
  return {
    opsStatus: '',
    guestSentDate: '',
    signatureReceivedDate: '',
    accountsSentDate: '',
    accountsApprovalDate: '',
    vin1502: '',
    trafficFile: '',
    trafficFeesOps: '',
    insuranceOps: '',
    registrationIssueDate: '',
    transferCity: '',
    carrier: '',
    notes: '',
    guestCenter: '',
    guestCollectAt: '',
    guestCollectNote: '',
    guestCollected: '',
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    assignedBy: '',
    assignedAt: '',
    updatedBy: '',
    updatedAt: '',
    statusHistory: [],
    coordinatorPrintedAt: '',
    coordinatorPrintedBy: '',
    coordinatorPrintKind: '',
    coordinatorPrintCompany: '',
    coordinatorPrintCity: '',
    inventoryOwnerId: '',
    inventoryOwnerName: '',
    inventoryClaimedAt: '',
    inventoryLabel: '',
  };
}

function emptyRaw() {
  return {
    date: '',
    proformaDate: '',
    invoiceDate: '',
    salesOrder: '',
    vin: '',
    product: '',
    salesType: '',
    invoiceOwner: '',
    userName: '',
    salesAdvisor: '',
    phone: '',
    gtLocation: '',
    vehicleLocation: '',
    pic: '',
    leadTime: '',
  };
}

/** Excel header aliases → raw field keys (delivery sheet + Sales Raw) */
const HEADER_MAP = Object.freeze({
  date: ['date', 'تاريخ'],
  salesOrder: [
    'sales order no', 'sales order', 'sales order number', 'order number', 'order no', 'so',
    'رقم الطلب', 'sales order no رقم الطلب',
  ],
  vin: [
    'chassis / vin', 'chassis', 'vin', 'vin number', 'chassis number',
    'رقم الشاصي', 'الشاصي', 'رقم الشاسية', 'رقم الشاسيه', 'الشاسية',
  ],
  product: ['product', 'product name', 'model', 'المنتج'],
  pic: ['pic', 'p.i.c', 'assigned', 'assigned to', 'assignee', 'employee', 'المسؤول', 'مسؤول'],
  salesType: ['sales type', 'نوع البيع', 'طريقة البيع'],
  invoiceOwner: ['invoice owner', 'owner', 'مالك الفاتورة'],
  userName: ['customer name', 'customer', 'اسم العميل', 'اسم الزبون', 'user name', 'username'],
  salesAdvisor: [
    's/a', 's a', 'sa', 'sales advisor', 'salesman name', 'salesman',
    'sales employee', 'advisor', 'consultant', 'مستشار المبيعات',
  ],
  proformaDate: ['proforma date', 'proforma invoice date', 'pro forma date', 'تاريخ البروفورما'],
  invoiceDate: ['invoice date', 'invoice dt', 'inv date', 'تاريخ الفاتورة', 'تاريخ الانفويس'],
  gtLocation: ['gt location', 'gt', 'موقع gt'],
  vehicleLocation: ['vehicle location', 'veh loc', 'موقع المركبة', 'location'],
  phone: ['phone number', 'phone', 'mobile', 'رقم الجوال', 'الجوال', 'contact'],
  leadTime: [
    'lead time', 'leadtime', 'delivery lead time', 'lt',
    'مدة التسليم', 'زمن التسليم', 'lead time days',
  ],
});

/** Employee-entry columns that may appear in the delivery sheet */
const OPS_HEADER_MAP = Object.freeze({
  guestSentDate: ['تاريخ إرسال الضيف', 'guest sent date'],
  signatureReceivedDate: ['تاريخ استلام التواقيع من الضيف', 'signature received'],
  accountsSentDate: ['تاريخ ارسال الملف للحسابات submission date', 'تاريخ إرسال الملف للحسابات', 'submission date'],
  accountsApprovalDate: ['تاريخ استلام موافقة الحسابات', 'تاريخ موافقة الحسابات', 'accounts approval'],
  vin1502: ['current vin 1502 tele sales', 'current vin 1502', 'vin 1502'],
  opsStatus: ['الحالة status', 'الحالة', 'status', 'ops status'],
  trafficFile: ['ملف المرور', 'traffic file'],
  trafficFeesOps: ['السداد traffic fees', 'السداد', 'traffic fees'],
  insuranceOps: ['التأمين insurance', 'التأمين', 'insurance'],
  registrationIssueDate: ['تاريخ اصدار الاستماره registration date', 'تاريخ إصدار الاستمارة', 'registration date'],
  notes: ['الملاحظات remarks', 'الملاحظات', 'remarks', 'notes'],
  transferCity: ['مدينة الترحيل', 'transfer city', 'city'],
  carrier: ['الناقل', 'carrier', 'transporter'],
});

/** Sales Raw fixed letter layout (0-based) when column A is S/A instead of VIN */
const RAW_COL = Object.freeze({
  salesAdvisor: 0, // A
  product: 1, // B
  vin: 2, // C
  salesOrder: 3, // D
  gtLocation: 5, // F
  vehicleLocation: 6, // G
  salesType: 10, // K
  invoiceOwner: 13, // N
  userName: 14, // O
  proformaDate: 15, // P
  invoiceDate: 21, // V
  leadTime: 22, // W
  phone: 24, // Y
});

/** Sheet PIC spellings → employee id */
const PIC_ALIASES = Object.freeze({
  ebrahim: 'ibrahim',
  ibraheem: 'ibrahim',
  abdulah: 'abdullah',
  abdalla: 'abdullah',
  hanof: 'hanouf',
  henouf: 'hanouf',
});

module.exports = {
  STATUSES,
  YES_NO,
  CARRIERS,
  TRANSFER_CITIES,
  USERS,
  OPS_FIELDS,
  HEADER_MAP,
  OPS_HEADER_MAP,
  RAW_COL,
  PIC_ALIASES,
  emptyOps,
  emptyRaw,
};
