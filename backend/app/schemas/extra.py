from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.languages import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES


class ExtraTranslation(BaseModel):
    """One language's wording of an extra. Empty means "use the English"."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=255)


def _known_languages(value):
    if value is None:
        return value

    for language in value:
        if language == DEFAULT_LANGUAGE or language not in SUPPORTED_LANGUAGES:
            raise PydanticCustomError(
                "validation.language_unsupported",
                "Language must be one of: {allowed}.",
                {"allowed": ", ".join(lang for lang in SUPPORTED_LANGUAGES if lang != DEFAULT_LANGUAGE)},
            )

    return value


class ExtraResponse(BaseModel):
    """One bookable add-on from the catalog."""

    id: UUID
    code: str
    name: str
    description: str | None
    translations: dict[str, dict[str, str]] = {}

    price: Decimal
    price_unit: str  # PER_DAY | PER_RENTAL

    max_quantity: int
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class AdminExtraResponse(ExtraResponse):
    """An add-on as the admin sees it: retired ones included."""

    is_active: bool
    created_at: datetime
    updated_at: datetime


class ExtraCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    translations: dict[str, ExtraTranslation] | None = None
    price: Decimal = Field(ge=0, max_digits=8, decimal_places=2)
    price_unit: Literal["PER_DAY", "PER_RENTAL"]
    # The booking request itself caps quantity at 10 (ExtraSelectionRequest).
    max_quantity: int = Field(default=1, ge=1, le=10)

    _languages = field_validator("translations")(_known_languages)


class ExtraUpdate(BaseModel):
    """Everything but the code, which the frontend's icons key on."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    translations: dict[str, ExtraTranslation] | None = None
    price: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)
    price_unit: Literal["PER_DAY", "PER_RENTAL"] | None = None
    max_quantity: int | None = Field(default=None, ge=1, le=10)
    is_active: bool | None = None

    _languages = field_validator("translations")(_known_languages)


class ExtraOrderUpdate(BaseModel):
    """Every extra's id, in the order they should be shown."""

    ids: list[UUID]


class ExtraSelectionRequest(BaseModel):
    """An add-on chosen by the client, on a quote or a booking."""

    extra_id: UUID

    # The real per-extra bound is extras.max_quantity, re-checked in
    # app/services/extras.py::resolve_extra_selections. le=10 here is only
    # a coarse guard so an absurd payload is rejected as a 422 before any
    # database work happens.
    quantity: int = Field(default=1, ge=1, le=10)
