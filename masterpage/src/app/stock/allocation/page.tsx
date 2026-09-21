import { AppShell } from "@/components/layout/app-shell";
import { demoStore } from "@/lib/demo-store";

export default function AllocationPage() {
  const allocations = demoStore.getAllocations();

  return (
    <AppShell title="Allocation History" subtitle="Audit trail of VIN allocations">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["BO Number", "VIN", "User", "Date"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{a.boNumber}</td>
                <td className="px-4 py-3 font-mono text-xs">{a.vin}</td>
                <td className="px-4 py-3">{a.user}</td>
                <td className="px-4 py-3">{new Date(a.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
