import { AppShell } from "@/components/layout/app-shell";
import { demoStore } from "@/lib/demo-store";

function ReportPage({
  title,
  subtitle,
  rows,
  columns,
}: {
  title: string;
  subtitle: string;
  rows: Record<string, string | number>[];
  columns: string[];
}) {
  return (
    <AppShell title={title} subtitle={subtitle}>
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
    </AppShell>
  );
}

export default function StockReportPage() {
  const rows = demoStore.getVehicles().map((v) => ({
    VIN: v.vin,
    Product: v.product,
    Year: v.modelYear,
    Location: v.location,
    Status: v.status,
  }));
  return <ReportPage title="Stock Report" subtitle="Export-ready stock snapshot" rows={rows} columns={["VIN", "Product", "Year", "Location", "Status"]} />;
}
