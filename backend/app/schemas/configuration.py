from zoneinfo import available_timezones

from app.languages import SUPPORTED_LANGUAGES

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

# Formats only: the interface itself is English. A short list keeps every
# option one the frontend has been checked against.
SUPPORTED_LOCALES = (
    "en",
    "en-GB",
    "en-US",
    "it",
    "de",
    "fr",
    "es",
    "pt",
    "nl",
    "pl",
)


class ConfigurationResponse(BaseModel):
    short_term_threshold_days: int
    short_term_fee: float
    airport_change_fee: float
    late_return_grace_minutes: int
    late_fee_per_hour: float
    fuel_fee_per_eighth: float
    refuel_service_fee: float
    max_damage_charge: float
    security_deposit_amount: float
    default_currency: str
    access_token_expire_days: int
    reminder_days: int
    business_name: str
    legal_name: str
    address: str
    phone: str
    email: str
    vat_id: str
    timezone: str
    locale: str
    agreement_terms: str
    vat_rate: float
    prices_include_vat: bool
    invoice_prefix: str
    default_language: str
    document_language: str

    model_config = ConfigDict(from_attributes=True)


class ConfigurationUpdate(BaseModel):
    short_term_threshold_days: int | None = None
    short_term_fee: float | None = None
    airport_change_fee: float | None = None
    late_return_grace_minutes: int | None = None
    late_fee_per_hour: float | None = None
    fuel_fee_per_eighth: float | None = None
    refuel_service_fee: float | None = None
    max_damage_charge: float | None = None
    security_deposit_amount: float | None = None
    default_currency: str | None = None
    access_token_expire_days: int | None = None
    reminder_days: int | None = None
    business_name: str | None = Field(default=None, max_length=100)
    legal_name: str | None = Field(default=None, max_length=150)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=150)
    vat_id: str | None = Field(default=None, max_length=50)
    timezone: str | None = None
    locale: str | None = None
    agreement_terms: str | None = Field(default=None, max_length=10000)
    vat_rate: float | None = None
    prices_include_vat: bool | None = None
    invoice_prefix: str | None = None
    default_language: str | None = None
    document_language: str | None = None

    @field_validator("default_language", "document_language")
    @classmethod
    def language_must_be_supported(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_LANGUAGES:
            raise PydanticCustomError(
                "validation.language_unsupported",
                "Language must be one of: {allowed}.",
                {"allowed": ", ".join(SUPPORTED_LANGUAGES)},
            )
        return v

    @field_validator("vat_rate")
    @classmethod
    def vat_rate_is_a_percentage(cls, v: float | None) -> float | None:
        if v is not None and not (0 <= v <= 100):
            raise PydanticCustomError("validation.vat_rate_range", "The VAT rate must be between 0 and 100 percent.")
        return v

    @field_validator("invoice_prefix")
    @classmethod
    def invoice_prefix_is_short_and_plain(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().upper()
        if not (1 <= len(v) <= 10) or not v.replace("-", "").isalnum():
            raise PydanticCustomError("validation.invoice_prefix_invalid", "The invoice prefix must be 1 to 10 letters, digits or dashes.")
        return v

    @field_validator(
        "business_name",
        "legal_name",
        "address",
        "phone",
        "email",
        "vat_id",
        "agreement_terms",
    )
    @classmethod
    def strip_text(cls, v: str | None) -> str | None:
        return v.strip() if v is not None else v

    @field_validator("business_name")
    @classmethod
    def business_name_is_required(cls, v: str | None) -> str | None:
        # Shown on the login page and every tab title, so it cannot be blank.
        if v is not None and not v:
            raise PydanticCustomError("validation.business_name_empty", "The business name cannot be empty.")
        return v

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_known(cls, v: str | None) -> str | None:
        if v is not None and v not in available_timezones():
            raise PydanticCustomError("validation.timezone_unknown", "Unknown timezone. Use an IANA name such as 'Europe/Rome'.")
        return v

    @field_validator("locale")
    @classmethod
    def locale_must_be_supported(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_LOCALES:
            raise PydanticCustomError(
                "validation.locale_unsupported",
                "Locale must be one of: {allowed}.",
                {"allowed": ", ".join(SUPPORTED_LOCALES)},
            )
        return v

    @field_validator("short_term_threshold_days")
    @classmethod
    def threshold_must_be_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise PydanticCustomError("validation.threshold_min", "Short-term threshold must be at least 1 day.")
        return v

    @field_validator("late_return_grace_minutes")
    @classmethod
    def grace_must_not_be_negative(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise PydanticCustomError("validation.grace_negative", "The grace period cannot be negative.")
        return v

    @field_validator(
        "short_term_fee",
        "airport_change_fee",
        "late_fee_per_hour",
        "fuel_fee_per_eighth",
        "refuel_service_fee",
        "max_damage_charge",
        "security_deposit_amount",
    )
    @classmethod
    def fee_must_not_be_negative(cls, v: float | None) -> float | None:
        if v is not None and v < 0:
            raise PydanticCustomError("validation.fee_negative", "Fees cannot be negative.")
        return v

    @field_validator("reminder_days")
    @classmethod
    def reminder_days_in_range(cls, v: int | None) -> int | None:
        if v is not None and not 1 <= v <= 365:
            raise PydanticCustomError(
                "validation.reminder_days_range",
                "Reminders must start between 1 and 365 days ahead.",
            )
        return v

    @field_validator("access_token_expire_days")
    @classmethod
    def expiry_must_be_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise PydanticCustomError("validation.token_expiry_min", "Access token expiry must be at least 1 day.")
        return v

    @field_validator("default_currency")
    @classmethod
    def currency_must_be_a_3_letter_code(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalized = v.strip().lower()
        if len(normalized) != 3 or not normalized.isalpha():
            raise PydanticCustomError("validation.currency_code", "Currency must be a 3-letter code, e.g. 'eur'.")
        return normalized


class PublicConfigurationResponse(BaseModel):
    """The configuration every staff member's screens need."""

    default_currency: str
    # Whether (and how much) a deposit is taken at check-in; 0 means off.
    security_deposit_amount: float
    # What every screen needs to show names, dates and money the way this
    # business does.
    business_name: str
    timezone: str
    locale: str
    # What a price is: whether it already contains VAT, and how much.
    vat_rate: float
    prices_include_vat: bool
    default_language: str

    model_config = ConfigDict(from_attributes=True)
