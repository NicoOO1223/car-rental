from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ExtraResponse(BaseModel):
    """One bookable add-on from the catalog."""

    id: UUID
    code: str
    name: str
    description: str | None

    price: Decimal
    price_unit: str  # PER_DAY | PER_RENTAL

    max_quantity: int
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class ExtraSelectionRequest(BaseModel):
    """An add-on chosen by the client, on a quote or a booking."""

    extra_id: UUID

    # The real per-extra bound is extras.max_quantity, re-checked in
    # app/services/extras.py::resolve_extra_selections. le=10 here is only
    # a coarse guard so an absurd payload is rejected as a 422 before any
    # database work happens.
    quantity: int = Field(default=1, ge=1, le=10)
