// The shapes the public API (/api/public) returns. Kept next to each other here
// so the storefront and its tests agree with backend/app/schemas/public.py.

export type PublicConfig = {
  storefront_enabled: boolean;
  business_name: string;
  /** The business's brand colour, "#rrggbb". */
  accent_color: string;
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
  /** Footer links; empty means the business has none. */
  social_instagram_url: string;
  social_facebook_url: string;
  social_x_url: string;
  social_whatsapp_url: string;
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
  landing_about_title: string;
  landing_about_body: string;
  has_landing_about_image: boolean;
  landing_about_image_version: number | null;
  has_landing_cta_image: boolean;
  landing_cta_image_version: number | null;
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
  has_photo: boolean;
  photo_version: number | null;
  // Identifies this vehicle's photo without exposing which actual car it
  // is — the same opaque key used elsewhere to address a group of
  // identical cars as one offer (see backend/app/schemas/public.py).
  offer_key: string;
  price_per_day: number;
  // Set when the offer is a vehicle class: its address and the business's own words
  // per language. make and model are then only an example ("... or similar"), and
  // the specs below span every car in the class.
  class_slug: string | null;
  class_name: Record<string, string> | null;
  class_description: Record<string, string> | null;
  seats_min: number | null;
  seats_max: number | null;
  transmissions: string[];
  fuel_types: string[];
  /** Whether the page says "or similar" next to the car; false when cars are shown on their own. */
  or_similar: boolean;
};

export type PublicOffer = PublicVehicle & {
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
