import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ConditionReview(Base):
    """
    An employee's optional reassessment of a car's condition at one end of
    one rental — pickup or return. At most one per (reservation, kind): a
    second save to the same kind updates this row rather than adding
    another. Saving a tire_condition also stamps it onto the car itself
    (Car.tire_condition), the same way completing a ROUTINE_SERVICE
    maintenance task stamps Car.last_oil_change_mileage.

    Never required to proceed through check-in or check-out — it exists
    purely so a skipped review can be noticed (see
    app/services/condition_reviews.py's condition_review_overdue()), not to
    gate anything.
    """

    __tablename__ = "condition_reviews"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reservations.id"),
        nullable=False,
    )

    reservation: Mapped["Reservation"] = relationship("Reservation")

    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # CHECK_IN | CHECK_OUT

    tire_condition: Mapped[str | None] = mapped_column(String(20))  # GOOD|FAIR|WORN|NEEDS_REPLACEMENT

    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    photos: Mapped[list["ConditionPhoto"]] = relationship(
        back_populates="review",
        cascade="all, delete-orphan",
        order_by="ConditionPhoto.created_at",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("reservation_id", "kind", name="uq_condition_reviews_reservation_kind"),
        CheckConstraint("kind IN ('CHECK_IN','CHECK_OUT')", name="valid_condition_review_kind"),
        CheckConstraint(
            "tire_condition IS NULL OR tire_condition IN ('GOOD','FAIR','WORN','NEEDS_REPLACEMENT')",
            name="valid_condition_review_tire_condition",
        ),
    )


class ConditionPhoto(Base):
    """One photo attached to a ConditionReview. The bytes themselves live in
    Azure Blob Storage (or, in dev/test, on local disk) via
    app/services/photo_storage.py — only the path is kept here."""

    __tablename__ = "condition_photos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    condition_review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("condition_reviews.id", ondelete="CASCADE"),
        nullable=False,
    )

    review: Mapped["ConditionReview"] = relationship(back_populates="photos")

    category: Mapped[str] = mapped_column(String(10), nullable=False)  # EXTERIOR | INTERIOR

    blob_path: Mapped[str] = mapped_column(String(300), nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("category IN ('EXTERIOR','INTERIOR')", name="valid_condition_photo_category"),
        Index("ix_condition_photos_condition_review_id", "condition_review_id"),
    )
