"""
Issuing invoices and credit notes for rental payments.

An invoice is created the moment a rental payment succeeds, by whichever
path recorded it (cash at the counter, the staff confirm button, or Stripe's
webhook). All of them call issue_invoice_for_handover(), which is safe to
call any number of times for the same payment: the second call finds the
invoice the first made.

The numbering is gap-free: the number is taken from a locked counter inside
the same transaction as the invoice itself, so an invoice that is rolled
back never leaves a hole in the sequence.
"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Car, Handover, Invoice, InvoiceCounter, Reservation, User
from app.models.invoice import KIND_CREDIT_NOTE, KIND_INVOICE
from app.services.audit import audit_log
from app.services.configuration import get_configuration, vat_terms
from app.services.extras import selections_from_reservation
from app.services.money import round_money
from app.services.pricing import calculate_price_breakdown

CREDIT_NOTE_PREFIX = "CN"
_COUNTER_ID = 1


def _next_sequence(db: Session) -> int:
    """Takes the next number. Locks the counter row until the surrounding
    transaction ends, so two issuers can never be handed the same number."""

    counter = db.execute(
        select(InvoiceCounter).where(InvoiceCounter.id == _COUNTER_ID).with_for_update()
    ).scalar_one()

    counter.last_sequence += 1
    db.flush()

    return counter.last_sequence


def _seller_snapshot(configuration) -> dict:
    return {
        "business_name": configuration.business_name,
        "legal_name": configuration.legal_name,
        "address": configuration.address,
        "phone": configuration.phone,
        "email": configuration.email,
        "vat_id": configuration.vat_id,
    }


def _customer_snapshot(customer) -> dict:
    return {
        "name": f"{customer.first_name} {customer.last_name}",
        "address": customer.address,
        "postal_code": customer.postal_code,
        "email": customer.email,
    }


def _money(value: Decimal) -> str:
    return str(round_money(Decimal(value)))


def _lines(reservation: Reservation, car: Car, breakdown) -> list[dict]:
    """The itemization as printed: one dict per line, amounts as strings so
    they survive JSON exactly."""

    days = breakdown.base_amount / car.price_per_day if car.price_per_day else Decimal(0)

    lines = [
        {
            "description": f"Vehicle rental: {car.make} {car.model} ({car.license_plate})",
            "quantity": int(days) if days == int(days) else float(days),
            "unit_price": _money(car.price_per_day),
            "amount": _money(breakdown.base_amount),
        }
    ]

    if breakdown.short_term_fee:
        lines.append(
            {
                "description": "Short-term rental fee",
                "quantity": 1,
                "unit_price": _money(breakdown.short_term_fee),
                "amount": _money(breakdown.short_term_fee),
            }
        )

    if breakdown.airport_change_fee:
        lines.append(
            {
                "description": "One-way rental fee",
                "quantity": 1,
                "unit_price": _money(breakdown.airport_change_fee),
                "amount": _money(breakdown.airport_change_fee),
            }
        )

    for extra in breakdown.extras:
        lines.append(
            {
                "description": extra.name,
                "quantity": extra.quantity,
                "unit_price": _money(extra.unit_price),
                "amount": _money(extra.amount),
            }
        )

    return lines


def _existing(db: Session, handover_id, kind: str) -> Invoice | None:
    return db.scalar(
        select(Invoice).where(Invoice.handover_id == handover_id, Invoice.kind == kind)
    )


def issue_invoice_for_handover(
    db: Session, handover: Handover, actor: User | None = None
) -> Invoice | None:
    """
    The invoice for a rental payment that has succeeded. Returns None if the
    payment has not succeeded (nothing to invoice yet). Never commits: it
    joins the caller's transaction, so the invoice exists if and only if the
    payment being recorded does.
    """

    if handover.payment_status != "SUCCEEDED" or handover.payment_amount is None:
        return None

    existing = _existing(db, handover.id, KIND_INVOICE)

    if existing is not None:
        return existing

    reservation = db.get(Reservation, handover.reservation_id)
    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)

    breakdown = calculate_price_breakdown(
        car.price_per_day,
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=configuration.short_term_fee,
        airport_change_fee=configuration.airport_change_fee,
        extras=selections_from_reservation(reservation),
        **vat_terms(configuration),
    )

    # The money actually collected is the authority for the totals, however
    # the lines were priced: it is what the customer paid. It is always the
    # gross amount, in both VAT modes.
    gross = round_money(Decimal(handover.payment_amount))
    rate = Decimal(configuration.vat_rate)
    vat = (
        round_money(gross * rate / (100 + rate)) if rate > 0 else Decimal("0.00")
    )

    try:
        # A savepoint, so that losing a race for the same payment undoes only
        # this attempt (including the counter increment) and leaves the
        # caller's transaction intact.
        with db.begin_nested():
            sequence = _next_sequence(db)
            invoice = Invoice(
                number=f"{configuration.invoice_prefix}-{sequence:06d}",
                sequence=sequence,
                kind=KIND_INVOICE,
                reservation_id=reservation.id,
                handover_id=handover.id,
                currency=handover.payment_currency or configuration.default_currency,
                lines=_lines(reservation, car, breakdown),
                prices_include_vat=configuration.prices_include_vat,
                vat_rate=rate,
                net_amount=gross - vat,
                vat_amount=vat,
                total_amount=gross,
                seller=_seller_snapshot(configuration),
                customer=_customer_snapshot(reservation.customer),
            )
            db.add(invoice)
            db.flush()
    except IntegrityError:
        existing = _existing(db, handover.id, KIND_INVOICE)

        if existing is not None:
            return existing

        raise

    audit_log(
        db,
        user=actor,
        action="invoice.issued",
        entity_type="invoice",
        entity_id=invoice.id,
        metadata={"number": invoice.number, "total": str(invoice.total_amount)},
    )

    return invoice


def issue_credit_note_for_handover(
    db: Session, handover: Handover, actor: User | None = None
) -> Invoice | None:
    """
    Reverses the invoice of a payment that has been refunded. Returns None
    when there is nothing to reverse: a payment taken before invoices
    existed has no invoice, and inventing one now would put a false date on
    a tax document. Never commits.
    """

    original = _existing(db, handover.id, KIND_INVOICE)

    if original is None:
        return None

    existing = _existing(db, handover.id, KIND_CREDIT_NOTE)

    if existing is not None:
        return existing

    try:
        with db.begin_nested():
            sequence = _next_sequence(db)
            note = Invoice(
                number=f"{CREDIT_NOTE_PREFIX}-{sequence:06d}",
                sequence=sequence,
                kind=KIND_CREDIT_NOTE,
                reservation_id=original.reservation_id,
                handover_id=handover.id,
                original_invoice_id=original.id,
                currency=original.currency,
                # The same lines, reversed. Copied from the invoice, not
                # recomputed, so the credit always matches what was billed.
                lines=[
                    {
                        **line,
                        "unit_price": line["unit_price"],
                        "amount": _money(-Decimal(line["amount"])),
                    }
                    for line in original.lines
                ],
                prices_include_vat=original.prices_include_vat,
                vat_rate=original.vat_rate,
                net_amount=-original.net_amount,
                vat_amount=-original.vat_amount,
                total_amount=-original.total_amount,
                seller=original.seller,
                customer=original.customer,
            )
            db.add(note)
            db.flush()
    except IntegrityError:
        existing = _existing(db, handover.id, KIND_CREDIT_NOTE)

        if existing is not None:
            return existing

        raise

    audit_log(
        db,
        user=actor,
        action="invoice.credit_note_issued",
        entity_type="invoice",
        entity_id=note.id,
        metadata={
            "number": note.number,
            "credits": original.number,
            "total": str(note.total_amount),
        },
    )

    return note


def list_invoices_for_reservation(db: Session, reservation_id) -> list[Invoice]:
    return list(
        db.scalars(
            select(Invoice)
            .where(Invoice.reservation_id == reservation_id)
            .order_by(Invoice.sequence)
        )
    )


def get_invoice(db: Session, invoice_id) -> Invoice | None:
    return db.get(Invoice, invoice_id)
