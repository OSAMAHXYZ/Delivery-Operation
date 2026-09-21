import { AppShell } from "@/components/layout/app-shell";
import { demoStore } from "@/lib/demo-store";

export default function SalesReportPage() {
  const rows = demoStore.getAllocations().map((a) => ({
    Date: new Date(a.createdAt).toLocaleDateString(),
    "BO Number": a.boNumber,
    VIN: a.vin,
    User: a.user,
  }));

  return (
    <AppShell title="Sales Report" subtitle="Allocation and delivery activity">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["Date", "BO Number", "VIN", "User"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                {Object.values(row).map((val, j) => (
                  <td key={j} className="px-4 py-3">
                    {val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
