"""add login lockout and token revocation to users

Revision ID: a1b3c5d7e9f2
Revises: e9b1d3f5a7c8
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b3c5d7e9f2'
down_revision: Union[str, Sequence[str], None] = 'e9b1d3f5a7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))
    # Tokens issued before this moment are rejected. NULL means no revocation.
    op.add_column('users', sa.Column('token_valid_after', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'token_valid_after')
    op.drop_column('users', 'locked_until')
    op.drop_column('users', 'failed_login_attempts')
