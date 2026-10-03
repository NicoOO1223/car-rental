from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LandingAboutImage(Base):
    """
    The storefront landing page's "About" photo — the same idea as
    LandingHeroImage, a singleton whose bytes live in blob storage (or
    local disk in dev/test) via app/services/photo_storage.py, stored in
    the same "landing-images" container under its own fixed path so it
    never collides with the hero's.
    """

    __tablename__ = "landing_about_image"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)

    blob_path: Mapped[str] = mapped_column(String(300), nullable=False)
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint("id = 1", name="landing_about_image_singleton"),
    )
