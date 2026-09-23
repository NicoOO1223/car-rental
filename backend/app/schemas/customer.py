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

    reservations: list[CustomerExportReservation]

    exported_at: datetime
