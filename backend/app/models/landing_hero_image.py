from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LandingHeroImage(Base):
    """
    The storefront landing page's hero photo. A singleton like
    Configuration and BusinessLogo (one row, id fixed at 1), but — unlike
    the logo — the bytes themselves live in blob storage (or local disk in
    dev/test) via app/services/photo_storage.py, the same way a
    ConditionPhoto's do: a hero banner is realistically much larger than the
    logo's 300KB/512px cap, too large to keep comfortably as a database row.
    """

    __tablename__ = "landing_hero_image"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)

    blob_path: Mapped[str] = mapped_column(String(300), nullable=False)
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint("id = 1", name="landing_hero_image_singleton"),
    )
