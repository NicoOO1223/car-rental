from uuid import UUID

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.errors import NotFoundError
from app.database import get_db
from app.dependencies import require_authenticated_user, require_permission, require_role
from app.services.masking import mask_email, mask_phone
from app.permissions import CUSTOMERS_LIST_FULL, IDENTITY_READ, has_permission
from app.models import Customer, Reservation, User
from app.schemas.customer import (
    CustomerDataExport,
    CustomerListItem,
    CustomerPage,
    CustomerResponse,
    CustomerSummaryStats,
    CustomerUpdate,
    IdentityDetailsResponse,
    IdentityDetailsUpdate,
)
from app.schemas.reservation import CustomerReservationResponse
from app.services.audit import audit_log
from app.services.customer_search import customer_summary, search_customers
from app.services.customers import update_customer
from app.services.data_privacy import anonymize_customer, export_customer_data
from app.services.identity_details import (
    get_identity_details,
    save_identity_details,
)


router = APIRouter(
    prefix="/api/customers",
    tags=["Customers"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.get(
    "",
    response_model=CustomerPage,
)
def get_customers(
    q: str | None = Query(default=None, max_length=100),
    segment: Literal["NEW_THIS_WEEK", "REPEAT"] | None = Query(default=None),
    sort: Literal["recent", "name"] = Query(default="recent"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    rows, total = search_customers(
        db, q=q, segment=segment, sort=sort, limit=limit, offset=offset
    )

    # The list is the one place every customer's details sit side by side, so
    # only some roles see them in full. Opening a customer shows everything.
    masked = not has_permission(current_user.role, CUSTOMERS_LIST_FULL)

    items = [
        CustomerListItem(
            id=row.Customer.id,
            first_name=row.Customer.first_name,
            last_name=row.Customer.last_name,
            date_of_birth=None if masked else row.Customer.date_of_birth,
            address=None if masked else row.Customer.address,
            postal_code=row.Customer.postal_code,
            phone_number=mask_phone(row.Customer.phone_number) if masked else row.Customer.phone_number,
            email=mask_email(row.Customer.email) if masked else row.Customer.email,
            masked=masked,
            nationality=row.Customer.nationality,
            created_at=row.Customer.created_at,
            anonymized_at=row.Customer.anonymized_at,
            reservation_count=row.reservation_count,
            last_reservation_at=row.last_reservation_at,
        )
        for row in rows
    ]

    return CustomerPage(items=items, total=total, limit=limit, offset=offset)


# Declared before "/{customer_id}" so "summary" is not read as an id.
@router.get(
    "/summary",
    response_model=CustomerSummaryStats,
)
def get_customer_summary(db: Session = Depends(get_db)):
    return customer_summary(db)


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
        raise NotFoundError("customer.not_found", "Customer not found.")

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
    current_user: User = Depends(require_authenticated_user),
):
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise NotFoundError("customer.not_found", "Customer not found.")

    # A deliberate look-up of one person's full PII record — unlike the
    # list endpoint above, this is worth its own audit trail entry rather
    # than being logged on every routine list-page load.
    audit_log(
        db,
        user=current_user,
        action="customer.viewed",
        entity_type="customer",
        entity_id=customer.id,
    )
    db.commit()

    return customer


@router.patch(
    "/{customer_id}",
    response_model=CustomerResponse,
)
def update_customer_endpoint(
    customer_id: UUID,
    data: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    customer = update_customer(
        db=db,
        customer_id=customer_id,
        data=data,
        actor=current_user,
    )

    return customer


# Identity and driving licence, typed in by staff at the counter. Sensitive,
# so it lives on its own endpoints (not in the customer detail response),
# and every read and write is audited. `reservation_id` makes the response's
# `problem` account for that rental's end date (licence validity).
@router.get(
    "/{customer_id}/identity-details",
    response_model=IdentityDetailsResponse,
)
def get_identity_details_endpoint(
    customer_id: UUID,
    reservation_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(IDENTITY_READ)),
):
    return get_identity_details(db, customer_id, current_user, reservation_id)


@router.put(
    "/{customer_id}/identity-details",
    response_model=IdentityDetailsResponse,
)
def save_identity_details_endpoint(
    customer_id: UUID,
    data: IdentityDetailsUpdate,
    reservation_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(IDENTITY_READ)),
):
    return save_identity_details(
        db, customer_id, data, current_user, reservation_id
    )


# Right to erasure / right to access (GDPR Art. 17, 15/20) — meaningfully
# more sensitive and harder to undo than anything else on this router,
# which otherwise has no role gate beyond being authenticated staff.
@router.post(
    "/{customer_id}/erase",
    response_model=CustomerResponse,
    dependencies=[Depends(require_role("admin"))],
)
def erase_customer_endpoint(
    customer_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    customer = anonymize_customer(
        db=db,
        customer_id=customer_id,
        actor=current_user,
    )

    return customer


@router.get(
    "/{customer_id}/export",
    response_model=CustomerDataExport,
    dependencies=[Depends(require_role("admin"))],
)
def export_customer_data_endpoint(
    customer_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    bundle = export_customer_data(
        db=db,
        customer_id=customer_id,
        actor=current_user,
    )

    return bundle
