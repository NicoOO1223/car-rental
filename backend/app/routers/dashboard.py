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
    # Upcoming reservations
    # ---------------------------------------------------------

    upcoming = db.scalars(
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

    upcoming_reservations = [
        DashboardReservation(
            id=reservation.id,

            customer_first_name=
                reservation.customer.first_name,
            customer_last_name=
                reservation.customer.last_name,

            car_make=reservation.car.make,
            car_model=reservation.car.model,
            car_license_plate=
                reservation.car.license_plate,

            pickup_location_name=
                reservation.pickup_location.name,
            pickup_location_code=
                reservation.pickup_location.airport_code,

            return_location_name=
                reservation.return_location.name,
            return_location_code=
                reservation.return_location.airport_code,

            pickup_at=reservation.pickup_at,
            return_at=reservation.return_at,

            status=reservation.status,
        )
        for reservation in upcoming
    ]

    # ---------------------------------------------------------
    # Fleet by location
    # ---------------------------------------------------------

    location_map = {}

    for car in cars:
        location = car.current_location

        if location.id not in location_map:
            location_map[location.id] = {
                "airport_code": location.airport_code,
                "name": location.name,
                "total": 0,
                "available": 0,
                "reserved": 0,
                "rented": 0,
                "maintenance": 0,
                "cleaning": 0,
            }

        location_data = location_map[location.id]

        location_data["total"] += 1

        if car.status == "AVAILABLE":
            location_data["available"] += 1
        elif car.status == "RESERVED":
            location_data["reserved"] += 1
        elif car.status == "RENTED":
            location_data["rented"] += 1
        elif car.status == "MAINTENANCE":
            location_data["maintenance"] += 1
        elif car.status == "CLEANING":
            location_data["cleaning"] += 1

    locations = [
        DashboardLocationStats(**location)
        for location in location_map.values()
    ]

    locations.sort(
        key=lambda location: location.airport_code
    )

    return DashboardResponse(
        fleet=fleet,
        reservations=reservation_stats,
        today=today,
        upcoming_reservations=upcoming_reservations,
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