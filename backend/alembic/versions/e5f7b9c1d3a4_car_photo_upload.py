"""replace car.image_url with an uploaded photo

Revision ID: e5f7b9c1d3a4
Revises: d2f4a6c8e0b3
Create Date: 2026-10-03 00:00:00.000000

Cars no longer take a pasted external image URL — the admin uploads a
photo instead, the same way the storefront landing page's hero/about
photos work (see app/services/car_photos.py). No car in production has
image_url set yet, so there is nothing to migrate or carry forward.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f7b9c1d3a4'
down_revision: Union[str, None] = 'd2f4a6c8e0b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('cars', sa.Column('photo_blob_path', sa.String(300), nullable=True))
    op.add_column('cars', sa.Column('photo_content_type', sa.String(20), nullable=True))
    op.add_column('cars', sa.Column('photo_updated_at', sa.DateTime(timezone=True), nullable=True))
    op.drop_column('cars', 'image_url')


def downgrade() -> None:
    """Downgrade schema."""

    op.add_column('cars', sa.Column('image_url', sa.String(500), nullable=True))
    op.drop_column('cars', 'photo_updated_at')
    op.drop_column('cars', 'photo_content_type')
    op.drop_column('cars', 'photo_blob_path')
