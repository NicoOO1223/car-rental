"""
A fictional rental business ("Isola Rent") for the marketing site's screenshots.

Nothing in it is real: invented people, example.com addresses, invented plates,
illustrated vehicles. It is built through the SERVICE LAYER (so invoices are
numbered without gaps, handovers carry real agreement PDFs, class bookings hold
provisional cars) and the timestamps are then moved into the past, because the
services stamp "now" and history has to look like history.

It is NOT seed.py and never touches it. It refuses to run unless:
  - ENVIRONMENT is not "production", and
  - the database name ends in "_marketing_demo", and
  - the database has no users yet (a fresh, migrated database).

Usage, from backend/, with a fresh database (see marketing/scripts/demo-stack.ps1):

    DATABASE_URL=postgresql+psycopg://.../car_rental_marketing_demo SECRET_KEY=... \\
        python seed_marketing_demo.py [--anchor YYYY-MM-DD] [--manifest PATH]

Dates are relative to now (or to --anchor). The backend's own "today" is always
the real date, so take the screenshots on the day you seed.

The manifest it writes (default ../marketing/scripts/demo-manifest.json) holds the
demo login, the ids of the reservations the capture script opens, and every
invented value, which the capture script uses as a "no real data" cross-check.
"""

import argparse
import base64
import io
import json
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from sqlalchemy.engine import make_url

DEMO_DATABASE_SUFFIX = "_marketing_demo"
ADMIN_EMAIL = "demo.admin@example.com"
PASSWORD = "demo-password-1"  # local, throwaway stack only
ASSETS = Path(__file__).resolve().parent.parent / "marketing" / "scripts" / "demo-assets"
DEFAULT_MANIFEST = Path(__file__).resolve().parent.parent / "marketing" / "scripts" / "demo-manifest.json"
BUSINESS_TZ = "Europe/Rome"
HISTORY_DAYS = 84


def refuse_unless_safe() -> None:
    """Checked before the app is imported, so nothing is even connected on a refusal."""

    if os.getenv("ENVIRONMENT", "").strip().lower() == "production":
        sys.exit("Refusing to run: ENVIRONMENT=production.")

    url = os.getenv("DATABASE_URL", "")

    if not url:
        sys.exit("Refusing to run: DATABASE_URL is not set.")

    name = make_url(url).database or ""

    if not name.endswith(DEMO_DATABASE_SUFFIX):
        sys.exit(
            f"Refusing to run: the database is named {name!r}; it must end in {DEMO_DATABASE_SUFFIX!r} "
            "so this can never be pointed at a real database by accident."
        )

    if not os.getenv("SECRET_KEY"):
        sys.exit("Refusing to run: SECRET_KEY is not set (any throwaway value will do).")


# ---------------------------------------------------------------- invented data

FIRST_NAMES = [
    "Marco", "Giulia", "Luca", "Sara", "Paolo", "Elena", "Matteo", "Chiara", "Andrea", "Francesca",
    "Hans", "Greta", "Lukas", "Anna", "Felix", "Marie", "Oliver", "Emily", "Harry", "Sophie",
    "Pierre", "Camille", "Louis", "Manon", "Daan", "Sanne", "Joost", "Lotte", "Pablo", "Lucia",
    "Diego", "Carmen", "Noah", "Lea", "Jonas", "Mia", "Tom", "Alice", "Ben", "Nina",
]
LAST_NAMES = [
    "Esposito", "Ferrante", "Gallo", "Marino", "Greco", "Bruno", "Conti", "Costa", "Giordano", "Mancini",
    "Becker", "Hartmann", "Keller", "Lindner", "Vogel", "Wagner", "Baker", "Carter", "Dawson", "Ellis",
    "Fournier", "Girard", "Lambert", "Roux", "de Vries", "Bakker", "Visser", "Smit", "Navarro", "Ortega",
    "Ramos", "Vidal", "Meier", "Brunner", "Frei", "Huber", "Fischer", "Kramer", "Lang", "Moser",
]
# nationality, street, city, postal code, driving-licence country
ORIGINS = [
    ("IT", "Via Esempio", "Milano", "20100"),
    ("IT", "Via Esempio", "Roma", "00100"),
    ("DE", "Beispielweg", "Munchen", "80331"),
    ("GB", "Example Road", "Leeds", "LS1 1AA"),
    ("FR", "Rue de l'Exemple", "Lyon", "69001"),
    ("NL", "Voorbeeldstraat", "Utrecht", "3511 AA"),
    ("ES", "Calle Ejemplo", "Valencia", "46001"),
    ("CH", "Beispielgasse", "Zurich", "8001"),
]

LOCATIONS = [
    ("Olbia Airport", "OLB", "Aeroporto Costa Smeralda, 07026 Olbia SS"),
    ("Cagliari Elmas Airport", "CAG", "Aeroporto di Cagliari-Elmas, 09030 Elmas CA"),
    ("Alghero Fertilia Airport", "AHO", "Aeroporto di Alghero-Fertilia, 07041 Alghero SS"),
]

# name, description, price/day, picture, [(make, model, year, category, transmission, fuel, seats, colour picture)]
CLASSES = [
    (
        "Mini", "Fiat Panda or similar. Four seats, easy to park.", "39.00", "class-mini",
        [
            ("Fiat", "Panda", 2023, "ECONOMY", "MANUAL", "PETROL", 4, "car-mini-red"),
            ("Fiat", "Panda", 2023, "ECONOMY", "MANUAL", "PETROL", 4, "car-mini-white"),
            ("Fiat", "Panda", 2024, "ECONOMY", "MANUAL", "HYBRID", 4, "car-mini-yellow"),
            ("Toyota", "Aygo X", 2024, "ECONOMY", "MANUAL", "PETROL", 4, "car-mini-green"),
        ],
    ),
    (
        "Compact", "Volkswagen Golf or similar. Room for four and their luggage.", "49.00", "class-compact",
        [
            ("Volkswagen", "Golf", 2023, "COMPACT", "MANUAL", "DIESEL", 5, "car-compact-blue"),
            ("Volkswagen", "Golf", 2024, "COMPACT", "AUTOMATIC", "PETROL", 5, "car-compact-silver"),
            ("Peugeot", "308", 2023, "COMPACT", "MANUAL", "DIESEL", 5, "car-compact-black"),
        ],
    ),
    (
        "SUV", "Jeep Renegade or similar. Higher seating for coastal roads.", "69.00", "class-suv",
        [
            ("Jeep", "Renegade", 2023, "SUV", "AUTOMATIC", "PETROL", 5, "car-suv-grey"),
            ("Ford", "Puma", 2024, "SUV", "MANUAL", "HYBRID", 5, "car-suv-orange"),
        ],
    ),
    (
        "Van 9 seats", "Ford Transit or similar. Nine seats for groups.", "89.00", "class-van",
        [("Ford", "Transit", 2022, "VAN", "MANUAL", "DIESEL", 9, "car-van-white")],
    ),
]


def data_url(path: Path) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def png_data_url(image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def signature_png(rng: random.Random) -> str:
    """A scribble that reads as a signature: a few smooth strokes, black on white."""

    from PIL import Image, ImageDraw

    image = Image.new("RGB", (360, 120), "white")
    draw = ImageDraw.Draw(image)
    x, y = 20, rng.randint(55, 80)
    points = [(x, y)]

    for _ in range(rng.randint(7, 11)):
        x += rng.randint(22, 38)
        y = max(25, min(100, y + rng.randint(-38, 38)))
        points.append((min(x, 340), y))

    draw.line(points, fill="#111827", width=3, joint="curve")
    draw.line([(30, 100), (min(x, 330), 100 + rng.randint(-8, 4))], fill="#111827", width=2)

    return png_data_url(image)


def logo_png() -> str:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (512, 512), "#0a0a0a")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((60, 60, 452, 452), radius=90, outline="#c6f432", width=14)

    try:
        font = ImageFont.load_default(size=200)
    except TypeError:  # an older Pillow without sized default fonts
        font = ImageFont.load_default()

    draw.text((256, 256), "IR", fill="#ffffff", font=font, anchor="mm")

    return png_data_url(image)


# ---------------------------------------------------------------------- the build


class Builder:
    def __init__(self, db, rng, now: datetime):
        from zoneinfo import ZoneInfo as Zone

        self.db = db
        self.rng = rng
        self.now = now
        self.zone = Zone(BUSINESS_TZ)
        self.people: list[dict] = []
        self.used_pairs: set[tuple[str, str]] = set()
        self.sequence = 0
        self.values: dict[str, list[str]] = {"names": [], "emails": [], "plates": []}
        self.audit_fix_from = now

    # ---- small helpers

    def local(self, day: datetime, hour: int, minute: int = 0) -> datetime:
        """`hour` o'clock in the business's timezone on the local date of `day`, as UTC."""

        local_day = day.astimezone(self.zone).date()

        return datetime(local_day.year, local_day.month, local_day.day, hour, minute, tzinfo=self.zone).astimezone(timezone.utc)

    def new_person(self, reuse: bool = True) -> dict:
        rng = self.rng

        if reuse and self.people and rng.random() < 0.12:
            return rng.choice(self.people)

        while True:
            first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)

            if (first, last) not in self.used_pairs:
                break

        self.used_pairs.add((first, last))
        self.sequence += 1
        n = self.sequence
        nationality, street, city, postal = rng.choice(ORIGINS)
        born = date(rng.randint(1958, 2001), rng.randint(1, 12), rng.randint(1, 28))
        slug = f"{first}.{last}".lower().replace(" ", "").replace("'", "")
        person = {
            "first_name": first,
            "last_name": last,
            "date_of_birth": born,
            "address": f"{street} {rng.randint(1, 99)}, {city}",
            "postal_code": postal,
            "phone_number": f"+39 000 000 {n:04d}",
            "email": f"{slug}{n}@example.com",
            "nationality": nationality,
            "n": n,
        }
        self.people.append(person)
        self.values["names"].append(f"{first} {last}")
        self.values["emails"].append(person["email"])

        return person

    def customer_data(self, person: dict):
        from app.schemas.reservation import CustomerCreate

        return CustomerCreate(**{k: v for k, v in person.items() if k != "n"})

    def identity(self, customer_id, person: dict, actor, reservation_id):
        from app.schemas.customer import IdentityDetailsUpdate
        from app.services.identity_details import save_identity_details

        n = person["n"]
        save_identity_details(
            self.db,
            customer_id,
            IdentityDetailsUpdate(
                id_document_type="PASSPORT" if person["nationality"] in ("GB", "CH") else "ID_CARD",
                id_document_number=f"DEMO{n:07d}",
                id_document_expires_at=date(2032, 3, 1),
                driving_license_number=f"DL{n:08d}",
                driving_license_country=person["nationality"],
                driving_license_categories="B",
                driving_license_issued_at=date(2014, 5, 1),
                driving_license_expires_at=date(2033, 6, 30),
                documents_checked=True,
            ),
            actor,
            reservation_id,
        )

    def extras_for(self, extras: list, chance: float):
        if not extras or self.rng.random() > chance:
            return []

        picked = self.rng.sample(extras, k=self.rng.choice([1, 1, 2]))

        return [SimpleNamespace(extra_id=e.id, quantity=1) for e in picked]

    # ---- the real flows

    def book(self, *, car, class_id=None, pickup, ret, pickup_loc, return_loc, person, actor, extras=()):
        from app.services.reservations import create_reservation

        reservation = create_reservation(
            self.db,
            self.customer_data(person),
            car.id if car else None,
            pickup_loc,
            return_loc,
            pickup,
            ret,
            actor,
            extras=list(extras),
            language="en",
            class_id=class_id,
        )

        return reservation

    def confirm(self, reservation, actor):
        from app.services.reservations import update_reservation_status

        update_reservation_status(self.db, reservation.id, "CONFIRMED", actor)

    def handover_until_payment(self, reservation, person, actor, deposit=True):
        from app.services import deposits, handovers

        handovers.get_or_create_handover(self.db, reservation.id, actor)
        self.identity(reservation.customer_id, person, actor, reservation.id)
        handovers.confirm_cash_payment(self.db, reservation.id, actor)

        if deposit:
            deposits.confirm_cash_deposit(self.db, reservation.id, actor)

    def sign_and_start(self, reservation, actor, employee):
        from app.services import handovers

        handovers.submit_signature(self.db, reservation.id, signature_png(self.rng), actor)
        handovers.submit_employee_signature(self.db, reservation.id, signature_png(self.rng), employee)
        handovers.generate_agreement(self.db, reservation.id, employee)

    def check_out(self, reservation, car, employee, *, fuel_eighths, km, late_hours):
        """Returns the car through the real check-out, with the scheduled return moved so the
        late fee is what we want (the service measures lateness against the real clock)."""

        from sqlalchemy import select

        from app.errors import AppError
        from app.models import CheckOut
        from app.schemas.check_out import CheckOutConditionInput
        from app.services import check_outs

        real_return = reservation.return_at
        reservation.return_at = self.now - timedelta(hours=late_hours) if late_hours else self.now + timedelta(days=1)
        self.db.commit()

        self.db.refresh(car)
        check_outs.save_condition(
            self.db,
            reservation.id,
            CheckOutConditionInput(return_mileage=(car.mileage or 0) + km, fuel_eighths=fuel_eighths),
            employee,
        )
        row = self.db.scalar(select(CheckOut).where(CheckOut.reservation_id == reservation.id))

        try:
            check_outs.settle_deposit_step(self.db, reservation.id, employee)
        except AppError as exc:  # no deposit held for this one
            self.db.rollback()
            print(f"  (no deposit settlement: {exc.code})")

        self.db.refresh(row)

        if (row.total_charge or 0) - (row.deposit_applied or 0) > 0:
            check_outs.confirm_cash_payment(self.db, reservation.id, employee)

        check_outs.submit_employee_signature(self.db, reservation.id, signature_png(self.rng), employee)
        check_outs.complete_check_out(self.db, reservation.id, employee)

        reservation.return_at = real_return
        self.db.commit()

    # ---- moving "now" into the past

    def backdate(self, reservation_id, *, created, pickup, ret, completed: bool, late_hours: int = 0, since: datetime, card_paid: bool = False):
        """Rewrites the timestamps the services stamped with the real clock."""

        from sqlalchemy import select, update

        from app.models import AuditLog, CheckOut, Handover, Invoice, Reservation

        db = self.db
        db.expire_all()
        paid = pickup - timedelta(minutes=25)

        db.execute(update(Reservation).where(Reservation.id == reservation_id).values(created_at=created, updated_at=ret if completed else pickup))
        db.execute(
            update(Handover)
            .where(Handover.reservation_id == reservation_id)
            .values(
                created_at=created,
                updated_at=pickup,
                paid_at=paid,
                deposit_held_at=pickup - timedelta(minutes=20),
                signed_at=pickup - timedelta(minutes=12),
                employee_signed_at=pickup - timedelta(minutes=10),
                generated_at=pickup - timedelta(minutes=5),
            )
        )
        db.execute(update(Invoice).where(Invoice.reservation_id == reservation_id).values(issued_at=paid))

        if card_paid:
            # Paid by card at the counter: Stripe is not available to this stack, so the method is set afterwards.
            db.execute(
                update(Handover)
                .where(Handover.reservation_id == reservation_id)
                .values(payment_method="CARD", stripe_payment_intent_id=f"pi_demo_{str(reservation_id)[:12]}")
            )

        if completed:
            returned = ret + timedelta(hours=late_hours)
            db.execute(
                update(CheckOut)
                .where(CheckOut.reservation_id == reservation_id)
                .values(
                    created_at=returned,
                    updated_at=returned + timedelta(minutes=15),
                    returned_at=returned,
                    deposit_settled_at=returned + timedelta(minutes=5),
                    employee_signed_at=returned + timedelta(minutes=10),
                    completed_at=returned + timedelta(minutes=15),
                )
            )
            db.execute(update(CheckOut).where(CheckOut.reservation_id == reservation_id, CheckOut.paid_at.is_not(None)).values(paid_at=returned + timedelta(minutes=8)))

        # The audit rows this booking wrote, spread over the booking's own timeline.
        rows = db.scalars(select(AuditLog).where(AuditLog.created_at >= since).order_by(AuditLog.created_at)).all()

        for index, row in enumerate(rows):
            if row.action == "reservation.created" or index == 0:
                when = created
            elif row.action.startswith("check_out.") or (completed and row.action == "reservation.status_changed" and index > len(rows) - 4):
                when = ret + timedelta(hours=late_hours, minutes=index)
            elif row.action == "reservation.status_changed":
                when = created + timedelta(minutes=30 + index)
            else:
                when = pickup - timedelta(minutes=30 - index)

            row.created_at = when

        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--anchor", help="YYYY-MM-DD; build the demo as if today were this date (default: now)")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    args = parser.parse_args()

    refuse_unless_safe()

    # Only now is the app imported (it connects to DATABASE_URL).
    from sqlalchemy import select
    from sqlalchemy import update as sa_update

    from app.database import SessionLocal
    from app.errors import AppError
    from app.models import Car, Customer, Extra, Location, Reservation, User, VehicleClass
    from app.schemas.car import CarUpdate
    from app.schemas.car import CarCreate
    from app.schemas.configuration import ConfigurationUpdate
    from app.schemas.vehicle_class import VehicleClassCreate
    from app.services import branding, car_photos, class_photos, locations, maintenance, users
    from app.services.car_fleet import create_car
    from app.services.cars import update_car
    from app.services.class_assignment import pick_car_for_class
    from app.services.configuration import update_configuration
    from app.services.stack_setup import apply_stack_setup
    from app.services.vehicle_classes import create_class

    rng = random.Random(20261005)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    if args.anchor:
        anchor = date.fromisoformat(args.anchor)
        now = datetime(anchor.year, anchor.month, anchor.day, 11, 0, tzinfo=timezone.utc)
        print(f"Anchored at {now:%Y-%m-%d}. The panel's own 'today' is still the real date.")

    real_start = datetime.now(timezone.utc) - timedelta(seconds=5)
    db = SessionLocal()

    try:
        if db.scalar(select(User).limit(1)) is not None:
            sys.exit("Refusing to run: this database already has users. Use a fresh, migrated database.")

        # ---- business, users, locations
        apply_stack_setup(
            db,
            admin_email=ADMIN_EMAIL,
            admin_password=PASSWORD,
            business={
                "name": "Isola Rent",
                "legalName": "Isola Rent S.r.l. (demo)",
                "address": "Via Esempio 1, 07026 Olbia SS, Italy",
                "phone": "+39 000 000 0000",
                "email": "hello@example.com",
                "vatId": "IT00000000000",
                "vatRate": 22,
                "pricesIncludeVat": True,
                "currency": "eur",
                "timezone": BUSINESS_TZ,
                "locale": "en-GB",
                "defaultLanguage": "en",
                "documentLanguage": "en",
                "invoicePrefix": "IR",
            },
        )
        admin = db.scalar(select(User).where(User.email == ADMIN_EMAIL))

        update = ConfigurationUpdate(
            security_deposit_amount=300,
            late_return_grace_minutes=15,
            late_fee_per_hour=10,
            fuel_fee_per_eighth=8,
            refuel_service_fee=25,
            max_damage_charge=500,
            storefront_enabled=True,
            online_share_percent=30,
            free_cancellation_hours=48,
            hold_minutes=15,
            min_booking_lead_hours=6,
            terms_text="Demo rental terms. This is a fictional business used for screenshots.",
            privacy_text="Demo privacy notice. This is a fictional business used for screenshots.",
            agreement_terms=(
                "Isola Rent S.r.l. (demo) rental terms.\n"
                "The renter returns the vehicle in the condition received, subject to normal wear and tear, at the agreed "
                "return location and time. Fuel is full-to-full; a refuelling fee applies otherwise. A return later than the "
                "grace period is charged per started hour. The renter is responsible for fines and tolls incurred during the "
                "rental.\nThis text is fictional and exists only for demonstration screenshots."
            ),
            landing_headline="Sardinia by car, your way",
            landing_tagline="Pick up at the airport, drive the coast, drop off where it suits you.",
        )
        update_configuration(db, actor=admin, **update.model_dump(exclude_unset=True))
        branding.set_logo(db, actor=admin, data_url=logo_png())

        staff = {
            "manager": users.create_user(db, actor=admin, email="giulia.manager@example.com", password=PASSWORD, role="manager"),
            "luca": users.create_user(db, actor=admin, email="luca.staff@example.com", password=PASSWORD, role="staff"),
            "sara": users.create_user(db, actor=admin, email="sara.staff@example.com", password=PASSWORD, role="staff"),
            "paolo": users.create_user(db, actor=admin, email="paolo.staff@example.com", password=PASSWORD, role="staff"),
            "readonly": users.create_user(db, actor=admin, email="anna.readonly@example.com", password=PASSWORD, role="readonly"),
        }
        counter_staff = [staff["luca"], staff["sara"], staff["paolo"]]
        print("business, users, logo")

        locs = {}

        for name, code, address in LOCATIONS:
            locs[code] = locations.create_location(db, actor=admin, name=name, airport_code=code, address=address, timezone=BUSINESS_TZ)

        # ---- classes, cars, pictures
        builder = Builder(db, rng, now)
        home_cycle = ["OLB", "OLB", "CAG", "OLB", "AHO", "CAG", "OLB", "CAG", "AHO", "OLB"]
        cars: list[Car] = []
        plate_number = 100
        classes: dict[str, VehicleClass] = {}

        for order, (name, description, price, picture, models) in enumerate(CLASSES, start=1):
            cls = create_class(
                db,
                VehicleClassCreate(name={"en": name}, description={"en": description}, price_per_day=price, sort_order=order, offered_online=True),
                admin,
            )
            class_photos.set_class_photo(db, class_id=cls.id, actor=admin, data_url=data_url(ASSETS / f"{picture}.jpg"))
            classes[name] = cls

            for make, model, year, category, transmission, fuel, seats, colour in models:
                plate_number += 1
                plate = f"DM {plate_number} AA"
                car = create_car(
                    db,
                    CarCreate(
                        make=make, model=model, year=year, license_plate=plate, category=category,
                        transmission=transmission, fuel_type=fuel, seats=seats, class_id=cls.id,
                        home_location_id=locs[home_cycle[len(cars)]].id, mileage=rng.randint(4000, 32000), offered_online=True,
                    ),
                    admin,
                )
                car_photos.set_car_photo(db, car_id=car.id, actor=admin, data_url=data_url(ASSETS / f"{colour}.jpg"))
                builder.values["plates"].append(plate)
                cars.append(car)

        today = now.astimezone(ZoneInfo(BUSINESS_TZ)).date()

        for index, car in enumerate(cars):
            insured_until = today + timedelta(days=20) if index == 6 else today + timedelta(days=rng.randint(150, 330))
            inspection = today + timedelta(days=12) if index == 2 else today + timedelta(days=rng.randint(90, 360))
            update_car(
                db,
                car.id,
                CarUpdate(
                    tire_condition="GOOD",
                    last_inspection_at=today - timedelta(days=rng.randint(60, 300)),
                    next_inspection_due=inspection,
                    insured_from=today - timedelta(days=rng.randint(30, 330)),
                    insured_until=insured_until,
                    insurance_cost=rng.randint(380, 620),
                ),
            )

        print(f"classes, {len(cars)} cars, photos")

        extras = list(db.scalars(select(Extra).where(Extra.is_active.is_(True)).order_by(Extra.sort_order)))

        # ---- who is free when, and where
        state = {c.id: {"free": now - timedelta(days=HISTORY_DAYS), "loc": c.home_location_id} for c in cars}

        # Cars kept clear of history so they can hold today's rentals.
        # 0-4, 6, 7: rented out today (one due back later today, one 3 h overdue for the
        # check-out shot); 5: a handover in progress (the check-in shot). 8 and 9 stay free.
        reserved_for_today = {0: 4, 1: 4, 2: 3, 3: 4, 4: 2, 5: 2, 6: 4, 7: 3}

        # ---- history: completed rentals, oldest first
        planned = []

        for index, car in enumerate(cars):
            cutoff = now - timedelta(days=reserved_for_today.get(index, 0), hours=12)
            cursor = state[car.id]["free"]
            location = state[car.id]["loc"]

            while True:
                progress = (cursor - (now - timedelta(days=HISTORY_DAYS))).days / HISTORY_DAYS  # 0..1: a quiet start, a busy end
                skip_chance = 0.55 - 0.5 * progress

                if rng.random() < skip_chance:
                    cursor += timedelta(days=rng.randint(1, 4))
                    continue

                pickup = builder.local(cursor + timedelta(days=rng.choice([0, 0, 1, 1, 2])), rng.randint(9, 17))
                days = rng.choice([2, 3, 3, 4, 5, 5, 6, 7, 8, 9])
                ret = builder.local(pickup + timedelta(days=days), rng.randint(9, 18))

                if ret > cutoff:
                    break

                one_way = rng.random() < 0.12
                return_location = rng.choice([l for l in locs.values() if l.id != location]).id if one_way else location  # noqa: E741
                planned.append((pickup, ret, car, location, return_location))
                location = return_location
                cursor = ret + timedelta(hours=2)

            state[car.id] = {"free": cursor, "loc": location}

        planned.sort(key=lambda row: row[0])
        print(f"history: {len(planned)} completed rentals to create")

        for number, (pickup, ret, car, pickup_loc, return_loc) in enumerate(planned, start=1):
            since = datetime.now(timezone.utc) - timedelta(seconds=2)
            actor = rng.choice(counter_staff)
            person = builder.new_person()
            late = rng.choice([2, 3, 4]) if rng.random() < 0.06 else 0
            fuel = rng.choices([8, 7, 6, 5], weights=[70, 15, 10, 5])[0]

            reservation = builder.book(
                car=car, pickup=pickup, ret=ret, pickup_loc=pickup_loc, return_loc=return_loc, person=person, actor=actor,
                extras=builder.extras_for(extras, 0.3),
            )
            builder.confirm(reservation, actor)
            builder.handover_until_payment(reservation, person, actor)
            builder.sign_and_start(reservation, actor, rng.choice([staff["manager"], actor]))
            builder.check_out(reservation, car, actor, fuel_eighths=fuel, km=rng.randint(60, 140) * max(1, (ret - pickup).days), late_hours=late)
            builder.backdate(
                reservation.id, created=pickup - timedelta(days=rng.randint(1, 20), hours=rng.randint(0, 9)),
                pickup=pickup, ret=ret, completed=True, late_hours=late, since=since, card_paid=rng.random() < 0.45,
            )

            if number % 20 == 0:
                print(f"  {number}/{len(planned)}")

        # ---- today and the days ahead
        manifest_ids: dict[str, str] = {}

        def active_rental(index, *, pickup_ago, until, late_note, key=None):
            car = cars[index]
            since = datetime.now(timezone.utc) - timedelta(seconds=2)
            actor = rng.choice(counter_staff)
            person = builder.new_person(reuse=False)
            location = state[car.id]["loc"]
            pickup = builder.local(now - pickup_ago, 10)
            ret = until
            reservation = builder.book(
                car=car, pickup=pickup, ret=ret, pickup_loc=location, return_loc=location, person=person, actor=actor,
                extras=builder.extras_for(extras, 0.5),
            )
            builder.confirm(reservation, actor)
            builder.handover_until_payment(reservation, person, actor)
            builder.sign_and_start(reservation, actor, staff["manager"])
            builder.backdate(
                reservation.id, created=pickup - timedelta(days=rng.randint(2, 12)), pickup=pickup, ret=ret, completed=False, since=since,
            )
            state[car.id]["free"] = ret + timedelta(hours=3)

            if key:
                manifest_ids[key] = str(reservation.id)

            print(f"active rental: {car.license_plate} ({late_note})")

        active_rental(0, pickup_ago=timedelta(days=3), until=builder.local(now + timedelta(days=2), 10), late_note="back in 2 days")
        active_rental(1, pickup_ago=timedelta(days=2), until=now + timedelta(hours=5), late_note="back today")
        active_rental(3, pickup_ago=timedelta(days=4), until=now - timedelta(hours=3), late_note="3 h overdue: the check-out shot", key="checkout")
        active_rental(6, pickup_ago=timedelta(days=1), until=builder.local(now + timedelta(days=4), 12), late_note="back in 4 days")
        active_rental(2, pickup_ago=timedelta(days=2), until=builder.local(now + timedelta(days=3), 11), late_note="back in 3 days")
        active_rental(4, pickup_ago=timedelta(days=1), until=builder.local(now + timedelta(days=1), 17), late_note="back tomorrow")
        active_rental(7, pickup_ago=timedelta(days=3), until=builder.local(now + timedelta(days=5), 10), late_note="back in 5 days")

        # A handover in progress: paid, deposit held, not yet signed.
        car = cars[5]
        since = datetime.now(timezone.utc) - timedelta(seconds=2)
        actor, person = staff["luca"], builder.new_person(reuse=False)
        pickup, ret = now - timedelta(hours=1), builder.local(now + timedelta(days=5), 11)
        reservation = builder.book(
            car=car, pickup=pickup, ret=ret, pickup_loc=state[car.id]["loc"], return_loc=state[car.id]["loc"], person=person,
            actor=actor, extras=builder.extras_for(extras, 1.0),
        )
        builder.confirm(reservation, actor)
        builder.handover_until_payment(reservation, person, actor)
        manifest_ids["handover"] = str(reservation.id)
        state[car.id]["free"] = ret + timedelta(hours=3)
        db.commit()
        print("handover in progress")

        # ---- an open service job, created before the upcoming bookings so they steer around it
        maintenance.create_task(
            db, cars[8].id, "MAINTENANCE", "ROUTINE_SERVICE", "Scheduled service",
            builder.local(now + timedelta(days=2), 8), builder.local(now + timedelta(days=2), 17), admin,
        )

        # Upcoming staff bookings on specific cars, three days of leeway before the first.
        upcoming = 0

        for index, car in enumerate(cars):
            cursor = max(state[car.id]["free"], now + timedelta(hours=6))
            location = state[car.id]["loc"]

            for _ in range(rng.choice([1, 2])):
                pickup = builder.local(cursor + timedelta(days=rng.randint(0, 3)), rng.randint(9, 16))
                ret = builder.local(pickup + timedelta(days=rng.randint(3, 8)), rng.randint(9, 17))
                return_location = location
                actor, person = rng.choice(counter_staff), builder.new_person()

                try:
                    reservation = builder.book(
                        car=car, pickup=pickup, ret=ret, pickup_loc=location, return_loc=return_location, person=person, actor=actor,
                        extras=builder.extras_for(extras, 0.4),
                    )
                    builder.confirm(reservation, actor)
                except AppError as exc:  # e.g. the car is in for service that day
                    db.rollback()
                    print(f"  skipped {car.license_plate}: {exc.code}")
                    cursor = ret + timedelta(hours=3)
                    continue

                created = now - timedelta(days=rng.randint(1, 9), hours=rng.randint(0, 8))
                db.execute(sa_update(Reservation).where(Reservation.id == reservation.id).values(created_at=created, updated_at=created))
                db.commit()
                cursor = ret + timedelta(hours=3)
                upcoming += 1

        print(f"upcoming staff bookings: {upcoming}")

        # Class bookings that hold a provisional car ("car not final").
        provisional = 0

        for attempt in range(40):
            if provisional >= 4:
                break

            cls = rng.choice([classes["Mini"], classes["Compact"], classes["SUV"]])
            code = rng.choice(list(locs))
            pickup = builder.local(now + timedelta(days=rng.randint(4, 14)), rng.randint(9, 16))
            ret = builder.local(pickup + timedelta(days=rng.randint(3, 7)), rng.randint(9, 17))

            if pick_car_for_class(db, cls.id, locs[code].id, pickup, ret, rebalance=False) is None:
                db.rollback()
                continue

            actor, person = rng.choice(counter_staff), builder.new_person()
            reservation = builder.book(
                car=None, class_id=cls.id, pickup=pickup, ret=ret, pickup_loc=locs[code].id, return_loc=locs[code].id, person=person,
                actor=actor, extras=builder.extras_for(extras, 0.3),
            )
            builder.confirm(reservation, actor)
            provisional += 1

            if provisional == 1:
                manifest_ids["provisional"] = str(reservation.id)

        print(f"class bookings with a provisional car: {provisional}")

        # Two bookings waiting for approval.
        for attempt in range(30):
            if "pending" in manifest_ids and "pending2" in manifest_ids:
                break

            cls = rng.choice([classes["Compact"], classes["Mini"]])
            code = rng.choice(list(locs))
            pickup = builder.local(now + timedelta(days=rng.randint(6, 16)), 10)
            ret = builder.local(pickup + timedelta(days=rng.randint(2, 5)), 12)

            if pick_car_for_class(db, cls.id, locs[code].id, pickup, ret, rebalance=False) is None:
                db.rollback()
                continue

            reservation = builder.book(
                car=None, class_id=cls.id, pickup=pickup, ret=ret, pickup_loc=locs[code].id, return_loc=locs[code].id,
                person=builder.new_person(), actor=staff["sara"],
            )
            manifest_ids["pending" if "pending" not in manifest_ids else "pending2"] = str(reservation.id)

        # ---- online bookings (paid by card on the booking site, with fake Stripe ids)
        from app.models import Customer as CustomerModel
        from app.models import ReservationPayment
        from app.services import invoices
        from app.services.audit import audit_log
        from app.services.booking_prices import stamp_agreed_prices
        from app.services.configuration import get_configuration
        from app.services.public_booking import new_reference, on_prepayment_succeeded
        from app.services.public_catalog import cancellation_deadline, split_payment
        from app.services.extras import build_reservation_extras, resolve_extra_selections

        configuration = get_configuration(db)

        def online_booking(cls, *, days_ahead, length, created_ago, cancelled: bool, seq: int):
            car = None

            for attempt in range(25):  # a free car depends on the day and the airport: try others
                code = rng.choice(list(locs))
                pickup = builder.local(now + timedelta(days=days_ahead + attempt // 5), 10)
                ret = builder.local(pickup + timedelta(days=length), 12)
                car = pick_car_for_class(db, cls.id, locs[code].id, pickup, ret, online_only=True, rebalance=False)

                if car is not None:
                    break

                db.rollback()

            if car is None:
                return None

            person = builder.new_person(reuse=False)
            created = now - created_ago
            customer = CustomerModel(
                **{k: v for k, v in person.items() if k != "n"},
                terms_accepted_at=created, terms_version=configuration.legal_version,
                privacy_acknowledged_at=created, privacy_version=configuration.legal_version,
            )
            selected = builder.extras_for(extras, 0.4)
            reservation = Reservation(
                car_id=car.id, class_id=car.class_id, car_confirmed=False, pickup_location_id=locs[code].id,
                return_location_id=locs[code].id, pickup_at=pickup, return_at=ret, status="AWAITING_PAYMENT", source="STOREFRONT",
                language="en", hold_expires_at=created + timedelta(minutes=15), prepayment_percent=configuration.online_share_percent,
                cancellation_deadline_at=cancellation_deadline(configuration, pickup),
                extras=build_reservation_extras(resolve_extra_selections(db, selected)) if selected else [],
            )
            reservation.customer = customer
            stamp_agreed_prices(db, reservation, car, configuration)
            online, _ = split_payment(reservation.agreed_total_amount, configuration.online_share_percent)
            reservation.public_reference = new_reference()
            db.add(reservation)
            db.flush()
            audit_log(db, user=None, action="reservation.created", entity_type="reservation", entity_id=reservation.id,
                      metadata={"car_id": str(car.id), "source": "storefront", "reference": reservation.public_reference})
            payment = ReservationPayment(
                reservation_id=reservation.id, kind="PREPAYMENT", payment_method="CARD", payment_amount=online,
                payment_currency=configuration.default_currency, payment_status="SUCCEEDED",
                stripe_payment_intent_id=f"pi_demo_{seq:04d}", paid_at=created,
            )
            db.add(payment)
            db.flush()
            on_prepayment_succeeded(db, payment, now=created)
            db.commit()

            if cancelled:
                payment.payment_status = "REFUNDED"
                payment.refund_amount = payment.payment_amount
                payment.refunded_at = created + timedelta(hours=20)
                payment.stripe_refund_id = f"re_demo_{seq:04d}"
                invoices.issue_credit_note_for_payment(db, payment, admin)
                reservation.status = "CANCELLED"
                reservation.cancellation_reason = "RENTER"
                reservation.cancelled_at = created + timedelta(hours=20)
                db.commit()

            from app.models import AuditLog, Invoice

            db.execute(sa_update(Reservation).where(Reservation.id == reservation.id).values(created_at=created, updated_at=created))
            db.execute(sa_update(Invoice).where(Invoice.reservation_id == reservation.id).values(issued_at=created + timedelta(minutes=2)))
            db.execute(sa_update(AuditLog).where(AuditLog.entity_id == reservation.id).values(created_at=created + timedelta(minutes=1)))
            db.commit()

            return reservation

        online_done = 0

        for seq, (cls_name, ahead, length, ago, cancelled) in enumerate(
            [
                ("Mini", 16, 5, timedelta(hours=9), False),      # recent: shows in notifications
                ("Compact", 18, 7, timedelta(days=1, hours=3), False),
                ("SUV", 20, 4, timedelta(days=2), False),
                ("Mini", 22, 6, timedelta(days=4), True),
                ("Compact", 24, 3, timedelta(days=5), True),
            ],
            start=1,
        ):
            made = online_booking(classes[cls_name], days_ahead=ahead, length=length, created_ago=ago, cancelled=cancelled, seq=seq)

            if made is not None:
                online_done += 1

                if not cancelled and "online" not in manifest_ids:
                    manifest_ids["online"] = str(made.id)

        print(f"online bookings: {online_done}")

        # ---- finished maintenance in the past
        from app.models import MaintenanceTask

        for age_days, car_index, category, cost in [(41, 2, "ROUTINE_SERVICE", 180), (23, 7, "OTHER", 65), (9, 4, "ROUTINE_SERVICE", 140)]:
            car = cars[car_index]
            task = maintenance.create_task(
                db, car.id, "MAINTENANCE", category, "Completed work", now + timedelta(days=60), now + timedelta(days=60, hours=4), admin, cost=cost,
            )
            maintenance.complete_task(db, task.id, admin, cost=cost)
            done = now - timedelta(days=age_days)
            db.execute(sa_update(MaintenanceTask).where(MaintenanceTask.id == task.id).values(
                starts_at=done - timedelta(hours=6), ends_at=done - timedelta(hours=2), completed_at=done, opened_at=done - timedelta(days=2)))

        db.commit()
        print("maintenance")

        # ---- audit trail: the set-up work came first; everything else still stamped with the real clock is dated by what it belongs to
        from app.models import AuditLog, Invoice

        for row in db.scalars(select(AuditLog).where(AuditLog.entity_type.in_(["user", "car", "vehicle_class", "location", "configuration", "extra"]))):
            row.created_at = now - timedelta(days=HISTORY_DAYS + rng.randint(1, 10))

        db.flush()

        for row in db.scalars(select(AuditLog).where(AuditLog.created_at >= real_start)):
            if row.entity_type == "invoice" and (invoice := db.get(Invoice, row.entity_id)) is not None:
                row.created_at = invoice.issued_at + timedelta(minutes=1)
            elif row.entity_type == "maintenance_task" and (task := db.get(MaintenanceTask, row.entity_id)) is not None:
                row.created_at = (task.completed_at or now - timedelta(days=3)) + timedelta(minutes=1)
            else:
                row.created_at = now - timedelta(days=rng.random() * 9, hours=rng.random() * 8)

        db.commit()

        # ---- manifest
        total = {
            "reservations": db.query(Reservation).count(),
            "customers": db.query(Customer).count(),
        }
        manifest = {
            "business": "Isola Rent",
            "admin_email": ADMIN_EMAIL,
            "password": PASSWORD,
            "users": {role: user.email for role, user in staff.items()},
            "reservations": manifest_ids,
            "classes": {name: cls.slug for name, cls in classes.items()},
            "totals": total,
            "invented_values": builder.values,
            "built_at": now.isoformat(),
        }
        Path(args.manifest).parent.mkdir(parents=True, exist_ok=True)
        Path(args.manifest).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"done: {total}. Manifest: {args.manifest}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
