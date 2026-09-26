from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from typing import Literal

from app.schemas.customer import CustomerUpdate, IdentityVerificationSummary
from app.schemas.extra import ExtraSelectionRequest
from app.schemas.pricing import PriceBreakdownFields

class CustomerCreate(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str = Field(min_length=1)
    email: str = Field(min_length=1)
    nationality: str | None = None


class CustomerSummary(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str | None
    email: str | None
    nationality: str | None
    identity_verification: IdentityVerificationSummary | None

    model_config = ConfigDict(from_attributes=True)


class CarSummary(BaseModel):
    id: UUID
    make: str
    model: str
    license_plate: str

    model_config = ConfigDict(from_attributes=True)


class LocationSummary(BaseModel):
    id: UUID
    name: str
    airport_code: str
    # Times at this location are shown and entered in this timezone.
    timezone: str

    model_config = ConfigDict(from_attributes=True)


class ReservationExtraResponse(BaseModel):
    """
    One add-on line on a reservation, at the price it was booked at rather
    than the current catalog price.
    """

    extra_id: UUID
    extra_code: str
    name: str
    quantity: int
    unit_price: Decimal
    price_unit: str

    model_config = ConfigDict(from_attributes=True)


class ReservationCreate(BaseModel):
    customer: CustomerCreate

    car_id: UUID

    pickup_location_id: UUID
    return_location_id: UUID

    pickup_at: datetime
    return_at: datetime

    extras: list[ExtraSelectionRequest] = []


class ReservationQuoteRequest(BaseModel):
    car_id: UUID

    pickup_location_id: UUID
    return_location_id: UUID

    pickup_at: datetime
    return_at: datetime

    extras: list[ExtraSelectionRequest] = []


class ReservationQuoteResponse(PriceBreakdownFields):
    # Availability is reported, not enforced. The wizard only offers cars
    # that came back from /api/cars/available, so unavailability here means
    # someone booked the car while the user was filling in the form.
    # Failing the quote outright would blank the price panel the user is
    # reading; this way the wizard shows a correct price alongside a
    # precise warning and disables Confirm. POST /api/reservations remains
    # the hard gate.
    car_available: bool
    availability_message: str | None


class ReservationResponse(BaseModel):
    id: UUID

    customer_id: UUID
    car_id: UUID

    pickup_location_id: UUID
    return_location_id: UUID

    pickup_at: datetime
    return_at: datetime

    status: str

    created_at: datetime

    customer: CustomerSummary
    car: CarSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    extras: list[ReservationExtraResponse] = []

    model_config = ConfigDict(from_attributes=True)


class ReservationListResponse(BaseModel):
    id: UUID

    customer: CustomerSummary
    car: CarSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    pickup_at: datetime
    return_at: datetime

    status: str

    created_at: datetime

    # Present here as well as on ReservationResponse because
    # GET /api/reservations/{id} — the detail page's endpoint — returns
    # this schema, and the detail page shows the booked add-ons.
    extras: list[ReservationExtraResponse] = []

    model_config = ConfigDict(from_attributes=True)


class ReservationPage(BaseModel):
    items: list[ReservationListResponse]
    total: int
    limit: int
    offset: int


class ReservationSummary(BaseModel):
    total: int
    pickup_today: int
    return_today: int
    active: int
    upcoming: int
    overdue_returns: int


class CarReservationResponse(BaseModel):
    id: UUID

    customer: CustomerSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    pickup_at: datetime
    return_at: datetime

    status: str

    model_config = ConfigDict(from_attributes=True)


class FleetReservationResponse(CarReservationResponse):
    """A car's reservation tagged with which car, for views that show every
    car at once (the fleet timeline)."""

    car_id: UUID


class CustomerReservationResponse(BaseModel):
    id: UUID

    car: CarSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    pickup_at: datetime
    return_at: datetime

    status: str

    model_config = ConfigDict(from_attributes=True)

class ReservationStatusUpdate(BaseModel):
    # ACTIVE is deliberately excluded — a CONFIRMED reservation can only
    # become ACTIVE via the handover flow (payment + signature + agreement),
    # never as a direct client-supplied status value.
    status: Literal[
        "CONFIRMED",
        "COMPLETED",
        "CANCELLED",
    ]


class ReservationUpdate(BaseModel):
    pickup_at: datetime | None = None
    return_at: datetime | None = None

    pickup_location_id: UUID | None = None
    return_location_id: UUID | None = None

    car_id: UUID | None = None

    customer: CustomerUpdate | None = None

    # Absent leaves the add-ons alone; present replaces the whole set.
    # Refused once payment has succeeded — see update_reservation.
    extras: list[ExtraSelectionRequest] | None = None