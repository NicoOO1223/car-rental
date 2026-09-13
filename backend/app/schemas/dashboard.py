from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DashboardFleetStats(BaseModel):
    total: int
    available: int
    reserved: int
    rented: int
    maintenance: int
    cleaning: int


class DashboardReservationStats(BaseModel):
    total: int
    confirmed: int
    active: int
    completed: int
    cancelled: int


class DashboardTodayStats(BaseModel):
    pickups: int
    returns: int


class DashboardReservation(BaseModel):
    id: UUID

    customer_first_name: str
    customer_last_name: str

    car_make: str
    car_model: str
    car_license_plate: str

    pickup_location_name: str
    pickup_location_code: str

    return_location_name: str
    return_location_code: str

    pickup_at: datetime
    return_at: datetime

    status: str


class DashboardLocationStats(BaseModel):
    airport_code: str
    name: str

    total: int
    available: int
    reserved: int
    rented: int
    maintenance: int
    cleaning: int


class DashboardResponse(BaseModel):
    fleet: DashboardFleetStats
    reservations: DashboardReservationStats
    today: DashboardTodayStats

    # Split by direction rather than one pickup-sorted list: a returns
    # card needs rentals already in progress (see the router), which is a
    # different filter from pickups, not just a different sort order.
    upcoming_pickups: list[DashboardReservation]
    upcoming_returns: list[DashboardReservation]

    locations: list[DashboardLocationStats]


class DashboardFleetStatusResponse(BaseModel):
    date: date
    location_id: UUID | None
    counts: DashboardFleetStats


class DashboardRevenuePoint(BaseModel):
    date: date
    revenue: float


class DashboardRevenueResponse(BaseModel):
    start_date: date
    end_date: date
    points: list[DashboardRevenuePoint]
    total_revenue: float