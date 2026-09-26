import re
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.models import Extra, Reservation, ReservationExtra, User
from app.schemas.extra import ExtraCreate, ExtraUpdate
from app.services.audit import audit_log
from app.services.pricing import ExtraSelection


def list_extras(db: Session, include_inactive: bool = False) -> list[Extra]:
    query = select(Extra).order_by(Extra.sort_order, Extra.name)

    if not include_inactive:
        query = query.where(Extra.is_active.is_(True))

    return list(db.scalars(query).all())


def resolve_extra_selections(
    db: Session, requested, already_booked_ids=()
) -> list[tuple[Extra, int]]:
    """
    Validate a client-supplied list of {extra_id, quantity} against the live
    catalog, returning (Extra, quantity) pairs.

    Raises ValueError — which every router in this package turns into a 400 —
    rather than letting a duplicate selection surface as a 500 from the
    unique_reservation_extra constraint, or an over-quantity selection get
    silently accepted.

    `already_booked_ids` are extras the reservation being edited already
    carries: those stay selectable even if the extra has since been retired,
    since retiring only stops *new* sales.
    """

    if not requested:
        return []

    extra_ids = [item.extra_id for item in requested]

    if len(set(extra_ids)) != len(extra_ids):
        raise AppError("extra.same_extra_was_selected_more_than", "The same extra was selected more than once.")

    catalog = {
        extra.id: extra
        for extra in db.scalars(
            select(Extra).where(Extra.id.in_(extra_ids))
        ).all()
    }

    resolved: list[tuple[Extra, int]] = []

    for item in requested:
        extra = catalog.get(item.extra_id)

        if extra is None:
            raise AppError("extra.unknown_extra_selected", "Unknown extra selected.")

        if not extra.is_active and extra.id not in already_booked_ids:
            raise AppError(
                "extra.no_longer_available",
                f"{extra.name} is no longer available.",
                name=extra.name,
            )

        if item.quantity > extra.max_quantity:
            raise AppError(
                "extra.max_quantity",
                f"At most {extra.max_quantity} x {extra.name} can be added.",
                max=extra.max_quantity,
                name=extra.name,
            )

        resolved.append((extra, item.quantity))

    return resolved


def selections_from_catalog(resolved) -> list[ExtraSelection]:
    """Live catalog prices — for quotes and for a brand-new booking."""

    return [
        ExtraSelection(
            code=extra.code,
            name=extra.name,
            quantity=quantity,
            unit_price=extra.price,
            price_unit=extra.price_unit,
        )
        for extra, quantity in resolved
    ]


def selections_from_reservation(reservation: Reservation) -> list[ExtraSelection]:
    """
    Snapshotted prices — for anything that charges or documents an existing
    reservation. Reads only reservation_extras columns, so it never joins
    or lazy-loads the catalog, and a later catalog price change cannot
    alter what an existing booking costs.
    """

    return [
        ExtraSelection(
            code=line.extra_code,
            name=line.name,
            quantity=line.quantity,
            unit_price=line.unit_price,
            price_unit=line.price_unit,
        )
        for line in reservation.extras
    ]


def build_reservation_extras(resolved) -> list[ReservationExtra]:
    """Snapshot the catalog rows onto new reservation_extras lines."""

    return [
        ReservationExtra(
            extra_id=extra.id,
            quantity=quantity,
            extra_code=extra.code,
            name=extra.name,
            unit_price=extra.price,
            price_unit=extra.price_unit,
        )
        for extra, quantity in resolved
    ]


# --- Admin management ---------------------------------------------------

_EDITABLE_FIELDS = ("name", "description", "translations", "price", "price_unit", "max_quantity")


def clean_translations(value) -> dict:
    """Keeps only non-empty, trimmed text, and drops languages with nothing
    left, so "no Italian wording" is stored as no entry at all."""

    cleaned = {}

    for language, wording in (value or {}).items():
        wording = wording if isinstance(wording, dict) else wording.model_dump()
        kept = {
            field: text.strip()
            for field, text in wording.items()
            if isinstance(text, str) and text.strip()
        }

        if kept:
            cleaned[language] = kept

    return cleaned


def translations_by_code(db: Session, codes) -> dict[str, dict]:
    """Other-language wording for the extras with these codes, for printed
    documents."""

    codes = list(codes)

    if not codes:
        return {}

    rows = db.execute(select(Extra.code, Extra.translations).where(Extra.code.in_(codes)))

    return {code: translations or {} for code, translations in rows}


def localized_name(name: str, translations: dict | None, language: str) -> str:
    """The extra's name in `language`, or its English name."""

    return ((translations or {}).get(language) or {}).get("name") or name


def _json_safe(value):
    return str(value) if isinstance(value, Decimal) else value


def _generate_code(db: Session, name: str) -> str:
    """
    A stable, unique symbolic code from the name, e.g. "Roof rack" ->
    "ROOF_RACK". Fixed at creation: seed data, tests and the frontend's
    icon map reference it, so renaming an extra never changes it.
    """

    base = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")[:44] or "EXTRA"
    code = base
    suffix = 2

    while db.scalar(select(Extra.id).where(Extra.code == code)) is not None:
        code = f"{base}_{suffix}"
        suffix += 1

    return code


def get_extra(db: Session, extra_id: UUID) -> Extra:
    extra = db.get(Extra, extra_id)

    if extra is None:
        raise NotFoundError("extra.not_found", "Extra not found.")

    return extra


def create_extra(db: Session, data: ExtraCreate, actor: User) -> Extra:
    next_order = (db.scalar(select(func.max(Extra.sort_order))) or 0) + 10

    extra = Extra(
        code=_generate_code(db, data.name),
        name=data.name.strip(),
        description=(data.description or "").strip() or None,
        translations=clean_translations(data.translations),
        price=data.price,
        price_unit=data.price_unit,
        max_quantity=data.max_quantity,
        is_active=True,
        sort_order=next_order,
    )

    db.add(extra)
    db.flush()

    audit_log(
        db,
        user=actor,
        action="extra.created",
        entity_type="extra",
        entity_id=extra.id,
        metadata={
            "code": extra.code,
            "name": extra.name,
            "price": _json_safe(extra.price),
            "price_unit": extra.price_unit,
            "max_quantity": extra.max_quantity,
        },
    )

    db.commit()
    db.refresh(extra)

    return extra


def update_extra(db: Session, extra_id: UUID, data: ExtraUpdate, actor: User) -> Extra:
    """
    Edits an add-on. Existing bookings are unaffected: they carry their own
    snapshot of name, price and unit (see build_reservation_extras).
    """

    extra = get_extra(db, extra_id)
    fields = data.model_dump(exclude_unset=True)

    changes = {}

    for field in _EDITABLE_FIELDS:
        if field not in fields:
            continue

        value = fields[field]

        if field == "name":
            value = (value or "").strip()

            if not value:
                raise AppError("validation.name_empty", "The name cannot be empty.")

        if field == "description":
            value = (value or "").strip() or None

        if field == "translations":
            value = clean_translations(value)

        if field == "price" and value is None:
            raise AppError("extra.price_cannot_empty", "The price cannot be empty.")

        current = getattr(extra, field)

        if value != current:
            changes[field] = {"old": _json_safe(current), "new": _json_safe(value)}
            setattr(extra, field, value)

    if changes:
        audit_log(
            db,
            user=actor,
            action="extra.updated",
            entity_type="extra",
            entity_id=extra.id,
            metadata={"code": extra.code, **changes},
        )

    if "is_active" in fields and fields["is_active"] is not None:
        if fields["is_active"] != extra.is_active:
            extra.is_active = fields["is_active"]

            audit_log(
                db,
                user=actor,
                action="extra.reactivated" if extra.is_active else "extra.retired",
                entity_type="extra",
                entity_id=extra.id,
                metadata={"code": extra.code},
            )

    db.commit()
    db.refresh(extra)

    return extra


def reorder_extras(db: Session, ordered_ids: list[UUID], actor: User) -> list[Extra]:
    """`ordered_ids` must list every extra exactly once."""

    extras = {extra.id: extra for extra in db.scalars(select(Extra)).all()}

    if len(set(ordered_ids)) != len(ordered_ids) or set(ordered_ids) != set(extras):
        raise AppError("extra.new_order_must_list_every_extra", "The new order must list every extra exactly once.")

    for position, extra_id in enumerate(ordered_ids):
        extras[extra_id].sort_order = (position + 1) * 10

    audit_log(
        db,
        user=actor,
        action="extra.reordered",
        entity_type="extra",
        entity_id=None,
        metadata={"order": [extras[i].code for i in ordered_ids]},
    )

    db.commit()

    return list_extras(db, include_inactive=True)
