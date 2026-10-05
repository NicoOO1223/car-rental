"""
How a message becomes an email: filling in values, dropping lines that came out
empty, expanding parts, checking what an administrator wrote, and falling back when
a stored message cannot be used. No database: this is all plain functions.
"""

import pytest

from app.i18n.email_templates import PARTS as DEFAULT_PARTS, TEMPLATES
from app.languages import SUPPORTED_LANGUAGES
from app.services.email_render import (
    Wording,
    WordingError,
    check_body,
    check_part,
    check_subject,
    fill,
    footer_lines,
    render,
    tidy,
    to_html,
)
from app.services.email_types import PARTS, SAMPLE_BUSINESS, SAMPLE_FOOTER, SAMPLE_VALUES, SAMPLE_VARIANTS, STORAGE_PARTS, TYPES

CONFIRMED = TYPES["booking_confirmed"]
CANCELLED = TYPES["booking_cancelled"]

VALUES = {**SAMPLE_BUSINESS, **SAMPLE_VALUES["booking_confirmed"]}


def _render(type_key="booking_confirmed", language="en", wording=None, **overrides):
    values = {**SAMPLE_BUSINESS, **SAMPLE_VALUES[type_key], **overrides}

    return render(
        wording or Wording({}, {}),
        TYPES[type_key],
        language,
        values,
        part_variants=SAMPLE_VARIANTS.get(type_key),
        footer=SAMPLE_FOOTER,
    )


# --- filling in --------------------------------------------------------------------------------


def test_values_are_filled_in_and_a_line_with_an_empty_value_is_dropped():
    assert fill("Hello {name}\nPaid: {paid}\nBye", {"name": "Ann", "paid": ""}) == "Hello Ann\nBye"
    assert fill("Hello {name}", {"name": "Ann"}) == "Hello Ann"
    # A value that was never given counts as empty.
    assert fill("A\nB {missing}\nC", {}) == "A\nC"


def test_a_value_is_never_read_again_so_braces_in_a_name_cannot_change_an_email():
    out = fill("Hello {name}, ref {reference}", {"name": "{reference}", "reference": "R1"})

    assert out == "Hello {reference}, ref R1"


def test_blank_runs_collapse_and_the_ends_are_trimmed():
    assert tidy("\n\nA\n\n\n\nB   \n\n") == "A\n\nB"


# --- the default emails -------------------------------------------------------------------------


@pytest.mark.parametrize("language", SUPPORTED_LANGUAGES)
@pytest.mark.parametrize("type_key", sorted(TYPES))
def test_every_email_renders_in_every_language_with_nothing_left_unfilled(type_key, language):
    rendered = _render(type_key, language)

    assert rendered.subject and rendered.text
    assert "{" not in rendered.subject and "{" not in rendered.text
    assert "<p>" in rendered.html
    # The footer is always there.
    assert "Sample Rentals S.r.l." in rendered.text and "<hr>" in rendered.html


def test_optional_lines_disappear_cleanly():
    full = _render().text
    bare = _render(paid_online="", cancellation_deadline="", manage_url="").text

    assert "Paid online: 27.00 EUR" in full and "free of charge until" in full and "View or manage" in full
    assert "Paid online" not in bare and "free of charge" not in bare and "View or manage" not in bare
    assert "\n\n\n" not in bare
    # Everything else is still there.
    assert "Booking number: AB12CD34E" in bare and "Please bring your driving licence" in bare


def test_a_part_with_variants_says_what_happened_and_nothing_when_there_is_nothing_to_say():
    refunded = render(Wording({}, {}), CANCELLED, "en", {**SAMPLE_BUSINESS, **SAMPLE_VALUES["booking_cancelled"]}, part_variants={"payment_note": "refunded"})
    kept = render(Wording({}, {}), CANCELLED, "en", {**SAMPLE_BUSINESS, **SAMPLE_VALUES["booking_cancelled"]}, part_variants={"payment_note": "kept"})
    nothing = render(Wording({}, {}), CANCELLED, "en", {**SAMPLE_BUSINESS, **SAMPLE_VALUES["booking_cancelled"], "amount": ""})

    assert "will be refunded" in refunded.text and "not refunded" in kept.text
    assert "refund" not in nothing.text.lower()
    assert "Kind regards" in nothing.text


# --- the business's own wording -----------------------------------------------------------------


def test_a_message_the_business_wrote_replaces_the_built_in_one_in_that_language_only():
    wording = Wording({("booking_confirmed", "en"): ("Booked {reference}!", "Hi {name}! See you {pickup_time}.\n\n{signoff}")}, {})

    english = _render(wording=wording)
    italian = _render(language="it", wording=wording)

    assert english.subject == "Booked AB12CD34E!"
    assert english.text.startswith("Hi Giulia! See you 2030-06-01 10:00 CEST.")
    assert "Kind regards" in english.text  # the sign-off part still expands
    assert italian.subject.startswith("La tua prenotazione")


def test_a_part_the_business_wrote_is_used_everywhere_it_appears():
    wording = Wording({}, {("bring_list", "en"): "Bring your passport."})

    assert "Bring your passport." in _render(wording=wording).text
    assert "driving licence" not in _render(wording=wording).text


def test_an_empty_part_leaves_its_line_out():
    wording = Wording({}, {("cancellation_policy", "en"): ""})

    assert "free of charge" not in _render(wording=wording).text
    assert "\n\n\n" not in _render(wording=wording).text


def test_a_stored_message_that_cannot_be_filled_in_falls_back_to_the_built_in_one():
    broken = Wording(
        {("booking_confirmed", "en"): ("{unclosed", "Hello {name")},
        {("signoff", "en"): "Regards {"},
    )

    rendered = _render(wording=broken)

    assert rendered.subject == "Your booking AB12CD34E is confirmed - Sample Rentals"
    assert rendered.text.startswith("Hello Giulia,")
    assert "Kind regards" in rendered.text


def test_an_empty_stored_subject_falls_back_to_the_built_in_subject():
    wording = Wording({("booking_confirmed", "en"): ("{paid_online_note}{manage_url}", "Hi {name}")}, {})

    # Both names are parts/values the subject cannot see, so it renders empty.
    assert _render(wording=wording, manage_url="").subject == "Your booking AB12CD34E is confirmed - Sample Rentals"


# --- what an administrator may write ------------------------------------------------------------


@pytest.mark.parametrize(
    ("check", "text", "code"),
    [
        (check_body, "Hi {nme}", "unknown_placeholder"),
        (check_body, "Hi {name.__class__}", "unknown_placeholder"),
        (check_body, "Hi {name!r}", "unknown_placeholder"),
        (check_body, "Hi {name:>20}", "unknown_placeholder"),
        (check_body, "Hi {0}", "unknown_placeholder"),
        (check_body, "Hi {name", "braces"),
        (check_body, "Hi name}", "braces"),
        (check_body, "", "empty"),
        (check_body, "x" * 8001, "too_long"),
        (check_subject, "Hi {manage_link}", "unknown_placeholder"),
        (check_subject, "one\ntwo", "one_line"),
        (check_subject, "   ", "empty"),
        (check_subject, "x" * 301, "too_long"),
    ],
)
def test_wording_that_would_break_an_email_is_refused(check, text, code):
    with pytest.raises(WordingError) as error:
        check(CONFIRMED, text)

    assert error.value.code == code


def test_a_message_may_name_its_values_its_parts_and_the_global_ones_and_a_subject_only_values():
    assert check_body(CONFIRMED, "{name} {reference} {business} {contact} {signoff} {manage_link}")
    assert check_subject(CONFIRMED, "{reference} - {business}")
    assert check_body(CONFIRMED, "Literal {{braces}} are fine")


def test_a_message_may_not_use_another_emails_values():
    with pytest.raises(WordingError):
        check_body(CANCELLED, "{pickup_place}")

    assert check_body(CANCELLED, "{pickup_time} {amount} {payment_note}")


def test_a_part_may_only_name_its_own_values_and_may_be_empty():
    assert check_part("paid_online_note", "Paid: {paid_online}") == "Paid: {paid_online}"
    assert check_part("bring_list", "") == ""

    with pytest.raises(WordingError) as error:
        check_part("bring_list", "{name}")

    assert error.value.code == "unknown_placeholder"

    with pytest.raises(WordingError) as unknown:
        check_part("not_a_part", "x")

    assert unknown.value.code == "unknown_part"


def test_the_refusal_names_what_would_have_been_allowed():
    with pytest.raises(WordingError) as error:
        check_part("manage_link", "{url}")

    assert error.value.params["name"] == "{url}"
    assert "{manage_url}" in error.value.params["allowed"]


# --- the built-in wording itself ------------------------------------------------------------------


def test_the_built_in_wording_only_uses_names_it_is_allowed_to():
    for type_key, email_type in TYPES.items():
        for language in SUPPORTED_LANGUAGES:
            subject, body = TEMPLATES[type_key][language]

            check_subject(email_type, subject)
            check_body(email_type, body)

    for storage_key, by_language in DEFAULT_PARTS.items():
        assert storage_key in STORAGE_PARTS

        for language in SUPPORTED_LANGUAGES:
            check_part(storage_key, by_language[language])


def test_every_part_a_type_uses_exists_and_every_part_has_wording_in_every_language():
    for email_type in TYPES.values():
        for part_key in email_type.parts:
            assert part_key in PARTS

    for part in PARTS.values():
        for storage_key in part.storage_keys:
            assert set(DEFAULT_PARTS[storage_key]) == set(SUPPORTED_LANGUAGES)


# --- html and footer ------------------------------------------------------------------------------


def test_html_has_paragraphs_line_breaks_and_links_and_escapes_the_rest():
    html = to_html("Dear <b>Ann</b> & co\n\nOne\nTwo\n\nOpen https://shop.example.com/en/manage?reference=AB12 now")

    assert "&lt;b&gt;" in html and "<b>" not in html and "&amp;" in html
    assert "<p>One<br>Two</p>" in html
    assert '<a href="https://shop.example.com/en/manage?reference=AB12">' in html


def test_the_footer_is_the_business_identity_in_the_language_of_the_email():
    lines = footer_lines(
        "it",
        legal_name="Rossi S.r.l.",
        address="Via Roma 1\n07026 Olbia",
        vat_id="IT0123",
        privacy_url="https://shop.example.com/it/privacy",
    )

    assert lines == [
        "Rossi S.r.l.",
        "Via Roma 1",
        "07026 Olbia",
        "Partita IVA: IT0123",
        "Informativa sulla privacy: https://shop.example.com/it/privacy",
    ]
    assert footer_lines("en", legal_name="X", address="", vat_id="", privacy_url="") == ["X"]
