"""
Who may call what, checked against the real route table.

Every staff route is called as each of the four roles. The expectations below are
written out by hand (not read from app/permissions.py), so a mistake in the
permission map shows up as a failing test instead of being confirmed by itself.

Denied is a 403. Allowed means the request got past the access check: it then
fails or succeeds on its own terms (a made-up id is a 404, a missing body a 422),
which is all this test needs. Nothing is written: every id is made up and no
body is sent.
"""

import re
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, User

# raise_server_exceptions=False: a route that gets past the access check and then
# trips over the made-up user or id is still "allowed" for this test's purposes.
client = TestClient(app, raise_server_exceptions=False)

ROLES = ("admin", "manager", "staff", "readonly")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _staff_routes() -> list[tuple[str, str]]:
    routes = []

    for path, item in app.openapi()["paths"].items():
        # The public site and the payment webhook have their own rules (and tests).
        if path.startswith(("/api/public", "/api/stripe")):
            continue

        for method, operation in item.items():
            if method.upper() in {"GET", *WRITE_METHODS} and "security" in operation:
                routes.append((method.upper(), path))

    return sorted(routes, key=lambda route: (route[1], route[0]))


ROUTES = _staff_routes()


def _requirement(method: str, path: str) -> str | None:
    """What a route needs beyond being signed in, by hand. None = any role that can write (or read)."""

    if path.startswith(("/api/users", "/api/configuration", "/api/email")):
        return "admin"

    if path.startswith("/api/locations") and method != "GET":
        return "admin"

    if re.fullmatch(r"/api/customers/\{[^/]+\}/(erase|export)", path):
        return "admin"

    if path.startswith(("/api/admin/cars", "/api/admin/extras", "/api/admin/vehicle-classes")):
        return "fleet"

    if path.startswith("/api/audit-logs") or path == "/api/dashboard/revenue":
        return "reports"

    if re.fullmatch(r"/api/reservations/\{[^/]+\}/(check-out/(waive|settle-deposit)|final-total)", path):
        return "money"

    if re.fullmatch(r"/api/customers/\{[^/]+\}/identity-details", path):
        return "identity"

    return None


# Which of those each role may use. "write" is any change; reads are open to all.
ALLOWED = {
    "admin": {"write", "admin", "fleet", "reports", "money", "identity"},
    "manager": {"write", "fleet", "reports", "money", "identity"},
    "staff": {"write", "identity"},
    "readonly": set(),
}


def _expected_allowed(role: str, method: str, path: str) -> bool:
    # The user's own session and language settings are open to every role, and
    # so is the small slice of Configuration the counter screens read.
    if path.startswith("/api/auth") or (method == "GET" and path == "/api/configuration/public"):
        return True

    requirement = _requirement(method, path)
    granted = ALLOWED[role]

    if requirement is not None and requirement not in granted:
        return False

    if method in WRITE_METHODS and "write" not in granted:
        return False

    return True


# The suite-wide signed-in user from conftest.py, so a test can go back to it to clean up.
_SUITE_USER: dict = {}


def _back_to_the_suites_user():
    app.dependency_overrides[get_current_user] = _SUITE_USER["override"]


def _as(role: str):
    user = User(
        id=uuid4(),
        email=f"{role}@example.com",
        hashed_password="x",
        role=role,
        is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: user


@pytest.fixture(autouse=True)
def _restore_the_suites_user():
    """Every test here signs in as a made-up user of some role; the suite-wide
    override from conftest.py (a real admin) comes back afterwards."""

    original = app.dependency_overrides.get(get_current_user)
    _SUITE_USER["override"] = original

    yield

    if original is not None:
        app.dependency_overrides[get_current_user] = original
    else:
        app.dependency_overrides.pop(get_current_user, None)


def _call(method: str, path: str):
    url = re.sub(r"\{[^/]+\}", lambda _: str(uuid4()), path)

    return client.request(method, url)


def test_the_route_table_is_what_this_test_thinks_it_is():
    # A guard against the enumeration quietly finding nothing.
    assert len(ROUTES) > 80
    assert ("PATCH", "/api/reservations/{reservation_id}/cancel") in ROUTES
    assert ("POST", "/api/reservations/{reservation_id}/check-out/waive") in ROUTES or any(
        path.endswith("/waive") for _, path in ROUTES
    )


@pytest.mark.parametrize("role", ROLES)
def test_every_staff_route_allows_and_refuses_exactly_what_the_matrix_says(role):
    _as(role)
    wrong = []

    for method, path in ROUTES:
        response = _call(method, path)
        allowed = response.status_code not in (401, 403)

        if allowed != _expected_allowed(role, method, path):
            wrong.append(f"{role} {method} {path} -> {response.status_code}, expected {'allowed' if not allowed else 'denied'}")

    assert not wrong, "\n".join(wrong)


def test_read_only_is_refused_with_its_own_message_on_a_change_and_may_read():
    _as("readonly")

    change = client.patch(f"/api/reservations/{uuid4()}/cancel")

    assert change.status_code == 403
    assert change.json()["code"] == "auth.read_only"
    assert client.get("/api/cars").status_code == 200


def test_a_route_added_later_is_read_only_safe_without_anyone_remembering():
    # Every staff route is protected through the one shared dependency, so the
    # number of routes that bypass it is exactly the set listed here.
    unprotected = [
        (method, path)
        for method, path in ROUTES
        if method in WRITE_METHODS and not path.startswith("/api/auth")
    ]

    _as("readonly")

    assert unprotected
    assert all(_call(method, path).status_code == 403 for method, path in unprotected)


# --- the approval actions ------------------------------------------------------------------


def test_only_a_manager_or_admin_decides_what_happens_to_an_online_payment_on_cancel():
    for role, allowed in (("staff", False), ("manager", True), ("admin", True)):
        _as(role)
        response = client.patch(f"/api/reservations/{uuid4()}/cancel", json={"refund_prepayment": False})

        if allowed:
            assert response.status_code == 404, role
        else:
            assert response.status_code == 403, role
            assert response.json()["code"] == "auth.needs_manager"

    # Without a decision the admin's cancellation policy applies, which counter
    # staff may trigger.
    _as("staff")
    assert client.patch(f"/api/reservations/{uuid4()}/cancel").status_code == 404
    assert client.patch(f"/api/reservations/{uuid4()}/cancel", json={}).status_code == 404


# --- customer data -------------------------------------------------------------------------


def test_the_customer_list_masks_contact_details_for_staff_and_read_only_only():
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Customer
    from tests.test_reservations import create_reservation, ensure_car_available, get_location_id

    # Made with the suite's own user: a made-up one cannot be a booking's creator.
    reservation = create_reservation(
        ensure_car_available("SA-008-AA")["id"],
        get_location_id("AHO"),
        "2029-03-01T10:00:00Z",
        "2029-03-03T10:00:00Z",
    )

    db = SessionLocal()
    try:
        customer = db.get(Customer, __import__("uuid").UUID(reservation["customer_id"]))
        full_email, full_phone = customer.email, customer.phone_number
    finally:
        db.close()

    # Opening a customer is audited against the signed-in user, so these are real.
    users = {}
    db = SessionLocal()
    try:
        for role in ROLES:
            user = User(email=f"roles-{role}-{uuid4()}@example.com", hashed_password="x", role=role, is_active=True)
            db.add(user)
            users[role] = user
        db.commit()
        for user in users.values():
            db.refresh(user)
            db.expunge(user)
    finally:
        db.close()

    def as_real(role):
        app.dependency_overrides[get_current_user] = lambda: users[role]

    def listed(role):
        as_real(role)
        items = client.get("/api/customers", params={"limit": 100}).json()["items"]

        return next(item for item in items if item["id"] == reservation["customer_id"])

    try:
        for role in ("admin", "manager"):
            item = listed(role)
            assert item["masked"] is False
            assert item["email"] == full_email
            assert item["phone_number"] == full_phone
            assert item["address"] and item["date_of_birth"]

        for role in ("staff", "readonly"):
            item = listed(role)
            assert item["masked"] is True
            assert item["email"] != full_email and "@" in item["email"] and item["email"].startswith(full_email[0])
            assert item["phone_number"] != full_phone and item["phone_number"].endswith(full_phone[-3:])
            assert item["address"] is None
            assert item["date_of_birth"] is None
            # Enough left to tell customers apart.
            assert item["first_name"] and item["last_name"] and item["postal_code"]

        # Opening one customer shows everything, to anyone who may look.
        for role in ROLES:
            as_real(role)
            opened = client.get(f"/api/customers/{reservation['customer_id']}")
            assert opened.status_code == 200, role
            assert opened.json()["email"] == full_email
    finally:
        _back_to_the_suites_user()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

        db = SessionLocal()
        try:
            for user in users.values():
                for entry in db.scalars(select(AuditLog).where(AuditLog.user_id == user.id)):
                    db.delete(entry)
                stored = db.get(User, user.id)
                if stored is not None:
                    db.delete(stored)
            db.commit()
        finally:
            db.close()


def test_masking_helpers():
    from app.services.masking import MASK, mask_email, mask_phone

    assert mask_phone("+39 333 123 4567") == f"{MASK} 567"
    assert mask_phone("123") == MASK
    assert mask_phone(None) is None
    assert mask_email("giulia.rossi@example.com") == f"g{MASK}@example.com"
    assert mask_email("nonsense") == MASK
    assert mask_email(None) is None


# --- looking must not write ----------------------------------------------------------------


def test_opening_a_handover_starts_one_for_staff_but_not_for_an_account_that_can_only_look():
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Handover
    from tests.test_handovers import create_confirmed_reservation

    reservation = create_confirmed_reservation("SA-008-AA", "2029-05-01T10:00:00Z", "2029-05-03T10:00:00Z")

    # The handover row records who started it, so these users are real.
    db = SessionLocal()
    users = {}
    try:
        for role in ("staff", "readonly"):
            user = User(email=f"roles-view-{role}-{uuid4()}@example.com", hashed_password="x", role=role, is_active=True)
            db.add(user)
            users[role] = user
        db.commit()
        for user in users.values():
            db.refresh(user)
            db.expunge(user)
    finally:
        db.close()

    def as_real(role):
        app.dependency_overrides[get_current_user] = lambda: users[role]

    def handover_rows():
        db = SessionLocal()
        try:
            return len(list(db.scalars(select(Handover).where(Handover.reservation_id == UUID(reservation["id"])))))
        finally:
            db.close()

    try:
        as_real("readonly")
        looked = client.get(f"/api/reservations/{reservation['id']}/handover")

        assert looked.status_code == 404
        assert looked.json()["code"] == "handover.not_started"
        assert handover_rows() == 0

        as_real("staff")
        assert client.get(f"/api/reservations/{reservation['id']}/handover").status_code == 200
        assert handover_rows() == 1

        # Once it exists, an account that can only look may read it.
        as_real("readonly")
        assert client.get(f"/api/reservations/{reservation['id']}/handover").status_code == 200
    finally:
        _back_to_the_suites_user()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

        db = SessionLocal()
        try:
            for handover in db.scalars(select(Handover).where(Handover.reservation_id == UUID(reservation["id"]))):
                handover.created_by = None
                handover.updated_by = None
            db.flush()
            for user in users.values():
                for entry in db.scalars(select(AuditLog).where(AuditLog.user_id == user.id)):
                    db.delete(entry)
                stored = db.get(User, user.id)
                if stored is not None:
                    db.delete(stored)
            db.commit()
        finally:
            db.close()
