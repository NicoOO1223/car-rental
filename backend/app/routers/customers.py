from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from pydantic import BaseModel

from app.database import get_db
from app.dependencies import require_authenticated_user, require_role
from app.models import Customer, Reservation, User
from app.schemas.customer import (
    CustomerDataExport,
    CustomerListItem,
    CustomerResponse,
    CustomerUpdate,
)
from app.schemas.reservation import CustomerReservationResponse
from app.services.audit import audit_log
from app.services.customers import update_customer
from app.services.data_privacy import anonymize_customer, export_customer_data
from app.services.identity_verification import (
    create_verification_session,
    refresh_verification_status,
)


router = APIRouter(
    prefix="/api/customers",
    tags=["Customers"],
    dependencies=[Depends(require_authenticated_user)],
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
            anonymized_at=row.Customer.anonymized_at,
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
    current_user: User = Depends(require_authenticated_user),
):
    customer = db.get(Customer, customer_id)

    if customer is None:
        raise HTTPException(
            status_code=404,
            detail="Customer not found.",
        )

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
    try:
        customer = update_customer(
            db=db,
            customer_id=customer_id,
            data=data,
            actor=current_user,
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


class VerificationSessionResponse(BaseModel):
    client_secret: str | None


def _raise_for_identity_verification_error(exc: ValueError):
    if str(exc) == "Customer not found.":
        raise HTTPException(status_code=404, detail=str(exc))

    raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/{customer_id}/identity-verification",
    response_model=VerificationSessionResponse,
)
def create_identity_verification_session_endpoint(
    customer_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        _customer, client_secret = create_verification_session(
            db=db,
            customer_id=customer_id,
            actor=current_user,
        )
    except ValueError as exc:
        _raise_for_identity_verification_error(exc)

    return VerificationSessionResponse(client_secret=client_secret)


@router.post(
    "/{customer_id}/identity-verification/refresh",
    response_model=CustomerResponse,
)
def refresh_identity_verification_status_endpoint(
    customer_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    try:
        customer = refresh_verification_status(
            db=db,
            customer_id=customer_id,
            actor=current_user,
        )
    except ValueError as exc:
        _raise_for_identity_verification_error(exc)

    return customer


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
    try:
        customer = anonymize_customer(
            db=db,
            customer_id=customer_id,
            actor=current_user,
        )
    except ValueError as exc:
        _raise_for_identity_verification_error(exc)

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
    try:
        bundle = export_customer_data(
            db=db,
            customer_id=customer_id,
            actor=current_user,
        )
    except ValueError as exc:
        _raise_for_identity_verification_error(exc)

    return bundle
