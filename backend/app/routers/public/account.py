"""Renter accounts: register, sign in, and the bookings they own."""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import AppError
from app.models import CustomerAccount
from app.routers.public.catalog import enabled_configuration
from app.schemas.public import (
    AccountBookingAccess,
    AccountClaim,
    AccountForgotPassword,
    AccountLinkToken,
    AccountLogin,
    AccountProfile,
    AccountRegister,
    AccountResetPassword,
    AccountSession,
    AccountStatus,
    PublicBooking,
)
from app.languages import SUPPORTED_LANGUAGES
from app.services.auth import AccountLocked
from app.services.client_ip import client_ip
from app.services.customer_accounts import (
    account_reservations,
    authenticate_account,
    create_account_token,
    current_account,
    link_booking,
    owned_reservation,
    register_account,
    reset_password,
    send_reset_email,
    send_verification_email,
    sign_out_everywhere,
    verified_account,
    verify_email,
)
from app.services.manage_token import create_manage_token
from app.services.login_throttle import is_ip_blocked, record_ip_failure
from app.services.public_booking import booking_view, find_booking
from app.services.rate_limit import limit_by_ip
from app.services.turnstile import require_human

router = APIRouter(prefix="/account")


def _profile(account: CustomerAccount) -> AccountProfile:
    return AccountProfile(
        email=account.email,
        first_name=account.first_name,
        last_name=account.last_name,
        email_verified=account.email_verified_at is not None,
    )


def _session(account: CustomerAccount) -> AccountSession:
    return AccountSession(access_token=create_account_token(account.id), account=_profile(account))


@router.post(
    "/register",
    response_model=AccountStatus,
    status_code=202,
    dependencies=[Depends(limit_by_ip("account-register", 5))],
)
def register(
    data: AccountRegister,
    request: Request,
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    require_human(data.captcha_token, client_ip(request))

    language = data.language if data.language in SUPPORTED_LANGUAGES else None
    account = register_account(db, data.email, data.password, data.first_name, data.last_name, language)

    # The same answer whether or not the address already had an account, so this
    # cannot be used to find out who does. The new owner gets a link to confirm.
    if account is not None:
        send_verification_email(db, account)

    return AccountStatus(status="check_email")


@router.post(
    "/verify",
    response_model=AccountStatus,
    dependencies=[Depends(limit_by_ip("account-verify", 20))],
)
def verify(data: AccountLinkToken, db: Session = Depends(get_db)):
    verify_email(db, data.token)

    return AccountStatus(status="verified")


@router.post(
    "/resend-verification",
    response_model=AccountStatus,
    dependencies=[Depends(limit_by_ip("account-resend", 5))],
)
def resend_verification(account: CustomerAccount = Depends(current_account), db: Session = Depends(get_db)):
    send_verification_email(db, account)

    return AccountStatus(status="sent")


@router.post(
    "/forgot-password",
    response_model=AccountStatus,
    status_code=202,
    dependencies=[Depends(limit_by_ip("account-forgot", 5))],
)
def forgot_password(
    data: AccountForgotPassword,
    request: Request,
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    require_human(data.captcha_token, client_ip(request))
    send_reset_email(db, data.email)

    # Always the same: nothing says whether the address has an account.
    return AccountStatus(status="check_email")


@router.post(
    "/reset-password",
    response_model=AccountStatus,
    dependencies=[Depends(limit_by_ip("account-reset", 10))],
)
def reset(data: AccountResetPassword, db: Session = Depends(get_db)):
    reset_password(db, data.token, data.password)

    return AccountStatus(status="reset")

@router.post(
    "/login",
    response_model=AccountSession,
    dependencies=[Depends(limit_by_ip("account-login", 20))],
)
def login(
    data: AccountLogin,
    request: Request,
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    ip = client_ip(request)
    too_many = AppError(
        "auth.too_many_attempts",
        "Too many login attempts. Try again later.",
        status_code=429,
        headers={"Retry-After": "900"},
    )

    if is_ip_blocked(ip):
        raise too_many

    require_human(data.captcha_token, ip)

    try:
        account = authenticate_account(db, data.email, data.password)
    except AccountLocked:
        record_ip_failure(ip)
        # Same answer as the per-IP limit: nothing says the account exists.
        raise too_many

    if account is None:
        record_ip_failure(ip)
        raise AppError("auth.invalid_credentials", "Incorrect email or password.", status_code=401)

    return _session(account)


@router.post("/logout", status_code=204)
def logout(account: CustomerAccount = Depends(current_account), db: Session = Depends(get_db)):
    sign_out_everywhere(db, account)

    return Response(status_code=204)


@router.get("/me", response_model=AccountProfile)
def me(account: CustomerAccount = Depends(current_account)):
    return _profile(account)


@router.get("/bookings", response_model=list[PublicBooking])
def my_bookings(account: CustomerAccount = Depends(verified_account), db: Session = Depends(get_db)):
    return [booking_view(db, reservation) for reservation in account_reservations(db, account)]


@router.post(
    "/bookings/claim",
    response_model=PublicBooking,
    dependencies=[Depends(limit_by_ip("account-claim", 10))],
)
def claim_booking(
    data: AccountClaim,
    account: CustomerAccount = Depends(verified_account),
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    """Adds a booking to this account. Needs the reference and the booker's
    email together, the same proof as the guest lookup."""

    reservation = find_booking(db, data.reference, data.email)
    link_booking(db, account, reservation)

    return booking_view(db, reservation)


@router.post("/bookings/{reference}/access", response_model=AccountBookingAccess)
def booking_access(
    reference: str,
    account: CustomerAccount = Depends(verified_account),
    db: Session = Depends(get_db),
):
    """Opens one of the account's own bookings without asking for the email
    again: the same short-lived token the guest lookup gives."""

    return AccountBookingAccess(manage_token=create_manage_token(owned_reservation(db, account, reference).id))
