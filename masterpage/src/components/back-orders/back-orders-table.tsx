"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { demoStore } from "@/lib/demo-store";
import { findMatches } from "@/services/matching";
import type { BackOrder } from "@/types";

export function BackOrdersTable({
  orders,
  initialPayment,
  initialStatus,
  initialFast,
}: {
  orders: BackOrder[];
  initialPayment?: BackOrder["paymentStatus"];
  initialStatus?: BackOrder["status"];
  initialFast?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BackOrder | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter((b) => {
      const matchesSearch =
        !q ||
        b.boNumber.toLowerCase().includes(q) ||
        b.customer.toLowerCase().includes(q) ||
        b.salesman.toLowerCase().includes(q);
      const matchesPayment = !initialPayment || b.paymentStatus === initialPayment;
      const matchesStatus = !initialStatus || b.status === initialStatus;
      const matchesFast = initialFast === undefined || b.fastProduct === initialFast;
      return matchesSearch && matchesPayment && matchesStatus && matchesFast;
    });
  }, [orders, search, initialPayment, initialStatus, initialFast]);

  return (
    <>
      <div className="mb-4">
        <Input placeholder="Search BO, customer, salesman" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {[
                "BO Number",
                "Customer",
                "Salesman",
                "Product",
                "Aging",
                "Payment",
                "Confirmation",
                "VIN",
                "Quality",
                "Status",
                "Actions",
              ].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold">{b.boNumber}</td>
                <td className="px-4 py-3">{b.customer}</td>
                <td className="px-4 py-3">{b.salesman}</td>
                <td className="px-4 py-3">{b.product}</td>
                <td className="px-4 py-3">{b.agingDays}d</td>
                <td className="px-4 py-3">
                  <Badge variant={b.paymentStatus === "PAID" ? "success" : "warning"}>{b.paymentStatus}</Badge>
                </td>
                <td className="px-4 py-3">{b.confirmationStatus}</td>
                <td className="px-4 py-3 font-mono text-xs">{b.vin ?? "—"}</td>
                <td className="px-4 py-3">{b.qualityScore != null ? `${b.qualityScore}%` : "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant={b.status === "CANCELLED" ? "danger" : "default"}>{b.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setSelected(b)}>
                      View
                    </Button>
                    <Button size="sm" variant="ghost">
                      Audit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <MatchPanel order={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

function MatchPanel({ order, onClose }: { order: BackOrder; onClose: () => void }) {
  const matches = findMatches(order, demoStore.getVehicles(), demoStore.getColors());

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-slate-500">Matching VINs</p>
            <h2 className="text-lg font-bold">{order.boNumber}</h2>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="space-y-3">
          {matches.length ? (
            matches.map((m) => (
              <div key={m.vehicleId} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm">{m.vin}</p>
                  <Badge variant="success">{m.score}%</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">{m.location}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(m.breakdown).map(([k, ok]) => (
                    <Badge key={k} variant={ok ? "success" : "danger"}>
                      {k}
                    </Badge>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No recommended vehicles above threshold.</p>
          )}
        </div>
      </div>
    </div>
  );
}
