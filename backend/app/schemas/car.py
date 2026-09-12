from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
    current_location: LocationSummary
    status: str
    mileage: int | None
    tire_condition: str | None
    last_oil_change_at: date | None

    model_config = ConfigDict(from_attributes=True)


class CarUpdate(BaseModel):
    make: str | None = None
    model: str | None = None
    year: int | None = None
    license_plate: str | None = None
    category: str | None = None
    transmission: str | None = None
    fuel_type: str | None = None
    seats: int | None = None
    price_per_day: Decimal | None = None
    current_location_id: UUID | None = None
    status: str | None = None
    mileage: int | None = None
    tire_condition: str | None = None
    last_oil_change_at: date | None = None
