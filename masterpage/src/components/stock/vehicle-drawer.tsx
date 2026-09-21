"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Vehicle } from "@/types";

export function VehicleDrawer({
  vehicle,
  onClose,
}: {
  vehicle: Vehicle | null;
  onClose: () => void;
}) {
  if (!vehicle) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle</p>
            <h2 className="font-mono text-lg font-bold">{vehicle.vin}</h2>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <CardContent className="space-y-4 p-5">
          <Row label="Product" value={vehicle.product} />
          <Row label="Model Year" value={String(vehicle.modelYear)} />
          <Row label="Suffix" value={vehicle.suffix} />
          <Row label="Exterior" value={`${vehicle.exteriorColor} (${vehicle.exteriorCode})`} />
          <Row label="Interior" value={`${vehicle.interiorColor} (${vehicle.interiorCode})`} />
          <Row label="Location" value={vehicle.location} />
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Status</p>
            <Badge className="mt-1" variant={vehicle.status === "FREE" ? "success" : "info"}>
              {vehicle.status}
            </Badge>
          </div>
          {vehicle.matchedBoNumber ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Matched Back Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-sm">
                <p>{vehicle.matchedBoNumber}</p>
                <p className="text-slate-500">Match score: {vehicle.matchScore ?? "—"}%</p>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
