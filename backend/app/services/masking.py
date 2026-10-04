"""
Customer contact details as shown in lists to people who may not browse them in
full (see CUSTOMERS_LIST_FULL in app/permissions.py). Enough is left to tell two
customers apart and to recognise one ("ends in 4821"), not enough to copy a
customer's details out of a list. Opening one customer shows everything and is
audited.
"""

MASK = "•••"


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return phone

    digits = "".join(character for character in phone if character.isdigit())

    return f"{MASK} {digits[-3:]}" if len(digits) > 3 else MASK


def mask_email(email: str | None) -> str | None:
    if not email:
        return email

    name, _, domain = email.partition("@")

    if not domain:
        return MASK

    return f"{name[:1]}{MASK}@{domain}"
