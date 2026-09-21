import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { demoStore } from "@/lib/demo-store";

export default function ColorDictionaryPage() {
  const colors = demoStore.getColors();

  return (
    <AppShell title="Color Dictionary" subtitle="Normalize source colors for the VIN matching engine">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["Source Color", "Standard Color", "Toyota Code", "Kind", "Active"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{c.sourceColor}</td>
                <td className="px-4 py-3">{c.standardColor}</td>
                <td className="px-4 py-3 font-mono">{c.toyotaCode}</td>
                <td className="px-4 py-3">{c.kind}</td>
                <td className="px-4 py-3">
                  <Badge variant={c.active ? "success" : "default"}>{c.active ? "Active" : "Inactive"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
