from pydantic import BaseModel, ConfigDict, field_validator


class ConfigurationResponse(BaseModel):
    short_term_threshold_days: int
    short_term_fee: float
    airport_change_fee: float
    default_currency: str
    access_token_expire_days: int

    model_config = ConfigDict(from_attributes=True)


class ConfigurationUpdate(BaseModel):
    short_term_threshold_days: int | None = None
    short_term_fee: float | None = None
    airport_change_fee: float | None = None
    default_currency: str | None = None
    access_token_expire_days: int | None = None

    @field_validator("short_term_threshold_days")
    @classmethod
    def threshold_must_be_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("Short-term threshold must be at least 1 day.")
        return v

    @field_validator("short_term_fee", "airport_change_fee")
    @classmethod
    def fee_must_not_be_negative(cls, v: float | None) -> float | None:
        if v is not None and v < 0:
            raise ValueError("Fees cannot be negative.")
        return v

    @field_validator("access_token_expire_days")
    @classmethod
    def expiry_must_be_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("Access token expiry must be at least 1 day.")
        return v

    @field_validator("default_currency")
    @classmethod
    def currency_must_be_a_3_letter_code(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalized = v.strip().lower()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("Currency must be a 3-letter code, e.g. 'eur'.")
        return normalized
