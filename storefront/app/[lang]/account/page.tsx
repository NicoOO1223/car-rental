import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ClaimForm } from "@/components/ClaimForm";
import { VerifyBanner } from "@/components/VerifyBanner";
import { ViewBookingButton } from "@/components/ViewBookingButton";
import { VehicleArt } from "@/components/VehicleArt";
import { getAccount, getAccountBookings } from "@/lib/accountServer";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { getTranslator } from "@/lib/i18n";
import { vehicleName } from "@/lib/vehicleText";
import { getPublicConfig } from "@/lib/publicApi";
import { carPhotoUrl } from "@/lib/runtime";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("account.title"), robots: { index: false, follow: false } };
}

export default async function AccountPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const config = await getPublicConfig();

  if (!config?.storefront_enabled) notFound();

  const account = await getAccount();

  if (!account) redirect(`/${lang}/login?next=${encodeURIComponent(`/${lang}/account`)}`);

  const bookings = account.email_verified ? ((await getAccountBookings()) ?? []) : [];

  // The status is data from the API, so its key is not known to the type checker.
  const untyped = t as unknown as ((key: string) => string) & { has: (key: string) => boolean };
  const statusLabel = (status: string) => (untyped.has(`status.${status}`) ? untyped(`status.${status}`) : status);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight">{t("account.welcome", { name: account.first_name })}</h1>
      <p className="mt-1 text-ink-secondary">{account.email}</p>

      {!account.email_verified && <VerifyBanner email={account.email} />}

      <h2 className="mt-10 text-xl font-semibold">{t("account.bookingsTitle")}</h2>

      {bookings.length === 0 ? (
        <p className="mt-3 text-ink-secondary">{t("account.empty")}</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {bookings.map((booking) => (
            <li key={booking.reference} className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm sm:flex">
              <VehicleArt
                imageUrl={booking.vehicle.has_photo ? carPhotoUrl(booking.vehicle.offer_key, booking.vehicle.photo_version) : null}
                category={booking.vehicle.category}
                alt={vehicleName(booking.vehicle, lang)}
                className="aspect-[16/9] w-full sm:aspect-auto sm:w-56 sm:shrink-0"
              />

              <div className="flex flex-1 flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm">
                  <p className="text-lg font-semibold">{vehicleName(booking.vehicle, lang)}</p>
                  <p className="font-mono text-xs text-ink-muted">
                    {booking.reference} · {statusLabel(booking.status)}
                  </p>
                  <p className="text-ink-secondary">
                    {t("account.pickup")}: {formatDate(booking.pickup_at, booking.pickup_location.timezone, lang)},{" "}
                    {formatTime(booking.pickup_at, booking.pickup_location.timezone, lang)} · {booking.pickup_location.airport_code}
                  </p>
                  <p className="text-ink-secondary">
                    {t("account.return")}: {formatDate(booking.return_at, booking.return_location.timezone, lang)},{" "}
                    {formatTime(booking.return_at, booking.return_location.timezone, lang)} · {booking.return_location.airport_code}
                  </p>
                  <p className="font-medium">{formatMoney(booking.total_amount, booking.currency, lang)}</p>
                </div>

                <ViewBookingButton language={lang} reference={booking.reference} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {account.email_verified && (
        <div className="mt-10">
          <ClaimForm />
        </div>
      )}
    </main>
  );
}
