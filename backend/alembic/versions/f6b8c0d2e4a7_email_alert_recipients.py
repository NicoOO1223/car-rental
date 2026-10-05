"""email alert recipients

Revision ID: f6b8c0d2e4a7
Revises: e5a7b9c1d3f6
Create Date: 2026-10-09 00:00:00.000000

Who receives the business alerts (new online booking, online cancellation, needs attention).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6b8c0d2e4a7'
down_revision: Union[str, None] = 'e5a7b9c1d3f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column(
        'email_settings',
        sa.Column('alert_recipients', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('email_settings', 'alert_recipients')
