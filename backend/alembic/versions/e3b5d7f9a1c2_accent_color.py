"""add the business's brand colour to the configuration

Revision ID: e3b5d7f9a1c2
Revises: d0f2a4b6c8e1
Create Date: 2026-10-07 00:00:00.000000

Additive only: one column, near-black by default, which is what both apps
looked like before, so nothing changes until a business picks a colour.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3b5d7f9a1c2'
down_revision: Union[str, None] = 'd0f2a4b6c8e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('configuration', sa.Column('accent_color', sa.String(7), nullable=False, server_default='#0a0a0a'))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('configuration', 'accent_color')
