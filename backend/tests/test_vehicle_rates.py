from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, User
from tests.test_reservations import get_car_by_plate

client = TestClient(app)

PLATE = "SA-005-AA"


def _rate_audit_rows(car_id: str):
    db = SessionLocal()

    try:
        return (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "car",
                AuditLog.entity_id == UUID(car_id),
                AuditLog.action == "car.price_updated",
            )
            .order_by(AuditLog.created_at)
            .all()
        )
    finally:
        db.close()


def test_admin_can_change_a_daily_rate_and_it_is_audited():
    car = get_car_by_plate(PLATE)
    original = car["price_per_day"]
    before = len(_rate_audit_rows(car["id"]))

    try:
        response = client.patch(
            f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "77.50"}
        )

        assert response.status_code == 200
        assert response.json()["price_per_day"] == "77.50"

        rows = _rate_audit_rows(car["id"])
        assert len(rows) == before + 1
        assert rows[-1].details == {
            "license_plate": PLATE,
            "old": original,
            "new": "77.50",
        }

        # Unchanged value: no audit row.
        client.patch(
            f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "77.50"}
        )
        assert len(_rate_audit_rows(car["id"])) == before + 1
    finally:
        client.patch(
            f"/api/admin/cars/{car['id']}/price", json={"price_per_day": original}
        )


def test_rate_validation_and_unknown_car():
    car = get_car_by_plate(PLATE)

    assert (
        client.patch(
            f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "-1"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/admin/cars/{uuid4()}/price", json={"price_per_day": "10"}
        ).status_code
        == 404
    )


def test_staff_cannot_change_a_rate():
    car = get_car_by_plate(PLATE)
    app.dependency_overrides[get_current_user] = lambda: User(
        id=UUID("00000000-0000-0000-0000-000000000000"),
        email="test-suite@example.com",
        hashed_password="unused",
        role="staff",
        is_active=True,
    )

    try:
        response = client.patch(
            f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "1.00"}
        )

        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_general_car_edit_no_longer_accepts_a_rate():
    car = get_car_by_plate(PLATE)

    response = client.patch(
        f"/api/cars/{car['id']}", json={"price_per_day": "1.00"}
    )

    assert response.status_code == 422
    assert get_car_by_plate(PLATE)["price_per_day"] == car["price_per_day"]
