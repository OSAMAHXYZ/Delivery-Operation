import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BackOrdersTable } from "@/components/back-orders/back-orders-table";
import { demoStore } from "@/lib/demo-store";
import type { BoStatus, PaymentStatus } from "@/types";

export default async function BackOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    payment?: string;
    status?: string;
    fast?: string;
  }>;
}) {
  const params = await searchParams;

  const initialPayment =
    params.payment === "PAID" || params.payment === "UNPAID"
      ? (params.payment as PaymentStatus)
      : undefined;
  const initialStatus =
    params.status === "CANCELLED" || params.status === "OPEN" || params.status === "ALLOCATED"
      ? (params.status as BoStatus)
      : undefined;
  const initialFast = params.fast === "false" ? false : params.fast === "true" ? true : undefined;

  const title =
    initialPayment === "PAID"
      ? "Paid Back Orders"
      : initialStatus === "CANCELLED"
        ? "Cancelled Back Orders"
        : initialFast === false
          ? "Non-Fast Back Orders"
          : "Back Orders";

  return (
    <AppShell title={title} subtitle="Manage customer back orders and matching">
      <Suspense fallback={null}>
        <BackOrdersTable
          orders={demoStore.getBackOrders()}
          initialPayment={initialPayment}
          initialStatus={initialStatus}
          initialFast={initialFast}
        />
      </Suspense>
    </AppShell>
  );
}
