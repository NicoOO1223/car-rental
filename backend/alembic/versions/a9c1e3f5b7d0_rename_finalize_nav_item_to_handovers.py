"""rename finalize nav item to handovers

The sidebar item moved from /reservations/finalize to /handovers.
users.hidden_nav_items stores hrefs, so anyone who had hidden the old item
would silently see the new one again.

Revision ID: a9c1e3f5b7d0
Revises: f7b9d2c4a6e8
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a9c1e3f5b7d0'
down_revision: Union[str, Sequence[str], None] = 'f7b9d2c4a6e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rewrite(old: str, new: str) -> None:
    op.execute(
        f"""
        UPDATE users
        SET hidden_nav_items = (
            SELECT COALESCE(
                jsonb_agg(
                    CASE WHEN item = to_jsonb('{old}'::text)
                         THEN to_jsonb('{new}'::text)
                         ELSE item
                    END
                ),
                '[]'::jsonb
            )
            FROM jsonb_array_elements(hidden_nav_items::jsonb) AS item
        )
        WHERE hidden_nav_items::jsonb @> to_jsonb(ARRAY['{old}']::text[])
        """
    )


def upgrade() -> None:
    """Upgrade schema."""
    _rewrite('/reservations/finalize', '/handovers')


def downgrade() -> None:
    """Downgrade schema."""
    _rewrite('/handovers', '/reservations/finalize')
