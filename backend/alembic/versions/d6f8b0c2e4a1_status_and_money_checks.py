"""check constraints on statuses and money

Revision ID: d6f8b0c2e4a1
Revises: c4e6a8b0d2f3
Create Date: 2026-10-04 00:00:00.000000

The application only ever writes the reservation and car statuses listed here,
and never a negative price, fee or payment amount, but nothing in the database
said so: a bug, a script or a hand-run UPDATE could store one and every report
would believe it. These constraints make the database refuse them.

Invoices are left out of the money checks on purpose: a credit note reverses an
invoice with negative amounts.

Adding a constraint checks the rows already there. If this fails, the error
names the constraint; fix or remove the offending rows and run it again.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd6f8b0c2e4a1'
down_revision: Union[str, None] = 'c4e6a8b0d2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


RESERVATION_STATUSES = (
    "PENDING", "AWAITING_PAYMENT", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED",
)
CAR_STATUSES = ("AVAILABLE", "RENTED", "MAINTENANCE", "CLEANING")

# table -> columns that can never be negative (NULL stays allowed where the
# column allows it: a CHECK passes on NULL).
NON_NEGATIVE = {
    "cars": ("price_per_day", "insurance_cost"),
    "check_outs": (
        "damage_charge", "late_fee", "fuel_fee", "total_charge",
        "deposit_applied", "deposit_returned", "payment_amount", "late_hours",
    ),
    "configuration": (
        "short_term_fee", "airport_change_fee", "late_fee_per_hour",
        "fuel_fee_per_eighth", "refuel_service_fee", "max_damage_charge",
        "security_deposit_amount",
    ),
    "extras": ("price",),
    "handovers": ("payment_amount", "deposit_amount", "deposit_captured_amount", "refund_amount"),
    "maintenance_tasks": ("cost",),
    "reservations": (
        "agreed_price_per_day", "agreed_short_term_fee",
        "agreed_airport_change_fee", "agreed_total_amount",
    ),
    "reservation_extras": ("unit_price",),
    "reservation_payments": ("payment_amount", "refund_amount"),
}

# A VAT rate is a percentage.
PERCENTAGES = {"configuration": "vat_rate", "invoices": "vat_rate"}


def _quoted(values: Sequence[str]) -> str:
    return ",".join(f"'{value}'" for value in values)


def upgrade() -> None:
    """Upgrade schema."""

    op.create_check_constraint(
        "valid_reservation_status", "reservations", f"status IN ({_quoted(RESERVATION_STATUSES)})"
    )
    op.create_check_constraint(
        "valid_car_status", "cars", f"status IN ({_quoted(CAR_STATUSES)})"
    )

    for table, columns in NON_NEGATIVE.items():
        for column in columns:
            op.create_check_constraint(f"{table}_{column}_not_negative", table, f"{column} >= 0")

    for table, column in PERCENTAGES.items():
        op.create_check_constraint(
            f"{table}_{column}_is_a_percentage", table, f"{column} >= 0 AND {column} <= 100"
        )


def downgrade() -> None:
    """Downgrade schema."""

    for table, column in PERCENTAGES.items():
        op.drop_constraint(f"{table}_{column}_is_a_percentage", table, type_="check")

    for table, columns in NON_NEGATIVE.items():
        for column in columns:
            op.drop_constraint(f"{table}_{column}_not_negative", table, type_="check")

    op.drop_constraint("valid_car_status", "cars", type_="check")
    op.drop_constraint("valid_reservation_status", "reservations", type_="check")
