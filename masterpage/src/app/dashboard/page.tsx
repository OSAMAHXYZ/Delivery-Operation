import { AppShell, KpiCard } from "@/components/layout/app-shell";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { demoStore } from "@/lib/demo-store";

export default function DashboardPage() {
  const stats = demoStore.getDashboardStats();
  const critical = demoStore
    .getBackOrders()
    .filter((b) => b.agingDays >= 30 || b.hasViolation)
    .slice(0, 5);

  return (
    <AppShell title="Dashboard" subtitle="Management overview — stock, back orders, quality">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Total Stock" value={stats.totalStock} href="/stock" />
        <KpiCard label="Total Back Orders" value={stats.totalBackOrders} href="/back-orders" />
        <KpiCard label="Paid Back Orders" value={stats.paidBackOrders} href="/back-orders?payment=PAID" />
        <KpiCard label="Free Stock" value={stats.freeStock} href="/stock?status=FREE" />
        <KpiCard label="Reserved Stock" value={stats.reservedStock} href="/stock?status=RESERVED" />
        <KpiCard label="Matched VINs" value={stats.matchedVins} href="/back-orders" />
        <KpiCard label="Confirmed Violations" value={stats.confirmedViolations} href="/quality/violations" />
        <KpiCard label="Average BO Aging" value={stats.averageBoAging} href="/back-orders/queue" suffix="days" />
        <KpiCard label="Quality Score" value={`${stats.qualityScore}%`} href="/quality" />
      </div>

      <div className="mt-6">
        <DashboardCharts />
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold">Critical Back Orders</h2>
          <p className="text-sm text-slate-500">High aging or open quality issues</p>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["BO Number", "Customer", "Product", "Aging", "Payment", "Status"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {critical.map((b) => (
              <tr key={b.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold">{b.boNumber}</td>
                <td className="px-4 py-3">{b.customer}</td>
                <td className="px-4 py-3">{b.product}</td>
                <td className="px-4 py-3">{b.agingDays} days</td>
                <td className="px-4 py-3">{b.paymentStatus}</td>
                <td className="px-4 py-3">{b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
