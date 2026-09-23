from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.dependencies import require_authenticated_user
from app.schemas.pricing import PriceBreakdownFields
from app.services.configuration import get_configuration
from app.schemas.reservation import (
    ReservationCreate,
    ReservationQuoteRequest,
    ReservationQuoteResponse,
    ReservationResponse,
    ReservationListResponse,
    ReservationStatusUpdate,
    ReservationUpdate,
)
from app.services.reservations import (
    create_reservation,
    cancel_reservation,
    quote_reservation,
    update_reservation_status,
    update_reservation,
)

from app.models import Reservation, User

from uuid import UUID
from sqlalchemy import select


router = APIRouter(
    prefix="/api/reservations",
    tags=["Reservations"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.post(
    "",
    response_model=ReservationResponse,
    status_code=201,
)
def create_reservation_endpoint(
    data: ReservationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
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
            extras=data.extras,
            actor=current_user,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return reservation

@router.post(
    "/quote",
    response_model=ReservationQuoteResponse,
)
def quote_reservation_endpoint(
    data: ReservationQuoteRequest,
    db: Session = Depends(get_db),
):
    """
    Server-computed price for a not-yet-created booking, so the booking
    wizard renders exactly what will be charged instead of reimplementing
    the pricing rules client-side.
    """

    try:
        breakdown, rental_days, available, message = quote_reservation(db, data)

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    currency = get_configuration(db).default_currency

    return ReservationQuoteResponse(
        **PriceBreakdownFields.from_breakdown(
            breakdown, rental_days, currency
        ).model_dump(),
        car_available=available,
        availability_message=message,
    )

@router.patch(
    "/{reservation_id}/cancel",
    response_model=ReservationListResponse,
)
def cancel_reservation_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        reservation = cancel_reservation(
            db=db,
            reservation_id=reservation_id,
            actor=current_user,
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
            # selectinload, not joinedload: extras is a collection, and
            # joining it would fan out parent rows and break .all().
            selectinload(Reservation.extras),
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
            selectinload(Reservation.extras),
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
    current_user: User = Depends(require_authenticated_user),
):
    try:
        reservation = update_reservation_status(
            db=db,
            reservation_id=reservation_id,
            new_status=data.status,
            actor=current_user,
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
    current_user: User = Depends(require_authenticated_user),
):
    try:
        reservation = update_reservation(
            db=db,
            reservation_id=reservation_id,
            data=data,
            actor=current_user,
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