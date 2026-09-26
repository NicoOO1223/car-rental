def sub(path, pairs):
    s = open(path, encoding="utf-8").read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:70], s.count(old))
        s = s.replace(old, new)
    open(path, "w", encoding="utf-8").write(s)


sub("app/models/__init__.py", [
    ("from app.models.handover import Handover\n", "from app.models.handover import Handover\nfrom app.models.invoice import Invoice, InvoiceCounter\n"),
    ('    "Handover",\n', '    "Handover",\n    "Invoice",\n    "InvoiceCounter",\n'),
])

sub("app/models/configuration.py", [
    ("from sqlalchemy import CheckConstraint, Numeric, String, Text", "from sqlalchemy import Boolean, CheckConstraint, Numeric, String, Text"),
    ('''    __table_args__ = (
        CheckConstraint("id = 1", name="configuration_singleton"),''', '''    # VAT. A single rate for everything sold. When prices_include_vat is true
    # (the default, matching how prices were always entered) the price shown
    # is what the customer pays and VAT is the part of it that is tax; when
    # false, VAT is added on top of the price. 0 means no VAT is shown.
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    prices_include_vat: Mapped[bool] = mapped_column(Boolean, nullable=False)

    # Starts every invoice number: "INV" gives INV-000001, INV-000002, ...
    invoice_prefix: Mapped[str] = mapped_column(String(10), nullable=False)

    __table_args__ = (
        CheckConstraint("id = 1", name="configuration_singleton"),'''),
])

sub("app/services/configuration.py", [
    ('''    "security_deposit_amount",
}''', '''    "security_deposit_amount",
    "vat_rate",
}'''),
    ('''def _json_safe(value):''', '''def vat_terms(configuration: Configuration) -> dict:
    """The VAT settings as the keyword arguments calculate_price_breakdown
    takes, so every place that prices a booking applies the same rule."""

    return {
        "vat_rate": configuration.vat_rate,
        "prices_include_vat": configuration.prices_include_vat,
    }


def _json_safe(value):'''),
])

sub("app/schemas/configuration.py", [
    ('''    locale: str
    agreement_terms: str

    model_config = ConfigDict(from_attributes=True)''', '''    locale: str
    agreement_terms: str
    vat_rate: float
    prices_include_vat: bool
    invoice_prefix: str

    model_config = ConfigDict(from_attributes=True)'''),
    ('''    agreement_terms: str | None = Field(default=None, max_length=10000)
''', '''    agreement_terms: str | None = Field(default=None, max_length=10000)
    vat_rate: float | None = None
    prices_include_vat: bool | None = None
    invoice_prefix: str | None = None

    @field_validator("vat_rate")
    @classmethod
    def vat_rate_is_a_percentage(cls, v: float | None) -> float | None:
        if v is not None and not (0 <= v <= 100):
            raise ValueError("The VAT rate must be between 0 and 100 percent.")
        return v

    @field_validator("invoice_prefix")
    @classmethod
    def invoice_prefix_is_short_and_plain(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().upper()
        if not (1 <= len(v) <= 10) or not v.replace("-", "").isalnum():
            raise ValueError("The invoice prefix must be 1 to 10 letters, digits or dashes.")
        return v
'''),
    ('''    business_name: str
    timezone: str
    locale: str


''', '''    business_name: str
    timezone: str
    locale: str
    # What a price is: whether it already contains VAT, and how much.
    vat_rate: float
    prices_include_vat: bool


'''),
])
print("ok")
