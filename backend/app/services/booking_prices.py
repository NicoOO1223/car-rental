"""
What a booking costs, worked out one way everywhere (payment, invoice,
agreement).

A booking made through the app records the price it was made at (the
agreed_* columns on the reservation): the daily rate and the two fees. A later
change to a car's rate or to Configuration's fees does not re-price it, so what
is charged is what was quoted. A booking from before that existed has no
agreed price and keeps pricing from the live rates.

The short-term threshold and the VAT settings are not recorded: they decide how
the price is worked out, not what it was, and the accountant's rule is that
VAT follows the settings in force when the money is taken.
"""

from sqlalchemy.orm import Session

from app.models import Car, Reservation
from app.services.configuration import get_configuration, vat_terms
from app.services.extras import selections_from_reservation
from app.services.pricing import PriceBreakdown, calculate_price_breakdown


def reservation_price_breakdown(
    db: Session, reservation: Reservation, car: Car | None = None, configuration=None
) -> PriceBreakdown:
    car = car or db.get(Car, reservation.car_id)
    configuration = configuration or get_configuration(db)

    def agreed(recorded, live):
        return recorded if recorded is not None else live

    return calculate_price_breakdown(
        agreed(reservation.agreed_price_per_day, car.price_per_day),
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=agreed(reservation.agreed_short_term_fee, configuration.short_term_fee),
        airport_change_fee=agreed(reservation.agreed_airport_change_fee, configuration.airport_change_fee),
        **vat_terms(configuration),
        # Snapshotted prices, not the live catalog.
        extras=selections_from_reservation(reservation),
    )


def stamp_agreed_prices(
    db: Session, reservation: Reservation, car: Car | None = None, configuration=None
) -> PriceBreakdown:
    """
    Records today's rate and fees on the booking as the agreed price, and its
    total. Called when a booking is made, and again when a booking that has not
    been paid yet is edited. Call it after the extras are on the reservation.
    """

    car = car or db.get(Car, reservation.car_id)
    configuration = configuration or get_configuration(db)

    reservation.agreed_price_per_day = car.price_per_day
    reservation.agreed_short_term_fee = configuration.short_term_fee
    reservation.agreed_airport_change_fee = configuration.airport_change_fee
    reservation.agreed_currency = configuration.default_currency

    breakdown = reservation_price_breakdown(db, reservation, car, configuration)
    reservation.agreed_total_amount = breakdown.total_amount

    return breakdown
