export type Role = "ADMIN" | "MANAGER" | "SALES" | "QUALITY_AUDITOR" | "VIEWER";
export type Locale = "en" | "ar";

export type VehicleStatus = "FREE" | "RESERVED" | "ALLOCATED" | "SOLD";
export type PaymentStatus = "PAID" | "UNPAID" | "PARTIAL";
export type ConfirmationStatus = "CONFIRMED" | "PENDING" | "REJECTED";
export type BoStatus = "OPEN" | "MATCHED" | "ALLOCATED" | "CANCELLED";
export type ViolationStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "OVERDUE";

export interface User {
  id: string;
  email: string;
  name: string;
  nameAr: string;
  role: Role;
  locale: Locale;
}

export interface Vehicle {
  id: string;
  vin: string;
  product: string;
  modelYear: number;
  suffix: string;
  exteriorColor: string;
  interiorColor: string;
  exteriorCode: string;
  interiorCode: string;
  location: string;
  status: VehicleStatus;
  matchedBoNumber?: string;
  matchScore?: number;
}

export interface BackOrder {
  id: string;
  boNumber: string;
  customer: string;
  salesman: string;
  product: string;
  modelYear: number;
  suffix: string;
  exteriorColor: string;
  interiorColor: string;
  agingDays: number;
  paymentStatus: PaymentStatus;
  confirmationStatus: ConfirmationStatus;
  vin?: string;
  qualityScore?: number;
  status: BoStatus;
  fastProduct: boolean;
  hasViolation?: boolean;
}

export interface ColorEntry {
  id: string;
  sourceColor: string;
  standardColor: string;
  toyotaCode: string;
  kind: "EXTERIOR" | "INTERIOR";
  active: boolean;
}

export interface MatchCandidate {
  vehicleId: string;
  vin: string;
  score: number;
  breakdown: Record<string, boolean>;
  location: string;
}

export interface Violation {
  id: string;
  boNumber: string;
  ruleCode: string;
  description: string;
  evidence: string;
  correctiveAction: string;
  owner: string;
  dueDate: string;
  status: ViolationStatus;
  reviewer?: string;
  reviewDate?: string;
  severity: "low" | "medium" | "high";
}

export interface AuditRule {
  code: string;
  name: string;
  nameAr: string;
  description: string;
}

export interface AuditRecord {
  id: string;
  boNumber: string;
  auditor: string;
  qualityScore: number;
  result: string;
  createdAt: string;
}

export interface AllocationRecord {
  id: string;
  boNumber: string;
  vin: string;
  user: string;
  createdAt: string;
}

export interface AuditTrailEntry {
  id: string;
  user: string;
  action: string;
  recordType: string;
  recordId: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

export interface AppRules {
  autoAllocate: boolean;
  qualityThresholds: {
    compliant: number;
    minor: number;
    needsCorrection: number;
  };
  allocationWeights: {
    payment: number;
    aging: number;
    fastProduct: number;
    confirmation: number;
    matchScore: number;
  };
}

export interface DashboardStats {
  totalStock: number;
  totalBackOrders: number;
  paidBackOrders: number;
  freeStock: number;
  reservedStock: number;
  matchedVins: number;
  confirmedViolations: number;
  averageBoAging: number;
  qualityScore: number;
}
