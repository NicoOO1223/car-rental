from datetime import date, datetime, timezone
from uuid import UUID

import stripe
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.errors import AppError, NotFoundError
from app.config import STRIPE_SECRET_KEY
from app.models import CheckOut, Customer, Handover, Reservation, User
from app.schemas.customer import CustomerDataExport, CustomerExportReservation
from app.services.audit import audit_log
from app.services.identity_details import build_identity_details_for_export

stripe.api_key = STRIPE_SECRET_KEY

# Placeholder values for the NOT NULL PII columns — Customer.first_name,
# last_name, date_of_birth, address, and postal_code have no "empty"
# state at the schema level, so erasure overwrites them with a fixed
# sentinel rather than trying to null them out.
ERASED_TEXT = "[Erased]"
ERASED_DATE = date(1900, 1, 1)
ERASED_POSTAL_CODE = "00000"

# A customer whose car is still out, or about to go out, can't be
# erased — staff still need their real contact/identity info to run
# that rental and process the handover/return.
BLOCKING_RESERVATION_STATUSES = {"ACTIVE", "CONFIRMED"}


def _get_customer(db: Session, customer_id: UUID) -> Customer:
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise NotFoundError("customer.not_found", "Customer not found.")

    return customer


def anonymize_customer(db: Session, customer_id: UUID, actor: User) -> Customer:
    """
    Right to erasure (GDPR Art. 17): blanks the customer's PII in place
    rather than deleting the row. Reservation/Handover rows reference
    customers.id with no ondelete cascade, so a hard delete is rejected
    outright the moment any reservation exists — and even without that
    constraint, the business still needs those rows for its own
    accounting/legal record-keeping, which Art. 17(3)(b) exempts from
    erasure. Past agreement PDFs are deliberately left untouched for the
    same reason; only the live Customer fields and captured signature
    images are cleared.
    """

    customer = _get_customer(db, customer_id)

    if customer.anonymized_at is not None:
        raise AppError("customer.customer_data_already_erased", "Customer data has already been erased.")

    blocking_reservation = db.scalar(
        select(Reservation.id).where(
            Reservation.customer_id == customer_id,
            Reservation.status.in_(BLOCKING_RESERVATION_STATUSES),
        )
    )

    if blocking_reservation is not None:
        raise AppError("customer.cannot_erase_customer_with_active_or", "Cannot erase a customer with an active or upcoming reservation.")

    reservation_count = db.scalar(
        select(func.count(Reservation.id)).where(
            Reservation.customer_id == customer_id
        )
    ) or 0

    stripe_session_id = customer.identity_verification_session_id

    customer.first_name = ERASED_TEXT
    customer.last_name = ERASED_TEXT
    customer.date_of_birth = ERASED_DATE
    customer.address = ERASED_TEXT
    customer.postal_code = ERASED_POSTAL_CODE
    customer.phone_number = None
    customer.email = None
    customer.nationality = None

    customer.national_id_number = None
    customer.id_document_type = None
    customer.id_document_number = None
    customer.id_document_expires_at = None
    customer.driving_license_number = None
    customer.driving_license_country = None
    customer.driving_license_categories = None
    customer.driving_license_issued_at = None
    customer.driving_license_expires_at = None
    customer.identity_checked_at = None
    customer.identity_checked_by = None

    customer.identity_verification_session_id = None
    customer.identity_verification_status = None
    customer.identity_document_type = None
    customer.identity_issuing_country = None
    customer.identity_verified_at = None

    customer.anonymized_at = datetime.now(timezone.utc)

    handovers = db.scalars(
        select(Handover)
        .join(Reservation, Handover.reservation_id == Reservation.id)
        .where(Reservation.customer_id == customer_id)
    ).all()

    for handover in handovers:
        handover.signature_image = None

    if stripe_session_id and stripe.api_key:
        try:
            stripe.identity.VerificationSession.redact(stripe_session_id)
        except stripe.StripeError:
            # Best-effort: the local erasure above is the primary
            # compliance action. A Stripe-side hiccup (already redacted,
            # session expired, network blip) shouldn't block it — there's
            # nothing more this app can automatically do about it anyway.
            pass

    audit_log(
        db,
        user=actor,
        action="customer.anonymized",
        entity_type="customer",
        entity_id=customer.id,
        metadata={"reservation_count": reservation_count},
    )

    db.commit()
    db.refresh(customer)

    return customer


def export_customer_data(
    db: Session, customer_id: UUID, actor: User
) -> CustomerDataExport:
    """Right to access / data portability (GDPR Art. 15/20)."""

    customer = _get_customer(db, customer_id)

    reservations = db.scalars(
        select(Reservation)
        .where(Reservation.customer_id == customer_id)
        .options(
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .order_by(Reservation.pickup_at.desc())
    ).all()

    handovers_by_reservation_id = {
        handover.reservation_id: handover
        for handover in db.scalars(
            select(Handover).where(
                Handover.reservation_id.in_([r.id for r in reservations])
            )
        ).all()
    }

    check_outs_by_reservation_id = {
        check_out.reservation_id: check_out
        for check_out in db.scalars(
            select(CheckOut).where(
                CheckOut.reservation_id.in_([r.id for r in reservations])
            )
        ).all()
    }

    export_reservations = []

    for reservation in reservations:
        handover = handovers_by_reservation_id.get(reservation.id)
        check_out = check_outs_by_reservation_id.get(reservation.id)

        export_reservations.append(
            CustomerExportReservation(
                id=reservation.id,
                car_make=reservation.car.make,
                car_model=reservation.car.model,
                car_license_plate=reservation.car.license_plate,
                pickup_location_code=reservation.pickup_location.airport_code,
                return_location_code=reservation.return_location.airport_code,
                pickup_at=reservation.pickup_at,
                return_at=reservation.return_at,
                status=reservation.status,
                payment_status=handover.payment_status if handover else None,
                payment_method=handover.payment_method if handover else None,
                payment_amount=(
                    float(handover.payment_amount)
                    if handover and handover.payment_amount is not None
                    else None
                ),
                payment_currency=handover.payment_currency if handover else None,
                has_signature=bool(handover and handover.signature_image is not None),
                has_agreement=bool(handover and handover.agreement_pdf is not None),
                check_out_completed=bool(check_out and check_out.completed_at is not None),
                check_out_total_charge=(
                    float(check_out.total_charge) if check_out else None
                ),
                check_out_payment_status=(
                    check_out.payment_status if check_out else None
                ),
                deposit_status=handover.deposit_status if handover else None,
                deposit_amount=(
                    float(handover.deposit_amount)
                    if handover and handover.deposit_amount is not None
                    else None
                ),
                deposit_captured_amount=(
                    float(handover.deposit_captured_amount)
                    if handover and handover.deposit_captured_amount is not None
                    else None
                ),
            )
        )

    bundle = CustomerDataExport(
        id=customer.id,
        first_name=customer.first_name,
        last_name=customer.last_name,
        date_of_birth=customer.date_of_birth,
        address=customer.address,
        postal_code=customer.postal_code,
        phone_number=customer.phone_number,
        email=customer.email,
        nationality=customer.nationality,
        created_at=customer.created_at,
        anonymized_at=customer.anonymized_at,
        identity_verification=customer.identity_verification,
        identity_details=build_identity_details_for_export(customer),
        reservations=export_reservations,
        exported_at=datetime.now(timezone.utc),
    )

    audit_log(
        db,
        user=actor,
        action="customer.data_exported",
        entity_type="customer",
        entity_id=customer.id,
        metadata={"reservation_count": len(export_reservations)},
    )

    db.commit()

    return bundle
