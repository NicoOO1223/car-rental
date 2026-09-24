from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.pricing import PriceBreakdownExtraLine


class HandoverResponse(BaseModel):
    id: UUID
    reservation_id: UUID

    stripe_payment_intent_id: str | None
    payment_amount: float | None
    payment_currency: str | None
    payment_status: str
    payment_method: str | None
    paid_at: datetime | None

    refund_amount: float | None
    refunded_at: datetime | None
    stripe_refund_id: str | None

    # Security deposit. deposit_status is null when none was involved.
    deposit_amount: float | None
    deposit_currency: str | None
    deposit_method: str | None
    deposit_status: str | None
    deposit_held_at: datetime | None
    deposit_settled_at: datetime | None
    deposit_captured_amount: float | None

    signed_at: datetime | None
    has_signature: bool

    # Who approved the handover, with their signature. Unlike the customer's
    # signature, the image is returned: the reservation page displays it.
    employee_signed_at: datetime | None
    has_employee_signature: bool
    employee_signed_by_email: str | None
    employee_signature_image: str | None

    generated_at: datetime | None
    has_agreement: bool

    @classmethod
    def from_model(cls, handover) -> "HandoverResponse":
        return cls(
            id=handover.id,
            reservation_id=handover.reservation_id,
            stripe_payment_intent_id=handover.stripe_payment_intent_id,
            payment_amount=(
                float(handover.payment_amount)
                if handover.payment_amount is not None
                else None
            ),
            payment_currency=handover.payment_currency,
            payment_status=handover.payment_status,
            payment_method=handover.payment_method,
            paid_at=handover.paid_at,
            refund_amount=(
                float(handover.refund_amount)
                if handover.refund_amount is not None
                else None
            ),
            refunded_at=handover.refunded_at,
            stripe_refund_id=handover.stripe_refund_id,
            deposit_amount=(
                float(handover.deposit_amount)
                if handover.deposit_amount is not None
                else None
            ),
            deposit_currency=handover.deposit_currency,
            deposit_method=handover.deposit_method,
            deposit_status=handover.deposit_status,
            deposit_held_at=handover.deposit_held_at,
            deposit_settled_at=handover.deposit_settled_at,
            deposit_captured_amount=(
                float(handover.deposit_captured_amount)
                if handover.deposit_captured_amount is not None
                else None
            ),
            signed_at=handover.signed_at,
            has_signature=handover.signature_image is not None,
            employee_signed_at=handover.employee_signed_at,
            has_employee_signature=handover.employee_signature_image is not None,
            employee_signed_by_email=(
                handover.employee_signer.email
                if handover.employee_signer is not None
                else None
            ),
            employee_signature_image=handover.employee_signature_image,
            generated_at=handover.generated_at,
            has_agreement=handover.agreement_pdf is not None,
        )


class SignatureSubmit(BaseModel):
    signature_image: str


class PaymentIntentResponse(BaseModel):
    client_secret: str | None
    payment_status: str
    payment_amount: float | None
    payment_currency: str | None

    # Itemized breakdown of payment_amount, so the counter screen can show
    # exactly what is being charged. Shares its shape with the pre-booking
    # quote (POST /api/reservations/quote), so one frontend component
    # renders both.
    base_amount: float
    short_term_fee: float
    airport_change_fee: float

    # Booked add-ons, at the prices they were booked at. Added alongside
    # the flat fields above rather than replacing them, so existing
    # consumers keep working.
    extras: list[PriceBreakdownExtraLine] = []
    extras_amount: float = 0.0


class DepositIntentResponse(BaseModel):
    client_secret: str | None
    deposit_status: str | None
    deposit_amount: float | None
    deposit_currency: str | None
