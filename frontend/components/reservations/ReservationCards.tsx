"use client";

import { ArrowRight, BadgeCheck, Car, Package, UserRound } from "lucide-react";

import { CarImage } from "@/components/cars/CarImage";
import { CopyButton } from "@/components/ui/CopyButton";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { carPhotoUrl, type Reservation } from "@/lib/api";
import { carSpecs } from "@/lib/carDisplay";
import { classWords } from "@/lib/classDisplay";
import { extraIcon } from "@/lib/extraIcons";
import { extraName } from "@/lib/extras";
import { formatCurrency, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

const CARD = "rounded-2xl border border-border-subtle bg-surface p-5";

/** A card's title row: an icon in a soft tile, the title, and one quiet action on the right. */
function CardHeader({
  icon: Icon,
  title,
  aside,
}: {
  icon: typeof UserRound;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-base font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-sunken text-ink-secondary" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        {title}
      </h2>
      {aside}
    </div>
  );
}

function LinkAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-ink-secondary transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
    >
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function ageOn(birth: string): number | null {
  const born = new Date(birth);

  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();

  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) years -= 1;

  return years >= 0 ? years : null;
}

/** Who is renting: name, the ways to reach them (each one tap to call, write or copy), and where they live. */
export function ReservationCustomerCard({
  reservation,
  onOpenCustomer,
}: {
  reservation: Reservation;
  onOpenCustomer: () => void;
}) {
  const customer = reservation.customer;
  const fullName = `${customer.first_name} ${customer.last_name}`;
  const age = ageOn(customer.date_of_birth);
  const verified = Boolean(customer.identity_verification?.verified_at);

  // Email and phone are always listed, so a missing one reads as missing rather than as a bug.
  const contact: { key: string; label: string; value: string | null; href: string; copy: string }[] = [
    {
      key: "email",
      label: t("s.reservations.manage.id.emailLabel"),
      value: customer.email,
      href: `mailto:${customer.email ?? ""}`,
      copy: t("s.reservations.manage.id.copyEmail"),
    },
    {
      key: "phone",
      label: t("s.reservations.manage.id.phoneLabel"),
      value: customer.phone_number,
      href: `tel:${customer.phone_number ?? ""}`,
      copy: t("s.reservations.manage.id.copyPhone"),
    },
  ];

  return (
    <section className={CARD}>
      <CardHeader
        icon={UserRound}
        title={t("s.reservations.manage.id.customer")}
        aside={<LinkAction label={t("s.reservations.manage.id.viewCustomer")} onClick={onOpenCustomer} />}
      />

      <div className="mt-4 flex items-center gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-base font-semibold text-accent-ink"
          aria-hidden="true"
        >
          {customer.first_name.charAt(0)}
          {customer.last_name.charAt(0)}
        </div>

        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold leading-tight">
            <span className="truncate">{fullName}</span>
            <CountryFlag code={customer.nationality} />
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span>
              {t("s.reservations.manage.id.bornOn", { date: formatDate(customer.date_of_birth) })}
              {age !== null && ` · ${age}`}
            </span>

            {verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                {t("s.reservations.manage.id.idVerified")}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3">
        {/* Phone and email each get a line of their own, so either one reads and copies cleanly. */}
        <div className="flex flex-col gap-1.5 text-xs">
          {contact.map((row) => (
            <div key={row.key} className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-ink-muted">{row.label}</span>

              {row.value ? (
                <>
                  <a
                    href={row.href}
                    className="min-w-0 break-all font-medium text-ink-secondary hover:text-ink hover:underline"
                  >
                    {row.value}
                  </a>
                  <CopyButton value={row.value} label={row.copy} copiedLabel={t("s.reservations.manage.id.copied")} />
                </>
              ) : (
                <span className="text-ink-muted">{t("s.reservations.manage.id.notProvided")}</span>
              )}
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}

/** Which car: its photo, what kind of car it is, and whether it is final for a class booking. */
export function ReservationVehicleCard({
  reservation,
  canWrite,
  onOpenVehicle,
  onConfirmCar,
}: {
  reservation: Reservation;
  canWrite: boolean;
  onOpenVehicle: () => void;
  onConfirmCar: () => void;
}) {
  const car = reservation.car;
  const specs = carSpecs(car);
  const mayConfirm = canWrite && ["PENDING", "CONFIRMED", "AWAITING_PAYMENT"].includes(reservation.status);

  return (
    <section className={CARD}>
      <CardHeader
        icon={Car}
        title={t("s.reservations.manage.id.vehicle")}
        aside={<LinkAction label={t("s.reservations.manage.id.viewVehicle")} onClick={onOpenVehicle} />}
      />

      <div className="mt-4 flex gap-4">
        <CarImage
          imageUrl={car.has_photo ? carPhotoUrl(car.id, car.photo_version) : null}
          category={car.category}
          alt={`${car.make} ${car.model}`}
          className="aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-xl"
        />

        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">
            {car.make} {car.model}
          </p>

          <p className="mt-1.5 inline-block rounded-md border border-border-strong bg-surface px-2 py-0.5 font-mono text-sm font-medium tracking-wide text-ink">
            {car.license_plate}
          </p>

          {reservation.vehicle_class && (
            <p className="mt-1.5 text-sm text-ink-muted">
              {t("s.reservations.manage.id.bookedClass", { class: classWords(reservation.vehicle_class.name) })}
            </p>
          )}
        </div>
      </div>

      {specs.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {specs.map((spec) => (
            <li
              key={spec.label}
              className="inline-flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs font-medium text-ink-secondary"
            >
              <spec.icon className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
              {spec.label}
            </li>
          ))}
        </ul>
      )}

      {!reservation.car_confirmed && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <p className="font-medium">{t("s.reservations.manage.id.carNotFinal")}</p>

          {mayConfirm && (
            <button
              type="button"
              onClick={onConfirmCar}
              className="shrink-0 rounded-md border border-warning-line bg-surface px-2.5 py-1 text-xs font-semibold hover:bg-warning-line focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
            >
              {t("s.reservations.manage.id.confirmThisCar")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The add-ons: an icon, what and how many, how it is priced, and what each line comes to. */
export function ReservationExtrasCard({ reservation, rentalDays }: { reservation: Reservation; rentalDays: number }) {
  const lines = reservation.extras.map((line) => {
    const each = Number(line.unit_price);
    const days = line.price_unit === "PER_DAY" ? rentalDays : 1;

    return { line, each, total: each * line.quantity * days };
  });
  const total = lines.reduce((sum, row) => sum + row.total, 0);

  return (
    <section className={CARD}>
      <CardHeader
        icon={Package}
        title={t("s.reservations.manage.id.extras")}
        aside={
          <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
            {t("s.reservations.manage.id.extrasCount", { count: lines.length })}
          </span>
        }
      />

      <ul className="mt-4 divide-y divide-border-subtle">
        {lines.map(({ line, each, total: lineTotal }) => {
          const name = extraName({ code: line.extra_code, name: line.name, translations: line.translations });
          const Icon = extraIcon(line.extra_code, line.name);

          return (
            <li key={line.extra_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-secondary"
                aria-hidden="true"
              >
                <Icon className="h-4.5 w-4.5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {name}
                  {line.quantity > 1 && <span className="ml-1.5 text-ink-muted">× {line.quantity}</span>}
                </p>

                <p className="text-xs text-ink-muted">
                  {line.price_unit === "PER_DAY"
                    ? t("s.reservations.manage.id.extraPerDayLine", { price: formatCurrency(each), days: rentalDays })
                    : t("s.reservations.manage.id.extraOneOffLine", { price: formatCurrency(each) })}
                </p>
              </div>

              <p className="shrink-0 font-semibold tabular-nums">{formatCurrency(lineTotal)}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3 text-sm">
        <span className="text-ink-secondary">{t("s.reservations.manage.id.extrasTotal")}</span>
        <span className="font-semibold tabular-nums">{formatCurrency(total)}</span>
      </div>
    </section>
  );
}
