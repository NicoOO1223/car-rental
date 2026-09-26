from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_responses_carry_baseline_security_headers():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cache-control"] == "no-store"


def test_cors_preflight_allows_only_the_needed_methods_and_headers():
    response = client.options(
        "/api/cars",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert "PATCH" in response.headers["access-control-allow-methods"]
    assert "access-control-allow-credentials" not in response.headers
    # The security headers also cover preflight responses.
    assert response.headers["x-content-type-options"] == "nosniff"


def test_cors_preflight_rejects_unexpected_methods():
    response = client.options(
        "/api/cars",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "TRACE",
        },
    )

    assert response.status_code == 400


def test_health_does_not_need_the_database_but_ready_does(monkeypatch):
    assert client.get("/health").status_code == 200

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json() == {"status": "ok"}

    class BrokenSession:
        def __enter__(self):
            raise RuntimeError("database unreachable")

        def __exit__(self, *args):
            return False

    import app.main as main_module

    monkeypatch.setattr(main_module, "SessionLocal", lambda: BrokenSession())

    assert client.get("/health").status_code == 200
    down = client.get("/ready")
    assert down.status_code == 503
    assert down.json() == {"status": "unavailable"}
