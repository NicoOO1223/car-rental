"""add the time a business gives itself to answer a booking request

Revision ID: a7d9f1b3c5e8
Revises: e3b5d7f9a1c2
Create Date: 2026-10-07 00:00:00.000000

Additive only: one column, 24 hours by default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7d9f1b3c5e8'
down_revision: Union[str, None] = 'e3b5d7f9a1c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('configuration', sa.Column('confirm_within_hours', sa.Integer(), nullable=False, server_default='24'))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('configuration', 'confirm_within_hours')
