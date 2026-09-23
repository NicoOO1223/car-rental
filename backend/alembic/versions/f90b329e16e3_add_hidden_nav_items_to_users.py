"""add hidden_nav_items to users

Revision ID: f90b329e16e3
Revises: 5634835d2030
Create Date: 2026-09-20 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'f90b329e16e3'
down_revision: Union[str, Sequence[str], None] = '5634835d2030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # A per-account list of nav-item hrefs hidden from that user's
    # sidebar — a UI convenience (see Sidebar.tsx's existing Admin
    # section precedent), not a new authorization layer, so no backend
    # value-set validation. Empty for every existing row: nothing hidden
    # by default, matching today's behavior exactly.
    op.add_column(
        'users',
        sa.Column(
            'hidden_nav_items',
            JSONB(),
            nullable=False,
            server_default='[]',
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'hidden_nav_items')
