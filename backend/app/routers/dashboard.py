from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Car, Reservation
from app.schemas.dashboard import (
    DashboardFleetStats,
    DashboardFleetStatusResponse,
    DashboardLocationStats,
    DashboardReservation,
    DashboardReservationStats,
    DashboardResponse,
    DashboardRevenuePoint,
    DashboardRevenueResponse,
    DashboardTodayStats,
)
from app.services.availability import get_fleet_status_counts
from app.services.dashboard import get_daily_revenue


router = APIRouter(
    prefix="/api/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(get_current_user)],
)


def _to_dashboard_reservation(reservation: Reservation) -> DashboardReservation:
    return DashboardReservation(
        id=reservation.id,

        customer_first_name=reservation.customer.first_name,
        customer_last_name=reservation.customer.last_name,

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
    )


@router.get(
    "",
    response_model=DashboardResponse,
)
def get_dashboard(
    db: Session = Depends(get_db),
):
    # ---------------------------------------------------------
    # Fleet statistics
    # ---------------------------------------------------------

    cars = db.scalars(
        select(Car)
        .options(
            joinedload(Car.current_location),
        )
    ).all()

    fleet = DashboardFleetStats(
        total=len(cars),
        available=sum(
            car.status == "AVAILABLE"
            for car in cars
        ),
        reserved=sum(
            car.status == "RESERVED"
            for car in cars
        ),
        rented=sum(
            car.status == "RENTED"
            for car in cars
        ),
        maintenance=sum(
            car.status == "MAINTENANCE"
            for car in cars
        ),
        cleaning=sum(
            car.status == "CLEANING"
            for car in cars
        ),
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

    # ---------------------------------------------------------
    # Upcoming pickups
    # ---------------------------------------------------------

    upcoming_pickup_rows = db.scalars(
        select(Reservation)
        .where(
            Reservation.pickup_at >= now,
            Reservation.status != "CANCELLED",
        )
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .order_by(
            Reservation.pickup_at.asc()
        )
        .limit(10)
    ).all()

    upcoming_pickups = [
        _to_dashboard_reservation(reservation)
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

    upcoming_return_rows = db.scalars(
        select(Reservation)
        .where(
            Reservation.pickup_at <= now,
            Reservation.return_at >= now,
            Reservation.status != "CANCELLED",
        )
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .order_by(
            Reservation.return_at.asc()
        )
        .limit(10)
    ).all()

    upcoming_returns = [
        _to_dashboard_reservation(reservation)
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
    )