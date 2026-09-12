from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_get_locations():
    response = client.get("/api/locations")

    assert response.status_code == 200

    locations = response.json()

    assert len(locations) == 3

    airport_codes = {
        location["airport_code"]
        for location in locations
    }

    assert airport_codes == {
        "OLB",
        "CAG",
        "AHO",
    }