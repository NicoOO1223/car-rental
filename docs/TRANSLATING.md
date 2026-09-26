# Translating the app

The app speaks English, Italian and Polish. English is the source. Italian and Polish were drafted by Claude and are waiting for a native speaker to review them.

## What has words in it

| Where | Files | Language chosen by |
|---|---|---|
| Every screen | `frontend/messages/en.json`, `it.json`, `pl.json` | Each person, with a business default |
| Server error messages | `errors.*` in the same three files | Each person |
| Printed agreement and invoices | `backend/app/i18n/documents.py` | The business document language |

Extras' names and descriptions, and the agreement terms a business writes, are business data and are not translated.

## Reviewing a language

1. Open `frontend/messages/it.json` or `pl.json` and read it next to `en.json`. Keys are grouped by screen (`s.` for pages, `c.` for components, `errors.` for server messages, `enums.` for statuses and categories).
2. Watch for words in curly braces such as `{count}` or `{name}`. They are filled in by the app and must stay, spelled exactly the same. A translation may move them, so the sentence reads naturally.
3. Plurals look like `{count, plural, one {# day} other {# days}}`. Give each form the language needs. Polish uses `one`, `few`, `many` and `other`; Italian and English use `one` and `other`.
4. Selects look like `{method, select, CASH {cash} other {card}}`. Keep the words `CASH` and `other` and translate what is inside the braces.
5. Use the typographic apostrophe (’) in Italian, so a quote never runs into a `{placeholder}`.
6. For the agreement and invoices, review `backend/app/i18n/documents.py` the same way. Its wording can carry legal weight, so treat it as a legal review.

To see a change, run the frontend and pick the language in the sidebar. Nothing needs rebuilding beyond the normal dev server.

## Adding a language

1. Add its code to `SUPPORTED_LANGUAGES` in `backend/app/languages.py`.
2. Copy `frontend/messages/en.json` to `frontend/messages/<code>.json` and translate it.
3. Register it in `frontend/lib/i18n.ts`: an entry in `LANGUAGES` (its name in its own language) and one in `loaders`.
4. Add a block for it in `backend/app/i18n/documents.py`, including the number separators in `_SEPARATORS`.
5. Run the checks below.

## Checks

```
cd frontend
npm run check:messages     # catalogs agree, keys exist, no hardcoded text
cd ../backend
pytest tests/test_documents.py tests/test_language.py tests/test_error_codes.py
```

`check:messages` fails when a key exists in one language and not another, when a translation changes the placeholders, when code asks for a key that does not exist or forgets a value the message needs, when a server error code has no message, and when text is written straight into a screen instead of the catalog.

A missing translation is never shown as a bare key: the app falls back to English.

## Writing new text

Never write words straight into a screen. Add a message to `en.json`, use `t("some.key", { value })`, and add it to `it.json` and `pl.json`. Write whole sentences with their values inside them rather than joining pieces, because word order and plural forms differ between languages. For a server error, raise `AppError("area.code", "English sentence with {values}", value=...)` and add `errors.area.code` to the catalogs.

The development-only language `Pseudo (dev)` in the picker wraps every catalog message in ⟦ ⟧ and accents it, so text that was never extracted, and layouts that break with longer words, are easy to see.
