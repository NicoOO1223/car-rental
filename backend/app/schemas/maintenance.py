from datetime import datetime
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
    status: str
    notes: str | None
    opened_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class MaintenanceTaskCreate(BaseModel):
    car_id: UUID
    task_type: str
    notes: str | None = None
