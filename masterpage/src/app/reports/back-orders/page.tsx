import { AppShell } from "@/components/layout/app-shell";
import { demoStore } from "@/lib/demo-store";

function ReportTable({
  rows,
  columns,
}: {
  rows: Record<string, string | number>[];
  columns: string[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            {columns.map((h) => (
              <th key={h} className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100">
              {columns.map((col) => (
                <td key={col} className="px-4 py-3">
                  {String(row[col] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BackOrderReportPage() {
  const rows = demoStore.getBackOrders().map((b) => ({
    "BO Number": b.boNumber,
    Customer: b.customer,
    Product: b.product,
    Aging: b.agingDays,
    Status: b.status,
  }));

  return (
    <AppShell title="Back Order Report" subtitle="Export-ready back order snapshot">
      <ReportTable rows={rows} columns={["BO Number", "Customer", "Product", "Aging", "Status"]} />
    </AppShell>
  );
}
