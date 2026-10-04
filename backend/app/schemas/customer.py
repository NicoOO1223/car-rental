import re
from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

# The limits are the columns' (app/models/customer.py): a longer value would
# be refused by the database and surface as a server error instead of a message
# next to the field.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Address = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
PostalCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
PhoneNumber = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=30)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254)]

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_COUNTRY = re.compile(r"^[A-Za-z]{2}$")


def check_email(value: str) -> str:
    if not _EMAIL.match(value):
        raise PydanticCustomError("validation.email_invalid", "Enter a valid email address.")

    return value


def check_nationality(value: str | None) -> str | None:
    """A nationality is an ISO 3166-1 alpha-2 country code ("IT"), which is what
    the column holds. Blank means not given."""

    if value is None:
        return None

    value = value.strip()

    if not value:
        return None

    if not _COUNTRY.match(value):
        raise PydanticCustomError("validation.nationality_invalid", "Choose a country.")

    return value.upper()


class CustomerUpdate(BaseModel):
    first_name: Name | None = None
    last_name: Name | None = None
    date_of_birth: date | None = None
    address: Address | None = None
    postal_code: PostalCode | None = None
    phone_number: PhoneNumber | None = None
    email: Email | None = None
    nationality: str | None = None

    @field_validator("first_name", "last_name", "date_of_birth", "address", "postal_code", mode="before")
    @classmethod
    def required_fields_cannot_be_cleared(cls, value):
        # Left out means unchanged; sent as null would try to empty a column
        # that has to hold something.
        if value is None:
            raise PydanticCustomError("validation.cannot_be_cleared", "This cannot be left empty.")

        return value

    @field_validator("email")
    @classmethod
    def email_looks_valid(cls, value: str | None) -> str | None:
        return check_email(value) if value is not None else None

    @field_validator("nationality")
    @classmethod
    def nationality_is_a_country(cls, value: str | None) -> str | None:
        return check_nationality(value)


class IdentityVerificationSummary(BaseModel):
    status: str | None
    document_type: str | None
    issuing_country: str | None
    verified_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class IdentityDetailsUpdate(BaseModel):
    """What staff type in at the counter."""

    # Optional: not every country has one. Either this or an ID document
    # number has to be given (checked in app/services/identity_details.py).
    national_id_number: str | None = None
    id_document_type: str | None = None
    id_document_number: str | None = None
    id_document_expires_at: date | None = None
    driving_license_number: str
    driving_license_country: str | None = None
    driving_license_categories: str | None = None
    driving_license_issued_at: date | None = None
    driving_license_expires_at: date
    # The employee attests they checked the original documents.
    documents_checked: bool


class IdentityDetailsResponse(BaseModel):
    customer_id: UUID

    national_id_number: str | None
    id_document_type: str | None
    id_document_number: str | None
    id_document_expires_at: date | None
    driving_license_number: str | None
    driving_license_country: str | None
    driving_license_categories: str | None
    driving_license_issued_at: date | None
    driving_license_expires_at: date | None

    identity_checked_at: datetime | None
    identity_checked_by_email: str | None

    # Verified through the old Stripe Identity flow; still accepted.
    legacy_stripe_verified: bool

    # Why the recorded details can't yet back a rental; None when they can.
    problem: str | None
    # A stable code for `problem`, so the interface can show it in the
    # user's language (see app/errors.py).
    problem_code: str | None = None


class CustomerResponse(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str | None
    email: str | None
    nationality: str | None
    created_at: datetime
    anonymized_at: datetime | None
    identity_verification: IdentityVerificationSummary | None

    model_config = ConfigDict(from_attributes=True)


class CustomerListItem(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    # Left out (null) with the phone and email masked when the viewer's role does
    # not browse customers' details in full; see `masked`.
    date_of_birth: date | None
    address: str | None
    postal_code: str
    phone_number: str | None
    email: str | None
    nationality: str | None
    created_at: datetime
    anonymized_at: datetime | None

    reservation_count: int
    last_reservation_at: datetime | None

    # True when the contact details above are hidden for this viewer.
    masked: bool = False


class CustomerPage(BaseModel):
    items: list[CustomerListItem]
    total: int
    limit: int
    offset: int


class CustomerSummaryStats(BaseModel):
    total: int
    new_this_week: int
    repeat_customers: int
    total_reservations: int
    avg_reservations: float


class CustomerExportReservation(BaseModel):
    id: UUID

    car_make: str
    car_model: str
    car_license_plate: str

    pickup_location_code: str
    return_location_code: str

    pickup_at: datetime
    return_at: datetime
    status: str

    payment_status: str | None
    payment_method: str | None
    payment_amount: float | None
    payment_currency: str | None

    has_signature: bool
    has_agreement: bool

    # Return charges (late/fuel/damage), once the car was checked back in.
    check_out_completed: bool
    check_out_total_charge: float | None
    check_out_payment_status: str | None

    # Security deposit (null when none was taken).
    deposit_status: str | None
    deposit_amount: float | None
    deposit_captured_amount: float | None


class CustomerDataExport(BaseModel):
    """
    The right-to-access / data-portability bundle (GDPR Art. 15/20) for
    one customer — everything this app holds about them, in one
    structured document. Deliberately excludes raw binary blobs
    (signature images, agreement PDFs) — those stay as internal records,
    downloadable individually where they already are (the handover
    screen, the agreement download endpoint), rather than duplicated
    inline here.
    """

    id: UUID
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str | None
    email: str | None
    nationality: str | None
    created_at: datetime
    anonymized_at: datetime | None
    identity_verification: IdentityVerificationSummary | None
    identity_details: IdentityDetailsResponse | None

    reservations: list[CustomerExportReservation]

    exported_at: datetime
