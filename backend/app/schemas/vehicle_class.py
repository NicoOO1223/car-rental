from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ClassSummary(BaseModel):
    """What a car shows of its class."""

    id: UUID
    slug: str
    name: dict[str, str]

    model_config = ConfigDict(from_attributes=True)


class VehicleClassResponse(BaseModel):
    id: UUID
    slug: str
    name: dict[str, str]
    description: dict[str, str]
    price_per_day: Decimal
    sort_order: int
    offered_online: bool
    retired_at: datetime | None
    is_retired: bool
    # Cars in the fleet (not retired) and how many of them may be offered online.
    car_count: int
    online_car_count: int

    model_config = ConfigDict(from_attributes=True)


class VehicleClassCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Per language; English is required.
    name: dict[str, str]
    description: dict[str, str] = Field(default_factory=dict)
    price_per_day: Decimal = Field(ge=0, max_digits=8, decimal_places=2)
    sort_order: int = Field(default=0, ge=0, le=10_000)
    offered_online: bool = True


class VehicleClassUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: dict[str, str] | None = None
    description: dict[str, str] | None = None
    price_per_day: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    offered_online: bool | None = None


class CarClassAssign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # None takes the car out of its class (it keeps the last price until edited).
    class_id: UUID | None
