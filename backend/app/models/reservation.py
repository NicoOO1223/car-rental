import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Index,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id"),
        nullable=False,
    )

    car_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cars.id"),
        nullable=False,
    )

    pickup_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id"),
        nullable=False,
    )

    return_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id"),
        nullable=False,
    )

    # Permanently nullable, not a temporary migration stage: rows created
    # before this column existed have no real acting user to attribute,
    # and that history is never fabricated. ondelete="SET NULL" so
    # deleting a User row can't be blocked by, or cascade into, old
    # reservations it's attributed on.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    customer: Mapped["Customer"] = relationship(
    "Customer",
    )

    car: Mapped["Car"] = relationship(
        "Car",
    )

    pickup_location: Mapped["Location"] = relationship(
        "Location",
        foreign_keys=[pickup_location_id],
    )

    return_location: Mapped["Location"] = relationship(
        "Location",
        foreign_keys=[return_location_id],
    )

    # Association-object pattern rather than secondary=, because each line
    # carries its own quantity and price snapshot. delete-orphan is the one
    # place this codebase needs a cascade: replacing the extras set on an
    # edit must delete the dropped rows.
    #
    # Load this with selectinload, never joinedload — it is the only
    # collection relationship in the app, and joinedload against a
    # collection fans out parent rows and breaks db.scalars(...).all().
    extras: Mapped[list["ReservationExtra"]] = relationship(
        "ReservationExtra",
        cascade="all, delete-orphan",
    )

    # The share paid online at booking, for a storefront booking. Read only:
    # it is created and changed through services/public_booking.py.
    prepayment: Mapped["ReservationPayment | None"] = relationship(
        "ReservationPayment",
        uselist=False,
        viewonly=True,
    )

    pickup_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    return_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
    )

    # Where the booking came from: STAFF (the counter or the admin app) or
    # STOREFRONT (a renter on the public site).
    source: Mapped[str] = mapped_column(String(12), nullable=False, default="STAFF", server_default="STAFF")

    # What a renter quotes to find a storefront booking ("ABCD-2345").
    public_reference: Mapped[str | None] = mapped_column(String(9), unique=True)

    # A storefront booking waits for payment until this moment (status
    # AWAITING_PAYMENT); after it the car is free again.
    hold_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Why a booking was cancelled, and until when a cancellation is free.
    cancellation_reason: Mapped[str | None] = mapped_column(String(20))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The price as agreed when the booking was made. NULL on older bookings,
    # which keep pricing from the live rates.
    agreed_price_per_day: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    agreed_short_term_fee: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    agreed_airport_change_fee: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    agreed_total_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    agreed_currency: Mapped[str | None] = mapped_column(String(3))
    # The share paid online, as set when the booking was made.
    prepayment_percent: Mapped[int | None] = mapped_column(Integer)
    # A keyed hash of the booker's address, for limits on live holds.
    client_ip_hash: Mapped[str | None] = mapped_column(String(64))

    # The language emails to the renter are written in: the one they used on the
    # storefront, or the one staff chose when booking for them. NULL (bookings from
    # before this existed) = the business default language.
    language: Mapped[str | None] = mapped_column(String(5))

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
            "return_at > pickup_at",
            name="valid_reservation_period",
        ),
        CheckConstraint("source IN ('STAFF','STOREFRONT')", name="valid_reservation_source"),
        CheckConstraint(
            "status IN ('PENDING','AWAITING_PAYMENT','CONFIRMED','ACTIVE','COMPLETED','CANCELLED','EXPIRED')",
            name="valid_reservation_status",
        ),
        # One car, one active booking at a time: the database's own check of the
        # rule the application keeps with lock_car (app/services/availability.py).
        # Holds are not included; they block only until they expire, which depends
        # on the clock. See the migration for the details.
        ExcludeConstraint(
            ("car_id", "="),
            (func.tstzrange(pickup_at, return_at), "&&"),
            where=text("status IN ('CONFIRMED','ACTIVE')"),
            using="gist",
            name="no_overlapping_active_reservations",
        ),
        Index("ix_reservations_status_hold_expires_at", "status", "hold_expires_at"),
        Index("ix_reservations_car_id_pickup_at", "car_id", "pickup_at"),
        Index("ix_reservations_customer_id", "customer_id"),
        Index("ix_reservations_status_pickup_at", "status", "pickup_at"),
        Index("ix_reservations_status_return_at", "status", "return_at"),
        Index("ix_reservations_pickup_location_id", "pickup_location_id"),
        Index("ix_reservations_return_location_id", "return_location_id"),
    )