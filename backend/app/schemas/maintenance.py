from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
    status: str
    notes: str | None
    starts_at: datetime | None
    ends_at: datetime | None
    opened_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class MaintenanceTaskCreate(BaseModel):
    car_id: UUID
    task_type: str
    # Required for MAINTENANCE, not allowed for CLEANING.
    category: str | None = None
    notes: str | None = None
    # Required: the window is what takes the car out of service (and what
    # shows on the car's calendar). Only tasks created before windows
    # existed can lack one.
    starts_at: datetime
    ends_at: datetime


class MaintenanceTaskComplete(BaseModel):
    # Required when closing a TECHNICAL_INSPECTION task: the closing day
    # becomes the car's last inspection and this its next one.
    next_inspection_due: date | None = None
