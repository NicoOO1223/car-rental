"""add role and is_active to users

Revision ID: fbdc71d539d0
Revises: 900dd1979438
Create Date: 2026-09-20 15:48:01.051345

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fbdc71d539d0'
down_revision: Union[str, Sequence[str], None] = '900dd1979438'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # Three phases so the CheckConstraint never has to evaluate a NULL:
    # add nullable, backfill every existing row, then tighten to NOT
    # NULL. Existing (pre-RBAC) accounts are backfilled to 'admin' to
    # preserve the unrestricted access they already had — this migration
    # must not silently lock anyone out. New rows going forward default
    # to the least-privileged 'staff' via server_default.
    op.add_column('users', sa.Column('role', sa.String(length=20), nullable=True))
    op.execute("UPDATE users SET role = 'admin' WHERE role IS NULL")
    op.alter_column('users', 'role', nullable=False, server_default='staff')
    op.create_check_constraint('valid_user_role', 'users', "role IN ('admin','staff')")

    # No backfill ambiguity here — a single default applies uniformly to
    # every existing row in one step.
    op.add_column(
        'users',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'is_active')
    op.drop_constraint('valid_user_role', 'users', type_='check')
    op.drop_column('users', 'role')
