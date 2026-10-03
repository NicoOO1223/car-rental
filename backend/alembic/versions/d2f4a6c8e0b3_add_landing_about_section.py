"""add landing about title/body and about image

Revision ID: d2f4a6c8e0b3
Revises: a2c4e6f8b0d1
Create Date: 2026-10-03 00:00:00.000000

Additive only: two new configuration columns (server_default='', a no-op
for every existing row) plus a new singleton table for the About
section's image blob reference — nothing existing changes shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f4a6c8e0b3'
down_revision: Union[str, None] = 'a2c4e6f8b0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('configuration', sa.Column('landing_about_title', sa.String(100), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('landing_about_body', sa.String(600), nullable=False, server_default=''))

    op.create_table(
        'landing_about_image',
        sa.Column('id', sa.Integer(), primary_key=True),
        # Where the bytes live in blob storage (or local disk in dev/test) — see app/services/photo_storage.py.
        sa.Column('blob_path', sa.String(300), nullable=False),
        sa.Column('content_type', sa.String(20), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('id = 1', name='landing_about_image_singleton'),
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_table('landing_about_image')
    op.drop_column('configuration', 'landing_about_body')
    op.drop_column('configuration', 'landing_about_title')
