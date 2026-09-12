from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Customer, Reservation
from app.schemas.customer import (
    CustomerListItem,
    CustomerResponse,
    CustomerUpdate,
)
from app.schemas.reservation import CustomerReservationResponse
from app.services.customers import update_customer


router = APIRouter(
    prefix="/api/customers",
    tags=["Customers"],
    dependencies=[Depends(get_current_user)],
)


@router.get(
    "",
    response_model=list[CustomerListItem],
)
def get_customers(
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(
            Customer,
            func.count(Reservation.id).label("reservation_count"),
            func.max(Reservation.created_at).label("last_reservation_at"),
        )
        .outerjoin(
            Reservation,
            Reservation.customer_id == Customer.id,
        )
        .group_by(Customer.id)
        .order_by(
            func.max(Reservation.created_at).desc().nulls_last()
        )
    ).all()

    return [
        CustomerListItem(
            id=row.Customer.id,
            first_name=row.Customer.first_name,
            last_name=row.Customer.last_name,
            date_of_birth=row.Customer.date_of_birth,
            address=row.Customer.address,
            postal_code=row.Customer.postal_code,
            phone_number=row.Customer.phone_number,
            email=row.Customer.email,
            created_at=row.Customer.created_at,
            reservation_count=row.reservation_count,
            last_reservation_at=row.last_reservation_at,
        )
        for row in rows
    ]


@router.get(
    "/{customer_id}/reservations",
    response_model=list[CustomerReservationResponse],
)
def get_customer_reservations(
    customer_id: UUID,
    db: Session = Depends(get_db),
):
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise HTTPException(
            status_code=404,
            detail="Customer not found.",
        )

    reservations = db.scalars(
        select(Reservation)
        .where(Reservation.customer_id == customer_id)
        .options(
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
        )
        .order_by(Reservation.pickup_at.desc())
    ).all()

    return reservations


@router.get(
    "/{customer_id}",
    response_model=CustomerResponse,
)
def get_customer(
    customer_id: UUID,
    db: Session = Depends(get_db),
):
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise HTTPException(
            status_code=404,
            detail="Customer not found.",
        )

    return customer


@router.patch(
    "/{customer_id}",
    response_model=CustomerResponse,
)
def update_customer_endpoint(
    customer_id: UUID,
    data: CustomerUpdate,
    db: Session = Depends(get_db),
):
    try:
        customer = update_customer(
            db=db,
            customer_id=customer_id,
            data=data,
        )

    except ValueError as exc:
        if str(exc) == "Customer not found.":
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            )

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return customer
