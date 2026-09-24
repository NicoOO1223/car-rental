"""add maintenance task window

Revision ID: c8d2e5f1a3b7
Revises: b6e1f3a9c2d4
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8d2e5f1a3b7'
down_revision: Union[str, Sequence[str], None] = 'b6e1f3a9c2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('maintenance_tasks', sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('maintenance_tasks', sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True))

    # Tasks that predate windows keep blocking the car from when they were
    # opened until someone closes them: start = opened_at, end left open.
    op.execute("UPDATE maintenance_tasks SET starts_at = opened_at")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('maintenance_tasks', 'ends_at')
    op.drop_column('maintenance_tasks', 'starts_at')
