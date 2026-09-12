from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select

from app.database import get_db
from app.models import Car, Reservation
from app.schemas.car import CarResponse, CarUpdate
from app.schemas.maintenance import MaintenanceTaskResponse
from app.schemas.reservation import CarReservationResponse
from app.services.availability import get_available_cars, get_car_statuses_for_date
from app.services.cars import update_car
from app.services.maintenance import list_tasks_for_car

from sqlalchemy import select
router = APIRouter(
    prefix="/api/cars",
    tags=["Cars"],
)

@router.get("", response_model=list[CarResponse])
def get_cars(
    db: Session = Depends(get_db),
):
    cars = db.scalars(
        select(Car)
        .options(
            joinedload(Car.current_location),
        )
        .order_by(Car.license_plate)
    ).all()

    return cars


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

@router.get("/{car_id}", response_model=CarResponse)
def get_car(
    car_id: UUID,
    db: Session = Depends(get_db),
):
    car = db.scalar(
        select(Car)
        .options(
            joinedload(Car.current_location),
        )
        .where(Car.id == car_id)
    )

    if car is None:
        raise HTTPException(
            status_code=404,
            detail="Car not found.",
        )

    return car

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