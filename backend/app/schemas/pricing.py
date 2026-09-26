from pydantic import BaseModel

from app.services.pricing import PriceBreakdown


class PriceBreakdownExtraLine(BaseModel):
    code: str
    name: str
    quantity: int
    unit_price: float
    price_unit: str  # PER_DAY | PER_RENTAL
    amount: float


class PriceBreakdownFields(BaseModel):
    """
    Itemized cost, shared verbatim by the pre-booking quote
    (POST /api/reservations/quote) and the handover payment intent, so the
    booking wizard's summary and the counter's payment screen render
    identical lines from one frontend component.

    The named surcharge fields are flat rather than a generic list of
    labelled lines because that is the shape PaymentIntentResponse already
    exposes. Extras are a list because they are open-ended.
    """

    rental_days: int
    currency: str

    base_amount: float
    short_term_fee: float
    airport_change_fee: float

    extras: list[PriceBreakdownExtraLine]
    extras_amount: float

    # VAT. With prices_include_vat the total already contains it; without,
    # it has been added to the total. vat_rate 0 means none is shown.
    vat_rate: float
    vat_amount: float
    net_amount: float
    prices_include_vat: bool

    total_amount: float

    @classmethod
    def from_breakdown(
        cls,
        breakdown: PriceBreakdown,
        rental_days: int,
        currency: str,
    ) -> "PriceBreakdownFields":
        return cls(
            rental_days=rental_days,
            currency=currency,
            base_amount=float(breakdown.base_amount),
            short_term_fee=float(breakdown.short_term_fee),
            airport_change_fee=float(breakdown.airport_change_fee),
            extras=[
                PriceBreakdownExtraLine(
                    code=line.code,
                    name=line.name,
                    quantity=line.quantity,
                    unit_price=float(line.unit_price),
                    price_unit=line.price_unit,
                    amount=float(line.amount),
                )
                for line in breakdown.extras
            ],
            extras_amount=float(breakdown.extras_amount),
            vat_rate=float(breakdown.vat_rate),
            vat_amount=float(breakdown.vat_amount),
            net_amount=float(breakdown.net_amount),
            prices_include_vat=breakdown.prices_include_vat,
            total_amount=float(breakdown.total_amount),
        )
