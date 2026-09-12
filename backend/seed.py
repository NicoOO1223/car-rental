import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import delete

from app.database import SessionLocal
from app.models import Car, Customer, Handover, Location, Reservation


def seed():
    db = SessionLocal()

    try:
        # Clear existing data. Handovers reference reservations via a
        # foreign key, so they must go first.
        db.execute(delete(Handover))
        db.execute(delete(Reservation))
        db.execute(delete(Car))
        db.execute(delete(Customer))
        db.execute(delete(Location))

        # ---------------------------------------------------------
        # LOCATIONS
        # ---------------------------------------------------------

        olbia = Location(
            id=uuid.uuid4(),
            name="Olbia Costa Smeralda Airport",
            airport_code="OLB",
            address="Via degli Astronauti, 07026 Olbia SS, Italy",
        )

        cagliari = Location(
            id=uuid.uuid4(),
            name="Cagliari Elmas Airport",
            airport_code="CAG",
            address="Viale Elmas, 09030 Elmas CA, Italy",
        )

        alghero = Location(
            id=uuid.uuid4(),
            name="Alghero Fertilia Airport",
            airport_code="AHO",
            address="Regione Nuraghe Biancu, 07041 Alghero SS, Italy",
        )

        db.add_all([olbia, cagliari, alghero])
        db.flush()

        # ---------------------------------------------------------
        # CARS
        # ---------------------------------------------------------

        cars = [
            Car(
                make="Fiat",
                model="500",
                year=2024,
                license_plate="SA-001-AA",
                category="ECONOMY",
                transmission="MANUAL",
                fuel_type="PETROL",
                seats=4,
                price_per_day=Decimal("45.00"),
                current_location_id=olbia.id,
                status="AVAILABLE",
            ),
            Car(
                make="Fiat",
                model="500",
                year=2024,
                license_plate="SA-002-AA",
                category="ECONOMY",
                transmission="AUTOMATIC",
                fuel_type="HYBRID",
                seats=4,
                price_per_day=Decimal("55.00"),
                current_location_id=olbia.id,
                status="AVAILABLE",
            ),
            Car(
                make="Peugeot",
                model="208",
                year=2023,
                license_plate="SA-003-AA",
                category="ECONOMY",
                transmission="MANUAL",
                fuel_type="PETROL",
                seats=5,
                price_per_day=Decimal("50.00"),
                current_location_id=olbia.id,
                status="AVAILABLE",
            ),
            Car(
                make="Volkswagen",
                model="Golf",
                year=2024,
                license_plate="SA-004-AA",
                category="COMPACT",
                transmission="AUTOMATIC",
                fuel_type="PETROL",
                seats=5,
                price_per_day=Decimal("70.00"),
                current_location_id=cagliari.id,
                status="AVAILABLE",
            ),
            Car(
                make="Toyota",
                model="Yaris",
                year=2024,
                license_plate="SA-005-AA",
                category="ECONOMY",
                transmission="AUTOMATIC",
                fuel_type="HYBRID",
                seats=5,
                price_per_day=Decimal("60.00"),
                current_location_id=cagliari.id,
                status="AVAILABLE",
            ),
            Car(
                make="Renault",
                model="Clio",
                year=2023,
                license_plate="SA-006-AA",
                category="ECONOMY",
                transmission="MANUAL",
                fuel_type="PETROL",
                seats=5,
                price_per_day=Decimal("48.00"),
                current_location_id=cagliari.id,
                status="RENTED",
            ),
            Car(
                make="BMW",
                model="1 Series",
                year=2024,
                license_plate="SA-007-AA",
                category="PREMIUM",
                transmission="AUTOMATIC",
                fuel_type="PETROL",
                seats=5,
                price_per_day=Decimal("90.00"),
                current_location_id=alghero.id,
                status="AVAILABLE",
            ),
            Car(
                make="Fiat",
                model="Panda",
                year=2024,
                license_plate="SA-008-AA",
                category="ECONOMY",
                transmission="MANUAL",
                fuel_type="PETROL",
                seats=5,
                price_per_day=Decimal("42.00"),
                current_location_id=alghero.id,
                status="AVAILABLE",
            ),
            Car(
                make="Jeep",
                model="Renegade",
                year=2023,
                license_plate="SA-009-AA",
                category="SUV",
                transmission="AUTOMATIC",
                fuel_type="PETROL",
                seats=5,
                price_per_day=Decimal("85.00"),
                current_location_id=alghero.id,
                status="CLEANING",
            ),
            Car(
                make="Peugeot",
                model="3008",
                year=2024,
                license_plate="SA-010-AA",
                category="SUV",
                transmission="AUTOMATIC",
                fuel_type="HYBRID",
                seats=5,
                price_per_day=Decimal("95.00"),
                current_location_id=olbia.id,
                status="MAINTENANCE",
            ),
        ]

        db.add_all(cars)
        db.flush()

        # ---------------------------------------------------------
        # CUSTOMERS
        # ---------------------------------------------------------

        customers = [
            Customer(
                first_name="Marco",
                last_name="Rossi",
                date_of_birth=date(1988, 4, 12),
                address="Via Roma 15",
                postal_code="20121",
            ),
            Customer(
                first_name="Anna",
                last_name="Bianchi",
                date_of_birth=date(1992, 7, 23),
                address="Via Milano 42",
                postal_code="20100",
            ),
            Customer(
                first_name="Lukas",
                last_name="Schmidt",
                date_of_birth=date(1985, 11, 3),
                address="Hauptstrasse 18",
                postal_code="10115",
            ),
            Customer(
                first_name="Sophie",
                last_name="Martin",
                date_of_birth=date(1995, 2, 17),
                address="Rue de Paris 21",
                postal_code="75001",
            ),
            Customer(
                first_name="James",
                last_name="Wilson",
                date_of_birth=date(1987, 9, 30),
                address="Baker Street 10",
                postal_code="NW1 6XE",
            ),
        ]

        db.add_all(customers)
        db.flush()

        # ---------------------------------------------------------
        # RESERVATIONS
        # ---------------------------------------------------------

        reservations = [
            # Completed historical reservation
            Reservation(
                customer_id=customers[0].id,
                car_id=cars[0].id,
                pickup_location_id=olbia.id,
                return_location_id=olbia.id,
                pickup_at=datetime(
                    2026, 8, 1, 10, 0, tzinfo=timezone.utc
                ),
                return_at=datetime(
                    2026, 8, 5, 10, 0, tzinfo=timezone.utc
                ),
                status="COMPLETED",
            ),

            # Current/active reservation
            Reservation(
                customer_id=customers[1].id,
                car_id=cars[1].id,
                pickup_location_id=olbia.id,
                return_location_id=olbia.id,
                pickup_at=datetime(
                    2026, 8, 20, 10, 0, tzinfo=timezone.utc
                ),
                return_at=datetime(
                    2026, 8, 25, 10, 0, tzinfo=timezone.utc
                ),
                status="ACTIVE",
            ),

            # Future reservation
            Reservation(
                customer_id=customers[2].id,
                car_id=cars[2].id,
                pickup_location_id=olbia.id,
                return_location_id=olbia.id,
                pickup_at=datetime(
                    2026, 8, 27, 10, 0, tzinfo=timezone.utc
                ),
                return_at=datetime(
                    2026, 8, 31, 10, 0, tzinfo=timezone.utc
                ),
                status="CONFIRMED",
            ),

            # Future reservation at Cagliari
            Reservation(
                customer_id=customers[3].id,
                car_id=cars[3].id,
                pickup_location_id=cagliari.id,
                return_location_id=cagliari.id,
                pickup_at=datetime(
                    2026, 8, 25, 12, 0, tzinfo=timezone.utc
                ),
                return_at=datetime(
                    2026, 8, 29, 12, 0, tzinfo=timezone.utc
                ),
                status="CONFIRMED",
            ),

            # Another future reservation
            Reservation(
                customer_id=customers[4].id,
                car_id=cars[6].id,
                pickup_location_id=alghero.id,
                return_location_id=alghero.id,
                pickup_at=datetime(
                    2026, 8, 24, 9, 0, tzinfo=timezone.utc
                ),
                return_at=datetime(
                    2026, 8, 28, 9, 0, tzinfo=timezone.utc
                ),
                status="CONFIRMED",
            ),

            # Cancelled reservation — should NOT block availability
            Reservation(
                customer_id=customers[0].id,
                car_id=cars[2].id,
                pickup_location_id=olbia.id,
                return_location_id=olbia.id,
                pickup_at=datetime(
                    2026, 8, 22, 10, 0, tzinfo=timezone.utc
                ),
                return_at=datetime(
                    2026, 8, 24, 10, 0, tzinfo=timezone.utc
                ),
                status="CANCELLED",
            ),
        ]

        db.add_all(reservations)

        db.commit()

        print("Database seeded successfully.")
        print("Locations: 3")
        print("Cars: 10")
        print("Customers: 5")
        print("Reservations: 6")

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    seed()