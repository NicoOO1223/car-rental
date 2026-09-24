from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.dependencies import require_authenticated_user, require_role
from app.models import Car, Reservation
from app.schemas.dashboard import (
    DashboardAwayCar,
    DashboardFleetStats,
    DashboardFleetStatusResponse,
    DashboardLocationStats,
    DashboardReservation,
    DashboardReservationStats,
    DashboardResponse,
    DashboardRevenueByMethod,
    DashboardRevenuePoint,
    DashboardRevenueResponse,
    DashboardTodayStats,
)
from app.services.availability import (
    get_current_maintenance_by_car,
    get_fleet_status_counts,
)
from app.services.configuration import get_configuration
from app.services.dashboard import get_collected_revenue, get_daily_revenue
from app.services.extras import selections_from_reservation
from app.services.pricing import calculate_price_breakdown


router = APIRouter(
    prefix="/api/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(require_authenticated_user)],
)


def _to_dashboard_reservation(reservation: Reservation, configuration) -> DashboardReservation:
    breakdown = calculate_price_breakdown(
        reservation.car.price_per_day,
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=configuration.short_term_fee,
        airport_change_fee=configuration.airport_change_fee,
        extras=selections_from_reservation(reservation),
    )
    total_price = breakdown.total_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return DashboardReservation(
        id=reservation.id,

        customer_first_name=reservation.customer.first_name,
        customer_last_name=reservation.customer.last_name,
        customer_phone_number=reservation.customer.phone_number,
        customer_nationality=reservation.customer.nationality,

        car_make=reservation.car.make,
        car_model=reservation.car.model,
        car_license_plate=reservation.car.license_plate,

        pickup_location_name=reservation.pickup_location.name,
        pickup_location_code=reservation.pickup_location.airport_code,

        return_location_name=reservation.return_location.name,
        return_location_code=reservation.return_location.airport_code,

        pickup_at=reservation.pickup_at,
        return_at=reservation.return_at,

        status=reservation.status,

        total_price=float(total_price),
    )


@router.get(
    "",
    response_model=DashboardResponse,
)
def get_dashboard(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    location_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
):
    # location_id narrows the pickups list to that pickup airport and the
    # returns list to that return airport.
    #
    # When set, these narrow the "upcoming pickups"/"upcoming returns"
    # lists below to a specific window (e.g. "today", or a staff-picked
    # range) instead of the default "everything from now on, capped at
    # 10". Left unset, both lists keep their original default behavior
    # exactly — this is additive, not a replacement.
    if start_date or end_date:
        resolved_start = start_date or end_date
        resolved_end = end_date or start_date

        if resolved_start > resolved_end:
            raise HTTPException(
                status_code=400,
                detail="start_date must not be after end_date.",
            )

        range_start = datetime.combine(resolved_start, time.min, tzinfo=timezone.utc)
        range_end = datetime.combine(resolved_end, time.min, tzinfo=timezone.utc) + timedelta(days=1)
    else:
        range_start = None
        range_end = None

    # ---------------------------------------------------------
    # Fleet statistics
    # ---------------------------------------------------------

    cars = db.scalars(
        select(Car)
        .options(
            joinedload(Car.current_location),
            joinedload(Car.home_location),
        )
    ).all()

    # A car inside an open maintenance/cleaning window counts as such now,
    # unless it is already reserved/rented.
    maintenance_now = get_current_maintenance_by_car(db)

    def current_status(car: Car) -> str:
        if car.status == "AVAILABLE" and car.id in maintenance_now:
            return maintenance_now[car.id]

        return car.status

    fleet_statuses = [current_status(car) for car in cars]

    fleet = DashboardFleetStats(
        total=len(cars),
        available=fleet_statuses.count("AVAILABLE"),
        reserved=fleet_statuses.count("RESERVED"),
        rented=fleet_statuses.count("RENTED"),
        maintenance=fleet_statuses.count("MAINTENANCE"),
        cleaning=fleet_statuses.count("CLEANING"),
    )

    # ---------------------------------------------------------
    # Reservation statistics
    # ---------------------------------------------------------

    reservations = db.scalars(
        select(Reservation)
    ).all()

    reservation_stats = DashboardReservationStats(
        total=len(reservations),
        confirmed=sum(
            reservation.status == "CONFIRMED"
            for reservation in reservations
        ),
        active=sum(
            reservation.status == "ACTIVE"
            for reservation in reservations
        ),
        completed=sum(
            reservation.status == "COMPLETED"
            for reservation in reservations
        ),
        cancelled=sum(
            reservation.status == "CANCELLED"
            for reservation in reservations
        ),
    )

    # ---------------------------------------------------------
    # Today
    # ---------------------------------------------------------

    now = datetime.now(timezone.utc)

    today_start = datetime.combine(
        now.date(),
        time.min,
        tzinfo=timezone.utc,
    )

    tomorrow_start = today_start + timedelta(days=1)

    today_pickups = db.scalar(
        select(
            __import__("sqlalchemy").func.count(
                Reservation.id
            )
        ).where(
            Reservation.pickup_at >= today_start,
            Reservation.pickup_at < tomorrow_start,
            Reservation.status != "CANCELLED",
        )
    ) or 0

    today_returns = db.scalar(
        select(
            __import__("sqlalchemy").func.count(
                Reservation.id
            )
        ).where(
            Reservation.return_at >= today_start,
            Reservation.return_at < tomorrow_start,
            Reservation.status != "CANCELLED",
        )
    ) or 0

    today = DashboardTodayStats(
        pickups=today_pickups,
        returns=today_returns,
    )

    configuration = get_configuration(db)

    # ---------------------------------------------------------
    # Upcoming pickups
    # ---------------------------------------------------------

    if range_start is not None:
        # An explicit range was requested — "pickups in this window",
        # full stop, no additional "from now on" constraint.
        pickup_filters = [
            Reservation.pickup_at >= range_start,
            Reservation.pickup_at < range_end,
            Reservation.status != "CANCELLED",
        ]
    else:
        pickup_filters = [
            Reservation.pickup_at >= now,
            Reservation.status != "CANCELLED",
        ]

    if location_id is not None:
        pickup_filters.append(Reservation.pickup_location_id == location_id)

    pickup_query = (
        select(Reservation)
        .where(*pickup_filters)
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
            selectinload(Reservation.extras),
        )
        .order_by(
            Reservation.pickup_at.asc()
        )
    )

    if range_start is None:
        pickup_query = pickup_query.limit(10)

    upcoming_pickup_rows = db.scalars(pickup_query).all()

    upcoming_pickups = [
        _to_dashboard_reservation(reservation, configuration)
        for reservation in upcoming_pickup_rows
    ]

    # ---------------------------------------------------------
    # Upcoming returns
    # ---------------------------------------------------------
    #
    # Deliberately not the mirror of the query above (return_at >= now
    # alone). That would catch nearly every non-cancelled reservation in
    # the system, since a booking's return date sits in the future for
    # the entire span between being made and actually returning — a
    # reservation for next month would show up here today, ahead of a car
    # that is genuinely out and due back this afternoon. Requiring
    # pickup_at <= now as well restricts this to rentals already in
    # progress, matching the time-bound test
    # frontend/app/reservations/manage/page.tsx's "On the road" quick
    # filter already uses. This also keeps the two lists disjoint: a
    # reservation can satisfy pickup_at >= now or pickup_at <= now, never
    # both.
    #
    # That "already in progress" constraint only makes sense for the
    # open-ended default view, though — once a specific range is
    # requested, "returns due in this window" is the whole answer, even
    # for a reservation that hasn't been picked up yet.

    if range_start is not None:
        return_filters = [
            Reservation.return_at >= range_start,
            Reservation.return_at < range_end,
            Reservation.status != "CANCELLED",
        ]
    else:
        # Rentals in progress and due back, plus ACTIVE ones already past
        # their return time: an overdue car is the most urgent return, so
        # it must not drop off the list. Ordered by return_at, they lead it.
        return_filters = [
            or_(
                and_(
                    Reservation.pickup_at <= now,
                    Reservation.return_at >= now,
                    Reservation.status != "CANCELLED",
                ),
                and_(
                    Reservation.status == "ACTIVE",
                    Reservation.return_at < now,
                ),
            )
        ]

    if location_id is not None:
        return_filters.append(Reservation.return_location_id == location_id)

    return_query = (
        select(Reservation)
        .where(*return_filters)
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
            selectinload(Reservation.extras),
        )
        .order_by(
            Reservation.return_at.asc()
        )
    )

    if range_start is None:
        return_query = return_query.limit(10)

    upcoming_return_rows = db.scalars(return_query).all()

    upcoming_returns = [
        _to_dashboard_reservation(reservation, configuration)
        for reservation in upcoming_return_rows
    ]

    # ---------------------------------------------------------
    # Fleet by location
    # ---------------------------------------------------------
    #
    # Deliberately not Car.status, which is set directly (e.g. via the
    # car-edit modal) and can drift out of sync with reality -- a car can
    # sit at RENTED indefinitely with no reservation ever backing it.
    # This derives each car's status from actual reservation data
    # instead, via the same get_fleet_status_counts the "Fleet status"
    # pie chart above already uses (see
    # app/services/availability.py::_compute_car_statuses_for_date), so
    # the two panels can no longer disagree about the same car.

    today_date = now.date()

    locations_by_id = {
        car.current_location.id: car.current_location
        for car in cars
    }

    locations = [
        DashboardLocationStats(
            airport_code=location.airport_code,
            name=location.name,
            **get_fleet_status_counts(db, today_date, location.id),
        )
        for location in locations_by_id.values()
    ]

    locations.sort(
        key=lambda location: location.airport_code
    )

    return DashboardResponse(
        fleet=fleet,
        reservations=reservation_stats,
        today=today,
        upcoming_pickups=upcoming_pickups,
        upcoming_returns=upcoming_returns,
        locations=locations,
        cars_away_from_home=[
            DashboardAwayCar(
                id=car.id,
                make=car.make,
                model=car.model,
                license_plate=car.license_plate,
                year=car.year,
                category=car.category,
                status=current_status(car),
                current_airport_code=car.current_location.airport_code,
                home_airport_code=car.home_location.airport_code,
                current_airport_name=car.current_location.name,
                home_airport_name=car.home_location.name,
            )
            for car in sorted(cars, key=lambda c: c.license_plate)
            if car.is_away_from_home
        ],
    )


@router.get(
    "/fleet-status",
    response_model=DashboardFleetStatusResponse,
)
def get_fleet_status(
    date: date | None = Query(None),
    location_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
):
    target_date = date or datetime.now(timezone.utc).date()

    counts = get_fleet_status_counts(db, target_date, location_id)

    return DashboardFleetStatusResponse(
        date=target_date,
        location_id=location_id,
        counts=DashboardFleetStats(**counts),
    )


@router.get(
    "/revenue",
    response_model=DashboardRevenueResponse,
    # Aggregate financial reporting — narrower than the rest of the
    # dashboard, which every staff member uses for routine day-to-day
    # operations.
    dependencies=[Depends(require_role("admin"))],
)
def get_revenue(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
):
    today = datetime.now(timezone.utc).date()

    resolved_end = end_date or today
    resolved_start = start_date or (resolved_end - timedelta(days=29))

    try:
        points = get_daily_revenue(db, resolved_start, resolved_end)
        collected = get_collected_revenue(db, resolved_start, resolved_end)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return DashboardRevenueResponse(
        start_date=resolved_start,
        end_date=resolved_end,
        points=[
            DashboardRevenuePoint(date=day, revenue=revenue)
            for day, revenue in points
        ],
        total_revenue=sum(revenue for _, revenue in points),
        collected_points=[
            DashboardRevenuePoint(date=day, revenue=revenue)
            for day, revenue in collected.points
        ],
        total_collected=collected.total_collected,
        collected_by_method=DashboardRevenueByMethod(
            card=collected.card_total,
            cash=collected.cash_total,
        ),
        total_refunded=collected.total_refunded,
    )