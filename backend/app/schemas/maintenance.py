from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MaintenanceTaskCarSummary(BaseModel):
    id: UUID
    make: str
    model: str
    license_plate: str

    model_config = ConfigDict(from_attributes=True)


class MaintenanceTaskResponse(BaseModel):
    id: UUID
    car: MaintenanceTaskCarSummary
    task_type: str
    category: str | None
    cleaning_type: str | None
    status: str
    notes: str | None
    cost: Decimal | None
    starts_at: datetime | None
    ends_at: datetime | None
    opened_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class FleetMaintenanceTaskResponse(BaseModel):
    """An open task tagged with which car, for views that show every car at
    once (the fleet timeline) — the counterpart of FleetReservationResponse."""

    id: UUID
    car_id: UUID
    task_type: str
    category: str | None
    cleaning_type: str | None
    status: str
    notes: str | None
    starts_at: datetime | None
    ends_at: datetime | None
    opened_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MaintenanceTaskPage(BaseModel):
    items: list[MaintenanceTaskResponse]
    total: int
    limit: int
    offset: int
    # Open tasks overall, not just on this page.
    open_maintenance: int
    open_cleaning: int


class MaintenanceTaskCreate(BaseModel):
    car_id: UUID
    task_type: str
    # Required for MAINTENANCE, not allowed for CLEANING.
    category: str | None = None
    # Optional, only allowed for CLEANING.
    cleaning_type: str | None = None
    notes: str | None = None
    # What the work costs, if known yet.
    cost: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    # Required: the window is what takes the car out of service (and what
    # shows on the car's calendar). Only tasks created before windows
    # existed can lack one.
    starts_at: datetime
    ends_at: datetime


class MaintenanceTaskComplete(BaseModel):
    # Required when closing a TECHNICAL_INSPECTION task: the closing day
    # becomes the car's last inspection and this its next one.
    next_inspection_due: date | None = None
    # The final cost, replacing any estimate entered when the task was logged.
    cost: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
