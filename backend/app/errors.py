"""
Errors the interface can show in the user's own language.

The server never translates. An AppError carries a stable code
("reservation.not_found") and the values the sentence needs
(`{"count": 3}`); the frontend looks the code up in its message catalog for
the language the person chose. The English `message` still travels as
`detail`, so a client that knows nothing about codes (a script, a test, an
old build of the interface) keeps showing readable text.

    raise NotFoundError("car.not_found", "Car not found.")
    raise AppError("extra.max_quantity", "At most {max} of this extra.", max=3)

Deliberately not a ValueError. The routers historically caught ValueError
and turned it into a 400, then chose 404 by comparing the text to English
sentences. A typed error carries its own status and passes straight through
to the handler in app/main.py.
"""

from typing import Any


class AppError(Exception):
    status_code = 400

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
        **params: Any,
    ):
        # The English text may name its values: "At most {max} of this
        # extra." with max=3. The same params fill in the translations.
        try:
            text = message.format(**params) if params else message
        except (KeyError, IndexError):
            text = message

        super().__init__(text)

        self.code = code
        self.message = text
        self.params = {key: _json_safe(value) for key, value in params.items()}
        self.headers = headers

        if status_code is not None:
            self.status_code = status_code


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    """The request is fine but clashes with what already exists."""

    status_code = 409


def _json_safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    return str(value)
