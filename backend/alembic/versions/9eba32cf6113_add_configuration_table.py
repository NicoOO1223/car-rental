"""add configuration table

Revision ID: 9eba32cf6113
Revises: f90b329e16e3
Create Date: 2026-09-20 22:00:00.000000

"""
from decimal import Decimal
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9eba32cf6113'
down_revision: Union[str, Sequence[str], None] = 'f90b329e16e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


configuration_table = sa.table(
    "configuration",
    sa.column("id", sa.Integer),
    sa.column("short_term_threshold_days", sa.Integer),
    sa.column("short_term_fee", sa.Numeric(10, 2)),
    sa.column("airport_change_fee", sa.Numeric(10, 2)),
    sa.column("default_currency", sa.String(3)),
    sa.column("access_token_expire_days", sa.Integer),
)


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        "configuration",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("short_term_threshold_days", sa.Integer(), nullable=False),
        sa.Column("short_term_fee", sa.Numeric(10, 2), nullable=False),
        sa.Column("airport_change_fee", sa.Numeric(10, 2), nullable=False),
        sa.Column("default_currency", sa.String(3), nullable=False),
        sa.Column("access_token_expire_days", sa.Integer(), nullable=False),
        sa.CheckConstraint("id = 1", name="configuration_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Seed the single row with today's hardcoded values (previously
    # app.services.pricing's SHORT_TERM_THRESHOLD_DAYS/SHORT_TERM_FEE/
    # AIRPORT_CHANGE_FEE, the "eur" literal duplicated across
    # app.services.handovers and app.schemas.pricing, and
    # app.services.auth's ACCESS_TOKEN_EXPIRE_DAYS) so behavior is
    # unchanged immediately after this migration runs.
    op.bulk_insert(
        configuration_table,
        [
            {
                "id": 1,
                "short_term_threshold_days": 5,
                "short_term_fee": Decimal("30.00"),
                "airport_change_fee": Decimal("50.00"),
                "default_currency": "eur",
                "access_token_expire_days": 7,
            }
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("configuration")
