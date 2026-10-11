"""
The size of the email catalogue, pinned.

The marketing site (marketing/) describes these emails, and deploy/PROVISIONING.md
counts them. Adding or removing an email must be a deliberate change that also
updates those two places, so this test fails until the numbers are changed here too.
"""

from app.services.email_types import ACCOUNT, BUSINESS, RENTER, TYPES


def _by_audience(audience: str) -> set[str]:
    return {key for key, email_type in TYPES.items() if email_type.audience == audience}


def test_the_catalogue_has_sixteen_emails():
    assert len(TYPES) == 16


def test_renter_emails():
    assert _by_audience(RENTER) == {
        "booking_confirmed",
        "booking_cancelled",
        "receipt",
        "booking_changed",
        "pickup_reminder",
        "agreement_copy",
        "return_summary",
        "refund_notice",
        # request, approve, pay
        "request_received",
        "payment_requested",
        "payment_expired",
    }


def test_business_emails():
    assert _by_audience(BUSINESS) == {"new_online_booking", "online_cancellation", "needs_attention"}


def test_account_emails_cannot_be_switched_off():
    assert _by_audience(ACCOUNT) == {"verify_email", "reset_password"}
    assert all(not TYPES[key].can_disable for key in _by_audience(ACCOUNT))
