"""
Check-out: the return of a rented car.

Steps, in order: record the vehicle's condition (which fixes the actual
return time and works out the late/fuel/damage charges), collect payment
of any charges, the receiving employee signs, then complete. Completing
is one transaction: the reservation becomes COMPLETED, the car takes its
new mileage, moves to the return airport and becomes available — or, if
damage was reported, a repair task is opened for it.
"""

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import STRIPE_SECRET_KEY
from app.models import Car, CheckOut, Handover, Reservation, User
from app.services.stripe_sync import apply_payment_intent_status
from app.services.audit import audit_log
from app.services.availability import (
    has_conflicting_maintenance,
    has_conflicting_reservation,
)
from app.services.configuration import get_configuration
from app.services.maintenance import create_task
from app.services.return_charges import (
    calculate_fuel_fee,
    calculate_late_fee,
    calculate_late_hours,
    calculate_total_charge,
    settle_deposit,
    validate_damage_charge,
)
from app.schemas.check_out import CheckOutConditionInput, CheckOutWaiveInput

stripe.api_key = STRIPE_SECRET_KEY

PAYMENT_METHOD_TYPES = ["card"]

_CENTS = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(_CENTS, rounding=ROUND_HALF_UP)


def _require_stripe_configured() -> None:
    if not stripe.api_key:
        raise ValueError(
            "Stripe is not configured on the server. Set STRIPE_SECRET_KEY "
            "in backend/.env to enable payments."
        )


def _get_reservation(db: Session, reservation_id: UUID) -> Reservation:
    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise ValueError("Reservation not found.")

    return reservation


def get_check_out(db: Session, reservation_id: UUID) -> CheckOut | None:
    _get_reservation(db, reservation_id)

    return db.scalar(
        select(CheckOut).where(CheckOut.reservation_id == reservation_id)
    )


def _require_started(db: Session, reservation_id: UUID) -> CheckOut:
    reservation = _get_reservation(db, reservation_id)
    check_out = db.scalar(
        select(CheckOut).where(CheckOut.reservation_id == reservation_id)
    )

    if check_out is None:
        raise ValueError("Record the vehicle's condition first.")

    if check_out.completed_at is not None or reservation.status != "ACTIVE":
        raise ValueError("This check-out has already been completed.")

    return check_out


def _handover(db: Session, reservation_id: UUID) -> Handover | None:
    return db.scalar(select(Handover).where(Handover.reservation_id == reservation_id))


def _deposit_pending(db: Session, check_out: CheckOut) -> bool:
    """A deposit is held at check-in and this check-out hasn't settled it yet."""

    handover = _handover(db, check_out.reservation_id)

    return (
        handover is not None
        and handover.deposit_status == "HELD"
        and check_out.deposit_settled_at is None
    )


def _amount_due(check_out: CheckOut) -> Decimal:
    """What is left to collect once the deposit has covered what it can."""

    return check_out.total_charge - check_out.deposit_applied


def _require_editable(check_out: CheckOut) -> None:
    """The figures can't change once paid for or signed off."""

    if check_out.payment_status == "SUCCEEDED":
        raise ValueError("The charges have already been paid.")

    if check_out.employee_signature_image is not None:
        raise ValueError("The employee has already signed this check-out.")

    if check_out.deposit_settled_at is not None:
        raise ValueError("The security deposit has already been settled.")


def _recalculate(check_out: CheckOut, configuration) -> None:
    check_out.late_fee = _money(
        calculate_late_fee(check_out.late_hours, configuration.late_fee_per_hour)
    )
    check_out.fuel_fee = _money(
        calculate_fuel_fee(
            check_out.fuel_eighths,
            configuration.fuel_fee_per_eighth,
            configuration.refuel_service_fee,
        )
    )
    check_out.total_charge = calculate_total_charge(
        check_out.late_fee,
        check_out.fuel_fee,
        check_out.damage_charge,
        late_fee_waived=check_out.late_fee_waived,
        fuel_fee_waived=check_out.fuel_fee_waived,
    )


def save_condition(
    db: Session,
    reservation_id: UUID,
    data: CheckOutConditionInput,
    actor: User,
) -> CheckOut:
    """
    Records (or, before payment and signing, corrects) the vehicle's
    condition. The actual return time is fixed by the first save.
    """

    reservation = _get_reservation(db, reservation_id)

    check_out = db.scalar(
        select(CheckOut).where(CheckOut.reservation_id == reservation_id)
    )

    if check_out is not None:
        if check_out.completed_at is not None or reservation.status != "ACTIVE":
            raise ValueError("This check-out has already been completed.")

        _require_editable(check_out)
    elif reservation.status != "ACTIVE":
        raise ValueError(
            "Only a rental that is out with the customer can be checked out."
        )

    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)

    if data.return_mileage < 0:
        raise ValueError("The mileage cannot be negative.")

    if car.mileage is not None and data.return_mileage < car.mileage:
        raise ValueError(
            f"The mileage cannot be lower than the car's recorded {car.mileage} km."
        )

    damage_charge = _money(data.damage_charge)

    if data.damage_reported:
        if not (data.damage_notes or "").strip():
            raise ValueError("Describe the damage.")

        if data.damage_task_starts_at is None or data.damage_task_ends_at is None:
            raise ValueError("Choose when the car is out of service for the repair.")

        starts_at = data.damage_task_starts_at
        ends_at = data.damage_task_ends_at

        if starts_at.tzinfo is None:
            starts_at = starts_at.replace(tzinfo=timezone.utc)

        if ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=timezone.utc)

        if ends_at <= starts_at:
            raise ValueError("The repair must end after it starts.")

        if ends_at <= datetime.now(timezone.utc):
            raise ValueError("The repair window must end in the future.")

        # Checked now so a clash surfaces here rather than at the very end
        # of the check-out. This rental itself is excluded: it is still
        # ACTIVE until completion.
        if has_conflicting_maintenance(db, car.id, starts_at, ends_at):
            raise ValueError(
                "The car already has maintenance or cleaning scheduled in that period."
            )

        if has_conflicting_reservation(
            db,
            car.id,
            starts_at,
            ends_at,
            exclude_reservation_id=reservation_id,
        ):
            raise ValueError(
                "The car has a reservation in that period. "
                "Cancel or move the reservation first."
            )
    else:
        starts_at = None
        ends_at = None

        if damage_charge != 0:
            raise ValueError("A damage charge needs damage to be reported.")

    validate_damage_charge(damage_charge, configuration.max_damage_charge)

    is_new = check_out is None

    if is_new:
        check_out = CheckOut(
            reservation_id=reservation_id,
            returned_at=datetime.now(timezone.utc),
            created_by=actor.id,
        )
        db.add(check_out)

    check_out.return_mileage = data.return_mileage
    check_out.fuel_eighths = data.fuel_eighths
    check_out.damage_reported = data.damage_reported
    check_out.damage_notes = (data.damage_notes or "").strip() or None
    check_out.damage_charge = damage_charge
    check_out.damage_task_starts_at = starts_at
    check_out.damage_task_ends_at = ends_at

    check_out.late_hours = calculate_late_hours(
        reservation.return_at,
        check_out.returned_at,
        configuration.late_return_grace_minutes,
    )

    # Corrected figures start from scratch; the employee re-applies any
    # waiver.
    check_out.late_fee_waived = False
    check_out.fuel_fee_waived = False
    check_out.waiver_reason = None

    _recalculate(check_out, configuration)

    check_out.updated_by = actor.id

    db.flush()

    audit_log(
        db,
        user=actor,
        action="check_out.condition_recorded",
        entity_type="check_out",
        entity_id=check_out.id,
        metadata={
            "reservation_id": str(reservation_id),
            "return_mileage": check_out.return_mileage,
            "fuel_eighths": check_out.fuel_eighths,
            "damage_reported": check_out.damage_reported,
            "late_hours": check_out.late_hours,
            "late_fee": str(check_out.late_fee),
            "fuel_fee": str(check_out.fuel_fee),
            "damage_charge": str(check_out.damage_charge),
            "total_charge": str(check_out.total_charge),
            "corrected": not is_new,
        },
    )

    db.commit()
    db.refresh(check_out)

    return check_out


def waive_charges(
    db: Session,
    reservation_id: UUID,
    data: CheckOutWaiveInput,
    actor: User,
) -> CheckOut:
    check_out = _require_started(db, reservation_id)
    _require_editable(check_out)

    reason = (data.reason or "").strip()

    if (data.waive_late_fee or data.waive_fuel_fee) and not reason:
        raise ValueError("Give a reason for waiving a charge.")

    if data.waive_late_fee and check_out.late_fee == 0:
        raise ValueError("There is no late fee to waive.")

    if data.waive_fuel_fee and check_out.fuel_fee == 0:
        raise ValueError("There is no fuel fee to waive.")

    check_out.late_fee_waived = data.waive_late_fee
    check_out.fuel_fee_waived = data.waive_fuel_fee
    check_out.waiver_reason = (
        reason if (data.waive_late_fee or data.waive_fuel_fee) else None
    )

    _recalculate(check_out, get_configuration(db))

    check_out.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="check_out.charge_waived",
        entity_type="check_out",
        entity_id=check_out.id,
        metadata={
            "reservation_id": str(reservation_id),
            "late_fee_waived": check_out.late_fee_waived,
            "fuel_fee_waived": check_out.fuel_fee_waived,
            "late_fee": str(check_out.late_fee),
            "fuel_fee": str(check_out.fuel_fee),
            "reason": check_out.waiver_reason,
            "total_charge": str(check_out.total_charge),
        },
    )

    db.commit()
    db.refresh(check_out)

    return check_out


def _require_charges_to_collect(db: Session, check_out: CheckOut) -> None:
    if _deposit_pending(db, check_out):
        raise ValueError("Settle the security deposit first.")

    if _amount_due(check_out) <= 0:
        raise ValueError("There are no charges to collect.")

    if check_out.payment_status == "SUCCEEDED":
        raise ValueError("The charges have already been paid.")


def create_or_reuse_payment_intent(db: Session, reservation_id: UUID, actor: User):
    """Card payment of the charges. Reuses a live intent unless the amount changed."""

    _require_stripe_configured()

    check_out = _require_started(db, reservation_id)
    _require_charges_to_collect(db, check_out)

    if check_out.employee_signature_image is not None:
        raise ValueError("The employee has already signed this check-out.")

    configuration = get_configuration(db)
    amount = _amount_due(check_out)

    try:
        if check_out.stripe_payment_intent_id:
            intent = stripe.PaymentIntent.retrieve(check_out.stripe_payment_intent_id)

            if intent.status == "succeeded":
                return check_out, intent

            if intent.status != "canceled":
                if (
                    list(intent.payment_method_types) == PAYMENT_METHOD_TYPES
                    and intent.amount == int(amount * 100)
                ):
                    return check_out, intent

                stripe.PaymentIntent.cancel(intent.id)

        intent = stripe.PaymentIntent.create(
            amount=int(amount * 100),
            currency=configuration.default_currency,
            payment_method_types=PAYMENT_METHOD_TYPES,
            metadata={"reservation_id": str(reservation_id), "kind": "check_out"},
            idempotency_key=(
                f"check-out-pi:{reservation_id}:{int(amount * 100)}:"
                f"{check_out.stripe_payment_intent_id or 'none'}"
            ),
        )
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    check_out.stripe_payment_intent_id = intent.id
    check_out.payment_amount = amount
    check_out.payment_currency = configuration.default_currency
    check_out.payment_status = "PROCESSING"
    check_out.payment_method = "CARD"
    check_out.updated_by = actor.id

    db.commit()
    db.refresh(check_out)

    return check_out, intent


def confirm_payment(db: Session, reservation_id: UUID, actor: User) -> CheckOut:
    """Server-side verification against Stripe, never the browser's word."""

    _require_stripe_configured()

    check_out = _require_started(db, reservation_id)

    if not check_out.stripe_payment_intent_id:
        raise ValueError("No payment has been initiated for this check-out.")

    try:
        intent = stripe.PaymentIntent.retrieve(check_out.stripe_payment_intent_id)
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    apply_payment_intent_status(check_out, intent.status)

    check_out.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="check_out.payment_confirmed",
        entity_type="check_out",
        entity_id=check_out.id,
        metadata={
            "payment_method": "CARD",
            "stripe_payment_intent_id": check_out.stripe_payment_intent_id,
            "payment_status": check_out.payment_status,
            "amount": str(check_out.payment_amount),
        },
    )

    db.commit()
    db.refresh(check_out)

    return check_out


def confirm_cash_payment(db: Session, reservation_id: UUID, actor: User) -> CheckOut:
    """A staff attestation that the charges were received in cash."""

    check_out = _require_started(db, reservation_id)
    _require_charges_to_collect(db, check_out)

    if check_out.employee_signature_image is not None:
        raise ValueError("The employee has already signed this check-out.")

    configuration = get_configuration(db)

    check_out.payment_amount = _amount_due(check_out)
    check_out.payment_currency = configuration.default_currency
    check_out.payment_status = "SUCCEEDED"
    check_out.payment_method = "CASH"
    check_out.paid_at = datetime.now(timezone.utc)
    check_out.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="check_out.payment_confirmed",
        entity_type="check_out",
        entity_id=check_out.id,
        metadata={
            "payment_method": "CASH",
            "payment_status": check_out.payment_status,
            "amount": str(check_out.payment_amount),
        },
    )

    db.commit()
    db.refresh(check_out)

    return check_out


def _payment_settled(db: Session, check_out: CheckOut) -> bool:
    """The deposit (if any) is settled and whatever it didn't cover is paid."""

    if _deposit_pending(db, check_out):
        return False

    return _amount_due(check_out) <= 0 or check_out.payment_status == "SUCCEEDED"


def settle_deposit_step(db: Session, reservation_id: UUID, actor: User) -> CheckOut:
    """
    Takes the return charges from the held deposit, then releases what is
    left. Run once the charges are final: it locks them. A card deposit is
    captured for the amount applied (Stripe releases the rest of the
    authorization automatically), or cancelled outright when nothing is
    owed; a cash deposit is kept for the amount applied and the rest handed
    back. If the card hold had lapsed by now nothing is captured and the
    charges are collected in full as an ordinary payment.
    """

    check_out = _require_started(db, reservation_id)
    handover = _handover(db, reservation_id)

    if handover is None or handover.deposit_status != "HELD":
        raise ValueError("There is no security deposit to settle.")

    if check_out.deposit_settled_at is not None:
        raise ValueError("The security deposit has already been settled.")

    deposit = Decimal(handover.deposit_amount)
    applied, returned, _due_now = settle_deposit(check_out.total_charge, deposit)

    status: str

    if handover.deposit_method == "CARD":
        _require_stripe_configured()

        try:
            if applied > 0:
                stripe.PaymentIntent.capture(
                    handover.deposit_stripe_payment_intent_id,
                    amount_to_capture=int((applied * 100).to_integral_value(ROUND_HALF_UP)),
                    idempotency_key=f"deposit-capture:{handover.deposit_stripe_payment_intent_id}",
                )
            else:
                stripe.PaymentIntent.cancel(handover.deposit_stripe_payment_intent_id)
        except stripe.StripeError as exc:
            if getattr(exc, "code", None) != "payment_intent_unexpected_state":
                raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

            # The authorization expired (or was released) before check-out:
            # nothing can be captured, so the charges are collected normally.
            applied = Decimal("0.00")
            returned = Decimal("0.00")
            status = "LAPSED"
        else:
            status = None
    else:
        status = None

    if status is None:
        if applied == 0:
            status = "RELEASED"
        elif applied >= deposit:
            status = "CAPTURED"
        else:
            status = "PARTIALLY_CAPTURED"

    now = datetime.now(timezone.utc)

    handover.deposit_status = status
    handover.deposit_captured_amount = applied
    handover.deposit_settled_at = now
    handover.updated_by = actor.id

    check_out.deposit_applied = applied
    check_out.deposit_returned = returned
    check_out.deposit_settled_at = now
    check_out.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="check_out.deposit_settled",
        entity_type="check_out",
        entity_id=check_out.id,
        metadata={
            "reservation_id": str(reservation_id),
            "method": handover.deposit_method,
            "deposit_amount": str(deposit),
            "applied": str(applied),
            "returned": str(returned),
            "status": status,
            "total_charge": str(check_out.total_charge),
        },
    )

    db.commit()
    db.refresh(check_out)

    return check_out


def submit_employee_signature(
    db: Session, reservation_id: UUID, signature_image: str, actor: User
) -> CheckOut:
    """The employee receiving the car signs, once any charges are settled."""

    check_out = _require_started(db, reservation_id)

    if not _payment_settled(db, check_out):
        raise ValueError("Collect the charges before signing.")

    check_out.employee_signature_image = signature_image
    check_out.employee_signed_at = datetime.now(timezone.utc)
    check_out.employee_signed_by = actor.id
    check_out.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="check_out.employee_signed",
        entity_type="check_out",
        entity_id=check_out.id,
        metadata={"reservation_id": str(reservation_id)},
    )

    db.commit()
    db.refresh(check_out)

    return check_out


def complete_check_out(
    db: Session, reservation_id: UUID, actor: User
) -> tuple[CheckOut, Car, UUID | None]:
    """
    Finishes the return in one transaction. Returns the check-out, the car
    (already moved) and the id of the repair task if damage opened one.
    """

    check_out = _require_started(db, reservation_id)
    reservation = _get_reservation(db, reservation_id)

    if not _payment_settled(db, check_out):
        raise ValueError("Collect the charges before completing the check-out.")

    if check_out.employee_signature_image is None:
        raise ValueError("The employee signature is required before completing.")

    car = db.get(Car, reservation.car_id)

    previous_airport = car.current_location.airport_code

    reservation.status = "COMPLETED"
    reservation.updated_by = actor.id

    car.mileage = check_out.return_mileage
    car.current_location_id = reservation.return_location_id
    car.status = "AVAILABLE"

    task_id = None

    # Sessions here don't autoflush, and the repair task's conflict check
    # queries reservations: this rental must already read as COMPLETED.
    db.flush()

    if check_out.damage_reported:
        # The window was validated when the condition was recorded; this
        # re-checks it, and a clash rolls the whole check-out back.
        task = create_task(
            db,
            car.id,
            "MAINTENANCE",
            "DAMAGE_REPAIR",
            check_out.damage_notes,
            check_out.damage_task_starts_at,
            check_out.damage_task_ends_at,
            actor,
            commit=False,
        )
        task_id = task.id

    check_out.completed_at = datetime.now(timezone.utc)
    check_out.updated_by = actor.id

    db.flush()
    db.refresh(car)

    audit_log(
        db,
        user=actor,
        action="reservation.status_changed",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"from": "ACTIVE", "to": "COMPLETED", "via": "check_out"},
    )

    audit_log(
        db,
        user=actor,
        action="check_out.completed",
        entity_type="check_out",
        entity_id=check_out.id,
        metadata={
            "reservation_id": str(reservation_id),
            "from_airport": previous_airport,
            "to_airport": car.current_location.airport_code,
            "away_from_home": car.is_away_from_home,
            "maintenance_task_id": str(task_id) if task_id else None,
        },
    )

    db.commit()
    db.refresh(check_out)
    db.refresh(car)

    return check_out, car, task_id
