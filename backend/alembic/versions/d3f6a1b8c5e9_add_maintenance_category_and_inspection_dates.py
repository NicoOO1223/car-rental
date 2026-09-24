"""add maintenance category and car inspection dates

Revision ID: d3f6a1b8c5e9
Revises: c8d2e5f1a3b7
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3f6a1b8c5e9'
down_revision: Union[str, Sequence[str], None] = 'c8d2e5f1a3b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('maintenance_tasks', sa.Column('category', sa.String(length=30), nullable=True))
    op.create_check_constraint(
        'valid_maintenance_task_category',
        'maintenance_tasks',
        "category IS NULL OR category IN "
        "('DAMAGE_REPAIR','TECHNICAL_INSPECTION','ROUTINE_SERVICE','OTHER')",
    )
    op.add_column('cars', sa.Column('last_inspection_at', sa.Date(), nullable=True))
    op.add_column('cars', sa.Column('next_inspection_due', sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('cars', 'next_inspection_due')
    op.drop_column('cars', 'last_inspection_at')
    op.drop_constraint('valid_maintenance_task_category', 'maintenance_tasks', type_='check')
    op.drop_column('maintenance_tasks', 'category')
