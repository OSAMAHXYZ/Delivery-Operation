import type { MessageKey } from "@/lib/i18n/messages";
import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  Palette,
  Settings,
  ShieldAlert,
  Truck,
  Upload,
  Users,
} from "lucide-react";

export interface NavItem {
  key: MessageKey;
  href: string;
  icon: typeof LayoutDashboard;
}

export interface NavSection {
  key: MessageKey;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    key: "dashboard",
    items: [{ key: "dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    key: "stock",
    items: [
      { key: "allStock", href: "/stock", icon: Boxes },
      { key: "freeStock", href: "/stock?status=FREE", icon: Truck },
      { key: "reservedStock", href: "/stock?status=RESERVED", icon: Boxes },
      { key: "allocation", href: "/stock/allocation", icon: FileSpreadsheet },
    ],
  },
  {
    key: "backOrders",
    items: [
      { key: "allBackOrders", href: "/back-orders", icon: ClipboardCheck },
      { key: "paidBackOrders", href: "/back-orders?payment=PAID", icon: ClipboardCheck },
      { key: "nonFastBackOrders", href: "/back-orders?fast=false", icon: ClipboardCheck },
      { key: "cancelledBackOrders", href: "/back-orders?status=CANCELLED", icon: ClipboardCheck },
      { key: "boQueue", href: "/back-orders/queue", icon: BarChart3 },
    ],
  },
  {
    key: "quality",
    items: [
      { key: "audit", href: "/quality/audit", icon: ClipboardCheck },
      { key: "confirmedViolations", href: "/quality/violations", icon: ShieldAlert },
      { key: "qualityDashboard", href: "/quality", icon: BarChart3 },
    ],
  },
  {
    key: "reports",
    items: [
      { key: "stockReport", href: "/reports/stock", icon: FileSpreadsheet },
      { key: "backOrderReport", href: "/reports/back-orders", icon: FileSpreadsheet },
      { key: "salesReport", href: "/reports/sales", icon: FileSpreadsheet },
    ],
  },
  {
    key: "administration",
    items: [
      { key: "dataUpload", href: "/admin/upload", icon: Upload },
      { key: "rulesSetup", href: "/admin/rules", icon: Settings },
      { key: "colorDictionary", href: "/admin/colors", icon: Palette },
      { key: "users", href: "/admin/users", icon: Users },
    ],
  },
];
