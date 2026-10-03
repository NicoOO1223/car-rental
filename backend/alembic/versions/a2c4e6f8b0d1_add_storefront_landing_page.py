"""add storefront landing page fields and hero image

Revision ID: a2c4e6f8b0d1
Revises: c7e9a1b3d5f8
Create Date: 2026-10-03 00:00:00.000000

Additive only: seven new configuration columns (all server_default='',
a no-op for every existing row) plus a new singleton table for the hero
image's blob reference — nothing existing changes shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2c4e6f8b0d1'
down_revision: Union[str, None] = 'c7e9a1b3d5f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('configuration', sa.Column('landing_headline', sa.String(150), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_tagline', sa.String(300), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_benefit1_title', sa.String(80), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_benefit1_body', sa.String(240), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_benefit2_title', sa.String(80), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_benefit2_body', sa.String(240), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_benefit3_title', sa.String(80), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_benefit3_body', sa.String(240), nullable=False, server_default=''))

    op.create_table(
        'landing_hero_image',
        sa.Column('id', sa.Integer(), primary_key=True),
        # Where the bytes live in blob storage (or local disk in dev/test) — see app/services/photo_storage.py.
        sa.Column('blob_path', sa.String(300), nullable=False),
        sa.Column('content_type', sa.String(20), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('id = 1', name='landing_hero_image_singleton'),
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_table('landing_hero_image')
    for column in (
        'landing_benefit3_body', 'landing_benefit3_title',
        'landing_benefit2_body', 'landing_benefit2_title',
        'landing_benefit1_body', 'landing_benefit1_title',
        'landing_tagline', 'landing_headline',
    ):
        op.drop_column('configuration', column)
