"""The address a request really came from.

The Azure ingress appends the address it saw to X-Forwarded-For, so the LAST
entry is the one the platform vouches for. Anything to its left was written by
the client (or by another proxy) and can be forged. uvicorn is told to trust
every proxy, which makes it report the FIRST entry as the client, so per-IP
limits keyed on request.client.host can be dodged by sending a made-up header.
Limits use this instead.
"""

import hmac
import ipaddress

from fastapi import Request

from app import config


def _visitor_from_trusted_proxy(request: Request) -> str | None:
    """
    The two web apps call this API from their own servers, so the platform
    vouches for the web app's address, not the visitor's: every visitor would
    share one login budget, and one attacker could lock everyone out. A web app
    that holds the shared secret says who the visitor is instead. Without the
    secret (or with a wrong one) the header is ignored like any other client
    header.
    """

    secret = config.TRUSTED_PROXY_SECRET
    given = request.headers.get("x-proxy-secret")

    if not secret or not given or not hmac.compare_digest(given.encode(), secret.encode()):
        return None

    try:
        return str(ipaddress.ip_address(request.headers.get("x-visitor-ip", "").strip()))
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    visitor = _visitor_from_trusted_proxy(request)

    if visitor is not None:
        return visitor

    forwarded = request.headers.get("x-forwarded-for", "")
    entries = [part.strip() for part in forwarded.split(",") if part.strip()]

    if entries:
        return entries[-1]

    return request.client.host if request.client else "unknown"
