from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import Customer, Reservation, User
from app.schemas.customer import IdentityDetailsResponse, IdentityDetailsUpdate
from app.services.audit import audit_log

DOCUMENT_TYPES = {"ID_CARD", "PASSPORT", "RESIDENCE_PERMIT"}

_PESEL_WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)

# The fields staff type in; used to report which ones a save changed
# (names only — the values are sensitive and never go in the audit log).
_DETAIL_FIELDS = (
    "national_id_number",
    "id_document_type",
    "id_document_number",
    "id_document_expires_at",
    "driving_license_number",
    "driving_license_country",
    "driving_license_categories",
    "driving_license_issued_at",
    "driving_license_expires_at",
)


def is_valid_pesel(value: str) -> bool:
    if len(value) != 11 or not value.isdigit():
        return False

    digits = [int(char) for char in value]
    checksum = sum(w * d for w, d in zip(_PESEL_WEIGHTS, digits)) % 10

    return (10 - checksum) % 10 == digits[10]


def _get_customer(db: Session, customer_id: UUID) -> Customer:
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise ValueError("Customer not found.")

    return customer


def identity_problem(customer: Customer, return_at: datetime | None = None) -> str | None:
    """
    Why this customer's recorded identity can't yet back a rental, or None
    when it can. A customer verified through the old Stripe Identity flow
    still counts. Otherwise some form of ID number and the driving licence
    must be on file, an employee must have confirmed the original
    documents, and the licence must still be valid when the rental ends.

    Not every country issues a national ID number, so what identifies the
    person is either that number or the number of an ID document such as a
    passport.
    """

    if customer.identity_verification_status == "verified":
        return None

    if customer.anonymized_at is not None:
        return "This customer's data has been erased."

    if not (customer.national_id_number or customer.id_document_number):
        return "Enter the customer's ID number, or the number of an ID document such as a passport."

    if not customer.driving_license_number or customer.driving_license_expires_at is None:
        return "Enter the customer's driving licence number and expiry date."

    if customer.identity_checked_at is None:
        return "An employee must confirm the original documents were checked."

    last_day = (return_at or datetime.now(timezone.utc)).date()

    if customer.driving_license_expires_at < last_day:
        return "The driving licence expires before the rental ends."

    return None


def _build_response(
    customer: Customer, return_at: datetime | None
) -> IdentityDetailsResponse:
    checker = customer.identity_checker

    return IdentityDetailsResponse(
        customer_id=customer.id,
        national_id_number=customer.national_id_number,
        id_document_type=customer.id_document_type,
        id_document_number=customer.id_document_number,
        id_document_expires_at=customer.id_document_expires_at,
        driving_license_number=customer.driving_license_number,
        driving_license_country=customer.driving_license_country,
        driving_license_categories=customer.driving_license_categories,
        driving_license_issued_at=customer.driving_license_issued_at,
        driving_license_expires_at=customer.driving_license_expires_at,
        identity_checked_at=customer.identity_checked_at,
        identity_checked_by_email=checker.email if checker is not None else None,
        legacy_stripe_verified=customer.identity_verification_status == "verified",
        problem=identity_problem(customer, return_at),
    )


def build_identity_details_for_export(customer: Customer) -> IdentityDetailsResponse | None:
    """The stored details for a data-access export, or None if none were entered."""

    if customer.national_id_number is None and customer.driving_license_number is None:
        return None

    return _build_response(customer, None)


def _return_at_for(
    db: Session, customer_id: UUID, reservation_id: UUID | None
) -> datetime | None:
    if reservation_id is None:
        return None

    reservation = db.get(Reservation, reservation_id)

    if reservation is None or reservation.customer_id != customer_id:
        raise ValueError("Reservation not found for this customer.")

    return reservation.return_at


def get_identity_details(
    db: Session,
    customer_id: UUID,
    actor: User,
    reservation_id: UUID | None = None,
) -> IdentityDetailsResponse:
    """Sensitive data, so every read is audited (like customer.viewed)."""

    customer = _get_customer(db, customer_id)
    return_at = _return_at_for(db, customer_id, reservation_id)

    audit_log(
        db,
        user=actor,
        action="customer.identity_details_viewed",
        entity_type="customer",
        entity_id=customer.id,
    )
    db.commit()

    return _build_response(customer, return_at)


def save_identity_details(
    db: Session,
    customer_id: UUID,
    data: IdentityDetailsUpdate,
    actor: User,
    reservation_id: UUID | None = None,
) -> IdentityDetailsResponse:
    customer = _get_customer(db, customer_id)
    return_at = _return_at_for(db, customer_id, reservation_id)

    if customer.anonymized_at is not None:
        raise ValueError("This customer's data has been erased.")

    if not data.documents_checked:
        raise ValueError("Confirm that you checked the customer's original documents.")

    national_id = (data.national_id_number or "").strip().replace(" ", "")
    document_number = (data.id_document_number or "").strip() or None

    if not (national_id or document_number):
        raise ValueError(
            "Enter the customer's ID number, or the number of an ID document such as a passport."
        )

    # The one country-specific rule: a Polish customer's national number is
    # a PESEL, which has a checksum. Only checked when one is entered.
    if national_id and customer.nationality == "PL" and not is_valid_pesel(national_id):
        raise ValueError("That is not a valid PESEL.")

    license_number = data.driving_license_number.strip()

    if not license_number:
        raise ValueError("The driving licence number is required.")

    if data.driving_license_expires_at < datetime.now(timezone.utc).date():
        raise ValueError("The driving licence has expired.")

    if (
        data.driving_license_issued_at is not None
        and data.driving_license_issued_at >= data.driving_license_expires_at
    ):
        raise ValueError("The licence must be issued before it expires.")

    if document_number and data.id_document_type not in DOCUMENT_TYPES:
        raise ValueError("Select the ID document type.")

    country = (data.driving_license_country or "").strip().upper() or None

    if country is not None and len(country) != 2:
        raise ValueError("Use a 2-letter country code for the licence.")

    new_values = {
        "national_id_number": national_id or None,
        "id_document_type": data.id_document_type if document_number else None,
        "id_document_number": document_number,
        "id_document_expires_at": (
            data.id_document_expires_at if document_number else None
        ),
        "driving_license_number": license_number,
        "driving_license_country": country,
        "driving_license_categories": (
            (data.driving_license_categories or "").strip() or None
        ),
        "driving_license_issued_at": data.driving_license_issued_at,
        "driving_license_expires_at": data.driving_license_expires_at,
    }

    changed = [
        field
        for field in _DETAIL_FIELDS
        if getattr(customer, field) != new_values[field]
    ]

    for field, value in new_values.items():
        setattr(customer, field, value)

    customer.identity_checked_at = datetime.now(timezone.utc)
    customer.identity_checked_by = actor.id

    audit_log(
        db,
        user=actor,
        action="customer.identity_details_updated",
        entity_type="customer",
        entity_id=customer.id,
        metadata={"changed_fields": changed},
    )

    db.commit()
    db.refresh(customer)

    return _build_response(customer, return_at)
