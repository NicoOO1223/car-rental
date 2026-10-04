from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.models import Car, Customer, Handover, Reservation, User
from app.schemas.reservation import ReservationUpdate
from app.services.audit import audit_log
from app.services.booking_prices import stamp_agreed_prices
from app.services.availability import (
    has_conflicting_maintenance,
    has_conflicting_reservation,
    lock_car,
    lock_reservation,
    projected_location_id,
)
from app.services.customers import find_matching_customer
from app.services.deposits import release_deposit_for_cancellation
from app.services.handovers import refund_handover_if_paid
from app.services.prepayments import get_prepayment, settle_prepayment_for_cancellation
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
from app.services.configuration import get_configuration, vat_terms
from app.services.locations import require_bookable_location


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
        raise AppError("reservation.return_before_pickup", "Return time must be after pickup time.")

    # ---------------------------------------------------------
    # 2. Find car
    # ---------------------------------------------------------

    car = db.get(Car, car_id)

    if car is None:
        raise NotFoundError("car.not_found", "Car not found.")

    # ---------------------------------------------------------
    # 3. Validate car location
    # ---------------------------------------------------------

    require_bookable_location(db, pickup_location_id, "pickup")
    require_bookable_location(db, return_location_id, "return")

    if car.is_retired:
        raise AppError("car.retired", "This car has left the fleet and cannot be booked.")

    # Where the car will be when the rental starts, not where it is today:
    # a car out on a rental now can be booked for a later date. Its status
    # today does not decide either; overlapping bookings and maintenance
    # windows are checked below.
    if projected_location_id(db, car, pickup_at) != pickup_location_id:
        raise AppError("reservation.car_not_located_at_selected_pickup", "Car is not located at the selected pickup location.")

    # ---------------------------------------------------------
    # 5. Check reservation overlap
    # ---------------------------------------------------------

    # Held until the booking is committed below, so a request booking the same
    # car at the same moment waits and then sees this one.
    lock_car(db, car_id)

    if has_conflicting_reservation(db, car_id, pickup_at, return_at):
        raise AppError("reservation.car_already_reserved_part_period", "Car is already reserved for part of this period.")

    if has_conflicting_maintenance(db, car_id, pickup_at, return_at):
        raise AppError("reservation.car_scheduled_maintenance_or_cleaning_during", "Car is scheduled for maintenance or cleaning during this period.")

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

    # The price agreed now is what will be charged, whatever rates do later.
    stamp_agreed_prices(db, reservation, car)

    db.add(reservation)
    db.flush()

    audit_log(
        db,
        user=actor,
        action="reservation.created",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"car_id": str(car.id), "source": "staff"},
    )

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
        raise AppError("reservation.return_before_pickup", "Return time must be after pickup time.")

    car = db.get(Car, data.car_id)

    if car is None:
        raise NotFoundError("car.not_found", "Car not found.")

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
        **vat_terms(configuration),
        extras=selections_from_catalog(resolved),
    )

    rental_days = calculate_rental_duration_days(data.pickup_at, data.return_at)

    if projected_location_id(db, car, data.pickup_at) != data.pickup_location_id:
        available = False
        message = "Car is not located at the selected pickup location."
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
    actor: User | None,
    *,
    reason: str = "STAFF",
    refund_prepayment: bool | None = None,
):
    """
    Cancels a booking, giving back what should be given back.

    `reason` is who or what cancelled it: STAFF, RENTER (on the storefront) or
    NO_SHOW. `refund_prepayment` decides the share the renter paid online:
    None follows the admin's policy (refunded up to the cancellation deadline,
    kept after it), True or False overrides it for this cancellation.
    """

    # Locked, so a payment or signature for this booking that is happening at
    # the same moment finishes first (or finds it cancelled), never half-way.
    reservation = lock_reservation(db, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    if reservation.status == "CANCELLED":
        raise AppError("reservation.reservation_already_cancelled", "Reservation is already cancelled.")

    if reservation.status == "COMPLETED":
        raise AppError("reservation.completed_reservations_cannot_cancelled", "Completed reservations cannot be cancelled.")

    if reservation.status == "EXPIRED":
        raise AppError("reservation.reservation_already_cancelled", "Reservation is already cancelled.")

    # The car is out with the renter. Cancelling here would refund the
    # payment but leave the car RENTED with no return recorded, so a rental in
    # progress ends through check-out (mileage, charges, deposit, relocation).
    if reservation.status == "ACTIVE":
        raise AppError(
            "reservation.active_cannot_be_cancelled",
            "A rental in progress cannot be cancelled. Complete the return instead.",
        )

    # Refund whatever was actually paid before flipping the status, so a
    # refund failure (e.g. a Stripe error) leaves the reservation
    # un-cancelled rather than cancelled with the money never returned.
    reservation.cancellation_reason = reason
    reservation.cancelled_at = datetime.now(timezone.utc)

    refund_handover_if_paid(db, reservation_id, actor)
    release_deposit_for_cancellation(db, reservation_id, actor)
    prepayment = settle_prepayment_for_cancellation(db, reservation, actor, refund_prepayment)

    reservation.status = "CANCELLED"
    reservation.hold_expires_at = None

    if actor is not None:
        reservation.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="reservation.cancelled",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"reason": reason, "online_payment": prepayment},
    )

    db.commit()
    db.refresh(reservation)

    return reservation

def mark_no_show(db: Session, reservation_id, actor: User):
    """
    The renter never came. The booking is cancelled and the share they paid
    online is kept, whatever the cancellation deadline was: the car was held
    for them and turned other renters away.
    """

    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    if reservation.status != "CONFIRMED":
        raise AppError(
            "reservation.no_show_needs_confirmed",
            "Only a confirmed reservation can be marked as a no-show.",
            status=reservation.status,
        )

    if reservation.pickup_at > datetime.now(timezone.utc):
        raise AppError(
            "reservation.no_show_too_early",
            "A reservation can only be marked as a no-show once its pickup time has passed.",
        )

    return cancel_reservation(db, reservation_id, actor, reason="NO_SHOW", refund_prepayment=False)


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
        raise NotFoundError("reservation.not_found", "Reservation not found.")

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
        # An online booking waiting for its payment: staff can only cancel it.
        # It becomes CONFIRMED when the payment arrives, never by hand.
        "AWAITING_PAYMENT": {
            "CANCELLED",
        },
        "EXPIRED": set(),
        # A rental in progress ends only through check-out
        # (app/services/check_outs.py), which records mileage, charges, the
        # deposit settlement and where the car ended up. A bare status flip
        # would skip all of that and free the car regardless.
        "ACTIVE": set(),
        "CANCELLED": set(),
        "COMPLETED": set(),
    }

    allowed_statuses = allowed_transitions.get(
        current_status,
        set(),
    )

    if new_status not in allowed_statuses:
        raise AppError(
            "reservation.cannot_change_status",
            f"Cannot change reservation status "
            f"from {current_status} to {new_status}.",
            from_status=current_status,
            to_status=new_status,
        )

    # Cancelling has to give back what was paid and release the deposit, and
    # only cancel_reservation does that.
    if new_status == "CANCELLED":
        return cancel_reservation(db, reservation_id, actor)

    # A PENDING request never blocked anyone else from being confirmed first
    # (see app/services/availability.py), so approving one has to check for
    # real conflicts now rather than assume there are none. lock_car()
    # serializes two staff members approving overlapping requests at once —
    # the second one waits here, then sees the first one's CONFIRMED status.
    if new_status == "CONFIRMED":
        lock_car(db, reservation.car_id)

        if has_conflicting_reservation(
            db, reservation.car_id, reservation.pickup_at, reservation.return_at,
            exclude_reservation_id=reservation.id,
        ):
            raise AppError(
                "reservation.cannot_confirm_car_already_reserved",
                "This car is already confirmed or active for part of this period.",
            )

        # A PENDING request does not block maintenance either, so a service or
        # cleaning may have been booked over it since it was made.
        if has_conflicting_maintenance(
            db, reservation.car_id, reservation.pickup_at, reservation.return_at,
        ):
            raise AppError(
                "reservation.car_scheduled_maintenance_or_cleaning_during",
                "Car is scheduled for maintenance or cleaning during this period.",
            )

    reservation.status = new_status
    reservation.updated_by = actor.id

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

def _payment_fixes_the_price(db: Session, reservation_id) -> bool:
    """
    Whether a payment already pins down what this booking costs: a counter
    payment that went through, or an online payment that went through, is in
    flight, or is still waiting for the renter (its Stripe amount is already
    set). Changing the car, dates, places or extras after that would leave the
    payment, the invoice and the new total describing different rentals.
    """

    counter_paid = db.scalar(
        select(Handover.id).where(
            Handover.reservation_id == reservation_id,
            Handover.payment_status == "SUCCEEDED",
        )
    )

    if counter_paid is not None:
        return True

    online = get_prepayment(db, reservation_id)

    return online is not None and online.payment_status in ("PENDING", "PROCESSING", "SUCCEEDED")


def update_reservation(
    db: Session,
    reservation_id,
    data: ReservationUpdate,
    actor: User,
):
    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    if reservation.status in ("CANCELLED", "COMPLETED", "EXPIRED"):
        raise AppError(
            "reservation.cannot_edit_status",
            f"Cannot edit a {reservation.status.lower()} reservation.",
            status=reservation.status,
        )

    # ---------------------------------------------------------
    # 1. Resolve effective values (fall back to existing ones)
    # ---------------------------------------------------------

    effective_pickup_at = data.pickup_at or reservation.pickup_at
    effective_return_at = data.return_at or reservation.return_at

    if effective_return_at <= effective_pickup_at:
        raise AppError("reservation.return_before_pickup", "Return time must be after pickup time.")

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
        raise NotFoundError("car.not_found", "Car not found.")

    # Moving a booking onto a car that has left the fleet; a booking already on
    # one (it was retired afterwards) can still be edited.
    if is_reassignment and target_car.is_retired:
        raise AppError("car.retired", "This car has left the fleet and cannot be booked.")

    # Only a location the booking is being moved to has to be in use; a
    # reservation already at a since-retired location stays editable.
    if effective_pickup_location_id != reservation.pickup_location_id:
        require_bookable_location(db, effective_pickup_location_id, "pickup")

    if effective_return_location_id != reservation.return_location_id:
        require_bookable_location(db, effective_return_location_id, "return")

    if projected_location_id(db, target_car, effective_pickup_at) != effective_pickup_location_id:
        raise AppError("reservation.car_not_located_at_selected_pickup", "Car is not located at the selected pickup location.")

    # ---------------------------------------------------------
    # 3. Check reservation overlap (excluding this reservation)
    # ---------------------------------------------------------

    booking_moved = (
        is_reassignment
        or effective_pickup_at != reservation.pickup_at
        or effective_return_at != reservation.return_at
        or effective_pickup_location_id != reservation.pickup_location_id
        or effective_return_location_id != reservation.return_location_id
    )

    if booking_moved:
        # Once money has been taken the amount is fixed against what was
        # booked; moving the car, dates or places would leave the payment and
        # the invoice describing a different rental.
        if _payment_fixes_the_price(db, reservation_id):
            raise AppError(
                "reservation.cannot_move_after_payment",
                "The car, dates and locations cannot be changed after payment has been taken.",
            )

        lock_car(db, target_car_id)

    if has_conflicting_reservation(
        db,
        target_car_id,
        effective_pickup_at,
        effective_return_at,
        exclude_reservation_id=reservation_id,
    ):
        raise AppError("reservation.car_already_reserved_part_period", "Car is already reserved for part of this period.")

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
        raise AppError("reservation.car_scheduled_maintenance_or_cleaning_during", "Car is scheduled for maintenance or cleaning during this period.")

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
        # Add-ons cannot change once money has been taken: the captured
        # PaymentIntent amount would no longer match the itemization
        # printed on the rental agreement.
        if _payment_fixes_the_price(db, reservation_id):
            raise AppError("reservation.extras_cannot_changed_after_payment_taken", "Extras cannot be changed after payment has been taken.")

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

    # An unpaid booking that changed car, dates, places or extras is re-priced
    # at today's rates; nothing has been charged yet, so the agreed price
    # should describe what it is now. (Older bookings without an agreed price
    # keep pricing from the live rates.)
    if reservation.agreed_price_per_day is not None and (booking_moved or data.extras is not None):
        stamp_agreed_prices(db, reservation, target_car)

    db.commit()
    db.refresh(reservation)

    return reservation