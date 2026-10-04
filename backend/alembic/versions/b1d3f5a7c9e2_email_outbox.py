"""the email outbox

Revision ID: b1d3f5a7c9e2
Revises: a9c1e3f5b7d4
Create Date: 2026-10-05 00:00:00.000000

A table of emails to send and the ones sent. Nothing existing changes shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b1d3f5a7c9e2'
down_revision: Union[str, None] = 'a9c1e3f5b7d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'email_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('dedupe_key', sa.String(120), nullable=False, unique=True),
        sa.Column('template', sa.String(40), nullable=False),
        sa.Column('language', sa.String(5), nullable=False),
        sa.Column('to_address', sa.String(254), nullable=False),
        sa.Column('to_name', sa.String(200)),
        sa.Column('reply_to', sa.String(254)),
        sa.Column('subject', sa.String(300), nullable=False),
        sa.Column('body_text', sa.Text(), nullable=False),
        sa.Column('body_html', sa.Text(), nullable=False),
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('reservations.id')),
        sa.Column('invoice_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('invoices.id')),
        sa.Column('status', sa.String(10), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_error', sa.Text()),
        sa.Column('sent_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('PENDING','SENT','FAILED')", name='valid_email_message_status'),
        sa.CheckConstraint('attempts >= 0', name='email_messages_attempts_not_negative'),
    )
    op.create_index('ix_email_messages_due', 'email_messages', ['status', 'next_attempt_at'])
    op.create_index('ix_email_messages_reservation_id', 'email_messages', ['reservation_id'])


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_email_messages_reservation_id', table_name='email_messages')
    op.drop_index('ix_email_messages_due', table_name='email_messages')
    op.drop_table('email_messages')
