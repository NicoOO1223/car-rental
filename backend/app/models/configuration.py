from decimal import Decimal

from sqlalchemy import CheckConstraint, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Configuration(Base):
    """
    Admin-editable business-rule values that used to be hardcoded constants
    (see app/services/pricing.py, app/services/handovers.py,
    app/services/auth.py). A true singleton, not a generic key-value store —
    there is exactly one row, with id fixed at 1, enforced by the check
    constraint below. Callers fetch it via app/services/configuration.py's
    get_configuration() rather than querying this model directly.

    Deliberately named "Configuration", not "Settings" — this is internal
    admin/business-rule tuning, not personal account preferences. "Settings"
    is reserved for a future user-facing layer (account, appearance,
    notifications, GDPR-style data deletion) once that infrastructure
    exists, so the two must not collide.
    """

    __tablename__ = "configuration"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)

    short_term_threshold_days: Mapped[int] = mapped_column(nullable=False)
    short_term_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    airport_change_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Charges applied when a rental is checked back in (see
    # app/services/return_charges.py). A return later than the scheduled
    # time by more than the grace period is charged per started hour;
    # fuel per missing eighth of a tank plus a flat service fee once any is
    # missing; a damage charge is typed in by the employee, up to the cap.
    late_return_grace_minutes: Mapped[int] = mapped_column(nullable=False)
    late_fee_per_hour: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    fuel_fee_per_eighth: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    refuel_service_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    max_damage_charge: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Held at check-in (card authorization or cash) and settled at check-out
    # against any return charges. 0 turns deposits off.
    security_deposit_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    default_currency: Mapped[str] = mapped_column(String(3), nullable=False)

    # Only affects tokens issued after the change — a token's exp claim is
    # baked in at issue time, so this never retroactively shortens or
    # extends a session already in progress.
    access_token_expire_days: Mapped[int] = mapped_column(nullable=False)

    __table_args__ = (
        CheckConstraint("id = 1", name="configuration_singleton"),
    )
