"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { demoStore } from "@/lib/demo-store";
import type { AppRules } from "@/types";

export default function RulesSetupPage() {
  const [rules, setRules] = useState(demoStore.getRules());

  function updateThreshold(key: keyof AppRules["qualityThresholds"], value: number) {
    const next = {
      ...rules,
      qualityThresholds: { ...rules.qualityThresholds, [key]: value },
    };
    setRules(next);
    demoStore.setRules(next);
  }

  return (
    <AppShell title="Rules & Setup" subtitle="Configurable quality thresholds and allocation weights">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-bold">Quality thresholds</h2>
          <div className="space-y-3">
            {Object.entries(rules.qualityThresholds).map(([key, value]) => (
              <label key={key} className="block text-sm">
                <span className="mb-1 block capitalize text-slate-600">{key}</span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2"
                  value={value}
                  onChange={(e) =>
                    updateThreshold(key as keyof AppRules["qualityThresholds"], Number(e.target.value))
                  }
                />
              </label>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-bold">Allocation weights</h2>
          <div className="space-y-3">
            {Object.entries(rules.allocationWeights).map(([key, value]) => (
              <label key={key} className="block text-sm">
                <span className="mb-1 block capitalize text-slate-600">{key}</span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2"
                  value={value}
                  readOnly
                />
              </label>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rules.autoAllocate} readOnly />
            Auto allocate VIN (disabled by business rule)
          </label>
          <Button className="mt-4">Save rules</Button>
        </section>
      </div>
    </AppShell>
  );
}
