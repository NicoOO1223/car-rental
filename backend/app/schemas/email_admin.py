from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EmailStatus(BaseModel):
    # Whether email is set up on this stack at all (domain verified, connection stored).
    set_up: bool
    paused: bool
    from_address: str | None
    # Where replies go: what an administrator set, else the Business email.
    reply_to: str | None
    reply_to_default: str | None
    alert_recipients: list[str]
    # Links in emails need this; without it they are left out.
    storefront_url: str | None
    worker_running: bool
    pending: int
    failed: int
    sent_last_7_days: int
    oldest_pending_at: datetime | None
    last_sent_at: datetime | None
    default_language: str


class EmailPause(BaseModel):
    paused: bool


class EmailReplyTo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Empty or null = the business's own email.
    reply_to: str | None = Field(default=None, max_length=254)


class EmailAlertRecipients(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipients: list[str] = Field(max_length=20)


class EmailTypeRow(BaseModel):
    key: str
    audience: str
    can_disable: bool
    enabled: bool
    options: dict
    option_kinds: dict[str, str]
    customised_languages: list[str]
    last_sent_at: datetime | None


class EmailTemplateView(BaseModel):
    subject: str
    body: str
    default_subject: str
    default_body: str
    customised: bool


class EmailTypeDetail(BaseModel):
    key: str
    audience: str
    can_disable: bool
    enabled: bool
    options: dict
    option_kinds: dict[str, str]
    # The {names} a message of this email may use, besides the global ones, and the parts.
    values: list[str]
    global_values: list[str]
    parts: list[str]
    languages: dict[str, EmailTemplateView]


class EmailTypeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    options: dict | None = None


class EmailTemplateSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str = Field(max_length=1000)
    body: str = Field(max_length=20000)


class EmailPartText(BaseModel):
    text: str
    default: str
    customised: bool


class EmailPartRow(BaseModel):
    key: str
    part: str
    variant: str | None
    values: list[str]
    used_by: list[str]
    languages: dict[str, EmailPartText]


class EmailPartSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=10000)


class EmailPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(max_length=40)
    language: str = Field(max_length=5)
    # A draft laid over what is saved, not saved itself.
    subject: str | None = Field(default=None, max_length=1000)
    body: str | None = Field(default=None, max_length=20000)
    parts: dict[str, str] = Field(default_factory=dict, max_length=20)


class EmailPreview(BaseModel):
    subject: str
    body: str


class EmailTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Defaults to the signed-in person's own address.
    to_address: str | None = Field(default=None, max_length=254)
    # Which email to test, as it reads now with sample values; none = a short
    # message that only shows sending works.
    type: str | None = Field(default=None, max_length=40)
    language: str | None = Field(default=None, max_length=5)


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
