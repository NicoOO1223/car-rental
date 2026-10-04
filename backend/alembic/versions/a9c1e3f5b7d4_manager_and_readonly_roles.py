"""add the manager and readonly roles

Revision ID: a9c1e3f5b7d4
Revises: f8b0d2e4a6c3
Create Date: 2026-10-05 00:00:00.000000

Widens the allowed values of users.role. Nothing existing changes: every current
account keeps its role (admin or staff).

The downgrade cannot keep accounts whose role the old constraint does not know,
so it demotes them to the nearest role the old version has and says so: a manager
becomes staff (it loses the approval actions rather than gaining admin rights),
and read-only becomes staff too. Their sessions are revoked so they sign in again.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a9c1e3f5b7d4'
down_revision: Union[str, None] = 'f8b0d2e4a6c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.drop_constraint('valid_user_role', 'users', type_='check')
    op.create_check_constraint(
        'valid_user_role', 'users', "role IN ('admin','manager','staff','readonly')"
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.execute(
        "UPDATE users SET role = 'staff', token_valid_after = now() "
        "WHERE role IN ('manager','readonly')"
    )
    op.drop_constraint('valid_user_role', 'users', type_='check')
    op.create_check_constraint('valid_user_role', 'users', "role IN ('admin','staff')")
