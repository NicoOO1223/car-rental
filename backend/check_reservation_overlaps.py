"""
Lists active reservations that overlap for the same car. Read-only: it changes
nothing.

Run it before deploying the migration that adds the database's no-overlap rule
(alembic revision e7a9c1d3f5b2), which refuses to run while any exist:

    python check_reservation_overlaps.py

On a deployed stack, from the repository root:

    az containerapp exec --name <backend app> --resource-group <rg> \
        --command "python check_reservation_overlaps.py"

Exit status 0 means none; 1 means some were found and are listed; 2 means it
could not connect. For each pair, decide which booking is real and cancel or
move the other one in the staff app, then run this again.
"""

import sys

from sqlalchemy import text

from app.database import SessionLocal

# The same test the migration uses: both reservations hold the car (CONFIRMED or
# ACTIVE) and their booked times overlap. Back-to-back is not an overlap.
OVERLAPS = text(
    """
    SELECT c.license_plate,
           a.id, a.status, a.pickup_at, a.return_at,
           b.id, b.status, b.pickup_at, b.return_at
    FROM reservations a
    JOIN reservations b
      ON a.car_id = b.car_id AND a.id < b.id
     AND tstzrange(a.pickup_at, a.return_at) && tstzrange(b.pickup_at, b.return_at)
    JOIN cars c ON c.id = a.car_id
    WHERE a.status IN ('CONFIRMED', 'ACTIVE') AND b.status IN ('CONFIRMED', 'ACTIVE')
    ORDER BY c.license_plate, a.pickup_at
    """
)


def main() -> int:
    try:
        db = SessionLocal()
        rows = db.execute(OVERLAPS).all()
    except Exception as error:  # noqa: BLE001 - report any connection problem plainly
        print(f"Could not read the database: {error}", file=sys.stderr)
        return 2

    if not rows:
        print("No overlapping active reservations. The no-overlap migration can run.")
        return 0

    print(f"{len(rows)} overlapping pair(s) of active reservations:\n")

    for plate, a_id, a_status, a_from, a_to, b_id, b_status, b_from, b_to in rows:
        print(f"{plate}")
        print(f"  {a_id}  {a_status:<9} {a_from} -> {a_to}")
        print(f"  {b_id}  {b_status:<9} {b_from} -> {b_to}\n")

    print("Cancel or move one booking of each pair, then run this again.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
