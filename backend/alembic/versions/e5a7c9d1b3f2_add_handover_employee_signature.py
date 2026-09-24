"""add handover employee signature

Revision ID: e5a7c9d1b3f2
Revises: d3f6a1b8c5e9
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e5a7c9d1b3f2'
down_revision: Union[str, Sequence[str], None] = 'd3f6a1b8c5e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('handovers', sa.Column('employee_signature_image', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('employee_signed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('handovers', sa.Column('employee_signed_by', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_handovers_employee_signed_by_users',
        'handovers',
        'users',
        ['employee_signed_by'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_handovers_employee_signed_by_users', 'handovers', type_='foreignkey')
    op.drop_column('handovers', 'employee_signed_by')
    op.drop_column('handovers', 'employee_signed_at')
    op.drop_column('handovers', 'employee_signature_image')
