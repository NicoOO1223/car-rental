from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Extra, Reservation, ReservationExtra
from app.services.pricing import ExtraSelection


def list_extras(db: Session, include_inactive: bool = False) -> list[Extra]:
    query = select(Extra).order_by(Extra.sort_order, Extra.name)

    if not include_inactive:
        query = query.where(Extra.is_active.is_(True))

    return list(db.scalars(query).all())


def resolve_extra_selections(db: Session, requested) -> list[tuple[Extra, int]]:
    """
    Validate a client-supplied list of {extra_id, quantity} against the live
    catalog, returning (Extra, quantity) pairs.

    Raises ValueError — which every router in this package turns into a 400 —
    rather than letting a duplicate selection surface as a 500 from the
    unique_reservation_extra constraint, or an over-quantity selection get
    silently accepted.
    """

    if not requested:
        return []

    extra_ids = [item.extra_id for item in requested]

    if len(set(extra_ids)) != len(extra_ids):
        raise ValueError("The same extra was selected more than once.")

    catalog = {
        extra.id: extra
        for extra in db.scalars(
            select(Extra).where(Extra.id.in_(extra_ids))
        ).all()
    }

    resolved: list[tuple[Extra, int]] = []

    for item in requested:
        extra = catalog.get(item.extra_id)

        if extra is None:
            raise ValueError("Unknown extra selected.")

        if not extra.is_active:
            raise ValueError(f"{extra.name} is no longer available.")

        if item.quantity > extra.max_quantity:
            raise ValueError(
                f"At most {extra.max_quantity} x {extra.name} can be added."
            )

        resolved.append((extra, item.quantity))

    return resolved


def selections_from_catalog(resolved) -> list[ExtraSelection]:
    """Live catalog prices — for quotes and for a brand-new booking."""

    return [
        ExtraSelection(
            code=extra.code,
            name=extra.name,
            quantity=quantity,
            unit_price=extra.price,
            price_unit=extra.price_unit,
        )
        for extra, quantity in resolved
    ]


def selections_from_reservation(reservation: Reservation) -> list[ExtraSelection]:
    """
    Snapshotted prices — for anything that charges or documents an existing
    reservation. Reads only reservation_extras columns, so it never joins
    or lazy-loads the catalog, and a later catalog price change cannot
    alter what an existing booking costs.
    """

    return [
        ExtraSelection(
            code=line.extra_code,
            name=line.name,
            quantity=line.quantity,
            unit_price=line.unit_price,
            price_unit=line.price_unit,
        )
        for line in reservation.extras
    ]


def build_reservation_extras(resolved) -> list[ReservationExtra]:
    """Snapshot the catalog rows onto new reservation_extras lines."""

    return [
        ReservationExtra(
            extra_id=extra.id,
            quantity=quantity,
            extra_code=extra.code,
            name=extra.name,
            unit_price=extra.price,
            price_unit=extra.price_unit,
        )
        for extra, quantity in resolved
    ]
