// The shapes the public API (/api/public) returns. Kept next to each other here
// so the storefront and its tests agree with backend/app/schemas/public.py.

export type PublicConfig = {
  storefront_enabled: boolean;
  business_name: string;
  has_logo: boolean;
  logo_version: number | null;
  locale: string;
  default_language: string;
  languages: string[];
  currency: string;
  prices_include_vat: boolean;
  vat_rate: number;
  online_share_percent: number;
  free_cancellation_hours: number;
  hold_minutes: number;
  min_booking_lead_hours: number;
  legal_version: number;
  terms_url: string;
  privacy_url: string;
  has_terms_text: boolean;
  has_privacy_text: boolean;
  /** The storefront landing page — free text the business wrote once,
   * in their own language. Empty means "not set". */
  landing_headline: string;
  landing_tagline: string;
  landing_benefit1_title: string;
  landing_benefit1_body: string;
  landing_benefit2_title: string;
  landing_benefit2_body: string;
  landing_benefit3_title: string;
  landing_benefit3_body: string;
  has_hero_image: boolean;
  hero_image_version: number | null;
};

export type PublicLocation = {
  id: string;
  name: string;
  airport_code: string;
  address: string | null;
  timezone: string;
};

export type PublicVehicle = {
  make: string;
  model: string;
  year: number;
  category: string | null;
  transmission: string | null;
  fuel_type: string | null;
  seats: number | null;
  image_url: string | null;
  price_per_day: number;
};

export type PublicOffer = PublicVehicle & {
  offer_key: string;
  currency: string;
  total_amount: number;
  online_amount: number;
  due_at_pickup: number;
};

/** The error body every public endpoint returns on failure. */
export type ApiError = {
  detail: string;
  code: string;
  params: Record<string, string | number | boolean | null>;
};
