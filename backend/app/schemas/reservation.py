from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from app.schemas.vehicle_class import ClassSummary
from pydantic import BaseModel, ConfigDict, Field, field_validator

from typing import Literal

from app.schemas.customer import (
    Address,
    CustomerUpdate,
    Email,
    IdentityVerificationSummary,
    Name,
    PhoneNumber,
    PostalCode,
    check_email,
    check_nationality,
)
from app.schemas.extra import ExtraSelectionRequest
from app.schemas.pricing import PriceBreakdownFields

class CustomerCreate(BaseModel):
    first_name: Name
    last_name: Name
    date_of_birth: date
    address: Address
    postal_code: PostalCode
    phone_number: PhoneNumber
    email: Email
    nationality: str | None = None

    @field_validator("email")
    @classmethod
    def email_looks_valid(cls, value: str) -> str:
        return check_email(value)

    @field_validator("nationality")
    @classmethod
    def nationality_is_a_country(cls, value: str | None) -> str | None:
        return check_nationality(value)


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
    translations: dict[str, dict[str, str | None]] = {}
    quantity: int
    unit_price: Decimal
    price_unit: str

    model_config = ConfigDict(from_attributes=True)


class ReservationCreate(BaseModel):
    customer: CustomerCreate

    # A car, or a class (the system holds a car of it, which staff may swap until pickup).
    car_id: UUID | None = None
    class_id: UUID | None = None

    pickup_location_id: UUID
    return_location_id: UUID

    pickup_at: datetime
    return_at: datetime

    extras: list[ExtraSelectionRequest] = []

    # The language emails to the renter are written in. Left out = the business default.
    language: Literal["en", "it", "pl"] | None = None


class ReservationQuoteRequest(BaseModel):
    car_id: UUID | None = None
    class_id: UUID | None = None

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


class OnlinePaymentSummary(BaseModel):
    """The share a renter paid online when booking."""

    payment_status: str
    amount: Decimal | None = Field(validation_alias="payment_amount")
    currency: str | None = Field(validation_alias="payment_currency")
    paid_at: datetime | None
    refund_amount: Decimal | None
    refunded_at: datetime | None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class OnlineBookingFields(BaseModel):
    """What only a booking made on the storefront carries. All neutral (STAFF,
    empty) for one made by staff."""

    source: str = "STAFF"
    public_reference: str | None = None
    hold_expires_at: datetime | None = None
    cancellation_reason: str | None = None
    cancelled_at: datetime | None = None
    cancellation_deadline_at: datetime | None = None
    prepayment_percent: int | None = None
    agreed_total_amount: Decimal | None = None
    prepayment: OnlinePaymentSummary | None = None


class ReservationResponse(OnlineBookingFields):
    id: UUID

    language: str | None = None

    customer_id: UUID
    car_id: UUID

    # The class the booking was made for, and whether the car is final (see Reservation.car_confirmed).
    class_id: UUID | None = None
    vehicle_class: ClassSummary | None = None
    car_confirmed: bool = True

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


class ReservationListResponse(OnlineBookingFields):
    id: UUID

    # The language emails to the renter are written in (null = the business default).
    language: str | None = None

    customer: CustomerSummary
    car: CarSummary

    class_id: UUID | None = None
    vehicle_class: ClassSummary | None = None
    car_confirmed: bool = True

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


class OverlapCandidateResponse(BaseModel):
    """One other reservation competing for the same car and dates."""

    id: UUID
    customer_name: str
    pickup_at: datetime
    return_at: datetime
    status: str
    agreed_total_amount: Decimal | None
    is_repeat_customer: bool
    created_at: datetime


class OverlappingReservationsResponse(BaseModel):
    items: list[OverlapCandidateResponse]
    suggested_id: UUID | None
    # Which criteria set suggested_id apart, in priority order — e.g.
    # ["repeat_customer", "requested_first"]. The frontend turns these into
    # plain-language copy; empty means no candidate stood out from the rest.
    suggested_reasons: list[str]


class ReservationStatusUpdate(BaseModel):
    # ACTIVE is deliberately excluded — a CONFIRMED reservation can only
    # become ACTIVE via the handover flow (payment + signature + agreement),
    # never as a direct client-supplied status value. COMPLETED is accepted by
    # the schema only so a request gets the service's cannot_change_status
    # error: a rental is completed by check-out, never by this endpoint.
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

    language: Literal["en", "it", "pl"] | None = None

    customer: CustomerUpdate | None = None

    # Absent leaves the add-ons alone; present replaces the whole set.
    # Refused once payment has succeeded — see update_reservation.
    extras: list[ExtraSelectionRequest] | None = None