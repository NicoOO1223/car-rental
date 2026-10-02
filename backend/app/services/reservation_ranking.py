"""
Ranks a group of reservations competing for the same car and dates — the
counterpart of app/services/availability.py's list_overlapping_reservations,
but business logic (customer loyalty, pricing) rather than SQL plumbing, so
it lives in its own module.

Priority order, each one only a tie-breaker for the one before it:
  1. A repeat customer outranks a new one.
  2. A higher agreed price outranks a lower one.
  3. Whoever asked first outranks whoever asked later.

This is a plain sort, not a weighted score: the three signals are in
different units (a yes/no, an amount of money, a point in time), and
reducing them to one number would need made-up weights to reconcile them.
A priority order is something staff can actually read and trust.
"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Reservation


def is_repeat_customer(db: Session, customer_id) -> bool:
    """Whether this customer has completed a rental before — meaningful
    because create_reservation() already reuses an existing Customer row
    when the entered details match, so a genuinely returning customer does
    share a customer_id across bookings."""

    return (
        db.scalar(
            select(Reservation.id)
            .where(Reservation.customer_id == customer_id, Reservation.status == "COMPLETED")
            .limit(1)
        )
        is not None
    )


def _amount_for_sort(reservation: Reservation) -> Decimal:
    # A reservation with no agreed price yet (shouldn't normally happen,
    # but an older row might lack one) sorts as if it were the lowest.
    return reservation.agreed_total_amount if reservation.agreed_total_amount is not None else Decimal("-1")


def rank_overlap_candidates(
    db: Session, reservations: list[Reservation]
) -> tuple[list[Reservation], dict]:
    """
    Sorts the given reservations best-first and returns (sorted, meta),
    where meta has "suggested_id" (the top one, or None if the list is
    empty) and "suggested_reasons" — a list of the criteria that actually
    set the top one apart from the rest of the group, in priority order
    (e.g. ["repeat_customer", "requested_first"] — "highest_value" is
    omitted here because, say, another candidate tied for the top amount).
    """

    if not reservations:
        return [], {"suggested_id": None, "suggested_reasons": []}

    repeat = {r.id: is_repeat_customer(db, r.customer_id) for r in reservations}

    ranked = sorted(
        reservations,
        key=lambda r: (not repeat[r.id], -_amount_for_sort(r), r.created_at),
    )

    top = ranked[0]
    reasons = []

    if repeat[top.id] and not all(repeat[r.id] for r in reservations):
        reasons.append("repeat_customer")

    top_amount = _amount_for_sort(top)
    if top_amount > 0 and sum(1 for r in reservations if _amount_for_sort(r) == top_amount) == 1:
        reasons.append("highest_value")

    earliest = min(r.created_at for r in reservations)
    if top.created_at == earliest and sum(1 for r in reservations if r.created_at == earliest) == 1:
        reasons.append("requested_first")

    return ranked, {"suggested_id": top.id, "suggested_reasons": reasons}
