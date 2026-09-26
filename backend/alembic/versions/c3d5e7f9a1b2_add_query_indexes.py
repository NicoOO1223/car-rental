"""add indexes for the hot queries

Revision ID: c3d5e7f9a1b2
Revises: b2c4d6e8f0a1
Create Date: 2026-09-26 00:00:00.000000

Postgres does not index foreign keys on its own, and none of these columns
had an index, so every availability check, dashboard load and customer list
scanned whole tables. Composite indexes lead with the column the queries
filter on for equality and follow with the one they range or sort on.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3d5e7f9a1b2'
down_revision: Union[str, Sequence[str], None] = 'b2c4d6e8f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEXES = [
    ('ix_reservations_car_id_pickup_at', 'reservations', ['car_id', 'pickup_at']),
    ('ix_reservations_customer_id', 'reservations', ['customer_id']),
    ('ix_reservations_status_pickup_at', 'reservations', ['status', 'pickup_at']),
    ('ix_reservations_status_return_at', 'reservations', ['status', 'return_at']),
    ('ix_reservations_pickup_location_id', 'reservations', ['pickup_location_id']),
    ('ix_reservations_return_location_id', 'reservations', ['return_location_id']),
    ('ix_maintenance_tasks_car_id_status', 'maintenance_tasks', ['car_id', 'status']),
    ('ix_maintenance_tasks_status_opened_at', 'maintenance_tasks', ['status', 'opened_at']),
    ('ix_cars_current_location_id_status', 'cars', ['current_location_id', 'status']),
    ('ix_handovers_paid_at', 'handovers', ['paid_at']),
    ('ix_check_outs_paid_at', 'check_outs', ['paid_at']),
]


def upgrade() -> None:
    """Upgrade schema."""
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns)


def downgrade() -> None:
    """Downgrade schema."""
    for name, table, _columns in reversed(INDEXES):
        op.drop_index(name, table_name=table)
