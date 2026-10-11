"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  ChevronRight,
  Banknote,
  BadgeCheck,
  CalendarClock,
  Check,
  CircleCheck,
  CreditCard,
  Globe,
  KeyRound,
  MapPin,
  ShieldCheck,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { ReservationVehicleCard } from "@/components/reservations/ReservationCards";
import type { Handover, PaymentSummary, Reservation } from "@/lib/api";
import { extraIcon } from "@/lib/extraIcons";
import { extraName } from "@/lib/extras";
import {
  bookingReference,
  formatCurrency,
  formatDate,
  formatDuration,
  formatTime,
  rentalDays,
} from "@/lib/format";
import { t } from "@/lib/i18n";

const CARD = "rounded-2xl border border-border-subtle bg-surface p-5";

/** Whole years from a birth date to today; null when the date cannot be read. */
function ageOn(birth: string): number | null {
  const born = new Date(birth);

  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();

  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) years -= 1;

  return years >= 0 ? years : null;
}

/** A labelled figure on a one-line card: what it is above, its value below, an optional note under. */
function Stat({
  icon: Icon,
  label,
  value,
  note,
  strong = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>

      <dd className={`mt-1 tabular-nums ${strong ? "text-xl font-semibold text-ink" : "text-lg font-semibold text-ink-secondary"}`}>
        {value}
      </dd>

      {note && <p className="text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

/** One end of the rental: when, and where. */
function Leg({
  icon: Icon,
  label,
  at,
  place,
}: {
  icon: LucideIcon;
  label: string;
  at: string;
  place: Reservation["pickup_location"];
}) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-sunken p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </p>

      <p className="mt-2 text-lg font-semibold text-ink">
        {formatDate(at, place.timezone)}
        <span className="font-medium tabular-nums text-ink-secondary"> · {formatTime(at, place.timezone)}</span>
      </p>

      <p className="mt-2.5 flex items-center gap-1.5 text-sm text-ink-secondary">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="rounded bg-surface px-1.5 py-0.5 text-xs font-semibold text-ink">{place.airport_code}</span>
        <span className="truncate">{place.name}</span>
      </p>
    </div>
  );
}

/**
 * What the counter sees once a check-in is finished: the booking in one place,
 * with the agreement to download and the next steps. Everything shown is already
 * loaded by the check-in page; nothing here is fetched or changed.
 */
export function CheckInSummary({
  reservation,
  handover,
  summary,
  onDownload,
  onViewReservation,
  onOpenCustomer,
  onOpenVehicle,
  condition,
}: {
  reservation: Reservation;
  handover: Handover;
  summary: PaymentSummary | null;
  onDownload: () => void;
  onViewReservation: () => void;
  onOpenCustomer: () => void;
  onOpenVehicle: () => void;
  /** The vehicle-condition step (photos), shown at the top of the summary. */
  condition?: ReactNode;
}) {
  const reference = reservation.public_reference ?? bookingReference(reservation.id);
  const customer = reservation.customer;
  const age = ageOn(customer.date_of_birth);
  const verified = Boolean(customer.identity_verification?.verified_at);
  const days = rentalDays(reservation.pickup_at, reservation.return_at, reservation.pickup_location.timezone);

  const currency = (summary?.currency ?? handover.payment_currency ?? undefined)?.toUpperCase();
  const money = (amount: number | string) => formatCurrency(amount, currency);

  const total = summary ? summary.total_amount : reservation.agreed_total_amount;
  const adjustment = Number(reservation.price_adjustment_amount ?? 0);
  const paidOnline = summary?.paid_online ?? 0;
  const paidAtCounter =
    (handover.payment_method === "CASH" || handover.payment_method === "CARD") && handover.payment_amount !== null
      ? handover.payment_amount
      : null;
  const depositHeld = handover.deposit_status === "HELD" && handover.deposit_amount !== null;
  const paidInFull = handover.payment_status === "SUCCEEDED";

  return (
    <div className="space-y-5">
      {/* The finish line, in one band: what happened, the reference, the renter's number and the next steps */}
      <section className="rounded-2xl border border-success-line bg-success-soft p-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success text-surface" aria-hidden="true">
            <Check className="h-5 w-5" />
          </span>

          <div className="min-w-0 flex-1 basis-64">
            {/* The title, with the reference and status on the same line */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h2 className="text-lg font-semibold leading-tight text-ink">{t("s.handovers.id.checkIn.checkComplete")}</h2>

              <span className="inline-flex items-center gap-1 rounded-md bg-surface py-0.5 pl-2 pr-0.5 font-mono text-sm font-medium text-ink">
                {reference}
                <CopyButton
                  value={reference}
                  label={t("c.handover.CheckInSummary.copyReference")}
                  copiedLabel={t("s.reservations.manage.id.copied")}
                />
              </span>

              <ReservationStatusBadge status={reservation.status} />
            </div>

            <p className="mt-1 text-sm text-ink-secondary">{t("s.handovers.id.checkIn.rentalAgreementHasBeen")}</p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button onClick={onDownload}>{t("s.handovers.id.checkIn.downloadAgreement")}</Button>
            <Button variant="secondary" onClick={onViewReservation}>
              {t("s.handovers.id.checkIn.viewReservation")}
            </Button>
          </div>
        </div>
      </section>

      {/* The walk-around photos next to the vehicle they are of */}
      <div className="grid gap-5 lg:grid-cols-2">
        {condition}

        <ReservationVehicleCard
          reservation={reservation}
          canWrite={false}
          onOpenVehicle={onOpenVehicle}
          onConfirmCar={() => undefined}
        />
      </div>

      {/* Who is renting: one row */}
      <section className={CARD}>
        <div className="grid items-center gap-x-5 gap-y-3 lg:grid-cols-[9rem_1fr_auto]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-secondary" aria-hidden="true">
              <UserRound className="h-4 w-4" />
            </span>

            <h2 className="text-base font-semibold">{t("s.reservations.manage.id.customer")}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-base font-semibold leading-tight">
                  <span className="truncate">
                    {customer.first_name} {customer.last_name}
                  </span>
                  <CountryFlag code={customer.nationality} />
                </p>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                  <span>
                    {t("s.reservations.manage.id.bornOn", { date: formatDate(customer.date_of_birth) })}
                    {age !== null && ` · ${age}`}
                  </span>

                  {verified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-medium text-success">
                      <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                      {t("s.reservations.manage.id.idVerified")}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {([
              { key: "email", label: t("s.reservations.manage.id.emailLabel"), value: customer.email, href: `mailto:${customer.email ?? ""}`, copy: t("s.reservations.manage.id.copyEmail") },
              { key: "phone", label: t("s.reservations.manage.id.phoneLabel"), value: customer.phone_number, href: `tel:${customer.phone_number ?? ""}`, copy: t("s.reservations.manage.id.copyPhone") },
            ] as const).map((row) => (
              <div key={row.key} className="min-w-0">
                <p className="text-xs text-ink-muted">{row.label.replace(/:$/, "")}</p>

                <p className="mt-0.5 flex items-center gap-1 text-sm font-medium">
                  {row.value ? (
                    <>
                      <a href={row.href} className="min-w-0 break-all text-ink hover:underline">
                        {row.value}
                      </a>
                      <CopyButton value={row.value} label={row.copy} copiedLabel={t("s.reservations.manage.id.copied")} />
                    </>
                  ) : (
                    <span className="font-normal text-ink-muted">{t("s.reservations.manage.id.notProvided")}</span>
                  )}
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenCustomer}
            className="flex items-center gap-1 justify-self-start rounded-md px-1.5 py-1 text-sm font-medium text-ink-secondary transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink lg:justify-self-end"
          >
            {t("s.reservations.manage.id.viewCustomer")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* What is being rented: one row */}
      <section className={CARD}>
        <div className="grid items-center gap-x-5 gap-y-3 lg:grid-cols-[9rem_minmax(0,17rem)_minmax(5rem,1fr)_minmax(0,17rem)]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-secondary" aria-hidden="true">
              <CalendarClock className="h-4 w-4" />
            </span>

            <h2 className="text-base font-semibold">{t("c.handover.CheckInSummary.rental")}</h2>
          </div>

          <Leg icon={KeyRound} label={t("s.handovers.pickup")} at={reservation.pickup_at} place={reservation.pickup_location} />

          {/* A long arrow from pickup to return, centred between the two, with the length of the rental on it */}
          <div className="hidden min-w-0 items-center lg:flex">
            <div className="relative flex w-full items-center">
              <span className="h-px flex-1 bg-border-strong" aria-hidden="true" />
              <ChevronRight className="-ml-2.5 -mr-2 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />

              {days > 0 && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-secondary ring-1 ring-border-strong">
                  {formatDuration(days)}
                </span>
              )}
            </div>
          </div>

          <Leg icon={CircleCheck} label={t("s.handovers.return")} at={reservation.return_at} place={reservation.return_location} />
        </div>

        {(reservation.source === "STOREFRONT" || reservation.extras.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-3">
            {reservation.source === "STOREFRONT" && (
              <span className="mr-2 inline-flex items-center gap-1.5 text-xs text-ink-muted">
                <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                {t("c.reservations.OnlineBookingCard.bookedOnline")}
              </span>
            )}

            {/* Add-ons as small chips, so they take a line and not a card */}
            {reservation.extras.map((line) => {
              const Icon = extraIcon(line.extra_code, line.name);

              return (
                <span
                  key={line.extra_id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs font-medium text-ink-secondary"
                >
                  <Icon className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
                  {extraName({ code: line.extra_code, name: line.name, translations: line.translations })}
                  {line.quantity > 1 && <span className="text-ink-muted">× {line.quantity}</span>}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* What it comes to: one row */}
      <section className={CARD}>
        <div className="grid items-center gap-x-5 gap-y-4 lg:grid-cols-[9rem_1fr_auto]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-secondary" aria-hidden="true">
              <Wallet className="h-4 w-4" />
            </span>

            <h2 className="text-base font-semibold">{t("c.handover.CheckInSummary.payment")}</h2>
          </div>

          <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] items-start gap-x-6 gap-y-4">
            {total !== null && (
              <Stat
                icon={Wallet}
                strong
                label={t("c.handover.CheckInSummary.total")}
                value={money(total)}
                note={
                  adjustment !== 0
                    ? `${t("c.handover.CheckInSummary.adjustment", { amount: money(adjustment) })}${
                        reservation.price_adjustment_reason ? ` · ${reservation.price_adjustment_reason}` : ""
                      }`
                    : undefined
                }
              />
            )}

            {paidOnline > 0 && (
              <Stat icon={Globe} label={t("c.handover.CheckInSummary.paidOnline")} value={money(paidOnline)} />
            )}

            {paidAtCounter !== null && (
              <Stat
                icon={handover.payment_method === "CASH" ? Banknote : CreditCard}
                label={t("c.handover.CheckInSummary.paidAtCounter", {
                  method: t(handover.payment_method === "CASH" ? "common.cash" : "common.card"),
                })}
                value={money(paidAtCounter)}
              />
            )}

            {depositHeld && (
              <Stat
                icon={ShieldCheck}
                label={t("c.handover.CheckInSummary.depositHeld")}
                value={money(handover.deposit_amount ?? 0)}
                note={handover.deposit_method ? t(handover.deposit_method === "CASH" ? "common.cash" : "common.card") : undefined}
              />
            )}
          </dl>

          {paidInFull && (
            <span className="inline-flex items-center gap-1 justify-self-start rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success lg:justify-self-end">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t("c.handover.CheckInSummary.paidInFull")}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
