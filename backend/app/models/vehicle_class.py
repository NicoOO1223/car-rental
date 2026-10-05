import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class VehicleClass(Base):
    """
    A group of cars the business rents out alike, at one daily price: "Compact",
    "Island Cruiser". The renter books the class; which car they get is decided
    later. Every car in a class has the class price (it is written to the cars
    whenever the class price changes or a car joins; see services/vehicle_classes.py).

    The name and description are the business's own words, per language, so they
    are data and not translated enum labels. A class is never deleted (cars and
    bookings point at it): retiring one hides it.
    """

    __tablename__ = "vehicle_classes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Stable, readable, unique: what the public site uses in a class address.
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)

    # {"en": "...", "it": "...", "pl": "..."}; English is required, the others fall back to it.
    name: Mapped[dict] = mapped_column(JSONB, nullable=False)
    description: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))

    price_per_day: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # Whether the public storefront may offer this class at all.
    offered_online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))

    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The class's own photo, kept like a car's (see app/services/class_photos.py).
    # Without one the storefront shows the photo of one of its cars.
    photo_blob_path: Mapped[str | None] = mapped_column(String(300))
    photo_content_type: Mapped[str | None] = mapped_column(String(20))
    photo_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def has_photo(self) -> bool:
        return self.photo_blob_path is not None

    @property
    def photo_version(self) -> int | None:
        return int(self.photo_updated_at.timestamp()) if self.photo_updated_at is not None else None

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    @property
    def is_retired(self) -> bool:
        return self.retired_at is not None

    __table_args__ = (CheckConstraint("price_per_day >= 0", name="vehicle_class_price_not_negative"),)
