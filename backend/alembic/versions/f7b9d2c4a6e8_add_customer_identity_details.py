"""add customer identity details

Revision ID: f7b9d2c4a6e8
Revises: e5a7c9d1b3f2
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f7b9d2c4a6e8'
down_revision: Union[str, Sequence[str], None] = 'e5a7c9d1b3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('customers', sa.Column('national_id_number', sa.String(length=30), nullable=True))
    op.add_column('customers', sa.Column('id_document_type', sa.String(length=20), nullable=True))
    op.add_column('customers', sa.Column('id_document_number', sa.String(length=50), nullable=True))
    op.add_column('customers', sa.Column('id_document_expires_at', sa.Date(), nullable=True))
    op.add_column('customers', sa.Column('driving_license_number', sa.String(length=50), nullable=True))
    op.add_column('customers', sa.Column('driving_license_country', sa.String(length=2), nullable=True))
    op.add_column('customers', sa.Column('driving_license_categories', sa.String(length=30), nullable=True))
    op.add_column('customers', sa.Column('driving_license_issued_at', sa.Date(), nullable=True))
    op.add_column('customers', sa.Column('driving_license_expires_at', sa.Date(), nullable=True))
    op.add_column('customers', sa.Column('identity_checked_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('customers', sa.Column('identity_checked_by', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_customers_identity_checked_by_users',
        'customers',
        'users',
        ['identity_checked_by'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_check_constraint(
        'valid_customer_id_document_type',
        'customers',
        "id_document_type IN ('ID_CARD','PASSPORT','RESIDENCE_PERMIT')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('valid_customer_id_document_type', 'customers', type_='check')
    op.drop_constraint('fk_customers_identity_checked_by_users', 'customers', type_='foreignkey')
    for column in (
        'identity_checked_by',
        'identity_checked_at',
        'driving_license_expires_at',
        'driving_license_issued_at',
        'driving_license_categories',
        'driving_license_country',
        'driving_license_number',
        'id_document_expires_at',
        'id_document_number',
        'id_document_type',
        'national_id_number',
    ):
        op.drop_column('customers', column)
