"""email redesign: one message per email, parts, per-type settings, renter language

Revision ID: d4f6a8c0e2b5
Revises: c3e5a7b9d1f4
Create Date: 2026-10-07 00:00:00.000000

Replaces the line-by-line email wording with one subject and body per email and
language, plus reusable parts and per-type on/off and options. The line overrides
(email_text_overrides) were never in use on a deployed stack, so they are dropped
rather than converted.

Also: a general attachment on queued emails (invoice, credit note or the signed
agreement) in place of the invoice-only link, a reply-to address, and the language
a booking's emails are written in.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4f6a8c0e2b5'
down_revision: Union[str, None] = 'c3e5a7b9d1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _audit_columns():
    return [
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
    ]


def upgrade() -> None:
    """Upgrade schema."""

    op.drop_table('email_text_overrides')

    op.create_table(
        'email_type_settings',
        sa.Column('type', sa.String(40), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('options', postgresql.JSONB(), nullable=False),
        *_audit_columns(),
    )
    op.create_table(
        'email_templates',
        sa.Column('type', sa.String(40), primary_key=True),
        sa.Column('language', sa.String(5), primary_key=True),
        sa.Column('subject', sa.String(300), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        *_audit_columns(),
    )
    op.create_table(
        'email_parts',
        sa.Column('key', sa.String(60), primary_key=True),
        sa.Column('language', sa.String(5), primary_key=True),
        sa.Column('text', sa.Text(), nullable=False),
        *_audit_columns(),
    )

    op.add_column('email_settings', sa.Column('reply_to', sa.String(254), nullable=True))

    op.add_column('email_messages', sa.Column('attachment_kind', sa.String(20), nullable=True))
    op.add_column('email_messages', sa.Column('attachment_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        "UPDATE email_messages SET attachment_kind = 'invoice', attachment_id = invoice_id "
        "WHERE invoice_id IS NOT NULL"
    )
    op.drop_column('email_messages', 'invoice_id')
    op.create_check_constraint(
        'valid_email_attachment_kind',
        'email_messages',
        "attachment_kind IS NULL OR attachment_kind IN ('invoice','credit_note','agreement')",
    )

    op.add_column('reservations', sa.Column('language', sa.String(5), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('reservations', 'language')

    op.drop_constraint('valid_email_attachment_kind', 'email_messages', type_='check')
    op.add_column(
        'email_messages',
        sa.Column('invoice_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('invoices.id'), nullable=True),
    )
    op.execute("UPDATE email_messages SET invoice_id = attachment_id WHERE attachment_kind = 'invoice'")
    op.drop_column('email_messages', 'attachment_id')
    op.drop_column('email_messages', 'attachment_kind')

    op.drop_column('email_settings', 'reply_to')

    op.drop_table('email_parts')
    op.drop_table('email_templates')
    op.drop_table('email_type_settings')

    op.create_table(
        'email_text_overrides',
        sa.Column('key', sa.String(60), primary_key=True),
        sa.Column('language', sa.String(5), primary_key=True),
        sa.Column('text', sa.Text(), nullable=False),
        *_audit_columns(),
    )
