"""add the data the public storefront needs

Revision ID: e1a3c5d7f9b1
Revises: d0f2b4c6e8a0
Create Date: 2026-10-03 00:00:00.000000

Additive only, and inert until an admin turns the storefront on: every new
column has a default that leaves today's behaviour unchanged.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e1a3c5d7f9b1'
down_revision: Union[str, None] = 'd0f2b4c6e8a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # --- configuration -------------------------------------------------------------
    op.add_column('configuration', sa.Column('storefront_enabled', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('configuration', sa.Column('online_share_percent', sa.Integer(), nullable=False, server_default='30'))
    op.add_column('configuration', sa.Column('free_cancellation_hours', sa.Integer(), nullable=False, server_default='48'))
    op.add_column('configuration', sa.Column('hold_minutes', sa.Integer(), nullable=False, server_default='15'))
    op.add_column('configuration', sa.Column('min_booking_lead_hours', sa.Integer(), nullable=False, server_default='24'))
    op.add_column('configuration', sa.Column('terms_text', sa.Text(), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('terms_url', sa.String(500), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('privacy_text', sa.Text(), nullable=False, server_default=''))
    op.add_column('configuration', sa.Column('privacy_url', sa.String(500), nullable=False, server_default=''))
    # Bumped whenever the terms or privacy text changes, so a booking records
    # which version the renter accepted.
    op.add_column('configuration', sa.Column('legal_version', sa.Integer(), nullable=False, server_default='1'))
    op.create_check_constraint('valid_online_share_percent', 'configuration', 'online_share_percent BETWEEN 1 AND 100')
    op.create_check_constraint('valid_free_cancellation_hours', 'configuration', 'free_cancellation_hours BETWEEN 0 AND 720')
    op.create_check_constraint('valid_hold_minutes', 'configuration', 'hold_minutes BETWEEN 5 AND 60')

    # --- reservations ------------------------------------------------------------------
    op.add_column('reservations', sa.Column('source', sa.String(12), nullable=False, server_default='STAFF'))
    op.add_column('reservations', sa.Column('public_reference', sa.String(9), nullable=True))
    op.add_column('reservations', sa.Column('hold_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('reservations', sa.Column('cancellation_reason', sa.String(20), nullable=True))
    op.add_column('reservations', sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('reservations', sa.Column('cancellation_deadline_at', sa.DateTime(timezone=True), nullable=True))
    # The price as agreed when the booking was made, so what is charged is
    # what was quoted even if rates or fees change afterwards. NULL on older
    # bookings, which keep pricing from the live rates.
    op.add_column('reservations', sa.Column('agreed_price_per_day', sa.Numeric(10, 2), nullable=True))
    op.add_column('reservations', sa.Column('agreed_short_term_fee', sa.Numeric(10, 2), nullable=True))
    op.add_column('reservations', sa.Column('agreed_airport_change_fee', sa.Numeric(10, 2), nullable=True))
    op.add_column('reservations', sa.Column('agreed_total_amount', sa.Numeric(10, 2), nullable=True))
    op.add_column('reservations', sa.Column('agreed_currency', sa.String(3), nullable=True))
    op.add_column('reservations', sa.Column('prepayment_percent', sa.Integer(), nullable=True))
    op.add_column('reservations', sa.Column('client_ip_hash', sa.String(64), nullable=True))
    op.create_index('ix_reservations_public_reference', 'reservations', ['public_reference'], unique=True)
    op.create_index('ix_reservations_status_hold_expires_at', 'reservations', ['status', 'hold_expires_at'])
    op.create_check_constraint('valid_reservation_source', 'reservations', "source IN ('STAFF','STOREFRONT')")

    # --- customers (consent recorded per booking, since a guest is a new row) ------------
    op.add_column('customers', sa.Column('terms_accepted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('customers', sa.Column('terms_version', sa.Integer(), nullable=True))
    op.add_column('customers', sa.Column('privacy_acknowledged_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('customers', sa.Column('privacy_version', sa.Integer(), nullable=True))

    # --- cars ---------------------------------------------------------------------------------
    op.add_column('cars', sa.Column('offered_online', sa.Boolean(), nullable=False, server_default=sa.true()))

    # --- the online share of a rental -----------------------------------------------------------
    op.create_table(
        'reservation_payments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('reservations.id'), nullable=False),
        sa.Column('kind', sa.String(12), nullable=False, server_default='PREPAYMENT'),
        # The same columns, with the same meaning, as the counter payment on
        # handovers, so the same payment-status rules apply to both.
        sa.Column('payment_method', sa.String(10), nullable=True),
        sa.Column('payment_amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('payment_currency', sa.String(3), nullable=True),
        sa.Column('payment_status', sa.String(12), nullable=False, server_default='PENDING'),
        sa.Column('stripe_payment_intent_id', sa.String(255), nullable=True),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refund_amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('refunded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('stripe_refund_id', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('PREPAYMENT')", name='valid_reservation_payment_kind'),
        sa.CheckConstraint(
            "payment_status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED','REFUNDED')",
            name='valid_reservation_payment_status',
        ),
    )
    op.create_index('ix_reservation_payments_reservation_id', 'reservation_payments', ['reservation_id'])
    op.create_index('ix_reservation_payments_intent', 'reservation_payments', ['stripe_payment_intent_id'], unique=True)
    op.create_index(
        'uq_reservation_payments_one_prepayment', 'reservation_payments', ['reservation_id'],
        unique=True, postgresql_where=sa.text("kind = 'PREPAYMENT'"),
    )

    # --- invoices can belong to an online payment as well as a counter payment ------------------
    op.add_column('invoices', sa.Column('payment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('reservation_payments.id'), nullable=True))
    op.alter_column('invoices', 'handover_id', nullable=True)
    op.create_check_constraint('invoice_has_one_payment', 'invoices', 'num_nonnulls(handover_id, payment_id) = 1')
    op.create_unique_constraint('unique_invoice_per_online_payment_and_kind', 'invoices', ['payment_id', 'kind'])

    # --- a rental fully paid online settles the counter payment as PREPAID ---------------------------
    op.drop_constraint('valid_handover_payment_method', 'handovers', type_='check')
    op.create_check_constraint('valid_handover_payment_method', 'handovers', "payment_method IN ('CARD','CASH','PREPAID')")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('valid_handover_payment_method', 'handovers', type_='check')
    op.create_check_constraint('valid_handover_payment_method', 'handovers', "payment_method IN ('CARD','CASH')")

    op.drop_constraint('unique_invoice_per_online_payment_and_kind', 'invoices', type_='unique')
    op.drop_constraint('invoice_has_one_payment', 'invoices', type_='check')
    op.alter_column('invoices', 'handover_id', nullable=False)
    op.drop_column('invoices', 'payment_id')

    op.drop_table('reservation_payments')

    op.drop_column('cars', 'offered_online')

    for column in ('privacy_version', 'privacy_acknowledged_at', 'terms_version', 'terms_accepted_at'):
        op.drop_column('customers', column)

    op.drop_constraint('valid_reservation_source', 'reservations', type_='check')
    op.drop_index('ix_reservations_status_hold_expires_at', table_name='reservations')
    op.drop_index('ix_reservations_public_reference', table_name='reservations')
    for column in (
        'client_ip_hash', 'prepayment_percent', 'agreed_currency', 'agreed_total_amount',
        'agreed_airport_change_fee', 'agreed_short_term_fee', 'agreed_price_per_day',
        'cancellation_deadline_at', 'cancelled_at', 'cancellation_reason', 'hold_expires_at',
        'public_reference', 'source',
    ):
        op.drop_column('reservations', column)

    op.drop_constraint('valid_hold_minutes', 'configuration', type_='check')
    op.drop_constraint('valid_free_cancellation_hours', 'configuration', type_='check')
    op.drop_constraint('valid_online_share_percent', 'configuration', type_='check')
    for column in (
        'legal_version', 'privacy_url', 'privacy_text', 'terms_url', 'terms_text',
        'min_booking_lead_hours', 'hold_minutes', 'free_cancellation_hours',
        'online_share_percent', 'storefront_enabled',
    ):
        op.drop_column('configuration', column)
