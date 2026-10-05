"use client";

import { useTranslations } from "use-intl";

/**
 * The facts about a car as small labels. A class spans several cars, so it can give
 * every transmission and fuel it has and a range of seats. Works in server and client components.
 */
export function VehicleSpecs({
  category,
  transmission,
  fuelType,
  seats,
  transmissions,
  fuelTypes,
  seatsMin,
  seatsMax,
}: {
  category: string | null;
  transmission: string | null;
  fuelType: string | null;
  seats: number | null;
  transmissions?: string[];
  fuelTypes?: string[];
  seatsMin?: number | null;
  seatsMax?: number | null;
}) {
  const t = useTranslations();
  const labels: string[] = [];

  const add = (group: string, value: string | null) => {
    if (!value) return;
    const key = `enums.${group}.${value}`;

    labels.push(t.has(key) ? t(key) : value);
  };

  add("category", category);

  for (const value of transmissions?.length ? transmissions : [transmission]) add("transmission", value);
  for (const value of fuelTypes?.length ? fuelTypes : [fuelType]) add("fuel", value);

  if (seatsMin && seatsMax && seatsMin !== seatsMax) {
    labels.push(t("vehicles.seatsRange", { min: seatsMin, max: seatsMax }));
  } else if (seatsMax ?? seats) {
    labels.push(t("vehicles.seats", { count: (seatsMax ?? seats) as number }));
  }

  if (labels.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li key={label} className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink-secondary">
          {label}
        </li>
      ))}
    </ul>
  );
}
