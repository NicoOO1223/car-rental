from datetime import date
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Customer
from app.schemas.customer import CustomerUpdate


def normalized_customer_key(
    first_name: str,
    last_name: str,
    date_of_birth: date,
    address: str,
    postal_code: str,
) -> tuple:
    """
    Case-insensitive, whitespace-trimmed identity key for a customer.

    Used by the standalone duplicate-merge script to group existing
    customers in memory. `find_matching_customer` below expresses the
    same rule in SQL for use at reservation-creation time — keep the
    two in sync.
    """

    return (
        first_name.strip().lower(),
        last_name.strip().lower(),
        date_of_birth,
        address.strip().lower(),
        postal_code.strip().lower(),
    )


def find_matching_customer(
    db: Session,
    *,
    first_name: str,
    last_name: str,
    date_of_birth: date,
    address: str,
    postal_code: str,
) -> Customer | None:
    """
    Look up an existing customer with the exact same details
    (case-insensitive, whitespace-trimmed). Returns None if no
    match is found, so a new Customer row should be created.
    """

    return db.scalar(
        select(Customer).where(
            func.lower(func.trim(Customer.first_name)) == first_name.strip().lower(),
            func.lower(func.trim(Customer.last_name)) == last_name.strip().lower(),
            Customer.date_of_birth == date_of_birth,
            func.lower(func.trim(Customer.address)) == address.strip().lower(),
            func.lower(func.trim(Customer.postal_code)) == postal_code.strip().lower(),
        )
    )


def update_customer(
    db: Session,
    customer_id: UUID,
    data: CustomerUpdate,
) -> Customer:
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise ValueError("Customer not found.")

    updates = data.model_dump(exclude_unset=True)

    for field, value in updates.items():
        setattr(customer, field, value)

    db.commit()
    db.refresh(customer)

    return customer
