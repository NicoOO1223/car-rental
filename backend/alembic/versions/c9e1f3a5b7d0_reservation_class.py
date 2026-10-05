"""reservations remember their vehicle class and whether the car is final

Revision ID: c9e1f3a5b7d0
Revises: b8d0e2f4a6c9
Create Date: 2026-10-12 00:00:00.000000

A booking made for a class holds a real car provisionally (car_confirmed false) so
the no-double-booking rules stay exactly as they are; staff may swap it for another
car in the class until pickup. Existing bookings keep their car: confirmed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c9e1f3a5b7d0'
down_revision: Union[str, None] = 'b8d0e2f4a6c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('reservations', sa.Column('class_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_reservations_class_id', 'reservations', 'vehicle_classes', ['class_id'], ['id'])
    op.add_column('reservations', sa.Column('car_confirmed', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.create_index('ix_reservations_class_id', 'reservations', ['class_id'])
    op.execute("UPDATE reservations SET class_id = cars.class_id FROM cars WHERE cars.id = reservations.car_id")


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_reservations_class_id', table_name='reservations')
    op.drop_column('reservations', 'car_confirmed')
    op.drop_constraint('fk_reservations_class_id', 'reservations', type_='foreignkey')
    op.drop_column('reservations', 'class_id')
