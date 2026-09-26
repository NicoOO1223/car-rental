"""add stripe webhook dedupe table and payment intent indexes

Revision ID: b2c4d6e8f0a1
Revises: a1b3c5d7e9f2
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c4d6e8f0a1'
down_revision: Union[str, Sequence[str], None] = 'a1b3c5d7e9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'processed_stripe_events',
        sa.Column('event_id', sa.String(255), primary_key=True),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=False),
    )

    # Webhooks look records up by intent id.
    op.create_index('ix_handovers_stripe_payment_intent_id', 'handovers', ['stripe_payment_intent_id'])
    op.create_index('ix_handovers_deposit_stripe_payment_intent_id', 'handovers', ['deposit_stripe_payment_intent_id'])
    op.create_index('ix_check_outs_stripe_payment_intent_id', 'check_outs', ['stripe_payment_intent_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_check_outs_stripe_payment_intent_id', table_name='check_outs')
    op.drop_index('ix_handovers_deposit_stripe_payment_intent_id', table_name='handovers')
    op.drop_index('ix_handovers_stripe_payment_intent_id', table_name='handovers')
    op.drop_table('processed_stripe_events')
