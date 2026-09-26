from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CustomerUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    date_of_birth: date | None = None
    address: str | None = None
    postal_code: str | None = None
    phone_number: str | None = None
    email: str | None = None
    nationality: str | None = None


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
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str | None
    email: str | None
    nationality: str | None
    created_at: datetime
    anonymized_at: datetime | None

    reservation_count: int
    last_reservation_at: datetime | None


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
