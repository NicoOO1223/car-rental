"""add created_by and updated_by to reservations and handovers

Revision ID: af2c9f344c5f
Revises: fbdc71d539d0
Create Date: 2026-09-20 15:48:06.059573

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'af2c9f344c5f'
down_revision: Union[str, Sequence[str], None] = 'fbdc71d539d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # Permanently nullable, not a temporary migration stage: rows created
    # before this column existed have no real acting user to attribute,
    # and that history is never fabricated. ondelete="SET NULL" so
    # deleting a User row can't be blocked by, or cascade into, the
    # reservations/handovers it's attributed on.
    op.add_column('reservations', sa.Column('created_by', sa.UUID(), nullable=True))
    op.add_column('reservations', sa.Column('updated_by', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_reservations_created_by_users',
        'reservations', 'users',
        ['created_by'], ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_reservations_updated_by_users',
        'reservations', 'users',
        ['updated_by'], ['id'],
        ondelete='SET NULL',
    )

    op.add_column('handovers', sa.Column('created_by', sa.UUID(), nullable=True))
    op.add_column('handovers', sa.Column('updated_by', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_handovers_created_by_users',
        'handovers', 'users',
        ['created_by'], ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_handovers_updated_by_users',
        'handovers', 'users',
        ['updated_by'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_handovers_updated_by_users', 'handovers', type_='foreignkey')
    op.drop_constraint('fk_handovers_created_by_users', 'handovers', type_='foreignkey')
    op.drop_column('handovers', 'updated_by')
    op.drop_column('handovers', 'created_by')

    op.drop_constraint('fk_reservations_updated_by_users', 'reservations', type_='foreignkey')
    op.drop_constraint('fk_reservations_created_by_users', 'reservations', type_='foreignkey')
    op.drop_column('reservations', 'updated_by')
    op.drop_column('reservations', 'created_by')
