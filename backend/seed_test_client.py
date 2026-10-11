"""
A fictional second client ("Adriatic Drive Rentals") for the crash test.

The stack is created by deploy/provision.ps1 from deploy/stacks/crashtest.json, which
gives it its business profile and first administrator. This script then fills it with
a fleet and about 150 PENDING reservations over the next three months, through the
SERVICE LAYER (the same code the staff app uses), so what the testers see is what a
real client would have.

Run from backend/, against the stack's database from your own machine (see
docs/CRASH_TEST.md for opening the database firewall and for the connection string):

    CRASHTEST_DATABASE_URL=postgresql+psycopg://carrental_app:...@<host>:5432/car_rental?sslmode=require \\
    AZURE_STORAGE_ACCOUNT_URL=https://<photo account>.blob.core.windows.net \\
    SECRET_KEY=any-throwaway-value \\
        python seed_test_client.py --stack crashtest --real-email you@gmail.com --real-email colleague@gmail.com

It refuses to run unless:
  - CRASHTEST_DATABASE_URL is set (the app's own DATABASE_URL is never used),
  - --stack names the stack you meant,
  - the database belongs to the business "Adriatic Drive Rentals" and has an administrator,
  - the database has no cars or reservations yet (or you pass --wipe and type the stack name).

Nothing here touches seed.py or seed_marketing_demo.py.
"""

import argparse
import base64
import json
import os
import random
import secrets
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy.engine import make_url

BUSINESS_NAME = "Adriatic Drive Rentals"
STACK = "crashtest"
BUSINESS_TZ = "Europe/Zagreb"
ASSETS = Path(__file__).resolve().parent.parent / "marketing" / "scripts" / "demo-assets"
STATE_DIR = Path(__file__).resolve().parent.parent / "deploy" / ".stacks" / STACK
WINDOW_DAYS = 90
RESERVATIONS = 150
REAL_RENTERS = 6
ACCENT = "#0e7490"  # a teal, so this client does not look like the demo's black

LOCATIONS = [
    ("Split Airport", "SPU", "Aerodromska cesta 1, 21217 Kastela"),
    ("Dubrovnik Airport", "DBV", "Cilipi 24, 20213 Cilipi"),
    ("Zadar Airport", "ZAD", "Zracna luka Zadar, 23222 Zemunik Donji"),
]

# name, description (en, it, pl), price/day, class picture
CLASSES = [
    ("Mini", ("Fiat Panda or similar. Four seats, easy to park in old towns.", "Fiat Panda o simile. Quattro posti, facile da parcheggiare.", "Fiat Panda lub podobny. Cztery miejsca, latwy w parkowaniu."), "35.00", "class-mini"),
    ("Economy", ("Renault Clio or similar. Efficient for coastal drives.", None, None), "42.00", "class-compact"),
    ("Compact", ("Volkswagen Golf or similar. Room for four and their luggage.", "Volkswagen Golf o simile. Spazio per quattro e i bagagli.", None), "52.00", "class-compact"),
    ("SUV", ("Dacia Duster or similar. Higher seating for island roads.", None, "Dacia Duster lub podobny. Wyzsza pozycja na wyspiarskich drogach."), "72.00", "class-suv"),
    ("Premium", ("BMW 3 Series or similar. Comfort for the long coast road.", None, None), "110.00", "class-compact"),
    ("Van", ("Ford Transit or similar. Nine seats for groups.", None, None), "95.00", "class-van"),
]

# class, make, model, year, category, transmission, fuel, seats, car picture
FLEET = [
    ("Mini", "Fiat", "Panda", 2023, "ECONOMY", "MANUAL", "PETROL", 4, "car-mini-red"),
    ("Mini", "Fiat", "Panda", 2024, "ECONOMY", "MANUAL", "HYBRID", 4, "car-mini-white"),
    ("Mini", "Toyota", "Aygo X", 2024, "ECONOMY", "MANUAL", "PETROL", 4, "car-mini-yellow"),
    ("Mini", "Citroen", "C1", 2022, "ECONOMY", "MANUAL", "PETROL", 4, "car-mini-green"),
    ("Mini", "Hyundai", "i10", 2023, "ECONOMY", "AUTOMATIC", "PETROL", 4, "car-mini-red"),
    ("Economy", "Renault", "Clio", 2023, "COMPACT", "MANUAL", "PETROL", 5, "car-compact-silver"),
    ("Economy", "Opel", "Corsa", 2023, "COMPACT", "MANUAL", "DIESEL", 5, "car-compact-blue"),
    ("Economy", "Peugeot", "208", 2024, "COMPACT", "AUTOMATIC", "PETROL", 5, "car-compact-black"),
    ("Economy", "Volkswagen", "Polo", 2022, "COMPACT", "MANUAL", "PETROL", 5, "car-compact-silver"),
    ("Economy", "Skoda", "Fabia", 2023, "COMPACT", "MANUAL", "PETROL", 5, "car-compact-blue"),
    ("Compact", "Volkswagen", "Golf", 2023, "COMPACT", "MANUAL", "DIESEL", 5, "car-compact-blue"),
    ("Compact", "Volkswagen", "Golf", 2024, "COMPACT", "AUTOMATIC", "PETROL", 5, "car-compact-silver"),
    ("Compact", "Peugeot", "308", 2023, "COMPACT", "MANUAL", "DIESEL", 5, "car-compact-black"),
    ("Compact", "Ford", "Focus", 2022, "COMPACT", "MANUAL", "PETROL", 5, "car-compact-blue"),
    ("Compact", "Toyota", "Corolla", 2024, "COMPACT", "AUTOMATIC", "HYBRID", 5, "car-compact-silver"),
    ("SUV", "Dacia", "Duster", 2023, "SUV", "MANUAL", "DIESEL", 5, "car-suv-grey"),
    ("SUV", "Jeep", "Renegade", 2023, "SUV", "AUTOMATIC", "PETROL", 5, "car-suv-orange"),
    ("SUV", "Ford", "Puma", 2024, "SUV", "MANUAL", "HYBRID", 5, "car-suv-grey"),
    ("SUV", "Hyundai", "Tucson", 2024, "SUV", "AUTOMATIC", "HYBRID", 5, "car-suv-orange"),
    ("SUV", "Kia", "Sportage", 2023, "SUV", "AUTOMATIC", "DIESEL", 5, "car-suv-grey"),
    ("Premium", "BMW", "320d", 2024, "PREMIUM", "AUTOMATIC", "DIESEL", 5, "car-compact-black"),
    ("Premium", "Mercedes", "C 220 d", 2023, "PREMIUM", "AUTOMATIC", "DIESEL", 5, "car-compact-silver"),
    ("Premium", "Tesla", "Model 3", 2024, "PREMIUM", "AUTOMATIC", "ELECTRIC", 5, "car-compact-blue"),
    ("Van", "Ford", "Transit", 2022, "VAN", "MANUAL", "DIESEL", 9, "car-van-white"),
    ("Van", "Ford", "Transit", 2023, "VAN", "MANUAL", "DIESEL", 9, "car-van-white"),
    ("Van", "Volkswagen", "Caravelle", 2023, "VAN", "AUTOMATIC", "DIESEL", 8, "car-van-white"),
]

# Where each fleet row lives: 10 in Split, 9 in Dubrovnik, 7 in Zadar.
HOMES = [
    "SPU", "DBV", "ZAD", "SPU", "DBV", "ZAD", "SPU", "DBV", "SPU", "ZAD", "DBV", "SPU", "ZAD",
    "SPU", "DBV", "SPU", "DBV", "ZAD", "SPU", "DBV", "ZAD", "SPU", "DBV", "ZAD", "DBV", "SPU",
]
PLATE_PREFIX = {"SPU": "ST", "DBV": "DU", "ZAD": "ZD"}

FIRST_NAMES = [
    "Ivan", "Marko", "Luka", "Petra", "Ana", "Marija", "Josip", "Nikola", "Ivana", "Katarina",
    "Hans", "Greta", "Lukas", "Anna", "Felix", "Marie", "Oliver", "Emily", "Harry", "Sophie",
    "Marco", "Giulia", "Paolo", "Elena", "Pierre", "Camille", "Daan", "Sanne", "Pablo", "Lucia",
    "Jan", "Agnieszka", "Piotr", "Magda", "Erik", "Ingrid", "Sven", "Astrid", "Liam", "Chloe",
]
LAST_NAMES = [
    "Horvat", "Kovac", "Babic", "Maric", "Juric", "Novak", "Knezevic", "Vukovic", "Peric", "Tomic",
    "Becker", "Hartmann", "Keller", "Lindner", "Vogel", "Baker", "Carter", "Dawson", "Ellis", "Hughes",
    "Rossi", "Ferrari", "Bianchi", "Fournier", "Girard", "de Vries", "Bakker", "Navarro", "Ortega", "Meier",
    "Kowalski", "Nowak", "Wisniewski", "Lewandowski", "Larsen", "Berg", "Holm", "Lund", "Murphy", "Walsh",
]
# nationality, street, city, postal code, phone prefix
ORIGINS = [
    ("HR", "Ulica Primjer", "Zagreb", "10000", "+385 91"),
    ("DE", "Beispielweg", "Munchen", "80331", "+49 151"),
    ("GB", "Example Road", "Leeds", "LS1 1AA", "+44 7700"),
    ("IT", "Via Esempio", "Milano", "20100", "+39 333"),
    ("FR", "Rue de l'Exemple", "Lyon", "69001", "+33 6"),
    ("NL", "Voorbeeldstraat", "Utrecht", "3511 AA", "+31 6"),
    ("PL", "Ulica Przykladowa", "Krakow", "30-001", "+48 512"),
    ("SE", "Exempelvagen", "Goteborg", "411 01", "+46 70"),
    ("US", "Example Street", "Boston", "02108", "+1 617"),
    ("AT", "Beispielgasse", "Wien", "1010", "+43 660"),
]

DURATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]
DURATION_WEIGHTS = [10, 14, 16, 14, 10, 8, 12, 4, 3, 3, 2, 2, 2]
HOT_CARS = 4  # cars that attract clusters of overlapping requests
HOT_BOOKINGS_EACH = 6
CLASS_SHARE = 0.15  # bookings for a class, with no car chosen

# What --wipe empties, children first. Users, configuration and extras are kept.
WIPE_ORDER = [
    "condition_photos", "condition_reviews", "check_outs", "invoices", "handovers", "reservation_payments",
    "reservation_extras", "customer_account_bookings", "email_messages", "reservations", "maintenance_tasks",
    "customers", "cars", "vehicle_classes", "locations",
]


def refuse_unless_safe(*, stack: str | None, wipe: bool = False, storage_required: bool = True) -> None:
    """Checked before the app is imported, so nothing is even connected on a refusal."""

    url = os.getenv("CRASHTEST_DATABASE_URL", "")

    if not url:
        sys.exit("Refusing to run: CRASHTEST_DATABASE_URL is not set (DATABASE_URL is deliberately not used).")

    if stack != STACK:
        sys.exit(f"Refusing to run: pass --stack {STACK} to confirm which stack this is for.")

    if not make_url(url).database:
        sys.exit("Refusing to run: CRASHTEST_DATABASE_URL has no database name.")

    if not os.getenv("SECRET_KEY"):
        sys.exit("Refusing to run: SECRET_KEY is not set (any throwaway value will do).")

    if storage_required and not os.getenv("AZURE_STORAGE_ACCOUNT_URL"):
        sys.exit(
            "Refusing to run: AZURE_STORAGE_ACCOUNT_URL is not set, so the car photos would be written to this "
            "machine's disk instead of the stack's storage. Set it, or pass --no-photos."
        )

    if wipe:
        answer = input(f"--wipe deletes every car, reservation and customer in this database. Type {STACK!r} to continue: ")

        if answer.strip() != STACK:
            sys.exit("Not confirmed; nothing was changed.")


# ----------------------------------------------------------------- the plan
#
# Pure: no database, no clock except the `today` it is given. The tests check it.


@dataclass
class Person:
    first_name: str
    last_name: str
    date_of_birth: date
    address: str
    postal_code: str
    phone_number: str
    email: str
    nationality: str
    real: bool = False


@dataclass
class Booking:
    person: int  # index into the people list
    car: int | None  # index into FLEET, or None for a class booking
    klass: str  # class name (always set; the car's own class when a car is chosen)
    pickup: datetime  # UTC
    ret: datetime  # UTC
    pickup_code: str
    return_code: str
    extras: int  # how many extras
    language: str
    created_hours_ago: float
    cluster: bool = False


@dataclass
class Plan:
    people: list[Person] = field(default_factory=list)
    bookings: list[Booking] = field(default_factory=list)


def real_emails(addresses: list[str]) -> list[str]:
    """Six distinct inboxes out of the given addresses. With fewer than six, plus-tags
    (name+adr1@gmail.com) make the rest, which land in the same mailbox."""

    if not addresses:
        return []

    out = []

    for index in range(REAL_RENTERS):
        base = addresses[index % len(addresses)]

        if index < len(addresses) or "+" in base.split("@")[0]:
            out.append(base)
        else:
            local, domain = base.split("@", 1)
            out.append(f"{local}+adr{index + 1}@{domain}")

    return out


def _local(day: date, hour: int, minute: int, zone: ZoneInfo) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone).astimezone(timezone.utc)


def _pickup_day_weights(today: date) -> list[float]:
    """Heavier at the weekend, and around Christmas and New Year."""

    weights = []

    for offset in range(1, WINDOW_DAYS + 1):
        day = today + timedelta(days=offset)
        weight = 1.0

        if day.weekday() in (4, 5, 6):
            weight *= 1.8

        if (day.month == 12 and day.day >= 20) or (day.month == 1 and day.day <= 3):
            weight *= 2.2

        weights.append(weight)

    return weights


def build_plan(rng: random.Random, today: date, real: list[str]) -> Plan:
    """Who books what, when. Dates are the business's local days from tomorrow for WINDOW_DAYS."""

    zone = ZoneInfo(BUSINESS_TZ)
    plan = Plan()
    class_names = [c[0] for c in CLASSES]
    codes = [loc[1] for loc in LOCATIONS]

    # ---- people: ~110, a few of them with real inboxes
    used: set[tuple[str, str]] = set()
    people_total = 110

    for index in range(people_total):
        nationality, street, city, postal, phone = rng.choice(ORIGINS)

        if index < len(real):
            first, last, email, is_real = "Test", f"Renter {chr(ord('A') + index)}", real[index], True
        else:
            while True:
                first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)

                if (first, last) not in used:
                    break

            used.add((first, last))
            slug = f"{first}.{last}".lower().replace(" ", "")
            email, is_real = f"{slug}{index}@example.com", False

        plan.people.append(
            Person(
                first_name=first,
                last_name=last,
                date_of_birth=date(rng.randint(1955, 2002), rng.randint(1, 12), rng.randint(1, 28)),
                address=f"{street} {rng.randint(1, 99)}, {city}",
                postal_code=postal,
                phone_number=f"{phone} {rng.randint(100, 999)} {rng.randint(1000, 9999)}",
                email=email,
                nationality=nationality,
                real=is_real,
            )
        )

    weights = _pickup_day_weights(today)
    # Every person books once; the rest are repeat customers.
    person_order = list(range(people_total)) + [rng.randrange(people_total) for _ in range(RESERVATIONS - people_total)]
    rng.shuffle(person_order)
    # The real renters come first in the order, so each one is sure to have a booking.
    for slot in range(len(real)):
        at = person_order.index(slot)
        person_order[slot], person_order[at] = person_order[at], person_order[slot]

    def window(start_offset: int, length: int, hour_from: int = 8, hour_to: int = 18) -> tuple[datetime, datetime]:
        pick_day = today + timedelta(days=start_offset)
        pickup = _local(pick_day, rng.randint(hour_from, hour_to), rng.choice([0, 15, 30, 45]), zone)
        back_day = pick_day + timedelta(days=length)
        ret = _local(back_day, rng.randint(hour_from, hour_to), rng.choice([0, 15, 30, 45]), zone)

        if ret <= pickup:
            ret = pickup + timedelta(days=length, hours=2)

        return pickup, ret

    def other_code(code: str) -> str:
        return rng.choice([c for c in codes if c != code])

    bookings: list[Booking] = []
    hot = rng.sample(range(len(FLEET)), HOT_CARS)

    # ---- clusters: overlapping requests on a few cars (nothing blocks a PENDING booking)
    for car in hot:
        center = rng.randint(8, WINDOW_DAYS - 12)

        for _ in range(HOT_BOOKINGS_EACH):
            length = rng.choice([3, 4, 5, 6, 7])
            pickup, ret = window(center + rng.randint(-4, 4), length)
            home = HOMES[car]
            bookings.append(Booking(0, car, FLEET[car][0], pickup, ret, home, home, 0, "en", 0, cluster=True))

    # ---- the rest: class bookings (no car chosen) and car bookings
    while len(bookings) < RESERVATIONS:
        offset = rng.choices(range(1, WINDOW_DAYS + 1), weights=weights)[0]
        length = rng.choices(DURATIONS, weights=DURATION_WEIGHTS)[0]
        pickup, ret = window(offset, length)

        if rng.random() < CLASS_SHARE:
            klass = rng.choice(class_names)
            candidates = [i for i, row in enumerate(FLEET) if row[0] == klass]
            code = HOMES[rng.choice(candidates)]
            car = None
        else:
            car = rng.randrange(len(FLEET))
            klass = FLEET[car][0]
            code = HOMES[car]

        return_code = other_code(code) if rng.random() < 0.25 else code
        bookings.append(Booking(0, car, klass, pickup, ret, code, return_code, 0, "en", 0))

    rng.shuffle(bookings)

    for booking, person in zip(bookings, person_order):
        booking.person = person
        booking.extras = rng.choice([1, 1, 2]) if rng.random() < 0.30 else 0
        booking.language = rng.choices(["en", "it", "pl"], weights=[88, 6, 6])[0]

    # ---- when each request arrived: most within a day, some overdue for the 24 h rule
    ages = (
        [rng.uniform(0.2, 6) for _ in range(10)]
        + [rng.uniform(6, 23) for _ in range(RESERVATIONS - 10 - 15 - 8)]
        + [rng.uniform(25, 60) for _ in range(15)]
        + [rng.uniform(70, 24 * 8) for _ in range(8)]
    )
    rng.shuffle(ages)

    for booking, age in zip(bookings, ages):
        booking.created_hours_ago = age

    plan.bookings = sorted(bookings, key=lambda b: b.pickup)

    return plan


def plate_for(index: int, rng: random.Random, taken: set[str]) -> str:
    prefix = PLATE_PREFIX[HOMES[index]]

    while True:
        plate = f"{prefix} {rng.randint(100, 999)}-{rng.choice('ABCDEFGHJKLMNPRSTUVZ')}{rng.choice('ABCDEFGHJKLMNPRSTUVZ')}"

        if plate not in taken:
            taken.add(plate)
            return plate


def data_url(path: Path) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def logo_png() -> str:
    import io

    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (512, 512), ACCENT)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((60, 60, 452, 452), radius=90, outline="#ffffff", width=14)

    try:
        font = ImageFont.load_default(size=200)
    except TypeError:  # an older Pillow without sized default fonts
        font = ImageFont.load_default()

    draw.text((256, 256), "AD", fill="#ffffff", font=font, anchor="mm")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


# ------------------------------------------------------------------ the build


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack", help=f"must be {STACK!r}, to confirm which stack this is for")
    parser.add_argument("--real-email", action="append", default=[], help="a real inbox for the test renters (repeat for several)")
    parser.add_argument("--wipe", action="store_true", help="delete the cars, reservations and customers first (asks you to type the stack name)")
    parser.add_argument("--no-photos", action="store_true", help="skip car and class photos (for a dry local run)")
    parser.add_argument("--seed", type=int, default=20261009, help="the same seed gives the same data")
    parser.add_argument("--credentials", default=str(STATE_DIR / "testusers.txt"), help="where the test staff logins are written")
    args = parser.parse_args()

    refuse_unless_safe(stack=args.stack, wipe=args.wipe, storage_required=not args.no_photos)

    os.environ["DATABASE_URL"] = os.environ["CRASHTEST_DATABASE_URL"]

    # Only now is the app imported (it connects to DATABASE_URL).
    from sqlalchemy import select, text
    from sqlalchemy import update as sa_update

    from app.database import SessionLocal
    from app.errors import AppError
    from app.models import AuditLog, Car, Customer, Extra, Reservation, User
    from app.schemas.car import CarCreate, CarUpdate
    from app.schemas.configuration import ConfigurationUpdate
    from app.schemas.reservation import CustomerCreate
    from app.schemas.vehicle_class import VehicleClassCreate
    from app.services import branding, car_photos, class_photos, locations, maintenance, users
    from app.services.car_fleet import create_car
    from app.services.cars import update_car
    from app.services.configuration import get_configuration, update_configuration
    from app.services.reservations import create_reservation
    from app.services.vehicle_classes import create_class

    rng = random.Random(args.seed)
    zone = ZoneInfo(BUSINESS_TZ)
    now = datetime.now(timezone.utc)
    today = now.astimezone(zone).date()
    db = SessionLocal()

    try:
        business = get_configuration(db).business_name

        if business != BUSINESS_NAME:
            sys.exit(f"Refusing to run: this database belongs to {business!r}, not {BUSINESS_NAME!r}.")

        admin = db.scalar(select(User).where(User.role == "admin").order_by(User.created_at))

        if admin is None:
            sys.exit("Refusing to run: the stack has no administrator yet (provision it first).")

        existing = db.query(Car).count() + db.query(Reservation).count()

        if existing and not args.wipe:
            sys.exit("Refusing to run: this stack already has cars or reservations. Pass --wipe to start a fresh round.")

        if args.wipe:
            # Children first. The app's database login can delete rows but not TRUNCATE.
            for table in WIPE_ORDER:
                db.execute(text(f"DELETE FROM {table}"))

            db.commit()
            print("wiped cars, classes, locations, reservations, customers")

        print(f"Admin: {admin.email}. Business: {business}. Today (local): {today}.")

        # ---- brand colour and logo
        update_configuration(
            db,
            actor=admin,
            **ConfigurationUpdate(
                accent_color=ACCENT,
                security_deposit_amount=250,
                late_return_grace_minutes=30,
                late_fee_per_hour=12,
                fuel_fee_per_eighth=7,
                refuel_service_fee=30,
                max_damage_charge=600,
                confirm_within_hours=24,
                storefront_enabled=False,
                terms_text="Test-client rental terms. This is a fictional business used for testing.",
                privacy_text="Test-client privacy notice. This is a fictional business used for testing.",
            ).model_dump(exclude_unset=True),
        )
        branding.set_logo(db, actor=admin, data_url=logo_png())

        # ---- locations and classes
        locs = {}

        for name, code, address in LOCATIONS:
            locs[code] = locations.create_location(db, actor=admin, name=name, airport_code=code, address=address, timezone=BUSINESS_TZ)

        classes = {}
        picture_of = {}

        for order, (name, (en, it, pl), price, picture) in enumerate(CLASSES, start=1):
            description = {"en": en}

            if it:
                description["it"] = it

            if pl:
                description["pl"] = pl

            names = {"en": name}
            cls = create_class(db, VehicleClassCreate(name=names, description=description, price_per_day=price, sort_order=order, offered_online=False), admin)

            if not args.no_photos:
                class_photos.set_class_photo(db, class_id=cls.id, actor=admin, data_url=data_url(ASSETS / f"{picture}.jpg"))

            classes[name] = cls
            picture_of[name] = picture

        # ---- the fleet
        cars = []
        taken: set[str] = set()

        for index, (klass, make, model, year, category, transmission, fuel, seats, picture) in enumerate(FLEET):
            car = create_car(
                db,
                CarCreate(
                    make=make, model=model, year=year, license_plate=plate_for(index, rng, taken), category=category,
                    transmission=transmission, fuel_type=fuel, seats=seats, class_id=classes[klass].id,
                    home_location_id=locs[HOMES[index]].id, mileage=rng.randint(3000, 48000), offered_online=False,
                ),
                admin,
            )

            if not args.no_photos:
                car_photos.set_car_photo(db, car_id=car.id, actor=admin, data_url=data_url(ASSETS / f"{picture}.jpg"))

            cars.append(car)

        for index, car in enumerate(cars):
            insured_until = today - timedelta(days=9) if index == 7 else today + timedelta(days=rng.randint(120, 330))
            inspection = today + timedelta(days=6) if index == 12 else today + timedelta(days=rng.randint(80, 360))
            update_car(
                db,
                car.id,
                CarUpdate(
                    tire_condition="GOOD",
                    last_inspection_at=today - timedelta(days=rng.randint(40, 300)),
                    next_inspection_due=inspection,
                    insured_from=today - timedelta(days=rng.randint(30, 330)),
                    insured_until=insured_until,
                    insurance_cost=rng.randint(380, 720),
                ),
            )

        print(f"{len(locs)} locations, {len(classes)} classes, {len(cars)} cars")

        # ---- the requests
        plan = build_plan(rng, today, real_emails(args.real_email))
        extras = list(db.scalars(select(Extra).where(Extra.is_active.is_(True)).order_by(Extra.sort_order)))
        made: list[tuple] = []
        failed = 0

        for number, booking in enumerate(plan.bookings, start=1):
            person = plan.people[booking.person]
            picks = rng.sample(extras, k=min(booking.extras, len(extras))) if extras else []
            selection = [type("Pick", (), {"extra_id": e.id, "quantity": 1})() for e in picks]
            car = cars[booking.car] if booking.car is not None else None
            klass = classes[booking.klass]

            try:
                reservation = create_reservation(
                    db,
                    CustomerCreate(
                        first_name=person.first_name, last_name=person.last_name, date_of_birth=person.date_of_birth,
                        address=person.address, postal_code=person.postal_code, phone_number=person.phone_number,
                        email=person.email, nationality=person.nationality,
                    ),
                    car.id if car else None,
                    locs[booking.pickup_code].id,
                    locs[booking.return_code].id,
                    booking.pickup,
                    booking.ret,
                    admin,
                    extras=selection,
                    language=booking.language,
                    class_id=None if car else klass.id,
                )
            except AppError as exc:
                db.rollback()
                failed += 1
                print(f"  skipped #{number}: {exc.code}")
                continue

            if car is None:
                # A class booking is held on the lowest plate. Spread them over the class's cars at that place.
                homed = [c for c in cars if c.class_id == klass.id and c.home_location_id == locs[booking.pickup_code].id]

                if homed:
                    db.execute(sa_update(Reservation).where(Reservation.id == reservation.id).values(car_id=rng.choice(homed).id))
                    db.commit()

            made.append((reservation.id, booking))

            if number % 30 == 0:
                print(f"  {number}/{len(plan.bookings)}")

        # ---- when each request arrived (the services stamp "now")
        for reservation_id, booking in made:
            when = now - timedelta(hours=booking.created_hours_ago)
            db.execute(sa_update(Reservation).where(Reservation.id == reservation_id).values(created_at=when, updated_at=when))
            db.execute(
                sa_update(AuditLog)
                .where(AuditLog.entity_type == "reservation", AuditLog.entity_id == reservation_id)
                .values(created_at=when)
            )

        db.commit()

        # ---- fleet condition: a cleaning job and two service jobs, set up after the requests so they steer around them
        jobs = [
            (3, "MAINTENANCE", "ROUTINE_SERVICE", "Scheduled service", 2, None),
            (14, "MAINTENANCE", "DAMAGE_REPAIR", "Scratched bumper", 5, None),
            (18, "CLEANING", None, "Deep clean before the weekend", 1, "FULL"),
        ]

        for car_index, task_type, category, notes, days_ahead, cleaning in jobs:
            start = _local(today + timedelta(days=days_ahead), 8, 0, zone)

            try:
                maintenance.create_task(db, cars[car_index].id, task_type, category, notes, start, start + timedelta(hours=8), admin, cleaning_type=cleaning)
            except AppError as exc:
                db.rollback()
                print(f"  (no {task_type.lower()} job on car {car_index}: {exc.code})")

        # ---- staff for the testers (a later round keeps the logins it made before)
        path = Path(args.credentials)
        credentials = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

        for role, email in [
            ("admin", "colleague.admin@example.com"),
            ("manager", "manager@example.com"),
            ("staff", "counter.staff@example.com"),
            ("readonly", "readonly@example.com"),
        ]:
            if db.scalar(select(User).where(User.email == email)) is not None:
                print(f"  {email} already exists; its password is unchanged")
                continue

            password = secrets.token_urlsafe(12)
            users.create_user(db, actor=admin, email=email, password=password, role=role)
            credentials[role] = {"email": email, "password": password}

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(credentials, indent=2), encoding="utf-8")

        # ---- summary
        pending = db.query(Reservation).filter(Reservation.status == "PENDING").count()
        first = db.query(Reservation.pickup_at).order_by(Reservation.pickup_at).first()
        last = db.query(Reservation.pickup_at).order_by(Reservation.pickup_at.desc()).first()
        print(
            f"done: {db.query(Car).count()} cars, {db.query(Reservation).count()} reservations "
            f"({pending} pending, {failed} skipped), {db.query(Customer).count()} customers; "
            f"pickups {first[0].astimezone(zone):%Y-%m-%d} to {last[0].astimezone(zone):%Y-%m-%d}."
        )
        print(f"Test staff logins written to {path}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
