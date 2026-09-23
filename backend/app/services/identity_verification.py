from datetime import datetime
from uuid import UUID

import stripe
from sqlalchemy.orm import Session

from app.config import STRIPE_SECRET_KEY
from app.models import Customer, User
from app.services.audit import audit_log

stripe.api_key = STRIPE_SECRET_KEY

# Minimal tier only: document + selfie-match check, non-sensitive result
# fields (status, document type, issuing country) readable with the
# plain secret key above. No document number, DOB, or images are ever
# requested or stored — see app/models/customer.py for the rationale.

# Statuses for which an existing VerificationSession should be reused
# rather than recreated, per Stripe's own guidance.
_REUSABLE_STATUSES = {"requires_input", "processing"}


def _require_stripe_configured() -> None:
    if not stripe.api_key:
        raise ValueError(
            "Stripe is not configured on the server. Set STRIPE_SECRET_KEY "
            "in backend/.env to enable identity verification."
        )


def _get_customer(db: Session, customer_id: UUID) -> Customer:
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise ValueError("Customer not found.")

    return customer


def _record_status_change(db: Session, customer: Customer, actor: User, previous_status: str | None) -> None:
    if customer.identity_verification_status != previous_status:
        audit_log(
            db,
            user=actor,
            action="customer.identity_verification_updated",
            entity_type="customer",
            entity_id=customer.id,
            metadata={"status": customer.identity_verification_status},
        )


def create_verification_session(
    db: Session, customer_id: UUID, actor: User
) -> tuple[Customer, str]:
    """
    Creates a Stripe Identity VerificationSession (document + selfie
    match) for the customer, reusing an in-flight session rather than
    creating a duplicate on retry, per Stripe's own best practice.
    Returns the updated Customer plus the client_secret the frontend
    passes to stripe.verifyIdentity().
    """

    _require_stripe_configured()

    customer = _get_customer(db, customer_id)
    previous_status = customer.identity_verification_status

    try:
        if (
            customer.identity_verification_session_id
            and customer.identity_verification_status in _REUSABLE_STATUSES
        ):
            session = stripe.identity.VerificationSession.retrieve(
                customer.identity_verification_session_id
            )
        else:
            session = stripe.identity.VerificationSession.create(
                type="document",
                options={"document": {"require_matching_selfie": True}},
                metadata={"customer_id": str(customer_id)},
            )
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    customer.identity_verification_session_id = session.id
    customer.identity_verification_status = session.status

    _record_status_change(db, customer, actor, previous_status)

    db.commit()
    db.refresh(customer)

    return customer, session.client_secret


def refresh_verification_status(db: Session, customer_id: UUID, actor: User) -> Customer:
    """
    Re-checks the customer's VerificationSession against Stripe and
    updates the cached status/document fields. Only writes an audit row
    when the status actually changed, so repeated manual "check status"
    clicks while Stripe is still processing don't spam the audit log.
    """

    _require_stripe_configured()

    customer = _get_customer(db, customer_id)

    if not customer.identity_verification_session_id:
        raise ValueError("No identity verification has been started for this customer.")

    try:
        session = stripe.identity.VerificationSession.retrieve(
            customer.identity_verification_session_id,
            expand=["last_verification_report"],
        )
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    previous_status = customer.identity_verification_status
    customer.identity_verification_status = session.status

    report = session.last_verification_report
    if report is not None and report.document is not None:
        customer.identity_document_type = report.document.type
        customer.identity_issuing_country = report.document.issuing_country

    if session.status == "verified" and customer.identity_verified_at is None:
        customer.identity_verified_at = datetime.utcnow()

    _record_status_change(db, customer, actor, previous_status)

    db.commit()
    db.refresh(customer)

    return customer
