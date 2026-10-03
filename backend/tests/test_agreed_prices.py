"""
What a booking costs is fixed when it is made. A later change to the car's
daily rate must not change the invoice, the total shown in the dashboard or the
revenue earned from it.
"""

from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Car, Invoice, Reservation
from app.services.booking_prices import agreed_price_breakdown, agreed_price_per_day
from app.services.configuration import get_configuration
from tests.test_handovers import create_confirmed_reservation
from tests.test_reservations import get_car_by_plate

client = TestClient(app)

PLATE = "SA-008-AA"


def _set_rate(car_id: str, rate: str) -> None:
    response = client.patch(f"/api/admin/cars/{car_id}/price", json={"price_per_day": rate})
    assert response.status_code == 200


def test_an_invoice_keeps_the_rate_the_booking_was_made_at():
    car = get_car_by_plate(PLATE)
    original = Decimal(car["price_per_day"])
    reservation = create_confirmed_reservation(PLATE, "2027-10-05T10:00:00Z", "2027-10-07T10:00:00Z")

    try:
        # The rate goes up after the booking and before the money is taken.
        _set_rate(car["id"], str(original + 10))

        assert client.post(
            f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
        ).status_code == 200

        db = SessionLocal()
        try:
            invoice = db.scalar(
                select(Invoice).where(
                    Invoice.reservation_id == UUID(reservation["id"]), Invoice.kind == "INVOICE"
                )
            )
            rental = invoice.lines[0]

            assert Decimal(rental["unit_price"]) == original
            assert rental["quantity"] == 2
            assert Decimal(rental["amount"]) == original * 2
        finally:
            db.close()
    finally:
        _set_rate(car["id"], str(original))
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_agreed_breakdown_ignores_a_changed_rate_but_old_bookings_use_the_live_one():
    car = get_car_by_plate(PLATE)
    original = Decimal(car["price_per_day"])
    reservation = create_confirmed_reservation(PLATE, "2027-10-09T10:00:00Z", "2027-10-11T10:00:00Z")

    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation["id"]))
        live_car = db.get(Car, row.car_id)
        configuration = get_configuration(db)

        before = agreed_price_breakdown(row, live_car, configuration).base_amount

        live_car.price_per_day = original + 10
        assert agreed_price_per_day(row, live_car) == original
        assert agreed_price_breakdown(row, live_car, configuration).base_amount == before == original * 2

        # A booking from before prices were recorded has nothing agreed.
        row.agreed_price_per_day = None
        assert agreed_price_per_day(row, live_car) == original + 10
    finally:
        db.rollback()
        db.close()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")
