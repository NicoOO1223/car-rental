from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Configuration(Base):
    """
    Admin-editable business-rule values that used to be hardcoded constants
    (see app/services/pricing.py, app/services/handovers.py,
    app/services/auth.py). A true singleton, not a generic key-value store —
    there is exactly one row, with id fixed at 1, enforced by the check
    constraint below. Callers fetch it via app/services/configuration.py's
    get_configuration() rather than querying this model directly.

    Deliberately named "Configuration", not "Settings" — this is internal
    admin/business-rule tuning, not personal account preferences. "Settings"
    is reserved for a future user-facing layer (account, appearance,
    notifications, GDPR-style data deletion) once that infrastructure
    exists, so the two must not collide.
    """

    __tablename__ = "configuration"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)

    short_term_threshold_days: Mapped[int] = mapped_column(nullable=False)
    short_term_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    airport_change_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Charges applied when a rental is checked back in (see
    # app/services/return_charges.py). A return later than the scheduled
    # time by more than the grace period is charged per started hour;
    # fuel per missing eighth of a tank plus a flat service fee once any is
    # missing; a damage charge is typed in by the employee, up to the cap.
    late_return_grace_minutes: Mapped[int] = mapped_column(nullable=False)
    late_fee_per_hour: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    fuel_fee_per_eighth: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    refuel_service_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    max_damage_charge: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Held at check-in (card authorization or cash) and settled at check-out
    # against any return charges. 0 turns deposits off.
    security_deposit_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    default_currency: Mapped[str] = mapped_column(String(3), nullable=False)

    # Only affects tokens issued after the change — a token's exp claim is
    # baked in at issue time, so this never retroactively shortens or
    # extends a session already in progress.
    access_token_expire_days: Mapped[int] = mapped_column(nullable=False)

    # How many days ahead the app starts reminding staff that a technical
    # inspection or an insurance period is about to end.
    reminder_days: Mapped[int] = mapped_column(nullable=False, default=30, server_default="30")

    # Distance since the last oil change at which the fleet condition page
    # and notifications flag a car as overdue (km, matching the unit the
    # odometer/mileage fields are already shown in).
    oil_change_interval_km: Mapped[int] = mapped_column(nullable=False, default=10000, server_default="10000")

    # The public storefront. Off until an admin turns it on.
    storefront_enabled: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    # The share of a rental paid online when booking (100 = all of it).
    online_share_percent: Mapped[int] = mapped_column(nullable=False, default=30, server_default="30")
    # A cancellation up to this many hours before pickup is refunded in full.
    free_cancellation_hours: Mapped[int] = mapped_column(nullable=False, default=48, server_default="48")
    # How long an unpaid online booking holds the car.
    hold_minutes: Mapped[int] = mapped_column(nullable=False, default=15, server_default="15")
    # The soonest pickup a renter can book, in hours from now.
    min_booking_lead_hours: Mapped[int] = mapped_column(nullable=False, default=24, server_default="24")
    terms_text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    terms_url: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    privacy_text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    privacy_url: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    # Where the storefront footer links to. Empty means "no link".
    social_instagram_url: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    social_facebook_url: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    social_x_url: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    social_whatsapp_url: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    # Bumped when the terms or privacy text changes.
    legal_version: Mapped[int] = mapped_column(nullable=False, default=1, server_default="1")

    # Business profile. Shown on the login page, the sidebar and the tab
    # title, and printed on the agreement. Text fields are never NULL: an
    # empty string means "not set", which keeps the update path (where None
    # means "leave unchanged") able to clear a field.
    business_name: Mapped[str] = mapped_column(String(100), nullable=False)
    legal_name: Mapped[str] = mapped_column(String(150), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(150), nullable=False)
    vat_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # The business-wide default timezone (IANA name). A location's own
    # timezone overrides it where day boundaries depend on the place.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    # Formatting locale for dates, times and money (BCP 47). It does not
    # translate the interface.
    locale: Mapped[str] = mapped_column(String(10), nullable=False)

    # The language the interface starts in for someone who has not chosen
    # their own, and the language printed documents (agreement, invoices) are
    # written in. Separate on purpose: staff can use the app in any language
    # while every invoice the business issues stays in one.
    default_language: Mapped[str] = mapped_column(String(5), nullable=False)
    document_language: Mapped[str] = mapped_column(String(5), nullable=False)

    # Free text printed on the rental agreement. Empty falls back to the
    # built-in placeholder wording.
    agreement_terms: Mapped[str] = mapped_column(Text, nullable=False)

    # VAT. A single rate for everything sold. When prices_include_vat is true
    # (the default, matching how prices were always entered) the price shown
    # is what the customer pays and VAT is the part of it that is tax; when
    # false, VAT is added on top of the price. 0 means no VAT is shown.
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    prices_include_vat: Mapped[bool] = mapped_column(Boolean, nullable=False)

    # Starts every invoice number: "INV" gives INV-000001, INV-000002, ...
    invoice_prefix: Mapped[str] = mapped_column(String(10), nullable=False)

    # The storefront home page, written once by the business owner in
    # whatever language that is — free text, like agreement_terms, not run
    # through the interface's translation catalogs. Empty means "not set":
    # the storefront falls back to its own generic copy for the hero, and
    # simply omits the benefits section rather than inventing marketing
    # claims on the business's behalf.
    landing_headline: Mapped[str] = mapped_column(String(150), nullable=False, default="", server_default="")
    landing_tagline: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    landing_benefit1_title: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default="")
    landing_benefit1_body: Mapped[str] = mapped_column(String(240), nullable=False, default="", server_default="")
    landing_benefit2_title: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default="")
    landing_benefit2_body: Mapped[str] = mapped_column(String(240), nullable=False, default="", server_default="")
    landing_benefit3_title: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default="")
    landing_benefit3_body: Mapped[str] = mapped_column(String(240), nullable=False, default="", server_default="")
    landing_about_title: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default="")
    landing_about_body: Mapped[str] = mapped_column(String(600), nullable=False, default="", server_default="")

    __table_args__ = (
        CheckConstraint("id = 1", name="configuration_singleton"),
    )
