import {
  Cog,
  Fuel,
  GaugeCircle,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { enumLabel, t } from "@/lib/i18n";

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

export function categoryLabel(category: string | null): string | null {
  return category ? enumLabel("carCategory", category) : null;
}

export function transmissionLabel(transmission: string | null): string | null {
  return transmission ? enumLabel("transmission", transmission) : null;
}

export function fuelLabel(fuelType: string | null): string | null {
  return fuelType ? enumLabel("fuel", fuelType) : null;
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
      label: t("vehicle.seats", { count: car.seats }),
    });
  }

  return specs;
}

/** The choices a vehicle's category, gearbox and fuel can take (the server checks the same lists). */
export const CATEGORY_OPTIONS = ["ECONOMY", "COMPACT", "MIDSIZE", "PREMIUM", "SUV", "VAN"];
export const TRANSMISSION_OPTIONS = ["MANUAL", "AUTOMATIC"];
export const FUEL_OPTIONS = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"];
