"""
One-off cleanup tool: finds Customer rows that are duplicates of each
other (same details, case-insensitive/whitespace-trimmed) and merges
them into a single surviving row, repointing every Reservation that
pointed at a duplicate.

This is a manual, explicitly-run script — not part of the app runtime
and not an Alembic migration. It defaults to a dry run; pass --apply
to actually commit the changes.

Usage:
    python merge_duplicate_customers.py          # dry run, prints the plan
    python merge_duplicate_customers.py --apply  # actually merges
"""

import sys
from collections import defaultdict

from sqlalchemy import delete, select, update

from app.database import SessionLocal
from app.models import Customer, Reservation
from app.services.customers import normalized_customer_key


def merge_duplicate_customers(dry_run: bool = True):
    db = SessionLocal()

    try:
        customers = db.scalars(select(Customer)).all()

        groups = defaultdict(list)

        for customer in customers:
            key = normalized_customer_key(
                customer.first_name,
                customer.last_name,
                customer.date_of_birth,
                customer.address,
                customer.postal_code,
            )
            groups[key].append(customer)

        merged_count = 0

        for group in groups.values():
            if len(group) < 2:
                continue

            # Oldest row survives.
            group.sort(key=lambda customer: customer.created_at)
            survivor, *duplicates = group
            duplicate_ids = [duplicate.id for duplicate in duplicates]

            print(
                f"{survivor.first_name} {survivor.last_name}: "
                f"merging {len(duplicates)} duplicate(s) into {survivor.id}"
            )

            if not dry_run:
                db.execute(
                    update(Reservation)
                    .where(Reservation.customer_id.in_(duplicate_ids))
                    .values(customer_id=survivor.id)
                )

                db.execute(
                    delete(Customer).where(Customer.id.in_(duplicate_ids))
                )

            merged_count += len(duplicates)

        if dry_run:
            db.rollback()
            print(
                f"\n[dry run] Would merge {merged_count} duplicate customer "
                f"row(s). Re-run with --apply to commit."
            )
        else:
            db.commit()
            print(f"\nMerged {merged_count} duplicate customer row(s).")

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    merge_duplicate_customers(dry_run="--apply" not in sys.argv)
