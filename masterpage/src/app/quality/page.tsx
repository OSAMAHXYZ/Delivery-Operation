import { AppShell } from "@/components/layout/app-shell";
import { demoStore } from "@/lib/demo-store";

export default function QualityDashboardPage() {
  const audits = demoStore.getAudits();
  const violations = demoStore.getViolations();

  return (
    <AppShell title="Quality Dashboard" subtitle="Audit results and compliance overview">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Audits completed" value={audits.length} />
        <StatCard label="Open violations" value={violations.filter((v) => v.status !== "RESOLVED").length} />
        <StatCard
          label="Average quality score"
          value={`${Math.round(audits.reduce((s, a) => s + a.qualityScore, 0) / audits.length)}%`}
        />
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["BO Number", "Auditor", "Score", "Result", "Date"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{a.boNumber}</td>
                <td className="px-4 py-3">{a.auditor}</td>
                <td className="px-4 py-3">{a.qualityScore}%</td>
                <td className="px-4 py-3">{a.result}</td>
                <td className="px-4 py-3">{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}
