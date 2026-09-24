"""add security deposit

Revision ID: e9b1d3f5a7c8
Revises: d7f9b1c3e5a6
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9b1d3f5a7c8'
down_revision: Union[str, Sequence[str], None] = 'd7f9b1c3e5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 0.00 leaves deposits off until an admin sets an amount.
    op.add_column('configuration', sa.Column('security_deposit_amount', sa.Numeric(10, 2), nullable=False, server_default='0.00'))

    op.add_column('handovers', sa.Column('deposit_amount', sa.Numeric(10, 2), nullable=True))
    op.add_column('handovers', sa.Column('deposit_currency', sa.String(3), nullable=True))
    op.add_column('handovers', sa.Column('deposit_method', sa.String(10), nullable=True))
    op.add_column('handovers', sa.Column('deposit_status', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('deposit_stripe_payment_intent_id', sa.String(255), nullable=True))
    op.add_column('handovers', sa.Column('deposit_held_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('handovers', sa.Column('deposit_settled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('handovers', sa.Column('deposit_captured_amount', sa.Numeric(10, 2), nullable=True))
    op.create_check_constraint(
        'valid_handover_deposit_status',
        'handovers',
        "deposit_status IN ('PENDING','HELD','RELEASED','CAPTURED','PARTIALLY_CAPTURED','LAPSED','FAILED','CANCELLED')",
    )
    op.create_check_constraint(
        'valid_handover_deposit_method',
        'handovers',
        "deposit_method IN ('CARD','CASH')",
    )

    op.add_column('check_outs', sa.Column('deposit_applied', sa.Numeric(10, 2), nullable=False, server_default='0.00'))
    op.add_column('check_outs', sa.Column('deposit_returned', sa.Numeric(10, 2), nullable=False, server_default='0.00'))
    op.add_column('check_outs', sa.Column('deposit_settled_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('check_outs', 'deposit_settled_at')
    op.drop_column('check_outs', 'deposit_returned')
    op.drop_column('check_outs', 'deposit_applied')

    op.drop_constraint('valid_handover_deposit_method', 'handovers', type_='check')
    op.drop_constraint('valid_handover_deposit_status', 'handovers', type_='check')
    for column in (
        'deposit_captured_amount',
        'deposit_settled_at',
        'deposit_held_at',
        'deposit_stripe_payment_intent_id',
        'deposit_status',
        'deposit_method',
        'deposit_currency',
        'deposit_amount',
    ):
        op.drop_column('handovers', column)

    op.drop_column('configuration', 'security_deposit_amount')
