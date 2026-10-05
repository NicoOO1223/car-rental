from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.vehicle_class import ClassSummary


class LocationSummary(BaseModel):
    id: UUID
    name: str
    airport_code: str

    model_config = ConfigDict(from_attributes=True)


class CarResponse(BaseModel):
    id: UUID
    make: str
    model: str
    year: int
    license_plate: str
    category: str | None
    transmission: str | None
    fuel_type: str | None
    seats: int | None
    price_per_day: Decimal
    # The class this car belongs to; its price is the class price.
    class_id: UUID | None = None
    vehicle_class: ClassSummary | None = None
    has_photo: bool
    photo_version: int | None
    current_location: LocationSummary
    home_location: LocationSummary
    is_away_from_home: bool
    status: str
    mileage: int | None
    tire_condition: str | None
    last_oil_change_at: date | None
    # The odometer reading at that oil change; set automatically when a
    # ROUTINE_SERVICE task completes, never by hand (absent from CarUpdate).
    last_oil_change_mileage: int | None
    last_inspection_at: date | None
    next_inspection_due: date | None
    insured_from: date | None
    insured_until: date | None
    insurance_cost: Decimal | None
    offered_online: bool
    # Set once the car has left the fleet; it is then left out of every list.
    retired_at: datetime | None
    is_retired: bool

    model_config = ConfigDict(from_attributes=True)


class CarUpdate(BaseModel):
    # A car's status is never set by hand: reservations, handovers and
    # maintenance windows drive it. extra="forbid" makes a client that
    # still sends "status" fail loudly instead of being silently ignored.
    model_config = ConfigDict(extra="forbid")

    make: str | None = None
    model: str | None = None
    year: int | None = None
    license_plate: str | None = None
    category: str | None = None
    transmission: str | None = None
    fuel_type: str | None = None
    seats: int | None = None
    home_location_id: UUID | None = None
    mileage: int | None = None
    tire_condition: str | None = None
    last_oil_change_at: date | None = None
    last_inspection_at: date | None = None
    next_inspection_due: date | None = None
    insured_from: date | None = None
    insured_until: date | None = None
    insurance_cost: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    # Whether the public storefront may offer this car.
    offered_online: bool | None = None


class CarCreate(BaseModel):
    """A vehicle joining the fleet. It starts AVAILABLE at its home location;
    everything after that is driven by reservations, handovers and maintenance."""

    model_config = ConfigDict(extra="forbid")

    make: str = Field(min_length=1, max_length=50)
    model: str = Field(min_length=1, max_length=50)
    year: int = Field(ge=1980, le=2100)
    license_plate: str = Field(min_length=1, max_length=20)
    category: str | None = Field(default=None, max_length=50)
    transmission: str | None = Field(default=None, max_length=20)
    fuel_type: str | None = Field(default=None, max_length=20)
    seats: int | None = Field(default=None, ge=1, le=20)
    # Required unless the car joins a class, which sets its price.
    price_per_day: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)
    class_id: UUID | None = None
    home_location_id: UUID
    mileage: int | None = Field(default=None, ge=0)
    # Off until staff have added a photo and are ready to rent it online.
    offered_online: bool = False


class DailyRateResponse(BaseModel):
    date: date
    price: Decimal


class CarPriceUpdate(BaseModel):
    """A vehicle's daily rate; changed only through the admin panel."""

    price_per_day: Decimal = Field(ge=0, max_digits=8, decimal_places=2)
