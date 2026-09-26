"""The address a request really came from.

The Azure ingress appends the address it saw to X-Forwarded-For, so the LAST
entry is the one the platform vouches for. Anything to its left was written by
the client (or by another proxy) and can be forged. uvicorn is told to trust
every proxy, which makes it report the FIRST entry as the client, so per-IP
limits keyed on request.client.host can be dodged by sending a made-up header.
Limits use this instead.
"""

from fastapi import Request


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    entries = [part.strip() for part in forwarded.split(",") if part.strip()]

    if entries:
        return entries[-1]

    return request.client.host if request.client else "unknown"
