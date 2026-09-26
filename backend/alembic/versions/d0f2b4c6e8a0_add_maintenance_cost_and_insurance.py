"""add maintenance task cost and car insurance

Revision ID: d0f2b4c6e8a0
Revises: c9e1a3b5d7f9
Create Date: 2026-10-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd0f2b4c6e8a0'
down_revision: Union[str, None] = 'c9e1a3b5d7f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # All optional: NULL means "not entered", never a cost of zero.
    op.add_column('maintenance_tasks', sa.Column('cost', sa.Numeric(10, 2), nullable=True))
    op.add_column('cars', sa.Column('insured_from', sa.Date(), nullable=True))
    op.add_column('cars', sa.Column('insured_until', sa.Date(), nullable=True))
    op.add_column('cars', sa.Column('insurance_cost', sa.Numeric(10, 2), nullable=True))
    # How many days ahead inspections and insurance are flagged as due soon.
    op.add_column('configuration', sa.Column('reminder_days', sa.Integer(), nullable=False, server_default='30'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('configuration', 'reminder_days')
    op.drop_column('cars', 'insurance_cost')
    op.drop_column('cars', 'insured_until')
    op.drop_column('cars', 'insured_from')
    op.drop_column('maintenance_tasks', 'cost')
