from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload, selectinload

from app.errors import NotFoundError
from app.database import get_db
from app.dependencies import require_authenticated_user
from app.schemas.pricing import PriceBreakdownFields
from app.services.configuration import get_configuration
from app.schemas.reservation import (
    OverlapCandidateResponse,
    OverlappingReservationsResponse,
    ReservationCreate,
    ReservationQuoteRequest,
    ReservationQuoteResponse,
    ReservationResponse,
    ReservationListResponse,
    ReservationPage,
    ReservationStatusUpdate,
    ReservationSummary,
    ReservationUpdate,
)
from app.services.availability import list_overlapping_reservations
from app.services.reservation_ranking import is_repeat_customer, rank_overlap_candidates
from app.services.reservation_search import (
    reservation_summary,
    search_reservations,
)
from app.services.reservations import (
    create_reservation,
    cancel_reservation,
    mark_no_show,
    quote_reservation,
    update_reservation_status,
    update_reservation,
)

from app.models import Reservation, User

from uuid import UUID
from sqlalchemy import select


class CancelRequest(BaseModel):
    # Whether to give back the share the renter paid online: None follows the
    # admin's policy (refund up to the cancellation deadline, keep after it).
    refund_prepayment: bool | None = None


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

    breakdown, rental_days, available, message = quote_reservation(db, data)

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
    data: CancelRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    reservation = cancel_reservation(
        db=db,
        reservation_id=reservation_id,
        actor=current_user,
        refund_prepayment=data.refund_prepayment if data else None,
    )

    return reservation


@router.post(
    "/{reservation_id}/no-show",
    response_model=ReservationListResponse,
)
def no_show_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """The renter did not come: cancels the booking and keeps what they paid online."""

    return mark_no_show(db, reservation_id, current_user)

@router.get(
    "",
    response_model=ReservationPage,
)
def get_reservations(
    q: str | None = Query(default=None, max_length=100),
    status: Literal["PENDING", "AWAITING_PAYMENT", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"]
    | None = Query(default=None),
    location: str | None = Query(default=None, max_length=10),
    source: Literal["STAFF", "STOREFRONT"] | None = Query(default=None),
    window: Literal["TODAY", "ACTIVE", "UPCOMING", "NEXT_7_DAYS"] | None = Query(
        default=None
    ),
    sort: Literal[
        "pickup_asc", "pickup_desc", "return_asc", "return_desc", "created_desc"
    ] = Query(default="pickup_asc"),
    # The caller's own "today", as instants. The browser knows its
    # timezone; the server would otherwise assume UTC.
    day_start: datetime | None = Query(default=None),
    day_end: datetime | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    items, total = search_reservations(
        db,
        q=q,
        status=status,
        location=location,
        source=source,
        window=window,
        sort=sort,
        limit=limit,
        offset=offset,
        day_start=day_start,
        day_end=day_end,
    )

    return ReservationPage(items=items, total=total, limit=limit, offset=offset)


# Declared before "/{reservation_id}" so "summary" is not read as an id.
@router.get(
    "/summary",
    response_model=ReservationSummary,
)
def get_reservation_summary(
    day_start: datetime | None = Query(default=None),
    day_end: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return reservation_summary(db, day_start=day_start, day_end=day_end)

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
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    return reservation


@router.get(
    "/{reservation_id}/overlapping",
    response_model=OverlappingReservationsResponse,
)
def get_overlapping_reservations_endpoint(
    reservation_id: UUID,
    db: Session = Depends(get_db),
):
    """Other reservations competing for the same car and dates — PENDING
    requests no longer block each other, so staff reviewing one needs to
    see what else wants the same slot."""

    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    candidates = list_overlapping_reservations(
        db,
        reservation.car_id,
        reservation.pickup_at,
        reservation.return_at,
        exclude_reservation_id=reservation.id,
    )

    if not candidates:
        return OverlappingReservationsResponse(items=[], suggested_id=None, suggested_reasons=[])

    # Rank the whole group, including the reservation being viewed — not
    # just the others. Ranking "the others" on their own would be comparing
    # a group of one against itself whenever there's a single competitor,
    # which trivially "wins" every criterion and makes the suggestion
    # meaningless. The viewed reservation is left out of `items` below since
    # the page already shows it; it can still come out on top of `meta`,
    # which the frontend reads as "your reservation is the suggested one".
    ranked, meta = rank_overlap_candidates(db, [reservation, *candidates])
    others = [r for r in ranked if r.id != reservation.id]

    return OverlappingReservationsResponse(
        items=[
            OverlapCandidateResponse(
                id=r.id,
                customer_name=f"{r.customer.first_name} {r.customer.last_name}",
                pickup_at=r.pickup_at,
                return_at=r.return_at,
                status=r.status,
                agreed_total_amount=r.agreed_total_amount,
                is_repeat_customer=is_repeat_customer(db, r.customer_id),
                created_at=r.created_at,
            )
            for r in others
        ],
        suggested_id=meta["suggested_id"],
        suggested_reasons=meta["suggested_reasons"],
    )

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
    reservation = update_reservation_status(
        db=db,
        reservation_id=reservation_id,
        new_status=data.status,
        actor=current_user,
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
    reservation = update_reservation(
        db=db,
        reservation_id=reservation_id,
        data=data,
        actor=current_user,
    )

    return reservation