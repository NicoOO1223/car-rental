from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_authenticated_user
from app.models import User
from app.schemas.pricing import PriceBreakdownExtraLine
from app.schemas.handover import (
    DepositIntentResponse,
    HandoverResponse,
    PaymentIntentResponse,
    SignatureSubmit,
)
from app.services.deposits import (
    confirm_cash_deposit,
    confirm_deposit_hold,
    create_or_reuse_deposit_intent,
)
from app.services.handovers import (
    confirm_cash_payment,
    confirm_payment,
    create_or_reuse_payment_intent,
    generate_agreement,
    get_or_create_handover,
    submit_employee_signature,
    submit_signature,
)

router = APIRouter(
    prefix="/api/reservations/{reservation_id}/handover",
    tags=["Handover"],
    dependencies=[Depends(require_authenticated_user)],
)


def _raise_for_value_error(exc: ValueError):
    if str(exc) == "Reservation not found.":
        raise HTTPException(status_code=404, detail=str(exc))

    raise HTTPException(status_code=400, detail=str(exc))


@router.get("", response_model=HandoverResponse)
def get_handover_state(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = get_or_create_handover(db, reservation_id, actor=current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/payment-intent", response_model=PaymentIntentResponse)
def create_payment_intent_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover, intent, breakdown = create_or_reuse_payment_intent(
            db, reservation_id, actor=current_user
        )
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
        vat_rate=float(breakdown.vat_rate),
        vat_amount=float(breakdown.vat_amount),
        net_amount=float(breakdown.net_amount),
        prices_include_vat=breakdown.prices_include_vat,
    )


@router.post("/confirm-payment", response_model=HandoverResponse)
def confirm_payment_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = confirm_payment(db, reservation_id, actor=current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/confirm-cash-payment", response_model=HandoverResponse)
def confirm_cash_payment_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = confirm_cash_payment(db, reservation_id, actor=current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/signature", response_model=HandoverResponse)
def submit_signature_endpoint(
    reservation_id: UUID,
    data: SignatureSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = submit_signature(
            db, reservation_id, data.signature_image, actor=current_user
        )
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/deposit/intent", response_model=DepositIntentResponse)
def create_deposit_intent_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover, intent = create_or_reuse_deposit_intent(
            db, reservation_id, current_user
        )
    except ValueError as exc:
        _raise_for_value_error(exc)

    return DepositIntentResponse(
        client_secret=intent.client_secret,
        deposit_status=handover.deposit_status,
        deposit_amount=(
            float(handover.deposit_amount)
            if handover.deposit_amount is not None
            else None
        ),
        deposit_currency=handover.deposit_currency,
    )


@router.post("/deposit/confirm", response_model=HandoverResponse)
def confirm_deposit_hold_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = confirm_deposit_hold(db, reservation_id, current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/deposit/confirm-cash", response_model=HandoverResponse)
def confirm_cash_deposit_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = confirm_cash_deposit(db, reservation_id, current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/employee-signature", response_model=HandoverResponse)
def submit_employee_signature_endpoint(
    reservation_id: UUID,
    data: SignatureSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = submit_employee_signature(
            db, reservation_id, data.signature_image, actor=current_user
        )
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.post("/agreement", response_model=HandoverResponse)
def generate_agreement_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = generate_agreement(db, reservation_id, actor=current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return HandoverResponse.from_model(handover)


@router.get("/agreement/download")
def download_agreement_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        handover = get_or_create_handover(db, reservation_id, actor=current_user)
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
