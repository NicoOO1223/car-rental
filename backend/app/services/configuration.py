from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Configuration, User
from app.services.audit import audit_log

CONFIGURATION_ID = 1

# Fee fields arrive from ConfigurationUpdate as plain floats (matching the
# rest of the pricing schemas' float convention) but the column is
# Numeric(10,2) — routed through str() first so e.g. 29.9 doesn't pick up
# binary-float rounding noise before it reaches the Decimal column.
_DECIMAL_FIELDS = {
    "short_term_fee",
    "airport_change_fee",
    "late_fee_per_hour",
    "fuel_fee_per_eighth",
    "refuel_service_fee",
    "max_damage_charge",
    "security_deposit_amount",
    "vat_rate",
}


def get_configuration(db: Session) -> Configuration:
    """
    A plain indexed primary-key read, done fresh on every call rather than
    cached — there's no caching layer anywhere else in this backend to
    build on, and this read is cheaper than the other DB round-trips
    already happening in the same request (e.g. looking up the car being
    priced).
    """

    return db.get(Configuration, CONFIGURATION_ID)


def vat_terms(configuration: Configuration) -> dict:
    """The VAT settings as the keyword arguments calculate_price_breakdown
    takes, so every place that prices a booking applies the same rule."""

    return {
        "vat_rate": configuration.vat_rate,
        "prices_include_vat": configuration.prices_include_vat,
    }


def _json_safe(value):
    return str(value) if isinstance(value, Decimal) else value


def update_configuration(db: Session, *, actor: User, **fields) -> Configuration:
    configuration = get_configuration(db)

    changes = {}

    for field, value in fields.items():
        if value is None:
            continue

        if field in _DECIMAL_FIELDS:
            value = Decimal(str(value))

        current_value = getattr(configuration, field)

        if value != current_value:
            changes[field] = {
                "old": _json_safe(current_value),
                "new": _json_safe(value),
            }
            setattr(configuration, field, value)

    # A change to the terms or privacy text is a new version, so a booking can
    # record which one the renter accepted.
    if any(field in changes for field in ("terms_text", "terms_url", "privacy_text", "privacy_url")):
        configuration.legal_version += 1
        changes["legal_version"] = {"old": configuration.legal_version - 1, "new": configuration.legal_version}

    if changes:
        audit_log(
            db,
            user=actor,
            action="configuration.updated",
            entity_type="configuration",
            entity_id=None,
            metadata=changes,
        )

    db.commit()
    db.refresh(configuration)

    return configuration
