from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import IS_PRODUCTION

# The API only returns JSON, PDFs and CSV, never pages, so a locked-down
# policy costs nothing and limits what a browser will do with a response.
_HEADERS: list[tuple[bytes, bytes]] = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cache-control", b"no-store"),
]

# Production only: the strict policy would break the Swagger UI, which is
# served in development.
if IS_PRODUCTION:
    _HEADERS.append(
        (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")
    )
    _HEADERS.append(
        (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
    )


class SecurityHeadersMiddleware:
    """Adds baseline security headers to every HTTP response.

    A plain ASGI middleware rather than BaseHTTPMiddleware, so streaming
    responses (PDF and CSV downloads) are not buffered.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {name.lower() for name, _ in message["headers"]}
                message["headers"] = list(message["headers"]) + [
                    (name, value) for name, value in _HEADERS if name not in existing
                ]
            await send(message)

        await self.app(scope, receive, send_with_headers)
