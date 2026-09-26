"""Booking and paying online."""

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import AppError
from app.models import Reservation, ReservationPayment
from app.routers.public.catalog import enabled_configuration
from app.schemas.public import (
    PublicBooking,
    PublicBookingAccess,
    PublicBookingCreated,
    PublicBookingLookup,
    PublicBookingRequest,
    PublicBookingStatus,
)
from app.services.client_ip import client_ip
from app.services.manage_token import create_manage_token, reservation_id_from_token
from app.services.public_booking import (
    booking_view,
    create_booking,
    find_booking,
    normalize_reference,
    renter_cancel,
    sync_payment,
)
from app.services.turnstile import require_human
from app.services.rate_limit import limit_by_ip

router = APIRouter()

bearer = HTTPBearer(auto_error=False)


def booking_from_token(
    reference: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
) -> Reservation:
    """The booking the caller's token is for. The reference in the address has
    to be that same booking, so a token cannot be used on another one."""

    reservation_id = reservation_id_from_token(credentials.credentials if credentials else None)
    reservation = db.get(Reservation, reservation_id)

    if reservation is None or reservation.public_reference != normalize_reference(reference):
        raise AppError("public.manage_token_invalid", "This link has expired. Look up your booking again.", status_code=401)

    return reservation


def _status(db: Session, reservation: Reservation) -> PublicBookingStatus:
    payment = db.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == reservation.id))

    return PublicBookingStatus(
        reference=reservation.public_reference,
        status=reservation.status,
        hold_expires_at=reservation.hold_expires_at,
        payment_status=payment.payment_status if payment else None,
    )


@router.post(
    "/bookings",
    response_model=PublicBookingCreated,
    status_code=201,
    dependencies=[Depends(limit_by_ip("public-book", 6))],
)
def create_public_booking(
    data: PublicBookingRequest,
    request: Request,
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    reservation, payment, client_secret, online, at_pickup = create_booking(
        db, data, configuration, client_ip(request)
    )

    return PublicBookingCreated(
        reference=reservation.public_reference,
        status=reservation.status,
        hold_expires_at=reservation.hold_expires_at,
        currency=configuration.default_currency,
        total_amount=float(reservation.agreed_total_amount),
        online_amount=float(online),
        due_at_pickup=float(at_pickup),
        client_secret=client_secret,
        manage_token=create_manage_token(reservation.id),
    )


@router.post(
    "/bookings/{reference}/sync-payment",
    response_model=PublicBookingStatus,
    dependencies=[Depends(limit_by_ip("public-sync", 30))],
)
def sync_public_payment(
    reservation: Reservation = Depends(booking_from_token),
    db: Session = Depends(get_db),
):
    """Called when the renter returns from Stripe. Confirms the booking from
    what Stripe says, without waiting for its webhook."""

    return _status(db, sync_payment(db, reservation))


@router.post(
    "/bookings/lookup",
    response_model=PublicBookingAccess,
    dependencies=[Depends(limit_by_ip("public-lookup", 10))],
)
def lookup_public_booking(
    data: PublicBookingLookup,
    request: Request,
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    """Reference plus the booker's email: finds a booking and gives this
    browser a token to manage it for the next hour."""

    require_human(data.captcha_token, client_ip(request))

    reservation = find_booking(db, data.reference, data.email)

    return PublicBookingAccess(manage_token=create_manage_token(reservation.id), booking=booking_view(db, reservation))


@router.get(
    "/bookings/{reference}",
    response_model=PublicBooking,
    dependencies=[Depends(limit_by_ip("public-read", 120))],
)
def get_public_booking(
    reservation: Reservation = Depends(booking_from_token),
    db: Session = Depends(get_db),
):
    return booking_view(db, reservation)


@router.post(
    "/bookings/{reference}/cancel",
    response_model=PublicBooking,
    dependencies=[Depends(limit_by_ip("public-cancel", 10))],
)
def cancel_public_booking(
    reservation: Reservation = Depends(booking_from_token),
    db: Session = Depends(get_db),
):
    """The renter cancels. The online share is refunded up to the cancellation
    deadline and kept after it."""

    cancelled = renter_cancel(db, reservation)

    return booking_view(db, cancelled)
