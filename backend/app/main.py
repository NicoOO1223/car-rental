import logging
import os

import sentry_sdk

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

# Error tracking. Optional — leave SENTRY_DSN unset (e.g. local dev, CI) and
# this is a no-op.
if sentry_dsn := os.getenv("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=sentry_dsn,
        send_default_pii=False,
        traces_sample_rate=0.0,
    )

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.database import SessionLocal

from app.routers.auth import router as auth_router
from app.routers.admin_cars import router as admin_cars_router
from app.routers.cars import router as cars_router
from app.routers.admin_extras import router as admin_extras_router
from app.routers.extras import router as extras_router
from app.routers.locations import router as locations_router
from app.routers.reservations import router as reservations_router
from app.routers.dashboard import router as dashboard_router
from app.routers.customers import router as customers_router
from app.routers.handovers import router as handovers_router
from app.routers.check_outs import router as check_outs_router
from app.routers.maintenance import router as maintenance_router
from app.routers.audit_logs import router as audit_logs_router
from app.routers.users import router as users_router
from app.routers.branding import router as branding_router
from app.routers.configuration import public_router as public_configuration_router
from app.routers.configuration import router as configuration_router
from app.routers.stripe_webhook import router as stripe_webhook_router

from app.config import IS_PRODUCTION
from app.security_headers import SecurityHeadersMiddleware

# The interactive docs list every endpoint and payload, which is a free map
# for an attacker, so they only exist outside production.
app = FastAPI(
    title="Car Rental API",
    version="0.1.0",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

# Comma-separated list of allowed frontend origins, e.g.
# "https://car-rental-frontend.example.azurecontainerapps.io". Defaults to
# the local Next.js dev server so nothing changes for local development.
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

# Auth is a Bearer token in a header, not a cookie, so credentialed CORS is
# not needed. Methods and headers are limited to what the frontend sends.
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
# Added last so it wraps CORS and also covers its preflight responses.
app.add_middleware(SecurityHeadersMiddleware)


app.include_router(auth_router)
app.include_router(locations_router)
app.include_router(extras_router)
app.include_router(admin_extras_router)
app.include_router(cars_router)
app.include_router(admin_cars_router)
app.include_router(reservations_router)
app.include_router(dashboard_router)
app.include_router(customers_router)
app.include_router(handovers_router)
app.include_router(check_outs_router)
app.include_router(maintenance_router)
app.include_router(audit_logs_router)
app.include_router(users_router)
app.include_router(public_configuration_router)
app.include_router(branding_router)
app.include_router(configuration_router)
app.include_router(stripe_webhook_router)

@app.get("/health")
def health_check():
    """Liveness: the process is up. Deliberately does not touch the database,
    so a database blip does not make the platform restart a healthy app."""
    return {"status": "ok"}


@app.get("/ready")
def readiness_check(response: Response):
    """Readiness: the app can serve traffic, i.e. it can reach the database.
    A revision that starts but cannot connect stays out of rotation."""
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        response.status_code = 503
        return {"status": "unavailable"}
    return {"status": "ok"}