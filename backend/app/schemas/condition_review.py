from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ConditionPhotoResponse(BaseModel):
    id: UUID
    category: str
    content_type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ConditionReviewResponse(BaseModel):
    id: UUID
    reservation_id: UUID
    kind: str
    tire_condition: str | None
    reviewed_at: datetime | None
    photos: list[ConditionPhotoResponse]

    model_config = ConfigDict(from_attributes=True)


class TireConditionInput(BaseModel):
    tire_condition: str | None = None


class ConditionPhotoInput(BaseModel):
    category: str
    # A data URL, same shape as a signature image or the business logo
    # upload — JSON over multipart, no extra dependency.
    data_url: str = Field(min_length=1)
