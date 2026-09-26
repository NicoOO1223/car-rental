"""
What the public storefront is allowed to see.

Written out field by field, never derived from the staff schemas, so a column
added to a car, a location or the configuration later cannot leak to the public
by accident. A test pins the exact keys of every response.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.extra import ExtraSelectionRequest
from app.schemas.pricing import PriceBreakdownFields


class PublicConfigResponse(BaseModel):
    storefront_enabled: bool

    business_name: str
    has_logo: bool
    logo_version: int | None
    locale: str
    default_language: str
    languages: list[str]

    currency: str
    prices_include_vat: bool
    vat_rate: float

    online_share_percent: int
    free_cancellation_hours: int
    hold_minutes: int
    min_booking_lead_hours: int

    legal_version: int
    terms_url: str
    privacy_url: str
    has_terms_text: bool
    has_privacy_text: bool


class PublicLegalResponse(BaseModel):
    legal_version: int
    terms_text: str
    terms_url: str
    privacy_text: str
    privacy_url: str


class PublicLocation(BaseModel):
    id: UUID
    name: str
    airport_code: str
    address: str | None
    timezone: str


class PublicExtra(BaseModel):
    id: UUID
    code: str
    name: str
    description: str | None
    translations: dict[str, dict[str, str]]
    price: float
    price_unit: str
    max_quantity: int


class PublicVehicle(BaseModel):
    make: str
    model: str
    year: int
    category: str | None
    transmission: str | None
    fuel_type: str | None
    seats: int | None
    image_url: str | None
    price_per_day: float


class PublicOffer(PublicVehicle):
    offer_key: str
    currency: str
    # What the whole rental costs (no extras), and how it is paid.
    total_amount: float
    online_amount: float
    due_at_pickup: float


class PublicAvailabilityResponse(BaseModel):
    pickup_at: datetime
    return_at: datetime
    rental_days: int
    offers: list[PublicOffer]


class PublicQuoteRequest(BaseModel):
    offer_key: str = Field(min_length=8, max_length=64)
    pickup_location_id: UUID
    return_location_id: UUID
    pickup_at: datetime
    return_at: datetime
    extras: list[ExtraSelectionRequest] = []


class PublicQuoteResponse(PriceBreakdownFields):
    online_amount: float
    due_at_pickup: float
    online_share_percent: int
    free_cancellation_hours: int
    cancellation_deadline_at: datetime
