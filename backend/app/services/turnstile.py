"""
Cloudflare Turnstile: proof that a person, not a script, is booking.

The storefront shows the widget and sends its token with the booking or lookup;
this checks the token with Cloudflare. Without a secret key the check is skipped
in development and tests, and refused in production, so a misconfigured stack
never runs open by accident.
"""

import logging
import os

import requests

from app.config import IS_PRODUCTION
from app.errors import AppError

logger = logging.getLogger(__name__)

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _secret() -> str | None:
    return os.getenv("TURNSTILE_SECRET_KEY") or None


def verify_token(token: str | None, ip: str) -> bool:
    """Asks Cloudflare whether the token is valid. Any failure to ask is a no."""

    secret = _secret()

    if not token:
        return False

    try:
        response = requests.post(
            VERIFY_URL,
            data={"secret": secret, "response": token, "remoteip": ip},
            timeout=5,
        )

        return bool(response.json().get("success"))
    except (requests.RequestException, ValueError):
        logger.exception("Turnstile verification could not be completed")

        return False


def require_human(token: str | None, ip: str) -> None:
    if _secret() is None:
        if IS_PRODUCTION:
            raise AppError(
                "public.captcha_not_configured",
                "Online booking is temporarily unavailable.",
                status_code=503,
            )

        return

    if not verify_token(token, ip):
        raise AppError("public.captcha_failed", "We could not verify that you are not a robot. Please try again.")
