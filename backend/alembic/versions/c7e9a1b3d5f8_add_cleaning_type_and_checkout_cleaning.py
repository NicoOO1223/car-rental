"""add cleaning type and check-out cleaning request

Revision ID: c7e9a1b3d5f8
Revises: b5d8f1a3c6e9
Create Date: 2026-10-02 00:00:00.000000

Additive only: every new column is nullable or default-safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7e9a1b3d5f8'
down_revision: Union[str, None] = 'b5d8f1a3c6e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # What kind of CLEANING a task is — the counterpart of category, which
    # only ever applies to MAINTENANCE tasks.
    op.add_column('maintenance_tasks', sa.Column('cleaning_type', sa.String(20), nullable=True))
    op.create_check_constraint(
        'valid_maintenance_task_cleaning_type', 'maintenance_tasks',
        "cleaning_type IS NULL OR cleaning_type IN ('INTERIOR','EXTERIOR','FULL')",
    )

    # Mirrors the existing damage_task_* columns: an optional CLEANING task
    # opened when the check-out completes.
    op.add_column('check_outs', sa.Column('cleaning_requested', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('check_outs', sa.Column('cleaning_type', sa.String(20), nullable=True))
    op.add_column('check_outs', sa.Column('cleaning_task_starts_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('check_outs', sa.Column('cleaning_task_ends_at', sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        'valid_check_out_cleaning_type', 'check_outs',
        "cleaning_type IS NULL OR cleaning_type IN ('INTERIOR','EXTERIOR','FULL')",
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_constraint('valid_check_out_cleaning_type', 'check_outs', type_='check')
    op.drop_column('check_outs', 'cleaning_task_ends_at')
    op.drop_column('check_outs', 'cleaning_task_starts_at')
    op.drop_column('check_outs', 'cleaning_type')
    op.drop_column('check_outs', 'cleaning_requested')

    op.drop_constraint('valid_maintenance_task_cleaning_type', 'maintenance_tasks', type_='check')
    op.drop_column('maintenance_tasks', 'cleaning_type')
