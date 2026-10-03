"""add social media links to the configuration

Revision ID: f8a0c2e4b6d1
Revises: a1c3e5b7d9f1
Create Date: 2026-10-03 00:00:00.000000

Additive only: four columns, server_default='' (no link), a no-op for every
existing row.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8a0c2e4b6d1'
down_revision: Union[str, None] = 'a1c3e5b7d9f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = ('social_instagram_url', 'social_facebook_url', 'social_x_url', 'social_whatsapp_url')


def upgrade() -> None:
    """Upgrade schema."""

    for name in COLUMNS:
        op.add_column('configuration', sa.Column(name, sa.String(500), nullable=False, server_default=''))


def downgrade() -> None:
    """Downgrade schema."""

    for name in COLUMNS:
        op.drop_column('configuration', name)
