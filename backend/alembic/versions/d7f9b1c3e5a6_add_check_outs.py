"""add check outs

Revision ID: d7f9b1c3e5a6
Revises: c5e7a9b1d3f4
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd7f9b1c3e5a6'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'check_outs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('reservations.id'), nullable=False, unique=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('returned_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('return_mileage', sa.Integer(), nullable=False),
        sa.Column('fuel_eighths', sa.Integer(), nullable=False),
        sa.Column('damage_reported', sa.Boolean(), nullable=False),
        sa.Column('damage_notes', sa.Text(), nullable=True),
        sa.Column('damage_charge', sa.Numeric(10, 2), nullable=False),
        sa.Column('damage_task_starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('damage_task_ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('late_hours', sa.Integer(), nullable=False),
        sa.Column('late_fee', sa.Numeric(10, 2), nullable=False),
        sa.Column('fuel_fee', sa.Numeric(10, 2), nullable=False),
        sa.Column('late_fee_waived', sa.Boolean(), nullable=False),
        sa.Column('fuel_fee_waived', sa.Boolean(), nullable=False),
        sa.Column('waiver_reason', sa.Text(), nullable=True),
        sa.Column('total_charge', sa.Numeric(10, 2), nullable=False),
        sa.Column('stripe_payment_intent_id', sa.String(255), nullable=True),
        sa.Column('payment_amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('payment_currency', sa.String(3), nullable=True),
        sa.Column('payment_status', sa.String(20), nullable=False),
        sa.Column('payment_method', sa.String(10), nullable=True),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('employee_signature_image', sa.Text(), nullable=True),
        sa.Column('employee_signed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('employee_signed_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('fuel_eighths BETWEEN 0 AND 8', name='valid_check_out_fuel_eighths'),
        sa.CheckConstraint(
            "payment_status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED')",
            name='valid_check_out_payment_status',
        ),
        sa.CheckConstraint("payment_method IN ('CARD','CASH')", name='valid_check_out_payment_method'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('check_outs')
