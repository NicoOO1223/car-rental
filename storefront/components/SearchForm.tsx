"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";

import type { PublicLocation } from "@shared/publicApi";
import { TIME_SLOTS, addDays, instantToZoned, zonedToInstant } from "@shared/time";

import { formatSlot } from "@/lib/format";
import { searchHref, type SearchValues } from "@/lib/search";

const field =
  "mt-1.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";

/** Where, and from when to when. Sends the visitor on to the booking steps. */
export function SearchForm({
  language,
  locations,
  minLeadHours,
  initial,
}: {
  language: string;
  locations: PublicLocation[];
  minLeadHours: number;
  initial?: SearchValues;
}) {
  const t = useTranslations("search");
  const router = useRouter();

  const zoneOf = (id: string) => locations.find((location) => location.id === id)?.timezone ?? "UTC";
  const firstPlace = locations[0]?.id ?? "";

  const [pickupPlace, setPickupPlace] = useState(initial?.pickup ?? firstPlace);
  const [returnPlace, setReturnPlace] = useState(initial?.return ?? firstPlace);
  const [elsewhere, setElsewhere] = useState(Boolean(initial && initial.pickup !== initial.return));

  const [defaults] = useState(() => {
    const earliest = instantToZoned(new Date(Date.now() + minLeadHours * 3_600_000), zoneOf(firstPlace)).date;
    const start = addDays(earliest, 1);

    return { from: start, to: addDays(start, 3) };
  });

  const [pickupDate, setPickupDate] = useState(initial?.from.split("T")[0] ?? defaults.from);
  const [pickupTime, setPickupTime] = useState(initial?.from.split("T")[1] ?? "10:00");
  const [returnDate, setReturnDate] = useState(initial?.to.split("T")[0] ?? defaults.to);
  const [returnTime, setReturnTime] = useState(initial?.to.split("T")[1] ?? "10:00");
  const [error, setError] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const dropPlace = elsewhere ? returnPlace : pickupPlace;
    const pickupAt = new Date(zonedToInstant(pickupDate, pickupTime, zoneOf(pickupPlace)));
    const returnAt = new Date(zonedToInstant(returnDate, returnTime, zoneOf(dropPlace)));

    if (returnAt <= pickupAt) {
      setError(t("returnBeforePickup"));
      return;
    }

    if (pickupAt.getTime() < Date.now() + minLeadHours * 3_600_000) {
      setError(t("tooSoon", { hours: minLeadHours }));
      return;
    }

    setError("");
    router.push(
      searchHref(language, {
        pickup: pickupPlace,
        return: dropPlace,
        from: `${pickupDate}T${pickupTime}`,
        to: `${returnDate}T${returnTime}`,
      }),
    );
  }

  const places = (
    <>
      {locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.airport_code} — {location.name}
        </option>
      ))}
    </>
  );

  const today = instantToZoned(new Date(), zoneOf(pickupPlace)).date;

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">{t("title")}</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t("pickupPlace")}
          <select
            value={pickupPlace}
            onChange={(event) => setPickupPlace(event.target.value)}
            className={field}
            required
          >
            {places}
          </select>
        </label>

        {elsewhere ? (
          <label className="block text-sm font-medium">
            {t("returnPlace")}
            <select
              value={returnPlace}
              onChange={(event) => setReturnPlace(event.target.value)}
              className={field}
              required
            >
              {places}
            </select>
          </label>
        ) : (
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={elsewhere}
                onChange={(event) => {
                  setElsewhere(event.target.checked);
                  setReturnPlace(pickupPlace);
                }}
                className="h-4 w-4 accent-gray-900"
              />
              {t("returnElsewhere")}
            </label>
          </div>
        )}

        <label className="block text-sm font-medium">
          {t("pickupDate")}
          <input
            type="date"
            value={pickupDate}
            min={today}
            onChange={(event) => setPickupDate(event.target.value)}
            className={field}
            required
          />
        </label>

        <label className="block text-sm font-medium">
          {t("pickupTime")}
          <select value={pickupTime} onChange={(event) => setPickupTime(event.target.value)} className={field}>
            {TIME_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {formatSlot(slot, language)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          {t("returnDate")}
          <input
            type="date"
            value={returnDate}
            min={pickupDate}
            onChange={(event) => setReturnDate(event.target.value)}
            className={field}
            required
          />
        </label>

        <label className="block text-sm font-medium">
          {t("returnTime")}
          <select value={returnTime} onChange={(event) => setReturnTime(event.target.value)} className={field}>
            {TIME_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {formatSlot(slot, language)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!firstPlace}
        className="mt-5 w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {t("submit")}
      </button>
    </form>
  );
}
