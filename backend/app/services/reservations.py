from sqlalchemy.orm import Session

from app.models import Car, Customer, Reservation
from app.schemas.reservation import ReservationUpdate
from app.services.availability import has_conflicting_reservation
from app.services.customers import find_matching_customer


def create_reservation(
    db: Session,
    customer_data,
    car_id,
    pickup_location_id,
    return_location_id,
    pickup_at,
    return_at,
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

    # ---------------------------------------------------------
    # 6. Find or create customer
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
        )

        db.add(customer)
        db.flush()

    # ---------------------------------------------------------
    # 7. Create reservation
    # ---------------------------------------------------------

    reservation = Reservation(
        customer_id=customer.id,
        car_id=car.id,
        pickup_location_id=pickup_location_id,
        return_location_id=return_location_id,
        pickup_at=pickup_at,
        return_at=return_at,
        status="PENDING",
    )

    db.add(reservation)

    db.commit()
    db.refresh(reservation)

    return reservation

def cancel_reservation(
    db: Session,
    reservation_id,
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

    reservation.status = "CANCELLED"

    db.commit()
    db.refresh(reservation)

    return reservation

def update_reservation_status(
    db: Session,
    reservation_id,
    new_status: str,
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

    if new_status == "COMPLETED":
        # Completing a rental hands the vehicle back to the fleet.
        car = db.get(Car, reservation.car_id)
        car.status = "AVAILABLE"

    db.commit()
    db.refresh(reservation)

    return reservation

def update_reservation(
    db: Session,
    reservation_id,
    data: ReservationUpdate,
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

    # ---------------------------------------------------------
    # 4. Apply changes
    # ---------------------------------------------------------

    reservation.pickup_at = effective_pickup_at
    reservation.return_at = effective_return_at
    reservation.pickup_location_id = effective_pickup_location_id
    reservation.return_location_id = effective_return_location_id
    reservation.car_id = target_car_id

    if data.customer is not None:
        customer = db.get(Customer, reservation.customer_id)

        for field, value in data.customer.model_dump(
            exclude_unset=True
        ).items():
            setattr(customer, field, value)

    db.commit()
    db.refresh(reservation)

    return reservation