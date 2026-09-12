from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from typing import Literal

from app.schemas.customer import CustomerUpdate

class CustomerCreate(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str
    email: str


class CustomerSummary(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str | None
    email: str | None

    model_config = ConfigDict(from_attributes=True)


class CarSummary(BaseModel):
    id: UUID
    make: str
    model: str
    license_plate: str

    model_config = ConfigDict(from_attributes=True)


class LocationSummary(BaseModel):
    id: UUID
    name: str
    airport_code: str

    model_config = ConfigDict(from_attributes=True)


class ReservationCreate(BaseModel):
    customer: CustomerCreate

    car_id: UUID

    pickup_location_id: UUID
    return_location_id: UUID

    pickup_at: datetime
    return_at: datetime


class ReservationResponse(BaseModel):
    id: UUID

    customer_id: UUID
    car_id: UUID

    pickup_location_id: UUID
    return_location_id: UUID

    pickup_at: datetime
    return_at: datetime

    status: str

    customer: CustomerSummary
    car: CarSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    model_config = ConfigDict(from_attributes=True)


class ReservationListResponse(BaseModel):
    id: UUID

    customer: CustomerSummary
    car: CarSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    pickup_at: datetime
    return_at: datetime

    status: str

    model_config = ConfigDict(from_attributes=True)


class CarReservationResponse(BaseModel):
    id: UUID

    customer: CustomerSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    pickup_at: datetime
    return_at: datetime

    status: str

    model_config = ConfigDict(from_attributes=True)


class CustomerReservationResponse(BaseModel):
    id: UUID

    car: CarSummary

    pickup_location: LocationSummary
    return_location: LocationSummary

    pickup_at: datetime
    return_at: datetime

    status: str

    model_config = ConfigDict(from_attributes=True)

class ReservationStatusUpdate(BaseModel):
    # ACTIVE is deliberately excluded — a CONFIRMED reservation can only
    # become ACTIVE via the handover flow (payment + signature + agreement),
    # never as a direct client-supplied status value.
    status: Literal[
        "CONFIRMED",
        "COMPLETED",
        "CANCELLED",
    ]


class ReservationUpdate(BaseModel):
    pickup_at: datetime | None = None
    return_at: datetime | None = None

    pickup_location_id: UUID | None = None
    return_location_id: UUID | None = None

    car_id: UUID | None = None

    customer: CustomerUpdate | None = None