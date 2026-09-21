import type {
  AllocationRecord,
  AppRules,
  AuditRecord,
  AuditRule,
  AuditTrailEntry,
  BackOrder,
  ColorEntry,
  DashboardStats,
  User,
  Vehicle,
  Violation,
} from "@/types";

const defaultRules: AppRules = {
  autoAllocate: false,
  qualityThresholds: { compliant: 100, minor: 90, needsCorrection: 70 },
  allocationWeights: {
    payment: 30,
    aging: 25,
    fastProduct: 10,
    confirmation: 15,
    matchScore: 20,
  },
};

const users: User[] = [
  { id: "u1", email: "admin@toyota.sa", name: "System Admin", nameAr: "مدير النظام", role: "ADMIN", locale: "en" },
  { id: "u2", email: "manager@toyota.sa", name: "Fleet Manager", nameAr: "مدير الأسطول", role: "MANAGER", locale: "en" },
  { id: "u3", email: "sales@toyota.sa", name: "Ahmed Al-Qahtani", nameAr: "أحمد القحطاني", role: "SALES", locale: "ar" },
  { id: "u4", email: "quality@toyota.sa", name: "Sara Al-Harbi", nameAr: "سارة الحربي", role: "QUALITY_AUDITOR", locale: "ar" },
  { id: "u5", email: "viewer@toyota.sa", name: "Operations Viewer", nameAr: "مشاهد العمليات", role: "VIEWER", locale: "en" },
];

let vehicles: Vehicle[] = [
  { id: "v1", vin: "JTMHB09J904012345", product: "Land Cruiser", modelYear: 2025, suffix: "VX", exteriorColor: "Pearl White", interiorColor: "Black", exteriorCode: "089", interiorCode: "20", location: "Jeddah Central", status: "FREE" },
  { id: "v2", vin: "JTMHB09J904012346", product: "Land Cruiser", modelYear: 2025, suffix: "VX", exteriorColor: "Attitude Black", interiorColor: "Beige", exteriorCode: "218", interiorCode: "4T1", location: "Riyadh Yard", status: "FREE" },
  { id: "v3", vin: "JTDKN3DU9A0123456", product: "Camry", modelYear: 2025, suffix: "GLE", exteriorColor: "Silver Metallic", interiorColor: "Black", exteriorCode: "1F7", interiorCode: "20", location: "Dammam Port", status: "RESERVED", matchedBoNumber: "BO-2025-1042", matchScore: 100 },
  { id: "v4", vin: "JTDKN3DU9A0123457", product: "Camry", modelYear: 2025, suffix: "GLE", exteriorColor: "Pearl White", interiorColor: "Black", exteriorCode: "089", interiorCode: "20", location: "Jeddah Central", status: "FREE" },
  { id: "v5", vin: "JTEBU5JR7K5123456", product: "Hilux Double Cab", modelYear: 2024, suffix: "GLX", exteriorColor: "Super White", interiorColor: "Black", exteriorCode: "040", interiorCode: "20", location: "Tabuk", status: "ALLOCATED", matchedBoNumber: "BO-2025-1031", matchScore: 80 },
  { id: "v6", vin: "JTMWWRFV8KD012345", product: "RAV4", modelYear: 2025, suffix: "ADV", exteriorColor: "Graphite", interiorColor: "Black", exteriorCode: "1G3", interiorCode: "20", location: "Riyadh Yard", status: "FREE" },
  { id: "v7", vin: "JTMWWRFV8KD012346", product: "RAV4", modelYear: 2025, suffix: "ADV", exteriorColor: "Pearl White", interiorColor: "Black", exteriorCode: "089", interiorCode: "20", location: "Khobar", status: "FREE" },
  { id: "v8", vin: "JTMFB3FV8KD012347", product: "Corolla Cross", modelYear: 2025, suffix: "LE", exteriorColor: "Celestite Gray", interiorColor: "Black", exteriorCode: "1C8", interiorCode: "20", location: "Jeddah Central", status: "SOLD" },
];

let backOrders: BackOrder[] = [
  { id: "b1", boNumber: "BO-2025-1042", customer: "Al Rajhi Fleet", salesman: "Fahad Al-Otaibi", product: "Camry", modelYear: 2025, suffix: "GLE", exteriorColor: "Silver Metallic", interiorColor: "Black", agingDays: 12, paymentStatus: "PAID", confirmationStatus: "CONFIRMED", vin: "JTDKN3DU9A0123456", qualityScore: 100, status: "MATCHED", fastProduct: true },
  { id: "b2", boNumber: "BO-2025-1031", customer: "Saudi Logistics Co.", salesman: "Ahmed Al-Qahtani", product: "Hilux Double Cab", modelYear: 2024, suffix: "GLX", exteriorColor: "Super White", interiorColor: "Black", agingDays: 45, paymentStatus: "PAID", confirmationStatus: "CONFIRMED", vin: "JTEBU5JR7K5123456", qualityScore: 82, status: "ALLOCATED", fastProduct: false },
  { id: "b3", boNumber: "BO-2025-1088", customer: "National Rent A Car", salesman: "Mohammed Al-Dossary", product: "Land Cruiser", modelYear: 2025, suffix: "VX", exteriorColor: "Pearl White", interiorColor: "Black", agingDays: 8, paymentStatus: "PAID", confirmationStatus: "PENDING", status: "OPEN", fastProduct: true, hasViolation: false },
  { id: "b4", boNumber: "BO-2025-1099", customer: "Gulf Trading Est.", salesman: "Ahmed Al-Qahtani", product: "RAV4", modelYear: 2025, suffix: "ADV", exteriorColor: "Pearl White", interiorColor: "Black", agingDays: 21, paymentStatus: "UNPAID", confirmationStatus: "PENDING", status: "OPEN", fastProduct: true },
  { id: "b5", boNumber: "BO-2025-1105", customer: "Eastern Motors", salesman: "Khalid Al-Mutairi", product: "Camry", modelYear: 2025, suffix: "GLE", exteriorColor: "Pearl White", interiorColor: "Black", agingDays: 67, paymentStatus: "PARTIAL", confirmationStatus: "REJECTED", status: "OPEN", fastProduct: true, hasViolation: true },
  { id: "b6", boNumber: "BO-2024-9912", customer: "Legacy Fleet", salesman: "Fahad Al-Otaibi", product: "Corolla Cross", modelYear: 2024, suffix: "LE", exteriorColor: "Celestite Gray", interiorColor: "Black", agingDays: 120, paymentStatus: "UNPAID", confirmationStatus: "PENDING", status: "CANCELLED", fastProduct: false },
];

let colors: ColorEntry[] = [
  { id: "c1", sourceColor: "Platinum White Pearl MC 089", standardColor: "Pearl White", toyotaCode: "089", kind: "EXTERIOR", active: true },
  { id: "c2", sourceColor: "ATTITUDEBLACKMC218", standardColor: "Attitude Black", toyotaCode: "218", kind: "EXTERIOR", active: true },
  { id: "c3", sourceColor: "Silver Metallic 1F7", standardColor: "Silver Metallic", toyotaCode: "1F7", kind: "EXTERIOR", active: true },
  { id: "c4", sourceColor: "Black 20", standardColor: "Black", toyotaCode: "20", kind: "INTERIOR", active: true },
  { id: "c5", sourceColor: "BEIGEME.4T1", standardColor: "Beige", toyotaCode: "4T1", kind: "INTERIOR", active: true },
];

const auditRules: AuditRule[] = [
  { code: "R1", name: "Data Accuracy", nameAr: "دقة البيانات", description: "Customer and product data matches source documents." },
  { code: "R2", name: "Cash Payment", nameAr: "الدفع النقدي", description: "Cash payment evidence is complete." },
  { code: "R3", name: "Bank Document", nameAr: "مستند البنك", description: "Bank documents are valid and signed." },
  { code: "R4", name: "Bank Activation", nameAr: "تفعيل البنك", description: "Bank activation completed before allocation." },
  { code: "R5", name: "Previous Model", nameAr: "موديل سابق", description: "Previous model year rules are respected." },
  { code: "R6", name: "Cash Cancellation", nameAr: "إلغاء نقدي", description: "Cash cancellation policy followed." },
  { code: "R7", name: "Employee Quote", nameAr: "عرض موظف", description: "Employee quote approval exists." },
  { code: "R8", name: "Mobile", nameAr: "الجوال", description: "Customer mobile verified." },
  { code: "R9", name: "Color/Class Change", nameAr: "تغيير اللون/الفئة", description: "Color or class changes documented." },
  { code: "R10", name: "Company Qty", nameAr: "كمية الشركة", description: "Company quantity limits respected." },
  { code: "R11", name: "Company Payment", nameAr: "دفع الشركة", description: "Company payment terms met." },
  { code: "R12", name: "VIN Deallocation", nameAr: "إلغاء تخصيص الشاسيه", description: "VIN deallocation properly authorized." },
  { code: "R13", name: "Notes", nameAr: "الملاحظات", description: "Required notes captured." },
];

let violations: Violation[] = [
  { id: "vi1", boNumber: "BO-2025-1105", ruleCode: "R3", description: "Missing bank approval letter", evidence: "No scanned document in file", correctiveAction: "Upload signed bank letter", owner: "Ahmed Al-Qahtani", dueDate: "2025-08-25", status: "OPEN", severity: "high" },
  { id: "vi2", boNumber: "BO-2025-1031", ruleCode: "R5", description: "Previous model year without waiver", evidence: "2024 Hilux requested on 2025 policy", correctiveAction: "Obtain manager waiver", owner: "Fleet Manager", dueDate: "2025-08-20", status: "IN_PROGRESS", reviewer: "Sara Al-Harbi", severity: "medium" },
];

let audits: AuditRecord[] = [
  { id: "a1", boNumber: "BO-2025-1042", auditor: "Sara Al-Harbi", qualityScore: 100, result: "Compliant", createdAt: "2025-08-10T09:00:00Z" },
  { id: "a2", boNumber: "BO-2025-1031", auditor: "Sara Al-Harbi", qualityScore: 82, result: "Needs Correction", createdAt: "2025-08-12T11:30:00Z" },
];

let allocations: AllocationRecord[] = [
  { id: "al1", boNumber: "BO-2025-1031", vin: "JTEBU5JR7K5123456", user: "Fleet Manager", createdAt: "2025-08-11T14:00:00Z" },
];

let trails: AuditTrailEntry[] = [
  { id: "t1", user: "System Admin", action: "RULES_UPDATED", recordType: "settings", recordId: "default", newValue: "Quality thresholds saved", createdAt: "2025-08-01T08:00:00Z" },
  { id: "t2", user: "Fleet Manager", action: "VIN_ALLOCATED", recordType: "allocation", recordId: "al1", newValue: "BO-2025-1031 → JTEBU5JR7K5123456", createdAt: "2025-08-11T14:00:00Z" },
];

let rules: AppRules = structuredClone(defaultRules);

function pushTrail(entry: Omit<AuditTrailEntry, "id" | "createdAt">) {
  trails.unshift({
    ...entry,
    id: `t${Date.now()}`,
    createdAt: new Date().toISOString(),
  });
}

export const demoStore = {
  getUsers: () => users,
  getUserByEmail: (email: string) => users.find((u) => u.email === email),
  getVehicles: () => vehicles,
  getVehicle: (id: string) => vehicles.find((v) => v.id === id),
  getBackOrders: () => backOrders,
  getBackOrder: (id: string) => backOrders.find((b) => b.id === id),
  getColors: () => colors,
  getRules: () => rules,
  setRules: (next: AppRules) => {
    rules = next;
    pushTrail({ user: "System Admin", action: "RULES_UPDATED", recordType: "settings", recordId: "default", newValue: JSON.stringify(next) });
  },
  getAuditRules: () => auditRules,
  getViolations: () => violations,
  getAudits: () => audits,
  getAllocations: () => allocations,
  getTrails: () => trails,
  updateVehicle: (id: string, patch: Partial<Vehicle>) => {
    vehicles = vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v));
  },
  updateBackOrder: (id: string, patch: Partial<BackOrder>) => {
    backOrders = backOrders.map((b) => (b.id === id ? { ...b, ...patch } : b));
  },
  addAllocation: (record: Omit<AllocationRecord, "id" | "createdAt">) => {
    const item: AllocationRecord = { ...record, id: `al${Date.now()}`, createdAt: new Date().toISOString() };
    allocations.unshift(item);
    pushTrail({ user: record.user, action: "VIN_ALLOCATED", recordType: "allocation", recordId: item.id, newValue: `${record.boNumber} → ${record.vin}` });
    return item;
  },
  getDashboardStats: (): DashboardStats => {
    const matched = backOrders.filter((b) => b.vin).length;
    const paid = backOrders.filter((b) => b.paymentStatus === "PAID").length;
    const openViolations = violations.filter((v) => v.status !== "RESOLVED").length;
    const avgAging = Math.round(backOrders.reduce((s, b) => s + b.agingDays, 0) / backOrders.length);
    const quality = Math.round(audits.reduce((s, a) => s + a.qualityScore, 0) / audits.length);
    return {
      totalStock: vehicles.length,
      totalBackOrders: backOrders.filter((b) => b.status !== "CANCELLED").length,
      paidBackOrders: paid,
      freeStock: vehicles.filter((v) => v.status === "FREE").length,
      reservedStock: vehicles.filter((v) => v.status === "RESERVED" || v.status === "ALLOCATED").length,
      matchedVins: matched,
      confirmedViolations: openViolations,
      averageBoAging: avgAging,
      qualityScore: quality,
    };
  },
};
