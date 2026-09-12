from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LocationResponse(BaseModel):
    id: UUID
    name: str
    airport_code: str
    address: str | None

    model_config = ConfigDict(from_attributes=True)