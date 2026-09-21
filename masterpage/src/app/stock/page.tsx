import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { StockTable } from "@/components/stock/stock-table";
import { demoStore } from "@/lib/demo-store";
import type { VehicleStatus } from "@/types";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus =
    status && ["FREE", "RESERVED", "ALLOCATED", "SOLD"].includes(status)
      ? (status as VehicleStatus)
      : undefined;

  const title =
    initialStatus === "FREE"
      ? "Free Stock"
      : initialStatus === "RESERVED"
        ? "Reserved Stock"
        : "Stock";

  return (
    <AppShell title={title} subtitle="Search, filter, and inspect vehicles">
      <Suspense fallback={null}>
        <StockTable vehicles={demoStore.getVehicles()} initialStatus={initialStatus} />
      </Suspense>
    </AppShell>
  );
}
