"""
A manual change to what one reservation costs.

Staff sometimes have to charge a different price than the rates say: a renter
is moved to a dearer car because a better booking took theirs, a regular gets a
discount, a surcharge is agreed by phone. Changing the car's own rate is not the
answer (it would move every booking), and typing over the total would leave the
invoice lines not adding up. So the change is a separate, signed line of its own:

  rate x days + fees + extras  +  adjustment  =  total

It is stored on the reservation with a written reason and who made it, it is
printed on the payment screen, invoice and agreement as its own line, and VAT
follows it like any other line. It sits on the same basis as the other lines
(gross when prices include VAT, net when they do not).

It can only be changed before any payment has been taken. After that the price
is fixed against what was paid, which this app has no partial refund for.
"""

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.models import Car, Reservation, User
from app.services.audit import audit_log
from app.services.availability import lock_reservation
from app.services.booking_prices import reservation_price_breakdown
from app.services.money import round_money

CLOSED_STATUSES = ("CANCELLED", "COMPLETED", "EXPIRED")


def adjustment_for_total(subtotal: Decimal, target_total: Decimal, vat_rate: Decimal, prices_include_vat: bool) -> Decimal:
    """The adjustment that makes the total come to `target_total`, on the basis
    the lines are in (net when VAT is added on top)."""

    if prices_include_vat or vat_rate <= 0:
        wanted_lines = target_total
    else:
        wanted_lines = target_total * 100 / (100 + vat_rate)

    return round_money(wanted_lines - subtotal)


def _open_reservation(db: Session, reservation_id) -> Reservation:
    reservation = lock_reservation(db, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    if reservation.status in CLOSED_STATUSES:
        raise AppError(
            "reservation.cannot_edit_status",
            f"Cannot edit a {reservation.status.lower()} reservation.",
            status=reservation.status,
        )

    # Imported here: reservations.py imports this module.
    from app.services.reservations import _payment_fixes_the_price

    if reservation.status == "ACTIVE" or _payment_fixes_the_price(db, reservation.id):
        raise AppError(
            "reservation.price_cannot_change_after_payment",
            "The price cannot be changed after payment has been taken.",
        )

    return reservation


def _record(
    db: Session,
    reservation: Reservation,
    car: Car,
    *,
    new_adjustment: Decimal,
    reason: str | None,
    actor: User,
    how: str,
    old_total: Decimal | None = None,
) -> None:
    """Writes the adjustment, brings the stored total in line and audits it. No commit."""

    if old_total is None:
        old_total = reservation_price_breakdown(db, reservation, car).total_amount

    old_adjustment = reservation.price_adjustment_amount or Decimal("0.00")
    new_adjustment = round_money(new_adjustment)

    if new_adjustment == 0:
        reservation.price_adjustment_amount = None
        reservation.price_adjustment_reason = None
    else:
        reservation.price_adjustment_amount = new_adjustment
        reservation.price_adjustment_reason = (reason or "").strip() or None

    reservation.price_adjusted_by = actor.id
    reservation.price_adjusted_at = datetime.now(timezone.utc)
    reservation.updated_by = actor.id

    new_total = reservation_price_breakdown(db, reservation, car).total_amount

    # Older bookings have no stored total and keep pricing live.
    if reservation.agreed_total_amount is not None:
        reservation.agreed_total_amount = new_total

    audit_log(
        db,
        user=actor,
        action="reservation.price_adjusted",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={
            "how": how,
            "old_adjustment": str(old_adjustment),
            "new_adjustment": str(new_adjustment),
            "old_total": str(old_total),
            "new_total": str(new_total),
            "reason": (reason or "").strip(),
        },
    )


def set_price_adjustment(db: Session, reservation_id, amount: Decimal, reason: str, actor: User) -> Reservation:
    """Sets the adjustment to `amount` (negative = discount). 0 removes it."""

    reservation = _open_reservation(db, reservation_id)
    car = db.get(Car, reservation.car_id)
    breakdown = reservation_price_breakdown(db, reservation, car)
    amount = round_money(amount)

    if amount < 0 and -amount > breakdown.subtotal_amount:
        raise AppError(
            "reservation.discount_exceeds_price",
            "The discount cannot be more than the price.",
        )

    _record(db, reservation, car, new_adjustment=amount, reason=reason, actor=actor, how="adjustment", old_total=breakdown.total_amount)
    db.commit()
    db.refresh(reservation)

    return reservation


def set_final_total(db: Session, reservation_id, total: Decimal, reason: str, actor: User) -> Reservation:
    """Makes the booking's total `total`, by setting the adjustment that gets there."""

    reservation = _open_reservation(db, reservation_id)
    car = db.get(Car, reservation.car_id)
    breakdown = reservation_price_breakdown(db, reservation, car)
    adjustment = adjustment_for_total(
        breakdown.subtotal_amount, Decimal(total), breakdown.vat_rate, breakdown.prices_include_vat
    )

    _record(db, reservation, car, new_adjustment=adjustment, reason=reason, actor=actor, how="final_total", old_total=breakdown.total_amount)
    db.commit()
    db.refresh(reservation)

    return reservation


def keep_agreed_price(db: Session, reservation: Reservation, car: Car, previous_total: Decimal, actor: User) -> None:
    """After a car change re-priced the booking: puts the total back to what it
    was, as a courtesy ("keep the agreed price"). Only ever a discount: a dearer
    car is not made cheaper than it is, and a cheaper car is not made dearer. No commit."""

    breakdown = reservation_price_breakdown(db, reservation, car)
    adjustment = adjustment_for_total(
        breakdown.subtotal_amount, previous_total, breakdown.vat_rate, breakdown.prices_include_vat
    )

    if adjustment >= 0:
        return

    _record(
        db,
        reservation,
        car,
        new_adjustment=adjustment,
        reason="Agreed price kept after a vehicle change",
        actor=actor,
        how="kept_agreed_price",
        old_total=breakdown.total_amount,
    )
