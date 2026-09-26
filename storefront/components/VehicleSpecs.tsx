"use client";

import { useTranslations } from "use-intl";

/** The facts about a car as small labels. Works in server and client components. */
export function VehicleSpecs({
  category,
  transmission,
  fuelType,
  seats,
}: {
  category: string | null;
  transmission: string | null;
  fuelType: string | null;
  seats: number | null;
}) {
  const t = useTranslations();
  const labels: string[] = [];

  const add = (group: string, value: string | null) => {
    if (!value) return;
    const key = `enums.${group}.${value}`;

    labels.push(t.has(key) ? t(key) : value);
  };

  add("category", category);
  add("transmission", transmission);
  add("fuel", fuelType);

  if (seats) labels.push(t("vehicles.seats", { count: seats }));

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
