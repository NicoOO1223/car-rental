"""backfill customer nationality

Revision ID: b6e1f3a9c2d4
Revises: a2d4e6f8b0c1
Create Date: 2026-09-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b6e1f3a9c2d4'
down_revision: Union[str, Sequence[str], None] = 'a2d4e6f8b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Backfill nationality for customers that predate the column (or
    were otherwise created without one) so the dashboard's flag icon has
    something to render for every existing customer."""
    op.execute("UPDATE customers SET nationality = 'PL' WHERE nationality IS NULL")


def downgrade() -> None:
    """Data backfill is not reversible — nothing to undo."""
    pass
