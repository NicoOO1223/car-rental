"""
First-run setup for a new stack, run by docker-entrypoint.sh after the
migrations. It reads three values from the environment, which the
provisioning script (deploy/provision.ps1) sets:

    INITIAL_ADMIN_EMAIL     the first administrator's login
    INITIAL_ADMIN_PASSWORD  their password (the script generated it and hands
                            it to the operator; the admin can change it)
    STACK_BUSINESS_B64      the business profile from the stack manifest
                            (name, currency, timezone, locale, languages, VAT)
                            as base64 of a JSON object. Base64 so no quoting
                            can mangle it on the way into the container.

Nothing happens unless the first two are set, and nothing happens once the
stack has an administrator, so it is safe to run on every start.

Can also be run by hand:  python setup_business.py
"""

import base64
import json
import os
import sys

from app.database import SessionLocal
from pydantic import ValidationError

from app.services.stack_setup import StackSetupError, apply_stack_setup


def main() -> int:
    email = os.environ.get("INITIAL_ADMIN_EMAIL", "").strip()
    password = os.environ.get("INITIAL_ADMIN_PASSWORD", "")

    if not email or not password:
        return 0

    try:
        encoded = os.environ.get("STACK_BUSINESS_B64", "")
        business = json.loads(base64.b64decode(encoded).decode("utf-8")) if encoded else {}
    except (ValueError, UnicodeDecodeError) as error:
        print(f"Stack setup: STACK_BUSINESS_B64 is not valid base64 JSON ({error}).")
        return 1

    db = SessionLocal()

    try:
        result = apply_stack_setup(db, admin_email=email, admin_password=password, business=business)
    except (StackSetupError, ValidationError) as error:
        print(f"Stack setup failed: {error}")
        return 1
    finally:
        db.close()

    if result.created_admin:
        print(f"Stack setup: created administrator {result.created_admin}.")

    if result.applied:
        print(f"Stack setup: applied {', '.join(result.applied)}.")

    if result.skipped:
        print(f"Stack setup: {result.skipped}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
