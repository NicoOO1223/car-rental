from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class HandoverResponse(BaseModel):
    id: UUID
    reservation_id: UUID

    stripe_payment_intent_id: str | None
    payment_amount: float | None
    payment_currency: str | None
    payment_status: str
    paid_at: datetime | None

    signed_at: datetime | None
    has_signature: bool

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
            paid_at=handover.paid_at,
            signed_at=handover.signed_at,
            has_signature=handover.signature_image is not None,
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

    # Itemized breakdown of payment_amount — lets the frontend show the
    # surcharges (short-term rental, airport change) without duplicating
    # the pricing rules in JS beyond the pre-booking estimate.
    base_amount: float
    short_term_fee: float
    airport_change_fee: float
