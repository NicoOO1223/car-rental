import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Extra(Base):
    """
    Catalog of bookable add-ons (additional driver, child seat, ...).

    A row here is a *product*, not a pricing rule. That distinction is why
    this is a table while the surcharges in app/services/pricing.py
    (SHORT_TERM_FEE, AIRPORT_CHANGE_FEE) are module constants: those are
    conditional logic that only makes sense inside the pricing function,
    whereas an extra has a customer-visible name, a price that changes
    without a deploy, and a lifecycle.

    Retire an extra by setting is_active=False, never by deleting it —
    reservation_extras rows keep an extra_id reference for reporting long
    after it stops being sellable.
    """

    __tablename__ = "extras"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # Stable symbolic identifier. Seed data, tests, and any future rule
    # that has to special-case a particular extra reference this rather
    # than the UUID, which differs per environment.
    code: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        unique=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        String(255),
    )

    price: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
    )

    # PER_DAY    -> price x quantity x rental days
    # PER_RENTAL -> price x quantity, regardless of duration
    price_unit: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    # Upper bound the booking wizard renders as a quantity stepper and the
    # server re-validates. 1 for anything not naturally countable.
    max_quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
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
        CheckConstraint(
            "price_unit IN ('PER_DAY','PER_RENTAL')",
            name="valid_extra_price_unit",
        ),
        CheckConstraint(
            "max_quantity >= 1",
            name="valid_extra_max_quantity",
        ),
        CheckConstraint(
            "price >= 0",
            name="valid_extra_price",
        ),
    )
