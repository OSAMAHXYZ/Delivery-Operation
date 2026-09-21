"use client";

import { useMemo, useState } from "react";
import { VehicleDrawer } from "@/components/stock/vehicle-drawer";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import type { Vehicle, VehicleStatus } from "@/types";

export function StockTable({
  vehicles,
  initialStatus,
}: {
  vehicles: Vehicle[];
  initialStatus?: VehicleStatus;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(initialStatus ?? "");
  const [selected, setSelected] = useState<Vehicle | null>(null);

  const filtered = useMemo(() => {
    return vehicles.filter((v) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        v.vin.toLowerCase().includes(q) ||
        v.product.toLowerCase().includes(q) ||
        v.location.toLowerCase().includes(q);
      const matchesStatus = !status || v.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, status]);

  return (
    <>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Input placeholder="Search VIN or product" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {(["FREE", "RESERVED", "ALLOCATED", "SOLD"] as VehicleStatus[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {["VIN", "Product", "Year", "Suffix", "Exterior", "Interior", "Location", "Status", "Matched BO", "Score"].map(
                (h) => (
                  <th key={h} className="px-4 py-3 font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr
                key={v.id}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => setSelected(v)}
              >
                <td className="px-4 py-3 font-mono text-xs">{v.vin}</td>
                <td className="px-4 py-3">{v.product}</td>
                <td className="px-4 py-3">{v.modelYear}</td>
                <td className="px-4 py-3">{v.suffix}</td>
                <td className="px-4 py-3">{v.exteriorColor}</td>
                <td className="px-4 py-3">{v.interiorColor}</td>
                <td className="px-4 py-3">{v.location}</td>
                <td className="px-4 py-3">
                  <Badge variant={v.status === "FREE" ? "success" : "info"}>{v.status}</Badge>
                </td>
                <td className="px-4 py-3">{v.matchedBoNumber ?? "—"}</td>
                <td className="px-4 py-3">{v.matchScore != null ? `${v.matchScore}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <VehicleDrawer vehicle={selected} onClose={() => setSelected(null)} />
    </>
  );
}
