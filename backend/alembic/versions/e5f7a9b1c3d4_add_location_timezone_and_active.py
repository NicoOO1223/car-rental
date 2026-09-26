"""add location timezone and is_active

Revision ID: e5f7a9b1c3d4
Revises: d4e6f8a0b2c3
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f7a9b1c3d4'
down_revision: Union[str, Sequence[str], None] = 'd4e6f8a0b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # UTC keeps every existing location behaving exactly as before until an
    # admin sets its real timezone.
    op.add_column('locations', sa.Column('timezone', sa.String(64), nullable=False, server_default='UTC'))
    op.add_column('locations', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('locations', 'is_active')
    op.drop_column('locations', 'timezone')
