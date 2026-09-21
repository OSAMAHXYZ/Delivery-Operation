import type { AppRules, BackOrder, ColorEntry, MatchCandidate, Vehicle } from "@/types";

const WEIGHTS = {
  product: 30,
  modelYear: 20,
  suffix: 15,
  exteriorColor: 20,
  interiorColor: 15,
};

export function normalizeColor(value: string, dictionary: ColorEntry[]) {
  const cleaned = value.trim().toLowerCase();
  const hit = dictionary.find(
    (c) =>
      c.active &&
      (c.sourceColor.toLowerCase() === cleaned ||
        c.standardColor.toLowerCase() === cleaned ||
        c.toyotaCode.toLowerCase() === cleaned),
  );
  return hit?.standardColor.toLowerCase() ?? cleaned;
}

export function scoreMatch(
  bo: BackOrder,
  vehicle: Vehicle,
  dictionary: ColorEntry[],
): { score: number; breakdown: Record<string, boolean> } {
  const breakdown = {
    product: bo.product.toLowerCase() === vehicle.product.toLowerCase(),
    modelYear: bo.modelYear === vehicle.modelYear,
    suffix: bo.suffix.toLowerCase() === vehicle.suffix.toLowerCase(),
    exteriorColor:
      normalizeColor(bo.exteriorColor, dictionary.filter((c) => c.kind === "EXTERIOR")) ===
      normalizeColor(vehicle.exteriorColor, dictionary.filter((c) => c.kind === "EXTERIOR")),
    interiorColor:
      normalizeColor(bo.interiorColor, dictionary.filter((c) => c.kind === "INTERIOR")) ===
      normalizeColor(vehicle.interiorColor, dictionary.filter((c) => c.kind === "INTERIOR")),
  };

  const score = Object.entries(breakdown).reduce((sum, [key, ok]) => {
    return sum + (ok ? WEIGHTS[key as keyof typeof WEIGHTS] : 0);
  }, 0);

  return { score, breakdown };
}

export function findMatches(
  bo: BackOrder,
  vehicles: Vehicle[],
  dictionary: ColorEntry[],
  minScore = 60,
): MatchCandidate[] {
  return vehicles
    .filter((v) => v.status === "FREE" || v.status === "RESERVED")
    .map((vehicle) => {
      const { score, breakdown } = scoreMatch(bo, vehicle, dictionary);
      return {
        vehicleId: vehicle.id,
        vin: vehicle.vin,
        score,
        breakdown,
        location: vehicle.location,
      };
    })
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

export function queuePriority(bo: BackOrder, matchScore: number, rules: AppRules) {
  const w = rules.allocationWeights;
  const payment = bo.paymentStatus === "PAID" ? 100 : bo.paymentStatus === "PARTIAL" ? 50 : 0;
  const aging = Math.min(100, bo.agingDays * 2);
  const fast = bo.fastProduct ? 100 : 40;
  const confirmation = bo.confirmationStatus === "CONFIRMED" ? 100 : bo.confirmationStatus === "PENDING" ? 50 : 0;
  return (
    (payment * w.payment +
      aging * w.aging +
      fast * w.fastProduct +
      confirmation * w.confirmation +
      matchScore * w.matchScore) /
    (w.payment + w.aging + w.fastProduct + w.confirmation + w.matchScore)
  );
}

export function qualityResult(score: number, rules: AppRules) {
  if (score >= rules.qualityThresholds.compliant) return "Compliant";
  if (score >= rules.qualityThresholds.minor) return "Minor Issues";
  if (score >= rules.qualityThresholds.needsCorrection) return "Needs Correction";
  return "Non-Compliant";
}
