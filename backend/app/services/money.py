from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def to_cents(amount: Decimal | int | float | str) -> int:
    """
    An amount in the currency's main unit as the integer number of cents
    Stripe wants, rounded half up. Going through Decimal (never float)
    matters: int(19.99 * 100) is 1998 in binary floating point, which would
    charge a customer a cent less than the price shown to them.
    """

    return int((Decimal(str(amount)) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def round_money(amount: Decimal) -> Decimal:
    """Rounds to whole cents, half up, the way every price here is rounded."""

    return amount.quantize(CENT, rounding=ROUND_HALF_UP)
