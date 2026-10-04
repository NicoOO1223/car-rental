from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EmailStatus(BaseModel):
    # Whether email is set up on this stack at all (domain verified, connection stored).
    set_up: bool
    paused: bool
    from_address: str | None
    worker_running: bool
    pending: int
    failed: int
    sent_last_7_days: int
    oldest_pending_at: datetime | None
    last_sent_at: datetime | None
    # The language emails are sent in (Configuration > Business > document language).
    language: str


class EmailPause(BaseModel):
    paused: bool


class EmailTextLine(BaseModel):
    key: str
    is_subject: bool
    placeholders: list[str]
    defaults: dict[str, str]
    overrides: dict[str, str]


class EmailTextGroup(BaseModel):
    id: str
    lines: list[EmailTextLine]


class EmailTexts(BaseModel):
    languages: list[str]
    sent_in: str
    groups: list[EmailTextGroup]


class EmailTextSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(max_length=5)
    key: str = Field(max_length=60)
    # Checked against the line's own {names} on save; see app/i18n/emails.py.
    text: str = Field(max_length=4000)


class EmailPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template: str = Field(max_length=40)
    language: str = Field(max_length=5)
    # Lines being edited and not saved yet: key -> text.
    edits: dict[str, str] = Field(default_factory=dict, max_length=30)


class EmailPreview(BaseModel):
    subject: str
    body: str


class EmailTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Defaults to the signed-in person's own address.
    to_address: str | None = Field(default=None, max_length=254)


class EmailTestResult(BaseModel):
    sent: bool
    error: str | None
    to: str


class EmailMessageItem(BaseModel):
    id: UUID
    template: str
    to_address: str
    subject: str
    status: str
    attempts: int
    last_error: str | None
    created_at: datetime
    sent_at: datetime | None
    next_attempt_at: datetime
    reservation_id: UUID | None

    model_config = ConfigDict(from_attributes=True)
