// Baked in at build time (Next.js inlines NEXT_PUBLIC_* vars into the
// client bundle), so it must be passed as a Docker build arg for any
// deployment that isn't talking to a local backend.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type Location = {
  id: string;
  name: string;
  airport_code: string;
  address: string | null;
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
  };

  return_location: {
    id: string;
    name: string;
    airport_code: string;
  };

  pickup_at: string;
  return_at: string;
  status: string;
};

export async function getLocations(): Promise<Location[]> {
  const response = await fetch(
    `${API_URL}/api/locations`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch locations");
  }

  return response.json();
}


export async function getAvailableCars(
  locationId: string,
  pickupAt: string,
  returnAt: string,
) {
  const params = new URLSearchParams({
    location_id: locationId,
    pickup_at: pickupAt,
    return_at: returnAt,
  });

  const response = await fetch(
    `${API_URL}/api/cars/available?${params}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch available cars");
  }

  return response.json();
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
  };
  car_id: string;
  pickup_location_id: string;
  return_location_id: string;
  pickup_at: string;
  return_at: string;
}) {
  const response = await fetch(
    `${API_URL}/api/reservations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(
      errorData?.detail ||
      "Failed to create reservation",
    );
  }

  return response.json();
}

export async function getReservations(): Promise<Reservation[]> {
  const response = await fetch(
    `${API_URL}/api/reservations`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch reservations.");
  }

  return response.json();
}

export async function getReservation(
  id: string
): Promise<Reservation> {
  const response = await fetch(
    `${API_URL}/api/reservations/${id}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch reservation.");
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
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(
      errorData?.detail ||
        "Failed to update reservation",
    );
  }

  return response.json();
}

export async function cancelReservation(reservationId: string) {
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}/cancel`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(
      errorData?.detail ||
        "Failed to cancel reservation",
    );
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
  price_per_day: number;
  current_location: {
    id: string;
    name: string;
    airport_code: string;
  };
  status: string;
};

export async function getCars() {
  const response = await fetch(
    `${API_URL}/api/cars`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch cars");
  }

  return response.json();
}

export async function getCar(
  carId: string,
): Promise<Car> {
  const response = await fetch(
    `${API_URL}/api/cars/${carId}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch car");
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
    price_per_day: number;
    current_location_id: string;
    status: string;
  }>,
): Promise<Car> {
  const response = await fetch(
    `${API_URL}/api/cars/${carId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(
      errorData?.detail || "Failed to update car",
    );
  }

  return response.json();
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
  };

  return_location: {
    name: string;
    airport_code: string;
  };

  pickup_at: string;
  return_at: string;
  status: string;
};

export async function getCarReservations(
  carId: string,
): Promise<CarReservation[]> {
  const response = await fetch(
    `${API_URL}/api/cars/${carId}/reservations`,
  );

  if (!response.ok) {
    throw new Error(
      "Failed to fetch car reservations",
    );
  }

  return response.json();
}

// Every car's status "as of" the given day (YYYY-MM-DD), derived from
// CONFIRMED/ACTIVE reservations rather than the raw Car.status field.
// Keyed by car id.
export async function getCarStatusesByDate(
  date: string,
): Promise<Record<string, string>> {
  const response = await fetch(
    `${API_URL}/api/cars/status-by-date?date=${date}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch car statuses for date.");
  }

  return response.json();
}

export async function updateReservationStatus(
  reservationId: string,
  status: "CONFIRMED" | "COMPLETED" | "CANCELLED",
): Promise<Reservation> {
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}/status`,
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
    const errorData = await response
      .json()
      .catch(() => null);

    throw new Error(
      errorData?.detail ||
        "Failed to update reservation status.",
    );
  }

  return response.json();
}

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

  upcoming_reservations: {
    id: string;

    customer_first_name: string;
    customer_last_name: string;

    car_make: string;
    car_model: string;
    car_license_plate: string;

    pickup_location_name: string;
    pickup_location_code: string;

    return_location_name: string;
    return_location_code: string;

    pickup_at: string;
    return_at: string;

    status: string;
  }[];

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
};


export async function getDashboard(): Promise<Dashboard> {
  const response = await fetch(
    `${API_URL}/api/dashboard`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard");
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

  const response = await fetch(
    `${API_URL}/api/dashboard/fleet-status?${search}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch fleet status");
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
  points: RevenuePoint[];
  total_revenue: number;
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

  const response = await fetch(
    `${API_URL}/api/dashboard/revenue?${search}`,
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(errorData?.detail || "Failed to fetch revenue");
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
  created_at: string;
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
  };

  return_location: {
    id: string;
    name: string;
    airport_code: string;
  };

  pickup_at: string;
  return_at: string;
  status: string;
};

export async function getCustomers(): Promise<CustomerListItem[]> {
  const response = await fetch(
    `${API_URL}/api/customers`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch customers");
  }

  return response.json();
}

export async function getCustomer(
  customerId: string,
): Promise<Customer> {
  const response = await fetch(
    `${API_URL}/api/customers/${customerId}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch customer");
  }

  return response.json();
}

export async function getCustomerReservations(
  customerId: string,
): Promise<CustomerReservation[]> {
  const response = await fetch(
    `${API_URL}/api/customers/${customerId}/reservations`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch customer reservations");
  }

  return response.json();
}

export type Handover = {
  id: string;
  reservation_id: string;

  stripe_payment_intent_id: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
  payment_status: string;
  paid_at: string | null;

  signed_at: string | null;
  has_signature: boolean;

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
};

export async function getHandover(reservationId: string): Promise<Handover> {
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}/handover`,
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(errorData?.detail || "Failed to fetch handover.");
  }

  return response.json();
}

export async function createPaymentIntent(
  reservationId: string,
): Promise<PaymentIntent> {
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}/handover/payment-intent`,
    { method: "POST" },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(errorData?.detail || "Failed to start payment.");
  }

  return response.json();
}

export async function confirmHandoverPayment(
  reservationId: string,
): Promise<Handover> {
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}/handover/confirm-payment`,
    { method: "POST" },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(errorData?.detail || "Failed to confirm payment.");
  }

  return response.json();
}

export async function submitSignature(
  reservationId: string,
  signatureImage: string,
): Promise<Handover> {
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}/handover/signature`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature_image: signatureImage }),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(errorData?.detail || "Failed to submit signature.");
  }

  return response.json();
}

export async function generateAgreement(
  reservationId: string,
): Promise<Handover> {
  const response = await fetch(
    `${API_URL}/api/reservations/${reservationId}/handover/agreement`,
    { method: "POST" },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(errorData?.detail || "Failed to generate agreement.");
  }

  return response.json();
}

export function getAgreementDownloadUrl(reservationId: string): string {
  return `${API_URL}/api/reservations/${reservationId}/handover/agreement/download`;
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
  }>,
): Promise<Customer> {
  const response = await fetch(
    `${API_URL}/api/customers/${customerId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(
      errorData?.detail || "Failed to update customer",
    );
  }

  return response.json();
}