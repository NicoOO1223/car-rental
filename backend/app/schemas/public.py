"""
What the public storefront is allowed to see.

Written out field by field, never derived from the staff schemas, so a column
added to a car, a location or the configuration later cannot leak to the public
by accident. A test pins the exact keys of every response.
"""

from datetime import date, datetime
from typing import Literal
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.customer import check_nationality
from app.schemas.extra import ExtraSelectionRequest
from app.schemas.pricing import PriceBreakdownFields
from app.schemas.user import check_password_bytes


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

    social_instagram_url: str
    social_facebook_url: str
    social_x_url: str
    social_whatsapp_url: str

    landing_headline: str
    landing_tagline: str
    landing_benefit1_title: str
    landing_benefit1_body: str
    landing_benefit2_title: str
    landing_benefit2_body: str
    landing_benefit3_title: str
    landing_benefit3_body: str
    has_hero_image: bool
    hero_image_version: int | None
    landing_about_title: str
    landing_about_body: str
    has_landing_about_image: bool
    landing_about_image_version: int | None
    has_landing_cta_image: bool
    landing_cta_image_version: int | None


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
    has_photo: bool
    photo_version: int | None
    price_per_day: float
    # Identifies this vehicle's photo (see GET /api/public/cars/{offer_key}/photo)
    # without exposing which actual car it is — the same opaque, non-guessable
    # key used elsewhere to address a group of identical cars as one offer.
    offer_key: str
    # Set when the offer is a vehicle class: its address, and the business's own
    # words per language. make/model are then an example ("... or similar") and
    # the specs below span every car in the class.
    class_slug: str | None = None
    class_name: dict[str, str] | None = None
    class_description: dict[str, str] | None = None
    seats_min: int | None = None
    seats_max: int | None = None
    transmissions: list[str] = []
    fuel_types: list[str] = []


class PublicOffer(PublicVehicle):
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


class PublicCustomer(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: date
    address: str = Field(min_length=1, max_length=255)
    postal_code: str = Field(min_length=1, max_length=20)
    phone_number: str = Field(min_length=3, max_length=30)
    email: str = Field(min_length=3, max_length=254)
    nationality: str | None = Field(default=None, max_length=100)

    @field_validator("nationality")
    @classmethod
    def nationality_is_a_country(cls, value: str | None) -> str | None:
        return check_nationality(value)

    @field_validator("email")
    @classmethod
    def looks_like_an_email(cls, value: str) -> str:
        value = value.strip()

        if "@" not in value or value.startswith("@") or value.endswith("@") or " " in value:
            raise PydanticCustomError("validation.email_invalid", "Enter a valid email address.")

        return value


class PublicBookingRequest(BaseModel):
    offer_key: str = Field(min_length=8, max_length=64)
    pickup_location_id: UUID
    return_location_id: UUID
    pickup_at: datetime
    return_at: datetime
    extras: list[ExtraSelectionRequest] = []
    customer: PublicCustomer
    # The total the renter was shown. If it no longer matches, nothing is held.
    expected_total: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    terms_accepted: bool
    privacy_acknowledged: bool
    # The language the visitor is using; the booking emails are written in it.
    language: Literal["en", "it", "pl"] | None = None
    # Cloudflare Turnstile's token for this attempt.
    captcha_token: str | None = Field(default=None, max_length=4096)


class PublicBookingCreated(BaseModel):
    reference: str
    status: str
    hold_expires_at: datetime
    currency: str
    total_amount: float
    online_amount: float
    due_at_pickup: float
    # Stripe's secret for confirming this one payment in the browser.
    client_secret: str
    # Lets this browser act on the booking for the next hour.
    manage_token: str


class PublicBookingStatus(BaseModel):
    reference: str
    status: str
    hold_expires_at: datetime | None
    payment_status: str | None


class PublicBookingExtra(BaseModel):
    name: str
    quantity: int


class PublicBooking(BaseModel):
    """A booking as its renter sees it. No plate, no ids, nothing internal."""

    reference: str
    status: str
    pickup_at: datetime
    return_at: datetime
    pickup_location: PublicLocation
    return_location: PublicLocation
    vehicle: PublicVehicle
    extras: list[PublicBookingExtra]

    currency: str
    total_amount: float
    paid_online: float
    refunded_online: float
    due_at_pickup: float

    hold_expires_at: datetime | None
    cancellation_deadline_at: datetime | None
    can_cancel: bool
    # Whether cancelling right now gives the online share back.
    cancel_refunds_online: bool


class PublicBookingLookup(BaseModel):
    reference: str = Field(min_length=4, max_length=20)
    email: str = Field(min_length=3, max_length=254)
    captcha_token: str | None = Field(default=None, max_length=4096)


class PublicBookingAccess(BaseModel):
    manage_token: str
    booking: PublicBooking


class AccountRegister(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    captcha_token: str | None = Field(default=None, max_length=4096)
    # The language of the page, for the emails the account gets.
    language: str | None = Field(default=None, max_length=5)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        return check_password_bytes(value)


class AccountForgotPassword(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    captcha_token: str | None = Field(default=None, max_length=4096)


class AccountResetPassword(BaseModel):
    token: str = Field(min_length=10, max_length=2000)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        return check_password_bytes(value)


class AccountLinkToken(BaseModel):
    token: str = Field(min_length=10, max_length=2000)


class AccountStatus(BaseModel):
    status: str


class AccountLogin(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)
    captcha_token: str | None = Field(default=None, max_length=4096)


class AccountProfile(BaseModel):
    email: str
    first_name: str
    last_name: str
    email_verified: bool


class AccountSession(BaseModel):
    access_token: str
    account: AccountProfile


class AccountClaim(BaseModel):
    reference: str = Field(min_length=4, max_length=20)
    email: str = Field(min_length=3, max_length=254)


class AccountBookingAccess(BaseModel):
    manage_token: str
