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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.auth import router as auth_router
from app.routers.cars import router as cars_router
from app.routers.extras import router as extras_router
from app.routers.locations import router as locations_router
from app.routers.reservations import router as reservations_router
from app.routers.dashboard import router as dashboard_router
from app.routers.customers import router as customers_router
from app.routers.handovers import router as handovers_router
from app.routers.maintenance import router as maintenance_router
from app.routers.audit_logs import router as audit_logs_router
from app.routers.users import router as users_router
from app.routers.configuration import router as configuration_router

app = FastAPI(
    title="Car Rental API",
    version="0.1.0",
)

# Comma-separated list of allowed frontend origins, e.g.
# "https://car-rental-frontend.example.azurecontainerapps.io". Defaults to
# the local Next.js dev server so nothing changes for local development.
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(locations_router)
app.include_router(extras_router)
app.include_router(cars_router)
app.include_router(reservations_router)
app.include_router(dashboard_router)
app.include_router(customers_router)
app.include_router(handovers_router)
app.include_router(maintenance_router)
app.include_router(audit_logs_router)
app.include_router(users_router)
app.include_router(configuration_router)

@app.get("/health")
def health_check():
    return {"status": "ok"}