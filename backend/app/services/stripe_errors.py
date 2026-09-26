import stripe

from app.errors import AppError


def stripe_app_error(exc: stripe.StripeError) -> AppError:
    """
    A Stripe failure as an error the interface can show. The sentence around
    it is ours to translate; the reason inside it ("Your card was declined.")
    is Stripe's own text, already in whatever language Stripe chose, so it
    travels as a parameter and is not translated.
    """

    reason = exc.user_message or str(exc)

    return AppError("stripe.error", f"Stripe error: {reason}", reason=reason)
