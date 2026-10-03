from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic_core import PydanticCustomError

from app.models.user import VALID_ROLES


class UserResponse(BaseModel):
    id: UUID
    email: str
    role: str
    hidden_nav_items: list[str]
    # The language this person chose; None means the business default.
    language: str | None = None

    model_config = ConfigDict(from_attributes=True)


class UserListItem(BaseModel):
    id: UUID
    email: str
    role: str
    is_active: bool
    created_at: datetime
    hidden_nav_items: list[str]

    model_config = ConfigDict(from_attributes=True)


# bcrypt only reads the first 72 bytes of a password and refuses longer ones
# outright, so a longer one is rejected here with a message, not left to fail
# as a server error. Counted in bytes: an accented letter takes two.
MAX_PASSWORD_BYTES = 72


def check_password_bytes(password: str) -> str:
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise PydanticCustomError(
            "validation.password_too_long", "Password is too long (at most 72 bytes)."
        )

    return password


def _validate_password_length(password: str) -> str:
    if len(password) < 8:
        raise PydanticCustomError("validation.password_too_short", "Password must be at least 8 characters.")
    return check_password_bytes(password)


def _validate_role(role: str) -> str:
    if role not in VALID_ROLES:
        raise PydanticCustomError(
            "validation.role_invalid",
            "Role must be one of: {allowed}.",
            {"allowed": ", ".join(sorted(VALID_ROLES))},
        )
    return role


class UserCreate(BaseModel):
    email: str
    password: str
    role: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        return _validate_password_length(v)

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str) -> str:
        return _validate_role(v)


class UserUpdate(BaseModel):
    email: str | None = None
    role: str | None = None
    is_active: bool | None = None
    hidden_nav_items: list[str] | None = None

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str | None) -> str | None:
        return v if v is None else _validate_role(v)


class PasswordResetRequest(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        return _validate_password_length(v)
