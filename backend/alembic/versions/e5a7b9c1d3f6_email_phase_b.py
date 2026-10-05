"""email phase b: held and merged emails

Revision ID: e5a7b9c1d3f6
Revises: d4f6a8c0e2b5
Create Date: 2026-10-08 00:00:00.000000

Emails about a booking that is edited several times are held back a few minutes
and merged into one. coalesce_key groups them; context keeps the booking as it
was before the first edit.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e5a7b9c1d3f6'
down_revision: Union[str, None] = 'd4f6a8c0e2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('email_messages', sa.Column('coalesce_key', sa.String(length=120), nullable=True))
    op.add_column('email_messages', sa.Column('context', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index('ix_email_messages_coalesce_key', 'email_messages', ['coalesce_key'])


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_email_messages_coalesce_key', table_name='email_messages')
    op.drop_column('email_messages', 'context')
    op.drop_column('email_messages', 'coalesce_key')
