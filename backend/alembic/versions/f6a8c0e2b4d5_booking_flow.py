"""request, approve, pay: the booking flow settings and the advance on a booking

Revision ID: f6a8c0e2b4d5
Revises: d2f4a6b8c0e1
Create Date: 2026-10-11 00:00:00.000000

Additive, apart from letting the online share be 0 (nothing to pay before
pickup). Existing rows keep today's instant booking.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a8c0e2b4d5'
down_revision: Union[str, None] = 'd2f4a6b8c0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('configuration', sa.Column('booking_flow', sa.String(10), nullable=False, server_default='INSTANT'))
    op.create_check_constraint('valid_booking_flow', 'configuration', "booking_flow IN ('INSTANT','APPROVAL')")
    op.add_column('configuration', sa.Column('payment_window_hours', sa.Integer(), nullable=False, server_default='24'))

    op.drop_constraint('valid_online_share_percent', 'configuration', type_='check')
    op.create_check_constraint('valid_online_share_percent', 'configuration', 'online_share_percent BETWEEN 0 AND 100')

    # What was asked of the renter when the booking was approved.
    op.add_column('reservations', sa.Column('advance_amount', sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('reservations', 'advance_amount')

    op.execute("UPDATE configuration SET online_share_percent = 1 WHERE online_share_percent = 0")
    op.drop_constraint('valid_online_share_percent', 'configuration', type_='check')
    op.create_check_constraint('valid_online_share_percent', 'configuration', 'online_share_percent BETWEEN 1 AND 100')

    op.drop_column('configuration', 'payment_window_hours')
    op.drop_constraint('valid_booking_flow', 'configuration', type_='check')
    op.drop_column('configuration', 'booking_flow')
