"""let a business turn vehicle classes off

Revision ID: b8d0f2a4c6e9
Revises: a7d9f1b3c5e8
Create Date: 2026-10-10 00:00:00.000000

Additive only: one column, on by default, so nothing changes for a stack that
does not turn it off.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d0f2a4c6e9'
down_revision: Union[str, None] = 'a7d9f1b3c5e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('configuration', sa.Column('use_vehicle_classes', sa.Boolean(), nullable=False, server_default=sa.text('true')))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('configuration', 'use_vehicle_classes')
