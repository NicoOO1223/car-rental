"""The public storefront API: no login, renter-safe responses, rate limited."""

from fastapi import APIRouter

from app.routers.public.bookings import router as bookings_router
from app.routers.public.catalog import router as catalog_router

router = APIRouter(prefix="/api/public", tags=["Public storefront"])
router.include_router(catalog_router)
router.include_router(bookings_router)
