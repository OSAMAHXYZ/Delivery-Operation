import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { demoStore } from "@/lib/demo-store";
import { findMatches, queuePriority } from "@/services/matching";

export default function BoQueuePage() {
  const rules = demoStore.getRules();
  const colors = demoStore.getColors();
  const vehicles = demoStore.getVehicles();

  const queue = demoStore
    .getBackOrders()
    .filter((b) => b.status === "OPEN" || b.status === "MATCHED")
    .map((b) => {
      const best = findMatches(b, vehicles, colors)[0];
      return {
        ...b,
        bestScore: best?.score ?? 0,
        bestVin: best?.vin,
        priority: Math.round(queuePriority(b, best?.score ?? 0, rules)),
      };
    })
    .sort((a, b) => b.priority - a.priority);

  return (
    <AppShell title="BO Allocation Queue" subtitle="Recommended allocation order based on configurable rules">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["Priority", "BO Number", "Customer", "Payment", "Aging", "Match", "Recommended VIN", "Status"].map(
                (h) => (
                  <th key={h} className="px-4 py-3 font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {queue.map((b) => (
              <tr key={b.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Badge variant="info">{b.priority}</Badge>
                </td>
                <td className="px-4 py-3 font-semibold">{b.boNumber}</td>
                <td className="px-4 py-3">{b.customer}</td>
                <td className="px-4 py-3">{b.paymentStatus}</td>
                <td className="px-4 py-3">{b.agingDays}d</td>
                <td className="px-4 py-3">{b.bestScore}%</td>
                <td className="px-4 py-3 font-mono text-xs">{b.bestVin ?? "—"}</td>
                <td className="px-4 py-3">{b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
