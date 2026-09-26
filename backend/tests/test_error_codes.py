import ast
import pathlib
import uuid

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.errors import AppError, NotFoundError
from app.main import app
from tests.conftest import _get_fake_user
from tests.test_reservations import ensure_car_available

client = TestClient(app)

APP_DIR = pathlib.Path(__file__).resolve().parent.parent / "app"


# --- the contract ------------------------------------------------------------------


def test_an_app_error_keeps_its_english_text_and_gains_a_code():
    response = client.get(f"/api/cars/{uuid.uuid4()}")

    assert response.status_code == 404
    body = response.json()
    assert body["detail"] == "Car not found."
    assert body["code"] == "car.not_found"
    assert body["params"] == {}


def test_not_found_errors_are_404_and_other_domain_errors_are_400():
    assert client.get(f"/api/reservations/{uuid.uuid4()}").status_code == 404
    assert client.get(f"/api/customers/{uuid.uuid4()}").status_code == 404
    assert client.get(f"/api/invoices/{uuid.uuid4()}/pdf").status_code == 404

    body = client.get(f"/api/reservations/{uuid.uuid4()}").json()
    assert body["code"] == "reservation.not_found"


def test_an_error_can_carry_values_for_the_translated_sentence():
    error = AppError("extra.max_quantity", "At most {max} x {name} can be added.", max=3, name="Baby seat")

    assert error.message == "At most 3 x Baby seat can be added."
    assert error.params == {"max": 3, "name": "Baby seat"}
    assert error.status_code == 400
    assert NotFoundError("x.not_found", "Not found.").status_code == 404


def test_params_are_always_json_safe():
    import datetime

    error = AppError("x.y", "message", when=datetime.date(2040, 1, 2), n=1)

    assert error.params == {"when": "2040-01-02", "n": 1}


def test_a_message_with_stray_braces_never_crashes_the_handler():
    error = AppError("x.y", "Contains {unfilled} braces.", other=1)

    assert error.message == "Contains {unfilled} braces."


# --- authentication ------------------------------------------------------------------


def test_missing_login_is_a_coded_401_with_the_bearer_header():
    app.dependency_overrides.pop(get_current_user, None)

    try:
        response = client.get("/api/cars")
    finally:
        app.dependency_overrides[get_current_user] = _get_fake_user

    assert response.status_code == 401
    assert response.json()["code"] == "auth.not_authenticated"
    assert response.json()["detail"] == "Not authenticated."
    assert response.headers["www-authenticate"] == "Bearer"


def test_wrong_password_is_a_coded_401():
    response = client.post(
        "/api/auth/login", json={"email": f"nobody-{uuid.uuid4()}@example.com", "password": "x"}
    )

    assert response.status_code == 401
    assert response.json()["code"] == "auth.invalid_credentials"


def test_lockout_is_a_coded_429_with_retry_after():
    from app.services import login_throttle

    login_throttle.reset()
    email = f"nobody-{uuid.uuid4()}@example.com"

    try:
        for _ in range(login_throttle.MAX_FAILURES_PER_IP):
            client.post("/api/auth/login", json={"email": email, "password": "x"})

        blocked = client.post("/api/auth/login", json={"email": email, "password": "x"})
    finally:
        login_throttle.reset()

    assert blocked.status_code == 429
    assert blocked.json()["code"] == "auth.too_many_attempts"
    assert blocked.headers["retry-after"] == "900"


def test_a_staff_member_forbidden_from_an_admin_route_gets_a_code():
    from tests.test_configuration import _as_staff, _restore_admin_override

    _as_staff()

    try:
        response = client.get("/api/configuration")
    finally:
        _restore_admin_override()

    assert response.status_code == 403
    assert response.json()["code"] == "auth.forbidden"


# --- validation -------------------------------------------------------------------------


def test_a_validation_error_keeps_fastapis_shape_and_adds_codes():
    response = client.patch("/api/configuration", json={"vat_rate": 250, "default_language": "de"})

    assert response.status_code == 422
    body = response.json()

    # The original shape is still there.
    assert isinstance(body["detail"], list)
    assert body["detail"][0]["loc"][0] == "body"

    assert body["code"] == "validation.failed"
    by_field = {e["field"]: e for e in body["errors"]}

    assert by_field["vat_rate"]["code"] == "validation.vat_rate_range"
    assert by_field["default_language"]["code"] == "validation.language_unsupported"
    assert by_field["default_language"]["params"] == {"allowed": "en, it, pl"}
    # The Pydantic prefix is not part of the sentence.
    assert not by_field["vat_rate"]["message"].startswith("Value error")


def test_pydantics_own_errors_are_coded_by_their_type():
    response = client.get("/api/reservations", params={"limit": 500})

    assert response.status_code == 422
    errors = response.json()["errors"]

    assert errors[0]["field"] == "limit"
    assert errors[0]["code"] == "less_than_equal"


def test_a_missing_field_is_coded():
    response = client.post("/api/locations", json={"name": "No code"})

    assert response.status_code == 422
    assert any(
        e["field"] == "airport_code" and e["code"] == "missing"
        for e in response.json()["errors"]
    )


def test_unknown_routes_still_get_a_code():
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json()["code"] == "http.404"


# --- errors that carry values ---------------------------------------------------------------


def test_retiring_a_location_in_use_reports_the_counts():
    olb = next(row for row in client.get("/api/locations").json() if row["airport_code"] == "OLB")

    response = client.patch(f"/api/locations/{olb['id']}", json={"is_active": False})

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "location.in_use"
    assert body["params"]["vehicles"] >= 1
    assert body["params"]["both"] in ("yes", "no")
    assert "still in use" in body["detail"]


def test_an_impossible_status_change_reports_both_statuses():
    from datetime import datetime, timedelta, timezone
    import random

    from tests.test_handovers import create_confirmed_reservation

    pickup = datetime.now(timezone.utc) + timedelta(days=random.randint(3000, 8000))
    reservation = create_confirmed_reservation(
        "SA-008-AA",
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    try:
        response = client.patch(
            f"/api/reservations/{reservation['id']}/status", json={"status": "COMPLETED"}
        )

        assert response.status_code == 400
        body = response.json()
        assert body["code"] == "reservation.cannot_change_status"
        assert body["params"] == {"from_status": "CONFIRMED", "to_status": "COMPLETED"}
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_an_unfinished_identity_check_explains_itself_with_a_code():
    from datetime import datetime, timedelta, timezone
    import random

    from tests.test_handovers import create_confirmed_reservation, _reset_identity_verification

    pickup = datetime.now(timezone.utc) + timedelta(days=random.randint(3000, 8000))
    reservation = create_confirmed_reservation(
        "SA-008-AA",
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    customer_id = reservation["customer_id"] if "customer_id" in reservation else None

    try:
        details = client.get(
            f"/api/customers/{customer_id or client.get(f'/api/reservations/{reservation['id']}').json()['customer']['id']}/identity-details"
        ).json()

        assert details["problem"]
        assert details["problem_code"].startswith(("identity.", "customer."))
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- the migration cannot regress ---------------------------------------------------------------


def _source_files():
    for path in sorted(APP_DIR.rglob("*.py")):
        yield path, ast.parse(path.read_text(encoding="utf-8"))


def test_no_user_facing_error_is_a_bare_value_error():
    """Everything a person can read came through AppError, so it has a code.
    A bare ValueError would reach the screen as untranslatable English."""

    offenders = []

    for path, tree in _source_files():
        for node in ast.walk(tree):
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
                if getattr(node.exc.func, "id", None) == "ValueError":
                    offenders.append(f"{path.relative_to(APP_DIR)}:{node.lineno}")

    assert offenders == []


def test_no_route_raises_a_plain_http_exception_with_text():
    offenders = []

    for path, tree in _source_files():
        for node in ast.walk(tree):
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
                func = node.exc.func

                if getattr(func, "id", None) == "HTTPException":
                    # Only ones built from an inner error's text are left, in
                    # the routers' legacy except blocks; none may carry a
                    # sentence of its own.
                    detail = next((k.value for k in node.exc.keywords if k.arg == "detail"), None)

                    if isinstance(detail, ast.Constant):
                        offenders.append(f"{path.relative_to(APP_DIR)}:{node.lineno}")

    assert offenders == []


def test_every_error_code_is_unique_to_one_sentence():
    """One code, one meaning: the catalog has one message per code."""

    seen: dict[str, str] = {}
    clashes = []

    for path, tree in _source_files():
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) in ("AppError", "NotFoundError"):
                if len(node.args) >= 2 and isinstance(node.args[0], ast.Constant) and isinstance(node.args[1], ast.Constant):
                    code, message = node.args[0].value, node.args[1].value

                    if code in seen and seen[code] != message and not code.startswith("date_range."):
                        clashes.append((code, seen[code], message))

                    seen.setdefault(code, message)

    assert clashes == []
