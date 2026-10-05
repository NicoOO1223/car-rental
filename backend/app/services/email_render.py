"""
Turning a message into an email: filling it in, checking what an administrator
wrote, and making the plain-text and HTML bodies.

Rules (the same for messages, subjects and parts):
- {name} is replaced by that value. Only the names a message may use are accepted,
  each plain (no {name.attribute}, {name[0]}, {name!r} or format specs), braces
  must pair up, and a subject is a single line.
- A line that names a value that turned out to be empty is left out, so an
  optional line disappears cleanly instead of leaving "Paid online: ".
- A part is filled in first with its own values, then dropped into the message as
  a value; what is inside a value is never read again, so a customer's name
  containing braces cannot change an email.
- A stored message that can no longer be filled in falls back to the built-in one,
  so a bad row can never stop an email being sent.
"""

import re
import string
from dataclasses import dataclass
from html import escape

from app.i18n.documents import DEFAULT_DOCUMENT_LANGUAGE, document_language
from app.i18n.email_templates import FOOTER, PARTS as DEFAULT_PARTS, TEMPLATES as DEFAULT_TEMPLATES
from app.services.email_types import (
    GLOBAL_VALUES,
    PARTS,
    STORAGE_PARTS,
    EmailType,
)

MAX_SUBJECT_LENGTH = 300
MAX_BODY_LENGTH = 8000
MAX_PART_LENGTH = 2000


class WordingError(ValueError):
    """Something an administrator wrote cannot be used. `code` is a stable name
    for the screen to word in the reader's language."""

    def __init__(self, code: str, message: str, **params):
        super().__init__(message)
        self.code = code
        self.params = params


def check_text(text: str, allowed: tuple[str, ...], *, single_line: bool, max_length: int, allow_empty: bool) -> str:
    """`text` tidied, or a WordingError saying what is wrong with it."""

    text = text.replace("\r\n", "\n").strip()

    if len(text) > max_length:
        raise WordingError("too_long", "This is too long.", max=max_length)

    if not text and not allow_empty:
        raise WordingError("empty", "This cannot be empty.")

    if single_line and "\n" in text:
        raise WordingError("one_line", "This has to be a single line.")

    try:
        parsed = list(string.Formatter().parse(text))
    except ValueError:
        raise WordingError(
            "braces",
            "A curly bracket is not paired. Write a value's name in curly brackets, for example {example}.",
            example="{name}",
        )

    for _, field, spec, conversion in parsed:
        if field is None:
            continue

        if field not in allowed or spec or conversion:
            raise WordingError(
                "unknown_placeholder",
                "{name} cannot be used here. You can use: {allowed}",
                name="{" + field + "}",
                allowed=", ".join("{" + name + "}" for name in allowed) or "-",
            )

    return text


def check_subject(email_type: EmailType, text: str) -> str:
    return check_text(text, email_type.subject_names, single_line=True, max_length=MAX_SUBJECT_LENGTH, allow_empty=False)


def check_body(email_type: EmailType, text: str) -> str:
    return check_text(text, email_type.message_names, single_line=False, max_length=MAX_BODY_LENGTH, allow_empty=False)


def check_part(storage_key: str, text: str) -> str:
    part = STORAGE_PARTS.get(storage_key)

    if part is None:
        raise WordingError("unknown_part", "There is no such part.")

    # A part is a bit of an email, and may be left empty to leave it out.
    return check_text(text, part.values, single_line=False, max_length=MAX_PART_LENGTH, allow_empty=True)


def fill(text: str, values: dict[str, str]) -> str:
    """`text` with its {names} replaced. A line naming an empty or missing value
    is dropped. Raises ValueError if the text has unpaired braces."""

    out = []

    for line in text.split("\n"):
        pieces, drop = [], False

        for literal, field, _spec, _conversion in string.Formatter().parse(line):
            pieces.append(literal)

            if field is not None:
                value = values.get(field, "")

                if not str(value).strip():
                    drop = True
                    break

                pieces.append(str(value))

        if not drop:
            out.append("".join(pieces))

    return "\n".join(out)


def tidy(text: str) -> str:
    """Runs of blank lines become one, and the ends are trimmed."""

    return re.sub(r"\n{3,}", "\n\n", "\n".join(line.rstrip() for line in text.split("\n"))).strip()


# --- the wording in force ---------------------------------------------------------------------


@dataclass
class Wording:
    """What the business has written, over the built-in wording. `templates` maps
    (type, language) to (subject, body); `parts` maps (storage key, language) to text."""

    templates: dict[tuple[str, str], tuple[str, str]]
    parts: dict[tuple[str, str], str]

    def template(self, type_key: str, language: str) -> tuple[str, str]:
        return self.templates.get((type_key, language)) or default_template(type_key, language)

    def part(self, storage_key: str, language: str) -> str:
        override = self.parts.get((storage_key, language))

        return override if override is not None else default_part(storage_key, language)


def default_template(type_key: str, language: str) -> tuple[str, str]:
    by_language = DEFAULT_TEMPLATES[type_key]

    return by_language.get(language) or by_language[DEFAULT_DOCUMENT_LANGUAGE]


def default_part(storage_key: str, language: str) -> str:
    by_language = DEFAULT_PARTS[storage_key]

    return by_language.get(language) or by_language[DEFAULT_DOCUMENT_LANGUAGE]


@dataclass(frozen=True)
class Rendered:
    subject: str
    text: str
    html: str


_URL = re.compile(r"(https?://[^\s<]+)")


def to_html(text: str) -> str:
    """Paragraphs for blank lines, line breaks for single ones, and web addresses
    made into links. Everything else is escaped."""

    paragraphs = []

    for block in re.split(r"\n\s*\n", text):
        escaped = escape(block.strip())

        if not escaped:
            continue

        linked = _URL.sub(lambda match: f'<a href="{match.group(1)}">{match.group(1)}</a>', escaped)
        paragraphs.append("<p>" + linked.replace("\n", "<br>") + "</p>")

    return "".join(paragraphs)


def footer_lines(language: str, *, legal_name: str, address: str, vat_id: str, privacy_url: str) -> list[str]:
    """The business's identity at the end of every renter email. Not editable: it
    comes from Business."""

    language = document_language(language)
    lines = [part for part in (legal_name, *address.splitlines()) if part.strip()]

    if vat_id.strip():
        lines.append(FOOTER["vat"][language].format(vat_id=vat_id))

    if privacy_url:
        lines.append(FOOTER["privacy"][language].format(url=privacy_url))

    return lines


def render(
    wording: Wording,
    email_type: EmailType,
    language: str,
    values: dict[str, str],
    *,
    part_variants: dict[str, str] | None = None,
    footer: list[str] | None = None,
) -> Rendered:
    """The email for `values`, in `language`. `part_variants` picks the wording of a
    part that has variants (for example payment_note -> refunded)."""

    language = document_language(language)
    part_variants = part_variants or {}
    values = {**{name: "" for name in GLOBAL_VALUES}, **values}

    expanded = {}

    for part_key in email_type.parts:
        part = PARTS[part_key]
        variant = part_variants.get(part_key)

        if part.variants and variant not in part.variants:
            expanded[part_key] = ""
            continue

        storage_key = f"{part_key}.{variant}" if part.variants else part_key

        try:
            expanded[part_key] = tidy(fill(wording.part(storage_key, language), values))
        except ValueError:
            expanded[part_key] = tidy(fill(default_part(storage_key, language), values))

    subject_template, body_template = wording.template(email_type.key, language)
    default_subject, default_body = default_template(email_type.key, language)

    def attempt(template: str, fallback: str, names: dict[str, str]) -> str:
        try:
            return fill(template, names)
        except ValueError:
            return fill(fallback, names)

    subject = attempt(subject_template, default_subject, values).replace("\n", " ").strip()

    if not subject:
        subject = fill(default_subject, values).replace("\n", " ").strip()

    body = tidy(attempt(body_template, default_body, {**values, **expanded}))

    text = body + ("\n\n-- \n" + "\n".join(footer) if footer else "")
    html = to_html(body)

    if footer:
        html += '<hr><p style="color:#666;font-size:12px">' + "<br>".join(_linkify(escape(line)) for line in footer) + "</p>"

    return Rendered(subject, text, f"<!doctype html><html><body>{html}</body></html>")


def _linkify(escaped: str) -> str:
    return _URL.sub(lambda match: f'<a href="{match.group(1)}">{match.group(1)}</a>', escaped)
