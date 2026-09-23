from uuid import UUID

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth import decode_access_token

# auto_error=False so a missing header raises our own 401 (with a
# consistent detail message) rather than FastAPI's default 403.
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=401,
        detail="Not authenticated.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise unauthorized

    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise unauthorized

    user = db.get(User, UUID(user_id))

    # A disabled account is rejected the same way as an invalid token
    # (same status code, same message) rather than a distinct error, so
    # a stolen/expired token for a deactivated account doesn't reveal
    # that the account exists.
    if user is None or not user.is_active:
        raise unauthorized

    return user


def require_authenticated_user(user: User = Depends(get_current_user)) -> User:
    return user


def require_any_role(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to perform this action.",
            )

        return user

    return dependency


def require_role(role: str):
    return require_any_role(role)
