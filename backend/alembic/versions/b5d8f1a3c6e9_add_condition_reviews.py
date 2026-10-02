"""add condition reviews and photos

Revision ID: b5d8f1a3c6e9
Revises: a3c5e7f9b1d3
Create Date: 2026-10-02 00:00:00.000000

Additive only: two new tables, nothing existing changes shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b5d8f1a3c6e9'
down_revision: Union[str, None] = 'a3c5e7f9b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'condition_reviews',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), nullable=False),
        # CHECK_IN | CHECK_OUT — which end of the rental this review is for.
        sa.Column('kind', sa.String(10), nullable=False),
        sa.Column('tire_condition', sa.String(20), nullable=True),
        sa.Column('reviewed_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['reservation_id'], ['reservations.id']),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('reservation_id', 'kind', name='uq_condition_reviews_reservation_kind'),
        sa.CheckConstraint("kind IN ('CHECK_IN','CHECK_OUT')", name='valid_condition_review_kind'),
        sa.CheckConstraint(
            "tire_condition IS NULL OR tire_condition IN ('GOOD','FAIR','WORN','NEEDS_REPLACEMENT')",
            name='valid_condition_review_tire_condition',
        ),
    )

    op.create_table(
        'condition_photos',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('condition_review_id', postgresql.UUID(as_uuid=True), nullable=False),
        # EXTERIOR | INTERIOR
        sa.Column('category', sa.String(10), nullable=False),
        # Where the bytes live in blob storage (or local disk in dev/test) — see app/services/photo_storage.py.
        sa.Column('blob_path', sa.String(300), nullable=False),
        sa.Column('content_type', sa.String(50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['condition_review_id'], ['condition_reviews.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint("category IN ('EXTERIOR','INTERIOR')", name='valid_condition_photo_category'),
    )
    op.create_index('ix_condition_photos_condition_review_id', 'condition_photos', ['condition_review_id'])


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_condition_photos_condition_review_id', table_name='condition_photos')
    op.drop_table('condition_photos')
    op.drop_table('condition_reviews')
