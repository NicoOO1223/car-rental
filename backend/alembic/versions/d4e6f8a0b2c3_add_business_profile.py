"""add business profile and logo

Revision ID: d4e6f8a0b2c3
Revises: c3d5e7f9a1b2
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e6f8a0b2c3'
down_revision: Union[str, Sequence[str], None] = 'c3d5e7f9a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Defaults reproduce today's behaviour exactly: the brand the app
    # already shows, UTC days, English formatting, and the placeholder
    # agreement wording (an empty string selects it).
    op.add_column('configuration', sa.Column('business_name', sa.String(100), nullable=False, server_default='Car Rental'))
    op.add_column('configuration', sa.Column('legal_name', sa.String(150), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('address', sa.Text(), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('phone', sa.String(50), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('email', sa.String(150), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('vat_id', sa.String(50), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('timezone', sa.String(64), nullable=False, server_default='UTC'))
    op.add_column('configuration', sa.Column('locale', sa.String(10), nullable=False, server_default='en'))
    op.add_column('configuration', sa.Column('agreement_terms', sa.Text(), nullable=False, server_default=''))

    op.create_table(
        'business_logo',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('content', sa.LargeBinary(), nullable=False),
        sa.Column('content_type', sa.String(20), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('id = 1', name='business_logo_singleton'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('business_logo')
    for column in (
        'agreement_terms', 'locale', 'timezone', 'vat_id', 'email',
        'phone', 'address', 'legal_name', 'business_name',
    ):
        op.drop_column('configuration', column)
