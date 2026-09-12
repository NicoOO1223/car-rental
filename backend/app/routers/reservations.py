from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.schemas.reservation import (
    ReservationCreate,
    ReservationResponse,
    ReservationListResponse,
    ReservationStatusUpdate,
    ReservationUpdate,
)
from app.services.reservations import (
    create_reservation,
    cancel_reservation,
    update_reservation_status,
    update_reservation,
)

from app.models import Reservation

from uuid import UUID
from sqlalchemy import select


router = APIRouter(
    prefix="/api/reservations",
    tags=["Reservations"],
)


@router.post(
    "",
    response_model=ReservationResponse,
    status_code=201,
)
def create_reservation_endpoint(
    data: ReservationCreate,
    db: Session = Depends(get_db),
):
    try:
        reservation = create_reservation(
            db=db,
            customer_data=data.customer,
            car_id=data.car_id,
            pickup_location_id=data.pickup_location_id,
            return_location_id=data.return_location_id,
            pickup_at=data.pickup_at,
            return_at=data.return_at,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return reservation

@router.patch(
    "/{reservation_id}/cancel",
    response_model=ReservationListResponse,
)
def cancel_reservation_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        reservation = cancel_reservation(
            db=db,
            reservation_id=reservation_id,
        )

    except ValueError as exc:
        if str(exc) == "Reservation not found.":
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            )

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return reservation

@router.get(
    "",
    response_model=list[ReservationListResponse],
)
def get_reservations(
    db: Session = Depends(get_db),
):
    reservations = db.scalars(
        select(Reservation)
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .order_by(Reservation.pickup_at.desc())
    ).all()

    return reservations

@router.get(
    "/{reservation_id}",
    response_model=ReservationListResponse,
)
def get_reservation(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    reservation = db.scalar(
        select(Reservation)
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .where(Reservation.id == reservation_id)
    )

    if reservation is None:
        raise HTTPException(
            status_code=404,
            detail="Reservation not found.",
        )

    return reservation

@router.patch(
    "/{reservation_id}/status",
    response_model=ReservationListResponse,
)
def update_reservation_status_endpoint(
    reservation_id: UUID,
    data: ReservationStatusUpdate,
    db: Session = Depends(get_db),
):
    try:
        reservation = update_reservation_status(
            db=db,
            reservation_id=reservation_id,
            new_status=data.status,
        )

    except ValueError as exc:
        if str(exc) == "Reservation not found.":
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            )

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return reservation

@router.patch(
    "/{reservation_id}",
    response_model=ReservationListResponse,
)
def update_reservation_endpoint(
    reservation_id: UUID,
    data: ReservationUpdate,
    db: Session = Depends(get_db),
):
    try:
        reservation = update_reservation(
            db=db,
            reservation_id=reservation_id,
            data=data,
        )

    except ValueError as exc:
        if str(exc) == "Reservation not found.":
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            )

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return reservation