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
    customer_phone_number: str | None
    customer_nationality: str | None

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

    # The full price breakdown total (base + surcharges + extras),
    # computed fresh from the reservation's current details — the same
    # figure a payment-intent/cash-payment charge would use, not
    # necessarily what (if anything) has actually been paid yet.
    total_price: float


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


class DashboardRevenueByMethod(BaseModel):
    card: float
    cash: float


class DashboardRevenueResponse(BaseModel):
    start_date: date
    end_date: date

    # Vehicle revenue: day-rate x duration of COMPLETED reservations,
    # attributed to pickup date. Deliberately excludes surcharges/extras
    # — see get_daily_revenue()'s docstring.
    points: list[DashboardRevenuePoint]
    total_revenue: float

    # Money actually collected: SUCCEEDED handover payments, attributed
    # to payment date. Includes surcharges/extras (they're baked into
    # payment_amount), excludes anything later refunded — see
    # get_collected_revenue()'s docstring.
    collected_points: list[DashboardRevenuePoint]
    total_collected: float
    collected_by_method: DashboardRevenueByMethod
    total_refunded: float