from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Car, Customer, Handover, Reservation, User
from app.schemas.reservation import ReservationUpdate
from app.services.audit import audit_log
from app.services.availability import (
    has_conflicting_maintenance,
    has_conflicting_reservation,
)
from app.services.customers import find_matching_customer
from app.services.deposits import release_deposit_for_cancellation
from app.services.handovers import refund_handover_if_paid
from app.services.extras import (
    build_reservation_extras,
    resolve_extra_selections,
    selections_from_catalog,
)
from app.services.pricing import (
    PriceBreakdown,
    calculate_price_breakdown,
    calculate_rental_duration_days,
)
from app.services.configuration import get_configuration


def create_reservation(
    db: Session,
    customer_data,
    car_id,
    pickup_location_id,
    return_location_id,
    pickup_at,
    return_at,
    actor: User,
    extras=(),
):
    # ---------------------------------------------------------
    # 1. Validate dates
    # ---------------------------------------------------------

    if return_at <= pickup_at:
        raise ValueError(
            "Return time must be after pickup time."
        )

    # ---------------------------------------------------------
    # 2. Find car
    # ---------------------------------------------------------

    car = db.get(Car, car_id)

    if car is None:
        raise ValueError("Car not found.")

    # ---------------------------------------------------------
    # 3. Validate car location
    # ---------------------------------------------------------

    if car.current_location_id != pickup_location_id:
        raise ValueError(
            "Car is not located at the selected pickup location."
        )

    # ---------------------------------------------------------
    # 4. Validate car status
    # ---------------------------------------------------------

    if car.status != "AVAILABLE":
        raise ValueError(
            "Car is not currently available."
        )

    # ---------------------------------------------------------
    # 5. Check reservation overlap
    # ---------------------------------------------------------

    if has_conflicting_reservation(db, car_id, pickup_at, return_at):
        raise ValueError(
            "Car is already reserved for part of this period."
        )

    if has_conflicting_maintenance(db, car_id, pickup_at, return_at):
        raise ValueError(
            "Car is scheduled for maintenance or cleaning during this period."
        )

    # ---------------------------------------------------------
    # 6. Validate selected extras
    # ---------------------------------------------------------
    #
    # Deliberately before the customer step: resolve_extra_selections can
    # raise, and step 7 flushes a new Customer row. Validating first keeps
    # a rejected booking from leaving a flushed, uncommitted customer in
    # the session.

    resolved_extras = resolve_extra_selections(db, extras)

    # ---------------------------------------------------------
    # 7. Find or create customer
    # ---------------------------------------------------------
    #
    # Reuse an existing customer with the exact same details
    # (case-insensitive, whitespace-trimmed) instead of always
    # inserting a new row. A Customer row shared across multiple
    # reservations is expected from here on — update_reservation's
    # in-place `setattr(customer, ...)` mutation below already
    # assumed this could happen.

    customer = find_matching_customer(
        db,
        first_name=customer_data.first_name,
        last_name=customer_data.last_name,
        date_of_birth=customer_data.date_of_birth,
        address=customer_data.address,
        postal_code=customer_data.postal_code,
    )

    if customer is None:
        customer = Customer(
            first_name=customer_data.first_name,
            last_name=customer_data.last_name,
            date_of_birth=customer_data.date_of_birth,
            address=customer_data.address,
            postal_code=customer_data.postal_code,
            phone_number=customer_data.phone_number,
            email=customer_data.email,
            nationality=customer_data.nationality,
        )

        db.add(customer)
        db.flush()

    # ---------------------------------------------------------
    # 8. Create reservation
    # ---------------------------------------------------------

    reservation = Reservation(
        customer_id=customer.id,
        car_id=car.id,
        pickup_location_id=pickup_location_id,
        return_location_id=return_location_id,
        pickup_at=pickup_at,
        return_at=return_at,
        status="PENDING",
        extras=build_reservation_extras(resolved_extras),
        created_by=actor.id,
        updated_by=actor.id,
    )

    db.add(reservation)

    db.commit()
    db.refresh(reservation)

    return reservation

def quote_reservation(
    db: Session,
    data,
) -> tuple[PriceBreakdown, int, bool, str | None]:
    """
    Price a booking that does not exist yet.

    This is the single source of pricing truth for the booking wizard — the
    wizard previously reimplemented the surcharge rules in TypeScript and
    had to be kept in sync with app/services/pricing.py by hand.

    Availability is reported rather than raised. The three conditions
    checked here are exactly the ones create_reservation enforces, but a
    car that became unavailable mid-form should show the user a correct
    price next to a precise warning, not an error where the summary was.
    """

    if data.return_at <= data.pickup_at:
        raise ValueError("Return time must be after pickup time.")

    car = db.get(Car, data.car_id)

    if car is None:
        raise ValueError("Car not found.")

    resolved = resolve_extra_selections(db, data.extras)
    configuration = get_configuration(db)

    breakdown = calculate_price_breakdown(
        car.price_per_day,
        data.pickup_at,
        data.return_at,
        data.pickup_location_id,
        data.return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=configuration.short_term_fee,
        airport_change_fee=configuration.airport_change_fee,
        extras=selections_from_catalog(resolved),
    )

    rental_days = calculate_rental_duration_days(data.pickup_at, data.return_at)

    if car.current_location_id != data.pickup_location_id:
        available = False
        message = "Car is not located at the selected pickup location."
    elif car.status != "AVAILABLE":
        available = False
        message = "Car is not currently available."
    elif has_conflicting_reservation(db, car.id, data.pickup_at, data.return_at):
        available = False
        message = "Car is already reserved for part of this period."
    elif has_conflicting_maintenance(db, car.id, data.pickup_at, data.return_at):
        available = False
        message = "Car is scheduled for maintenance or cleaning during this period."
    else:
        available = True
        message = None

    return breakdown, rental_days, available, message


def cancel_reservation(
    db: Session,
    reservation_id,
    actor: User,
):
    reservation = db.get(
        Reservation,
        reservation_id,
    )

    if reservation is None:
        raise ValueError("Reservation not found.")

    if reservation.status == "CANCELLED":
        raise ValueError(
            "Reservation is already cancelled."
        )

    if reservation.status == "COMPLETED":
        raise ValueError(
            "Completed reservations cannot be cancelled."
        )

    # Refund whatever was actually paid before flipping the status, so a
    # refund failure (e.g. a Stripe error) leaves the reservation
    # un-cancelled rather than cancelled with the money never returned.
    refund_handover_if_paid(db, reservation_id, actor)
    release_deposit_for_cancellation(db, reservation_id, actor)

    reservation.status = "CANCELLED"
    reservation.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="reservation.cancelled",
        entity_type="reservation",
        entity_id=reservation.id,
    )

    db.commit()
    db.refresh(reservation)

    return reservation

def update_reservation_status(
    db: Session,
    reservation_id,
    new_status: str,
    actor: User,
):
    reservation = db.get(
        Reservation,
        reservation_id,
    )

    if reservation is None:
        raise ValueError("Reservation not found.")

    current_status = reservation.status

    # ACTIVE is intentionally unreachable from here — a CONFIRMED
    # reservation can only become ACTIVE via the handover flow
    # (see app/services/handovers.py::generate_agreement), which requires
    # a completed payment and signature first.
    allowed_transitions = {
        "PENDING": {
            "CONFIRMED",
            "CANCELLED",
        },
        "CONFIRMED": {
            "CANCELLED",
        },
        "ACTIVE": {
            "COMPLETED",
        },
        "CANCELLED": set(),
        "COMPLETED": set(),
    }

    allowed_statuses = allowed_transitions.get(
        current_status,
        set(),
    )

    if new_status not in allowed_statuses:
        raise ValueError(
            f"Cannot change reservation status "
            f"from {current_status} to {new_status}."
        )

    reservation.status = new_status
    reservation.updated_by = actor.id

    if new_status == "COMPLETED":
        # Completing a rental hands the vehicle back to the fleet.
        car = db.get(Car, reservation.car_id)
        car.status = "AVAILABLE"

    audit_log(
        db,
        user=actor,
        action="reservation.status_changed",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"from": current_status, "to": new_status},
    )

    db.commit()
    db.refresh(reservation)

    return reservation

def update_reservation(
    db: Session,
    reservation_id,
    data: ReservationUpdate,
    actor: User,
):
    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise ValueError("Reservation not found.")

    if reservation.status in ("CANCELLED", "COMPLETED"):
        raise ValueError(
            f"Cannot edit a {reservation.status.lower()} reservation."
        )

    # ---------------------------------------------------------
    # 1. Resolve effective values (fall back to existing ones)
    # ---------------------------------------------------------

    effective_pickup_at = data.pickup_at or reservation.pickup_at
    effective_return_at = data.return_at or reservation.return_at

    if effective_return_at <= effective_pickup_at:
        raise ValueError(
            "Return time must be after pickup time."
        )

    effective_pickup_location_id = (
        data.pickup_location_id or reservation.pickup_location_id
    )
    effective_return_location_id = (
        data.return_location_id or reservation.return_location_id
    )

    target_car_id = data.car_id or reservation.car_id
    is_reassignment = (
        data.car_id is not None and data.car_id != reservation.car_id
    )

    # ---------------------------------------------------------
    # 2. Validate car / location
    # ---------------------------------------------------------

    target_car = db.get(Car, target_car_id)

    if target_car is None:
        raise ValueError("Car not found.")

    if target_car.current_location_id != effective_pickup_location_id:
        raise ValueError(
            "Car is not located at the selected pickup location."
        )

    if is_reassignment and target_car.status != "AVAILABLE":
        raise ValueError(
            "Car is not currently available."
        )

    # ---------------------------------------------------------
    # 3. Check reservation overlap (excluding this reservation)
    # ---------------------------------------------------------

    if has_conflicting_reservation(
        db,
        target_car_id,
        effective_pickup_at,
        effective_return_at,
        exclude_reservation_id=reservation_id,
    ):
        raise ValueError(
            "Car is already reserved for part of this period."
        )

    # Only when the car or the dates actually change — editing something
    # unrelated (e.g. the customer's details) on a booking that already
    # overlaps a maintenance window shouldn't start failing.
    window_changed = (
        effective_pickup_at != reservation.pickup_at
        or effective_return_at != reservation.return_at
    )

    if (is_reassignment or window_changed) and has_conflicting_maintenance(
        db,
        target_car_id,
        effective_pickup_at,
        effective_return_at,
    ):
        raise ValueError(
            "Car is scheduled for maintenance or cleaning during this period."
        )

    # ---------------------------------------------------------
    # 4. Apply changes
    # ---------------------------------------------------------

    reservation.pickup_at = effective_pickup_at
    reservation.return_at = effective_return_at
    reservation.pickup_location_id = effective_pickup_location_id
    reservation.return_location_id = effective_return_location_id
    reservation.car_id = target_car_id
    reservation.updated_by = actor.id

    if data.customer is not None:
        customer = db.get(Customer, reservation.customer_id)

        for field, value in data.customer.model_dump(
            exclude_unset=True
        ).items():
            setattr(customer, field, value)

    # ---------------------------------------------------------
    # 5. Replace the extras set, if one was supplied
    # ---------------------------------------------------------

    if data.extras is not None:
        handover = db.scalar(
            select(Handover).where(Handover.reservation_id == reservation_id)
        )

        # Add-ons cannot change once money has been taken: the captured
        # PaymentIntent amount would no longer match the itemization
        # printed on the rental agreement.
        if handover is not None and handover.payment_status == "SUCCEEDED":
            raise ValueError(
                "Extras cannot be changed after payment has been taken."
            )

        resolved = resolve_extra_selections(
            db,
            data.extras,
            already_booked_ids={line.extra_id for line in reservation.extras},
        )

        # Re-snapshot only genuinely new lines. A line whose extra is
        # unchanged keeps the price it was booked at, even if the catalog
        # has moved since.
        existing = {line.extra_id: line for line in reservation.extras}
        rebuilt = []

        for extra, quantity in resolved:
            line = existing.get(extra.id)

            if line is not None:
                line.quantity = quantity
                rebuilt.append(line)
            else:
                rebuilt.append(build_reservation_extras([(extra, quantity)])[0])

        # delete-orphan on Reservation.extras removes the dropped lines.
        reservation.extras = rebuilt

    db.commit()
    db.refresh(reservation)

    return reservation