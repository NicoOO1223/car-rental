"""retire a vehicle instead of deleting it

Revision ID: f8b0d2e4a6c3
Revises: e7a9c1d3f5b2
Create Date: 2026-10-04 00:00:00.000000

A car that leaves the fleet (sold, written off, returned to the lessor) cannot
be deleted: reservations, invoices and maintenance history point at it. Setting
retired_at takes it out of every list, availability search and report that
looks at the current fleet, and keeps all of its history. NULL means in the fleet.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8b0d2e4a6c3'
down_revision: Union[str, None] = 'e7a9c1d3f5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('cars', sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('cars', 'retired_at')
