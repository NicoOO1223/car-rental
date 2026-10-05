"""
The emails the system can send, and what each may use.

One entry per email: who it goes to, which values and parts its message may use,
whether an administrator may switch it off and which options it has. Administrators
change the wording, the on/off switch and the options (Configuration > Email); they
do not invent new emails, because each one is sent by a specific event in the code.

The built-in wording is in app/i18n/email_templates.py.
"""

from dataclasses import dataclass, field

RENTER = "renter"
BUSINESS = "business"
ACCOUNT = "account"

# Available in every message and part: the business's name and its contact line.
GLOBAL_VALUES = ("business", "contact")


@dataclass(frozen=True)
class Option:
    name: str
    kind: str  # "bool" | "hours"
    default: object


@dataclass(frozen=True)
class EmailType:
    key: str
    audience: str
    # The {names} a message of this type may use, besides GLOBAL_VALUES.
    values: tuple[str, ...]
    # The parts a message of this type may use.
    parts: tuple[str, ...]
    # Security emails (verify, reset) cannot be switched off.
    can_disable: bool = True
    options: tuple[Option, ...] = field(default_factory=tuple)

    @property
    def message_names(self) -> tuple[str, ...]:
        """Everything a body may name: values, global values and parts."""

        return (*GLOBAL_VALUES, *self.values, *self.parts)

    @property
    def subject_names(self) -> tuple[str, ...]:
        """A subject may name values but not parts (it has to stay one line)."""

        return (*GLOBAL_VALUES, *self.values)


@dataclass(frozen=True)
class Part:
    key: str
    # The {names} the part's own text may use.
    values: tuple[str, ...]
    # "payment_note" is stored as "payment_note.refunded" and "payment_note.kept":
    # the event picks one. Empty for a part with a single wording.
    variants: tuple[str, ...] = ()

    @property
    def storage_keys(self) -> tuple[str, ...]:
        return tuple(f"{self.key}.{variant}" for variant in self.variants) or (self.key,)


TYPES: dict[str, EmailType] = {
    "booking_confirmed": EmailType(
        key="booking_confirmed",
        audience=RENTER,
        values=(
            "name",
            "reference",
            "vehicle",
            "pickup_place",
            "pickup_time",
            "return_place",
            "return_time",
            "total",
            "paid_online",
            "cancellation_deadline",
            "manage_url",
        ),
        parts=("paid_online_note", "cancellation_policy", "bring_list", "manage_link", "signoff"),
    ),
    "booking_cancelled": EmailType(
        key="booking_cancelled",
        audience=RENTER,
        values=("name", "reference", "vehicle", "pickup_time", "amount"),
        parts=("payment_note", "signoff"),
    ),
    "receipt": EmailType(
        key="receipt",
        audience=RENTER,
        values=("name", "number", "amount", "attached_invoice", "manage_url"),
        parts=("manage_link", "signoff"),
        options=(Option("attach_invoice", "bool", True),),
    ),
    "booking_changed": EmailType(
        key="booking_changed",
        audience=RENTER,
        values=(
            "name",
            "reference",
            "vehicle",
            "pickup_place",
            "pickup_time",
            "return_place",
            "return_time",
            "changes",
            "manage_url",
        ),
        parts=("manage_link", "signoff"),
    ),
    "pickup_reminder": EmailType(
        key="pickup_reminder",
        audience=RENTER,
        values=("name", "reference", "vehicle", "pickup_place", "pickup_time", "manage_url"),
        parts=("bring_list", "manage_link", "signoff"),
        # How long before the pickup the reminder goes out.
        options=(Option("hours_before", "hours", 24),),
    ),
    "agreement_copy": EmailType(
        key="agreement_copy",
        audience=RENTER,
        values=("name", "reference", "vehicle", "return_place", "return_time", "attached_agreement"),
        parts=("signoff",),
        options=(Option("attach_agreement", "bool", True),),
    ),
    "return_summary": EmailType(
        key="return_summary",
        audience=RENTER,
        values=(
            "name",
            "reference",
            "vehicle",
            "returned_at",
            "late_fee",
            "fuel_fee",
            "damage_charge",
            "total_charge",
        ),
        parts=("deposit_note", "signoff"),
    ),
    "refund_notice": EmailType(
        key="refund_notice",
        audience=RENTER,
        values=("name", "reference", "amount", "credit_note_number", "attached_credit_note"),
        parts=("signoff",),
        options=(Option("attach_credit_note", "bool", True),),
    ),
}

PARTS: dict[str, Part] = {
    "signoff": Part("signoff", values=GLOBAL_VALUES),
    "paid_online_note": Part("paid_online_note", values=("paid_online",)),
    "cancellation_policy": Part("cancellation_policy", values=("cancellation_deadline",)),
    "bring_list": Part("bring_list", values=()),
    "manage_link": Part("manage_link", values=("manage_url",)),
    "payment_note": Part("payment_note", values=("amount",), variants=("refunded", "kept")),
    # What happened to the security deposit at return: all of it released, or part of
    # it used for the charges.
    "deposit_note": Part(
        "deposit_note",
        values=("deposit_applied", "deposit_returned"),
        variants=("returned", "applied"),
    ),
}

# Which part keys exist in storage, and the part each belongs to.
STORAGE_PARTS: dict[str, Part] = {key: part for part in PARTS.values() for key in part.storage_keys}


def get_type(key: str) -> EmailType | None:
    return TYPES.get(key)


def options_with_defaults(email_type: EmailType, stored: dict | None) -> dict:
    """The type's options: what an administrator set, else the default."""

    stored = stored or {}

    return {option.name: stored.get(option.name, option.default) for option in email_type.options}


# Values for previews and per-email test sends: they look like real ones and are
# obviously not. `variants` picks the wording of parts that have variants.
SAMPLE_VALUES: dict[str, dict[str, str]] = {
    "booking_confirmed": {
        "name": "Giulia",
        "reference": "AB12CD34E",
        "vehicle": "Fiat Panda",
        "pickup_place": "Olbia Airport, Via dell'Aeroporto 1",
        "pickup_time": "2030-06-01 10:00 CEST",
        "return_place": "Olbia Airport, Via dell'Aeroporto 1",
        "return_time": "2030-06-04 10:00 CEST",
        "total": "135.00 EUR",
        "paid_online": "27.00 EUR",
        "cancellation_deadline": "2030-05-30 10:00 CEST",
        "manage_url": "https://www.example.com/en/manage?reference=AB12CD34E",
    },
    "booking_cancelled": {
        "name": "Giulia",
        "reference": "AB12CD34E",
        "vehicle": "Fiat Panda",
        "pickup_time": "2030-06-01 10:00 CEST",
        "amount": "27.00 EUR",
    },
    "receipt": {
        "name": "Giulia",
        "number": "INV-000123",
        "amount": "108.00 EUR",
        "attached_invoice": "INV-000123",
        "manage_url": "https://www.example.com/en/manage?reference=AB12CD34E",
    },
}

SAMPLE_VALUES.update(
    {
        "booking_changed": {
            "name": "Giulia",
            "reference": "AB12CD34E",
            "vehicle": "Fiat Panda",
            "pickup_place": "Olbia Airport, Via dell'Aeroporto 1",
            "pickup_time": "2030-06-02 10:00 CEST",
            "return_place": "Olbia Airport, Via dell'Aeroporto 1",
            "return_time": "2030-06-05 10:00 CEST",
            "changes": "Pick-up: 2030-06-01 10:00 CEST -> 2030-06-02 10:00 CEST\nReturn: 2030-06-04 10:00 CEST -> 2030-06-05 10:00 CEST",
            "manage_url": "https://www.example.com/en/manage?reference=AB12CD34E",
        },
        "pickup_reminder": {
            "name": "Giulia",
            "reference": "AB12CD34E",
            "vehicle": "Fiat Panda",
            "pickup_place": "Olbia Airport, Via dell'Aeroporto 1",
            "pickup_time": "2030-06-01 10:00 CEST",
            "manage_url": "https://www.example.com/en/manage?reference=AB12CD34E",
        },
        "agreement_copy": {
            "name": "Giulia",
            "reference": "AB12CD34E",
            "vehicle": "Fiat Panda",
            "return_place": "Olbia Airport, Via dell'Aeroporto 1",
            "return_time": "2030-06-04 10:00 CEST",
            "attached_agreement": "AB12CD34E",
        },
        "return_summary": {
            "name": "Giulia",
            "reference": "AB12CD34E",
            "vehicle": "Fiat Panda",
            "returned_at": "2030-06-04 11:30 CEST",
            "late_fee": "10.00 EUR",
            "fuel_fee": "",
            "damage_charge": "",
            "total_charge": "10.00 EUR",
            "deposit_applied": "10.00 EUR",
            "deposit_returned": "190.00 EUR",
        },
        "refund_notice": {
            "name": "Giulia",
            "reference": "AB12CD34E",
            "amount": "27.00 EUR",
            "credit_note_number": "CN-000004",
            "attached_credit_note": "CN-000004",
        },
    }
)

SAMPLE_VARIANTS: dict[str, dict[str, str]] = {
    "booking_cancelled": {"payment_note": "refunded"},
    "return_summary": {"deposit_note": "applied"},
}

SAMPLE_BUSINESS = {"business": "Sample Rentals", "contact": "info@example.com / +39 0789 000000"}
SAMPLE_FOOTER = ["Sample Rentals S.r.l.", "Via Roma 1, 07026 Olbia", "VAT ID: IT01234567890"]

# The parts and the emails that use them, for the settings screen.
def part_users(part_key: str) -> list[str]:
    return [email_type.key for email_type in TYPES.values() if part_key in email_type.parts]
