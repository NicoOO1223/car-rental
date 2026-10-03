"""add the landing page call-to-action banner image

Revision ID: c4e6a8b0d2f3
Revises: f8a0c2e4b6d1
Create Date: 2026-10-03 00:00:00.000000

A new singleton table for the banner photo's blob reference, like the
hero and About images. Nothing existing changes shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e6a8b0d2f3'
down_revision: Union[str, None] = 'f8a0c2e4b6d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'landing_cta_image',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('blob_path', sa.String(300), nullable=False),
        sa.Column('content_type', sa.String(20), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('id = 1', name='landing_cta_image_singleton'),
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_table('landing_cta_image')
