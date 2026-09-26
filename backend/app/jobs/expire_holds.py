"""
The sweeper: run every few minutes as a scheduled job (python -m app.jobs.expire_holds).

Frees the bookings whose payment hold ran out, and honours a payment that
arrived without the webhook being seen. Nothing depends on it for correctness
(an expired hold already stops blocking its car); it keeps the data tidy and
cancels the abandoned Stripe payments.
"""

import logging
import sys

from app.database import SessionLocal
from app.services.public_booking import expire_stale_holds

logger = logging.getLogger("expire_holds")


def main() -> int:
    with SessionLocal() as db:
        result = expire_stale_holds(db)

    logger.info("Hold sweep finished: %s", result)

    return 1 if result["failed"] else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    sys.exit(main())
