"""Turns errors into the JSON the interface understands: the English text as
`detail` (unchanged, so nothing that reads it breaks), plus a stable `code`
and the `params` for translating it. See app/errors.py."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import AppError


def _field(location: tuple) -> str:
    # ("body", "vat_rate") -> "vat_rate"; ("query", "limit") -> "limit"
    return ".".join(str(part) for part in location[1:])


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message, "code": exc.code, "params": exc.params},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        errors = []

        for error in exc.errors():
            errors.append(
                {
                    "field": _field(tuple(error["loc"])),
                    # Pydantic's own type ("missing", "string_too_short", ...)
                    # or the code of a custom one (see PydanticCustomError).
                    "code": error["type"],
                    "message": str(error["msg"]).removeprefix("Value error, "),
                    "params": {
                        key: value
                        for key, value in (error.get("ctx") or {}).items()
                        if isinstance(value, (str, int, float, bool))
                    },
                }
            )

        return JSONResponse(
            status_code=422,
            content={
                # FastAPI's usual shape, kept so existing readers still work.
                "detail": [
                    {"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]}
                    for e in exc.errors()
                ],
                "code": "validation.failed",
                "params": {},
                "errors": errors,
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException):
        # Anything still raised as a plain HTTPException (a missing route, a
        # method not allowed) gets a code too, by status.
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "code": f"http.{exc.status_code}",
                "params": {},
            },
            headers=getattr(exc, "headers", None),
        )
