from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select

from app.database import get_db
from app.dependencies import require_authenticated_user
from app.models import Car, Reservation, User
from app.schemas.car import CarResponse, CarUpdate, DailyRateResponse
from app.schemas.maintenance import MaintenanceTaskResponse
from app.schemas.reservation import CarReservationResponse, FleetReservationResponse
from app.services.availability import (
    get_available_cars,
    get_car_statuses_for_date,
    get_current_maintenance_by_car,
)
from app.services.cars import return_car_to_home, update_car
from app.services.daily_rates import get_daily_rates
from app.services.maintenance import list_tasks_for_car

from sqlalchemy import select
router = APIRouter(
    prefix="/api/cars",
    tags=["Cars"],
    dependencies=[Depends(require_authenticated_user)],
)

def _with_current_status(car: Car, maintenance_now: dict) -> CarResponse:
    """
    A car inside an open maintenance/cleaning window reads as such right
    now, whatever Car.status says — the window, not the stored status, is
    what takes it out of service. A car that is out on rental or reserved
    keeps that status.
    """

    response = CarResponse.model_validate(car)

    if car.status == "AVAILABLE" and car.id in maintenance_now:
        response = response.model_copy(
            update={"status": maintenance_now[car.id]}
        )

    return response


@router.get("", response_model=list[CarResponse])
def get_cars(
    db: Session = Depends(get_db),
):
    cars = db.scalars(
        select(Car)
        .options(
            joinedload(Car.current_location),
            joinedload(Car.home_location),
        )
        .order_by(Car.license_plate)
    ).all()

    maintenance_now = get_current_maintenance_by_car(db)

    return [_with_current_status(car, maintenance_now) for car in cars]


@router.get("/available", response_model=list[CarResponse])
def available_cars(
    location_id: UUID,
    pickup_at: datetime,
    return_at: datetime,
    db: Session = Depends(get_db),
):
    try:
        cars = get_available_cars(
            db=db,
            pickup_location_id=location_id,
            pickup_at=pickup_at,
            return_at=return_at,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return cars

@router.get("/daily-rates", response_model=list[DailyRateResponse])
def daily_rates(
    location_id: UUID,
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
):
    """
    Day rate per date at a pickup location, for the booking calendar.
    Registered before /{car_id} so "daily-rates" isn't read as a car id.
    """

    try:
        rates = get_daily_rates(db, location_id, start_date, end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return [DailyRateResponse(date=day, price=price) for day, price in rates]


@router.get("/status-by-date", response_model=dict[UUID, str])
def get_car_statuses_by_date(
    date: date = Query(...),
    db: Session = Depends(get_db),
):
    """
    Every car's status "as of" the given day, derived from CONFIRMED/ACTIVE
    reservations rather than the raw (undated) Car.status field — powers
    the fleet overview's date filter. Registered before /{car_id} so
    "status-by-date" isn't swallowed as a car id.
    """

    return get_car_statuses_for_date(db, date)


# The fleet timeline shows every car's upcoming and current bookings.
# Fetching them per car was one request per car; this is one request in
# total. Only the statuses the timeline draws are returned, so completed
# and cancelled history does not ride along. Declared before
# "/{car_id}" so "reservations" is not read as an id.
@router.get(
    "/reservations",
    response_model=list[FleetReservationResponse],
)
def get_fleet_reservations(
    db: Session = Depends(get_db),
):
    return db.scalars(
        select(Reservation)
        .where(Reservation.status.in_(("CONFIRMED", "ACTIVE")))
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .order_by(Reservation.pickup_at.asc())
    ).all()


@router.get(
    "/{car_id}/reservations",
    response_model=list[CarReservationResponse],
)
def get_car_reservations(
    car_id: UUID,
    db: Session = Depends(get_db),
):
    # Check that the car exists
    car = db.get(Car, car_id)

    if car is None:
        raise HTTPException(
            status_code=404,
            detail="Car not found.",
        )

    reservations = db.scalars(
        select(Reservation)
        .where(Reservation.car_id == car_id)
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .order_by(Reservation.pickup_at.asc())
    ).all()

    return reservations

@router.get(
    "/{car_id}/maintenance-tasks",
    response_model=list[MaintenanceTaskResponse],
)
def get_car_maintenance_tasks(
    car_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        tasks = list_tasks_for_car(db, car_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )

    return tasks

@router.post("/{car_id}/return-to-home", response_model=CarResponse)
def return_to_home_endpoint(
    car_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        car = return_car_to_home(db, car_id, current_user)
    except ValueError as exc:
        if str(exc) == "Car not found.":
            raise HTTPException(status_code=404, detail=str(exc))

        raise HTTPException(status_code=400, detail=str(exc))

    return _with_current_status(car, get_current_maintenance_by_car(db))


@router.get("/{car_id}", response_model=CarResponse)
def get_car(
    car_id: UUID,
    db: Session = Depends(get_db),
):
    car = db.scalar(
        select(Car)
        .options(
            joinedload(Car.current_location),
            joinedload(Car.home_location),
        )
        .where(Car.id == car_id)
    )

    if car is None:
        raise HTTPException(
            status_code=404,
            detail="Car not found.",
        )

    return _with_current_status(car, get_current_maintenance_by_car(db))

@router.patch("/{car_id}", response_model=CarResponse)
def update_car_endpoint(
    car_id: UUID,
    data: CarUpdate,
    db: Session = Depends(get_db),
):
    try:
        car = update_car(
            db=db,
            car_id=car_id,
            data=data,
        )

    except ValueError as exc:
        if str(exc) == "Car not found.":
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            )

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return car