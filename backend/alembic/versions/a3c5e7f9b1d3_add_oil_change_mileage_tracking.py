"""add oil change mileage tracking

Revision ID: a3c5e7f9b1d3
Revises: e1a3c5d7f9b1
Create Date: 2026-10-02 00:00:00.000000

Additive only: both columns are nullable or default-safe, so existing rows
and behaviour are unaffected until the fleet condition page and its
notification start reading them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a3c5e7f9b1d3'
down_revision: Union[str, None] = 'e1a3c5d7f9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # The odometer reading at the last oil change, paired with the existing
    # last_oil_change_at date, so "overdue by distance" is computable.
    op.add_column('cars', sa.Column('last_oil_change_mileage', sa.Integer(), nullable=True))

    # Admin-configurable threshold for the oil-change-overdue alert.
    op.add_column('configuration', sa.Column('oil_change_interval_km', sa.Integer(), nullable=False, server_default='10000'))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('configuration', 'oil_change_interval_km')
    op.drop_column('cars', 'last_oil_change_mileage')
