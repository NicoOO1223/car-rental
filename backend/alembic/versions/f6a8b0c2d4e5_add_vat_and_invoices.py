"""add VAT settings and invoices

Revision ID: f6a8b0c2d4e5
Revises: e5f7a9b1c3d4
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6a8b0c2d4e5'
down_revision: Union[str, Sequence[str], None] = 'e5f7a9b1c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Zero VAT with prices treated as VAT-inclusive changes no total anywhere
    # until an admin sets a rate.
    op.add_column('configuration', sa.Column('vat_rate', sa.Numeric(5, 2), nullable=False, server_default='0.00'))
    op.add_column('configuration', sa.Column('prices_include_vat', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('configuration', sa.Column('invoice_prefix', sa.String(10), nullable=False, server_default='INV'))

    op.create_table(
        'invoice_counter',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('last_sequence', sa.Integer(), nullable=False),
        sa.CheckConstraint('id = 1', name='invoice_counter_singleton'),
    )
    op.execute("INSERT INTO invoice_counter (id, last_sequence) VALUES (1, 0)")

    op.create_table(
        'invoices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('number', sa.String(40), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(12), nullable=False),
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('reservations.id'), nullable=False),
        sa.Column('handover_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('handovers.id'), nullable=False),
        sa.Column('original_invoice_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('invoices.id'), nullable=True),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('lines', postgresql.JSONB(), nullable=False),
        sa.Column('prices_include_vat', sa.Boolean(), nullable=False),
        sa.Column('vat_rate', sa.Numeric(5, 2), nullable=False),
        sa.Column('net_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('vat_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('total_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('seller', postgresql.JSONB(), nullable=False),
        sa.Column('customer', postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint('number', name='uq_invoices_number'),
        sa.UniqueConstraint('sequence', name='uq_invoices_sequence'),
        sa.UniqueConstraint('handover_id', 'kind', name='unique_invoice_per_payment_and_kind'),
        sa.CheckConstraint("kind IN ('INVOICE','CREDIT_NOTE')", name='valid_invoice_kind'),
    )
    op.create_index('ix_invoices_reservation_id', 'invoices', ['reservation_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_invoices_reservation_id', table_name='invoices')
    op.drop_table('invoices')
    op.drop_table('invoice_counter')
    op.drop_column('configuration', 'invoice_prefix')
    op.drop_column('configuration', 'prices_include_vat')
    op.drop_column('configuration', 'vat_rate')
