"""add the language an invoice is printed in

Revision ID: b8d0f2a4c6e8
Revises: a7c9e1f3b5d7
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b8d0f2a4c6e8'
down_revision: Union[str, None] = 'a7c9e1f3b5d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Every invoice issued so far was printed in English, so that is the
    # language it keeps.
    op.add_column(
        'invoices',
        sa.Column('language', sa.String(5), nullable=False, server_default='en'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('invoices', 'language')
