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
from app.services.timezones import location_timezone_name


def agreed_price_per_day(reservation: Reservation, car: Car):
    """The daily rate this booking was made at (the car's live rate for a
    booking from before prices were recorded)."""

    if reservation.agreed_price_per_day is not None:
        return reservation.agreed_price_per_day

    return car.price_per_day


def agreed_price_breakdown(
    reservation: Reservation, car: Car, configuration, timezone_name: str | None = None
) -> PriceBreakdown:
    """The same price as reservation_price_breakdown, for callers that already
    hold the car and the configuration and have no session to fetch them. Days
    are counted on the clock at the pickup place: `timezone_name` if given, else
    the reservation's loaded pickup location."""

    if timezone_name is None and reservation.pickup_location is not None:
        timezone_name = reservation.pickup_location.timezone

    def agreed(recorded, live):
        return recorded if recorded is not None else live

    return calculate_price_breakdown(
        agreed_price_per_day(reservation, car),
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
        # Days are counted on the clock at the pickup place.
        timezone_name=timezone_name,
        # A manual change by staff; it stays when the rate and fees are re-stamped.
        adjustment_amount=reservation.price_adjustment_amount or 0,
    )


def reservation_price_breakdown(
    db: Session, reservation: Reservation, car: Car | None = None, configuration=None
) -> PriceBreakdown:
    car = car or db.get(Car, reservation.car_id)
    configuration = configuration or get_configuration(db)

    # By id, not through the relationship: a reservation being created has its
    # pickup_location_id set before the place itself has been loaded.
    return agreed_price_breakdown(
        reservation, car, configuration, location_timezone_name(db, reservation.pickup_location_id)
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
