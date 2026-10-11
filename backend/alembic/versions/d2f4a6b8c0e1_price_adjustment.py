"""a manual price adjustment on a reservation

Revision ID: d2f4a6b8c0e1
Revises: b8d0f2a4c6e9
Create Date: 2026-10-10 00:00:00.000000

Additive only: four nullable columns. NULL means no adjustment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd2f4a6b8c0e1'
down_revision: Union[str, None] = 'b8d0f2a4c6e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('reservations', sa.Column('price_adjustment_amount', sa.Numeric(10, 2), nullable=True))
    op.add_column('reservations', sa.Column('price_adjustment_reason', sa.String(300), nullable=True))
    op.add_column('reservations', sa.Column('price_adjusted_by', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('reservations', sa.Column('price_adjusted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        'fk_reservations_price_adjusted_by_users',
        'reservations',
        'users',
        ['price_adjusted_by'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_constraint('fk_reservations_price_adjusted_by_users', 'reservations', type_='foreignkey')
    op.drop_column('reservations', 'price_adjusted_at')
    op.drop_column('reservations', 'price_adjusted_by')
    op.drop_column('reservations', 'price_adjustment_reason')
    op.drop_column('reservations', 'price_adjustment_amount')
