from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_authenticated_user
from app.models import Handover, User
from app.schemas.check_out import (
    CheckOutCompleteResponse,
    CheckOutConditionInput,
    CheckOutPaymentIntentResponse,
    CheckOutResponse,
    CheckOutWaiveInput,
)
from app.schemas.handover import SignatureSubmit
from app.services.check_outs import (
    complete_check_out,
    confirm_cash_payment,
    confirm_payment,
    create_or_reuse_payment_intent,
    get_check_out,
    save_condition,
    settle_deposit_step,
    submit_employee_signature,
    waive_charges,
)

router = APIRouter(
    prefix="/api/reservations/{reservation_id}/check-out",
    tags=["Check-out"],
    dependencies=[Depends(require_authenticated_user)],
)


def _response(db: Session, check_out) -> CheckOutResponse:
    handover = db.scalar(
        select(Handover).where(Handover.reservation_id == check_out.reservation_id)
    )

    return CheckOutResponse.from_model(check_out, handover)


@router.get("", response_model=CheckOutResponse | None)
def get_check_out_state(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    """The check-out so far, or null when none has been started."""

    check_out = get_check_out(db, reservation_id)

    return _response(db, check_out) if check_out else None


@router.post("/condition", response_model=CheckOutResponse)
def save_condition_endpoint(
    reservation_id: UUID,
    data: CheckOutConditionInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out = save_condition(db, reservation_id, data, current_user)

    return _response(db, check_out)


@router.post("/waive", response_model=CheckOutResponse)
def waive_charges_endpoint(
    reservation_id: UUID,
    data: CheckOutWaiveInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out = waive_charges(db, reservation_id, data, current_user)

    return _response(db, check_out)


@router.post("/settle-deposit", response_model=CheckOutResponse)
def settle_deposit_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out = settle_deposit_step(db, reservation_id, current_user)

    return _response(db, check_out)


@router.post("/payment-intent", response_model=CheckOutPaymentIntentResponse)
def create_payment_intent_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out, intent = create_or_reuse_payment_intent(
        db, reservation_id, current_user
    )

    return CheckOutPaymentIntentResponse(
        client_secret=intent.client_secret,
        payment_status=check_out.payment_status,
        payment_amount=(
            float(check_out.payment_amount)
            if check_out.payment_amount is not None
            else None
        ),
        payment_currency=check_out.payment_currency,
        late_fee=float(check_out.late_fee),
        fuel_fee=float(check_out.fuel_fee),
        damage_charge=float(check_out.damage_charge),
    )


@router.post("/confirm-payment", response_model=CheckOutResponse)
def confirm_payment_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out = confirm_payment(db, reservation_id, current_user)

    return _response(db, check_out)


@router.post("/confirm-cash-payment", response_model=CheckOutResponse)
def confirm_cash_payment_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out = confirm_cash_payment(db, reservation_id, current_user)

    return _response(db, check_out)


@router.post("/employee-signature", response_model=CheckOutResponse)
def submit_employee_signature_endpoint(
    reservation_id: UUID,
    data: SignatureSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out = submit_employee_signature(
        db, reservation_id, data.signature_image, current_user
    )

    return _response(db, check_out)


@router.post("/complete", response_model=CheckOutCompleteResponse)
def complete_check_out_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    check_out, car, task_id, cleaning_task_id = complete_check_out(
        db, reservation_id, current_user
    )

    return CheckOutCompleteResponse(
        check_out=_response(db, check_out),
        car_away_from_home=car.is_away_from_home,
        car_current_airport_code=car.current_location.airport_code,
        car_home_airport_code=car.home_location.airport_code,
        maintenance_task_id=task_id,
        cleaning_task_id=cleaning_task_id,
    )
