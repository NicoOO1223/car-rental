from uuid import UUID

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.errors import AppError
from app.database import get_db
from app.models import User
from app.permissions import WRITE, has_permission
from app.services.auth import decode_access_token

# auto_error=False so a missing header raises our own 401 (with a
# consistent detail message) rather than FastAPI's default 403.
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = AppError(
        "auth.not_authenticated",
        "Not authenticated.",
        status_code=401,
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise unauthorized

    try:
        user_id, issued_at = decode_access_token(credentials.credentials)
        user = db.get(User, UUID(user_id))
    except (jwt.PyJWTError, ValueError, KeyError):
        raise unauthorized

    # A disabled account is rejected the same way as an invalid token
    # (same status code, same message) rather than a distinct error, so
    # a stolen/expired token for a deactivated account doesn't reveal
    # that the account exists.
    if user is None or not user.is_active:
        raise unauthorized

    # Revoked sessions: password reset, deactivation and role changes set
    # token_valid_after. A token from before that moment, or one with no
    # issued-at at all (created before the claim existed), no longer works.
    if user.token_valid_after is not None and (
        issued_at is None or issued_at < user.token_valid_after.timestamp()
    ):
        raise unauthorized

    return user


_READ_METHODS = {"GET", "HEAD", "OPTIONS"}


def require_authenticated_user(request: Request, user: User = Depends(get_current_user)) -> User:
    """
    Access to the staff API. Every role may read; changing anything needs a role
    that can write (not read-only). Because this is the dependency every staff
    router already uses, a read-only user is refused on every change in one place,
    and a route added later is safe without anyone remembering to protect it.
    """

    if request.method not in _READ_METHODS and not has_permission(user.role, WRITE):
        raise AppError("auth.read_only", "Your account can only view, not change, anything.", status_code=403)

    return user


def require_permission(permission: str):
    """The signed-in user must hold this permission (see app/permissions.py)."""

    def dependency(request: Request, user: User = Depends(require_authenticated_user)) -> User:
        if not has_permission(user.role, permission):
            raise AppError("auth.forbidden", "You do not have permission to perform this action.", status_code=403)

        return user

    return dependency


def require_any_role(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise AppError("auth.forbidden", "You do not have permission to perform this action.", status_code=403)

        return user

    return dependency


def require_role(role: str):
    return require_any_role(role)
