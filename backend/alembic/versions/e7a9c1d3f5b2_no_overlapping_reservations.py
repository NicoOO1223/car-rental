"""the database refuses two active reservations for one car at the same time

Revision ID: e7a9c1d3f5b2
Revises: d6f8b0c2e4a1
Create Date: 2026-10-04 00:00:00.000000

Until now "one car, one booking at a time" was kept only by the application: it
locks the car, looks for a conflict, then writes. Every path that books a car
has to remember to do that, and one that forgets double-books silently. This
adds the same rule to the database, so a path that forgets gets an error
instead of a double booking.

It covers CONFIRMED and ACTIVE reservations. An AWAITING_PAYMENT hold blocks
only until it expires, which depends on the clock and cannot be part of a
constraint, so holds stay application-level. A rental that is overdue keeps
blocking the car in the application for a while after its return time; the
constraint uses the booked times only, so it is the looser of the two and never
refuses something the application allows.

Needs the btree_gist extension (on Azure it has to be allowed in the server's
azure.extensions setting first; deploy/main.bicep does that).

If two active reservations for one car already overlap, this stops and lists
them: decide which one is real, cancel or move the other, and run it again.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7a9c1d3f5b2'
down_revision: Union[str, None] = 'd6f8b0c2e4a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CONSTRAINT = "no_overlapping_active_reservations"


def upgrade() -> None:
    """Upgrade schema."""

    connection = op.get_bind()

    overlaps = connection.execute(
        sa.text(
            """
            SELECT a.id, b.id, c.license_plate, a.pickup_at, a.return_at, b.pickup_at, b.return_at
            FROM reservations a
            JOIN reservations b
              ON a.car_id = b.car_id AND a.id < b.id
             AND tstzrange(a.pickup_at, a.return_at) && tstzrange(b.pickup_at, b.return_at)
            JOIN cars c ON c.id = a.car_id
            WHERE a.status IN ('CONFIRMED', 'ACTIVE') AND b.status IN ('CONFIRMED', 'ACTIVE')
            ORDER BY c.license_plate, a.pickup_at
            LIMIT 20
            """
        )
    ).all()

    if overlaps:
        listing = "\n".join(
            f"  {plate}: {a} ({a_from} to {a_to}) overlaps {b} ({b_from} to {b_to})"
            for a, b, plate, a_from, a_to, b_from, b_to in overlaps
        )

        raise RuntimeError(
            "Cannot add the no-overlap rule: these active reservations already overlap "
            f"for the same car (first {len(overlaps)} shown).\n{listing}\n"
            "Cancel or move one of each pair, then run the migration again."
        )

    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.execute(
        f"""
        ALTER TABLE reservations
        ADD CONSTRAINT {CONSTRAINT}
        EXCLUDE USING gist (car_id WITH =, tstzrange(pickup_at, return_at) WITH &&)
        WHERE (status IN ('CONFIRMED', 'ACTIVE'))
        """
    )


def downgrade() -> None:
    """Downgrade schema."""

    # drop_constraint has no type for an exclusion constraint.
    op.execute(f"ALTER TABLE reservations DROP CONSTRAINT {CONSTRAINT}")
