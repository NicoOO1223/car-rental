from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditLogListItem(BaseModel):
    id: UUID
    user_id: UUID | None
    user_email: str | None
    action: str
    entity_type: str
    entity_id: UUID | None
    details: dict | None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogListItem]
    total: int
    limit: int
    offset: int


class AuditLogActor(BaseModel):
    id: UUID
    email: str
