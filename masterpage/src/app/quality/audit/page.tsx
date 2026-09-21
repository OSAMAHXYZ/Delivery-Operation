import { AppShell } from "@/components/layout/app-shell";
import { demoStore } from "@/lib/demo-store";

export default function AuditPage() {
  const rules = demoStore.getAuditRules();

  return (
    <AppShell title="Quality Audit" subtitle="Rules R1–R13 with evidence and corrective actions">
      <div className="grid gap-3">
        {rules.map((rule) => (
          <div key={rule.code} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#EB0A1E]">{rule.code}</p>
                <h3 className="font-bold text-slate-900">{rule.name}</h3>
                <p className="text-sm text-slate-500">{rule.description}</p>
              </div>
              <div className="grid min-w-[280px] gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" /> Applicable
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" /> Compliant
                </label>
                <input className="rounded-lg border px-3 py-2" placeholder="Evidence / Notes" />
                <input className="rounded-lg border px-3 py-2" placeholder="Corrective action" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
