"""add interface and document languages

Revision ID: a7c9e1f3b5d7
Revises: f6a8b0c2d4e5
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c9e1f3b5d7'
down_revision: Union[str, Sequence[str], None] = 'f6a8b0c2d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # English everywhere until an admin or a user chooses otherwise, so
    # nothing changes for an existing business on deploy.
    op.add_column('configuration', sa.Column('default_language', sa.String(5), nullable=False, server_default='en'))
    op.add_column('configuration', sa.Column('document_language', sa.String(5), nullable=False, server_default='en'))
    # NULL means "follow the business default".
    op.add_column('users', sa.Column('language', sa.String(5), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'language')
    op.drop_column('configuration', 'document_language')
    op.drop_column('configuration', 'default_language')
