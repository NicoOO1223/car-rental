"""
First-run setup of a new stack: its first administrator and its business
profile (name, currency, timezone, locale, languages, VAT).

Run by `setup_business.py` when a stack starts, from values the provisioning
script put in the container's environment. It does something only while the
stack has no administrator at all, so every later restart, and any stack that
is already in use, is left exactly as it is.
"""

import secrets
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Reservation, User
from app.schemas.configuration import ConfigurationUpdate
from app.services.auth import hash_password, normalize_email
from app.services.configuration import update_configuration

# Manifest name -> Configuration field.
BUSINESS_FIELDS = {
    "name": "business_name",
    "legalName": "legal_name",
    "address": "address",
    "phone": "phone",
    "email": "email",
    "vatId": "vat_id",
    "vatRate": "vat_rate",
    "pricesIncludeVat": "prices_include_vat",
    "currency": "default_currency",
    "timezone": "timezone",
    "locale": "locale",
    "defaultLanguage": "default_language",
    "documentLanguage": "document_language",
    "invoicePrefix": "invoice_prefix",
}


class StackSetupError(Exception):
    """A problem in the setup values. Raised at provisioning time and read by
    the operator, never shown to a user of the app, so it carries no error
    code."""


@dataclass
class SetupResult:
    # What was done, or why nothing was.
    created_admin: str | None = None
    applied: list[str] = field(default_factory=list)
    skipped: str | None = None


def generate_password() -> str:
    """A password for the first administrator: long, random, and free of
    look-alike characters so it can be read off a screen."""

    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    return "".join(secrets.choice(alphabet) for _ in range(20))


def business_updates(business: dict) -> dict:
    """The manifest's business block as validated Configuration values.
    Unknown names are an error, so a typo in a manifest cannot pass silently."""

    unknown = set(business) - set(BUSINESS_FIELDS)

    if unknown:
        raise StackSetupError(f"Unknown business setting(s): {', '.join(sorted(unknown))}")

    mapped = {BUSINESS_FIELDS[name]: value for name, value in business.items()}

    # The same rules the admin screen applies (timezone exists, language is
    # supported, VAT rate in range, and so on).
    return ConfigurationUpdate(**mapped).model_dump(exclude_unset=True)


def apply_stack_setup(
    db: Session,
    *,
    admin_email: str,
    admin_password: str,
    business: dict | None,
) -> SetupResult:
    result = SetupResult()

    if db.scalar(select(func.count()).select_from(User).where(User.role == "admin")):
        result.skipped = "This stack already has an administrator."
        return result

    updates = business_updates(business or {})

    admin = User(
        email=normalize_email(admin_email),
        hashed_password=hash_password(admin_password),
        role="admin",
    )
    db.add(admin)
    db.flush()
    result.created_admin = admin.email

    if updates:
        if db.scalar(select(func.count()).select_from(Reservation)):
            # A stack with bookings is already someone's business: adding the
            # first administrator is safe, rewriting its profile is not.
            result.skipped = "The stack has reservations, so its business profile was left alone."
        else:
            update_configuration(db, actor=admin, **updates)
            result.applied = sorted(updates)

    db.commit()

    return result
