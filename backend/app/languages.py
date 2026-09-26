"""
The languages the interface and printed documents can be shown in.

English is the source language: every message is written in English first
and translated from there. Adding a language is a matter of adding its code
here, a message catalog in frontend/messages, and the document labels in
app/i18n/documents.py (see docs/TRANSLATING.md).

This is separate from Configuration.locale, which only decides how dates,
times and amounts are written.
"""

SUPPORTED_LANGUAGES = ("en", "it", "pl")
DEFAULT_LANGUAGE = "en"


def is_supported(language: str | None) -> bool:
    return language in SUPPORTED_LANGUAGES
