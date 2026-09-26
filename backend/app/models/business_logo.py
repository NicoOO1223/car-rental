from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BusinessLogo(Base):
    """
    The uploaded logo. A singleton like Configuration (one row, id fixed at
    1), kept in its own table so the image bytes never travel with the
    configuration row or show up in its audit diffs. Stored in the database
    rather than on disk or a URL so it survives redeploys, needs no extra
    storage service, and can be drawn into PDFs without a network fetch.
    """

    __tablename__ = "business_logo"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)

    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint("id = 1", name="business_logo_singleton"),
    )
