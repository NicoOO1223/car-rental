"""a photo for each vehicle class

Revision ID: d0f2a4b6c8e1
Revises: c9e1f3a5b7d0
Create Date: 2026-10-13 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd0f2a4b6c8e1'
down_revision: Union[str, None] = 'c9e1f3a5b7d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('vehicle_classes', sa.Column('photo_blob_path', sa.String(length=300), nullable=True))
    op.add_column('vehicle_classes', sa.Column('photo_content_type', sa.String(length=20), nullable=True))
    op.add_column('vehicle_classes', sa.Column('photo_updated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('vehicle_classes', 'photo_updated_at')
    op.drop_column('vehicle_classes', 'photo_content_type')
    op.drop_column('vehicle_classes', 'photo_blob_path')
