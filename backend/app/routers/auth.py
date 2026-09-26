from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.auth import LanguageUpdate, LoginRequest, LoginResponse
from app.schemas.user import UserResponse
from app.services.auth import AccountLocked, authenticate_user, create_access_token
from app.services.configuration import get_configuration
from app.services.login_throttle import is_ip_blocked, record_ip_failure

# Deliberately NOT protected by get_current_user — this is how a token
# is obtained in the first place.
router = APIRouter(
    prefix="/api/auth",
    tags=["Auth"],
)

def _too_many_attempts() -> HTTPException:
    return HTTPException(
        status_code=429,
        detail="Too many login attempts. Try again later.",
        headers={"Retry-After": "900"},
    )


@router.post("/login", response_model=LoginResponse)
def login(
    data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # Behind the Azure ingress this is the real client address, provided
    # uvicorn runs with --proxy-headers (see docker-entrypoint.sh).
    client_ip = request.client.host if request.client else "unknown"

    if is_ip_blocked(client_ip):
        raise _too_many_attempts()

    try:
        user = authenticate_user(db, data.email, data.password)
    except AccountLocked:
        record_ip_failure(client_ip)
        # Same response as the per-IP limit: nothing here says whether the
        # email belongs to a real account.
        raise _too_many_attempts()

    if user is None:
        record_ip_failure(client_ip)
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    expire_days = get_configuration(db).access_token_expire_days

    return LoginResponse(access_token=create_access_token(user.id, expire_days))


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_my_language(
    data: LanguageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Only the language: a person can change how the app speaks to them
    without being an admin. Everything else about an account (role, email,
    activation) stays under /api/users."""

    current_user.language = data.language
    db.commit()
    db.refresh(current_user)

    return current_user
