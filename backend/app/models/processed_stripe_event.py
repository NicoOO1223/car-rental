from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ProcessedStripeEvent(Base):
    """One row per Stripe webhook event already handled. Stripe delivers
    events at least once and may retry, so the primary key doubles as the
    dedupe check: inserting an id that exists means it was already applied."""

    __tablename__ = "processed_stripe_events"

    event_id: Mapped[str] = mapped_column(String(255), primary_key=True)

    event_type: Mapped[str] = mapped_column(String(100), nullable=False)

    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
