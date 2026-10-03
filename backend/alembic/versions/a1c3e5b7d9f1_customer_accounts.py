"""customer accounts for the storefront

Revision ID: a1c3e5b7d9f1
Revises: e5f7b9c1d3a4
Create Date: 2026-10-03 00:00:00.000000

A renter's own login, separate from staff `users`, and the bookings linked
to it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1c3e5b7d9f1'
down_revision: Union[str, None] = 'e5f7b9c1d3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'customer_accounts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(254), nullable=False, unique=True),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('first_name', sa.String(100), nullable=False),
        sa.Column('last_name', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('failed_login_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('token_valid_after', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'customer_account_bookings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('customer_accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('reservations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('account_id', 'reservation_id', name='uq_account_booking'),
    )
    op.create_index('ix_customer_account_bookings_account_id', 'customer_account_bookings', ['account_id'])
    op.create_index('ix_customer_account_bookings_reservation_id', 'customer_account_bookings', ['reservation_id'])


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_table('customer_account_bookings')
    op.drop_table('customer_accounts')
