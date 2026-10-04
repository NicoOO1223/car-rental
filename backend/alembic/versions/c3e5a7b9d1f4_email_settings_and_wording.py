"""email settings and editable wording

Revision ID: c3e5a7b9d1f4
Revises: b1d3f5a7c9e2
Create Date: 2026-10-06 00:00:00.000000

A one-row settings table (sending can be paused from the panel) and the lines of
the renter emails a business has worded itself. Nothing existing changes shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3e5a7b9d1f4'
down_revision: Union[str, None] = 'b1d3f5a7c9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'email_settings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('id = 1', name='email_settings_singleton'),
    )
    op.execute("INSERT INTO email_settings (id, enabled, updated_at) VALUES (1, true, now())")

    op.create_table(
        'email_text_overrides',
        sa.Column('key', sa.String(60), primary_key=True),
        sa.Column('language', sa.String(5), primary_key=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_table('email_text_overrides')
    op.drop_table('email_settings')
