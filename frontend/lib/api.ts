import { rememberExtras, type ExtraWording } from "@/lib/extras";
import { throwApiError } from "@/lib/apiErrors";
import { t } from "@/lib/i18n";
import { hardNavigate } from "@/lib/hardNavigate";
import { getRuntimeConfig } from "@/lib/runtimeConfig";

// This stack's API address, read when it is needed: it is a runtime value,
// not baked into the build, so one image can serve every stack.
function apiUrl(): string {
  return getRuntimeConfig().apiUrl;
}

const TOKEN_KEY = "auth_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// Every exported function below goes through this instead of calling
// fetch directly, so the auth token only needs attaching in one place.
// A 401 means the token is missing/expired — bounce to /login (a full
// reload here is intentional: it guarantees every page's in-memory
// state resets alongside the cleared token, not just the current one).
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl()}${path}`, { ...init, headers });
  } catch {
    // The server could not be reached at all (offline, restarting).
    throw new Error(t("errors.generic.network"));
  }

  if (
    response.status === 401 &&
    typeof window !== "undefined" &&
    window.location.pathname !== "/login"
  ) {
    clearToken();
    hardNavigate("/login");
  }

  return response;
}

export type LoginResponse = {
  access_token: string;
  token_type: string;
};

export type CurrentUser = {
  id: string;
  email: string;
  role: "admin" | "staff";
  hidden_nav_items: string[];
  /** The language this person chose; null means the business default. */
  language: string | null;
};

/** Saves the signed-in person's own interface language. */
export async function updateMyLanguage(language: string | null): Promise<void> {
  const response = await apiFetch("/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const response = await apiFetch("/api/auth/me");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    await throwApiError(response, "auth.failed");
  }

  return response.json();
}

export type Location = {
  id: string;
  name: string;
  airport_code: string;
  address: string | null;
  /** IANA name; days and displayed times at this location follow it. */
  timezone: string;
  /** Inactive locations are hidden from new bookings. */
  is_active: boolean;
};

export type IdentityVerification = {
  status: string | null;
  document_type: string | null;
  issuing_country: string | null;
  verified_at: string | null;
};

export type Reservation = {
  id: string;

  customer: {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string;
    address: string;
    postal_code: string;
    phone_number: string | null;
    email: string | null;
    nationality: string | null;
    identity_verification: IdentityVerification | null;
  };

  car: {
    id: string;
    make: string;
    model: string;
    license_plate: string;
  };

  pickup_location: {
    id: string;
    name: string;
    airport_code: string;
    /** Times here are shown and entered in this timezone. */
    timezone: string;
  };

  return_location: {
    id: string;
    name: string;
    airport_code: string;
    /** Times here are shown and entered in this timezone. */
    timezone: string;
  };

  pickup_at: string;
  return_at: string;
  status: string;

  created_at: string;

  extras: ReservationExtra[];

  // Bookings made on the public website carry more; a booking made by staff
  // has source "STAFF" and the rest empty.
  source: "STAFF" | "STOREFRONT";
  /** What the renter quotes ("ABCD-2345"). */
  public_reference: string | null;
  hold_expires_at: string | null;
  cancellation_reason: "STAFF" | "RENTER" | "NO_SHOW" | null;
  cancelled_at: string | null;
  /** Until when cancelling gives the online share back. */
  cancellation_deadline_at: string | null;
  prepayment_percent: number | null;
  /** The price agreed when the booking was made, as a decimal string. */
  agreed_total_amount: string | null;
  /** The share paid online when booking. */
  prepayment: {
    payment_status: string;
    amount: string | null;
    currency: string | null;
    paid_at: string | null;
    refund_amount: string | null;
    refunded_at: string | null;
  } | null;
};

// --- Add-ons -------------------------------------------------------------

export type PriceUnit = "PER_DAY" | "PER_RENTAL";

/** A bookable add-on from the catalog. */
export type Extra = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Optional wording in other languages; empty falls back to the English above. */
  translations: ExtraWording;
  /** Serialized from a Decimal, so it arrives as a string. */
  price: string;
  price_unit: PriceUnit;
  max_quantity: number;
  sort_order: number;
};

/** An add-on as the admin sees it: retired ones included. */
export type AdminExtra = Extra & {
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ExtraInput = {
  name: string;
  description: string | null;
  translations: ExtraWording;
  /** Sent as a string so a Decimal never passes through a float. */
  price: string;
  price_unit: PriceUnit;
  max_quantity: number;
};

async function adminExtrasRequest<T>(
  path: string,
  init: RequestInit | undefined,
  failure: string,
): Promise<T> {
  const response = await apiFetch(`/api/admin/extras${path}`, init);

  if (!response.ok) {
    await throwApiError(response, failure);
  }

  return response.json();
}

export function getAdminExtras(): Promise<AdminExtra[]> {
  return adminExtrasRequest<AdminExtra[]>("", undefined, "errors.generic.load").then(
    (extras) => {
      rememberExtras(extras);

      return extras;
    },
  );
}

export function createExtra(data: ExtraInput): Promise<AdminExtra> {
  return adminExtrasRequest(
    "",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
    "errors.generic.save",
  );
}

export function updateExtra(
  extraId: string,
  data: Partial<ExtraInput> & { is_active?: boolean },
): Promise<AdminExtra> {
  return adminExtrasRequest(
    `/${extraId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
    "errors.generic.save",
  );
}

export function reorderExtras(ids: string[]): Promise<AdminExtra[]> {
  return adminExtrasRequest(
    "/order",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
    "errors.generic.failed",
  );
}

/** An add-on as booked, at the price it was booked at. */
export type ReservationExtra = {
  extra_id: string;
  extra_code: string;
  name: string;
  translations: ExtraWording;
  quantity: number;
  unit_price: string;
  price_unit: PriceUnit;
};

export type ExtraSelection = {
  extra_id: string;
  quantity: number;
};

export type PriceBreakdownExtraLine = {
  code: string;
  name: string;
  quantity: number;
  unit_price: number;
  price_unit: PriceUnit;
  amount: number;
};

/**
 * A server-computed price. The booking wizard used to reimplement the
 * surcharge rules in TypeScript and keep them in sync with
 * backend/app/services/pricing.py by hand; every amount now comes from
 * here instead.
 */
export type PriceBreakdown = {
  rental_days: number;
  currency: string;

  base_amount: number;
  short_term_fee: number;
  airport_change_fee: number;

  extras: PriceBreakdownExtraLine[];
  extras_amount: number;

  /** VAT percentage; 0 means none is shown. */
  vat_rate: number;
  vat_amount: number;
  net_amount: number;
  /** True: the total already contains VAT. False: VAT was added on top. */
  prices_include_vat: boolean;

  total_amount: number;
};

export type ReservationQuote = PriceBreakdown & {
  car_available: boolean;
  availability_message: string | null;
};

export async function getExtras(): Promise<Extra[]> {
  const response = await apiFetch("/api/extras");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  const extras: Extra[] = await response.json();
  rememberExtras(extras);

  return extras;
}

export async function quoteReservation(data: {
  car_id: string;
  pickup_location_id: string;
  return_location_id: string;
  pickup_at: string;
  return_at: string;
  extras: ExtraSelection[];
}): Promise<ReservationQuote> {
  const response = await apiFetch("/api/reservations/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

/**
 * Active locations by default, which is what booking needs. Screens that
 * show past records pass `includeInactive` so a retired location still
 * resolves and filters.
 */
export async function getLocations(
  options: { includeInactive?: boolean } = {},
): Promise<Location[]> {
  const response = await apiFetch(
    `/api/locations${options.includeInactive ? "?include_inactive=true" : ""}`,
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type LocationInput = {
  name: string;
  airport_code: string;
  address: string;
  timezone: string;
};

async function locationRequest(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  fallback: string,
): Promise<Location> {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await throwApiError(response, fallback);
  }

  return response.json();
}

export function createLocation(input: LocationInput): Promise<Location> {
  return locationRequest("/api/locations", "POST", input, "errors.generic.save");
}

export function updateLocation(
  id: string,
  patch: Partial<LocationInput> & { is_active?: boolean },
): Promise<Location> {
  return locationRequest(
    `/api/locations/${id}`,
    "PATCH",
    patch,
    "errors.generic.save",
  );
}


export async function getAvailableCars(
  locationId: string,
  pickupAt: string,
  returnAt: string,
): Promise<Car[]> {
  const params = new URLSearchParams({
    location_id: locationId,
    pickup_at: pickupAt,
    return_at: returnAt,
  });

  const response = await apiFetch(`/api/cars/available?${params}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

/** date (yyyy-mm-dd) -> day rate shown for a pickup location. */
export async function getDailyRates(
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> {
  const params = new URLSearchParams({
    location_id: locationId,
    start_date: startDate,
    end_date: endDate,
  });

  const response = await apiFetch(`/api/cars/daily-rates?${params}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  const rates: { date: string; price: string | number }[] =
    await response.json();

  return Object.fromEntries(
    rates.map((rate) => [rate.date, Number(rate.price)]),
  );
}

export async function createReservation(data: {
  customer: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    address: string;
    postal_code: string;
    phone_number: string;
    email: string;
    nationality?: string;
  };
  car_id: string;
  pickup_location_id: string;
  return_location_id: string;
  pickup_at: string;
  return_at: string;
  extras?: ExtraSelection[];
}): Promise<Reservation> {
  const response = await apiFetch("/api/reservations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

/** The envelope every server-paged list returns. */
export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }

  const text = query.toString();

  return text ? `?${text}` : "";
}

export type ReservationQuery = {
  q?: string;
  status?: string;
  location?: string;
  /** STAFF or STOREFRONT: where the booking was made. */
  source?: string;
  window?: string;
  sort?: string;
  /** The browser's own "today", as instants (the server only knows UTC). */
  dayStart?: string;
  dayEnd?: string;
  limit?: number;
  offset?: number;
};

export async function getReservations(
  query: ReservationQuery = {},
): Promise<Page<Reservation>> {
  const response = await apiFetch(
    `/api/reservations${queryString({
      q: query.q,
      status: query.status,
      location: query.location,
      source: query.source,
      window: query.window,
      sort: query.sort,
      day_start: query.dayStart,
      day_end: query.dayEnd,
      limit: query.limit,
      offset: query.offset,
    })}`,
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type ReservationSummary = {
  total: number;
  pickup_today: number;
  return_today: number;
  active: number;
  upcoming: number;
  overdue_returns: number;
};

export async function getReservationSummary(
  dayStart?: string,
  dayEnd?: string,
): Promise<ReservationSummary> {
  const response = await apiFetch(
    `/api/reservations/summary${queryString({
      day_start: dayStart,
      day_end: dayEnd,
    })}`,
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function getReservation(
  id: string
): Promise<Reservation> {
  const response = await apiFetch(`/api/reservations/${id}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  const reservation: Reservation = await response.json();
  rememberExtras(reservation.extras ?? []);

  return reservation;
}

export type OverlapCandidate = {
  id: string;
  customer_name: string;
  pickup_at: string;
  return_at: string;
  status: string;
  agreed_total_amount: string | null;
  is_repeat_customer: boolean;
  created_at: string;
};

export type OverlappingReservations = {
  items: OverlapCandidate[];
  suggested_id: string | null;
  /** e.g. ["repeat_customer", "requested_first"] — turned into plain-
   * language copy by the component, not shown as-is. */
  suggested_reasons: string[];
};

/** Other reservations competing for the same car and dates — PENDING
 * requests no longer block each other, so staff reviewing one needs to see
 * what else wants the same slot. */
export async function getOverlappingReservations(
  reservationId: string,
): Promise<OverlappingReservations> {
  const response = await apiFetch(`/api/reservations/${reservationId}/overlapping`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function updateReservation(
  reservationId: string,
  data: Partial<{
    pickup_at: string;
    return_at: string;
    pickup_location_id: string;
    return_location_id: string;
    car_id: string;
    customer: Partial<{
      first_name: string;
      last_name: string;
      date_of_birth: string;
      address: string;
      postal_code: string;
      phone_number: string;
      email: string;
    }>;
  }>,
): Promise<Reservation> {
  const response = await apiFetch(`/api/reservations/${reservationId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

/**
 * Cancels a booking. `refundPrepayment` decides the share the renter paid
 * online: leave it out to follow the admin's policy (refunded up to the
 * deadline, kept after it), or say true or false for this cancellation.
 */
export async function cancelReservation(
  reservationId: string,
  options: { refundPrepayment?: boolean } = {},
) {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/cancel`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refund_prepayment: options.refundPrepayment ?? null }),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export type Car = {
  id: string;
  make: string;
  model: string;
  year: number;
  license_plate: string;
  category: string | null;
  transmission: string | null;
  fuel_type: string | null;
  seats: number | null;
  /**
   * A string, not a number: this is a Decimal server-side, and Pydantic
   * serializes it as "45.00" to avoid float rounding. This type used to
   * claim `number`, which silently produced string concatenation wherever
   * anyone did arithmetic on it.
   */
  price_per_day: string;
  /** False for most of the fleet; the UI falls back to a category illustration. */
  has_photo: boolean;
  photo_version: number | null;
  current_location: {
    id: string;
    name: string;
    airport_code: string;
  };
  /** The airport this car belongs to; it can be elsewhere after a one-way rental. */
  home_location: {
    id: string;
    name: string;
    airport_code: string;
  };
  is_away_from_home: boolean;
  status: string;
  mileage: number | null;
  tire_condition: string | null;
  last_oil_change_at: string | null;
  /** Odometer reading at that oil change; set automatically, never by hand. */
  last_oil_change_mileage: number | null;
  last_inspection_at: string | null;
  next_inspection_due: string | null;
  insured_from: string | null;
  insured_until: string | null;
  /** The premium for the insured period, as a decimal string. */
  insurance_cost: string | null;
  /** Whether the public storefront may offer this car. */
  offered_online: boolean;
};

export type Notification = {
  kind:
    | "relocation"
    | "inspection_due"
    | "inspection_overdue"
    | "insurance_ending"
    | "insurance_expired"
    | "oil_change_due"
    | "condition_review_due"
    | "online_booking";
  severity: "info" | "warning" | "critical";
  car: { id: string; make: string; model: string; license_plate: string };
  airport: string | null;
  home_airport: string | null;
  date: string | null;
  /** Days until the date; negative once it has passed. */
  days: number | null;
  /** oil_change_due: distance since the last recorded oil change. */
  km_since?: number | null;
  /** online_booking: the booking, its reference and who made it (date is the pickup). */
  reservation_id?: string | null;
  reference?: string | null;
  customer?: string | null;
};

/** What needs attention: vehicles to move back, inspections, insurance. */
export async function getNotifications(): Promise<{
  reminder_days: number;
  items: Notification[];
}> {
  const response = await apiFetch("/api/notifications");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

/** Admin only: sets a vehicle's daily rate (audited). */
export async function updateCarPrice(
  carId: string,
  pricePerDay: string,
): Promise<Car> {
  const response = await apiFetch(`/api/admin/cars/${carId}/price`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ price_per_day: pricePerDay }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

/** Records that the car was moved back to its home airport. */
export async function returnCarToHome(carId: string): Promise<Car> {
  const response = await apiFetch(`/api/cars/${carId}/return-to-home`, {
    method: "POST",
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function getCars(): Promise<Car[]> {
  const response = await apiFetch("/api/cars");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function getCar(
  carId: string,
): Promise<Car> {
  const response = await apiFetch(`/api/cars/${carId}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function updateCar(
  carId: string,
  data: Partial<{
    make: string;
    model: string;
    year: number;
    license_plate: string;
    category: string | null;
    transmission: string | null;
    fuel_type: string | null;
    seats: number | null;
    home_location_id: string;
    mileage: number | null;
    tire_condition: string | null;
    last_oil_change_at: string | null;
    last_inspection_at: string | null;
    next_inspection_due: string | null;
    insured_from: string | null;
    insured_until: string | null;
    insurance_cost: string | null;
    offered_online: boolean;
  }>,
): Promise<Car> {
  const response = await apiFetch(`/api/cars/${carId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

/** Public and unauthenticated, the same way a car's photo is served to
 * renters on the storefront — no token needed just to display it. */
export function carPhotoUrl(carId: string, version: number | null): string {
  return `${apiUrl()}/api/public/cars/${carId}/photo${version ? `?v=${version}` : ""}`;
}

export async function uploadCarPhoto(carId: string, dataUrl: string): Promise<void> {
  const response = await apiFetch(`/api/cars/${carId}/photo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }
}

export async function deleteCarPhoto(carId: string): Promise<void> {
  const response = await apiFetch(`/api/cars/${carId}/photo`, {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.delete");
  }
}

export type CarReservation = {
  id: string;

  customer: {
    id: string;
    first_name: string;
    last_name: string;
    phone_number: string | null;
    email: string | null;
  };

  pickup_location: {
    name: string;
    airport_code: string;
    /** Times here are shown and entered in this timezone. */
    timezone: string;
  };

  return_location: {
    name: string;
    airport_code: string;
    /** Times here are shown and entered in this timezone. */
    timezone: string;
  };

  pickup_at: string;
  return_at: string;
  status: string;
};

export type FleetReservation = CarReservation & { car_id: string };

/** Every car's confirmed and active bookings in one request. */
export async function getFleetReservations(): Promise<FleetReservation[]> {
  const response = await apiFetch("/api/cars/reservations");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function getCarReservations(
  carId: string,
): Promise<CarReservation[]> {
  const response = await apiFetch(`/api/cars/${carId}/reservations`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

// Every car's status "as of" the given day (YYYY-MM-DD), derived from
// CONFIRMED/ACTIVE reservations rather than the raw Car.status field.
// Keyed by car id.
export async function getCarStatusesByDate(
  date: string,
): Promise<Record<string, string>> {
  const response = await apiFetch(`/api/cars/status-by-date?date=${date}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type MaintenanceTask = {
  id: string;
  car: {
    id: string;
    make: string;
    model: string;
    license_plate: string;
  };
  task_type: string;
  // Subcategory of MAINTENANCE; null for cleaning and for older tasks.
  category: string | null;
  // Subtype of CLEANING; null for maintenance, and optional even for cleaning.
  cleaning_type: string | null;
  status: string;
  notes: string | null;
  /** What the work costs; null when not entered (not the same as zero). */
  cost: string | null;
  // Null only for tasks created before time ranges were required.
  starts_at: string | null;
  ends_at: string | null;
  opened_at: string;
  completed_at: string | null;
};

export type MaintenanceTaskPage = {
  items: MaintenanceTask[];
  total: number;
  limit: number;
  offset: number;
  /** Open tasks overall, not only those on this page. */
  open_maintenance: number;
  open_cleaning: number;
};

export async function getMaintenanceTasks(params?: {
  status?: string;
  task_type?: string;
  limit?: number;
  offset?: number;
}): Promise<MaintenanceTaskPage> {
  const query = new URLSearchParams();

  if (params?.status) query.set("status", params.status);
  if (params?.task_type) query.set("task_type", params.task_type);
  if (params?.limit != null) query.set("limit", String(params.limit));
  if (params?.offset != null) query.set("offset", String(params.offset));

  const queryString = query.toString();

  const response = await apiFetch(
    `/api/maintenance/tasks${queryString ? `?${queryString}` : ""}`,
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type CarCondition = {
  id: string;
  make: string;
  model: string;
  license_plate: string;
  mileage: number | null;
  tire_condition: string | null;
  last_oil_change_at: string | null;
  last_oil_change_mileage: number | null;
  oil_change_overdue: boolean;
  condition_review_overdue: boolean;
  last_inspection_at: string | null;
  next_inspection_due: string | null;
  insured_from: string | null;
  insured_until: string | null;
  insurance_cost: string | null;
};

/** Every vehicle's condition and insurance at a glance, plus fleet-wide
 * cost totals. Read-only — editing stays on each car's own page. */
export async function getFleetCondition(): Promise<{
  total_insurance_cost: string;
  total_maintenance_spend: string;
  cars: CarCondition[];
  insurance: CarCondition[];
}> {
  const response = await apiFetch("/api/fleet-condition");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function getCarMaintenanceTasks(
  carId: string,
): Promise<MaintenanceTask[]> {
  const response = await apiFetch(`/api/cars/${carId}/maintenance-tasks`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type FleetMaintenanceTask = {
  id: string;
  car_id: string;
  task_type: string;
  category: string | null;
  cleaning_type: string | null;
  status: string;
  notes: string | null;
  starts_at: string | null;
  ends_at: string | null;
  opened_at: string;
};

/** Every car's currently open maintenance/cleaning task in one request —
 * the counterpart of getFleetReservations, for the fleet timeline. */
export async function getFleetMaintenanceTasks(): Promise<FleetMaintenanceTask[]> {
  const response = await apiFetch("/api/cars/maintenance-tasks");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function createMaintenanceTask(data: {
  car_id: string;
  task_type: string;
  category?: string | null;
  cleaning_type?: string | null;
  notes?: string | null;
  cost?: string | null;
  starts_at: string;
  ends_at: string;
}): Promise<MaintenanceTask> {
  const response = await apiFetch("/api/maintenance/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function completeMaintenanceTask(
  taskId: string,
  nextInspectionDue?: string,
  cost?: string | null,
): Promise<MaintenanceTask> {
  const response = await apiFetch(
    `/api/maintenance/tasks/${taskId}/complete`,
    nextInspectionDue || cost
      ? {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(nextInspectionDue ? { next_inspection_due: nextInspectionDue } : {}),
            ...(cost ? { cost } : {}),
          }),
        }
      : { method: "PATCH" },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function cancelMaintenanceTask(
  taskId: string,
): Promise<MaintenanceTask> {
  const response = await apiFetch(
    `/api/maintenance/tasks/${taskId}/cancel`,
    { method: "PATCH" },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function updateReservationStatus(
  reservationId: string,
  status: "CONFIRMED" | "COMPLETED" | "CANCELLED",
): Promise<Reservation> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        status,
      }),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export type DashboardReservation = {
  id: string;

  customer_first_name: string;
  customer_last_name: string;
  customer_phone_number: string | null;
  customer_nationality: string | null;

  car_make: string;
  car_model: string;
  car_license_plate: string;

  pickup_location_name: string;
  pickup_location_code: string;
  pickup_timezone: string;

  return_location_name: string;
  return_location_code: string;
  return_timezone: string;

  pickup_at: string;
  return_at: string;

  status: string;

  total_price: number;
};

export type Dashboard = {
  fleet: {
    total: number;
    available: number;
    reserved: number;
    rented: number;
    maintenance: number;
    cleaning: number;
  };

  reservations: {
    total: number;
    confirmed: number;
    active: number;
    completed: number;
    cancelled: number;
  };

  today: {
    pickups: number;
    returns: number;
  };

  // Split by direction rather than one pickup-sorted list: "returns"
  // means a rental already in progress and due back soon, which the
  // server filters differently from "pickups" — see
  // backend/app/routers/dashboard.py.
  upcoming_pickups: DashboardReservation[];
  upcoming_returns: DashboardReservation[];

  locations: {
    airport_code: string;
    name: string;

    total: number;
    available: number;
    reserved: number;
    rented: number;
    maintenance: number;
    cleaning: number;
  }[];

  cars_away_from_home: {
    id: string;
    make: string;
    model: string;
    license_plate: string;
    year: number;
    category: string | null;
    status: string;
    current_airport_code: string;
    home_airport_code: string;
    current_airport_name: string;
    home_airport_name: string;
  }[];
};


export async function getDashboard(range?: {
  startDate?: string;
  endDate?: string;
  locationId?: string;
}): Promise<Dashboard> {
  const params = new URLSearchParams();
  if (range?.startDate) params.set("start_date", range.startDate);
  if (range?.endDate) params.set("end_date", range.endDate);
  if (range?.locationId) params.set("location_id", range.locationId);

  const query = params.toString();
  const response = await apiFetch(`/api/dashboard${query ? `?${query}` : ""}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type FleetStatusCounts = {
  total: number;
  available: number;
  reserved: number;
  rented: number;
  maintenance: number;
  cleaning: number;
};

export type FleetStatus = {
  date: string;
  location_id: string | null;
  counts: FleetStatusCounts;
};

export async function getFleetStatus(params: {
  date?: string;
  locationId?: string;
}): Promise<FleetStatus> {
  const search = new URLSearchParams();

  if (params.date) {
    search.set("date", params.date);
  }

  if (params.locationId) {
    search.set("location_id", params.locationId);
  }

  const response = await apiFetch(`/api/dashboard/fleet-status?${search}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type RevenuePoint = {
  date: string;
  revenue: number;
};

export type Revenue = {
  start_date: string;
  end_date: string;

  // Vehicle revenue: day-rate x duration of completed reservations,
  // attributed to pickup date. Excludes surcharges/extras.
  points: RevenuePoint[];
  total_revenue: number;

  // Money actually collected: SUCCEEDED handover payments, attributed
  // to payment date. Includes surcharges/extras, excludes anything
  // later refunded.
  collected_points: RevenuePoint[];
  total_collected: number;
  collected_by_method: { card: number; cash: number };
  total_refunded: number;
};

export async function getRevenue(params: {
  startDate?: string;
  endDate?: string;
}): Promise<Revenue> {
  const search = new URLSearchParams();

  if (params.startDate) {
    search.set("start_date", params.startDate);
  }

  if (params.endDate) {
    search.set("end_date", params.endDate);
  }

  const response = await apiFetch(`/api/dashboard/revenue?${search}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

// Builds the CSV client-side from the already-fetched response — the
// same reasoning downloadCustomerDataExport uses for its JSON export,
// rather than adding a backend-streamed report endpoint for data the
// page already has in hand.
export function downloadRevenueCsv(revenue: Revenue): void {
  const collectedByDate = new Map(
    revenue.collected_points.map((point) => [point.date, point.revenue]),
  );

  const rows = [
    ["date", "vehicle_revenue", "collected_revenue"],
    ...revenue.points.map((point) => [
      point.date,
      point.revenue.toFixed(2),
      (collectedByDate.get(point.date) ?? 0).toFixed(2),
    ]),
  ];

  const csv = rows.map((row) => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `revenue-${revenue.start_date}-to-${revenue.end_date}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type AuditLogEntry = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type AuditLogListResponse = {
  items: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
};

export async function getAuditLogs(params: {
  entityType?: string;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  limit: number;
  offset: number;
}): Promise<AuditLogListResponse> {
  const search = new URLSearchParams();

  if (params.entityType) search.set("entity_type", params.entityType);
  if (params.action) search.set("action", params.action);
  if (params.userId) search.set("user_id", params.userId);
  if (params.startDate) search.set("start_date", params.startDate);
  if (params.endDate) search.set("end_date", params.endDate);
  search.set("limit", String(params.limit));
  search.set("offset", String(params.offset));

  const response = await apiFetch(`/api/audit-logs?${search}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type AuditLogActor = {
  id: string;
  email: string;
};

export async function getAuditLogActors(): Promise<AuditLogActor[]> {
  const response = await apiFetch("/api/audit-logs/actors");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type Customer = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  address: string;
  postal_code: string;
  phone_number: string | null;
  email: string | null;
  nationality: string | null;
  created_at: string;
  anonymized_at: string | null;
  identity_verification: IdentityVerification | null;
};

export type CustomerListItem = Customer & {
  reservation_count: number;
  last_reservation_at: string | null;
};

export type CustomerReservation = {
  id: string;

  car: {
    id: string;
    make: string;
    model: string;
    license_plate: string;
  };

  pickup_location: {
    id: string;
    name: string;
    airport_code: string;
    /** Times here are shown and entered in this timezone. */
    timezone: string;
  };

  return_location: {
    id: string;
    name: string;
    airport_code: string;
    /** Times here are shown and entered in this timezone. */
    timezone: string;
  };

  pickup_at: string;
  return_at: string;
  status: string;
};

export type CustomerQuery = {
  q?: string;
  segment?: string;
  sort?: string;
  limit?: number;
  offset?: number;
};

export async function getCustomers(
  query: CustomerQuery = {},
): Promise<Page<CustomerListItem>> {
  const response = await apiFetch(`/api/customers${queryString(query)}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type CustomerSummaryStats = {
  total: number;
  new_this_week: number;
  repeat_customers: number;
  total_reservations: number;
  avg_reservations: number;
};

export async function getCustomerSummary(): Promise<CustomerSummaryStats> {
  const response = await apiFetch("/api/customers/summary");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function getCustomer(
  customerId: string,
): Promise<Customer> {
  const response = await apiFetch(`/api/customers/${customerId}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function getCustomerReservations(
  customerId: string,
): Promise<CustomerReservation[]> {
  const response = await apiFetch(`/api/customers/${customerId}/reservations`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

// --- Data retention & GDPR (admin only) -----------------------------------

export type CustomerExportReservation = {
  id: string;
  car_make: string;
  car_model: string;
  car_license_plate: string;
  pickup_location_code: string;
  return_location_code: string;
  pickup_at: string;
  return_at: string;
  status: string;
  payment_status: string | null;
  payment_method: "CARD" | "CASH" | null;
  payment_amount: number | null;
  payment_currency: string | null;
  has_signature: boolean;
  has_agreement: boolean;
};

export type CustomerDataExport = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  address: string;
  postal_code: string;
  phone_number: string | null;
  email: string | null;
  nationality: string | null;
  created_at: string;
  anonymized_at: string | null;
  identity_verification: IdentityVerification | null;
  reservations: CustomerExportReservation[];
  exported_at: string;
};

// Right to erasure — irreversible, admin-only. The customer row stays
// (reservations/handovers still reference it) but its PII is blanked.
export async function eraseCustomer(customerId: string): Promise<Customer> {
  const response = await apiFetch(`/api/customers/${customerId}/erase`, {
    method: "POST",
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.delete");
  }

  return response.json();
}

// Right to access / data portability — fetches the full data bundle and
// hands the browser a downloadable JSON file, the same way
// downloadAgreement hands it a PDF.
export async function downloadCustomerDataExport(
  customerId: string,
): Promise<void> {
  const response = await apiFetch(`/api/customers/${customerId}/export`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.download");
  }

  const bundle: CustomerDataExport = await response.json();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `customer-${customerId}-data-export.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Identity and driving licence details, typed in by staff at the counter.
export type IdentityDetails = {
  customer_id: string;

  national_id_number: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  id_document_expires_at: string | null;
  driving_license_number: string | null;
  driving_license_country: string | null;
  driving_license_categories: string | null;
  driving_license_issued_at: string | null;
  driving_license_expires_at: string | null;

  identity_checked_at: string | null;
  identity_checked_by_email: string | null;

  // Verified through the old Stripe Identity flow; still accepted.
  legacy_stripe_verified: boolean;

  // Why the recorded details can't yet back the rental; null when they can.
  problem: string | null;
};

export type IdentityDetailsInput = {
  national_id_number: string;
  id_document_type: string | null;
  id_document_number: string | null;
  id_document_expires_at: string | null;
  driving_license_number: string;
  driving_license_country: string | null;
  driving_license_categories: string | null;
  driving_license_issued_at: string | null;
  driving_license_expires_at: string;
  documents_checked: boolean;
};

// `reservationId` makes `problem` account for that rental's end date
// (the licence must be valid until then).
export async function getIdentityDetails(
  customerId: string,
  reservationId?: string,
): Promise<IdentityDetails> {
  const query = reservationId ? `?reservation_id=${reservationId}` : "";

  const response = await apiFetch(
    `/api/customers/${customerId}/identity-details${query}`,
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function saveIdentityDetails(
  customerId: string,
  data: IdentityDetailsInput,
  reservationId?: string,
): Promise<IdentityDetails> {
  const query = reservationId ? `?reservation_id=${reservationId}` : "";

  const response = await apiFetch(
    `/api/customers/${customerId}/identity-details${query}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

// --- Check-out (the return of a rented car) ------------------------------

export type CheckOut = {
  id: string;
  reservation_id: string;

  returned_at: string;
  return_mileage: number;
  // Eighths of a tank: 0 (empty) to 8 (full).
  fuel_eighths: number;

  damage_reported: boolean;
  damage_notes: string | null;
  damage_charge: number;
  damage_task_starts_at: string | null;
  damage_task_ends_at: string | null;

  cleaning_requested: boolean;
  cleaning_type: string | null;
  cleaning_task_starts_at: string | null;
  cleaning_task_ends_at: string | null;

  late_hours: number;
  late_fee: number;
  fuel_fee: number;
  late_fee_waived: boolean;
  fuel_fee_waived: boolean;
  waiver_reason: string | null;
  total_charge: number;

  // Security deposit taken at check-in, used first for these charges.
  deposit_held: boolean;
  deposit_amount: number | null;
  deposit_method: "CARD" | "CASH" | null;
  deposit_status: string | null;
  // A held deposit this check-out hasn't settled yet.
  deposit_pending: boolean;
  deposit_applied: number;
  deposit_returned: number;
  deposit_settled_at: string | null;
  // What is left to pay after the deposit.
  amount_due: number;

  payment_amount: number | null;
  payment_currency: string | null;
  payment_status: string;
  payment_method: "CARD" | "CASH" | null;
  paid_at: string | null;

  employee_signed_at: string | null;
  has_employee_signature: boolean;
  employee_signed_by_email: string | null;
  employee_signature_image: string | null;

  completed_at: string | null;
};

export type CheckOutConditionInput = {
  return_mileage: number;
  fuel_eighths: number;
  damage_reported: boolean;
  damage_notes: string | null;
  damage_charge: number;
  damage_task_starts_at: string | null;
  damage_task_ends_at: string | null;
  send_for_cleaning: boolean;
  cleaning_type: string | null;
  cleaning_task_starts_at: string | null;
  cleaning_task_ends_at: string | null;
};

export type CheckOutPaymentIntent = {
  client_secret: string | null;
  payment_status: string;
  payment_amount: number | null;
  payment_currency: string | null;
  late_fee: number;
  fuel_fee: number;
  damage_charge: number;
};

export type CheckOutResult = {
  check_out: CheckOut;
  car_away_from_home: boolean;
  car_current_airport_code: string;
  car_home_airport_code: string;
  maintenance_task_id: string | null;
  cleaning_task_id: string | null;
};

async function checkOutRequest<T>(
  reservationId: string,
  path: string,
  init: RequestInit | undefined,
  failure: string,
): Promise<T> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/check-out${path}`,
    init,
  );

  if (!response.ok) {
    await throwApiError(response, failure);
  }

  return response.json();
}

function jsonPost(body?: unknown): RequestInit {
  return body === undefined
    ? { method: "POST" }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
}

/** The check-out so far, or null when none has been started. */
export function getCheckOut(reservationId: string): Promise<CheckOut | null> {
  return checkOutRequest(reservationId, "", undefined, "errors.generic.load");
}

export function saveCheckOutCondition(
  reservationId: string,
  data: CheckOutConditionInput,
): Promise<CheckOut> {
  return checkOutRequest(reservationId, "/condition", jsonPost(data), "errors.generic.save");
}

export function waiveCheckOutCharges(
  reservationId: string,
  data: { waive_late_fee: boolean; waive_fuel_fee: boolean; reason: string | null },
): Promise<CheckOut> {
  return checkOutRequest(reservationId, "/waive", jsonPost(data), "errors.generic.save");
}

/** Takes the charges from the held deposit and releases the rest. */
export function settleCheckOutDeposit(reservationId: string): Promise<CheckOut> {
  return checkOutRequest(reservationId, "/settle-deposit", jsonPost(), "errors.generic.failed");
}

export function createCheckOutPaymentIntent(
  reservationId: string,
): Promise<CheckOutPaymentIntent> {
  return checkOutRequest(reservationId, "/payment-intent", jsonPost(), "errors.generic.save");
}

export function confirmCheckOutPayment(reservationId: string): Promise<CheckOut> {
  return checkOutRequest(reservationId, "/confirm-payment", jsonPost(), "errors.generic.save");
}

export function confirmCheckOutCashPayment(reservationId: string): Promise<CheckOut> {
  return checkOutRequest(reservationId, "/confirm-cash-payment", jsonPost(), "errors.generic.save");
}

export function submitCheckOutEmployeeSignature(
  reservationId: string,
  signatureImage: string,
): Promise<CheckOut> {
  return checkOutRequest(
    reservationId,
    "/employee-signature",
    jsonPost({ signature_image: signatureImage }),
    "errors.generic.save",
  );
}

export function completeCheckOut(reservationId: string): Promise<CheckOutResult> {
  return checkOutRequest(reservationId, "/complete", jsonPost(), "errors.generic.save");
}

export type ConditionReviewKind = "CHECK_IN" | "CHECK_OUT";

export type ConditionPhoto = {
  id: string;
  category: "EXTERIOR" | "INTERIOR";
  content_type: string;
  created_at: string;
};

export type ConditionReview = {
  id: string;
  reservation_id: string;
  kind: ConditionReviewKind;
  tire_condition: string | null;
  reviewed_at: string | null;
  photos: ConditionPhoto[];
};

/** The optional pickup/return condition review so far, or null if no one
 * has started one for this end of the rental yet. */
export async function getConditionReview(
  reservationId: string,
  kind: ConditionReviewKind,
): Promise<ConditionReview | null> {
  const response = await apiFetch(`/api/reservations/${reservationId}/condition-reviews/${kind}`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function saveConditionReviewTireCondition(
  reservationId: string,
  kind: ConditionReviewKind,
  tireCondition: string | null,
): Promise<ConditionReview> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/condition-reviews/${kind}/tire-condition`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tire_condition: tireCondition }),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function addConditionReviewPhoto(
  reservationId: string,
  kind: ConditionReviewKind,
  category: "EXTERIOR" | "INTERIOR",
  dataUrl: string,
): Promise<ConditionReview> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/condition-reviews/${kind}/photos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, data_url: dataUrl }),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

// A condition photo is staff-only, so a plain <img src> (which can't carry
// an Authorization header) can't load it directly — fetched as a blob and
// shown via an object URL instead, the same way downloadAgreement/
// downloadInvoice already handle authenticated binary downloads.
export async function fetchConditionPhotoBlob(photoId: string): Promise<Blob> {
  const response = await apiFetch(`/api/condition-photos/${photoId}/content`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.blob();
}

export type Handover = {
  id: string;
  reservation_id: string;

  stripe_payment_intent_id: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
  payment_status: string;
  payment_method: "CARD" | "CASH" | "PREPAID" | null;
  paid_at: string | null;

  refund_amount: number | null;
  refunded_at: string | null;
  stripe_refund_id: string | null;

  // Security deposit; deposit_status is null when none was involved.
  deposit_amount: number | null;
  deposit_currency: string | null;
  deposit_method: "CARD" | "CASH" | null;
  deposit_status: string | null;
  deposit_held_at: string | null;
  deposit_settled_at: string | null;
  deposit_captured_amount: number | null;

  signed_at: string | null;
  has_signature: boolean;

  // The employee who approved the handover, with their signature.
  employee_signed_at: string | null;
  has_employee_signature: boolean;
  employee_signed_by_email: string | null;
  employee_signature_image: string | null;

  generated_at: string | null;
  has_agreement: boolean;
};

export type PaymentIntent = {
  client_secret: string | null;
  payment_status: string;
  payment_amount: number | null;
  payment_currency: string | null;
  base_amount: number;
  short_term_fee: number;
  airport_change_fee: number;
  extras: PriceBreakdownExtraLine[];
  extras_amount: number;
  vat_rate: number;
  vat_amount: number;
  net_amount: number;
  prices_include_vat: boolean;
};

/** What the counter needs to say about money for a rental. */
export type PaymentSummary = {
  currency: string;
  total_amount: number;
  /** Paid on the website when booking; 0 for a booking made by staff. */
  paid_online: number;
  /** What is left to take now; 0 when the rental was paid in full online. */
  amount_due: number;
};

export async function getPaymentSummary(reservationId: string): Promise<PaymentSummary> {
  const response = await apiFetch(`/api/reservations/${reservationId}/handover/payment-summary`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

/** A rental paid in full online needs no payment at the counter. */
export async function settlePrepaidHandover(reservationId: string): Promise<Handover> {
  const response = await apiFetch(`/api/reservations/${reservationId}/handover/settle-prepaid`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

/** The renter never came: cancels the booking and keeps what they paid online. */
export async function markReservationNoShow(reservationId: string): Promise<Reservation> {
  const response = await apiFetch(`/api/reservations/${reservationId}/no-show`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function getHandover(reservationId: string): Promise<Handover> {
  const response = await apiFetch(`/api/reservations/${reservationId}/handover`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function createPaymentIntent(
  reservationId: string,
): Promise<PaymentIntent> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/payment-intent`,
    { method: "POST" },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function confirmHandoverPayment(
  reservationId: string,
): Promise<Handover> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/confirm-payment`,
    { method: "POST" },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function confirmCashPayment(
  reservationId: string,
): Promise<Handover> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/confirm-cash-payment`,
    { method: "POST" },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export type DepositIntent = {
  client_secret: string | null;
  deposit_status: string | null;
  deposit_amount: number | null;
  deposit_currency: string | null;
};

async function depositRequest<T>(
  reservationId: string,
  path: string,
  failure: string,
): Promise<T> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/deposit/${path}`,
    { method: "POST" },
  );

  if (!response.ok) {
    await throwApiError(response, failure);
  }

  return response.json();
}

/** Starts the card authorization for the security deposit. */
export function createDepositIntent(reservationId: string): Promise<DepositIntent> {
  return depositRequest(reservationId, "intent", "errors.generic.save");
}

/** Verifies with the server that the card hold succeeded. */
export function confirmDepositHold(reservationId: string): Promise<Handover> {
  return depositRequest(reservationId, "confirm", "errors.generic.save");
}

export function confirmCashDeposit(reservationId: string): Promise<Handover> {
  return depositRequest(reservationId, "confirm-cash", "errors.generic.save");
}

export async function submitSignature(
  reservationId: string,
  signatureImage: string,
): Promise<Handover> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/signature`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature_image: signatureImage }),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function submitEmployeeSignature(
  reservationId: string,
  signatureImage: string,
): Promise<Handover> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/employee-signature`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature_image: signatureImage }),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function generateAgreement(
  reservationId: string,
): Promise<Handover> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/agreement`,
    { method: "POST" },
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

// Plain <a href> can't attach an Authorization header, so the PDF is
// fetched here (with the token, like everything else) and handed to
// the browser as a blob download instead of linking straight at the API.
export type Invoice = {
  id: string;
  /** For example INV-000042, or CN-000043 for a credit note. */
  number: string;
  kind: "INVOICE" | "CREDIT_NOTE";
  reservation_id: string;
  issued_at: string;
  currency: string;
  prices_include_vat: boolean;
  vat_rate: number;
  net_amount: number;
  vat_amount: number;
  /** Negative on a credit note. */
  total_amount: number;
  credits_invoice_number: string | null;
};

/** The invoice, and credit note if it was refunded, for a booking. */
export async function getReservationInvoices(
  reservationId: string,
): Promise<Invoice[]> {
  const response = await apiFetch(`/api/reservations/${reservationId}/invoices`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

/** Fetched with the token and handed to the browser as a download. */
export async function downloadInvoice(invoice: Invoice): Promise<void> {
  const response = await apiFetch(`/api/invoices/${invoice.id}/pdf`);

  if (!response.ok) {
    await throwApiError(response, "errors.generic.download");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");

  link.href = url;
  link.download = `${invoice.number}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadAgreement(
  reservationId: string,
  filename: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/reservations/${reservationId}/handover/agreement/download`,
  );

  if (!response.ok) {
    await throwApiError(response, "errors.generic.download");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type User = {
  id: string;
  email: string;
  role: "admin" | "staff";
  is_active: boolean;
  created_at: string;
  hidden_nav_items: string[];
};

export async function getUsers(): Promise<User[]> {
  const response = await apiFetch("/api/users");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function createUser(data: {
  email: string;
  password: string;
  role: string;
}): Promise<User> {
  const response = await apiFetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function updateUser(
  userId: string,
  data: Partial<{
    email: string;
    role: string;
    is_active: boolean;
    hidden_nav_items: string[];
  }>,
): Promise<User> {
  const response = await apiFetch(`/api/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function resetUserPassword(
  userId: string,
  password: string,
): Promise<User> {
  const response = await apiFetch(`/api/users/${userId}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export async function updateCustomer(
  customerId: string,
  data: Partial<{
    first_name: string;
    last_name: string;
    date_of_birth: string;
    address: string;
    postal_code: string;
    phone_number: string;
    email: string;
    nationality: string;
  }>,
): Promise<Customer> {
  const response = await apiFetch(`/api/customers/${customerId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}

export type Configuration = {
  short_term_threshold_days: number;
  short_term_fee: number;
  airport_change_fee: number;
  late_return_grace_minutes: number;
  late_fee_per_hour: number;
  fuel_fee_per_eighth: number;
  refuel_service_fee: number;
  max_damage_charge: number;
  security_deposit_amount: number;
  default_currency: string;
  access_token_expire_days: number;
  reminder_days: number;
  /** Distance since the last oil change at which a car is flagged overdue. */
  oil_change_interval_km: number;
  business_name: string;
  legal_name: string;
  address: string;
  phone: string;
  email: string;
  vat_id: string;
  timezone: string;
  locale: string;
  agreement_terms: string;
  vat_rate: number;
  prices_include_vat: boolean;
  invoice_prefix: string;
  /** Interface language for anyone who has not chosen their own. */
  default_language: string;
  /** Language the agreement and invoices are printed in. */
  document_language: string;
  /** The public booking site: on or off, and its rules. */
  storefront_enabled: boolean;
  /** Percent of the rental a renter pays online when booking. */
  online_share_percent: number;
  /** Hours before pickup up to which cancelling refunds the online share. */
  free_cancellation_hours: number;
  /** Minutes an unpaid booking holds its car. */
  hold_minutes: number;
  /** The earliest pickup a renter can book, in hours from now. */
  min_booking_lead_hours: number;
  terms_text: string;
  terms_url: string;
  social_instagram_url: string;
  social_facebook_url: string;
  social_x_url: string;
  social_whatsapp_url: string;
  privacy_text: string;
  privacy_url: string;
  /** Goes up whenever the terms or privacy text changes. */
  legal_version: number;
  /** The storefront landing page — free text, written once in the
   * business's own language, not translated by the interface. */
  landing_headline: string;
  landing_tagline: string;
  landing_benefit1_title: string;
  landing_benefit1_body: string;
  landing_benefit2_title: string;
  landing_benefit2_body: string;
  landing_benefit3_title: string;
  landing_benefit3_body: string;
  landing_about_title: string;
  landing_about_body: string;
};

/** The currency every price is shown in; readable by any signed-in staff. */
export async function getPublicConfiguration(): Promise<{
  default_currency: string;
  /** Deposit taken at check-in; 0 means deposits are off. */
  security_deposit_amount: number;
  business_name: string;
  /** IANA name, e.g. "Europe/Rome". */
  timezone: string;
  /** BCP 47 tag used for dates, times and money. */
  locale: string;
  vat_rate: number;
  prices_include_vat: boolean;
}> {
  const response = await apiFetch("/api/configuration/public");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export type Branding = {
  business_name: string;
  has_logo: boolean;
  logo_version: number | null;
  has_hero_image: boolean;
  hero_image_version: number | null;
  has_landing_about_image: boolean;
  landing_about_image_version: number | null;
  has_landing_cta_image: boolean;
  landing_cta_image_version: number | null;
  locale: string;
  /** Interface language for someone who has not chosen their own. */
  default_language: string;
};

/** Public: the login page needs this before anyone is signed in. */
export async function getBranding(): Promise<Branding> {
  const response = await apiFetch("/api/branding");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export function brandingLogoUrl(version: number | null): string {
  return `${apiUrl()}/api/branding/logo${version ? `?v=${version}` : ""}`;
}

export function brandingLandingHeroUrl(version: number | null): string {
  return `${apiUrl()}/api/branding/landing-hero${version ? `?v=${version}` : ""}`;
}

export function brandingLandingAboutImageUrl(version: number | null): string {
  return `${apiUrl()}/api/branding/landing-about-image${version ? `?v=${version}` : ""}`;
}

export function brandingLandingCtaImageUrl(version: number | null): string {
  return `${apiUrl()}/api/branding/landing-cta-image${version ? `?v=${version}` : ""}`;
}

export async function uploadLogo(dataUrl: string): Promise<void> {
  const response = await apiFetch("/api/configuration/logo", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }
}

export async function deleteLogo(): Promise<void> {
  const response = await apiFetch("/api/configuration/logo", {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.delete");
  }
}

export async function uploadLandingHero(dataUrl: string): Promise<void> {
  const response = await apiFetch("/api/configuration/landing-hero", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }
}

export async function deleteLandingHero(): Promise<void> {
  const response = await apiFetch("/api/configuration/landing-hero", {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.delete");
  }
}

export async function uploadLandingAboutImage(dataUrl: string): Promise<void> {
  const response = await apiFetch("/api/configuration/landing-about-image", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }
}

export async function deleteLandingAboutImage(): Promise<void> {
  const response = await apiFetch("/api/configuration/landing-about-image", {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.delete");
  }
}

export async function uploadLandingCtaImage(dataUrl: string): Promise<void> {
  const response = await apiFetch("/api/configuration/landing-cta-image", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl }),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }
}

export async function deleteLandingCtaImage(): Promise<void> {
  const response = await apiFetch("/api/configuration/landing-cta-image", {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.delete");
  }
}

export async function getConfiguration(): Promise<Configuration> {
  const response = await apiFetch("/api/configuration");

  if (!response.ok) {
    await throwApiError(response, "errors.generic.load");
  }

  return response.json();
}

export async function updateConfiguration(
  data: Partial<Configuration>,
): Promise<Configuration> {
  const response = await apiFetch("/api/configuration", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwApiError(response, "errors.generic.save");
  }

  return response.json();
}
