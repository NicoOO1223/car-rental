"""What a renter can browse: the business, places, add-ons, the fleet, and prices."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import AppError, NotFoundError
from app.languages import SUPPORTED_LANGUAGES
from app.models import Car, VehicleClass
from app.schemas.pricing import PriceBreakdownFields
from app.schemas.public import (
    PublicAvailabilityResponse,
    PublicConfigResponse,
    PublicExtra,
    PublicLegalResponse,
    PublicLocation,
    PublicOffer,
    PublicQuoteRequest,
    PublicQuoteResponse,
    PublicVehicle,
)
from app.schemas.reservation import ReservationQuoteRequest
from app.services.branding import get_logo
from app.services.car_photos import read_car_photo
from app.services.class_photos import read_class_photo
from app.services.landing_about import get_about_image
from app.services.landing_cta import get_cta_image
from app.services.landing_hero import get_hero_image
from app.services.configuration import get_configuration, vat_terms
from app.services.extras import list_extras
from app.services.locations import list_locations
from app.services.pricing import calculate_price_breakdown, calculate_rental_duration_days
from app.services.timezones import location_timezone_name
from app.services.public_catalog import (
    bookable_cars,
    cancellation_deadline,
    car_for_offer_key,
    cars_for_offer,
    group_into_offers,
    offered_cars,
    public_vehicle_fields,
    require_locations,
    require_storefront_enabled,
    split_payment,
    validate_window,
)
from app.services.rate_limit import limit_by_ip
from app.services.reservations import quote_reservation

router = APIRouter()

reads = Depends(limit_by_ip("public-read", 120))
searches = Depends(limit_by_ip("public-search", 30))


def enabled_configuration(db: Session = Depends(get_db)):
    """The configuration, once the storefront is known to be switched on."""

    configuration = get_configuration(db)
    require_storefront_enabled(configuration)

    return configuration


def _breakdown_for(car, configuration, pickup_location_id, return_location_id, pickup_at, return_at, timezone_name=None):
    return calculate_price_breakdown(
        car.price_per_day,
        pickup_at,
        return_at,
        pickup_location_id,
        return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=configuration.short_term_fee,
        airport_change_fee=configuration.airport_change_fee,
        **vat_terms(configuration),
        extras=[],
        timezone_name=timezone_name,
    )


@router.get("/config", response_model=PublicConfigResponse, dependencies=[reads])
def public_config(db: Session = Depends(get_db)):
    """Always answers, even when the storefront is off, so the site can say so."""

    configuration = get_configuration(db)
    logo = get_logo(db)
    hero = get_hero_image(db)
    about_image = get_about_image(db)
    cta_image = get_cta_image(db)

    return PublicConfigResponse(
        storefront_enabled=configuration.storefront_enabled,
        business_name=configuration.business_name,
        has_logo=logo is not None,
        logo_version=int(logo.updated_at.timestamp()) if logo is not None else None,
        locale=configuration.locale,
        default_language=configuration.default_language,
        languages=list(SUPPORTED_LANGUAGES),
        currency=configuration.default_currency,
        prices_include_vat=configuration.prices_include_vat,
        vat_rate=float(configuration.vat_rate),
        online_share_percent=configuration.online_share_percent,
        free_cancellation_hours=configuration.free_cancellation_hours,
        hold_minutes=configuration.hold_minutes,
        min_booking_lead_hours=configuration.min_booking_lead_hours,
        legal_version=configuration.legal_version,
        terms_url=configuration.terms_url,
        privacy_url=configuration.privacy_url,
        has_terms_text=bool(configuration.terms_text.strip()),
        has_privacy_text=bool(configuration.privacy_text.strip()),
        social_instagram_url=configuration.social_instagram_url,
        social_facebook_url=configuration.social_facebook_url,
        social_x_url=configuration.social_x_url,
        social_whatsapp_url=configuration.social_whatsapp_url,
        landing_headline=configuration.landing_headline,
        landing_tagline=configuration.landing_tagline,
        landing_benefit1_title=configuration.landing_benefit1_title,
        landing_benefit1_body=configuration.landing_benefit1_body,
        landing_benefit2_title=configuration.landing_benefit2_title,
        landing_benefit2_body=configuration.landing_benefit2_body,
        landing_benefit3_title=configuration.landing_benefit3_title,
        landing_benefit3_body=configuration.landing_benefit3_body,
        has_hero_image=hero is not None,
        hero_image_version=int(hero.updated_at.timestamp()) if hero is not None else None,
        landing_about_title=configuration.landing_about_title,
        landing_about_body=configuration.landing_about_body,
        has_landing_about_image=about_image is not None,
        landing_about_image_version=int(about_image.updated_at.timestamp()) if about_image is not None else None,
        has_landing_cta_image=cta_image is not None,
        landing_cta_image_version=int(cta_image.updated_at.timestamp()) if cta_image is not None else None,
    )


@router.get("/legal", response_model=PublicLegalResponse, dependencies=[reads])
def public_legal(configuration=Depends(enabled_configuration)):
    return PublicLegalResponse(
        legal_version=configuration.legal_version,
        terms_text=configuration.terms_text,
        terms_url=configuration.terms_url,
        privacy_text=configuration.privacy_text,
        privacy_url=configuration.privacy_url,
    )


@router.get("/locations", response_model=list[PublicLocation], dependencies=[reads])
def public_locations(configuration=Depends(enabled_configuration), db: Session = Depends(get_db)):
    return [
        PublicLocation(
            id=location.id,
            name=location.name,
            airport_code=location.airport_code,
            address=location.address,
            timezone=location.timezone,
        )
        for location in list_locations(db)
    ]


@router.get("/extras", response_model=list[PublicExtra], dependencies=[reads])
def public_extras(configuration=Depends(enabled_configuration), db: Session = Depends(get_db)):
    return [
        PublicExtra(
            id=extra.id,
            code=extra.code,
            name=extra.name,
            description=extra.description,
            translations=extra.translations or {},
            price=float(extra.price),
            price_unit=extra.price_unit,
            max_quantity=extra.max_quantity,
        )
        for extra in list_extras(db)
    ]


@router.get("/fleet", response_model=list[PublicVehicle], dependencies=[reads])
def public_fleet(configuration=Depends(enabled_configuration), db: Session = Depends(get_db)):
    """The kinds of car on offer, without dates: for the fleet page."""

    return [
        PublicVehicle(**public_vehicle_fields(offer))
        for offer, _ in group_into_offers(offered_cars(db))
    ]


@router.get("/cars/{car_id}/photo", dependencies=[reads])
def public_car_photo(car_id: UUID, request: Request, db: Session = Depends(get_db)):
    """
    A car's photo. Not gated by storefront_enabled — the staff admin's own
    edit screen uses this exact URL for its preview, the same way the
    business logo and landing hero/about images are served unauthenticated
    regardless of whether online booking is switched on.
    """

    car = db.get(Car, car_id)

    if car is None or car.photo_blob_path is None:
        raise NotFoundError("car.no_photo", "No photo has been uploaded for this car.")

    etag = f'"{car.photo_version}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=300",
    }

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    return Response(
        content=read_car_photo(car),
        media_type=car.photo_content_type,
        headers=headers,
    )


@router.get("/offers/{key}/photo", dependencies=[reads])
def public_offer_photo(key: str, request: Request, db: Session = Depends(get_db)):
    """
    A representative photo for an offer a renter is browsing — PublicVehicle
    deliberately carries no car id (see its docstring), only this same
    opaque offer_key already used to group identical cars and to book one.
    """

    # A class's own photo comes first; without one, a car's stands for it.
    holder = None

    if key.startswith("class-"):
        holder = db.scalar(select(VehicleClass).where(VehicleClass.slug == key.removeprefix("class-")))

        if holder is not None and not holder.has_photo:
            holder = None

    if holder is not None:
        reader, version, content_type = read_class_photo, holder.photo_version, holder.photo_content_type
    else:
        holder = car_for_offer_key(db, key)

        if holder is None or holder.photo_blob_path is None:
            raise NotFoundError("car.no_photo", "No photo has been uploaded for this car.")

        reader, version, content_type = read_car_photo, holder.photo_version, holder.photo_content_type

    etag = f'"{version}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=300",
    }

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    return Response(
        content=reader(holder),
        media_type=content_type,
        headers=headers,
    )


@router.get("/availability", response_model=PublicAvailabilityResponse, dependencies=[searches])
def public_availability(
    pickup_location_id: UUID,
    pickup_at: datetime,
    return_at: datetime,
    return_location_id: UUID | None = None,
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    """The offers free for this period, each with what the whole rental costs."""

    return_location_id = return_location_id or pickup_location_id

    validate_window(configuration, pickup_at, return_at)
    require_locations(db, pickup_location_id, return_location_id)

    currency = configuration.default_currency
    offers = []

    pickup_timezone = location_timezone_name(db, pickup_location_id)

    for offer, cars in group_into_offers(bookable_cars(db, pickup_location_id, pickup_at, return_at)):
        breakdown = _breakdown_for(
            cars[0], configuration, pickup_location_id, return_location_id, pickup_at, return_at, pickup_timezone
        )
        online, at_pickup = split_payment(breakdown.total_amount, configuration.online_share_percent)

        offers.append(
            PublicOffer(
                **public_vehicle_fields(offer),
                currency=currency,
                total_amount=float(breakdown.total_amount),
                online_amount=float(online),
                due_at_pickup=float(at_pickup),
            )
        )

    return PublicAvailabilityResponse(
        pickup_at=pickup_at,
        return_at=return_at,
        rental_days=calculate_rental_duration_days(pickup_at, return_at, pickup_timezone),
        offers=offers,
    )


@router.post("/quote", response_model=PublicQuoteResponse, dependencies=[searches])
def public_quote(
    data: PublicQuoteRequest,
    configuration=Depends(enabled_configuration),
    db: Session = Depends(get_db),
):
    """The exact price of an offer with add-ons, and how it would be paid."""

    validate_window(configuration, data.pickup_at, data.return_at)
    require_locations(db, data.pickup_location_id, data.return_location_id)

    cars = cars_for_offer(db, data.offer_key, data.pickup_location_id, data.pickup_at, data.return_at)

    if not cars:
        raise AppError(
            "public.offer_unavailable",
            "This car is no longer available for these dates.",
            status_code=409,
        )

    breakdown, rental_days, _, _ = quote_reservation(
        db,
        ReservationQuoteRequest(
            car_id=cars[0].id,
            pickup_location_id=data.pickup_location_id,
            return_location_id=data.return_location_id,
            pickup_at=data.pickup_at,
            return_at=data.return_at,
            extras=data.extras,
        ),
    )

    online, at_pickup = split_payment(breakdown.total_amount, configuration.online_share_percent)

    return PublicQuoteResponse(
        **PriceBreakdownFields.from_breakdown(breakdown, rental_days, configuration.default_currency).model_dump(),
        online_amount=float(online),
        due_at_pickup=float(at_pickup),
        online_share_percent=configuration.online_share_percent,
        free_cancellation_hours=configuration.free_cancellation_hours,
        cancellation_deadline_at=cancellation_deadline(configuration, data.pickup_at),
    )
