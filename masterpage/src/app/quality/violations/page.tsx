import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { demoStore } from "@/lib/demo-store";

export default function ViolationsPage() {
  const violations = demoStore.getViolations();

  return (
    <AppShell title="Confirmed Violations" subtitle="Open quality violations with severity and ownership">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {[
                "BO Number",
                "Rule",
                "Description",
                "Owner",
                "Due Date",
                "Status",
                "Severity",
              ].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {violations.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{v.boNumber}</td>
                <td className="px-4 py-3">{v.ruleCode}</td>
                <td className="px-4 py-3">{v.description}</td>
                <td className="px-4 py-3">{v.owner}</td>
                <td className="px-4 py-3">{v.dueDate}</td>
                <td className="px-4 py-3">
                  <Badge variant={v.status === "RESOLVED" ? "success" : v.status === "OVERDUE" ? "danger" : "warning"}>
                    {v.status}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={v.severity === "high" ? "danger" : "warning"}>{v.severity}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
