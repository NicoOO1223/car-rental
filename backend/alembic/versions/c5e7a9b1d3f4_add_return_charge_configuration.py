"""add return charge configuration

Late-return grace period and hourly fee, fuel and refuelling fees, and the
cap on a damage charge, all applied at check-out.

Revision ID: c5e7a9b1d3f4
Revises: b3d5f7a9c1e2
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5e7a9b1d3f4'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Starting values for the admin to adjust on the Configuration page.
    op.add_column('configuration', sa.Column('late_return_grace_minutes', sa.Integer(), nullable=False, server_default='60'))
    op.add_column('configuration', sa.Column('late_fee_per_hour', sa.Numeric(10, 2), nullable=False, server_default='15.00'))
    op.add_column('configuration', sa.Column('fuel_fee_per_eighth', sa.Numeric(10, 2), nullable=False, server_default='8.00'))
    op.add_column('configuration', sa.Column('refuel_service_fee', sa.Numeric(10, 2), nullable=False, server_default='10.00'))
    op.add_column('configuration', sa.Column('max_damage_charge', sa.Numeric(10, 2), nullable=False, server_default='2000.00'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('configuration', 'max_damage_charge')
    op.drop_column('configuration', 'refuel_service_fee')
    op.drop_column('configuration', 'fuel_fee_per_eighth')
    op.drop_column('configuration', 'late_fee_per_hour')
    op.drop_column('configuration', 'late_return_grace_minutes')
