import logging

import stripe
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import config
from app.errors import AppError
from app.database import get_db
from app.services.stripe_sync import handle_event

logger = logging.getLogger(__name__)

# Deliberately unauthenticated: Stripe is the caller and cannot log in. The
# signature on every request is the authentication, so nothing is read or
# changed before it verifies.
router = APIRouter(prefix="/api/stripe", tags=["Stripe"])

# Stripe events are a few KB. Refuse anything much larger before hashing it.
MAX_BODY_BYTES = 1_000_000


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not config.STRIPE_WEBHOOK_SECRET:
        # Not configured: refuse rather than accept unverifiable payloads.
        raise AppError("stripe.webhook_not_configured", "Webhook is not configured.", status_code=503)

    declared = request.headers.get("content-length")

    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise AppError("stripe.webhook_too_large", "Payload too large.", status_code=413)

    # The signature covers the exact bytes Stripe sent, so this must be the
    # raw body, never a parsed-and-reserialized one.
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, signature, config.STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise AppError("stripe.webhook_bad_signature", "Invalid signature.")

    try:
        result = handle_event(db, event)
    except Exception:
        # A 5xx makes Stripe retry, and nothing was recorded (see
        # handle_event), so the retry starts clean.
        db.rollback()
        logger.exception("Failed to process Stripe event %s", event["id"])
        raise AppError("stripe.webhook_failed", "Could not process event.", status_code=500)

    return {"received": True, "result": result}
