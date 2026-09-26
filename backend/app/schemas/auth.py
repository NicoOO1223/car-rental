from pydantic import BaseModel, field_validator

from app.languages import SUPPORTED_LANGUAGES


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LanguageUpdate(BaseModel):
    """A person's own language choice. null goes back to the business default."""

    language: str | None

    @field_validator("language")
    @classmethod
    def language_must_be_supported(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Language must be one of: {', '.join(SUPPORTED_LANGUAGES)}.")
        return v
