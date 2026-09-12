from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CustomerUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    date_of_birth: date | None = None
    address: str | None = None
    postal_code: str | None = None
    phone_number: str | None = None
    email: str | None = None


class CustomerResponse(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str | None
    email: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomerListItem(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str | None
    email: str | None
    created_at: datetime

    reservation_count: int
    last_reservation_at: datetime | None
