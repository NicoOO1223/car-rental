"""storefront account: verified email and language

Revision ID: a7c9d1e3f5b8
Revises: f6b8c0d2e4a7
Create Date: 2026-10-10 00:00:00.000000

Accounts prove their address with a link in an email before they can see or claim
bookings. Accounts that already exist are left unverified; they verify from the
storefront. The language is the one the account emails are written in.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c9d1e3f5b8'
down_revision: Union[str, None] = 'f6b8c0d2e4a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('customer_accounts', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('customer_accounts', sa.Column('language', sa.String(length=5), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('customer_accounts', 'language')
    op.drop_column('customer_accounts', 'email_verified_at')
