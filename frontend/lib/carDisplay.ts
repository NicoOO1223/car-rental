import {
  Cog,
  Fuel,
  GaugeCircle,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Presentation helpers for a vehicle.
 *
 * These exist because category, transmission, fuel_type and seats are all
 * nullable free-text columns, and the booking page used to interpolate
 * them straight into a template string. A car with no category rendered
 * the literal text "null · MANUAL · PETROL · 4 seats". Everything here
 * either returns a clean label or nothing at all, so a missing value
 * disappears rather than showing up as a defect.
 */

const CATEGORY_LABELS: Record<string, string> = {
  ECONOMY: "Economy",
  COMPACT: "Compact",
  MIDSIZE: "Midsize",
  PREMIUM: "Premium",
  SUV: "SUV",
  VAN: "Van",
};

const TRANSMISSION_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  AUTOMATIC: "Automatic",
};

const FUEL_LABELS: Record<string, string> = {
  PETROL: "Petrol",
  DIESEL: "Diesel",
  HYBRID: "Hybrid",
  ELECTRIC: "Electric",
};

/** Title-cases an unrecognised enum value rather than shouting it. */
function humanize(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category] ?? humanize(category);
}

export function transmissionLabel(transmission: string | null): string | null {
  if (!transmission) return null;
  return TRANSMISSION_LABELS[transmission] ?? humanize(transmission);
}

export function fuelLabel(fuelType: string | null): string | null {
  if (!fuelType) return null;
  return FUEL_LABELS[fuelType] ?? humanize(fuelType);
}

export type Spec = {
  icon: LucideIcon;
  label: string;
};

/**
 * The spec chips shown on a vehicle card, with anything unknown omitted
 * rather than rendered as a gap or a null.
 */
export function carSpecs(car: {
  category: string | null;
  transmission: string | null;
  fuel_type: string | null;
  seats: number | null;
}): Spec[] {
  const specs: Spec[] = [];

  const category = categoryLabel(car.category);
  if (category) {
    specs.push({ icon: GaugeCircle, label: category });
  }

  const transmission = transmissionLabel(car.transmission);
  if (transmission) {
    specs.push({ icon: Cog, label: transmission });
  }

  const fuel = fuelLabel(car.fuel_type);
  if (fuel) {
    specs.push({
      icon: car.fuel_type === "ELECTRIC" ? Zap : Fuel,
      label: fuel,
    });
  }

  if (car.seats) {
    specs.push({
      icon: Users,
      label: `${car.seats} seats`,
    });
  }

  return specs;
}
