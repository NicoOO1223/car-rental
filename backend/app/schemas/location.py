from uuid import UUID
from zoneinfo import available_timezones

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError


class LocationResponse(BaseModel):
    id: UUID
    name: str
    airport_code: str
    address: str | None
    timezone: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


def _check_timezone(value: str | None) -> str | None:
    if value is not None and value not in available_timezones():
        raise PydanticCustomError("validation.timezone_unknown", "Unknown timezone. Use an IANA name such as 'Europe/Rome'.")

    return value


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    airport_code: str = Field(min_length=2, max_length=10)
    address: str | None = Field(default=None, max_length=255)
    # Omitted: the business timezone from Configuration.
    timezone: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise PydanticCustomError("validation.name_empty", "The name cannot be empty.")
        return v

    @field_validator("airport_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not v.isalnum() or not (2 <= len(v) <= 10):
            raise PydanticCustomError("validation.location_code_invalid", "The code must be 2 to 10 letters or digits.")
        return v

    @field_validator("address")
    @classmethod
    def blank_address_is_none(cls, v: str | None) -> str | None:
        return (v.strip() or None) if v is not None else None

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_known(cls, v: str | None) -> str | None:
        return _check_timezone(v)


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    airport_code: str | None = Field(default=None, min_length=2, max_length=10)
    address: str | None = Field(default=None, max_length=255)
    timezone: str | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise PydanticCustomError("validation.name_empty", "The name cannot be empty.")
        return v

    @field_validator("airport_code")
    @classmethod
    def normalize_code(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().upper()
        if not v.isalnum() or not (2 <= len(v) <= 10):
            raise PydanticCustomError("validation.location_code_invalid", "The code must be 2 to 10 letters or digits.")
        return v

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_known(cls, v: str | None) -> str | None:
        return _check_timezone(v)
