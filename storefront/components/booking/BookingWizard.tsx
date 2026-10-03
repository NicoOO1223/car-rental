"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import type { PublicLocation, PublicOffer } from "@shared/publicApi";
import { zonedToInstant } from "@shared/time";

import { DetailsForm, EMPTY_DETAILS, type Details } from "@/components/booking/DetailsForm";
import { PaymentPanel } from "@/components/booking/PaymentPanel";
import { PriceSummary } from "@/components/booking/PriceSummary";
import { VehicleArt } from "@/components/VehicleArt";
import { VehicleSpecs } from "@/components/VehicleSpecs";
import { ApiFailure, api, carPhotoUrl, type Availability, type PublicExtra, type Quote } from "@/lib/client";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { readSearch, searchHref } from "@/lib/search";
import { manageToken, pendingBooking, type PendingBooking } from "@/lib/session";

type Step = "vehicle" | "extras" | "details" | "payment";

const STEPS: Step[] = ["vehicle", "extras", "details", "payment"];

const primary =
  "rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:opacity-50";
const secondary =
  "rounded-lg border border-border-strong bg-surface px-5 py-3 text-sm font-medium text-ink-secondary hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";

/** An extra name and description in the visitor language, English when the business has not translated it. */
function extraText(extra: PublicExtra, language: string) {
  const words = extra.translations?.[language] ?? {};

  return { name: words.name || extra.name, description: words.description || extra.description };
}

function Stepper({ step, language }: { step: Step; language: string }) {
  const t = useTranslations("wizard.steps");

  return (
    <ol className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm" lang={language}>
      {STEPS.map((name, index) => {
        const current = name === step;
        const done = STEPS.indexOf(step) > index;

        return (
          <li key={name} aria-current={current ? "step" : undefined} className={current ? "font-semibold text-ink" : done ? "text-ink-secondary" : "text-ink-muted"}>
            <span
              className={`mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                current ? "bg-gray-900 text-white" : done ? "bg-gray-300 text-ink" : "bg-surface-sunken"
              }`}
            >
              {index + 1}
            </span>
            {t(name)}
          </li>
        );
      })}
    </ol>
  );
}

/** The booking steps: car, extras, details, payment. State lives here; the search lives in the address. */
export function BookingWizard({ language, holdMinutes }: { language: string; holdMinutes: number }) {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const search = useMemo(() => readSearch(new URLSearchParams(params.toString())), [params]);
  const paying = params.get("pay");

  const [locations, setLocations] = useState<PublicLocation[] | null>(null);
  const [extras, setExtras] = useState<PublicExtra[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState("");

  const [step, setStep] = useState<Step>("vehicle");
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");

  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const [notice, setNotice] = useState("");

  const [pending, setPending] = useState<PendingBooking | null>(null);
  const [expired, setExpired] = useState(false);

  const place = useCallback((id: string) => locations?.find((location) => location.id === id), [locations]);
  const pickupPlace = search ? place(search.pickup) : undefined;
  const returnPlace = search ? place(search.return) : undefined;

  const pickupAt = search && pickupPlace ? zonedToInstant(...(search.from.split("T") as [string, string]), pickupPlace.timezone) : "";
  const returnAt = search && returnPlace ? zonedToInstant(...(search.to.split("T") as [string, string]), returnPlace.timezone) : "";

  // The places and add-ons, once.
  useEffect(() => {
    Promise.all([api.locations(), api.extras()])
      .then(([loadedLocations, loadedExtras]) => {
        setLocations(loadedLocations);
        setExtras(loadedExtras);
      })
      .catch((error) => setLoadError(errorMessage(t, error)));
    // The translator changes with the language, which reloads the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume a booking that was created and is waiting for its payment.
  useEffect(() => {
    if (!paying) return;

    const saved = pendingBooking.get();

    if (saved && saved.reference === paying) {
      setPending(saved);
      setStep("payment");
    }
  }, [paying]);

  const loadOffers = useCallback(async () => {
    if (!search || !pickupAt || !returnAt) return;

    setAvailability(null);
    setLoadError("");

    try {
      setAvailability(
        await api.availability({
          pickup_location_id: search.pickup,
          return_location_id: search.return,
          pickup_at: pickupAt,
          return_at: returnAt,
        }),
      );
    } catch (error) {
      setLoadError(errorMessage(t, error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, pickupAt, returnAt]);

  useEffect(() => {
    if (!paying) loadOffers();
  }, [loadOffers, paying]);

  const selectedExtras = useMemo(
    () => Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([extra_id, quantity]) => ({ extra_id, quantity })),
    [quantities],
  );

  // The exact price whenever the car or the extras change.
  useEffect(() => {
    // Only while choosing extras and entering details: once the booking is made
    // its own hold takes the car, so it would no longer show as free.
    if (!offer || !search || !pickupAt || !returnAt || (step !== "extras" && step !== "details")) return;

    let cancelled = false;

    setQuoteError("");

    api
      .quote({
        offer_key: offer.offer_key,
        pickup_location_id: search.pickup,
        return_location_id: search.return,
        pickup_at: pickupAt,
        return_at: returnAt,
        extras: selectedExtras,
      })
      .then((result) => !cancelled && setQuote(result))
      .catch((error) => {
        if (cancelled) return;

        if (error instanceof ApiFailure && error.code === "public.offer_unavailable") {
          setNotice(errorMessage(t, error));
          setOffer(null);
          setStep("vehicle");
          loadOffers();
        } else {
          setQuoteError(errorMessage(t, error));
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer, selectedExtras, step, pickupAt, returnAt]);

  async function handleSubmitDetails({ captchaToken }: { captchaToken: string }) {
    if (!offer || !search || !quote) return;

    setSubmitting(true);
    setSubmitError("");

    try {
      const created = await api.createBooking({
        offer_key: offer.offer_key,
        pickup_location_id: search.pickup,
        return_location_id: search.return,
        pickup_at: pickupAt,
        return_at: returnAt,
        extras: selectedExtras,
        customer: { ...details, nationality: details.nationality.trim() || null },
        expected_total: quote.total_amount,
        terms_accepted: true,
        privacy_acknowledged: true,
        captcha_token: captchaToken,
      });

      const saved: PendingBooking = {
        reference: created.reference,
        clientSecret: created.client_secret,
        holdExpiresAt: created.hold_expires_at,
        currency: created.currency,
        totalAmount: created.total_amount,
        onlineAmount: created.online_amount,
        dueAtPickup: created.due_at_pickup,
        summary: { vehicle: `${offer.make} ${offer.model}`, pickup: search.from, dropoff: search.to },
      };

      manageToken.set(created.reference, created.manage_token);
      pendingBooking.set(saved);
      setPending(saved);
      setStep("payment");
      router.replace(`${searchHref(language, search)}&pay=${encodeURIComponent(created.reference)}`);
    } catch (error) {
      setCaptchaReset((count) => count + 1);

      if (error instanceof ApiFailure && error.code === "public.price_changed") {
        setNotice(errorMessage(t, error));
        setStep("extras");
      } else if (error instanceof ApiFailure && error.code === "public.offer_unavailable") {
        setNotice(errorMessage(t, error));
        setOffer(null);
        setStep("vehicle");
        loadOffers();
      } else {
        setSubmitError(errorMessage(t, error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const startAgain = () => {
    pendingBooking.clear();
    router.push(`/${language}`);
  };

  // --- states with nothing to show yet ------------------------------------------------------

  if (!search) {
    return (
      <div className="rounded-xl bg-surface p-6 shadow-sm">
        <p className="text-ink-secondary">{t("wizard.badLink")}</p>
        <Link href={`/${language}`} className={`${primary} mt-4 inline-block`}>
          {t("wizard.startAgain")}
        </Link>
      </div>
    );
  }

  if (loadError && !locations) {
    return (
      <p className="rounded-xl bg-surface p-6 text-red-600 shadow-sm" role="alert">
        {loadError}
      </p>
    );
  }

  if (!locations || !pickupPlace || !returnPlace) {
    return <p className="text-ink-muted">{t("wizard.loading")}</p>;
  }

  const money = (amount: number, currency: string) => formatMoney(amount, currency, language);

  const summary = offer && (
    <PriceSummary
      language={language}
      vehicle={offer}
      pickupAt={pickupAt}
      returnAt={returnAt}
      pickupLocation={pickupPlace}
      returnLocation={returnPlace}
      quote={quote}
    />
  );

  // --- payment ---------------------------------------------------------------------------------------

  if (step === "payment" && pending) {
    return (
      <>
        <Stepper step="payment" language={language} />

        {expired ? (
          <section className="rounded-xl bg-surface p-6 shadow-sm">
            <h2 className="text-lg font-semibold">{t("pay.expiredTitle")}</h2>
            <p className="mt-2 text-ink-secondary">{t("pay.expiredBody")}</p>
            <button type="button" onClick={startAgain} className={`${primary} mt-5`}>
              {t("pay.startAgain")}
            </button>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <PaymentPanel
              language={language}
              reference={pending.reference}
              clientSecret={pending.clientSecret}
              holdExpiresAt={pending.holdExpiresAt}
              onlineAmount={pending.onlineAmount}
              dueAtPickup={pending.dueAtPickup}
              currency={pending.currency}
              onExpired={() => {
                pendingBooking.clear();
                setExpired(true);
              }}
            />

            <aside className="rounded-xl bg-surface p-5 text-sm shadow-sm lg:self-start">
              <h2 className="text-base font-semibold">{t("summary.title")}</h2>
              <p className="mt-3 font-medium">{pending.summary.vehicle}</p>
              <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-border-subtle pt-3">
                <span className="font-semibold">{t("summary.total")}</span>
                <span className="text-lg font-bold tabular-nums">{money(pending.totalAmount, pending.currency)}</span>
              </p>
            </aside>
          </div>
        )}
      </>
    );
  }

  // --- vehicle ---------------------------------------------------------------------------------------------

  if (step === "vehicle" || !offer) {
    return (
      <>
        <Stepper step="vehicle" language={language} />

        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold">{t("vehicles.title")}</h1>

          <Link href={`/${language}`} className="text-sm text-ink-secondary underline hover:text-ink">
            {t("wizard.changeSearch")}
          </Link>
        </div>

        {notice && (
          <p className="mb-4 rounded-lg bg-surface-sunken p-3 text-sm text-ink-secondary" role="status">
            {notice}
          </p>
        )}

        {loadError && (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {loadError}
          </p>
        )}

        {!availability ? (
          !loadError && <p className="text-ink-muted">{t("wizard.loading")}</p>
        ) : availability.offers.length === 0 ? (
          <p className="rounded-xl bg-surface p-6 text-ink-secondary shadow-sm">{t("vehicles.none")}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-muted">{t("vehicles.count", { count: availability.offers.length })}</p>

            <ul className="grid gap-4 sm:grid-cols-2">
              {availability.offers.map((candidate) => (
                <li key={candidate.offer_key} className="flex flex-col overflow-hidden rounded-xl bg-surface shadow-sm">
                  <VehicleArt
                    imageUrl={candidate.has_photo ? carPhotoUrl(candidate.offer_key, candidate.photo_version) : null}
                    category={candidate.category}
                    alt={`${candidate.make} ${candidate.model}`}
                    className="aspect-[16/9] w-full"
                  />

                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="font-semibold">
                      {candidate.make} {candidate.model}{" "}
                      <span className="text-sm font-normal text-ink-muted">{t("vehicles.orSimilar")}</span>
                    </h2>

                    <div className="mt-2">
                      <VehicleSpecs
                        category={candidate.category}
                        transmission={candidate.transmission}
                        fuelType={candidate.fuel_type}
                        seats={candidate.seats}
                      />
                    </div>

                    <div className="mt-4 flex-1">
                      <p className="text-xl font-bold tabular-nums">
                        {t("vehicles.total", { amount: money(candidate.total_amount, candidate.currency) })}
                      </p>
                      <p className="text-xs text-ink-muted">{t("vehicles.perDay", { price: money(candidate.price_per_day, candidate.currency) })}</p>
                      <p className="mt-2 text-sm text-ink-secondary">
                        {t("vehicles.payNow", { amount: money(candidate.online_amount, candidate.currency) })}
                        {candidate.due_at_pickup > 0 && (
                          <>
                            {" · "}
                            {t("vehicles.atPickup", { amount: money(candidate.due_at_pickup, candidate.currency) })}
                          </>
                        )}
                      </p>
                    </div>

                    <button
                      type="button"
                      className={`${primary} mt-4`}
                      onClick={() => {
                        setOffer(candidate);
                        setQuote(null);
                        setNotice("");
                        setStep("extras");
                      }}
                    >
                      {t("vehicles.select")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  // --- extras and details -------------------------------------------------------------------------------------

  return (
    <>
      <Stepper step={step} language={language} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {notice && (
            <p className="rounded-lg bg-surface-sunken p-3 text-sm text-ink-secondary" role="status">
              {notice}
            </p>
          )}

          {quoteError && (
            <p className="text-sm text-red-600" role="alert">
              {quoteError}
            </p>
          )}

          {step === "extras" ? (
            <section className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold">{t("extras.title")}</h2>

              {extras.length === 0 ? (
                <p className="mt-3 text-sm text-ink-secondary">{t("extras.none")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-border-subtle">
                  {extras.map((extra) => {
                    const words = extraText(extra, language);
                    const quantity = quantities[extra.id] ?? 0;
                    const price = money(extra.price, quote?.currency ?? offer.currency);

                    return (
                      <li key={extra.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{words.name}</p>
                          {words.description && <p className="text-sm text-ink-secondary">{words.description}</p>}
                          <p className="text-sm text-ink-muted">
                            {extra.price_unit === "PER_DAY" ? t("extras.perDay", { price }) : t("extras.perRental", { price })}
                          </p>
                        </div>

                        <select
                          aria-label={`${words.name}: ${t("extras.quantity")}`}
                          value={quantity}
                          onChange={(event) => setQuantities({ ...quantities, [extra.id]: Number(event.target.value) })}
                          className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm"
                        >
                          {Array.from({ length: extra.max_quantity + 1 }, (_, count) => (
                            <option key={count} value={count}>
                              {count}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" className={secondary} onClick={() => setStep("vehicle")}>
                  {t("wizard.back")}
                </button>
                <button type="button" className={primary} disabled={!quote} onClick={() => { setNotice(""); setStep("details"); }}>
                  {t("wizard.continue")}
                </button>
              </div>
            </section>
          ) : (
            <>
              <DetailsForm
                language={language}
                holdMinutes={holdMinutes}
                details={details}
                onChange={setDetails}
                submitting={submitting}
                error={submitError}
                captchaReset={captchaReset}
                onSubmit={handleSubmitDetails}
              />

              <button type="button" className={secondary} onClick={() => setStep("extras")}>
                {t("wizard.back")}
              </button>
            </>
          )}
        </div>

        {summary}
      </div>
    </>
  );
}
