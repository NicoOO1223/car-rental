"use client";

import { CalendarDays, MapPin, Pencil, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { enGB, it, pl } from "react-day-picker/locale";
import { useTranslations } from "use-intl";

import type { PublicLocation } from "@shared/publicApi";
import { TIME_SLOTS, addDays, instantToZoned, zonedToInstant } from "@shared/time";

import { PlaceSelect, type PlaceOption } from "@/components/PlaceSelect";
import { formatSlot } from "@/lib/format";
import { searchHref, type SearchValues } from "@/lib/search";

const LOCALES = { en: enGB, it, pl } as const;

const cell =
  "group flex min-w-0 flex-1 flex-col justify-center rounded-xl px-3.5 py-4 text-left transition-colors hover:bg-surface-sunken focus-within:bg-surface-sunken";
const cellLabel = "flex items-center gap-1.5 text-xs font-medium text-ink-muted";
const cellValue = "mt-1 w-full truncate bg-transparent text-[15px] font-semibold text-ink focus:outline-none";

const toDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(year, month - 1, day);
};

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * Where, and from when to when. This is the core of the home page, so it
 * stays in reach: it floats over the bottom of the photo and, once scrolled
 * past, sticks to the top of the screen. Sends the visitor on to the booking steps.
 */
export function SearchForm({
  language,
  locations,
  minLeadHours,
  manageHref,
  initial,
}: {
  language: string;
  locations: PublicLocation[];
  minLeadHours: number;
  /** Where "Manage bookings" goes: the account when signed in, else the lookup. */
  manageHref: string;
  initial?: SearchValues;
}) {
  const t = useTranslations("search");
  const all = useTranslations();
  const router = useRouter();
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const datesId = useId();

  const zoneOf = (id: string) => locations.find((location) => location.id === id)?.timezone ?? "UTC";
  const firstPlace = locations[0]?.id ?? "";

  const [pickupPlace, setPickupPlace] = useState(initial?.pickup ?? firstPlace);
  const [returnPlace, setReturnPlace] = useState(initial?.return ?? firstPlace);
  // Until the visitor picks a different return place, it follows the pickup.
  const [returnTouched, setReturnTouched] = useState(Boolean(initial && initial.pickup !== initial.return));

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

  const [calendarOpen, setCalendarOpen] = useState(false);
  // Which end the next click on the calendar sets.
  const [picking, setPicking] = useState<"from" | "to">("from");
  const [twoMonths, setTwoMonths] = useState(true);

  const [stuck, setStuck] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // "Stuck" = the bar has reached the top of the screen. The spacer above it
  // (as tall as the navbar) has then scrolled out of view.
  useEffect(() => {
    const marker = sentinel.current;

    if (!marker) return;

    const observer = new IntersectionObserver(([entry]) =>
      setStuck(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0),
    );

    observer.observe(marker);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setTwoMonths(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!calendarOpen) return;

    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setCalendarOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setCalendarOpen(false);
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [calendarOpen]);

  const today = instantToZoned(new Date(), zoneOf(pickupPlace)).date;
  const locale = LOCALES[language as keyof typeof LOCALES] ?? enGB;

  const dateLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric", month: "short" });

    return (value: string) => formatter.format(toDate(value));
  }, [language]);

  function openCalendar(end: "from" | "to") {
    setPicking(end);
    setCalendarOpen(true);
  }

  function chooseDay(day: Date) {
    const iso = toIso(day);

    if (picking === "from" || iso < pickupDate) {
      setPickupDate(iso);
      // Keep the return after the new pickup.
      if (returnDate < iso || picking === "from") setReturnDate(iso);
      setPicking("to");
    } else {
      setReturnDate(iso);
      setPicking("from");
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const dropPlace = returnTouched ? returnPlace : pickupPlace;
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

  const placeOptions: PlaceOption[] = locations.map((location) => ({
    value: location.id,
    label: location.name,
    hint: location.airport_code,
  }));

  const placeName = (id: string) => locations.find((location) => location.id === id)?.airport_code ?? "";
  const shownReturnPlace = returnTouched ? returnPlace : pickupPlace;

  // On small screens a stuck bar would cover the page, so it shrinks to one
  // summary line that opens the full form again.
  const compact = stuck && !expanded;

  return (
    <>
      {/* Leaves room for the transparent navbar above the bar. */}
      <div ref={sentinel} aria-hidden="true" className="h-20" />

      <div
        ref={root}
        className={`sticky top-0 z-40 px-4 pb-2 sm:px-6 ${stuck ? "pt-2" : ""}`}
      >
        <form
          onSubmit={handleSubmit}
          aria-label={t("title")}
          className={`relative mx-auto max-w-[77rem] bg-surface p-3 shadow-xl ring-1 ring-black/5 rounded-2xl`}
        >
          {compact && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t("edit")}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left lg:hidden"
            >
              <span className="min-w-0 truncate text-sm font-semibold">
                {placeName(pickupPlace)} → {placeName(shownReturnPlace)} · {dateLabel(pickupDate)} – {dateLabel(returnDate)}
              </span>
              <Pencil className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </button>
          )}

          <div className={`${compact ? "hidden lg:flex" : "flex"} items-center justify-between gap-4 px-4 pb-1 pt-1`}>
            <p className="text-sm font-semibold text-ink">{t("title")}</p>

            <Link
              href={manageHref}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-secondary underline-offset-4 hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            >
              {t("manageLink")}
            </Link>
          </div>

          <div className={`${compact ? "hidden lg:flex" : "flex"} flex-col gap-1 lg:flex-row lg:items-stretch lg:gap-0.5`}>
            <PlaceSelect
              label={t("pickupPlace")}
              icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
              value={pickupPlace}
              options={placeOptions}
              onChange={setPickupPlace}
              onOpen={() => setCalendarOpen(false)}
              className="lg:flex-[1.25]"
            />

            <PlaceSelect
              label={t("returnPlace")}
              icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
              value={shownReturnPlace}
              options={placeOptions}
              onChange={(value) => {
                setReturnTouched(true);
                setReturnPlace(value);
              }}
              onOpen={() => setCalendarOpen(false)}
              className="lg:flex-[1.25]"
            />

            <button
              type="button"
              onClick={() => openCalendar("from")}
              aria-expanded={calendarOpen}
              aria-controls={datesId}
              className={`${cell} cursor-pointer ${calendarOpen && picking === "from" ? "bg-surface-sunken" : ""}`}
            >
              <span className={cellLabel}>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {t("pickupDate")}
              </span>
              <span className={cellValue}>
                {dateLabel(pickupDate)} · {formatSlot(pickupTime, language)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openCalendar("to")}
              aria-expanded={calendarOpen}
              aria-controls={datesId}
              className={`${cell} cursor-pointer ${calendarOpen && picking === "to" ? "bg-surface-sunken" : ""}`}
            >
              <span className={cellLabel}>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {t("returnDate")}
              </span>
              <span className={cellValue}>
                {dateLabel(returnDate)} · {formatSlot(returnTime, language)}
              </span>
            </button>

            <button
              type="submit"
              disabled={!firstPlace}
              className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-12 py-3 text-base font-semibold text-white lg:self-center hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:opacity-50 lg:mt-0 lg:ml-1"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {t("submit")}
            </button>
          </div>

          {calendarOpen && !compact && (
            <div
              id={datesId}
              role="dialog"
              aria-label={t("datesTitle")}
              className="absolute inset-x-0 top-full z-50 mt-2 w-full overflow-x-auto rounded-2xl border border-border-subtle bg-surface p-4 shadow-2xl lg:left-auto lg:right-0 lg:w-auto"
            >
              <p className="mb-2 text-sm font-medium text-ink-secondary" aria-live="polite">
                {picking === "to" ? t("chooseReturn") : t("datesTitle")}
              </p>

              <div className="flex justify-center">
                <DayPicker
                  mode="range"
                  locale={locale}
                  weekStartsOn={1}
                  numberOfMonths={twoMonths ? 2 : 1}
                  defaultMonth={toDate(pickupDate)}
                  startMonth={toDate(today)}
                  disabled={{ before: toDate(today) }}
                  selected={{ from: toDate(pickupDate), to: toDate(returnDate) }}
                  onDayClick={chooseDay}
                  labels={{
                    labelPrevious: () => t("previousMonth"),
                    labelNext: () => t("nextMonth"),
                  }}
                />
              </div>

              <div className="mt-3 grid gap-3 border-t border-border-subtle pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="block text-xs font-medium text-ink-muted">
                  {t("pickupTime")}
                  <select
                    value={pickupTime}
                    onChange={(event) => setPickupTime(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink"
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {formatSlot(slot, language)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-ink-muted">
                  {t("returnTime")}
                  <select
                    value={returnTime}
                    onChange={(event) => setReturnTime(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink"
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {formatSlot(slot, language)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => setCalendarOpen(false)}
                  className="rounded-lg border border-border-strong px-5 py-2 text-sm font-medium hover:bg-surface-sunken"
                >
                  {t("done")}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-2 px-3 pb-1 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </>
  );
}
