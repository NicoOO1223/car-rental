from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.schemas.pricing import PriceBreakdownExtraLine
from app.schemas.handover import (
    HandoverResponse,
    PaymentIntentResponse,
    SignatureSubmit,
)
from app.services.handovers import (
    confirm_payment,
    create_or_reuse_payment_intent,
    generate_agreement,
    get_or_create_handover,
    submit_signature,
)

router = APIRouter(
    prefix="/api/reservations/{reservation_id}/handover",
    tags=["Handover"],
    dependencies=[Depends(get_current_user)],
)


def _raise_for_value_error(exc: ValueError):
    if str(exc) == "Reservation not found.":
        raise HTTPException(status_code=404, detail=str(exc))

    raise HTTPException(status_code=400, detail=str(exc))


@router.get("", response_model=HandoverResponse)
def get_handover_state(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        handover = get_or_create_handover(db, reservation_id)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/payment-intent", response_model=PaymentIntentResponse)
def create_payment_intent_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        handover, intent, breakdown = create_or_reuse_payment_intent(db, reservation_id)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return PaymentIntentResponse(
        client_secret=intent.client_secret,
        payment_status=handover.payment_status,
        payment_amount=(
            float(handover.payment_amount)
            if handover.payment_amount is not None
            else None
        ),
        payment_currency=handover.payment_currency,
        base_amount=float(breakdown.base_amount),
        short_term_fee=float(breakdown.short_term_fee),
        airport_change_fee=float(breakdown.airport_change_fee),
        extras=[
            PriceBreakdownExtraLine(
                code=line.code,
                name=line.name,
                quantity=line.quantity,
                unit_price=float(line.unit_price),
                price_unit=line.price_unit,
                amount=float(line.amount),
            )
            for line in breakdown.extras
        ],
        extras_amount=float(breakdown.extras_amount),
    )


@router.post("/confirm-payment", response_model=HandoverResponse)
def confirm_payment_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        handover = confirm_payment(db, reservation_id)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/signature", response_model=HandoverResponse)
def submit_signature_endpoint(
    reservation_id: UUID,
    data: SignatureSubmit,
    db: Session = Depends(get_db),
):
    try:
        handover = submit_signature(db, reservation_id, data.signature_image)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/agreement", response_model=HandoverResponse)
def generate_agreement_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        handover = generate_agreement(db, reservation_id)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.get("/agreement/download")
def download_agreement_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        handover = get_or_create_handover(db, reservation_id)
    except ValueError as exc:
        _raise_for_value_error(exc)

    if handover.agreement_pdf is None:
        raise HTTPException(status_code=404, detail="Agreement has not been generated yet.")

    return Response(
        content=handover.agreement_pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="agreement-{reservation_id}.pdf"'
        },
    )
